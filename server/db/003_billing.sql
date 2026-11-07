-- Plans, payments and licences. Status is never typed by hand: it is worked out from these dates every time.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'medium';       -- starter | small | medium | big | enterprise
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pack text NOT NULL DEFAULT 'complete';     -- last_mile | office | complete
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid_until date;                           -- last day covered by a payment
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_pack text;                         -- a downgrade waits for the end of the paid month
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_tier text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rzp_subscription_id text;
CREATE INDEX IF NOT EXISTS tenants_rzp_sub ON tenants (rzp_subscription_id);

-- every Razorpay event once only (Razorpay may send the same event more than once)
CREATE TABLE IF NOT EXISTS payment_events (
  id          text PRIMARY KEY,
  tenant_id   text,
  event       text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  body        jsonb
);

-- distributors created before plans existed: 60-day trial from the day they signed up
UPDATE tenants SET trial_ends = created_at::date + 60 WHERE trial_ends IS NULL AND paid_until IS NULL;
