-- Server-issued number series per distributor (bills, credit notes, receipts) and
-- one phone allowed under several distributors (salesman serving two DBs).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prefix text NOT NULL DEFAULT 'DBX';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS next_bill_no integer NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS next_cn_no integer NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS next_receipt_no integer NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS users_phone;
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_phone ON users (tenant_id, phone);
CREATE INDEX IF NOT EXISTS users_phone_lookup ON users (phone);
