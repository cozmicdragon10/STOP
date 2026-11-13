// Which database this server uses, from the environment (backend/.env, or variables set in the shell):
//   APP_ENV=dev         the developer copy, DEV_DATABASE_URL (stop_dev). `npm start` sets this for local runs.
//   APP_ENV unset, or production
//                       the live database, DATABASE_URL (stop_db). The deployed server (deploy/run-server.ps1) runs
//                       without APP_ENV, so it always gets the live database.
// A bad setting stops the server at startup rather than quietly using the wrong database.
const ENVIRONMENTS = ['production', 'dev'];

const databaseNameOf = (url) => {
    if (!url) return null;
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
};

const chooseDatabase = (env = process.env) => {
    const appEnv = (env.APP_ENV || 'production').trim().toLowerCase();
    if (!ENVIRONMENTS.includes(appEnv)) {
        throw new Error(`APP_ENV must be "production" or "dev", not "${env.APP_ENV}".`);
    }
    const liveUrl = env.DATABASE_URL;
    if (appEnv === 'production') {
        return { appEnv, url: liveUrl, liveUrl, name: databaseNameOf(liveUrl) };
    }
    if (!env.DEV_DATABASE_URL) {
        throw new Error('APP_ENV=dev needs DEV_DATABASE_URL in backend/.env (the stop_dev database).');
    }
    const name = databaseNameOf(env.DEV_DATABASE_URL);
    if (name === databaseNameOf(liveUrl)) {
        throw new Error(`DEV_DATABASE_URL must not point at the live database (${name}).`);
    }
    return { appEnv, url: env.DEV_DATABASE_URL, liveUrl, name };
};

module.exports = { chooseDatabase, databaseNameOf };
