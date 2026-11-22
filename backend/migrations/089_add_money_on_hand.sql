-- Money on Hand (lib/moneyOnHand.js): who holds the cash and checks waiting to go to the bank, hand-offs between
-- employees, and bank deposits.
--
-- An item of money is a closed group session's cash and checks ('g:<GroupId>:<YYYY-MM-DD>:<SessionNumber>') or one cash
-- or check payment taken outside a group ('p:<TransactionId>'). It starts with the employee responsible for it
-- (lib/cashResponsibility.js) and moves to someone else only when they accept a hand-off.

-- One hand-off from one employee to another. It moves its items only once the receiver accepts it.
CREATE TABLE IF NOT EXISTS CashHandoffs (
    HandoffId SERIAL PRIMARY KEY,
    FromEmployee VARCHAR(255) NOT NULL,
    ToEmployee VARCHAR(255) NOT NULL,
    Total NUMERIC(10, 2) NOT NULL,
    Notes TEXT,
    -- Who entered it: the giver, or a Business Administrator handing it off for them
    CreatedBy VARCHAR(255) NOT NULL,
    CreatedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (Status IN ('Pending', 'Accepted', 'Declined', 'Cancelled')),
    ResolvedBy VARCHAR(255),
    ResolvedOn TIMESTAMP
);

-- The items on a hand-off, with the amount and description each had when it was handed off
CREATE TABLE IF NOT EXISTS CashHandoffItems (
    HandoffId INT NOT NULL REFERENCES CashHandoffs(HandoffId) ON DELETE CASCADE,
    ItemKey VARCHAR(100) NOT NULL,
    Amount NUMERIC(10, 2) NOT NULL,
    Label VARCHAR(255),
    PRIMARY KEY (HandoffId, ItemKey)
);
CREATE INDEX IF NOT EXISTS idx_cashhandoffitems_itemkey ON CashHandoffItems (ItemKey);

-- One trip to the bank: the slip number, the total dropped off, and later the amount the bank credited, entered by a
-- Business Administrator. Voided deposits are kept for the record; their items go back to whoever held them.
CREATE TABLE IF NOT EXISTS BankDeposits (
    BankDepositId SERIAL PRIMARY KEY,
    DepositDate DATE NOT NULL,
    SlipNumber VARCHAR(100),
    Total NUMERIC(10, 2) NOT NULL,
    DroppedOffBy VARCHAR(255) NOT NULL,
    RecordedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    BankAmount NUMERIC(10, 2),
    VerifiedBy VARCHAR(255),
    VerifiedOn TIMESTAMP,
    VerifyNotes TEXT,
    VoidedBy VARCHAR(255),
    VoidedOn TIMESTAMP,
    VoidReason TEXT
);

-- What went in each bank deposit, as it was dropped off. Kept when the deposit is voided, so its record stays whole.
CREATE TABLE IF NOT EXISTS BankDepositItems (
    BankDepositId INT NOT NULL REFERENCES BankDeposits(BankDepositId) ON DELETE CASCADE,
    ItemKey VARCHAR(100) NOT NULL,
    Amount NUMERIC(10, 2) NOT NULL,
    Label VARCHAR(255),
    -- Collected by (the employee first responsible for it) and held by when it was dropped off
    Collector VARCHAR(255),
    PRIMARY KEY (BankDepositId, ItemKey)
);
CREATE INDEX IF NOT EXISTS idx_bankdeposititems_itemkey ON BankDepositItems (ItemKey);

-- The deposit row that marks an item as at the bank (GroupDeposits, CashPaymentDeposits) points at its bank deposit.
-- It is deleted when the deposit is voided, so the item shows as held again. Older check-offs (before Money on Hand) have none.
ALTER TABLE GroupDeposits ADD COLUMN IF NOT EXISTS BankDepositId INT REFERENCES BankDeposits(BankDepositId);
ALTER TABLE CashPaymentDeposits ADD COLUMN IF NOT EXISTS BankDepositId INT REFERENCES BankDeposits(BankDepositId);
CREATE INDEX IF NOT EXISTS idx_groupdeposits_bankdeposit ON GroupDeposits (BankDepositId);
CREATE INDEX IF NOT EXISTS idx_cashpaymentdeposits_bankdeposit ON CashPaymentDeposits (BankDepositId);
