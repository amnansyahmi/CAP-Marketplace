# Chef Ammar Marketplace

Storefront for the Chef Ammar cooking paste range — Kabsah, Mandy and Briyani —
built with Next.js App Router, TypeScript, Tailwind CSS v4 and shadcn/ui.

## Run

```bash
npm install
npm run demo     # generates credentials and seeds a shop with history
npm run dev
```

Then open:

| | |
| --- | --- |
| Shop | http://localhost:3000 |
| Admin overview | http://localhost:3000/admin |
| Orders | http://localhost:3000/admin/orders |
| Affiliates (admin) | http://localhost:3000/admin/affiliates |
| Affiliate portal | http://localhost:3000/affiliate |

There is no sign-in during the demo: `npm run demo` sets `ADMIN_DEMO_MODE=1`, so
`/admin` opens straight away and every page there shows a red banner saying the
login is off. Remove that line from `.env.local` to get the sign-in back — the
password is `demo-chef-ammar-2026`.

`npm run demo` exists so the whole system can be shown without configuring
anything: it writes `.env.local` with working credentials and seeds affiliates,
orders across several weeks and states, mixed payment and fulfilment states, and
some orders through referral links. It prints the admin password and the partner
API key when it finishes. Add `--reset` to wipe and start again.

It turns the admin sign-in off, because a demo should not start with a password
prompt. That is the one guard it relaxes, it does so through an explicit flag,
and it writes that flag to `.env.local` — gitignored, never uploaded, so a
deployment is unaffected. Everything else it *configures* rather than bypasses:
the partner API still needs its key, and the admin sign-in still works the
moment the flag is removed. Those credentials are printed to a terminal and are
for local demos only.

It refuses to run under `NODE_ENV=production`, and refuses to seed into a remote
`DATABASE_URL` without `--force`, because mixing invented orders into a real shop
is not undoable.

Other commands:

```bash
npm test         # money handling, persistence, auth, commission
npm run build
```

