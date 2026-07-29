/**
 * The emails the shop sends.
 *
 * Written as plain text first and HTML second, because the text part is what a
 * watch, a screen reader or a stripped-down client will show, and it is what
 * lands in a spam filter's fallback. Neither part is allowed to be a
 * placeholder for the other.
 *
 * The HTML is table-free, inline-styled and narrow on purpose: mail clients are
 * not browsers, and anything relying on a stylesheet or a modern layout is a
 * coin flip. There are no images, so nothing depends on a client that blocks
 * them by default.
 *
 * Every link carries the order's access token, because the order page no longer
 * opens on a reference alone.
 */

import { issueOrderToken } from "@/lib/order-access";
import type { Order } from "@/lib/orders";
import { money } from "@/lib/utils";

/** Escapes text before it goes into the HTML part. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function orderUrl(reference: string): string {
  const token = issueOrderToken(reference);
  return `${siteUrl()}/orders/${reference}${token ? `?t=${token}` : ""}`;
}

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] || "there";

function itemLines(order: Order): string[] {
  return order.items.map((item) => `  ${item.quantity} × ${item.name} — ${money(item.lineTotal)}`);
}

function itemRows(order: Order): string {
  return order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e3dbcc;">
          ${escape(item.name)}<br>
          <span style="color:#5f5a50;font-size:13px;">${item.quantity} × ${money(item.unitPrice)}</span>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #e3dbcc;text-align:right;white-space:nowrap;">
          ${money(item.lineTotal)}
        </td>
      </tr>`,
    )
    .join("");
}

function shell(heading: string, body: string, cta: { label: string; href: string }): string {
  return `<div style="margin:0;padding:24px 12px;background:#f5f0e7;font-family:Georgia,'Times New Roman',serif;color:#25241f;">
  <div style="max-width:560px;margin:0 auto;background:#fbf6ee;border:1px solid #d7cdbd;border-radius:8px;padding:32px;">
    <p style="margin:0 0 24px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9b3d29;">
      Chef Ammar
    </p>
    <h1 style="margin:0 0 20px;font-size:28px;line-height:1.15;font-weight:normal;">${escape(heading)}</h1>
    ${body}
    <p style="margin:32px 0 0;">
      <a href="${cta.href}" style="display:inline-block;background:#9b3d29;color:#fbf3ea;text-decoration:none;padding:12px 22px;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">
        ${escape(cta.label)}
      </a>
    </p>
    <p style="margin:28px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#5f5a50;">
      Questions? Just reply to this email.
    </p>
  </div>
</div>`;
}

function totalsBlock(order: Order): string {
  return `
      <tr>
        <td style="padding:10px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#5f5a50;">Subtotal</td>
        <td style="padding:10px 0 0;text-align:right;">${money(order.subtotal)}</td>
      </tr>
      <tr>
        <td style="font-family:Arial,sans-serif;font-size:13px;color:#5f5a50;">Delivery</td>
        <td style="text-align:right;">${order.shipping === 0 ? "Free" : money(order.shipping)}</td>
      </tr>
      <tr>
        <td style="padding-top:8px;font-weight:bold;">Total</td>
        <td style="padding-top:8px;text-align:right;font-weight:bold;">${money(order.total)}</td>
      </tr>`;
}

export function orderConfirmedEmail(order: Order) {
  const link = orderUrl(order.reference);
  const text = [
    `Hi ${firstName(order.customer.fullName)},`,
    "",
    `Thank you — we have your payment and your order is confirmed.`,
    "",
    `Order ${order.reference}`,
    ...itemLines(order),
    "",
    `  Subtotal   ${money(order.subtotal)}`,
    `  Delivery   ${order.shipping === 0 ? "Free" : money(order.shipping)}`,
    `  Total      ${money(order.total)}`,
    "",
    "Delivering to:",
    `  ${order.customer.fullName}`,
    `  ${order.address.line1}`,
    ...(order.address.line2 ? [`  ${order.address.line2}`] : []),
    `  ${order.address.postcode} ${order.address.city}`,
    `  ${order.address.state}`,
    "",
    "We will email you again with a tracking number as soon as it ships.",
    "",
    `Track your order: ${link}`,
    "",
    "Chef Ammar",
  ].join("\n");

  const html = shell(
    "Your order is confirmed.",
    `<p style="margin:0 0 20px;font-size:16px;line-height:1.7;">
       Thank you, ${escape(firstName(order.customer.fullName))} — we have your payment and your jars are being packed.
       We will email you a tracking number as soon as it ships.
     </p>
     <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#5f5a50;">
       Order ${escape(order.reference)}
     </p>
     <table style="width:100%;border-collapse:collapse;font-size:15px;">${itemRows(order)}${totalsBlock(order)}</table>
     <p style="margin:24px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#5f5a50;">
       Delivering to<br>
       ${escape(order.customer.fullName)}<br>
       ${escape(order.address.line1)}<br>
       ${order.address.line2 ? `${escape(order.address.line2)}<br>` : ""}
       ${escape(order.address.postcode)} ${escape(order.address.city)}<br>
       ${escape(order.address.state)}
     </p>`,
    { label: "Track your order", href: link },
  );

  return { subject: `Order ${order.reference} confirmed — Chef Ammar`, text, html };
}

export function orderShippedEmail(order: Order) {
  const link = orderUrl(order.reference);
  const tracking = order.trackingNumber?.trim();

  const text = [
    `Hi ${firstName(order.customer.fullName)},`,
    "",
    `Good news — order ${order.reference} is on its way.`,
    "",
    ...(tracking ? [`Tracking number: ${tracking}`, ""] : []),
    ...itemLines(order),
    "",
    "Delivering to:",
    `  ${order.address.line1}`,
    `  ${order.address.postcode} ${order.address.city}, ${order.address.state}`,
    "",
    `See your order: ${link}`,
    "",
    "Chef Ammar",
  ].join("\n");

  const html = shell(
    "It is on its way.",
    `<p style="margin:0 0 20px;font-size:16px;line-height:1.7;">
       Good news, ${escape(firstName(order.customer.fullName))} — order
       ${escape(order.reference)} has been handed to the courier.
     </p>
     ${
       tracking
         ? `<p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:14px;">
              Tracking number<br>
              <strong style="font-size:18px;letter-spacing:.04em;">${escape(tracking)}</strong>
            </p>`
         : ""
     }
     <table style="width:100%;border-collapse:collapse;font-size:15px;">${itemRows(order)}</table>
     <p style="margin:24px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#5f5a50;">
       Delivering to<br>
       ${escape(order.address.line1)}<br>
       ${escape(order.address.postcode)} ${escape(order.address.city)}, ${escape(order.address.state)}
     </p>`,
    { label: "See your order", href: link },
  );

  return { subject: `Order ${order.reference} has shipped — Chef Ammar`, text, html };
}
