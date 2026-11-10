-- The relay runs in the background: a sync only notes what changed (fast), a worker hands it to the other side in
-- large batches. A brand's price list reaching thousands of distributors never holds up anyone's phone.
CREATE TABLE IF NOT EXISTS relay_queue (
  id        bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  kind      text NOT NULL,
  tbl       text NOT NULL,
  doc_id    text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  tries     integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS relay_queue_order ON relay_queue (id);
