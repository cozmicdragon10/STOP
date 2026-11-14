// Creates the first approved device and prints a one-time setup code. Run this once from the backend folder:
//   npm run devices:bootstrap -- "Justin's office PC"
// Then open STOP in the browser on that device, choose "I have a setup code", and enter the code (valid 30 minutes).
// Refused once an approved device is in use; every other device asks for access in the app. If the code expired before
// it was used, run this again for a fresh one.
const { pool, databaseTarget } = require('../db');
const { createFirstDevice } = require('../lib/devices');

const name = process.argv.slice(2).join(' ').trim();

(async () => {
    if (!name) {
        console.error('Give the device a name, e.g. npm run devices:bootstrap -- "Justin\'s office PC"');
        process.exitCode = 1;
        return;
    }
    console.log(`Database: ${databaseTarget.name} (APP_ENV ${databaseTarget.appEnv})`);
    try {
        const { code } = await createFirstDevice(name);
        console.log(`Approved device "${name}" created.`);
        console.log(`Setup code (one use, valid 30 minutes): ${code}`);
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
