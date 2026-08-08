import type { Metadata } from "next";

import { PolicyPage } from "@/components/policy-page";
import { shopDetails } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Terms of sale",
  description: "The terms you agree to when buying from Chef Ammar Product.",
};

export default function TermsPage() {
  const details = shopDetails();
  const seller = details.legalName ?? details.tradingName;

  return (
    <PolicyPage title="Terms of sale." updated="8 August 2026">
      <p>
        These are the terms you agree to when you buy from {seller}. They are deliberately short: a
        page nobody can read protects nobody.
      </p>

      <h2>Who you are buying from</h2>
      <p>
        {details.legalName ? (
          <>
            {details.legalName}
            {details.registrationNumber ? ` (${details.registrationNumber})` : ""}, trading as{" "}
            {details.tradingName}.
          </>
        ) : (
          <>The seller&rsquo;s registered details are not yet published on this site.</>
        )}
      </p>
      {details.addressLines.length > 0 && (
        <p>
          {details.addressLines.map((line, i) => (
            <span key={line}>
              {line}
              {i < details.addressLines.length - 1 && <br />}
            </span>
          ))}
        </p>
      )}

      <h2>Placing an order</h2>
      <p>
        An order is an offer to buy. It is accepted when we confirm it by email &mdash; not when you
        click pay. If we cannot fulfil an order after payment, for example because something sold out
        between your order and our packing, we will tell you and refund you in full.
      </p>
      <p>
        We may refuse or cancel an order where a price or product description was clearly wrong, where
        we cannot deliver to the address given, or where we have reason to think an order is
        fraudulent. In every one of those cases you get a full refund.
      </p>

      <h2>Prices and payment</h2>
      <ul>
        <li>Prices are in Malaysian Ringgit and include any applicable tax.</li>
        <li>Delivery is shown separately, before you pay.</li>
        <li>Payment is taken through our payment gateway. We never see or store your card details.</li>
        <li>
          The price of an order is the price shown at checkout. Prices can change, but never for an
          order already placed.
        </li>
      </ul>

      <h2>Discount codes</h2>
      <p>
        Codes apply to the goods total and not to delivery. One code per order. Codes may have a
        minimum spend, a usage limit or an expiry date, and can be withdrawn at any time &mdash;
        though never on an order already placed with one.
      </p>

      <h2>Delivery, returns and refunds</h2>
      <p>
        Delivery times and charges are on the <a href="/shipping">delivery page</a>. When we will
        replace or refund an order is on the <a href="/returns">returns page</a>. Both form part of
        these terms.
      </p>

      <h2>The product</h2>
      <p>
        These are cooking pastes containing spices and other food ingredients. Ingredients and
        nutrition are printed on every jar and shown on each product page.{" "}
        <strong>If you have a food allergy, read the label before eating</strong> &mdash; we cannot
        guarantee the absence of trace ingredients from a shared kitchen.
      </p>
      <p>
        Photographs are of the actual product, but colour varies between screens and between batches
        of a natural product. That is not a defect.
      </p>

      <h2>Our responsibility</h2>
      <p>
        We are responsible for delivering what you ordered, in good condition. If we get that wrong we
        will replace it or refund you.
      </p>
      <p>
        Beyond that, our liability for any order is limited to what you paid for it. Nothing in these
        terms limits liability for death or personal injury caused by our negligence, for fraud, or
        for anything else that cannot be limited by Malaysian law &mdash; including your rights under
        the Consumer Protection Act 1999, which these terms do not affect.
      </p>

      <h2>Partner and affiliate accounts</h2>
      <p>
        If you promote our products under a referral code, commission is earned on completed orders
        only. An order that is cancelled, refunded or never paid for earns nothing. Codes may be
        withdrawn if used in a way that misleads customers, including spam or claims we have not made.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by Malaysian law, and the Malaysian courts have jurisdiction over any dispute.</p>

      <h2>Changes</h2>
      <p>
        We may update these terms. The version that applies to your order is the one published when
        you placed it.
      </p>
    </PolicyPage>
  );
}
