import type { Metadata } from "next";

import { PolicyPage } from "@/components/policy-page";
import { shopDetails } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Chef Ammar Product collects, why, who it is shared with, and how to have it removed.",
};

/**
 * Written from what the code actually does, not from a template.
 *
 * Every claim here corresponds to something in the codebase: the cookies named
 * are the cookies set, the third parties named are the only ones contacted, and
 * the affiliate paragraph reflects the query in `src/lib/affiliate/sales.ts`
 * that deliberately never selects a customer's contact details. A privacy
 * policy describing data flows that do not exist is not a safer policy — it is
 * an inaccurate one, and the gap will show the first time somebody asks.
 *
 * If the data flows change, this page changes with them.
 */
export default function PrivacyPage() {
  const details = shopDetails();
  const seller = details.legalName ?? details.tradingName;

  return (
    <PolicyPage title="Privacy policy." updated="8 August 2026">
      <p>
        This page explains what {seller} collects when you use this shop, why, and who it is shared
        with. It is written to match how the shop actually works rather than to cover every
        eventuality.
      </p>

      <h2>What we collect</h2>

      <h3>When you place an order</h3>
      <p>
        To take an order and get it to you, we collect your <strong>name</strong>,{" "}
        <strong>email address</strong>, <strong>phone number</strong> and{" "}
        <strong>delivery address</strong>, along with what you bought and what you paid. Any note you
        add to the order is stored with it.
      </p>
      <p>
        We do not store your card or banking details at any point. Payment happens on the payment
        gateway&rsquo;s own pages, and the shop only ever receives a reference and a result.
      </p>

      <h3>When you sign up for the newsletter</h3>
      <p>Your email address, and nothing else. You can remove it at any time using the link in any email we send.</p>

      <h3>What your browser stores</h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Purpose</th>
            <th>Kept for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Your bag</td>
            <td>Remembers what you added, so it survives a refresh. Stored on your device only.</td>
            <td>Until you clear it</td>
          </tr>
          <tr>
            <td>
              <code>chef_ammar_ref</code>
            </td>
            <td>Records that you arrived through a partner&rsquo;s referral link, so they are credited.</td>
            <td>30 days</td>
          </tr>
          <tr>
            <td>
              <code>chef_ammar_orders</code>
            </td>
            <td>A list of order references placed from this browser, so you can reopen your own orders.</td>
            <td>180 days</td>
          </tr>
        </tbody>
      </table>
      <p>
        There is no advertising, analytics or third-party tracking on this shop. Nothing here follows
        you to other websites.
      </p>

      <h2>Who your details are shared with</h2>
      <p>Only the businesses needed to complete your order:</p>
      <ul>
        <li>
          <strong>The payment gateway</strong>, which takes the payment. Your name and email are
          passed so the payment can be matched to your order.
        </li>
        <li>
          <strong>The courier</strong>, which needs your name, phone number and delivery address to
          deliver the parcel.
        </li>
        <li>
          <strong>Our email provider</strong>, which sends your order confirmation and delivery
          updates.
        </li>
      </ul>
      <p>
        We do not sell your details, and we do not share them for anyone else&rsquo;s marketing.
      </p>

      <h3>What our partners can see</h3>
      <p>
        If you arrived through a partner&rsquo;s referral link, that partner can see that an order was
        placed, what it was worth and which state it went to &mdash; and your <strong>first name
        only</strong>. They cannot see your email address, phone number or delivery address. Those
        stay with the shop.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Order records are kept for seven years, because tax and accounting rules require it. If you
        ask us to delete your details, we will remove everything we are not legally required to keep.
      </p>

      <h2>Your rights</h2>
      <p>
        Under Malaysia&rsquo;s Personal Data Protection Act 2010, you can ask us to show you what we
        hold about you, correct anything wrong, or delete it. You can also withdraw consent for
        marketing at any time without affecting an order in progress.
      </p>
      <p>
        {details.supportEmail ? (
          <>
            Email <a href={`mailto:${details.supportEmail}`}>{details.supportEmail}</a> and we will
            respond within 21 days, as the Act requires.
          </>
        ) : (
          "Contact us using the details on the contact page and we will respond within 21 days, as the Act requires."
        )}
      </p>

      <h2>Keeping it safe</h2>
      <p>
        Order data is held in an access-controlled database. Order pages cannot be opened with a guess
        &mdash; they need the signed link we email you, or the browser that placed the order. Staff
        and partner accounts each sign in separately, and passwords are stored hashed, never in a form
        anyone can read.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes we will update the date at the top. Continuing to use the shop after a
        change means accepting the updated version.
      </p>
    </PolicyPage>
  );
}
