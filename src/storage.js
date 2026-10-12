// Our own small interface to the phone's database (IndexedDB). The rest of the app only calls
// the functions exported here, so the database can be swapped later by changing this file alone.
//
// Three stores:
//  - 'captures': one record per capture, found by its id.
//  - 'media': the photo or recording blob for a capture, found by the same id. Kept apart so that
//    listing the inbox never loads large files.
//  - 'exports': for each capture that has been exported (or imported), the `updated` time it had then.
//    A capture counts as "new or changed" when it has no record here or its `updated` is later.
//
// Nothing is ever deleted here: "deleting" a capture moves it to the trash (a `deleted` time), and it can be restored.

import { upgradeCapture } from './captures.js'

const DB_NAME = 'ari'
const DB_VERSION = 3 // 1: cards + media. 2: + exports. 3: the 'cards' store became 'captures' (see below).

let opening

function openDatabase() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (event.oldVersion === 0) {
        // A new database: create the current layout straight away.
        db.createObjectStore('captures', { keyPath: 'id' })
        db.createObjectStore('media') // key is supplied when saving: the capture id
        db.createObjectStore('exports', { keyPath: 'id' }) // { id, updated }
        return
      }
      if (event.oldVersion < 2) {
        db.createObjectStore('exports', { keyPath: 'id' })
      }
      if (event.oldVersion < 3) {
        // An object store cannot be renamed, so copy every record into a new one (bringing it up to the
        // current schema on the way), then remove the old one. All of this happens inside the upgrade's own
        // transaction: if anything fails, the whole upgrade is undone and the old data stays as it was.
        const captures = db.createObjectStore('captures', { keyPath: 'id' })
        request.transaction.objectStore('cards').openCursor().onsuccess = (cursorEvent) => {
          const cursor = cursorEvent.target.result
          if (cursor) {
            captures.put(upgradeCapture(cursor.value))
            cursor.continue()
          } else {
            db.deleteObjectStore('cards')
          }
        }
      }
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
// `work` receives the transaction and may return an IndexedDB request whose result we pass back.
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

export function saveCapture(capture) {
  return inTransaction('captures', 'readwrite', (tx) => tx.objectStore('captures').put(capture))
}

export function getCapture(id) {
  return inTransaction('captures', 'readonly', (tx) => tx.objectStore('captures').get(id))
}

// Save a capture together with its photo or recording, all-or-nothing: either both are stored or neither.
export function saveCaptureWithMedia(capture, blob) {
  return inTransaction(['captures', 'media'], 'readwrite', (tx) => {
    tx.objectStore('media').put(blob, capture.id)
    return tx.objectStore('captures').put(capture)
  })
}

// The photo or recording blob for a capture (undefined if it has none).
export function getMedia(id) {
  return inTransaction('media', 'readonly', (tx) => tx.objectStore('media').get(id))
}

// Change fields on a capture that is already saved (for example, attach a location that arrived later).
// Reads and writes inside one transaction, so two updates cannot overwrite each other.
export function updateCapture(id, changes) {
  return inTransaction('captures', 'readwrite', (tx) => {
    const store = tx.objectStore('captures')
    const read = store.get(id)
    read.onsuccess = () => {
      if (!read.result) return // the capture is gone
      store.put({ ...read.result, ...changes, updated: new Date().toISOString() })
    }
    return read
  })
}

// Captures, newest first. `which` is 'active' (the inbox), 'trashed', or 'all' (what export needs).
export async function listCaptures(which = 'active') {
  const all = await inTransaction('captures', 'readonly', (tx) => tx.objectStore('captures').getAll())
  const chosen = which === 'all' ? all : all.filter((capture) => (capture.deleted !== null) === (which === 'trashed'))
  return chosen.sort((a, b) => b.created.localeCompare(a.created))
}

// Move a capture to the trash, or take it back out. Counts as a change, so the next export carries it.
export function trashCapture(id) {
  return updateCapture(id, { deleted: new Date().toISOString() })
}

export function restoreCapture(id) {
  return updateCapture(id, { deleted: null })
}

// Export records as { [captureId]: updatedTimeWhenExported }.
export async function listExportRecords() {
  const records = await inTransaction('exports', 'readonly', (tx) => tx.objectStore('exports').getAll())
  return Object.fromEntries(records.map((record) => [record.id, record.updated]))
}

// Remember that these captures were exported (or imported) as they were at the given `updated` time.
// `records` is a list of { id, updated }.
export function markExported(records) {
  return inTransaction('exports', 'readwrite', (tx) => {
    const store = tx.objectStore('exports')
    records.forEach((record) => store.put(record))
  })
}
