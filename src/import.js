// Reads export files and applies their change records. Safe to run twice, and in any order: a record that is
// already in the history changes nothing, and a change that arrives before the capture it belongs to waits for it.
//
// Also reads the three earlier formats, from when there were no change records: each capture in them becomes one
// 'create' record (see migrationRecord in changes.js), so it takes exactly the same path as everything else.
// Snapshot files (the readable copy made at export time) are recognised and ignored.

import { SCHEMA_VERSION, upgradeCapture } from './captures.js'
import { CREATE_FIELDS, FORMAT, FORMAT_VERSION, checkFields, cleanRecord, migrationRecord } from './changes.js'
import { SNAPSHOT_FORMAT } from './export.js'
import { applyChanges, getMedia, markSent } from './storage.js'

// Earlier formats, never written any more.
const LEGACY_CAPTURES_FORMAT = 'ari-captures' // version 1: one index per batch, each capture as it was
const LEGACY_CAPTURES_VERSION = 1
const LEGACY_INDEX_FORMAT = 'ari-cards' // version 2: the same, from when captures were called cards
const LEGACY_INDEX_VERSION = 2
const LEGACY_SINGLE_FORMAT = 'ari-card' // version 1: one file per card
const LEGACY_SINGLE_VERSION = 1

const isText = (value) => typeof value === 'string'
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value))
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

// Check a whole capture from an earlier format and return a clean copy in the current shape. Throws a readable error.
export function cleanCapture(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('no capture in the file')
  if (!isText(raw.id) || !raw.id || raw.id.length > 100) throw new Error('capture has no valid id')
  if (!isNumber(raw.schemaVersion)) throw new Error('capture has no schema version')
  if (raw.schemaVersion > SCHEMA_VERSION) throw new Error('made by a newer version of the app; update the app first')
  if (!isTime(raw.updated)) throw new Error('capture has no valid times')
  const capture = upgradeCapture(raw)
  checkFields(capture, CREATE_FIELDS)
  return { ...capture, updated: new Date(Date.parse(raw.updated)).toISOString() }
}

// The list of items in one file. An item is { change, mediaFile } (current format) or { capture, mediaFile }
// (earlier formats). Returns null for a snapshot file.
function readItems(parsed) {
  const format = parsed?.format
  if (format === SNAPSHOT_FORMAT) return null
  const tooNew = () => new Error('made by a newer version of the app; update the app first')
  if (format === FORMAT) {
    if (!isNumber(parsed.formatVersion) || parsed.formatVersion > FORMAT_VERSION) throw tooNew()
    if (!Array.isArray(parsed.changes)) throw new Error('the file lists no changes')
    return parsed.changes.map((item) => ({ change: item?.change ?? null, mediaFile: item?.mediaFile }))
  }
  if (format === LEGACY_CAPTURES_FORMAT) {
    if (!isNumber(parsed.formatVersion) || parsed.formatVersion > LEGACY_CAPTURES_VERSION) throw tooNew()
    if (!Array.isArray(parsed.captures)) throw new Error('the file lists no captures')
    return parsed.captures.map((item) => ({ capture: item?.capture ?? null, mediaFile: item?.mediaFile }))
  }
  if (format === LEGACY_INDEX_FORMAT) {
    if (!isNumber(parsed.formatVersion) || parsed.formatVersion > LEGACY_INDEX_VERSION) throw tooNew()
    if (!Array.isArray(parsed.cards)) throw new Error('the file lists no cards')
    return parsed.cards.map((item) => ({ capture: item?.card ?? null, mediaFile: item?.mediaFile }))
  }
  if (format === LEGACY_SINGLE_FORMAT) {
    if (parsed.formatVersion !== LEGACY_SINGLE_VERSION) throw tooNew()
    return [{ capture: parsed.card ?? null, mediaFile: parsed.mediaFile }]
  }
  throw new Error('not an ARI export file')
}

// Import the chosen files (a FileList or array). Returns
// { applied, known, waiting, files, snapshots, problems }:
//   applied   change records that were new and are now in the history
//   known     records that were already there (nothing happened)
//   waiting   captures whose changes arrived without the capture itself yet
//   files     photos/recordings stored that this device did not have
//   snapshots readable snapshot files that were recognised and ignored
export async function importFiles(fileList) {
  const files = [...fileList]
  const byName = new Map(files.map((file) => [file.name, file]))
  const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith('.json'))
  const report = { applied: 0, known: 0, waiting: 0, files: 0, snapshots: 0, problems: [] }
  const usedNames = new Set()
  const records = []
  const blobs = []
  const missingFiles = new Map() // capture id -> problem text, reported only if the capture still has no file afterwards

  if (!jsonFiles.length) report.problems.push('No export files (.json) were selected.')

  for (const file of jsonFiles) {
    let items
    try {
      items = readItems(JSON.parse(await file.text()))
    } catch (error) {
      report.problems.push(`${file.name}: ${error.message}`)
      continue
    }
    usedNames.add(file.name)
    if (items === null) {
      report.snapshots++
      continue
    }

    // Each item is handled on its own, so one bad item does not stop the others.
    for (const [number, item] of items.entries()) {
      const label = `${file.name}, item ${number + 1}`
      try {
        const record = item.change !== undefined ? cleanRecord(item.change) : migrationRecord(cleanCapture(item.capture), 'earlier-version')
        records.push(record)

        // The photo or recording belongs to a 'create' record: found by the file name written in the index, checked by size.
        const media = record.op === 'create' ? record.fields.media : null
        if (media) {
          const mediaName = isText(item.mediaFile) ? item.mediaFile : null
          const mediaFile = mediaName && byName.get(mediaName)
          if (mediaFile && mediaFile.size === media.size) {
            blobs.push({ id: record.target.id, blob: new Blob([mediaFile], { type: media.mimeType }) })
            usedNames.add(mediaFile.name)
            missingFiles.delete(record.target.id)
          } else if (!blobs.some((blob) => blob.id === record.target.id)) {
            const reason = !mediaName ? 'exported without its photo or recording' : mediaFile ? `${mediaName} has the wrong size, so it was not used` : `${mediaName} was not selected`
            missingFiles.set(record.target.id, `${label}: ${reason}`)
          }
        }
      } catch (error) {
        report.problems.push(`${label}: ${error.message}`)
      }
    }
  }

  if (records.length || blobs.length) {
    const result = await applyChanges(records, blobs)
    report.applied = result.applied
    report.known = result.known
    report.waiting = result.waiting
    report.files = result.files
    // Everything that came from files counts as sent, so it is not offered as "new" again on this device.
    await markSent(records.map((record) => record.id))
  }

  for (const [id, problem] of missingFiles) {
    if (!(await getMedia(id))) report.problems.push(problem)
  }

  const unused = files.filter((file) => !jsonFiles.includes(file) && !usedNames.has(file.name))
  if (jsonFiles.length && unused.length) {
    report.problems.push(`${unused.length} other file(s) were not used: ${unused.map((file) => file.name).join(', ')}`)
  }
  return report
}
