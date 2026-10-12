// Turns the history (change records) into files for sharing. Each batch is one small index file (.json) listing
// records, plus the photo or recording of each capture whose 'create' record is in the batch, as a normal file
// (.jpg / .m4a) next to it. The first batch of an export also carries a snapshot: a readable copy of the current
// state of every capture, for opening and reading by hand (Import ignores it).
// Files are only ever added, never overwritten: their names carry this device's id and the export time.
// The format is described in CLAUDE.md ("Export files").

import { FORMAT, FORMAT_VERSION } from './changes.js'
import { getDeviceId, getMedia, listCaptures, listChanges, listSentIds } from './storage.js'

export const SNAPSHOT_FORMAT = 'ari-snapshot'
export const SNAPSHOT_VERSION = 1

// A batch ends when adding the next record would pass either limit. A single record larger than the
// size limit goes alone in its own batch (a photo or recording cannot be split).
// The size limit is a guess: no test has shared anything bigger than about 100 KB (see CLAUDE.md).
export const MAX_BATCH_BYTES = 25 * 1024 * 1024
export const MAX_BATCH_FILES = 100 // counts the index file too; only a sanity limit

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
}

// "audio/mp4; codecs=mp4a.40.2" -> "audio/mp4"
export function baseMimeType(mimeType) {
  return (mimeType || '').split(';')[0].trim().toLowerCase()
}

export function extensionFor(mimeType) {
  return EXTENSIONS[baseMimeType(mimeType)] || 'bin'
}

// A media file name that sorts by time and cannot collide: ari-2026-10-11T19-28-03Z-3f2a9c1e
// `capture` needs `created` and `id`.
export function fileBaseName(capture) {
  const time = capture.created.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')
  return `ari-${time}-${capture.id.slice(0, 8)}`
}

// The first 8 characters of a device id: enough to tell devices apart in file names and on screen.
export function shortId(id) {
  return id.slice(0, 8)
}

// Pure batching rule, kept separate so it can be tested on its own.
// `entries` are { record: { id }, item, files: File[] (media only), bytes } in the order they should be shared.
// Returns batches of { items, files, records, bytes }; the index file is added later, so one file is reserved for it.
// A file name that is already in the batch is not added twice.
export function planBatches(entries, maxBytes = MAX_BATCH_BYTES, maxFiles = MAX_BATCH_FILES) {
  const batches = []
  let current = null
  for (const entry of entries) {
    const fits =
      current && current.bytes + entry.bytes <= maxBytes && current.files.length + entry.files.length + 1 <= maxFiles
    if (!fits) {
      current = { items: [], files: [], records: [], bytes: 0 }
      batches.push(current)
    }
    current.items.push(entry.item)
    for (const file of entry.files) {
      if (!current.files.some((existing) => existing.name === file.name)) current.files.push(file)
    }
    current.records.push(entry.record)
    current.bytes += entry.bytes
  }
  return batches
}

async function buildEntry(record) {
  const files = []
  let mediaFile = null
  const media = record.op === 'create' ? record.fields.media : null
  if (media) {
    const blob = await getMedia(record.target.id)
    if (blob) {
      mediaFile = `${fileBaseName({ created: record.fields.created, id: record.target.id })}.${extensionFor(media.mimeType)}`
      const type = baseMimeType(media.mimeType) || 'application/octet-stream'
      files.push(new File([blob], mediaFile, { type }))
    }
  }
  const item = { change: record, mediaFile }
  return {
    record: { id: record.id },
    item,
    files,
    bytes: files.reduce((total, file) => total + file.size, 0) + JSON.stringify(item).length,
  }
}

// How many change records have not been exported yet, out of how many exist.
export async function countUnsent() {
  const [records, sent] = await Promise.all([listChanges(), listSentIds()])
  return { unsent: records.filter((record) => !sent.has(record.id)).length, total: records.length }
}

// A readable copy of the current state of every capture (trashed ones included, with their `deleted` time).
async function buildSnapshot(device, exportedAt, stamp) {
  const captures = (await listCaptures('all')).sort((a, b) => a.created.localeCompare(b.created))
  const snapshot = {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_VERSION,
    note: 'A readable copy of the current state, made at export time. Import does not use it; the change files are the record.',
    device,
    exportedAt,
    captures: captures.map((capture) => ({
      ...capture,
      mediaFile: capture.media ? `${fileBaseName(capture)}.${extensionFor(capture.media.mimeType)}` : null,
    })),
  }
  return new File([JSON.stringify(snapshot, null, 2)], `ari-snapshot-${shortId(device)}-${stamp}.json`, { type: 'application/json' })
}

// Build the files and the batches. Nothing is shared or marked yet.
export async function prepareExport({ onlyChanged }) {
  const [records, sent, device] = await Promise.all([listChanges(), listSentIds(), getDeviceId()])
  const chosen = onlyChanged ? records.filter((record) => !sent.has(record.id)) : records
  const entries = []
  for (const record of chosen) entries.push(await buildEntry(record))
  const batches = planBatches(entries)
  if (!batches.length) return batches

  // One index file per batch. The time in its name is the same for every batch of this export, so they sort together.
  const exportedAt = new Date().toISOString()
  const stamp = exportedAt.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')
  batches.forEach((batch, index) => {
    const indexJson = JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, device, exportedAt, changes: batch.items }, null, 2)
    const name = `ari-changes-${shortId(device)}-${stamp}-${index + 1}of${batches.length}.json`
    batch.files.unshift(new File([indexJson], name, { type: 'application/json' }))
  })

  const snapshot = await buildSnapshot(device, exportedAt, stamp)
  batches[0].files.push(snapshot)
  batches[0].bytes += snapshot.size
  return batches
}

// Share one batch through the system share sheet. Returns 'shared', 'cancelled' or 'unsupported'; throws on failure.
// No title or text is passed: on iOS a title makes the share sheet save a stray text file as well.
// 'shared' means the share sheet reported success, not that a file is known to have arrived.
export async function shareBatch(batch) {
  if (!navigator.canShare || !navigator.canShare({ files: batch.files })) return 'unsupported'
  try {
    await navigator.share({ files: batch.files })
    return 'shared'
  } catch (error) {
    if (error.name === 'AbortError') return 'cancelled'
    throw error
  }
}
