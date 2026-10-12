// Change records: the history of what happened to each capture, one small record per change.
//
// A record says which capture, which fields, the new values, when, on which device and by whom.
// A capture's current state is never stored on its own authority: it is worked out from its records
// (`foldCapture`). That is what lets two devices change the same capture without losing each other's
// edits: records only ever get added, and merging means "for each field, the newest value wins".
// Nothing here touches the database; storage.js stores the records and the worked-out state.

import { SCHEMA_VERSION } from './captures.js'

export const FORMAT = 'ari-changes' // the export file that carries records
export const FORMAT_VERSION = 1

// Who made the change. Only 'nemo' (typed or tapped) and 'migration' (made from data that existed
// before records did) are produced today; 'ai' and 'trace' are reserved for later.
export const ACTORS = ['nemo', 'migration', 'ai', 'trace']

// A 'create' record carries all of these. Only some fields may be changed afterwards: kind, created and
// media describe the captured file itself and never change.
export const CREATE_FIELDS = ['kind', 'created', 'text', 'title', 'source', 'place', 'location', 'media', 'deleted']
export const EDITABLE_FIELDS = ['text', 'title', 'source', 'place', 'location', 'deleted']

const KINDS = ['text', 'photo', 'audio']

const isText = (value) => typeof value === 'string'
const isTextOrNull = (value) => value === null || typeof value === 'string'
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value))
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

// Checks the value of each field named in `names` (and nothing else). Throws a readable error.
export function checkFields(fields, names) {
  for (const name of names) {
    const value = fields[name]
    if (value === undefined) throw new Error(`"${name}" is missing`)
    if (name === 'kind' && !KINDS.includes(value)) throw new Error(`unknown capture kind "${value}"`)
    if (name === 'created' && !isTime(value)) throw new Error('"created" is not a valid time')
    if (name === 'text' && !isText(value)) throw new Error('"text" must be text')
    if (['title', 'source', 'place'].includes(name) && !isTextOrNull(value)) throw new Error(`"${name}" must be text or empty`)
    if (name === 'deleted' && value !== null && !isTime(value)) throw new Error('"deleted" must be a time or empty')
    if (name === 'location' && value !== null) {
      const ok = value && isNumber(value.lat) && isNumber(value.lon) && isNumber(value.accuracy) && isText(value.at)
      if (!ok) throw new Error('"location" is not valid')
    }
    if (name === 'media' && value !== null) {
      if (!(value && isText(value.mimeType) && isNumber(value.size))) throw new Error('"media" is not valid')
    }
  }
}

// A copy of `fields` holding only the named fields, with location and media copied field by field.
function pick(fields, names) {
  const copy = {}
  for (const name of names) {
    const value = fields[name]
    if (name === 'location' && value) copy.location = { lat: value.lat, lon: value.lon, accuracy: value.accuracy, at: value.at }
    else if (name === 'media' && value) copy.media = { mimeType: value.mimeType, size: value.size }
    else copy[name] = value
  }
  return copy
}

// Each record gets a time later than the one before it on this device, even within the same millisecond,
// so two quick changes to one field are always ordered the way they happened.
let lastMillis = 0
export function nextTime() {
  lastMillis = Math.max(Date.now(), lastMillis + 1)
  return new Date(lastMillis).toISOString()
}

function newRecord({ op, captureId, fields, device, by, at }) {
  return {
    id: crypto.randomUUID(),
    at: at ?? nextTime(),
    device,
    by,
    target: { type: 'capture', id: captureId },
    op,
    fields,
  }
}

// The record for a capture that has just been made on this device.
export function createRecord(capture, device) {
  return newRecord({ op: 'create', captureId: capture.id, fields: pick(capture, CREATE_FIELDS), device, by: 'nemo', at: capture.created })
}

// The record for changing some editable fields of a capture.
export function setRecord(captureId, fields, device) {
  checkFields(fields, Object.keys(fields))
  const names = Object.keys(fields)
  if (!names.length || names.some((name) => !EDITABLE_FIELDS.includes(name))) throw new Error('not an editable field')
  return newRecord({ op: 'set', captureId, fields: pick(fields, names), device, by: 'nemo' })
}

// A "create" record made from a whole capture as it existed before records did (an older database or an
// older export file). Its id is the same on every device that sees the same version of the capture, so the
// same old capture arriving twice is recognised. Its time is the capture's `updated` time.
export function migrationRecord(capture, device) {
  return {
    id: `m-${capture.id}-${capture.updated}`,
    at: capture.updated,
    device,
    by: 'migration',
    target: { type: 'capture', id: capture.id },
    op: 'create',
    fields: pick(capture, CREATE_FIELDS),
  }
}

// Validates a record from an export file and returns a clean copy. Throws a readable error.
export function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('no change in the file')
  if (!isText(raw.id) || !raw.id || raw.id.length > 200) throw new Error('change has no valid id')
  if (!isTime(raw.at)) throw new Error('change has no valid time')
  if (!isText(raw.device) || !raw.device || raw.device.length > 100) throw new Error('change has no device')
  if (!ACTORS.includes(raw.by)) throw new Error(`unknown actor "${raw.by}"`)
  if (raw.target?.type !== 'capture') throw new Error('change is about something this version does not know')
  if (!isText(raw.target.id) || !raw.target.id || raw.target.id.length > 100) throw new Error('change has no valid target')
  if (!raw.fields || typeof raw.fields !== 'object') throw new Error('change has no fields')

  let names
  if (raw.op === 'create') {
    names = CREATE_FIELDS
  } else if (raw.op === 'set') {
    names = Object.keys(raw.fields)
    if (!names.length || names.some((name) => !EDITABLE_FIELDS.includes(name))) throw new Error('change names a field that cannot be changed')
  } else {
    throw new Error(`unknown kind of change "${raw.op}"`)
  }
  checkFields(raw.fields, names)
  return {
    id: raw.id,
    at: new Date(Date.parse(raw.at)).toISOString(), // one fixed format, so times can be compared as text
    device: raw.device,
    by: raw.by,
    target: { type: 'capture', id: raw.target.id },
    op: raw.op,
    fields: pick(raw.fields, names),
  }
}

// Order: earlier time first; if equal, by id, so every device settles ties the same way.
export function compareRecords(a, b) {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

// The current state of one capture, from all its records. Returns null until a 'create' record is
// present (a change can arrive before the capture it belongs to). For each field the newest value wins,
// and `updated` is the time of the newest record. Does not depend on the order the records arrived in.
export function foldCapture(captureId, records) {
  if (!records.some((record) => record.op === 'create')) return null
  const ordered = [...records].sort(compareRecords)
  const fields = {}
  for (const record of ordered) Object.assign(fields, record.fields)
  return {
    id: captureId,
    schemaVersion: SCHEMA_VERSION,
    kind: fields.kind,
    created: fields.created,
    updated: ordered[ordered.length - 1].at,
    text: fields.text,
    title: fields.title,
    source: fields.source,
    place: fields.place,
    location: fields.location,
    media: fields.media,
    deleted: fields.deleted,
  }
}
