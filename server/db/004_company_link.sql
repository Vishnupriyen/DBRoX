-- Company module: a brand's head office is a tenant of kind 'company', linked to the distributors that accept its invite.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'distributor';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','office','salesman','godown','delivery','cadmin','manager','rep'));

-- one row per company ⇄ distributor link; the relay only moves data while status = 'linked'
CREATE TABLE IF NOT EXISTS links (
  id              text PRIMARY KEY,            -- the dbLinks record id in the company's data
  company_tenant  text NOT NULL REFERENCES tenants(id),
  db_tenant       text NOT NULL REFERENCES tenants(id),
  company_id_in_db text NOT NULL,              -- the distributor's own companies record for this company
  status          text NOT NULL DEFAULT 'linked' CHECK (status IN ('linked','paused','left')),
  linked_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_tenant, db_tenant)
);
CREATE INDEX IF NOT EXISTS links_company ON links (company_tenant) WHERE status = 'linked';
CREATE INDEX IF NOT EXISTS links_db ON links (db_tenant) WHERE status = 'linked';
-- invite codes are looked up across all companies
CREATE INDEX IF NOT EXISTS docs_invite ON docs ((data->>'inviteCode')) WHERE tbl = 'dbLinks';
-- the relay finds a distributor's product by the company's product id, and lots by product
CREATE INDEX IF NOT EXISTS docs_coprod ON docs (tenant_id, (data->>'companyProductId')) WHERE tbl = 'products';
CREATE INDEX IF NOT EXISTS docs_lot_prod ON docs (tenant_id, (data->>'productId')) WHERE tbl = 'batches';
