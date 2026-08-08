import type { Metadata } from "next";

import { PolicyPage } from "@/components/policy-page";
import { shopDetails } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Returns and refunds",
  description: "When Chef Ammar Product will replace or refund an order, and how to ask.",
};

/**
 * Food is the awkward case: most of it cannot be resold once it has left, so a
 * blanket "30 day returns" would be a promise the shop cannot keep. This says
 * what it will actually do — replace or refund anything that arrives damaged,
 * wrong or short — and is honest that a changed mind about an opened jar is
 * not covered.
 *
 * The refund mechanics described here match `orderStore.refund`: full amount
 * including delivery, back to the original payment method.
 */
export default function ReturnsPage() {
  const details = shopDetails();

  return (
    <PolicyPage title="Returns and refunds." updated="8 August 2026">
      <p>
        We want you to cook with these, not argue with us about them. If something is wrong with your
        order, tell us and we will put it right.
      </p>

      <h2>What we will always put right</h2>
      <p>We will replace or refund, whichever you prefer, if:</p>
      <ul>
        <li>a jar arrives <strong>broken, leaking or damaged</strong></li>
        <li>you received the <strong>wrong product</strong></li>
        <li>your order is <strong>missing something</strong> you paid for</li>
        <li>the paste is <strong>past its date</strong> on arrival, or spoiled</li>
      </ul>
      <p>
        Tell us within <strong>7 days</strong> of delivery. A photo helps and usually means we can
        settle it immediately without asking you to send anything back.
      </p>

      <h2>What we cannot take back</h2>
      <p>
        This is food. Once a jar has left us we cannot resell it, so we cannot accept a return simply
        because you changed your mind, or because a paste was not to your taste. That is not us being
        difficult &mdash; it is what food safety rules require of anyone selling groceries.
      </p>
      <p>
        If a jar is <strong>unopened and still sealed</strong> and you contact us within 7 days of
        delivery, get in touch anyway. We will do what we reasonably can, though return postage would
        be yours in that case.
      </p>

      <h2>Cancelling before it ships</h2>
      <p>
        If your order has not been handed to the courier yet, we can cancel it and refund you in full.
        Contact us as soon as you can &mdash; we pack quickly, and once a parcel is with the courier
        it has to be delivered before anything can be sorted out.
      </p>

      <h2>How a refund works</h2>
      <ul>
        <li>Refunds are for the <strong>full amount you paid, delivery included</strong>, unless only part of an order was affected.</li>
        <li>The money goes back to the <strong>card or account you paid with</strong>. We cannot send it anywhere else.</li>
        <li>We process it as soon as we have agreed it. Depending on your bank it can take up to <strong>7 working days</strong> to appear on your statement &mdash; that delay is the bank&rsquo;s, not ours.</li>
        <li>You will get an email when we process it.</li>
      </ul>

      <h2>If your parcel does not arrive</h2>
      <p>
        Tracking sometimes says delivered before a parcel actually reaches you, so it is worth
        checking with your neighbours and household first. If it still has not turned up{" "}
        <strong>7 days</strong> after the tracking last moved, contact us and we will chase the
        courier. If the parcel is genuinely lost, you get a replacement or a full refund.
      </p>

      <h2>How to ask</h2>
      <p>
        {details.supportEmail ? (
          <>
            Email <a href={`mailto:${details.supportEmail}`}>{details.supportEmail}</a> with your
            order reference (it looks like <code>CA-XXXXXX</code>) and, if something arrived damaged, a
            photo.
          </>
        ) : (
          <>
            Use the details on the contact page, and have your order reference to hand (it looks like{" "}
            <code>CA-XXXXXX</code>).
          </>
        )}
      </p>
      <p>
        None of this affects your rights under the Consumer Protection Act 1999. If something is not
        as described, the law is on your side and so are we.
      </p>
    </PolicyPage>
  );
}
