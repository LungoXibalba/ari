import { defineConfig } from 'vite'

// GitHub Pages serves this site at https://<user>.github.io/ari/, so every
// built file URL must start with /ari/. Must match the repository name.
export default defineConfig({
  base: '/ari/',
  // The moment this build was made, shown on the page so you can tell which version a phone is running.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
})
