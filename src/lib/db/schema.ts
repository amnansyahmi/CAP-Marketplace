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

CREATE INDEX IF NOT EXISTS orders_payment_id_idx ON orders (payment_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
`;
