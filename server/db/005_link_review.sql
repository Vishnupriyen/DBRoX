-- Independent review fixes (10 Nov 2026)
-- a distributor's own company record belongs to ONE company for ever (a left link can't be re-used by another brand)
CREATE UNIQUE INDEX IF NOT EXISTS links_db_record ON links (db_tenant, company_id_in_db);
-- a company bill is received on one phone only, even when two phones are offline
CREATE TABLE IF NOT EXISTS receipt_claims (
  tenant_id  text NOT NULL,
  inbound_id text NOT NULL,
  user_id    text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, inbound_id)
);
