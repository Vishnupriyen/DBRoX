-- Security standard (13 Nov 2026): the activity log, a limited database role, DPDP records, job runs.
-- Only adds (the rollback rule): new tables, new columns with defaults, functions, triggers, grants.

-- ---------------------------------------------------------------- the activity log (who / what / when)
-- Append-only and tamper-evident: hash = sha256(prev_hash || the row). Rows are added ONLY through seclog_add() (one at a
-- time, under a lock, so the chain is in id order); updates and deletes are refused by triggers and by privileges.
-- Partitioned by month: months older than 12 are exported (security_log_archive, kept 5 years) and then dropped whole.
-- No personal data in it: the actor is an opaque user id, a phone number never appears (a keyed hash at most), no PINs,
-- tokens or document bodies — so an erasure never has to rewrite the chain.
CREATE SEQUENCE IF NOT EXISTS security_log_id;
CREATE TABLE IF NOT EXISTS security_log (
  id         bigint NOT NULL,
  at         timestamptz NOT NULL,
  tenant_id  text,
  actor      text,
  actor_role text,
  event      text NOT NULL,
  target     text,
  ip         text,
  ok         boolean NOT NULL DEFAULT true,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash  bytea NOT NULL,
  hash       bytea NOT NULL,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE INDEX IF NOT EXISTS security_log_tenant ON security_log (tenant_id, at);
CREATE INDEX IF NOT EXISTS security_log_event ON security_log (event, at);

-- a month taken out of the live log: the gzip of its rows (JSON lines), checked before the month is dropped
CREATE TABLE IF NOT EXISTS security_log_archive (
  month     text PRIMARY KEY,           -- YYYY-MM (UTC)
  rows      integer NOT NULL,
  first_id  bigint,
  last_id   bigint,
  last_hash bytea,
  sha256    bytea NOT NULL,
  data      bytea NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION seclog_hash(p_prev bytea, p_id bigint, p_at timestamptz, p_tenant text, p_actor text, p_role text,
  p_event text, p_target text, p_ip text, p_ok boolean, p_detail jsonb) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(p_prev || convert_to(concat_ws(chr(31), p_id::text,
    to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), COALESCE(p_tenant, '\N'), COALESCE(p_actor, '\N'),
    COALESCE(p_role, '\N'), p_event, COALESCE(p_target, '\N'), COALESCE(p_ip, '\N'), p_ok::text, p_detail::text), 'UTF8'))
$$;

-- the one way in: serial (advisory lock), makes this month's partition when needed, chains to the last row (or to the
-- last archived month, or to 32 zero bytes for the very first row). Runs as the owner (SECURITY DEFINER), so the app's
-- limited role needs no INSERT right on the table itself.
CREATE OR REPLACE FUNCTION seclog_add(p_tenant text, p_actor text, p_role text, p_event text, p_target text, p_ip text,
  p_ok boolean, p_detail jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz := clock_timestamp(); v_id bigint; v_prev bytea; v_m timestamptz; v_part text;
BEGIN
  PERFORM pg_advisory_xact_lock(727013);
  v_m := date_trunc('month', v_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_part := 'security_log_' || to_char(v_at AT TIME ZONE 'UTC', 'YYYYMM');
  IF to_regclass(v_part) IS NULL THEN
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF security_log FOR VALUES FROM (%L) TO (%L)', v_part, v_m, v_m + interval '1 month');
  END IF;
  SELECT hash INTO v_prev FROM security_log ORDER BY id DESC LIMIT 1;
  IF v_prev IS NULL THEN SELECT last_hash INTO v_prev FROM security_log_archive ORDER BY month DESC LIMIT 1; END IF;
  v_prev := COALESCE(v_prev, decode(repeat('00', 32), 'hex'));
  v_id := nextval('security_log_id');
  p_detail := COALESCE(p_detail, '{}'::jsonb); p_ok := COALESCE(p_ok, true);
  INSERT INTO security_log(id, at, tenant_id, actor, actor_role, event, target, ip, ok, detail, prev_hash, hash)
  VALUES (v_id, v_at, p_tenant, p_actor, p_role, p_event, p_target, p_ip, p_ok, p_detail, v_prev,
    seclog_hash(v_prev, v_id, v_at, p_tenant, p_actor, p_role, p_event, p_target, p_ip, p_ok, p_detail));
  RETURN v_id;
END $$;

-- walks the chain in id order; returns the id of the first row that does not fit (NULL = the chain is whole)
CREATE OR REPLACE FUNCTION seclog_verify() RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r record; v_prev bytea; v_first boolean := true;
BEGIN
  FOR r IN SELECT * FROM security_log ORDER BY id LOOP
    IF v_first THEN
      v_first := false;
      SELECT last_hash INTO v_prev FROM security_log_archive ORDER BY month DESC LIMIT 1;
      v_prev := COALESCE(v_prev, decode(repeat('00', 32), 'hex'));
    END IF;
    IF r.prev_hash <> v_prev OR r.hash <> seclog_hash(r.prev_hash, r.id, r.at, r.tenant_id, r.actor, r.actor_role, r.event, r.target, r.ip, r.ok, r.detail) THEN
      RETURN r.id;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- second wall: no row is ever changed or removed, whoever asks (a whole old month is dropped only after its export)
CREATE OR REPLACE FUNCTION seclog_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'security_log is append-only'; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'security_log_frozen' AND tgrelid = 'security_log'::regclass) THEN
    CREATE TRIGGER security_log_frozen BEFORE UPDATE OR DELETE ON security_log FOR EACH ROW EXECUTE FUNCTION seclog_frozen();
  END IF;
END $$;

-- ---------------------------------------------------------------- logins
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login timestamptz;
-- 4 for staff; the owner and a brand's head office move to 6 digits (owner decision 13 Nov 2026: asked at the next login)
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_len integer NOT NULL DEFAULT 4;

-- ---------------------------------------------------------------- scheduled jobs: the last run of each (monitor.sh)
CREATE TABLE IF NOT EXISTS job_runs (
  job        text PRIMARY KEY,
  last_at    timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz,
  ok         boolean NOT NULL DEFAULT true,
  detail     jsonb
);

-- ---------------------------------------------------------------- DPDP Act 2023
-- every consent given or withdrawn (never overwritten: the latest row per person and kind is the answer)
CREATE TABLE IF NOT EXISTS consents (
  id        bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id   text NOT NULL,
  kind      text NOT NULL,            -- privacy | ai_scan | location | analytics | whatsapp
  version   text NOT NULL,
  granted   boolean NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  ip        text
);
CREATE INDEX IF NOT EXISTS consents_person ON consents (tenant_id, user_id, kind, at);
-- access / correction / erasure / nominee / grievance requests: answered within 30 days (our own target 15)
CREATE TABLE IF NOT EXISTS privacy_requests (
  id           text PRIMARY KEY,
  tenant_id    text,
  requester    text,                  -- a user id, or 'public' (the web form)
  contact      text,                  -- how to reply (public form only)
  kind         text NOT NULL,         -- access | correct | delete | delete_account | nominate | grievance | trial_expired
  subject_kind text,                  -- staff | shop | owner
  subject_id   text,
  note         text,
  status       text NOT NULL DEFAULT 'open',   -- open | done | refused
  due          date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  result       jsonb
);
CREATE INDEX IF NOT EXISTS privacy_requests_open ON privacy_requests (status, due);
CREATE TABLE IF NOT EXISTS nominees (
  tenant_id text NOT NULL,
  user_id   text NOT NULL,
  name      text NOT NULL,
  contact   text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
-- the breach register (docs/security/09-incident-response.md)
CREATE TABLE IF NOT EXISTS breaches (
  id                 bigserial PRIMARY KEY,
  found_at           timestamptz NOT NULL DEFAULT now(),
  summary            text NOT NULL,
  severity           text NOT NULL DEFAULT 'medium',   -- low | medium | high | critical
  tenants            text[] NOT NULL DEFAULT '{}',
  board_notified_at  timestamptz,
  people_notified_at timestamptz,
  closed_at          timestamptz,
  notes              jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS support_access_t ON support_access (tenant_id, expires_at);

-- ---------------------------------------------------------------- the limited database role
-- The server answers requests as hanubix_app (not the owner that runs migrations): it can read and write the business
-- tables, but cannot change the schema, and cannot change, remove or add activity-log rows except through seclog_add().
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hanubix_app') THEN CREATE ROLE hanubix_app NOLOGIN; END IF;
END $$;
CREATE OR REPLACE FUNCTION hanubix_grants() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA public TO hanubix_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hanubix_app';
  EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO hanubix_app';
  -- the log, its archive and the migration list: read only (ALL taken away, then SELECT given back)
  EXECUTE 'REVOKE ALL ON security_log, security_log_archive, schema_migrations FROM hanubix_app';
  EXECUTE 'GRANT SELECT ON security_log, security_log_archive, schema_migrations TO hanubix_app';
  EXECUTE 'REVOKE ALL ON SEQUENCE security_log_id FROM hanubix_app';
  FOR r IN SELECT inhrelid::regclass AS part FROM pg_inherits WHERE inhparent = 'security_log'::regclass LOOP
    EXECUTE format('REVOKE ALL ON %s FROM hanubix_app', r.part);
    EXECUTE format('GRANT SELECT ON %s TO hanubix_app', r.part);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION seclog_add(text, text, text, text, text, text, boolean, jsonb), seclog_verify() TO hanubix_app';
END $$;
SELECT hanubix_grants();
