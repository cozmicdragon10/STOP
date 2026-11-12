const https = require('https');
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { runMigrations } = require('./migrate');
const app = require('./app');
const { startMonthlyRefills } = require('./lib/busPasses');

const { currentBuild, frontendApp, SITE } = require('./frontendServer');

const PORT = process.env.PORT || 5000;
const FRONTEND_PORT = process.env.FRONTEND_PORT || 5173;
// HTTPS using the self-signed certificate in backend/certs (see SSL_PFX_PASSWORD in .env)
const tlsOptions = {
  pfx: fs.readFileSync(path.join(__dirname, 'certs', 'stop-server.pfx')),
  passphrase: process.env.SSL_PFX_PASSWORD,
};

// Schema changes are applied before the server accepts requests; a failed migration stops startup
runMigrations(pool)
  .then(() => {
    console.log('Connected to PostgreSQL database successfully.');
    https.createServer(tlsOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`STOP Backend Server running on https://OKC-SERVER:${PORT}`);
    });
    // The built screens, on the address staff use (see frontendServer.js); skipped when there is no build
    const build = currentBuild();
    if (build) {
      https.createServer(tlsOptions, frontendApp(build))
        // A busy port (say, the Vite dev server left running on it) is logged; the API keeps running
        .on('error', err => console.error(`Could not serve the site on port ${FRONTEND_PORT}: ${err.message}`))
        .listen(FRONTEND_PORT, '0.0.0.0', () => {
          console.log(`STOP site running on https://OKC-SERVER:${FRONTEND_PORT} (from ${build})`);
        });
    } else {
      console.log(`No frontend build to serve (see ${SITE}); run deploy/update.ps1 to build one and serve the site on port ${FRONTEND_PORT}.`);
    }
    // Federal clients' monthly bus pass refill, at the start of each calendar month
    startMonthlyRefills(pool);
  })
  .catch(err => {
    console.error('Could not start the server:', err.message);
    process.exit(1);
  });
