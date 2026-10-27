-- Cash payments taken outside a group session (account payments, assessments, individual sessions) checked off as
-- dropped off at the bank, one row per payment. The employee who entered the payment holds the cash until then.
CREATE TABLE IF NOT EXISTS CashPaymentDeposits (
    TransactionId INT PRIMARY KEY,
    DepositDate DATE NOT NULL,
    RecordedBy VARCHAR(255),
    RecordedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
