// Password hashing with Node's built-in scrypt (no extra packages).
// Stored format: scrypt$<salt hex>$<hash hex>
const crypto = require('crypto');

const KEY_LENGTH = 64;

const hashPassword = (password) => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(password, salt, KEY_LENGTH, (err, derived) => {
    if (err) return reject(err);
    resolve(`scrypt$${salt.toString('hex')}$${derived.toString('hex')}`);
  });
});

const verifyPassword = (password, stored) => new Promise((resolve, reject) => {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  crypto.scrypt(password, salt, expected.length, (err, derived) => {
    if (err) return reject(err);
    resolve(crypto.timingSafeEqual(derived, expected));
  });
});

module.exports = { hashPassword, verifyPassword };
