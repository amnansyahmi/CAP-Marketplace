/**
 * A deliberately tiny markdown subset for help answers.
 *
 * Answers render as React elements built from this AST rather than via
 * dangerouslySetInnerHTML, so no authored string can ever inject markup.
 * Supported: paragraphs, `- ` bullets, `**bold**`, `[text](url)`.
 */

import type { Block, Inline } from "@/lib/help/types";

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/;
const STRONG = /\*\*([^*]+)\*\*/;

function parseInline(raw: string): Inline[] {
  const out: Inline[] = [];
  let rest = raw;

  while (rest.length > 0) {
    const link = rest.match(LINK);
    const strong = rest.match(STRONG);

    // Take whichever marker appears first, if any.
    const next = [link, strong]
      .filter((m): m is RegExpMatchArray => !!m && m.index !== undefined)
      .sort((a, b) => a.index! - b.index!)[0];

    if (!next) {
      out.push({ kind: "text", text: rest });
      break;
    }

    if (next.index! > 0) out.push({ kind: "text", text: rest.slice(0, next.index) });

    if (next === link) out.push({ kind: "link", text: next[1], href: next[2] });
    else out.push({ kind: "strong", text: next[1] });

    rest = rest.slice(next.index! + next[0].length);
  }

  return out.filter((i) => i.kind !== "text" || i.text.length > 0);
}

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  // Blank-line separated chunks; a chunk of `- ` lines becomes one list.
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    if (lines.every((l) => l.startsWith("- "))) {
      blocks.push({ kind: "list", items: lines.map((l) => parseInline(l.slice(2))) });
    } else {
      blocks.push({ kind: "paragraph", content: parseInline(lines.join(" ")) });
    }
  }
  return blocks;
}

/** Flatten blocks back to plain text for the search index. */
export function blocksToText(blocks: Block[]): string {
  const inlineText = (items: Inline[]) => items.map((i) => i.text).join(" ");
  return blocks
    .map((b) => (b.kind === "paragraph" ? inlineText(b.content) : b.items.map(inlineText).join(" ")))
    .join(" ");
}

export type Frontmatter = Record<string, string>;

/**
 * Minimal `---` frontmatter reader. Values are plain strings; comma-separated
 * lists are split by the caller. Avoids pulling in a YAML dependency for what
 * is only ever three keys.
 */
export function splitFrontmatter(source: string): { data: Frontmatter; body: string } {
  const normalised = source.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { data: {}, body: normalised.trim() };

  const end = normalised.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: normalised.trim() };

  const data: Frontmatter = {};
  for (const line of normalised.slice(4, end).split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }

  return { data, body: normalised.slice(end + 4).trim() };
}
