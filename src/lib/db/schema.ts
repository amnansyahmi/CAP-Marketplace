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

-- Stock, one row per catalogue product.
--
-- "tracked" is false by default and opt-in per product. Turning stock on for a
-- shop that has never counted its jars would take every product off sale the
-- moment this table appeared; the owner switches it on once they know the
-- number.
--
-- "reserved" is stock held by orders that are placed but not yet paid. Available
-- stock is on_hand - reserved, so two people cannot both buy the last jar while
-- one of them is still on the payment page.
CREATE TABLE IF NOT EXISTS product_stock (
  product_id text PRIMARY KEY,
  tracked    boolean NOT NULL DEFAULT false,
  on_hand    integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved   integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Where an order stands with stock, so a reservation is released exactly once.
-- Without this, an order that failed and was then cancelled would give its
-- reservation back twice and invent inventory that does not exist.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_state text NOT NULL DEFAULT 'none';

-- Dropped and recreated rather than added-if-missing. The "EXCEPTION WHEN
-- duplicate_object" pattern used elsewhere silently keeps whatever constraint
-- already exists, so *widening* one never reaches a database that has been
-- running — which is how 'returned' was rejected in a live shop while a
-- freshly created test database accepted it happily.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_stock_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_stock_state_check
  CHECK (stock_state IN ('none','reserved','committed','released','returned'));

-- Discount codes.
--
-- "value" means different things per kind: a fraction for 'percent' (0.1000 =
-- 10%) and ringgit for 'fixed'. Kept in one column rather than two nullable
-- ones so a code cannot be half of each.
CREATE TABLE IF NOT EXISTS discount_codes (
  id              uuid PRIMARY KEY,
  code            text NOT NULL UNIQUE CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 24),
  kind            text NOT NULL CHECK (kind IN ('percent','fixed')),
  value           numeric(10,4) NOT NULL CHECK (value > 0),
  -- Minimum goods subtotal before the code applies at all.
  min_subtotal    numeric(10,2) NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  -- NULL means unlimited. The counter is incremented atomically, so the limit
  -- cannot be beaten by two people redeeming at the same moment.
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redeemed        integer NOT NULL DEFAULT 0 CHECK (redeemed >= 0),
  starts_at       timestamptz,
  expires_at      timestamptz,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Snapshotted onto the order like commission is: editing a code later must not
-- rewrite what an old order was actually charged.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) CHECK (discount_amount >= 0);
-- Whether this order has already given its redemption back, so a failed and
-- then cancelled order cannot free up two.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_released boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS orders_discount_code_idx ON orders (discount_code);

-- Refunds are orthogonal to payment, like fulfilment is.
--
-- The order was paid — that happened, and rewriting the status to hide it would
-- lose the fact. A refund is a second, later event recorded alongside it, so
-- revenue is "paid minus refunded" rather than a status that has to be
-- reinterpreted everywhere a sale is counted.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2) CHECK (refund_amount >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason text;

-- One row per message we have decided to send about an order.
--
-- The primary key is the claim: a sender inserts before sending, and a second
-- attempt for the same (order, kind) hits the conflict and does nothing. That
-- is what stops a retried payment webhook sending two confirmations, and it
-- holds across restarts and across instances in a way an in-memory guard
-- could not.
CREATE TABLE IF NOT EXISTS order_notifications (
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  recipient  text NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  driver     text,
  error      text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  PRIMARY KEY (order_id, kind)
);

CREATE INDEX IF NOT EXISTS order_notifications_status_idx ON order_notifications (status);

-- Affiliates sign in to their own portal. Nullable because an affiliate exists
-- before anyone gives them a password: until one is set they simply cannot sign
-- in, which is the safe direction.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS password_salt text;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

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
