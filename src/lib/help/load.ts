/**
 * Server-side loader for the help corpus.
 *
 * Runs at build time. Answers may reference live figures via `{{token}}`
 * placeholders, resolved here from the same modules the shop itself uses — so
 * a delivery-rate change can never leave the FAQ quoting an old price. An
 * unknown placeholder throws rather than shipping `{{...}}` to a customer.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { blocksToText, parseBlocks, splitFrontmatter } from "@/lib/help/markdown";
import type { HelpDoc } from "@/lib/help/types";
import { products, startingPrice } from "@/lib/products";
import { ZONE_RATES } from "@/lib/shipping";
import { money } from "@/lib/utils";

const CONTENT_DIR = join(process.cwd(), "content", "help");

function resolvers(): Record<string, string> {
  const jar = products[0];
  return {
    "delivery.west": money(ZONE_RATES.west.fee),
    "delivery.east": money(ZONE_RATES.east.fee),
    "delivery.westFree": money(ZONE_RATES.west.freeFrom),
    "delivery.eastFree": money(ZONE_RATES.east.freeFrom),
    "delivery.westLabel": ZONE_RATES.west.label,
    "delivery.eastLabel": ZONE_RATES.east.label,
    "price.from": money(startingPrice()),
    "product.weight": `${jar.weightGrams}g`,
    "product.names": products.map((p) => p.name).join(", "),
    "nutrition.serving": jar.nutrition.servingSize,
    "nutrition.energy": `${jar.nutrition.energyKcal} kcal (${jar.nutrition.energyKj} kJ)`,
    "nutrition.carbohydrate": jar.nutrition.carbohydrate,
    "nutrition.protein": jar.nutrition.protein,
    "nutrition.fat": jar.nutrition.fat,
  };
}

function resolvePlaceholders(source: string, file: string): string {
  const values = resolvers();
  return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => {
    const value = values[token];
    if (value === undefined) {
      throw new Error(
        `Unknown help placeholder "{{${token}}}" in content/help/${file}. ` +
          `Known tokens: ${Object.keys(values).join(", ")}`,
      );
    }
    return value;
  });
}

export function loadHelpDocs(): HelpDoc[] {
  const files = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const docs = files.map((file) => {
    const raw = readFileSync(join(CONTENT_DIR, file), "utf8");
    const { data, body } = splitFrontmatter(raw);

    if (!data.title) throw new Error(`content/help/${file} is missing a "title" in its frontmatter.`);

    const blocks = parseBlocks(resolvePlaceholders(body, file));
    return {
      id: file.replace(/\.md$/, ""),
      title: resolvePlaceholders(data.title, file),
      category: data.category ?? "General",
      keywords: (data.keywords ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      blocks,
      text: blocksToText(blocks),
    } satisfies HelpDoc;
  });

  if (docs.length === 0) throw new Error("No help documents found in content/help.");
  return docs;
}