Without CHIP credentials the shop runs in **simulation mode** — see
[Payments](#payments).

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

#### Demo mode

Setting `ADMIN_DEMO_MODE=1` removes the sign-in: `/admin` opens for anyone with
the URL. It is for showing the system before credentials exist.

- Only the exact value `1` enables it, so no amount of *missing* configuration
  can produce it — the fail-closed default is unchanged.
- It is honoured on production deployments too, because a demo has to be
  viewable on the deployed URL to be worth anything. Vercel will not pick it up
  from `.env.local`; it has to be added to the project's environment on purpose.
- Every admin page carries a non-dismissible banner while it is on.

**Turn it off before the shop takes a real order.** Anyone with the link can
read every customer's name, phone number and delivery address.

- The session is an HMAC-signed, `httpOnly`, `sameSite=lax` cookie lasting eight
  hours. Editing the expiry invalidates the signature.
- Passwords are compared in constant time.
- Failed sign-ins are throttled per client. That counter is in-process, so put a
  rate limit at the edge as well if the admin area faces the internet.
- Every server action re-checks the session. Layout protection guards
  navigation, but an action is an endpoint and can be called directly.
- A single shared password suits one shop owner. For more than one person,
  replace it with real accounts rather than sharing the secret.

## Stock

Off by default, and opt-in per product from `/admin/stock`. Turning stock on for
a shop that has never counted its jars would take the whole catalogue off sale
the moment the table appeared, so untracked products sell exactly as they did
before.

**Stock is held when an order is placed, not when it is paid.** Someone on the
payment page is holding the last jar; decrementing only on payment would let a
second customer buy it while the first is still typing their card number, and
one of them would get an apology instead of a delivery. So an order reserves as
it is created, the reservation becomes a sale when payment settles, and it goes
back if the payment fails or is cancelled.

Available stock is `on_hand - reserved`. The check and the write happen inside
one transaction with `SELECT ... FOR UPDATE`, because checking first and writing
after would let two requests both read "one left" and both decide they may have
it. Reservations are all-or-nothing across an order: a customer should not end
up with half a bag because one line ran out at checkout.

A reservation is released exactly once, guarded by a `stock_state` column on the
order. Without that, an order that failed and was then cancelled would hand its
jars back twice and invent inventory the shop does not have.

The storefront reads `/api/availability` from the browser rather than rendering
stock into the page, so the shop and product pages keep their static rendering.
That is a courtesy — the sold-out badge and the disabled button. The order API
re-checks and reserves server-side, so a stale or edited answer cannot oversell
anything; a request for more than is available comes back `409` naming the item
that ran out.

## Emails

The shop sends two messages: a confirmation when an order is paid, and a
shipping notice with the tracking number when it is marked shipped. Both are
plain text *and* HTML — the text part is what a watch, a screen reader or a
stripped-down client shows, so neither is a stub for the other.

### Sending exactly once

A payment gateway retries a callback it does not get a prompt answer to, and an
admin can click a button twice. Two confirmations is an embarrassment; two
shipping notices with different tracking numbers is a support call. So the
decision to send is a database write, not a judgement made in JavaScript:

`order_notifications` has `(order_id, kind)` as its primary key, and a sender
claims with `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Whoever wins the
insert sends; everyone else stops. Six concurrent attempts produce exactly one
email, and the guard holds across restarts and across instances in a way an
in-memory check could not.

**Sending never fails an order.** A payment that succeeded and an email that did
not are two different facts. Failures are recorded against the order with the
reason and shown in the admin, because a customer who was not told is precisely
what the shop needs to know — an unrecorded failure is silence.

### Choosing a provider

| Variable | Purpose |
| --- | --- |
| `MAIL_DRIVER` | `resend`, `console` or `none`. Defaults to `console` |
| `RESEND_API_KEY` | Required for the `resend` driver |
| `MAIL_FROM` | e.g. `Chef Ammar <orders@your-domain.my>` |

With nothing configured the console driver logs what *would* have been sent, and
the order page says plainly that no email went out — a shop with broken mail
should be able to tell that it is broken rather than quietly dropping messages.
Resend is called over plain `fetch`; there is no SDK to keep current.

## Order pages

`/orders/CA-XXXXXX` shows a customer's name, phone number and home address, so
knowing the reference is not enough to open it. Two ways in:

- **the signed link** in their email (`?t=`), which names the order inside the
  signature and so cannot be moved to a different one
- **the browser that placed the order**, which keeps a list of its own
  references

Neither is a login — forwarding your own confirmation shares your own order,
which is yours to share. The point is that a reference alone no longer opens
anything. An unauthorised request gets the same 404 as a reference that does not
exist, so the page cannot be used to test which references are real.

References are drawn from `randomBytes` with rejection sampling, not
`Math.random()`. V8's generator is a fast non-cryptographic PRNG whose state can
be recovered from a handful of outputs, which would make references predictable
rather than merely hard to guess.

| Variable | Purpose |
| --- | --- |
| `ORDER_ACCESS_SECRET` | Signs the order links — `openssl rand -base64 32` |

Unset, tokens are refused and only the buyer's own browser can open the page: a
missing secret must never mean "let everybody in".

## Affiliates

Affiliates refer customers with a link carrying their code
(`https://your-domain.my/?ref=AMINA10`) and earn commission on what those
customers buy. There are two sides to it:

- `/admin/affiliates` — the shop owner's view: add or deactivate affiliates,
  set rates and passwords, see sales per person, record payouts.
- `/affiliate` — the affiliate's own portal, which they sign into themselves.

### The affiliate portal

A standalone area at `/affiliate`, linked from the site footer. An affiliate
signs in with their referral code and a password, and sees:

- their referral link, with a copy button
- what they have earned, what is awaiting payout, and what has been paid
- every order that came through their link — date, jars, sale value, the rate
  applied and what they earned on it

**Affiliates see sales, not customers.** A promoter needs to trust the figure,
which means seeing which orders were counted and for how much. It does not mean
knowing where the buyer lives. The portal query selects the buyer's first name
and delivery state and nothing else — email, phone, address lines, postcode and
order notes are never read, so no component can leak them by rendering more than
it meant to. A test asserts this by searching the serialised response for each
of those values.

Isolation is enforced by the session, not by a parameter. The affiliate's id
comes from the signed cookie and every query is scoped to it; there is no URL or
form field that selects an affiliate. The cookie names who it is for *inside*
the signature, so repointing it at another code invalidates it and signs the
visitor out rather than showing them somebody else's earnings.

| Variable | Purpose |
| --- | --- |
| `AFFILIATE_SESSION_SECRET` | Signs the portal cookie — `openssl rand -base64 32` |

Unset, the portal is disabled and the sign-in page says so, the same way the
admin fails closed. It is a *separate* secret from `ADMIN_SESSION_SECRET` on
purpose: a leaked affiliate secret must not be forgeable into an admin session.

Passwords are set by the shop owner from the affiliate's admin page and passed
on out of band — there is no self-service signup and no password reset email
yet. They are stored as scrypt hashes with a per-affiliate salt and compared in
constant time, so a stolen `affiliates` table does not yield anyone's password.
An affiliate with no password set cannot sign in at all, and deactivating an
affiliate closes their portal as well as stopping their commission.

In demo mode (`ADMIN_DEMO_MODE=1`) the sign-in page also lists the affiliates as
one-click buttons, so the portal can be shown without typing credentials. That
path re-checks the flag inside the server action rather than trusting the page
that drew the buttons.

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

## Deploying to Vercel

Set these in **Project → Settings → Environment Variables**, then redeploy.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Postgres. Supabase's **pooled** URI (port 6543), not the direct one |
| `NEXT_PUBLIC_SITE_URL` | **yes** | e.g. `https://chefammar.my` — CHIP redirects back here |
| `CHIP_BRAND_ID` | to take money | From the CHIP dashboard |
| `CHIP_SECRET_KEY` | to take money | |
| `CHIP_PUBLIC_KEY` | to take money | Without it, webhooks are rejected and orders never confirm |
| `ADMIN_PASSWORD` | to use `/admin` | Min 12 characters |
| `ADMIN_SESSION_SECRET` | to use `/admin` | `openssl rand -base64 32` |
| `ADMIN_DEMO_MODE` | never, for a real shop | `1` opens `/admin` with no sign-in |
| `AFFILIATE_SESSION_SECRET` | to use `/affiliate` | `openssl rand -base64 32` |
| `ORDER_ACCESS_SECRET` | to email order links | `openssl rand -base64 32` |
| `RESEND_API_KEY` | to send real email | Otherwise mail is logged, not sent |
| `MAIL_FROM` | to send real email | `Chef Ammar <orders@your-domain.my>` |
| `PARTNER_API_KEY` | for the dashboard | Min 24 characters |
| `AGENT_FEE_PER_SALE` | no | Defaults to `2` |
| `AGENT_FEE_BASIS` | no | `order` (default) or `unit` |

### Two things that will stop a deploy misbehaving

**Without `DATABASE_URL` the app refuses to start serving orders.** It does not
fall back to the local development database: a serverless filesystem is
read-only where the app lives and wiped between invocations where it is not, so
orders would fail to save — or save and then vanish. The error names the fix.

**Without CHIP credentials, a production deployment refuses to take orders.**
In development the shop simulates payments so the flow is clickable. Doing that
on a live URL would tell real customers their order was confirmed for money
never collected, so it is refused. To show the shop on a production URL
deliberately, set `ALLOW_SIMULATED_PAYMENTS=1`.

Preview deployments are *not* treated as production, so a preview URL
demonstrates the full flow with simulated payments and no extra configuration —
`VERCEL_ENV` distinguishes them, since `NODE_ENV` is `production` for previews
too.

### After the first deploy

1. Hit any page — the schema is created on first connection.
2. Sign in at `/admin` and add your affiliates. Make sure `ADMIN_DEMO_MODE`
   is **not** set on the deployment.
3. Point CHIP's webhook at `https://your-domain/api/webhooks/chip`.
4. Give the central dashboard `PARTNER_API_KEY` and the endpoints under
   [Partner API](#partner-api).

`vercel.json` pins the region to `sin1` (Singapore), the closest to Malaysian
customers, and marks `/admin` and the partner API `no-store` and `noindex`.

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
