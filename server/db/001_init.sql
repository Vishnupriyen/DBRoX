-- DBRoX schema v1.
-- Scale rules: every row is keyed by tenant_id (the distributor) first, so the database can be split
-- by distributor later (e.g. Citus distributed by tenant_id) without changing the app.
-- Standard PostgreSQL only, no vendor features.

CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'all',          -- single | triple | all
  status      text NOT NULL DEFAULT 'trial',        -- trial | active | grace | locked
  trial_ends  date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  tenant_id   text NOT NULL REFERENCES tenants(id),
  id          text NOT NULL,
  phone       text NOT NULL,
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','office','salesman','godown','delivery')),
  pin_hash    text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  token_epoch integer NOT NULL DEFAULT 0,           -- bump to log a phone out instantly
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
-- one phone number = one login across DBRoX
CREATE UNIQUE INDEX IF NOT EXISTS users_phone ON users (phone);

-- Every app record (shops, bills, payments …) as a versioned document.
-- version comes from one sequence so a phone can ask "everything newer than N".
CREATE SEQUENCE IF NOT EXISTS docs_version_seq;
CREATE TABLE IF NOT EXISTS docs (
  tenant_id   text NOT NULL,
  tbl         text NOT NULL,
  id          text NOT NULL,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL,
  version     bigint NOT NULL DEFAULT nextval('docs_version_seq'),
  PRIMARY KEY (tenant_id, tbl, id)
) PARTITION BY HASH (tenant_id);

DO $$
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS docs_p%s PARTITION OF docs FOR VALUES WITH (MODULUS 16, REMAINDER %s)', i, i);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS docs_pull ON docs (tenant_id, version);
-- reports read bills by date without scanning everything
CREATE INDEX IF NOT EXISTS docs_inv_date ON docs (tenant_id, (data->>'date')) WHERE tbl IN ('invoices','payments');

-- AI photo reading allowance per plan per month
CREATE TABLE IF NOT EXISTS scan_usage (
  tenant_id text NOT NULL,
  month     text NOT NULL,
  count     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month)
);

-- Support access only when the distributor allows it (24 h), every access logged
CREATE TABLE IF NOT EXISTS support_access (
  tenant_id   text NOT NULL,
  granted_by  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS access_log (
  at        timestamptz NOT NULL DEFAULT now(),
  tenant_id text NOT NULL,
  actor     text NOT NULL,
  action    text NOT NULL
);
CREATE INDEX IF NOT EXISTS access_log_t ON access_log (tenant_id, at);
