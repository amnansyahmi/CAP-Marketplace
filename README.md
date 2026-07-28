# Chef Ammar Marketplace

Storefront for the Chef Ammar cooking paste range — Kabsah, Mandy and Briyani —
built with Next.js App Router, TypeScript, Tailwind CSS v4 and shadcn/ui.

## Run

```bash
npm install
cp .env.example .env.local   # optional; the shop runs without it
npm run dev
npm test                     # order persistence and money handling
```

Open http://localhost:3000.

With no CHIP credentials set the shop runs in **simulation mode** — see
[Payments](#payments) below.

## The shop

- **Home** (`/`) — hero, range, story, cooking guide, FAQ
- **Product pages** (`/products/[slug]`) — photography, nutrition panel, net
  weight, serving suggestions and quantity picker; statically generated
- **Bag** — a slide-over drawer, persisted to `localStorage` so it survives a
  refresh and follows the customer across pages
- **Checkout** (`/checkout`) — validated customer and delivery details, live
  shipping quote, order summary
- **Order confirmation** (`/orders/[reference]`) — status, totals and delivery
  address

### Delivery rates

Defined in `src/lib/shipping.ts` and applied by both the checkout UI and the
server:

| Zone | States | Rate | Free from |
| --- | --- | --- | --- |
| Semenanjung Malaysia | all Peninsular states | RM 8.00 | RM 150 |
| East Malaysia | Sabah, Sarawak, Labuan | RM 18.00 | RM 250 |

## Orders and the database

Orders are stored in Postgres.

| `DATABASE_URL` | Driver | Use |
| --- | --- | --- |
| set | `pg` | Supabase, Neon, RDS, any Postgres — **required in deployment** |
| unset | PGlite | Local development. Real Postgres compiled to WASM, stored under `.data/` |

Both are Postgres, so the same SQL runs either way and the test suite exercises
the statements production will run. PGlite writes to the local filesystem, which
on a serverless host is ephemeral and per-instance — set `DATABASE_URL` anywhere
it is deployed.

To use Supabase, copy the connection string from Project settings → Database
(the pooled port 6543 URI on serverless hosts) into `DATABASE_URL`. The schema
in `src/lib/db/schema.ts` is created on first connection.

The schema is applied with `CREATE TABLE IF NOT EXISTS`, which is fine now but
will not alter an existing table — move to versioned migrations before changing
the shape of a live database.

### What the store guarantees

- An order and its line items are written in **one transaction**, so an order
  can never exist without the things being bought.
- Money is `numeric(10,2)` — exact decimal, never binary float.
- Order references are `UNIQUE`, and a collision retries rather than failing the
  customer's checkout.
- **A settled order cannot be reversed.** `setStatus` enforces it inside the
  `UPDATE` (`WHERE ... AND (status <> 'paid' OR $2 = 'paid')`) rather than in
  application code, so two gateway callbacks arriving together cannot both pass
  the check and write.

## Payments

Payments go through [CHIP Collect](https://www.chip-in.asia/). All gateway
code is confined to `src/lib/chip.ts`.

Set these in `.env.local` to take real payments:

| Variable | Purpose |
| --- | --- |
| `CHIP_BRAND_ID` | Brand UUID from the CHIP dashboard |
| `CHIP_SECRET_KEY` | Secret API key — server-side only |
| `CHIP_PUBLIC_KEY` | PEM public key used to verify webhook signatures |
| `NEXT_PUBLIC_SITE_URL` | Public base URL for redirect and callback URLs |

**Simulation mode.** When `CHIP_BRAND_ID` and `CHIP_SECRET_KEY` are absent, the
checkout creates a real order record and marks it paid without contacting CHIP,
so the full journey is clickable in development. The confirmation page labels
any such order as simulated. Do not deploy without credentials.

**Before going live:** the request/response field names and the webhook
signature scheme in `src/lib/chip.ts` follow CHIP's documented Purchases API but
have not been exercised against a live merchant account — verify them against
the current API reference first.

### Safeguards already in place

- The order API ignores prices sent by the browser and recomputes every line,
  the shipping fee and the total from `src/lib/products.ts`.
- Webhooks are rejected unless the RSA signature verifies against
  `CHIP_PUBLIC_KEY`, so an order can never be marked paid by an unauthenticated
  request.
- `paid` is terminal — a late failure webhook cannot silently reverse a
  settled order.

## Admin

`/admin` covers the other half of the flow: what happens after a customer pays.

- **Overview** — revenue from settled orders, counts, and what is waiting to go out
- **Orders** — filter by payment or fulfilment state, search by reference, name
  or email, paginated
- **Order detail** — full order, delivery address and contact, plus fulfilment
  actions and a tracking number

Orders carry a fulfilment state (`unfulfilled → packed → shipped → delivered`)
separately from payment status, because the two are independent.

### Access

The admin area exposes customers' names, phone numbers and home addresses, so it
**fails closed**: unless both variables below are set it is disabled outright,
and every route redirects to a sign-in page that will not accept any password.

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Shared password, minimum 12 characters |
| `ADMIN_SESSION_SECRET` | Signs the session cookie — `openssl rand -base64 32` |

- The session is an HMAC-signed, `httpOnly`, `sameSite=lax` cookie lasting eight
  hours. Editing the expiry invalidates the signature.
- Passwords are compared in constant time.
- Failed sign-ins are throttled per client. That counter is in-process, so put a
  rate limit at the edge as well if the admin area faces the internet.
- Every server action re-checks the session. Layout protection guards
  navigation, but an action is an endpoint and can be called directly.
- A single shared password suits one shop owner. For more than one person,
  replace it with real accounts rather than sharing the secret.

## Affiliates

Affiliates refer customers with a link carrying their code
(`https://your-domain.my/?ref=AMINA10`) and earn commission on what those
customers buy. `/admin/affiliates` manages them: add or deactivate affiliates,
see sales and commission per person, and record payouts.

### How commission is calculated

Two rules decide whether the right amount is paid, and both are enforced in
code rather than left to convention:

- **Commission is taken on the order subtotal, never the total.** Delivery is a
  cost passed to a courier, not margin — a percentage of it would mean paying
  affiliates out of postage.
- **The rate is snapshotted onto the order.** Commission is computed once, from
  the rate in force at that moment. Changing an affiliate's rate later applies
  to future orders only and never rewrites what has already been earned or paid.

Commission is only *owed* once the order is paid. An order that fails or is
cancelled voids its pending commission automatically. Commission already paid
out is never voided by a status change — money that has left the business is a
decision for a human, not a side effect.

### Attribution

`?ref=CODE` is captured by middleware into a cookie with a 30-day window. The
cookie records a claim only: the order API looks the code up server-side and
ignores it unless it matches an **active** affiliate, so editing the cookie
cannot invent a commission or select a better rate.

Payouts are idempotent — `payOut` only settles commission on orders that were
actually paid, and cannot pay the same commission twice.

## Agent fee (KretivWork)

KretivWork is the sole agent for the range and earns a flat fee on **every**
sale — unlike affiliate commission, which is a percentage and only applies to
orders the affiliate referred. The two are independent arrangements: an order
carrying both pays both.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_NAME` | `KretivWork` | Shown in the admin and the partner feed |
| `AGENT_FEE_PER_SALE` | `2` | Ringgit per sale; `0` disables the arrangement |
| `AGENT_FEE_BASIS` | `order` | `order` = one fee per order, `unit` = one per jar |

> **Confirm the basis before going live.** "RM 2 per sale" is ambiguous. A
> four-jar order pays **RM 2.00** on the `order` basis and **RM 8.00** on the
> `unit` basis. The default is `order`, the more literal reading; set
> `AGENT_FEE_BASIS=unit` if the agreement is per jar.

The fee is snapshotted onto each order, so renegotiating it changes future sales
only. It accrues when the order is placed, is owed once the order is paid, and
is voided if the order fails or is cancelled.

## Partner API

Read-only endpoints for the central dashboard to pull sales and reconcile agent
fees. Authenticate with `PARTNER_API_KEY` (minimum 24 characters):

```
Authorization: Bearer <PARTNER_API_KEY>      # or:  X-API-Key: <PARTNER_API_KEY>
```

Unset key means the endpoints return `503` — disabled, not open. A wrong or
missing key returns `401`.

### `GET /api/partner/sales`

| Query | Notes |
| --- | --- |
| `from`, `to` | ISO date or datetime. `from` inclusive, `to` exclusive |
| `status` | `pending_payment`, `paid`, `failed`, `cancelled` |
| `limit` | 1–200, default 50 |
| `cursor` | From `pagination.nextCursor` |

```jsonc
{
  "data": [{
    "reference": "CA-3824JM",
    "placedAt": "2026-07-28T08:41:08.023Z",
    "paidAt": "2026-07-28T08:41:08.028Z",
    "status": "paid",
    "fulfilment": "unfulfilled",
    "currency": "MYR",
    "subtotal": 79.6,        // goods only
    "shipping": 18,
    "total": 97.6,
    "units": 4,              // jars
    "items": [{ "productId": "briyani", "name": "Briyani Paste",
                "quantity": 4, "unitPrice": 19.9, "lineTotal": 79.6 }],
    "state": "Sabah",
    "agent": { "name": "KretivWork", "fee": 2, "status": "pending" },
    "affiliate": null        // or { code, commission, status }
  }],
  "pagination": { "limit": 50, "hasMore": true, "nextCursor": "..." }
}
```

**Pagination is keyset, not offset.** The dashboard polls a table that is still
receiving orders; an offset would skip or repeat rows as new orders arrive
between pages. Page by following `nextCursor` until `hasMore` is false.

### `GET /api/partner/summary`

Headline figures for a period, so the dashboard need not page the whole feed for
totals. Counts **settled orders only**. Echoes `agentTerms` so the dashboard can
show the terms its figures were produced under, and notice if they change.

```jsonc
{
  "period": { "from": null, "to": null },
  "currency": "MYR",
  "agentTerms": { "name": "KretivWork", "feePerSale": 2, "basis": "order" },
  "summary": {
    "orders": 2, "units": 5,
    "netSales": 99.5,          // goods, excluding delivery
    "grossSales": 125.5,       // what customers were charged
    "shippingCollected": 26,
    "agentFees": { "pending": 4, "paid": 0, "total": 4 },
    "affiliateCommission": { "pending": 0, "paid": 0, "total": 0 }
  }
}
```

### What the feed deliberately excludes

**No customer personal data.** Reconciling sales and fees needs amounts and
dates, not names, phone numbers or home addresses, and copying them into another
system creates a second place they can leak from. Delivery `state` *is*
included, because it determines the shipping figure. A test asserts the
exclusion holds.

Responses are `Cache-Control: no-store, private` — commercial data must not sit
in a shared cache.

## Product assets

`public/products/*.webp` are transparent cutouts used throughout the site;
the untouched studio photographs are kept in `public/products/source/`.

Weight, nutrition and the Malay heritage note in `src/lib/products.ts` are
transcribed from the physical labels, and each product's `accent` is sampled
from its label colour band.

## Still to do

1. **Verify the CHIP integration** against a live merchant account — see
   Payments above.
2. Send order confirmation emails. Customers currently get a reference number on
   screen and nothing else.
3. Stock levels. Nothing stops an order for more jars than exist.
4. Rate limiting on `POST /api/orders`.
5. Wire up or remove the footer newsletter form; it currently does nothing.
6. An affiliate-facing dashboard. Affiliates currently have no login; the shop
   owner reports their earnings to them.
7. Agent fee payouts. Fees accrue and are reported, but there is no
   "mark paid" action for the agent as there is for affiliates.
8. Rate limiting on the partner API.
9. Lifestyle/recipe photography for the story section.
