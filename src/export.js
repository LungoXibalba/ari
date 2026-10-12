// Turns cards into files for sharing. Each batch is one small index file (.json) listing the cards in
// the batch, plus each photo or recording as a normal file (.jpg / .m4a) next to it.
// Also splits the cards into batches and shares a batch. The format is described in CLAUDE.md ("Export files").

import { getMedia, listCards, listExportRecords } from './storage.js'

export const FORMAT = 'ari-cards' // current: one index file per batch
export const FORMAT_VERSION = 2
export const OLD_FORMAT = 'ari-card' // version 1: one file per card; still readable on import
export const OLD_FORMAT_VERSION = 1

// A batch ends when adding the next card would pass either limit. A single card larger than the
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
export function fileBaseName(card) {
  const time = card.created.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')
  return `ari-${time}-${card.id.slice(0, 8)}`
}

// Cards that were never exported, or were changed after they were.
export function changedCards(cards, records) {
  return cards.filter((card) => !(card.id in records) || card.updated > records[card.id])
}

// Pure batching rule, kept separate so it can be tested on its own.
// `entries` are { card: { id, updated }, item, files: File[] (media only), bytes } in the order they should be shared.
// Returns batches of { items, files, cards, bytes }; the index file is added later, so one file is reserved for it.
export function planBatches(entries, maxBytes = MAX_BATCH_BYTES, maxFiles = MAX_BATCH_FILES) {
  const batches = []
  let current = null
  for (const entry of entries) {
    const fits =
      current && current.bytes + entry.bytes <= maxBytes && current.files.length + entry.files.length + 1 <= maxFiles
    if (!fits) {
      current = { items: [], files: [], cards: [], bytes: 0 }
      batches.push(current)
    }
    current.items.push(entry.item)
    current.files.push(...entry.files)
    current.cards.push(entry.card)
    current.bytes += entry.bytes
  }
  return batches
}

async function buildEntry(card) {
  const files = []
  let mediaFile = null
  if (card.media) {
    const blob = await getMedia(card.id)
    if (blob) {
      mediaFile = `${fileBaseName(card)}.${extensionFor(card.media.mimeType)}`
      const type = baseMimeType(card.media.mimeType) || 'application/octet-stream'
      files.push(new File([blob], mediaFile, { type }))
    }
  }
  const item = { card, mediaFile }
  return {
    card: { id: card.id, updated: card.updated }, // the `updated` time as exported, not as it may be edited later
    item,
    files,
    bytes: files.reduce((total, file) => total + file.size, 0) + JSON.stringify(item).length,
  }
}

// Number of cards that are new or changed since they were last exported.
export async function countChanged() {
  const [cards, records] = await Promise.all([listCards(), listExportRecords()])
  return { changed: changedCards(cards, records).length, total: cards.length }
}

// Build the files and the batches. Nothing is shared or marked yet.
export async function prepareExport({ onlyChanged }) {
  const [cards, records] = await Promise.all([listCards(), listExportRecords()])
  const chosen = (onlyChanged ? changedCards(cards, records) : cards).sort((a, b) => a.created.localeCompare(b.created))
  const entries = []
  for (const card of chosen) entries.push(await buildEntry(card))
  const batches = planBatches(entries)

  // One index file per batch. The time in its name is the same for every batch of this export, so they sort together.
  const exportedAt = new Date().toISOString()
  const stamp = exportedAt.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')
  batches.forEach((batch, index) => {
    const indexJson = JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt, cards: batch.items }, null, 2)
    const name = `ari-cards-${stamp}-${index + 1}of${batches.length}.json`
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
