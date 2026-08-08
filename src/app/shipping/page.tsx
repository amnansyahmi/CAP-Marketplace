import type { Metadata } from "next";
import Link from "next/link";

import { PolicyPage } from "@/components/policy-page";
import { ZONE_RATES } from "@/lib/shipping";
import { money } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Delivery",
  description: "What delivery costs, how long it takes, and where Chef Ammar Product ships to.",
};

/**
 * The rates here are read from `ZONE_RATES` rather than typed out, so the page
 * cannot drift from what checkout actually charges. A delivery page quoting a
 * price the shop stopped using is a complaint waiting to happen.
 */
export default function ShippingPage() {
  return (
    <PolicyPage title="Delivery." updated="8 August 2026">
      <p>
        We deliver anywhere in Malaysia. Everything is packed to survive the trip &mdash; these are
        glass jars, so they get wrapped properly rather than dropped in a bag.
      </p>

      <h2>What it costs</h2>
      <table>
        <thead>
          <tr>
            <th>Destination</th>
            <th>Delivery</th>
            <th>Free when you spend</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{ZONE_RATES.west.label}</td>
            <td>{money(ZONE_RATES.west.fee)}</td>
            <td>{money(ZONE_RATES.west.freeFrom)} or more</td>
          </tr>
          <tr>
            <td>{ZONE_RATES.east.label}</td>
            <td>{money(ZONE_RATES.east.fee)}</td>
            <td>{money(ZONE_RATES.east.freeFrom)} or more</td>
          </tr>
        </tbody>
      </table>
      <p>
        Where a courier gives us a live quote, you will see the options at checkout and can pick the
        one that suits you. Otherwise the rates above apply. Either way, the price you see before you
        pay is the price you pay &mdash; nothing is added afterwards.
      </p>

      <h2>How long it takes</h2>
      <ul>
        <li>
          <strong>{ZONE_RATES.west.label}</strong> &mdash; 2 to 4 working days
        </li>
        <li>
          <strong>{ZONE_RATES.east.label}</strong> &mdash; 3 to 6 working days
        </li>
      </ul>
      <p>
        Orders are packed within 1 to 2 working days. Those are the courier&rsquo;s estimates, not a
        guarantee: festive weeks, the monsoon and rural routes all add time, and we would rather say
        so than quote a number we cannot hold to.
      </p>

      <h2>Tracking your parcel</h2>
      <p>
        You will get an email when your order is confirmed, and another with a tracking number when it
        ships. The link in either email opens your order at any time &mdash; you do not need an
        account.
      </p>
      <p>
        Lost the email? You can{" "}
        <Link href="/orders/find">look your order up</Link> with your order reference and the email address
        you used.
      </p>

      <h2>Getting the address right</h2>
      <p>
        We send parcels to the address given at checkout. Please check it before paying &mdash; once a
        parcel is with the courier we cannot redirect it, and a parcel returned as undeliverable can
        only be resent at the cost of another delivery charge.
      </p>

      <h2>Storing what arrives</h2>
      <p>
        Unopened jars keep in a cool, dry cupboard until the date on the label. Once opened, keep them
        refrigerated and use within the period stated on the jar.
      </p>
    </PolicyPage>
  );
}
