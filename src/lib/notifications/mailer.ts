/**
 * Sending email, without committing to a provider.
 *
 * The shop needs to tell customers their order was received and later that it
 * shipped. What it must *not* do is make that depend on a particular vendor, or
 * let a vendor outage break checkout.
 *
 * Two rules:
 *
 * 1. **Sending never fails an order.** A payment that succeeded and an email
 *    that did not are two different facts. Every send returns a result rather
 *    than throwing, and callers record the failure instead of unwinding a sale.
 * 2. **No credentials, no silent pretending.** With nothing configured the
 *    console driver logs what *would* have been sent, and says so. A shop with
 *    a broken mail setup should be able to tell it is broken.
 *
 * Selecting a driver:
 *   MAIL_DRIVER=resend   – needs RESEND_API_KEY and MAIL_FROM
 *   MAIL_DRIVER=console  – logs to the server console (the default)
 *   MAIL_DRIVER=none     – drops silently, for tests
 */

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain text, always present — some clients never render the HTML. */
  text: string;
  html: string;
  replyTo?: string;
};

export type MailResult =
  | { ok: true; driver: string; id?: string }
  | { ok: false; driver: string; error: string };

export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<MailResult>;
}

/** Where mail appears to come from. */
export function mailFrom(): string {
  return process.env.MAIL_FROM || "Chef Ammar <orders@example.invalid>";
}

/** Logs the message instead of sending it. The default when nothing is set up. */
class ConsoleMailer implements Mailer {
  readonly name = "console";
  async send(message: MailMessage): Promise<MailResult> {
    console.info(
      [
        "",
        "──────── email (not actually sent) ────────",
        `to:      ${message.to}`,
        `from:    ${mailFrom()}`,
        `subject: ${message.subject}`,
        "",
        message.text,
        "───────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { ok: true, driver: this.name };
  }
}

class NoopMailer implements Mailer {
  readonly name = "none";
  async send(): Promise<MailResult> {
    return { ok: true, driver: this.name };
  }
}

/**
 * Resend over plain fetch.
 *
 * No SDK: the API is one POST, and a dependency here would have to be kept
 * current for no benefit. Failures come back as a result, never as a throw.
 */
class ResendMailer implements Mailer {
  readonly name = "resend";
  constructor(private readonly apiKey: string) {}

  async send(message: MailMessage): Promise<MailResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: mailFrom(),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
        // A slow mail provider must not hold a webhook open until it times out.
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { ok: false, driver: this.name, error: `HTTP ${response.status} ${body.slice(0, 300)}` };
      }

      const data = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, driver: this.name, id: data.id };
    } catch (error) {
      return { ok: false, driver: this.name, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * The mailer for this environment.
 *
 * Resolved per call rather than cached at module load, so tests and the demo
 * can change the environment without a stale driver surviving the change.
 */
export function getMailer(): Mailer {
  const driver = (process.env.MAIL_DRIVER || "").toLowerCase();

  if (driver === "none") return new NoopMailer();
  if (driver === "resend" || (!driver && process.env.RESEND_API_KEY)) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      // Asked for Resend without a key: log rather than drop, so the mistake is
      // visible instead of looking like mail that simply never arrives.
      console.warn("MAIL_DRIVER=resend but RESEND_API_KEY is not set — falling back to the console driver.");
      return new ConsoleMailer();
    }
    return new ResendMailer(key);
  }
  return new ConsoleMailer();
}
