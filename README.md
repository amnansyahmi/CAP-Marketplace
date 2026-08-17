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

Without gateway credentials the shop runs in **simulation mode** — see
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

Payments go through [Bayarcash](https://bayarcash.com/) (API v3) — FPX, DuitNow,
e-wallets and cards. Every gateway lives behind one small interface in
`src/lib/payments/gateway.ts`, so nothing outside `src/lib/payments/` knows
which provider took the money:

| File | What it holds |
| --- | --- |
| `src/lib/payments/gateway.ts` | The interface, and the rule that refuses to fake a payment in production |
| `src/lib/payments/bayarcash.ts` | Everything that touches Bayarcash's wire format |
| `src/lib/payments/chip.ts` | The same for [CHIP Collect](https://www.chip-in.asia/) |
| `src/lib/payments/callbacks.ts` | What happens once a payment moves — the same whoever took it |
| `src/lib/payments/label.ts` | Which gateway is selected, and what to call it on screen |

Set `NEXT_PUBLIC_PAYMENT_GATEWAY` to `bayarcash` (default) or `chip`. It is a
`NEXT_PUBLIC_` variable so the checkout button and the server-side integration
read the same value and cannot drift apart.

Set these in `.env.local` to take real payments:

| Variable | Purpose |
| --- | --- |
| `BAYARCASH_PAT` | Personal Access Token from the Bayarcash console |
| `BAYARCASH_PORTAL_KEY` | The portal money is collected into |
| `BAYARCASH_API_SECRET_KEY` | Signs requests and verifies every callback |
| `BAYARCASH_SANDBOX` | `1` to use the sandbox console |
| `BAYARCASH_PAYMENT_CHANNEL` | Optional channel id, or a list. Unset, the payer chooses |
| `NEXT_PUBLIC_SITE_URL` | Public base URL for redirect and callback URLs |

### How a payment travels

1. `POST /api/orders` re-prices the basket, holds the stock and creates the
   order, then asks Bayarcash for a payment intent — one signed decimal amount,
   not a basket of line items.
2. The customer pays on Bayarcash's page and is redirected to
   `/api/payments/bayarcash/return`, which checks the redirect's checksum before
   deciding what to show them. **It never writes to an order.**
3. Bayarcash posts the result to `/api/webhooks/bayarcash`. That callback is the
   only thing the shop settles on, so a customer who closes the tab still gets a
   confirmed order.

Both the request and every callback carry an HMAC-SHA256 checksum over a fixed
set of fields, sorted by field name and joined with `|` — the scheme the
official [PHP SDK](https://github.com/webimpian/bayarcash-php-sdk) implements.
Outcomes arrive as status codes: `3` paid, `2` failed, `4` cancelled; `0` and
`1` mean the payment is still in flight and are acknowledged without touching
the order.

**Simulation mode.** When `BAYARCASH_PAT` and `BAYARCASH_PORTAL_KEY` are absent,
the checkout creates a real order record and marks it paid without contacting
the gateway, so the full journey is clickable in development. The confirmation
page labels any such order as simulated. Do not deploy without credentials.

**Before going live:** the field names here follow the official SDK and were
tested against fixtures built the same way, but have not been exercised against
a live merchant account. Run a sandbox payment end to end
(`BAYARCASH_SANDBOX=1`) before pointing real customers at it.

### Safeguards already in place

- The order API ignores prices sent by the browser and recomputes every line,
  the shipping fee and the total from `src/lib/products.ts`.
- Callbacks are rejected unless the checksum verifies against
  `BAYARCASH_API_SECRET_KEY`, so an order can never be marked paid by an
  unauthenticated request. A *missing* key rejects everything rather than
  waving it through.
- The payer's redirect is verified separately, against its own shorter field
  set, and can only change what the customer is shown — never the order.
- `paid` is terminal — a late failure callback cannot silently reverse a
  settled order.

## Admin

`/admin` is where the shop is run: what it sells, for how much, and what happens
after a customer pays.

| Page | What it controls |
| --- | --- |
| **Overview** | Revenue from settled orders, counts, and what is waiting to go out |
| **Products** | Price and stock per product, with 30-day sales beside each one — see [Prices](#prices) and [Stock](#stock) |
| **Discounts** | Promotion codes: percentage or fixed, minimum spend, usage limit, expiry — see [Discount codes](#discount-codes) |
| **Reports** | Sales by day and by product over 7, 30 or 90 days, and what is running low |
| **Orders** | Filter by payment or fulfilment state, search by reference, name or email, paginated |
| **Order detail** | Full order, delivery address and contact, fulfilment actions, tracking number, refund |
| **Affiliates** | Referral codes, commission rates and what each one is owed |

Orders carry a fulfilment state (`unfulfilled → packed → shipped → delivered`)
separately from payment status, because the two are independent.

Everything the shop owner changes here takes effect without a deploy. What it
cannot change is a sale that already happened: prices, commission rates and the
agent fee are all snapshotted onto the order when it is placed.

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

## The shopfront

### Policy pages

`/terms`, `/privacy`, `/returns`, `/shipping` and `/contact`. Not boilerplate:
the privacy policy describes the cookies this shop actually sets and the three
third parties it actually contacts, the delivery page reads its rates from
`ZONE_RATES` so it cannot drift from what checkout charges, and the returns
policy says plainly that opened food cannot come back rather than promising a
30-day return it could not honour.

A payment gateway will look for these during merchant verification, so the gap
is worth closing before applying rather than after being asked.

**The business details are not invented.** They come from the environment, and
any that are missing are reported as missing — on the policy pages themselves
and on the contact page. A policy naming a plausible-looking business nobody can
reach is worse than one that admits it is incomplete.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SHOP_LEGAL_NAME` | Registered entity, if different from the brand |
| `NEXT_PUBLIC_SHOP_REGISTRATION` | SSM registration number |
| `NEXT_PUBLIC_SHOP_EMAIL` | Support email, shown on every policy page |
| `NEXT_PUBLIC_SHOP_PHONE` | Support phone |
| `NEXT_PUBLIC_SHOP_ADDRESS` | Business address, pipe-separated for line breaks |
| `NEXT_PUBLIC_SHOP_WHATSAPP` | Optional; becomes a wa.me link on the contact page |

### Finding an order again

`/orders/find` takes an order reference *and* the email it was placed with. The
reference alone deliberately does not open an order — that is what the signed
email links are for — and pairing it with the email is the one extra detail a
real customer always has. A wrong pair gives the same message as a reference
that does not exist, so the form cannot be used to test which references are
real, and it is throttled because that is exactly the shape of thing people
script.

### The newsletter

The footer form used to accept an address, appear to succeed and throw it away.
It now records subscribers, and unsubscribing sets a timestamp rather than
deleting the row — a deleted record would be silently re-created the next time
that person typed their address in, and the shop would start emailing someone
who asked it to stop. Unsubscribe links are signed, so editing the address in
the URL cannot remove somebody else.

Signing up twice gets the same message as signing up once. "You are already
subscribed" would quietly confirm to a stranger that an address is on the list.

### Rate limiting

`/api/orders`, `/api/discount`, `/api/shipping/rates`, the newsletter form and
the order lookup all go through a shared limiter. Order creation is the one that
matters: it is unauthenticated and it reserves stock, redeems discount codes and
calls a payment gateway, so left open a script could hold every jar in pending
reservations without paying for anything.

**It is in-process, so it does not hold across instances.** On one container it
is a real limit; across several it becomes N times the limit. That raises the
cost of abuse rather than removing it — put a limit at the edge as well.

### Being found

`sitemap.xml` and `robots.txt` are generated, and product pages carry Product
structured data with price and availability so search results can show both.

Availability is only claimed for a product the shop actually counts, and the
product page revalidates every five minutes to keep it close to true. A page
statically asserting "in stock" while the shop is sold out is a false claim in a
machine-readable format, and a mismatch between structured data and the page is
a reason search engines distrust the whole site. For the same reason there is no
review or rating markup: there are no reviews yet, and fabricating them is the
most common way a shop loses its rich results.

### Reports

`/admin/reports` shows revenue by day, best sellers, average order value and how
the period compares with the one before. Everything nets off refunds, because a
best-seller list counting refunded orders points the shop at the wrong product.
Low stock is flagged here and on the stock page, but only for products that are
actually tracked — warning about an untracked one is noise the owner learns to
ignore.

The chart is markup, not a charting library, and the same numbers are in a table
underneath for anyone the chart does not work for.

## Delivery and couriers

Two layers, and the order matters: **checkout never depends on a courier API
being up.**

- **Flat zone rates** (`src/lib/shipping.ts`) are the floor. RM 8 within
  Semenanjung, RM 18 to Sabah/Sarawak/Labuan, free over a threshold. Always
  available, no configuration, no network call.
- **Live courier rates** through EasyParcel, when it is configured. One account
  covers J&T, Pos Laju, DHL and the rest, so the shop books through a single
  integration rather than onboarding with each courier separately.

When EasyParcel is unreachable, unconfigured, or simply slow, the flat rate
stands in and the customer sees a working shop. A postage quote is not worth
losing a sale over.

### Two prices, deliberately apart

`price` is what the customer is charged; `cost` is what the shop expects to pay
the courier. Free delivery zeroes the first and leaves the second alone —
absorbing postage is a real cost, and folding the two together would hide it
from the margin. The order stores both.

### What is quoted

Couriers price the packed box, not the product. `src/lib/parcel.ts` adds box
tare and per-jar padding to the goods weight, picks from box sizes the shop
actually keeps, and charges the greater of actual and volumetric weight
(cm³/6000, the divisor every Malaysian courier uses). Quoting three 350g jars as
1.05kg would under-buy postage on every order.

Those numbers are conservative estimates, not measurements. Weigh a real packed
box and replace them — they are in one file for exactly that reason.

### Booking

From the order page in the admin. Booking spends real EasyParcel credit, so
`shipment_state` is a claim: whoever moves it `none → booking` owns the attempt,
and a second click finds it taken. A failure returns it to `none` with the
reason attached, because leaving it stuck at `booking` would mean a network blip
locked an order out of ever being shipped.

Only a paid, unrefunded order can be booked. Posting goods for money that never
arrived is the one mistake a courier integration must not make easy.

The consignment number fills in automatically; marking the order shipped emails
it to the customer. `syncParcelStatuses` pulls tracking for parcels in flight
and advances fulfilment — forward only, since tracking events arrive late and
out of order, and a stale event must not un-deliver a parcel that arrived.
Wording the mapper does not clearly recognise changes nothing at all.

| Variable | Purpose |
| --- | --- |
| `EASYPARCEL_API_KEY` | Enables live rates and booking |
| `EASYPARCEL_DEMO` | `1` to use the sandbox host |
| `EASYPARCEL_PICKUP_POSTCODE` | Where parcels are collected — required |
| `EASYPARCEL_PICKUP_STATE` | Required |
| `EASYPARCEL_PICKUP_NAME` / `_PHONE` / `_ADDRESS` / `_CITY` | On the consignment note |

Without a pickup postcode and state the integration stays off, because every
rate depends on where the parcel starts and a confidently wrong quote is worse
than no quote.

> **Not yet verified against a live account.** Rate checking is built against
> EasyParcel's published example. Order submission and payment follow the same
> documented shape but have not been run with a real merchant key, so confirm
> those field names before booking the first real parcel.

## Prices

Set from `/admin/products`, per product, alongside stock and how many jars that
product has sold in the last thirty days — because setting a price without
seeing what moved at the old one is guessing.

`src/lib/products.ts` still holds the catalogue: identity, copy, weight,
photography and a **launch price**. The `product_prices` table holds an
override, and a product with no row sells at its catalogue price — so a database
that has never been touched sells the right things for the right money.

**Three rules the code keeps:**

1. **The server decides the price.** `/api/orders` prices every line from
   `priceMap()` when the order is placed. What the browser was showing is never
   consulted — a tab left open across a price change is simply out of date, and
   pays today's price.
2. **A past order is never re-priced.** Orders snapshot `unitPrice` into
   `order_items`. Changing a price today cannot rewrite what somebody paid last
   week, and the admin says so on the form.
3. **An unreachable database must not close the shop.** Every read falls back to
   the catalogue price, which is also what makes the storefront buildable with
   no database at all.

**Getting a change in front of customers.** The storefront is statically
rendered, so a price is baked into the page. Two things unbake it: the home page
and product pages rebuild every five minutes and render the current price
directly, and `/api/availability` — already fetched once per visit for stock —
now carries prices too, so a browser corrects anything staler within fifteen
seconds. Neither is a control; both are display.

Prices are bounded at RM 1.00 to RM 999.00 and two decimal places. The ceiling
is not arithmetic, it is a fat finger: an extra zero on a jar of spice paste is
a mistake every time. **Reset to catalogue price** removes the override rather
than typing the old number back, so the product follows the catalogue again.

Running a promotion is a different thing from changing a price — see
[Discount codes](#discount-codes), which leaves the shelf price alone and can
expire on its own.

## Stock

Off by default, and opt-in per product from `/admin/products`. Turning stock on for
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

## Discount codes

Managed at `/admin/discounts`: percentage or fixed-ringgit, with an optional
minimum spend, usage limit and expiry. Customers enter one at checkout.

Two decisions worth naming, because both are about paying the right amount:

- **The discount comes off the goods subtotal, never delivery.** Postage is owed
  to a courier regardless. A code eating into it would be the shop quietly
  paying part of the delivery out of its own margin.
- **Commission is earned on what the shop actually received.** A RM 39.80 bag
  discounted to RM 31.84 earns a 10% affiliate RM 3.18, not RM 3.98. Paying on
  the pre-discount figure is the same error as paying commission on delivery:
  money leaving on revenue that never arrived.

Checking a code and redeeming one are different operations. `/api/discount`
validates and quotes without consuming anything — a customer looking at their
total has not bought anything, and burning a limited code on a page view would
let anyone empty a promotion for free. The redemption is claimed at order time
inside the UPDATE, so ten simultaneous checkouts against a three-use code
produce exactly three winners. A use is given back, once, if the payment fails
or the order is cancelled or refunded.

The subtotal is recomputed from the catalogue on both paths, so a browser cannot
inflate its own bag to clear a minimum-spend threshold. An unknown code and a
dead one give the same message, so the form cannot be used to discover which
codes exist.

## Refunds and cancellations

An unpaid order can be cancelled from the admin, which puts its reserved stock
straight back. A paid order can be refunded, which unwinds everything that hung
off the sale.

**A refund is recorded alongside the payment, not instead of it.** The order
*was* paid — rewriting the status to hide that would lose the fact and break
every query that counts a sale. So `refunded_at` sits next to `paid_at`, the way
fulfilment sits next to payment, and revenue is "paid minus refunded".

Refunding one order does all of this in a single guarded UPDATE:

- **Commission still pending is voided.** The shop gave the money back; it does
  not also owe a percentage of it.
- **Commission already paid out is left alone.** That money has left the
  building, and pretending otherwise would make the affiliate's figures disagree
  with what they were actually sent.
- **The agent fee is voided** on the same terms.
- **Stock goes back** on the shelf, once.
- **The customer is emailed**, with the reason if one was given.

The guard is `WHERE status = 'paid' AND refunded_at IS NULL`, so two clicks
cannot refund twice or void commission twice.

**It does not move money.** The gateway holds the payment, so the actual refund
is issued there; this records that it happened so the shop's own figures stop
counting it as income. The admin says so on the button, naming whichever
gateway is configured.

Refunded orders are excluded from an affiliate's sales figures in *both* the
admin and their own portal, and the partner feed carries `refundedAt` so the
central dashboard stops counting a sale it already reported.

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

## Security

The rule throughout: **nothing that decides money is taken from the browser.**
The client sends product ids, quantities and a delivery choice. Everything else
— prices, the subtotal, postage, the discount, the total — is computed on the
server from `src/lib/products.ts` and the discount table. A request that arrives
with its own `unitPrice`, `subtotal` or `total` is not rejected; those fields
are simply never read.

### What an attacker can try, and what happens

| Attempt | What stops it |
| --- | --- |
| Edit the price in devtools and submit | Every line is rebuilt from the catalogue; the posted price is never read |
| Edit the total or the shipping fee | Both recomputed server-side; delivery is re-quoted, not taken from the request |
| Send quantity `-4` to earn a credit | Rejected by validation; the bag is refused, not silently corrected |
| Repeat one product 50 times at 99 each | Duplicate lines are merged before the cap applies, and 20 lines / 200 jars is the ceiling |
| Post a 10,000-line bag | `413` before anything is parsed — bodies are capped at 16 KB |
| Guess discount codes in a loop | Rate limited per address, in-process **and** in the database |
| Redeem a limited code twice at the same instant | The limit lives inside the `UPDATE`'s `WHERE`, so only one caller wins |
| Buy the last jar twice | `SELECT ... FOR UPDATE` inside the reservation transaction |
| Forge a "paid" callback | Rejected unless the HMAC checksum verifies; a missing key rejects everything |
| Pay RM 1 against an RM 400 order | The callback's amount and currency are checked against the order before it settles; a mismatch leaves it pending and logs loudly |
| Replay a real "paid" callback | `paid` is terminal, stock moves once, and notifications are claimed by an insert |
| Open someone else's order page by guessing the reference | Needs a signed token or the cookie from the browser that placed it |
| Frame the shop to harvest clicks | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| Inject a script that posts the checkout form elsewhere | CSP `connect-src 'self'` and `form-action 'self'` |

Admin, affiliate and partner credentials are all compared in constant time and
**fail closed** — unset means the surface is disabled, never open.

### Where the remaining risk is

- **`x-forwarded-for` is not an identity.** Rate limits are keyed on it because
  a shop cannot make buyers sign in. Behind Vercel the leftmost entry is the
  real client; anywhere else, put a limit at the edge as well.
- **CSP allows inline scripts.** Removing `'unsafe-inline'` means a per-request
  nonce, which means giving up static rendering on the storefront. The half of
  the policy that decides where data can *go* is unaffected.
- **A refund does not move money.** It is recorded here and issued in the
  gateway by a person.

## Capacity

What actually happens when a lot of people arrive at once, by path:

| Path | Cost per visitor | Where it is served |
| --- | --- | --- |
| Home, product pages, policies | none | Prerendered, served from the CDN |
| Stock availability | one small query per 15s **for everyone** | `Cache-Control: max-age=15` on `/api/availability` |
| Courier quotes | one call per postcode + parcel size per 5 min | In-process cache in `src/lib/delivery.ts` |
| Placing an order | ~10 database round trips and one gateway call | Origin |

So five thousand people browsing is a CDN problem, not a database one. Five
thousand people *checking out at the same second* is the real question, and it
is bounded by two things: database connections and the payment gateway.

**Connections.** `DATABASE_POOL_MAX` (default 5) caps each instance. The default
`pg` pool is 10 per instance, which a serverless host quietly multiplies by
however many instances the spike created — the failure mode is not slowness, it
is every instance being refused a connection at once. Use the **pooled**
(pgbouncer, port 6543) Supabase URI, not the direct one. `connectionTimeoutMillis`
and `statement_timeout` are set so a stuck query fails fast instead of holding a
connection while requests queue behind it.

**The schema script** runs only when the schema is missing, behind an advisory
lock. Running it on every cold start meant dozens of concurrent
`CREATE INDEX IF NOT EXISTS` contending on the catalogue at exactly the wrong
moment.

**A third party being slow must not become the shop being slow.** Courier
quotes are cached, time out in 5 seconds, and after three consecutive failures
a breaker sends every checkout to the flat rate for a minute. The checkout keeps
working; the customer never waits on a courier's outage.

**What is deliberately not solved here:** an in-memory rate limiter and quote
cache are per-instance by nature. The money endpoints therefore count in the
database as well. Beyond this, the next step is a limit at the edge (Vercel
Firewall or Cloudflare), which is configuration rather than code.

## Deploying to Vercel

Set these in **Project → Settings → Environment Variables**, then redeploy.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Postgres. Supabase's **pooled** URI (port 6543), not the direct one |
| `NEXT_PUBLIC_SITE_URL` | **yes** | e.g. `https://chefammar.my` — the gateway redirects back here |
| `NEXT_PUBLIC_PAYMENT_GATEWAY` | no | `bayarcash` (default) or `chip` |
| `BAYARCASH_PAT` | to take money | Personal Access Token from the Bayarcash console |
| `BAYARCASH_PORTAL_KEY` | to take money | The portal money is collected into |
| `BAYARCASH_API_SECRET_KEY` | to take money | Without it, callbacks are rejected and orders never confirm |
| `BAYARCASH_SANDBOX` | no | `1` to use the sandbox console |
| `BAYARCASH_PAYMENT_CHANNEL` | no | Channel id or list; unset, the payer chooses |
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
| `DATABASE_POOL_MAX` | no | Connections per instance. Defaults to `5` — see [Capacity](#capacity) |

### Two things that will stop a deploy misbehaving

**Without `DATABASE_URL` the app refuses to start serving orders.** It does not
fall back to the local development database: a serverless filesystem is
read-only where the app lives and wiped between invocations where it is not, so
orders would fail to save — or save and then vanish. The error names the fix.

**Without gateway credentials, a production deployment refuses to take orders.**
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
3. Nothing to configure in the Bayarcash console: every payment intent carries
   its own `callback_url` and `return_url`, built from `NEXT_PUBLIC_SITE_URL`.
   If the portal offers a default callback URL, setting it to
   `https://your-domain/api/webhooks/bayarcash` does no harm — but the shop does
   not rely on it, which is why `NEXT_PUBLIC_SITE_URL` is the variable that
   matters.
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

1. **Run a Bayarcash sandbox payment end to end** before taking real money — see
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
