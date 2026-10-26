const https = require('https');
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { runMigrations } = require('./migrate');
const app = require('./app');

const PORT = process.env.PORT || 5000;
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
  })
  .catch(err => {
    console.error('Could not start the server:', err.message);
    process.exit(1);
  });
