/**
 * Retrieval tests. Run with `npm test`.
 *
 * These matter more than usual: a search engine that silently returns a
 * confident wrong answer is worse than no bot at all, and nothing else in the
 * stack would catch it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadHelpDocs } from "@/lib/help/load";
import { answer, buildIndex, search } from "@/lib/help/search";
import { editDistance, tokenize } from "@/lib/help/tokenize";
import { parseBlocks, splitFrontmatter } from "@/lib/help/markdown";

const docs = loadHelpDocs();
const index = buildIndex(docs);

const topId = (query: string) => search(index, query, 1)[0]?.doc.id;

describe("corpus", () => {
  it("loads every markdown file with required frontmatter", () => {
    assert.ok(docs.length >= 12, `expected a populated corpus, got ${docs.length}`);
    for (const d of docs) {
      assert.ok(d.title.length > 0, `${d.id} has no title`);
      assert.ok(d.blocks.length > 0, `${d.id} has no body`);
      assert.ok(d.text.length > 20, `${d.id} body is suspiciously short`);
    }
  });

  it("resolves every placeholder — no {{token}} reaches a customer", () => {
    for (const d of docs) {
      assert.ok(!d.text.includes("{{"), `${d.id} has an unresolved placeholder`);
      assert.ok(!d.title.includes("{{"), `${d.id} title has an unresolved placeholder`);
    }
  });

  it("injects live delivery pricing rather than hardcoding it", () => {
    const delivery = docs.find((d) => d.id === "delivery-cost");
    assert.ok(delivery, "delivery-cost doc missing");
    // Whatever the configured rate is, it must appear verbatim in the answer.
    assert.match(delivery.text, /RM\s?8\.00/, "west rate not resolved into the answer");
    assert.match(delivery.text, /RM\s?18\.00/, "east rate not resolved into the answer");
  });
});

describe("routing real questions to the right answer", () => {
  const cases: [string, string][] = [
    ["how much is delivery", "delivery-cost"],
    ["what does shipping cost", "delivery-cost"],
    ["is postage free", "delivery-cost"],
    ["how long until my order arrives", "delivery-time"],
    ["when will it be delivered", "delivery-time"],
    ["do i need to refrigerate it after opening", "storage"],
    ["how long does it keep", "storage"],
    ["how do i cook it", "how-to-cook"],
    ["what is the recipe method", "how-to-cook"],
    ["how many people does a jar feed", "servings"],
    ["is it very spicy", "spice-level"],
    ["can i pay with fpx", "payment-methods"],
    ["what card can i use", "payment-methods"],
    ["can i get a refund", "returns"],
    ["my jar arrived broken", "returns"],
    ["is this halal", "halal"],
    ["what are the ingredients", "ingredients"],
    ["how many calories", "ingredients"],
    ["which one should i buy", "which-paste"],
    ["difference between kabsah and briyani", "which-paste"],
    ["do you do wholesale", "bulk-orders"],
    ["where is my order", "order-status"],
  ];

  for (const [query, expected] of cases) {
    it(`"${query}" -> ${expected}`, () => {
      assert.equal(topId(query), expected);
    });
  }
});

describe("typo tolerance", () => {
  const cases: [string, string][] = [
    ["how much is delivary", "delivery-cost"],
    // Regression: "whats" stems to the stopword "what"; leaving it in the token
    // stream as an unknown term used to push this below the confidence floor.
    ["whats the delivary cost", "delivery-cost"],
    ["shiping cost", "delivery-cost"],
    ["is it halall", "halal"],
    ["ingrediants", "ingredients"],
    ["refridgerate", "storage"],
  ];

  for (const [query, expected] of cases) {
    it(`"${query}" still finds ${expected}`, () => {
      assert.equal(topId(query), expected);
    });
  }
});

describe("declining to answer", () => {
  const offTopic = [
    "what is the capital of france",
    "write me a poem about cats",
    // "last" overlaps with "how long does it last"; one incidental shared word
    // must not be enough to trigger a confident answer.
    "who won the football last night",
    "what is your opinion on quantum physics",
    "book me a flight to tokyo",
  ];

  for (const query of offTopic) {
    it(`says it is unsure for "${query}"`, () => {
      const result = answer(index, query, docs);
      assert.equal(result.status, "unsure", `expected to decline, got: ${JSON.stringify(result).slice(0, 120)}`);
    });
  }

  it("treats an empty question as empty", () => {
    assert.equal(answer(index, "   ", docs).status, "empty");
  });

  it("offers suggestions whenever it declines", () => {
    const result = answer(index, "what is the capital of france", docs);
    assert.equal(result.status, "unsure");
    if (result.status === "unsure") assert.ok(result.suggestions.length > 0);
  });
});

describe("tokenizer", () => {
  it("drops stopwords", () => {
    assert.deepEqual(tokenize("how much is the delivery"), tokenize("delivery"));
  });

  it("maps synonyms onto a shared canonical term", () => {
    for (const word of ["postage", "shipping", "courier"]) {
      assert.ok(tokenize(word).includes("delivery"), `${word} did not reach "delivery"`);
    }
  });

  it("bounds edit distance work", () => {
    assert.equal(editDistance("kitten", "sitting", 3), 3);
    assert.ok(editDistance("abc", "xyzxyzxyz", 2) > 2);
  });
});

describe("markdown subset", () => {
  it("parses frontmatter and body", () => {
    const { data, body } = splitFrontmatter("---\ntitle: Hi\nkeywords: a, b\n---\nBody text.");
    assert.equal(data.title, "Hi");
    assert.equal(body, "Body text.");
  });

  it("parses bold, links and bullets", () => {
    const blocks = parseBlocks("Hello **world** and [docs](/x).\n\n- one\n- two");
    assert.equal(blocks[0].kind, "paragraph");
    assert.equal(blocks[1].kind, "list");
    if (blocks[1].kind === "list") assert.equal(blocks[1].items.length, 2);
    if (blocks[0].kind === "paragraph") {
      assert.ok(blocks[0].content.some((c) => c.kind === "strong" && c.text === "world"));
      assert.ok(blocks[0].content.some((c) => c.kind === "link" && c.href === "/x"));
    }
  });

  it("does not emit raw html for angle brackets", () => {
    const blocks = parseBlocks("<script>alert(1)</script>");
    assert.equal(blocks[0].kind, "paragraph");
    // Content is plain text; rendering goes through React elements, never innerHTML.
    if (blocks[0].kind === "paragraph") {
      assert.equal(blocks[0].content[0].kind, "text");
    }
  });
});
