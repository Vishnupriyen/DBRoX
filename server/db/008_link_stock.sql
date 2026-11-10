-- Stock at distributors, for brands: one compact row per distributor and product (not one stored record each).
-- At 100,000 distributors that is the difference between ~1 billion JSON records and a plain indexed table.
CREATE TABLE IF NOT EXISTS link_stock (
  tenant_id text NOT NULL, link_id text NOT NULL, product_id text NOT NULL,
  name text, qty numeric NOT NULL DEFAULT 0, near_expiry numeric NOT NULL DEFAULT 0, expired numeric NOT NULL DEFAULT 0,
  as_of date, PRIMARY KEY (tenant_id, link_id, product_id)
);
