import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Same self-signed certificate the backend uses, so the frontend is served over HTTPS too.
// The password is read from backend/.env so it is kept in one place.
const certPath = new URL('../backend/certs/stop-server.pfx', import.meta.url)
const envText = fs.readFileSync(new URL('../backend/.env', import.meta.url), 'utf8')
const pfxPassword = envText.match(/^SSL_PFX_PASSWORD=(.*)$/m)?.[1]?.trim() ?? ''
const https = { pfx: fs.readFileSync(certPath), passphrase: pfxPassword }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { host: true, https },
  preview: { host: true, https },
})
