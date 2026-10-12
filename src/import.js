// Reads files made by export.js and saves their cards. Safe to run twice: a card whose id already
// exists is replaced only if the incoming `updated` time is newer; otherwise it is skipped.

import { SCHEMA_VERSION } from './cards.js'
import { FORMAT, FORMAT_VERSION, OLD_FORMAT, OLD_FORMAT_VERSION } from './export.js'
import { getCard, getMedia, markExported, saveCard, saveCardWithMedia } from './storage.js'

const KINDS = ['text', 'photo', 'audio']
const STATUSES = ['inbox', 'processed']

const isText = (value) => typeof value === 'string'
const isTextOrNull = (value) => value === null || typeof value === 'string'
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value))
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

// Check an incoming card and return a clean copy with only the known fields. Throws a readable error if it is not usable.
export function cleanCard(card) {
  if (!card || typeof card !== 'object') throw new Error('no card in the file')
  if (!isText(card.id) || !card.id || card.id.length > 100) throw new Error('card has no valid id')
  if (!isNumber(card.schemaVersion)) throw new Error('card has no schema version')
  if (card.schemaVersion > SCHEMA_VERSION) throw new Error('made by a newer version of the app; update the app first')
  if (!KINDS.includes(card.kind)) throw new Error(`unknown card kind "${card.kind}"`)
  if (!isTime(card.created) || !isTime(card.updated)) throw new Error('card has no valid times')
  if (!isText(card.text)) throw new Error('card text is missing')
  if (!STATUSES.includes(card.status)) throw new Error(`unknown status "${card.status}"`)
  for (const field of ['gist', 'source', 'place']) {
    if (!isTextOrNull(card[field])) throw new Error(`"${field}" must be text or empty`)
  }
  const place = card.location
  if (place !== null && !(place && isNumber(place.lat) && isNumber(place.lon) && isNumber(place.accuracy) && isText(place.at))) {
    throw new Error('card location is not valid')
  }
  const media = card.media
  if (media !== null && !(media && isText(media.mimeType) && isNumber(media.size))) {
    throw new Error('card media information is not valid')
  }
  return {
    id: card.id,
    schemaVersion: card.schemaVersion,
    kind: card.kind,
    created: card.created,
    updated: card.updated,
    text: card.text,
    gist: card.gist,
    source: card.source,
    place: card.place,
    location: place && { lat: place.lat, lon: place.lon, accuracy: place.accuracy, at: place.at },
    media: media && { mimeType: media.mimeType, size: media.size },
    status: card.status,
  }
}

// The list of { card, mediaFile } in one index file. Reads the current format (one index per batch)
// and the old one (one file per card).
function readItems(parsed) {
  if (parsed?.format === FORMAT) {
    if (!isNumber(parsed.formatVersion) || parsed.formatVersion > FORMAT_VERSION) {
      throw new Error('made by a newer version of the app; update the app first')
    }
    if (!Array.isArray(parsed.cards)) throw new Error('the file lists no cards')
    return parsed.cards
  }
  if (parsed?.format === OLD_FORMAT) {
    if (parsed.formatVersion !== OLD_FORMAT_VERSION) throw new Error('made by a newer version of the app; update the app first')
    return [{ card: parsed.card, mediaFile: parsed.mediaFile }]
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

    // Each card is handled on its own, so one bad card does not stop the others.
    for (const item of items) {
      const label = `${file.name}, card ${String(item?.card?.id ?? '?').slice(0, 8)}`
      try {
        const card = cleanCard(item?.card)

        // The photo or recording: found by the file name written in the index, and checked by size.
        let blob = null
        let mediaProblem = null // only reported if the card is actually imported or updated
        if (card.media) {
          const mediaName = isText(item.mediaFile) ? item.mediaFile : null
          const mediaFile = mediaName && byName.get(mediaName)
          if (mediaFile && mediaFile.size === card.media.size) {
            blob = new Blob([mediaFile], { type: card.media.mimeType })
            usedNames.add(mediaFile.name)
          } else if (!mediaName) {
            mediaProblem = `${label}: exported without its photo or recording`
          } else if (mediaFile) {
            mediaProblem = `${label}: ${mediaName} has the wrong size, so it was not used`
          } else {
            mediaProblem = `${label}: ${mediaName} was not selected`
          }
        }

        const existing = await getCard(card.id)
        let action = 'skipped'
        if (!existing) action = 'imported'
        else if (card.updated > existing.updated) action = 'updated'
        else if (blob && existing.media && !(await getMedia(card.id))) action = 'updated' // restores a missing file

        if (action !== 'skipped') {
          if (mediaProblem) report.problems.push(mediaProblem)
          // Without a usable file, an existing photo or recording stays as it is.
          await (blob ? saveCardWithMedia(card, blob) : saveCard(card))
          marks.push({ id: card.id, updated: card.updated })
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

  // Cards that came from files count as exported, so they are not offered as "new" again on this device.
  if (marks.length) await markExported(marks)
  return report
}
