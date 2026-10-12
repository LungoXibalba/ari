// Reads files made by export.js and saves their captures. Safe to run twice: a capture whose id already
// exists is replaced only if the incoming `updated` time is newer; otherwise it is skipped.
// Also reads the two earlier formats, from when captures were called cards, and converts them on the way in.

import { SCHEMA_VERSION, upgradeCapture } from './captures.js'
import {
  FORMAT,
  FORMAT_VERSION,
  LEGACY_INDEX_FORMAT,
  LEGACY_INDEX_VERSION,
  LEGACY_SINGLE_FORMAT,
  LEGACY_SINGLE_VERSION,
} from './export.js'
import { getCapture, getMedia, markExported, saveCapture, saveCaptureWithMedia } from './storage.js'

const KINDS = ['text', 'photo', 'audio']

const isText = (value) => typeof value === 'string'
const isTextOrNull = (value) => value === null || typeof value === 'string'
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value))
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

// Check an incoming capture and return a clean copy with only the known fields. Throws a readable error if it is not usable.
// A capture saved under an earlier schema is brought up to the current one first.
export function cleanCapture(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('no capture in the file')
  if (!isText(raw.id) || !raw.id || raw.id.length > 100) throw new Error('capture has no valid id')
  if (!isNumber(raw.schemaVersion)) throw new Error('capture has no schema version')
  if (raw.schemaVersion > SCHEMA_VERSION) throw new Error('made by a newer version of the app; update the app first')
  if (!KINDS.includes(raw.kind)) throw new Error(`unknown capture kind "${raw.kind}"`)
  if (!isTime(raw.created) || !isTime(raw.updated)) throw new Error('capture has no valid times')
  if (!isText(raw.text)) throw new Error('capture text is missing')

  const capture = upgradeCapture(raw)
  for (const field of ['title', 'source', 'place']) {
    if (!isTextOrNull(capture[field])) throw new Error(`"${field}" must be text or empty`)
  }
  if (capture.deleted !== null && !isTime(capture.deleted)) throw new Error('capture trash time is not valid')
  const place = capture.location
  if (place !== null && !(place && isNumber(place.lat) && isNumber(place.lon) && isNumber(place.accuracy) && isText(place.at))) {
    throw new Error('capture location is not valid')
  }
  const media = capture.media
  if (media !== null && !(media && isText(media.mimeType) && isNumber(media.size))) {
    throw new Error('capture media information is not valid')
  }
  return {
    id: capture.id,
    schemaVersion: SCHEMA_VERSION,
    kind: capture.kind,
    created: capture.created,
    updated: capture.updated,
    text: capture.text,
    title: capture.title,
    source: capture.source,
    place: capture.place,
    location: place && { lat: place.lat, lon: place.lon, accuracy: place.accuracy, at: place.at },
    media: media && { mimeType: media.mimeType, size: media.size },
    deleted: capture.deleted,
  }
}

// The list of { capture, mediaFile } in one index file. Reads the current format and both earlier ones
// (one index per batch with `cards`, and one file per card).
function readItems(parsed) {
  if (parsed?.format === FORMAT) {
    if (!isNumber(parsed.formatVersion) || parsed.formatVersion > FORMAT_VERSION) {
      throw new Error('made by a newer version of the app; update the app first')
    }
    if (!Array.isArray(parsed.captures)) throw new Error('the file lists no captures')
    return parsed.captures.map((item) => ({ capture: item?.capture, mediaFile: item?.mediaFile }))
  }
  if (parsed?.format === LEGACY_INDEX_FORMAT) {
    if (!isNumber(parsed.formatVersion) || parsed.formatVersion > LEGACY_INDEX_VERSION) {
      throw new Error('made by a newer version of the app; update the app first')
    }
    if (!Array.isArray(parsed.cards)) throw new Error('the file lists no cards')
    return parsed.cards.map((item) => ({ capture: item?.card, mediaFile: item?.mediaFile }))
  }
  if (parsed?.format === LEGACY_SINGLE_FORMAT) {
    if (parsed.formatVersion !== LEGACY_SINGLE_VERSION) throw new Error('made by a newer version of the app; update the app first')
    return [{ capture: parsed.card, mediaFile: parsed.mediaFile }]
  }
  throw new Error('not an ARI export file')
}

// Import the chosen files (a FileList or array). Returns { imported, updated, skipped, problems }.
export async function importFiles(fileList) {
  const files = [...fileList]
  const byName = new Map(files.map((file) => [file.name, file]))
  const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith('.json'))
  const report = { imported: 0, updated: 0, skipped: 0, problems: [] }
  const usedNames = new Set()
  const marks = []

  if (!jsonFiles.length) report.problems.push('No export files (.json) were selected.')

  for (const file of jsonFiles) {
    let items
    try {
      items = readItems(JSON.parse(await file.text()))
      usedNames.add(file.name)
    } catch (error) {
      report.problems.push(`${file.name}: ${error.message}`)
      continue
    }

    // Each capture is handled on its own, so one bad capture does not stop the others.
    for (const item of items) {
      const label = `${file.name}, capture ${String(item?.capture?.id ?? '?').slice(0, 8)}`
      try {
        const capture = cleanCapture(item?.capture)

        // The photo or recording: found by the file name written in the index, and checked by size.
        let blob = null
        let mediaProblem = null // only reported if the capture is actually imported or updated
        if (capture.media) {
          const mediaName = isText(item.mediaFile) ? item.mediaFile : null
          const mediaFile = mediaName && byName.get(mediaName)
          if (mediaFile && mediaFile.size === capture.media.size) {
            blob = new Blob([mediaFile], { type: capture.media.mimeType })
            usedNames.add(mediaFile.name)
          } else if (!mediaName) {
            mediaProblem = `${label}: exported without its photo or recording`
          } else if (mediaFile) {
            mediaProblem = `${label}: ${mediaName} has the wrong size, so it was not used`
          } else {
            mediaProblem = `${label}: ${mediaName} was not selected`
          }
        }

        const existing = await getCapture(capture.id)
        let action = 'skipped'
        if (!existing) action = 'imported'
        else if (capture.updated > existing.updated) action = 'updated'
        else if (blob && existing.media && !(await getMedia(capture.id))) action = 'updated' // restores a missing file

        if (action !== 'skipped') {
          if (mediaProblem) report.problems.push(mediaProblem)
          // Without a usable file, an existing photo or recording stays as it is.
          await (blob ? saveCaptureWithMedia(capture, blob) : saveCapture(capture))
          marks.push({ id: capture.id, updated: capture.updated })
        }
        report[action]++
      } catch (error) {
        report.problems.push(`${label}: ${error.message}`)
      }
    }
  }

  const unused = files.filter((file) => !jsonFiles.includes(file) && !usedNames.has(file.name))
  if (jsonFiles.length && unused.length) {
    report.problems.push(`${unused.length} other file(s) were not used: ${unused.map((file) => file.name).join(', ')}`)
  }

  // Captures that came from files count as exported, so they are not offered as "new" again on this device.
  if (marks.length) await markExported(marks)
  return report
}
