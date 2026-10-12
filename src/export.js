// Turns captures into files for sharing. Each batch is one small index file (.json) listing the captures in
// the batch, plus each photo or recording as a normal file (.jpg / .m4a) next to it.
// Also splits the captures into batches and shares a batch. The format is described in CLAUDE.md ("Export files").
// Trashed captures are exported too, so that the trash reaches the other device.

import { getMedia, listCaptures, listExportRecords } from './storage.js'

export const FORMAT = 'ari-captures' // current: one index file per batch
export const FORMAT_VERSION = 1
// Earlier formats, from when captures were called cards. Still readable on import, never written.
export const LEGACY_INDEX_FORMAT = 'ari-cards' // version 2: one index file per batch
export const LEGACY_INDEX_VERSION = 2
export const LEGACY_SINGLE_FORMAT = 'ari-card' // version 1: one file per card
export const LEGACY_SINGLE_VERSION = 1

// A batch ends when adding the next capture would pass either limit. A single capture larger than the
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
export function fileBaseName(capture) {
  const time = capture.created.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')
  return `ari-${time}-${capture.id.slice(0, 8)}`
}

// Captures that were never exported, or were changed after they were (moving to the trash counts as a change).
export function changedCaptures(captures, records) {
  return captures.filter((capture) => !(capture.id in records) || capture.updated > records[capture.id])
}

// Pure batching rule, kept separate so it can be tested on its own.
// `entries` are { capture: { id, updated }, item, files: File[] (media only), bytes } in the order they should be shared.
// Returns batches of { items, files, captures, bytes }; the index file is added later, so one file is reserved for it.
export function planBatches(entries, maxBytes = MAX_BATCH_BYTES, maxFiles = MAX_BATCH_FILES) {
  const batches = []
  let current = null
  for (const entry of entries) {
    const fits =
      current && current.bytes + entry.bytes <= maxBytes && current.files.length + entry.files.length + 1 <= maxFiles
    if (!fits) {
      current = { items: [], files: [], captures: [], bytes: 0 }
      batches.push(current)
    }
    current.items.push(entry.item)
    current.files.push(...entry.files)
    current.captures.push(entry.capture)
    current.bytes += entry.bytes
  }
  return batches
}

async function buildEntry(capture) {
  const files = []
  let mediaFile = null
  if (capture.media) {
    const blob = await getMedia(capture.id)
    if (blob) {
      mediaFile = `${fileBaseName(capture)}.${extensionFor(capture.media.mimeType)}`
      const type = baseMimeType(capture.media.mimeType) || 'application/octet-stream'
      files.push(new File([blob], mediaFile, { type }))
    }
  }
  const item = { capture, mediaFile }
  return {
    capture: { id: capture.id, updated: capture.updated }, // the `updated` time as exported, not as it may be edited later
    item,
    files,
    bytes: files.reduce((total, file) => total + file.size, 0) + JSON.stringify(item).length,
  }
}

// Number of captures that are new or changed since they were last exported (trashed ones included).
export async function countChanged() {
  const [captures, records] = await Promise.all([listCaptures('all'), listExportRecords()])
  return { changed: changedCaptures(captures, records).length, total: captures.length }
}

// Build the files and the batches. Nothing is shared or marked yet.
export async function prepareExport({ onlyChanged }) {
  const [captures, records] = await Promise.all([listCaptures('all'), listExportRecords()])
  const chosen = (onlyChanged ? changedCaptures(captures, records) : captures).sort((a, b) => a.created.localeCompare(b.created))
  const entries = []
  for (const capture of chosen) entries.push(await buildEntry(capture))
  const batches = planBatches(entries)

  // One index file per batch. The time in its name is the same for every batch of this export, so they sort together.
  const exportedAt = new Date().toISOString()
  const stamp = exportedAt.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')
  batches.forEach((batch, index) => {
    const indexJson = JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt, captures: batch.items }, null, 2)
    const name = `ari-captures-${stamp}-${index + 1}of${batches.length}.json`
    batch.files.unshift(new File([indexJson], name, { type: 'application/json' }))
  })
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
