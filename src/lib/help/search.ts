/**
 * BM25 retrieval over the help corpus.
 *
 * Runs entirely in the browser against an index built from the shipped
 * markdown — no model, no network request, no per-query cost. It selects an
 * existing answer; it never composes one, so it cannot invent a price or a
 * policy. When nothing scores above the confidence floor it says so rather
 * than returning the least-bad match.
 */

import { editDistance, tokenize } from "@/lib/help/tokenize";
import type { HelpAnswer, HelpDoc, HelpMatch } from "@/lib/help/types";

const K1 = 1.5;
const B = 0.75;
/** Title and author-supplied keywords repeated this many times when indexing. */
const TITLE_WEIGHT = 3;
const KEYWORD_WEIGHT = 3;
/**
 * Fraction of a question's information content (idf-weighted) that must
 * actually appear in a document before we will show it as an answer.
 *
 * This is an *absolute* measure on purpose. Ranking scores are only meaningful
 * relative to each other — the best match is always the best match, however
 * poor — so a threshold on rank position or on a normalised score can never
 * reject an off-topic question. Coverage can: ask about quantum physics and
 * none of those terms appear anywhere, so coverage collapses to zero.
 */
const CONFIDENCE_FLOOR = 0.5;

type IndexedDoc = {
  doc: HelpDoc;
  termFreq: Map<string, number>;
  length: number;
};

export type HelpIndex = {
  docs: IndexedDoc[];
  docFreq: Map<string, number>;
  avgLength: number;
  vocabulary: string[];
};

export function buildIndex(docs: HelpDoc[]): HelpIndex {
  const indexed: IndexedDoc[] = docs.map((doc) => {
    const tokens = [
      ...repeat(tokenize(doc.title), TITLE_WEIGHT),
      ...repeat(tokenize(doc.keywords.join(" ")), KEYWORD_WEIGHT),
      ...tokenize(doc.text),
    ];
    const termFreq = new Map<string, number>();
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    return { doc, termFreq, length: tokens.length };
  });

  const docFreq = new Map<string, number>();
  for (const d of indexed) {
    for (const term of d.termFreq.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }

  const avgLength = indexed.reduce((sum, d) => sum + d.length, 0) / Math.max(1, indexed.length);
  return { docs: indexed, docFreq, avgLength, vocabulary: [...docFreq.keys()] };
}

function repeat(tokens: string[], times: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(...tokens);
  return out;
}

function idf(index: HelpIndex, term: string, minDocFreq = 0): number {
  const n = index.docs.length;
  const df = Math.max(minDocFreq, index.docFreq.get(term) ?? 0);
  // Standard BM25 idf, floored so very common terms never score negative.
  return Math.max(0.01, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
}

function scoreDoc(index: HelpIndex, d: IndexedDoc, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    const tf = d.termFreq.get(term);
    if (!tf) continue;
    const norm = tf * (K1 + 1);
    const denom = tf + K1 * (1 - B + (B * d.length) / index.avgLength);
    score += idf(index, term) * (norm / denom);
  }
  return score;
}

/**
 * Replace query terms absent from the vocabulary with their closest known
 * neighbour, so "delivary" still retrieves.
 *
 * Two guards, both learned from false positives:
 *
 * 1. The edit budget scales with length — a flat 2 edits let short unrelated
 *    words collapse onto real terms ("cats" -> "card").
 * 2. The first two characters must match. Edit distance alone cannot tell a
 *    misspelling from a different word that happens to sit nearby, and without
 *    this "france" becomes "range", "book" becomes "cook" and "flight" becomes
 *    "weight" — turning off-topic questions into confident answers. Genuine
 *    typos ("delivary", "halall", "refridgerate") keep their opening letters.
 */
function repairTypos(index: HelpIndex, terms: string[]): string[] {
  return terms.map((term) => {
    if (index.docFreq.has(term) || term.length < 4) return term;
    const max = Math.min(2, Math.floor(term.length / 3));
    if (max < 1) return term;

    const prefix = term.slice(0, 2);
    let best: string | null = null;
    let bestDistance = max + 1;
    for (const candidate of index.vocabulary) {
      if (!candidate.startsWith(prefix)) continue;
      const d = editDistance(term, candidate, max);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
      if (bestDistance === 1) break;
    }
    return best && bestDistance <= max ? best : term;
  });
}

/**
 * Share of the question's information content present in this document.
 * Rare terms count for more, so matching "halal" says more than matching "order".
 */
function coverage(index: HelpIndex, d: IndexedDoc, terms: string[]): number {
  const seen = new Set(terms);
  let matched = 0;
  let total = 0;
  for (const term of seen) {
    // Clamp document frequency to 1 here. An unknown word has df 0, which
    // yields the highest idf of all — so a single stray term ("hi", a stray
    // "whats") would outweigh the words that actually identify the question
    // and veto a correct answer. Treat unknowns as merely rare, not decisive.
    const weight = idf(index, term, 1);
    total += weight;
    if (d.termFreq.has(term)) matched += weight;
  }
  return total === 0 ? 0 : matched / total;
}

export function search(index: HelpIndex, query: string, limit = 3): HelpMatch[] {
  const raw = tokenize(query);
  if (raw.length === 0) return [];
  const terms = repairTypos(index, raw);

  return index.docs
    .map((d) => ({
      doc: d.doc,
      score: scoreDoc(index, d, terms),
      confidence: coverage(index, d, terms),
    }))
    .filter((m) => m.score > 0)
    // Rank by relevance, but carry the absolute confidence alongside it.
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, confidence }) => ({ doc, score: confidence }));
}

export function answer(index: HelpIndex, query: string, suggestions: HelpDoc[] = []): HelpAnswer {
  if (!query.trim()) return { status: "empty" };

  const matches = search(index, query, 4);
  const top = matches[0];

  if (!top || top.score < CONFIDENCE_FLOOR) {
    return {
      status: "unsure",
      suggestions: suggestions.slice(0, 4),
    };
  }

  // Only offer follow-ups that are themselves plausible, not just next-best.
  const alsoSee = matches
    .slice(1)
    .filter((m) => m.score >= CONFIDENCE_FLOOR)
    .slice(0, 2)
    .map((m) => m.doc);

  return { status: "answered", match: top, alsoSee };
}

export { CONFIDENCE_FLOOR };
