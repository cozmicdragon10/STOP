-- A case note a Counselor writes for a client who hasn't attended in the note's month waits for a Business
-- Administrator: ApprovalStatus is 'Pending' until it is 'Approved' or 'Denied'. NULL for notes that never needed
-- approval. Denied notes are kept for the record but no longer shown on the account.
ALTER TABLE Notes
    ADD COLUMN IF NOT EXISTS ApprovalStatus VARCHAR(20),
    ADD COLUMN IF NOT EXISTS ReviewedBy VARCHAR(255),
    ADD COLUMN IF NOT EXISTS ReviewedOn TIMESTAMP;
ALTER TABLE Notes DROP CONSTRAINT IF EXISTS notes_approvalstatus_check;
ALTER TABLE Notes ADD CONSTRAINT notes_approvalstatus_check CHECK (ApprovalStatus IN ('Pending', 'Approved', 'Denied'));
CREATE INDEX IF NOT EXISTS notes_pending_idx ON Notes (ApprovalStatus) WHERE ApprovalStatus = 'Pending';
