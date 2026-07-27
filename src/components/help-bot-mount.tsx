import { HelpBot } from "@/components/help-bot";
import { loadHelpDocs } from "@/lib/help/load";

/**
 * Server component: reads the markdown corpus at build time and hands the
 * parsed docs to the client bot, so the browser needs no fetch to answer.
 */
export function HelpBotMount() {
  return <HelpBot docs={loadHelpDocs()} />;
}
