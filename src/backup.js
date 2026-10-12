// The "Back up and transfer" section: export the history of changes in batches through the share sheet, and
// import files from the other devices. Export is two steps on purpose: "Export" prepares the files, then each batch has its own Share button,
// because iOS only allows sharing right after a tap and preparing photos can take a while.

import { countUnsent, prepareExport, shareBatch, shortId } from './export.js'
import { formatBytes } from './format.js'
import { importFiles } from './import.js'
import { getDeviceId, markSent } from './storage.js'

// `refreshInbox` redraws the inbox after an import.
export function mountBackup(parent, { refreshInbox }) {
  parent.innerHTML = `
    <section class="backup">
      <h2>Back up and transfer</h2>
      <p id="backup-summary"></p>
      <p id="backup-device" class="where"></p>
      <button id="export-changed">Export new changes</button>
      <button id="export-all">Export all</button>
      <ul id="batches"></ul>
      <button id="import">Import files</button>
      <input id="import-input" type="file" multiple hidden />
      <p id="backup-message" role="status"></p>
    </section>
  `
  const summary = parent.querySelector('#backup-summary')
  getDeviceId().then((id) => {
    parent.querySelector('#backup-device').textContent = `This device: ${shortId(id)} (named in the files it exports)`
  })
  const batchList = parent.querySelector('#batches')
  const message = parent.querySelector('#backup-message')
  const importInput = parent.querySelector('#import-input')

  async function refreshSummary() {
    try {
      const { unsent, total } = await countUnsent()
      summary.textContent = `${unsent} of ${total} recorded changes have not been exported yet.`
    } catch {
      summary.textContent = ''
    }
  }
  refreshSummary()
  addEventListener('captures-changed', refreshSummary) // sent by the inbox whenever the captures change

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
      message.textContent = onlyChanged ? 'No new changes to export.' : 'Nothing to export.'
      return
    }
    const recordTotal = batches.reduce((total, batch) => total + batch.records.length, 0)
    message.textContent = `${recordTotal} change(s) in ${batches.length} batch(es). Tap Share on each batch and choose where to save it (for example Save to Files, then OneDrive).`

    batches.forEach((batch, index) => {
      const item = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = `Batch ${index + 1} of ${batches.length}: ${batch.records.length} change(s), ${batch.files.length} file(s), ${formatBytes(batch.bytes)} `
      const share = document.createElement('button')
      share.className = 'small'
      share.textContent = 'Share'
      share.onclick = async () => {
        share.disabled = true
        try {
          const result = await shareBatch(batch)
          if (result === 'shared') {
            // Marked only now, after the share sheet reported success. A cancelled or failed share marks nothing.
            await markSent(batch.records.map((record) => record.id))
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
      const summaryLine = `${report.applied} new change(s) applied, ${report.known} already known.`
      const extras = [
        report.files ? `${report.files} photo/recording file(s) stored.` : '',
        report.waiting ? `${report.waiting} capture(s) have changes but the capture itself has not arrived yet; import its file too.` : '',
        report.snapshots ? `${report.snapshots} snapshot file(s) ignored.` : '',
      ].filter(Boolean)
      const lines = [summaryLine, ...extras, ...report.problems]
      message.textContent = lines.join('\n')
      await refreshInbox()
    } catch (error) {
      message.textContent = `Import failed: ${error.name}: ${error.message}`
    }
  }
}
