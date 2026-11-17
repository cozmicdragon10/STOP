// Max Debt Override (routes/clientDebtLimits.js). The largest amount a Business Administrator can let a client owe and
// still attend; mirrors MAX_DEBT_LIMIT in frontend/src/utils/balance.ts.
const MAX_DEBT_LIMIT = 10000;

// Why the override can't be saved, or null. Dates are YYYY-MM-DD; today is the server's date.
const debtLimitProblem = ({ maxOwed, expirationDate, today, validDate = true }) => {
    const amount = Number(maxOwed);
    if (maxOwed === '' || maxOwed === null || maxOwed === undefined || !Number.isFinite(amount) || amount <= 0) {
        return 'Enter the most the client may owe, more than $0.00.';
    }
    if (amount > MAX_DEBT_LIMIT) return `The max debt can be up to $${MAX_DEBT_LIMIT.toFixed(2)}.`;
    if (!expirationDate || !validDate) return 'Enter the expiration date.';
    if (expirationDate < today) return 'The expiration date cannot be in the past.';
    return null;
};

module.exports = { MAX_DEBT_LIMIT, debtLimitProblem };
