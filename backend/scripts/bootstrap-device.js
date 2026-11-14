// Creates an approved device and prints a one-time setup code. Run from the backend folder:
//   npm run devices:bootstrap -- "Justin's office PC"              the first device
//   npm run devices:bootstrap -- --recover "Justin's office PC"    when no approved device can get in any more
// Then open STOP in the browser on that device, choose "I have a setup code", and enter the code (valid 30 minutes).
// Without --recover it is refused once an approved device is in use; every other device asks for access in the app.
// If the code expires before it is used, run this again for a fresh one.
const { pool, databaseTarget, logAction } = require('../db');
const { createFirstDevice } = require('../lib/devices');

const args = process.argv.slice(2);
const recover = args.includes('--recover');
const name = args.filter(a => a !== '--recover').join(' ').trim();

(async () => {
    if (!name) {
        console.error('Give the device a name, e.g. npm run devices:bootstrap -- "Justin\'s office PC"');
        process.exitCode = 1;
        return;
    }
    console.log(`Database: ${databaseTarget.name} (APP_ENV ${databaseTarget.appEnv})`);
    try {
        const { code } = await createFirstDevice(name, { recover });
        if (recover) await logAction('server console', 'Device Recovery', `Recovery setup code issued for "${name}"`, 'Admin');
        console.log(`Approved device "${name}" created${recover ? ' (recovery)' : ''}.`);
        console.log(`Setup code (one use, valid 30 minutes): ${code}`);
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
