/**
 * Deciding to send, exactly once.
 *
 * A payment webhook can arrive twice — gateways retry when they do not get a
 * prompt 200, and CHIP is no exception. Two confirmations for one order is a
 * small embarrassment; two *shipping* notices with different tracking numbers
 * is a support call. So the decision to send is a database write, not a
 * judgement made in JavaScript.
 *
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING` is the claim: whichever caller
 * wins the insert gets a row back and sends, and everyone else gets nothing and
 * stops. Two requests racing on the same order cannot both win, because the
 * primary key will not allow it.
 *
 * A failed send is recorded rather than retried in place. The row stays, marked
 * `failed` with the reason, so the shop owner can see that a customer was not
 * told — silence is the worst outcome here, and an unrecorded failure is
 * silence.
 */

import { getDb } from "@/lib/db/client";
import { getMailer, type MailMessage } from "@/lib/notifications/mailer";

export type NotificationKind = "order_confirmed" | "order_shipped" | "order_refunded";

export type DispatchOutcome =
  | { sent: true; driver: string }
  | { sent: false; reason: "already_claimed" | "send_failed"; error?: string };

/**
 * Sends `message` about `orderId` unless it has already been claimed.
 *
 * Never throws. Callers are payment and fulfilment paths whose own work has
 * already succeeded; an email problem must not unwind a settled order.
 */
export async function dispatch(
  orderId: string,
  kind: NotificationKind,
  message: MailMessage,
): Promise<DispatchOutcome> {
  try {
    const db = await getDb();

    const claim = await db.query<{ order_id: string }>(
      `INSERT INTO order_notifications (order_id, kind, recipient)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_id, kind) DO NOTHING
       RETURNING order_id`,
      [orderId, kind, message.to],
    );

    if (claim.rows.length === 0) return { sent: false, reason: "already_claimed" };

    const result = await getMailer().send(message);

    if (result.ok) {
      await db.query(
        `UPDATE order_notifications
            SET status = 'sent', driver = $3, sent_at = now(), error = NULL
          WHERE order_id = $1 AND kind = $2`,
        [orderId, kind, result.driver],
      );
      return { sent: true, driver: result.driver };
    }

    await db.query(
      `UPDATE order_notifications
          SET status = 'failed', driver = $3, error = $4
        WHERE order_id = $1 AND kind = $2`,
      [orderId, kind, result.driver, result.error.slice(0, 1000)],
    );
    console.error(`Failed to send ${kind} for order ${orderId}: ${result.error}`);
    return { sent: false, reason: "send_failed", error: result.error };
  } catch (error) {
    // Even the bookkeeping is best-effort. If the notifications table is
    // unreachable, the order is still paid and the customer still bought
    // something.
    console.error(`Notification bookkeeping failed for ${kind} on ${orderId}`, error);
    return { sent: false, reason: "send_failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export type NotificationRecord = {
  kind: string;
  recipient: string;
  status: "pending" | "sent" | "failed";
  driver: string | null;
  error: string | null;
  sentAt: string | null;
};

/** What has been sent about an order, for the admin to show. */
export async function notificationsFor(orderId: string): Promise<NotificationRecord[]> {
  const db = await getDb();
  const rows = await db.query<{
    kind: string;
    recipient: string;
    status: NotificationRecord["status"];
    driver: string | null;
    error: string | null;
    sent_at: Date | string | null;
  }>(
    `SELECT kind, recipient, status, driver, error, sent_at
       FROM order_notifications
      WHERE order_id = $1
      ORDER BY claimed_at`,
    [orderId],
  );

  return rows.rows.map((row) => ({
    kind: row.kind,
    recipient: row.recipient,
    status: row.status,
    driver: row.driver,
    error: row.error,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  }));
}

/**
 * Clears a claim so the message can be sent again.
 *
 * For the shop owner to retry a delivery that failed. Only ever removes a row
 * that is not `sent`, so this cannot be used to send a customer a second copy
 * of something they already received.
 */
export async function clearFailedClaim(orderId: string, kind: NotificationKind): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `DELETE FROM order_notifications
      WHERE order_id = $1 AND kind = $2 AND status <> 'sent'
      RETURNING order_id`,
    [orderId, kind],
  );
  return rows.rows.length === 1;
}
