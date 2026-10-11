import './style.css'
import { mountInbox } from './inbox.js'
import { mountStatus } from './status.js'

document.querySelector('#app').innerHTML = `
  <main>
    <h1>ARI</h1>
    <div id="inbox"></div>
    <footer id="status"></footer>
  </main>
`

mountInbox(document.querySelector('#inbox'))
mountStatus(document.querySelector('#status'))
