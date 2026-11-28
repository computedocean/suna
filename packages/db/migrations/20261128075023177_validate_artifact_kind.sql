-- Validate separately: adding kind held ACCESS EXCLUSIVE until commit.
-- Every pre-existing row has a NULL kind, so the scan finds no violation.
set lock_timeout = '2s';
set statement_timeout = '30min';
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE kortix.artifacts VALIDATE CONSTRAINT artifacts_kind_check;
