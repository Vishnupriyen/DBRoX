-- Pre-pilot safety (11 Nov 2026).
-- Wrong-PIN tries, sign-ups per place: kept here (every Cloud Run instance sees the same counts), never in memory.
CREATE TABLE IF NOT EXISTS rate_hits (
  key   text PRIMARY KEY,
  n     integer NOT NULL DEFAULT 0,
  since timestamptz NOT NULL DEFAULT now(),
  until timestamptz
);
-- every bill / credit-note number once per distributor, for ever (survives the archive)
CREATE TABLE IF NOT EXISTS doc_numbers (
  tenant_id text NOT NULL,
  tbl       text NOT NULL,
  number    text NOT NULL,
  doc_id    text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tbl, number)
);
INSERT INTO doc_numbers(tenant_id, tbl, number, doc_id)
  SELECT DISTINCT ON (tenant_id, tbl, data->>'number') tenant_id, tbl, data->>'number', id FROM docs
  WHERE tbl IN ('invoices', 'creditNotes') AND COALESCE(data->>'number', '') <> ''
  ORDER BY tenant_id, tbl, data->>'number', updated_at
ON CONFLICT DO NOTHING;
-- the relay worker claims rows (taken_at) and deletes them only after they were relayed
ALTER TABLE relay_queue ADD COLUMN IF NOT EXISTS taken_at timestamptz;
CREATE TABLE IF NOT EXISTS relay_failed (
  id        bigint PRIMARY KEY,
  tenant_id text NOT NULL,
  kind      text NOT NULL,
  tbl       text NOT NULL,
  doc_id    text NOT NULL,
  at        timestamptz NOT NULL,
  tries     integer NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  error     text
);
-- AI photo reads across all distributors in one day (a cost cap)
CREATE TABLE IF NOT EXISTS scan_daily (
  day   date PRIMARY KEY,
  count integer NOT NULL DEFAULT 0
);
