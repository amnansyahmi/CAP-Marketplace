/**
 * Where order emails get triggered.
 *
 * Deliberately called from the *result* of a state change rather than before
 * it. `setStatus` and `setFulfilment` both return undefined when the database
 * refuses the change, so a caller that only notifies on a returned order will
 * never announce a transition that did not happen — for instance a late
 * "failed" callback arriving after the payment already settled.
 *
 * That is the first line of defence against duplicates; `dispatch` is the
 * second, and the durable one.
 */

import { dispatch } from "@/lib/notifications/dispatch";
import {
  orderConfirmedEmail,
  orderRefundedEmail,
  orderShippedEmail,
} from "@/lib/notifications/templates";
import type { Order } from "@/lib/orders";

/** Call with the order returned by a status change, when it became paid. */
export async function notifyOrderPaid(order: Order): Promise<void> {
  if (order.status !== "paid") return;
  const email = orderConfirmedEmail(order);
  await dispatch(order.id, "order_confirmed", { to: order.customer.email, ...email });
}

/** Call with the order returned by a fulfilment change, when it became shipped. */
export async function notifyOrderShipped(order: Order): Promise<void> {
  if (order.fulfilment !== "shipped") return;
  const email = orderShippedEmail(order);
  await dispatch(order.id, "order_shipped", { to: order.customer.email, ...email });
}

/** Call with the order returned by a refund. */
export async function notifyOrderRefunded(order: Order): Promise<void> {
  if (!order.refundedAt) return;
  const email = orderRefundedEmail(order);
  await dispatch(order.id, "order_refunded", { to: order.customer.email, ...email });
}
