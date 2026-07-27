# Chef Ammar Marketplace

A custom mobile-first storefront built with Next.js App Router, TypeScript, Tailwind CSS and editable shadcn/ui-style primitives.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## What is included

- Editorial, non-template storefront
- Responsive product grid
- Functional client-side cart drawer
- MYR currency formatting
- Customised Button, Sheet and Separator primitives
- Product data kept in `src/lib/products.ts`
- Placeholder SVG product artwork in `public/products`

## Next production steps

1. Replace SVG placeholders with final Chef Ammar product photography.
2. Add checkout/customer form and delivery-rate logic.
3. Create server-side order records in Supabase/PostgreSQL.
4. Create a CHIP payment request on the server.
5. Verify CHIP webhooks before marking an order as paid.
6. Add admin order management and weekly commission reporting.

The current `Continue to checkout` button is deliberately a UI-only step; no payment is collected yet.
