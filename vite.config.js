import { defineConfig } from 'vite'

// GitHub Pages serves this site at https://<user>.github.io/ari/, so every
// built file URL must start with /ari/. Must match the repository name.
export default defineConfig({
  base: '/ari/',
})
