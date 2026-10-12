// Our own small interface to the phone's database (IndexedDB). The rest of the app only calls
// the functions exported here, so the database can be swapped later by changing this file alone.
//
// Stores:
//  - 'changes': the history. One record per change (see changes.js); records are only ever added.
//    Found by id, and by the capture they are about (index 'target').
//  - 'captures': the current state of every capture, worked out from its records. It is a quick-to-read
//    copy: it can always be rebuilt from 'changes'. Nothing writes to it except through the functions below.
//  - 'media': the photo or recording blob for a capture, found by the capture id. Kept apart so that
//    listing the inbox never loads large files. A capture's file never changes once stored.
//  - 'sent': the ids of change records that have been exported (or that came in from an import), so
//    "export new changes" knows what is left to send.
//  - 'meta': small facts about this device; today only its random device id.
//
// Nothing is ever deleted here: "deleting" a capture is a change record that sets `deleted`, and another
// one can undo it.

import { compareRecords, createRecord, foldCapture, migrationRecord, setRecord } from './changes.js'
import { upgradeCapture } from './captures.js'

const DB_NAME = 'ari'
// 1: cards + media. 2: + exports. 3: the 'cards' store became 'captures'.
// 4: + changes, sent, meta; every existing capture got a 'create' record; 'exports' became 'sent'.
const DB_VERSION = 4

let opening

function createChangeStores(db) {
  db.createObjectStore('changes', { keyPath: 'id' }).createIndex('target', 'target.id')
  db.createObjectStore('sent', { keyPath: 'id' }) // { id } of a change record
  db.createObjectStore('meta') // key 'deviceId'
}

// Version 3: an object store cannot be renamed, so copy every record into a new one (bringing it up to
// the current schema on the way), then remove the old one. `next` runs when that is finished.
function copyCardsToCaptures(db, tx, next) {
  const captures = db.createObjectStore('captures', { keyPath: 'id' })
  tx.objectStore('cards').openCursor().onsuccess = (event) => {
    const cursor = event.target.result
    if (cursor) {
      captures.put(upgradeCapture(cursor.value))
      cursor.continue()
    } else {
      db.deleteObjectStore('cards')
      next()
    }
  }
}

// Version 4: create the history stores, give this device an id, write one 'create' record for every capture
// that already exists (its state as of its `updated` time), and carry over what had been exported.
function addChangeLog(db, tx) {
  createChangeStores(db)
  const device = crypto.randomUUID()
  tx.objectStore('meta').put(device, 'deviceId')
  tx.objectStore('captures').getAll().onsuccess = (captureEvent) => {
    const captures = captureEvent.target.result
    tx.objectStore('exports').getAll().onsuccess = (exportEvent) => {
      const exportedAt = new Map(exportEvent.target.result.map((record) => [record.id, record.updated]))
      for (const capture of captures) {
        const record = migrationRecord(capture, device)
        tx.objectStore('changes').put(record)
        // Already exported in exactly this state: do not offer it as "new" again.
        if (exportedAt.get(capture.id) === capture.updated) tx.objectStore('sent').put({ id: record.id })
      }
      db.deleteObjectStore('exports')
    }
  }
}

function openDatabase() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    // All of an upgrade happens inside its own transaction: if anything fails, the whole upgrade is undone
    // and the old data stays as it was.
    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction
      if (event.oldVersion === 0) {
        // A new database: create the current layout straight away.
        db.createObjectStore('captures', { keyPath: 'id' })
        db.createObjectStore('media') // key is supplied when saving: the capture id
        createChangeStores(db)
        tx.objectStore('meta').put(crypto.randomUUID(), 'deviceId')
        return
      }
      if (event.oldVersion < 2) db.createObjectStore('exports', { keyPath: 'id' })
      if (event.oldVersion < 3) copyCardsToCaptures(db, tx, () => addChangeLog(db, tx))
      else addChangeLog(db, tx)
    }
    request.onsuccess = () => {
      // If a newer version of the app needs to upgrade the database, let go of it instead of blocking the upgrade.
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
  return opening
}

