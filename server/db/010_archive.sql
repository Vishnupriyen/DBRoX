-- Old records leave the live table (which every sync and report reads) and are kept here, compressed, a month at a time.
-- Nothing is ever thrown away: GST law asks a business to keep its bills for years, and a new phone can still fetch them.
CREATE TABLE IF NOT EXISTS docs_archive (
  tenant_id text NOT NULL, tbl text NOT NULL, month text NOT NULL, part integer NOT NULL,
  n integer NOT NULL, bytes integer NOT NULL, data bytea NOT NULL,   -- gzip of a JSON list of {id, updatedAt, data}
  at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, tbl, month, part)
);
-- which month bundle holds each record (a claim check or a late edit finds one old bill without opening every bundle)
CREATE TABLE IF NOT EXISTS docs_archive_ids (
  tenant_id text NOT NULL, tbl text NOT NULL, id text NOT NULL, month text NOT NULL, part integer NOT NULL,
  PRIMARY KEY (tenant_id, tbl, id)
);
