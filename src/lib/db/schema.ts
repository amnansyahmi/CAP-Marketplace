/**
 * Order schema.
 *
 * Idempotent so it can run on every cold start. That is fine at this size, but
 * once the shop is live and the shape changes, move to real versioned
 * migrations — `IF NOT EXISTS` will not alter an existing table.
 *
 * Money is `numeric(10,2)`: exact decimal in the database, never binary float.
 * Postgres returns it as a string, which `rowToOrder` parses back — see the
 * note there.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orders (
  id                 uuid PRIMARY KEY,
  reference          text NOT NULL UNIQUE,
  status             text NOT NULL CHECK (status IN ('pending_payment','paid','failed','cancelled')),

  customer_full_name text NOT NULL,
  customer_email     text NOT NULL,
  customer_phone     text NOT NULL,

  address_line1      text NOT NULL,
  address_line2      text,
  address_postcode   text NOT NULL,
  address_city       text NOT NULL,
  address_state      text NOT NULL,
  notes              text,

  subtotal           numeric(10,2) NOT NULL CHECK (subtotal >= 0),
  shipping           numeric(10,2) NOT NULL CHECK (shipping >= 0),
  total              numeric(10,2) NOT NULL CHECK (total >= 0),
  currency           text NOT NULL DEFAULT 'MYR',

  -- Unique so a gateway callback can never be applied to two orders.
  payment_id         text UNIQUE,
  payment_url        text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  name        text NOT NULL,
  unit_price  numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity    integer NOT NULL CHECK (quantity > 0),
  line_total  numeric(10,2) NOT NULL CHECK (line_total >= 0),
  position    integer NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- Fulfilment is tracked separately from payment: they are orthogonal. An order
-- is paid or not; a paid order then moves through packing and shipping. Folding
-- both into one column would make "paid and shipped" unrepresentable.
-- Added with IF NOT EXISTS so databases created before this existed pick it up
-- without a migration step. Real migrations are still needed before the shape
-- of a live table changes — see the note at the top of this file.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilment text NOT NULL DEFAULT 'unfulfilled';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilment_updated_at timestamptz;

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_fulfilment_check
    CHECK (fulfilment IN ('unfulfilled','packed','shipped','delivered'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS affiliates (
  id              uuid PRIMARY KEY,
  -- What goes in ?ref=. Stored uppercase so lookups are unambiguous.
  code            text NOT NULL UNIQUE CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 24),
  name            text NOT NULL,
  email           text NOT NULL,
  phone           text,
  -- Fraction, e.g. 0.1000 = 10%. Four decimal places allows 12.5% and similar.
  commission_rate numeric(5,4) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 1),
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Attribution is snapshotted onto the order rather than joined at read time.
-- commission_rate in particular must be frozen: changing an affiliate's rate
-- later must not silently rewrite what they already earned.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES affiliates(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate numeric(5,4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_amount numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_status text NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_paid_at timestamptz;

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_commission_status_check
    CHECK (commission_status IN ('none','pending','paid','void'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Agent fee, snapshotted like affiliate commission and for the same reason:
-- renegotiating the fee must not rewrite what was already earned.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS agent_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS agent_fee numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS agent_fee_status text NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS agent_fee_paid_at timestamptz;

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_agent_fee_status_check
    CHECK (agent_fee_status IN ('none','pending','paid','void'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS orders_agent_fee_status_idx ON orders (agent_fee_status);
CREATE INDEX IF NOT EXISTS orders_affiliate_idx ON orders (affiliate_id);
CREATE INDEX IF NOT EXISTS orders_commission_status_idx ON orders (commission_status);
CREATE INDEX IF NOT EXISTS orders_payment_id_idx ON orders (payment_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_fulfilment_idx ON orders (fulfilment);
CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (lower(customer_email));
`;
