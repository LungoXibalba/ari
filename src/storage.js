// Our own small interface to the phone's database (IndexedDB). The rest of the app only calls
// the functions exported here, so the database can be swapped later by changing this file alone.
//
// Two stores:
//  - 'cards': one record per card, found by its id.
//  - 'media': the photo or recording blob for a card, found by the same id. Kept apart so that
//    listing the inbox never loads large files.
//  - 'exports': for each card that has been exported (or imported), the `updated` time it had then.
//    A card counts as "new or changed" when it has no record here or its `updated` is later.

const DB_NAME = 'ari'
const DB_VERSION = 2

let opening

function openDatabase() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (event.oldVersion < 1) {
        db.createObjectStore('cards', { keyPath: 'id' })
        db.createObjectStore('media') // key is supplied when saving: the card id
      }
      if (event.oldVersion < 2) {
        db.createObjectStore('exports', { keyPath: 'id' }) // { id, updated }
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

export function saveCard(card) {
  return inTransaction('cards', 'readwrite', (tx) => tx.objectStore('cards').put(card))
}

export function getCard(id) {
  return inTransaction('cards', 'readonly', (tx) => tx.objectStore('cards').get(id))
}

// Save a card together with its photo or recording, all-or-nothing: either both are stored or neither.
export function saveCardWithMedia(card, blob) {
  return inTransaction(['cards', 'media'], 'readwrite', (tx) => {
    tx.objectStore('media').put(blob, card.id)
    return tx.objectStore('cards').put(card)
  })
}

// The photo or recording blob for a card (undefined if it has none).
export function getMedia(id) {
  return inTransaction('media', 'readonly', (tx) => tx.objectStore('media').get(id))
}

// Change fields on a card that is already saved (for example, attach a location that arrived later).
// Reads and writes inside one transaction, so two updates cannot overwrite each other.
export function updateCard(id, changes) {
  return inTransaction('cards', 'readwrite', (tx) => {
    const store = tx.objectStore('cards')
    const read = store.get(id)
    read.onsuccess = () => {
      if (!read.result) return // the card was deleted in the meantime
      store.put({ ...read.result, ...changes, updated: new Date().toISOString() })
    }
    return read
  })
}

// All cards, newest first.
export async function listCards() {
  const cards = await inTransaction('cards', 'readonly', (tx) => tx.objectStore('cards').getAll())
  return cards.sort((a, b) => b.created.localeCompare(a.created))
}

// Remove a card, its media and its export record together.
export function deleteCard(id) {
  return inTransaction(['cards', 'media', 'exports'], 'readwrite', (tx) => {
    tx.objectStore('media').delete(id)
    tx.objectStore('exports').delete(id)
    return tx.objectStore('cards').delete(id)
  })
}

// Export records as { [cardId]: updatedTimeWhenExported }.
export async function listExportRecords() {
  const records = await inTransaction('exports', 'readonly', (tx) => tx.objectStore('exports').getAll())
  return Object.fromEntries(records.map((record) => [record.id, record.updated]))
}

// Remember that these cards were exported (or imported) as they were at the given `updated` time.
// `records` is a list of { id, updated }.
export function markExported(records) {
  return inTransaction('exports', 'readwrite', (tx) => {
    const store = tx.objectStore('exports')
    records.forEach((record) => store.put(record))
  })
}
