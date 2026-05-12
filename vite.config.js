import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' maakt asset-URLs relatief, zodat de bundle werkt onder
// elk pad (lokaal /, GitHub Pages /<repo>/, custom domain /, etc.)
// zonder dat we hier de repo-naam hard hoeven te coderen.
export default defineConfig({
  base: './',
  plugins: [react()],
})
