import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies any request starting with /api to the Hono backend on
// :3000. So the React code always fetches same-origin "/api/..." — it never
// knows (or needs) the backend's port, and there's no CORS to configure. In a
// real deploy the same path is served by the backend directly.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
