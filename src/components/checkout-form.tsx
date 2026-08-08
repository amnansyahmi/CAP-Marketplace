"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useCart } from "@/lib/cart-context";
import { hasErrors, validateCheckout, type FieldErrors } from "@/lib/checkout-schema";
import { MALAYSIAN_STATES, quoteShipping, round } from "@/lib/shipping";
import { money } from "@/lib/utils";

/** What /api/shipping/rates returns. Prices only — costs stay server-side. */
type DeliveryQuoteResponse = {
  options: {
    id: string;
    courierName: string;
    serviceName: string;
    price: number;
    deliveryEstimate?: string;
    fallback: boolean;
  }[];
  source: "easyparcel" | "flat";
  free: boolean;
  amountToFree: number | null;
  zoneLabel: string;
};
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Values = {
  fullName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  state: string;
  notes: string;
};

/** Form order, so "first error" means first on screen rather than first in the object. */
const FIELD_ORDER: (keyof Values)[] = [
  "fullName",
  "email",
  "phone",
  "line1",
  "postcode",
  "city",
  "state",
];

/**
 * Move focus to the first field that failed. Without this the errors render but
 * focus stays on the submit button, so keyboard and screen-reader users get no
 * indication that anything went wrong.
 */
function focusFirstError(errors: FieldErrors) {
  const first = FIELD_ORDER.find((key) => errors[key]);
  if (!first) return;
  const el = document.getElementById(first);
  el?.focus();
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

const EMPTY: Values = {
  fullName: "",
  email: "",
  phone: "",
  line1: "",
  line2: "",
  postcode: "",
  city: "",
  state: "",
  notes: "",
};

export function CheckoutForm() {
  const router = useRouter();
  const { lines, subtotal, count, hydrated, clear } = useCart();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Applied here only so the customer sees the right figure; the order API
  // redeems and recomputes it, and its answer is the one that counts.
  const [discount, setDiscount] = useState<{ code: string; amount: number } | null>(null);
  const [discountInput, setDiscountInput] = useState("");
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [checkingDiscount, setCheckingDiscount] = useState(false);

  const discountedSubtotal = round(subtotal - (discount?.amount ?? 0));

  // Courier options for the chosen state. The flat zone rate is used until
  // these arrive, and stays if they never do — checkout must not depend on a
  // courier API being up.
  const [rates, setRates] = useState<DeliveryQuoteResponse | null>(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [chosenService, setChosenService] = useState<string | null>(null);

  const fallbackQuote = useMemo(
    () => quoteShipping(discountedSubtotal, values.state || null),
    [discountedSubtotal, values.state],
  );

  const chosen =
    rates?.options.find((option) => option.id === chosenService) ?? rates?.options[0] ?? null;
  const shippingFee = chosen ? chosen.price : (fallbackQuote?.fee ?? 0);
  const shipping = fallbackQuote;
  const total = round(discountedSubtotal + shippingFee);

  const bagKey = lines.map((l) => `${l.product.id}:${l.quantity}`).join(",");

  useEffect(() => {
    const state = values.state;
    if (!state) {
      setRates(null);
      return;
    }

    const controller = new AbortController();
    setRatesLoading(true);

    fetch("/api/shipping/rates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state,
        postcode: values.postcode,
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
      }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DeliveryQuoteResponse | null) => {
        if (!data?.options?.length) {
          setRates(null);
          return;
        }
        setRates(data);
        // Default to the cheapest, which is what the list is sorted by.
        setChosenService((current) =>
          current && data.options.some((o) => o.id === current) ? current : data.options[0].id,
        );
      })
      .catch(() => {
        // Aborted or offline. Leaving `rates` null keeps the flat rate showing
        // rather than blanking the delivery line.
      })
      .finally(() => setRatesLoading(false));

    return () => controller.abort();
    // Postcode is deliberately not a dependency: rates change by state and by
    // what is in the bag, and refetching on every keystroke of a postcode
    // would hammer the courier API for no benefit.
  }, [values.state, bagKey, discountedSubtotal]);

  async function applyDiscount() {
    const code = discountInput.trim();
    if (!code) return;
    setCheckingDiscount(true);
    setDiscountError(null);
    try {
      const response = await fetch("/api/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        }),
      });
      const data = await response.json();
      if (data.ok) {
        setDiscount({ code: data.code, amount: data.amount });
      } else {
        setDiscount(null);
        setDiscountError(data.reason ?? "That code is not valid.");
      }
    } catch {
      setDiscountError("We could not check that code. Please try again.");
    } finally {
      setCheckingDiscount(false);
    }
  }

  const set = (key: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const payload = {
      ...values,
      items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
      // Only sent once applied, so a half-typed code cannot fail the order.
      ...(discount ? { discountCode: discount.code } : {}),
      // The id only. The server re-prices it — the browser never sends money.
      ...(chosen?.id && chosen.id !== "flat" ? { deliveryServiceId: chosen.id } : {}),
    };

    const nextErrors = validateCheckout(payload);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      focusFirstError(nextErrors);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data.errors?.discountCode) {
          // The code stopped being valid between applying it and paying —
          // used up, or expired. Drop it so the total is honest again.
          setDiscount(null);
          setDiscountError(data.errors.discountCode);
        }
        if (data.errors) {
          setErrors(data.errors);
          focusFirstError(data.errors);
        }
        setFormError(data.error ?? "Please check the highlighted fields and try again.");
        return;
      }

      // The bag has become an order — clear it before leaving so a back
      // navigation doesn't offer to buy the same jars twice.
      clear();
      const query = data.accessToken ? `?t=${data.accessToken}` : "";
      if (data.simulated) router.push(`/orders/${data.reference}${query}`);
      else window.location.href = data.checkoutUrl;
    } catch {
      setFormError("We could not reach the payment service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (hydrated && count === 0) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <p className="font-serif text-4xl">Your bag is empty.</p>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Add a paste to the bag and your order will appear here.
        </p>
        <Button asChild variant="warm" size="lg" className="mt-8">
          <Link href="/#collection">Shop the collection</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-14 lg:grid-cols-[1.25fr_.95fr] lg:gap-20">
      <div>
        <fieldset disabled={submitting} className="contents">
          <h2 className="eyebrow">Your details</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field
              className="sm:col-span-2"
              id="fullName"
              label="Full name"
              value={values.fullName}
              onChange={set("fullName")}
              error={errors.fullName}
              autoComplete="name"
            />
            <Field
              id="email"
              label="Email"
              type="email"
              value={values.email}
              onChange={set("email")}
              error={errors.email}
              autoComplete="email"
            />
            <Field
              id="phone"
              label="Phone"
              type="tel"
              placeholder="012-345 6789"
              value={values.phone}
              onChange={set("phone")}
              error={errors.phone}
              autoComplete="tel"
            />
          </div>

          <h2 className="eyebrow mt-12">Delivery address</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field
              className="sm:col-span-2"
              id="line1"
              label="Address"
              value={values.line1}
              onChange={set("line1")}
              error={errors.line1}
              autoComplete="address-line1"
            />
            <Field
              className="sm:col-span-2"
              id="line2"
              label="Apartment, unit, floor"
              optional
              value={values.line2}
              onChange={set("line2")}
              autoComplete="address-line2"
            />
            <Field
              id="postcode"
              label="Postcode"
              inputMode="numeric"
              maxLength={5}
              value={values.postcode}
              onChange={set("postcode")}
              error={errors.postcode}
              autoComplete="postal-code"
            />
            <Field
              id="city"
              label="City"
              value={values.city}
              onChange={set("city")}
              error={errors.city}
              autoComplete="address-level2"
            />
            <div className="sm:col-span-2">
              <Label htmlFor="state" className="mb-2">
                State
              </Label>
              <Select value={values.state} onValueChange={set("state")}>
                <SelectTrigger id="state" aria-invalid={!!errors.state}>
                  <SelectValue placeholder="Choose a state" />
                </SelectTrigger>
                <SelectContent>
                  {MALAYSIAN_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.state && <p className="mt-2 text-xs text-destructive">{errors.state}</p>}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes" className="mb-2">
                Order notes <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="notes"
                value={values.notes}
                onChange={(e) => set("notes")(e.target.value)}
                placeholder="Landmark, delivery preference, anything we should know."
              />
            </div>
          </div>
        </fieldset>
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="eyebrow">Order summary</h2>
          <ul className="mt-6 space-y-5">
            {lines.map(({ product, quantity }) => (
              <li key={product.id} className="flex gap-4">
                <div
                  className="relative size-16 shrink-0 overflow-hidden rounded-md"
                  style={{ backgroundColor: `${product.accent}14` }}
                >
                  <Image src={product.image} alt="" fill sizes="64px" className="object-contain p-1" />
                </div>
                <div className="flex flex-1 justify-between gap-3">
                  <div>
                    <p className="font-serif text-lg leading-tight">{product.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {quantity} × {money(product.price)}
                    </p>
                  </div>
                  <strong className="text-sm">{money(product.price * quantity)}</strong>
                </div>
              </li>
            ))}
          </ul>

          <Separator className="my-6" />

          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{money(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd>
                {!values.state ? (
                  <span className="text-muted-foreground">Choose a state</span>
                ) : ratesLoading && !chosen ? (
                  <span className="text-muted-foreground">Checking couriers…</span>
                ) : shippingFee === 0 ? (
                  <span className="text-primary">Free</span>
                ) : (
                  money(shippingFee)
                )}
              </dd>
            </div>
            {discount && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Discount <span className="font-mono text-xs">{discount.code}</span>
                </dt>
                <dd className="text-primary">−{money(discount.amount)}</dd>
              </div>
            )}
            {shipping?.amountToFree != null && (
              <p className="text-xs leading-5 text-muted-foreground">
                {`Spend ${money(shipping.amountToFree)} more for free delivery to ${shipping.zoneLabel}.`}
              </p>
            )}
          </dl>

          {rates && rates.options.length > 1 && (
            <>
              <Separator className="my-6" />
              <fieldset>
                <legend className="mb-3 text-sm font-medium">Choose a courier</legend>
                <div className="space-y-2">
                  {rates.options.map((option) => (
                    <label
                      key={option.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                        chosen?.id === option.id ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <input
                        type="radio"
                        name="deliveryService"
                        value={option.id}
                        checked={chosen?.id === option.id}
                        onChange={() => setChosenService(option.id)}
                        className="mt-1 accent-[#9b3d29]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{option.courierName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {option.serviceName}
                          {option.deliveryEstimate ? ` · ${option.deliveryEstimate}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold">
                        {option.price === 0 ? (
                          <span className="text-primary">Free</span>
                        ) : (
                          money(option.price)
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {rates.free && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Delivery is on us for this order — pick whichever courier suits you.
                  </p>
                )}
              </fieldset>
            </>
          )}

          <Separator className="my-6" />

          <div>
            <Label htmlFor="discountCode" className="mb-2">
              Discount code
            </Label>
            <div className="flex gap-2">
              <Input
                id="discountCode"
                name="discountCode"
                value={discountInput}
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono uppercase"
                onChange={(e) => setDiscountInput(e.target.value)}
                // Enter inside the checkout form would submit the order rather
                // than apply the code, which is not what anyone means here.
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void applyDiscount();
                  }
                }}
                aria-invalid={!!discountError}
                aria-describedby={discountError ? "discount-error" : undefined}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void applyDiscount()}
                disabled={checkingDiscount || !discountInput.trim()}
              >
                {checkingDiscount ? "Checking…" : "Apply"}
              </Button>
            </div>
            {discountError && (
              <p id="discount-error" role="alert" className="mt-2 text-xs text-destructive">
                {discountError}
              </p>
            )}
            {discount && (
              <p className="mt-2 text-xs text-primary">
                {discount.code} applied — {money(discount.amount)} off.
              </p>
            )}
          </div>

          <Separator className="my-6" />

          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <strong className="font-serif text-3xl">{money(total)}</strong>
          </div>

          {formError && (
            <p role="alert" className="mt-5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {formError}
            </p>
          )}

          <Button type="submit" variant="warm" size="lg" className="mt-6 w-full" disabled={submitting}>
            {submitting ? "Starting payment…" : "Pay with CHIP"}
          </Button>
          <p className="mt-4 text-center text-[10px] uppercase tracking-[.16em] text-muted-foreground">
            Secure checkout powered by CHIP
          </p>
        </div>
      </aside>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  optional,
  className,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  optional?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"input">, "onChange" | "value" | "id">) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-2">
        {label} {optional && <span className="text-muted-foreground">(optional)</span>}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
