/** A parsed inline run of text inside a block. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string };

/** The block-level markdown subset the help answers are allowed to use. */
export type Block =
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; items: Inline[][] };

export type HelpDoc = {
  id: string;
  /** The canonical question, shown as the answer heading. */
  title: string;
  category: string;
  /** Extra phrasings authors expect customers to use. Weighted above body text. */
  keywords: string[];
  /** Rendered answer. */
  blocks: Block[];
  /** Flattened text used for indexing. */
  text: string;
};

export type HelpMatch = {
  doc: HelpDoc;
  score: number;
};

export type HelpAnswer =
  | { status: "answered"; match: HelpMatch; alsoSee: HelpDoc[] }
  | { status: "unsure"; suggestions: HelpDoc[] }
  | { status: "empty" };
