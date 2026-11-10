-- Company reports at scale: a big brand's bills (hundreds of thousands a day) stay on the server; the totals the screens
-- need are kept up to date here as each bill arrives (old version out, new version in — never recounted from scratch).
CREATE TABLE IF NOT EXISTS roll_daily (       -- per distributor, day and product: pieces and value sold to shops
  tenant_id text NOT NULL, link_id text NOT NULL, day date NOT NULL, product_id text NOT NULL,
  qty numeric NOT NULL DEFAULT 0, value numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, link_id, day, product_id)
);
CREATE INDEX IF NOT EXISTS roll_daily_day ON roll_daily (tenant_id, day);
CREATE TABLE IF NOT EXISTS roll_link_month (  -- per distributor and month: value and number of bills
  tenant_id text NOT NULL, link_id text NOT NULL, month text NOT NULL,
  value numeric NOT NULL DEFAULT 0, returns numeric NOT NULL DEFAULT 0, bills integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, link_id, month)
);
CREATE TABLE IF NOT EXISTS roll_shop_month (  -- which shops bought, per distributor and month (shops reached)
  tenant_id text NOT NULL, link_id text NOT NULL, month text NOT NULL, shop_id text NOT NULL, value numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, link_id, month, shop_id)
);
