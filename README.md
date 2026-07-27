# Chef Ammar Marketplace

Storefront for the Chef Ammar cooking paste range — Kabsah, Mandy and Briyani —
built with Next.js App Router, TypeScript, Tailwind CSS v4 and shadcn/ui.

## Run

```bash
npm install
cp .env.example .env.local   # optional; the shop runs without it
npm run dev
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

## Product help (offline answer bot)

A support bot that answers customer questions with **no LLM, no API calls and
no per-message cost**. Answers live as markdown in `content/help/`; the browser
ranks them with BM25 and shows the best match.

It *retrieves* a written answer rather than generating one, so it cannot invent
a price or a policy — and when nothing clears the confidence threshold it says
so instead of guessing. Verified in-browser to issue zero network requests
while answering.

- **Add or edit an answer:** drop a `.md` file in `content/help/` with `title`,
  `category` and `keywords` frontmatter. Nothing else to register.
- **Live figures:** answers may use `{{delivery.west}}`, `{{price.from}}`,
  `{{nutrition.energy}}` and similar. These resolve at build from
  `shipping.ts`/`products.ts`, so a price change cannot leave the FAQ stale. An
  unknown placeholder fails the build rather than shipping `{{...}}`.
- **Phrasing:** `src/lib/help/tokenize.ts` maps customer wording onto canonical
  terms, so "postage", "courier" and "shipping" all reach the delivery answer.

Run `npm test` after changing the content or the engine — the suite asserts
that real questions route to the right document, that typos still match, and
that off-topic questions are declined.

## Product assets

`public/products/*.webp` are transparent cutouts used throughout the site;
the untouched studio photographs are kept in `public/products/source/`.

Weight, nutrition and the Malay heritage note in `src/lib/products.ts` are
transcribed from the physical labels, and each product's `accent` is sampled
from its label colour band.

## Still to do

1. **Persist orders.** `src/lib/orders.ts` currently uses an in-process `Map`:
   orders do not survive a restart and are not shared between serverless
   instances. Reimplement `OrderStore` against Supabase/Postgres — no callers
   need to change.
2. Send order confirmation emails.
3. Admin order management and weekly commission reporting.
4. Lifestyle/recipe photography for the story section.
