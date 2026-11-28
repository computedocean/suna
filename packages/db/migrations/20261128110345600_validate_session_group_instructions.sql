-- Validate separately: adding instructions held ACCESS EXCLUSIVE until commit.
-- Every pre-existing row has a NULL instructions, so the scan finds no violation.
set lock_timeout = '2s';
set statement_timeout = '30min';
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE kortix.project_session_groups VALIDATE CONSTRAINT project_session_groups_instructions_check;
