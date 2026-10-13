import { WebSource } from './research.types';

export const WEB_TAG = 'donnees_web_non_fiables';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strips anything that could close or imitate the untrusted-data fence, plus control characters. */
export function cleanUntrusted(text: string, max: number): string {
  return text.replace(CONTROL, ' ').replace(/<\/?\s*(donnees_|system|instruction|donn[ée]es_utilisateur|contexte)[^>]*>/gi, ' ')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, max);
}

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    let s = u.toString(); if (s.endsWith('/') && !u.search) s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

/**
 * Renders sources as a fenced block of DATA appended to the user's turn. The system prompt tells the model that
 * this block can never carry instructions. The model has no tools, so web text cannot trigger privileged actions.
 */
export function renderWebBlock(sources: WebSource[], maxChars = 24000): string {
  let budget = maxChars; const parts: string[] = [];
  for (const s of sources) {
    const body = cleanUntrusted(s.extract ?? s.snippet, Math.min(s.extract ? 4000 : 800, Math.max(budget, 0)));
    const entry = `[${s.id}] titre: ${cleanUntrusted(s.title, 200)}\nurl: ${s.url}${s.publishedDate ? `\ndate: ${cleanUntrusted(s.publishedDate, 40)}` : ''}\ncontenu: ${body}`;
    if (entry.length > budget) break;
    budget -= entry.length; parts.push(entry);
  }
  return `<${WEB_TAG}>\n${parts.join('\n\n')}\n</${WEB_TAG}>`;
}

/** Heuristic for "auto" mode: only explicit recency / lookup cues trigger a (billed) search. */
export function shouldSearchWeb(text: string): boolean {
  return /\b(aujourd'hui|actuel(le)?s?|actuellement|derni(er|ère)s?|r[ée]cent(e)?s?|nouveaut[ée]s?|actualit[ée]s?|20(2[4-9]|3\d)|cherche|recherche sur|sur (le )?web|sur internet|latest|current|today|news|search the web|look up)\b/i.test(text);
}

/** Removes citation markers that do not match a provided source id. */
export function stripUnknownCitations(answer: string, validIds: Set<string>): { text: string; cited: string[] } {
  const cited = new Set<string>();
  const text = answer.replace(/\[(S\d+)\]/g, (m, id) => { if (validIds.has(id)) { cited.add(id); return m; } return ''; }).replace(/ {2,}/g, ' ');
  return { text, cited: [...cited] };
}
