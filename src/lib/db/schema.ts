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

CREATE INDEX IF NOT EXISTS orders_payment_id_idx ON orders (payment_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_fulfilment_idx ON orders (fulfilment);
CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (lower(customer_email));
`;
