"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

import { answer, buildIndex } from "@/lib/help/search";
import type { Block, HelpAnswer, HelpDoc, Inline } from "@/lib/help/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Turn =
  | { role: "user"; id: number; text: string }
  | { role: "bot"; id: number; result: HelpAnswer };

const OPENERS = [
  "How much is delivery?",
  "Which paste should I choose?",
  "How do I cook with it?",
  "Is it halal?",
];

export function HelpBot({ docs }: { docs: HelpDoc[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The corpus is small, so indexing on mount costs less than shipping a
  // prebuilt index and risking it drifting from the tokeniser.
  const index = useMemo(() => buildIndex(docs), [docs]);
  const suggestions = useMemo(
    () => OPENERS.map((o) => docs.find((d) => d.title === o)).filter((d): d is HelpDoc => !!d),
    [docs],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // Escape closes; focus returns to the launcher via the button ref below.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = answer(index, trimmed, docs);
    setTurns((t) => [
      ...t,
      { role: "user", id: nextId.current++, text: trimmed },
      { role: "bot", id: nextId.current++, result },
    ]);
    setQuery("");
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="help-panel"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-border bg-secondary px-5 py-3 text-sm text-secondary-foreground shadow-lg transition-colors hover:bg-secondary/90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <X className="size-4" /> : <MessageCircle className="size-4" />}
        {open ? "Close" : "Ask a question"}
      </button>

      {open && (
        <div
          id="help-panel"
          ref={panelRef}
          role="dialog"
          aria-label="Product help"
          className="fixed bottom-20 right-5 z-50 flex h-[min(34rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2.5rem))] flex-col rounded-lg border border-border bg-background shadow-2xl"
        >
          <div className="border-b border-border p-5">
            <h2 className="font-serif text-2xl">Product help</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Answers come straight from our help notes — no AI, so nothing here is invented.
            </p>
          </div>

          <div ref={logRef} className="flex-1 overflow-y-auto p-5">
            {turns.length === 0 ? (
              <div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Ask about delivery, storage, cooking or payment. Or start with:
                </p>
                <ul className="mt-4 space-y-2">
                  {suggestions.map((d) => (
                    <li key={d.id}>
                      <button
                        onClick={() => ask(d.title)}
                        className="w-full rounded-md border border-border px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {d.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-5">
                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <p key={turn.id} className="ml-auto w-fit max-w-[85%] rounded-md bg-secondary px-3.5 py-2 text-sm text-secondary-foreground">
                      {turn.text}
                    </p>
                  ) : (
                    <AnswerBubble key={turn.id} result={turn.result} onAsk={ask} />
                  ),
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(query);
            }}
            className="flex gap-2 border-t border-border p-4"
          >
            <Label htmlFor="help-query" className="sr-only">
              Your question
            </Label>
            <Input
              id="help-query"
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your question…"
              autoComplete="off"
            />
            <Button type="submit" size="icon" aria-label="Send question" disabled={!query.trim()}>
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

function AnswerBubble({ result, onAsk }: { result: HelpAnswer; onAsk: (q: string) => void }) {
  // Answers are announced politely so screen-reader users hear the reply
  // without the input losing focus.
  return (
    <div aria-live="polite" className="max-w-[92%] rounded-lg border border-border bg-card p-4">
      {result.status === "answered" ? (
        <>
          <h3 className="font-serif text-xl leading-snug">{result.match.doc.title}</h3>
          <div className="mt-3 space-y-3 text-sm leading-6">
            {result.match.doc.blocks.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </div>
          {result.alsoSee.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
                Related
              </p>
              <ul className="mt-2 space-y-1.5">
                {result.alsoSee.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => onAsk(d.title)} className="text-left text-sm text-primary hover:underline">
                      {d.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : result.status === "unsure" ? (
        <>
          <p className="text-sm leading-6">
            I don&rsquo;t have a note covering that. Rather than guess, here are the topics I do cover:
          </p>
          <ul className="mt-3 space-y-1.5">
            {result.suggestions.map((d) => (
              <li key={d.id}>
                <button onClick={() => onAsk(d.title)} className="text-left text-sm text-primary hover:underline">
                  {d.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm">Ask me anything about the products.</p>
      )}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "list") {
    return (
      <ul className="space-y-1.5">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-2.5 size-1 shrink-0 bg-muted-foreground" />
            <span>
              <InlineView content={item} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p>
      <InlineView content={block.content} />
    </p>
  );
}

function InlineView({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((piece, i) => {
        if (piece.kind === "strong") return <strong key={i} className="font-semibold">{piece.text}</strong>;
        if (piece.kind === "link")
          return (
            <a key={i} href={piece.href} className={cn("text-primary underline underline-offset-2")}>
              {piece.text}
            </a>
          );
        return <span key={i}>{piece.text}</span>;
      })}
    </>
  );
}
