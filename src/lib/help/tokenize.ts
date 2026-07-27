/**
 * Tokenisation shared by indexing and querying.
 *
 * Must stay isomorphic (no Node APIs): documents are indexed on the server at
 * build time and queries are tokenised in the browser, and any divergence
 * between the two would silently break matching.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from",
  "get", "has", "have", "how", "i", "if", "in", "is", "it", "its", "me", "my", "no", "not", "of",
  "on", "or", "so", "that", "the", "there", "they", "this", "to", "was", "what",
  "which", "will", "with", "would", "you", "your", "am", "any", "much", "many", "please", "tell",
  "about", "who", "why", "im", "ive", "id", "we", "us", "our", "just", "need", "want", "know",
]);
// "when" and "where" are deliberately NOT stopwords: in an FAQ they are the
// words that separate "how much is delivery" from "when will it be delivered".

/**
 * Domain vocabulary: each canonical term lists the phrasings customers
 * actually use. Both documents and queries are expanded through this, so
 * "how much is postage" reaches a doc that only says "delivery".
 */
const SYNONYMS: Record<string, string[]> = {
  delivery: ["deliver", "shipping", "ship", "postage", "post", "courier", "send", "sending", "dispatch"],
  cost: ["price", "priced", "fee", "fees", "charge", "charges", "rate", "rates", "expensive", "cheap"],
  east: ["sabah", "sarawak", "labuan", "borneo"],
  west: ["peninsular", "semenanjung", "peninsula", "mainland"],
  store: ["storage", "storing", "keep", "keeping", "fridge", "refrigerate", "refrigerator", "chill", "shelf"],
  // "last" is deliberately absent: "how long does it last" and "the football
  // last night" share the word but nothing else.
  expiry: ["expire", "expires", "expiry", "expiration", "spoil", "spoils"],
  cook: ["cooking", "recipe", "recipes", "prepare", "preparing", "instructions", "method", "use", "using"],
  spice: ["spicy", "hot", "heat", "mild", "pedas"],
  serving: ["servings", "serves", "portion", "portions", "feed", "feeds", "people"],
  halal: ["certification", "certified", "jakim", "pork", "alcohol"],
  payment: ["pay", "paying", "paid", "card", "fpx", "ewallet", "wallet", "banking", "chip", "checkout"],
  refund: ["return", "returns", "returning", "exchange", "cancel", "cancelling", "cancellation", "money"],
  order: ["orders", "ordering", "ordered", "purchase", "buy", "buying", "bought", "track", "tracking"],
  ingredient: ["ingredients", "contains", "allergy", "allergen", "allergens", "nut", "nuts", "gluten"],
  weight: ["grams", "gram", "size", "big", "jar", "jars"],
  bulk: ["wholesale", "reseller", "bulk", "corporate", "event", "catering", "quantity"],
  contact: ["support", "help", "email", "phone", "whatsapp", "reach", "speak"],
};

/** Reverse lookup built once: variant -> canonical. */
const CANONICAL = new Map<string, string>();
for (const [canonical, variants] of Object.entries(SYNONYMS)) {
  CANONICAL.set(canonical, canonical);
  for (const v of variants) CANONICAL.set(v, canonical);
}

/**
 * Very light suffix stripping. Full stemming would be overkill for a corpus
 * this size and risks collapsing distinct terms.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ["ingly", "edly", "ing", "ies", "ed", "es", "ly", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      let base = word.slice(0, -suffix.length);
      if (suffix === "ies") base += "y";
      return base;
    }
  }
  return word;
}

export function tokenize(input: string): string[] {
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    const stemmed = stem(word);
    // Also test the stem: "whats" reduces to "what", and letting that through
    // leaves an out-of-vocabulary token that skews the confidence measure.
    if (STOPWORDS.has(stemmed)) continue;
    out.push(stemmed);
    // Add the canonical form alongside the literal token so both match.
    const canonical = CANONICAL.get(word) ?? CANONICAL.get(stemmed);
    if (canonical && canonical !== stemmed) out.push(canonical);
  }
  return out;
}

/** Levenshtein distance, capped — used only to rescue misspelled query terms. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, curr[j]);
    }
    if (best > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}
