// The "Back up and transfer" section: export in batches through the share sheet, and import files.
// Export is two steps on purpose: "Export" prepares the files, then each batch has its own Share button,
// because iOS only allows sharing right after a tap and preparing photos can take a while.

import { countChanged, prepareExport, shareBatch } from './export.js'
import { importFiles } from './import.js'
import { markExported } from './storage.js'

function megabytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// `refreshInbox` redraws the inbox after an import.
export function mountBackup(parent, { refreshInbox }) {
  parent.innerHTML = `
    <section class="backup">
      <h2>Back up and transfer</h2>
      <p id="backup-summary"></p>
      <button id="export-changed">Export new and changed</button>
      <button id="export-all">Export all</button>
      <ul id="batches"></ul>
      <button id="import">Import files</button>
      <input id="import-input" type="file" multiple hidden />
      <p id="backup-message" role="status"></p>
    </section>
  `
  const summary = parent.querySelector('#backup-summary')
  const batchList = parent.querySelector('#batches')
  const message = parent.querySelector('#backup-message')
  const importInput = parent.querySelector('#import-input')

  async function refreshSummary() {
    try {
      const { changed, total } = await countChanged()
      summary.textContent = `${changed} of ${total} cards are new or changed since they were last exported.`
    } catch {
      summary.textContent = ''
    }
  }
  refreshSummary()
  addEventListener('cards-changed', refreshSummary) // sent by the inbox whenever the cards change

  async function startExport({ onlyChanged }) {
    batchList.replaceChildren()
    message.textContent = 'Preparing files...'
    let batches
    try {
      batches = await prepareExport({ onlyChanged })
    } catch (error) {
      message.textContent = `Could not prepare the export: ${error.name}`
      return
    }
    if (!batches.length) {
      message.textContent = onlyChanged ? 'Nothing new or changed to export.' : 'No cards to export.'
      return
    }
    const cardTotal = batches.reduce((total, batch) => total + batch.cards.length, 0)
    message.textContent = `${cardTotal} card(s) in ${batches.length} batch(es). Tap Share on each batch and choose where to save it (for example Save to Files, then OneDrive).`

    batches.forEach((batch, index) => {
      const item = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = `Batch ${index + 1} of ${batches.length}: ${batch.cards.length} card(s), ${batch.files.length} file(s), ${megabytes(batch.bytes)} `
      const share = document.createElement('button')
      share.className = 'small'
      share.textContent = 'Share'
      share.onclick = async () => {
        share.disabled = true
        try {
          const result = await shareBatch(batch)
          if (result === 'shared') {
            // Marked only now, after the share sheet reported success. A cancelled or failed share marks nothing.
            await markExported(batch.cards)
            label.textContent = `Batch ${index + 1} of ${batches.length}: shared. `
            share.remove()
            message.textContent = `Batch ${index + 1} shared and marked as exported.`
            refreshSummary()
            return
          }
          message.textContent =
            result === 'cancelled'
              ? 'Cancelled. Nothing was marked as exported.'
              : 'This browser cannot share files. Nothing was marked as exported.'
        } catch (error) {
          message.textContent = `Sharing failed (${error.name}: ${error.message}). Nothing was marked as exported.`
        }
        share.disabled = false
      }
      item.append(label, share)
      batchList.append(item)
    })
  }

  parent.querySelector('#export-changed').onclick = () => startExport({ onlyChanged: true })
  parent.querySelector('#export-all').onclick = () => startExport({ onlyChanged: false })

  parent.querySelector('#import').onclick = () => importInput.click()
  importInput.onchange = async () => {
    const files = [...importInput.files]
    importInput.value = ''
    if (!files.length) return
    message.textContent = `Importing ${files.length} file(s)...`
    try {
      const report = await importFiles(files)
      const lines = [`${report.imported} imported, ${report.updated} updated, ${report.skipped} skipped.`, ...report.problems]
      message.textContent = lines.join('\n')
      await refreshInbox()
    } catch (error) {
      message.textContent = `Import failed: ${error.name}: ${error.message}`
    }
  }
}