// Run `work` inside one transaction (all-or-nothing) and resolve when it has been written to disk.
// `work` receives the transaction and may return an IndexedDB request (or any object with a `result`) whose
// result we pass back once the transaction is complete.
async function inTransaction(storeNames, mode, work) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode)
    const request = work(transaction)
    transaction.oncomplete = () => resolve(request?.result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

// This device's random id, made once. It is written into every change record this device makes.
let deviceId
export function getDeviceId() {
  deviceId ??= inTransaction('meta', 'readonly', (tx) => tx.objectStore('meta').get('deviceId')).then(async (found) => {
    if (found) return found
    const fresh = crypto.randomUUID()
    await inTransaction('meta', 'readwrite', (tx) => tx.objectStore('meta').put(fresh, 'deviceId'))
    return fresh
  })
  return deviceId
}

// The heart of it. Inside a transaction already open on 'changes', 'captures' and 'media':
//  1. add each record that is not already in the history (a record seen before changes nothing),
//  2. store each file whose capture has none yet,
//  3. work out again the state of every capture that got a new record.
// Calls `done({ applied, known, waiting, files })` at the end: records added, records already known, captures
// whose 'create' record has not arrived yet (their changes wait for it), and files stored.
function applyInTransaction(tx, records, blobs, done) {
  const changes = tx.objectStore('changes')
  const captures = tx.objectStore('captures')
  const media = tx.objectStore('media')
  const report = { applied: 0, known: 0, waiting: 0, files: 0 }
  const touched = new Set()

  function recompute() {
    for (const { id, blob } of blobs) {
      media.get(id).onsuccess = (event) => {
        if (event.target.result === undefined) {
          media.put(blob, id)
          report.files++
        }
      }
    }
    let left = touched.size
    if (!left) return done(report)
    for (const id of touched) {
      changes.index('target').getAll(id).onsuccess = (event) => {
        const state = foldCapture(id, event.target.result)
        if (state) captures.put(state)
        else report.waiting++
        if (--left === 0) done(report)
      }
    }
  }

  let pending = records.length
  if (!pending) return recompute()
  for (const record of records) {
    changes.get(record.id).onsuccess = (event) => {
      if (event.target.result) {
        report.known++
      } else {
        changes.put(record)
        report.applied++
        touched.add(record.target.id)
      }
      if (--pending === 0) recompute()
    }
  }
}

// Add records (made here, or read from an import file) and, optionally, files `[{ id, blob }]` for captures.
// All of it happens in one all-or-nothing step. Resolves with the report described above.
export function applyChanges(records, blobs = []) {
  const unique = [...new Map(records.map((record) => [record.id, record])).values()]
  const holder = { result: null }
  return inTransaction(['changes', 'captures', 'media'], 'readwrite', (tx) => {
    applyInTransaction(tx, unique, blobs, (report) => {
      holder.result = report
    })
    return holder
  })
}

// A capture just made on this device (see newCapture), with its photo or recording if it has one.
export async function createCapture(capture, blob = null) {
  const record = createRecord(capture, await getDeviceId())
  return applyChanges([record], blob ? [{ id: capture.id, blob }] : [])
}

// Change some editable fields of a capture ({ text, title, source, place, location, deleted }). Only the fields
// whose value really differs are recorded, so saving a form never re-stamps a field that was not touched
// (which could otherwise overwrite another device's newer edit of it). Changing nothing records nothing.
export async function setCaptureFields(id, fields) {
  const device = await getDeviceId()
  setRecord(id, fields, device) // only to check that the fields are allowed and valid, before the transaction starts
  const holder = { result: { applied: 0, known: 0, waiting: 0, files: 0 } }
  return inTransaction(['changes', 'captures', 'media'], 'readwrite', (tx) => {
    const read = tx.objectStore('captures').get(id)
    read.onsuccess = () => {
      const current = read.result
      if (!current) return
      const changed = {}
      for (const [name, value] of Object.entries(fields)) {
        if (JSON.stringify(current[name]) !== JSON.stringify(value)) changed[name] = value
      }
      if (!Object.keys(changed).length) return
      applyInTransaction(tx, [setRecord(id, changed, device)], [], (report) => {
        holder.result = report
      })
    }
    return holder
  })
}

export function getCapture(id) {
  return inTransaction('captures', 'readonly', (tx) => tx.objectStore('captures').get(id))
}

// The photo or recording blob for a capture (undefined if it has none).
export function getMedia(id) {
  return inTransaction('media', 'readonly', (tx) => tx.objectStore('media').get(id))
}

// Captures, newest first. `which` is 'active' (the inbox), 'trashed', or 'all' (what export needs).
export async function listCaptures(which = 'active') {
  const all = await inTransaction('captures', 'readonly', (tx) => tx.objectStore('captures').getAll())
  const chosen = which === 'all' ? all : all.filter((capture) => (capture.deleted !== null) === (which === 'trashed'))
  return chosen.sort((a, b) => b.created.localeCompare(a.created))
}

// Move a capture to the trash, or take it back out.
export function trashCapture(id) {
  return setCaptureFields(id, { deleted: new Date().toISOString() })
}

export function restoreCapture(id) {
  return setCaptureFields(id, { deleted: null })
}

// The whole history, oldest first.
export async function listChanges() {
  const all = await inTransaction('changes', 'readonly', (tx) => tx.objectStore('changes').getAll())
  return all.sort(compareRecords)
}

// Ids of the change records that have been exported (or came in from an import).
export async function listSentIds() {
  const rows = await inTransaction('sent', 'readonly', (tx) => tx.objectStore('sent').getAll())
  return new Set(rows.map((row) => row.id))
}

// Remember that these records have been exported (or imported). `ids` is a list of record ids.
export function markSent(ids) {
  return inTransaction('sent', 'readwrite', (tx) => {
    const store = tx.objectStore('sent')
    ids.forEach((id) => store.put({ id }))
  })
}
