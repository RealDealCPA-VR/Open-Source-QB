-- Custom SQL migration file, put your code below! --

-- Backfill legacy deposit GL entries that were stamped with the
-- 'deposit:pending' placeholder before the fix that rewrites the
-- sourceRef to 'deposit:<id>' inside the posting transaction.
UPDATE "journal_entries"
SET "source_ref" = 'deposit:' || d."id"
FROM "deposits" d
WHERE "journal_entries"."id" = d."posted_entry_id"
  AND "journal_entries"."source_ref" = 'deposit:pending';
