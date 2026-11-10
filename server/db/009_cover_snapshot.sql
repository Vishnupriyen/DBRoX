-- Head-office stock and product reports for a giant brand (5,000 distributors × 2,000 products) are answered from ready
-- figures, never by loading millions of rows into the server (the stress test crashed it doing that).
CREATE TABLE IF NOT EXISTS roll_product_month (    -- per product and month, all distributors: kept as bills arrive
  tenant_id text NOT NULL, month text NOT NULL, product_id text NOT NULL, qty numeric NOT NULL DEFAULT 0, value numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month, product_id)
);
-- each stock row carries its own ready figures: sold per day (last 30 days), days of stock, the distributor's norm, status, value
ALTER TABLE link_stock ADD COLUMN IF NOT EXISTS per numeric, ADD COLUMN IF NOT EXISTS days integer, ADD COLUMN IF NOT EXISTS norm numeric,
  ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS value numeric;
CREATE INDEX IF NOT EXISTS link_stock_exceptions ON link_stock (tenant_id, status, days) WHERE status IN ('low', 'high');
-- one product's sales at one distributor are looked up directly (product before day)
ALTER TABLE roll_daily DROP CONSTRAINT IF EXISTS roll_daily_pkey;
ALTER TABLE roll_daily ADD PRIMARY KEY (tenant_id, link_id, product_id, day);
CREATE TABLE IF NOT EXISTS cover_link (            -- per distributor: stock value and how many products are low / too much
  tenant_id text NOT NULL, link_id text NOT NULL, value numeric NOT NULL DEFAULT 0, low integer NOT NULL DEFAULT 0, high integer NOT NULL DEFAULT 0,
  ok integer NOT NULL DEFAULT 0, none integer NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, link_id)
);
-- which distributor's products changed since their figures were made (only those are remade). Add-only, no unique key:
-- the relay never waits on a mark the remake job is clearing (repeats are merged when remade). Unlogged (fast): marks lost
-- in a database crash are covered by the daily full remake
CREATE UNLOGGED TABLE IF NOT EXISTS cover_dirty (tenant_id text NOT NULL, link_id text NOT NULL, product_id text NOT NULL);
CREATE INDEX IF NOT EXISTS cover_dirty_tenant ON cover_dirty (tenant_id);
-- when every row was last remade (daily: "sold per day" moves with the date)
CREATE TABLE IF NOT EXISTS cover_state (tenant_id text PRIMARY KEY, at timestamptz NOT NULL);
