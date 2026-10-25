/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Display helpers shared by the tool-invocation card UI. Backend AI tools
 * (notably the framework's MCP-style data/metadata tools) wrap their output
 * in `{ type: 'text', value: '<json-string>' }`. Rendering that envelope
 * naively produces an unreadable, doubly-escaped wall of JSON. These helpers
 * peel the envelope, parse the inner JSON when possible, and produce a
 * human-friendly title for snake_case tool names.
 */

const HUMAN_WORDS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  crm: 'CRM',
  hitl: 'HITL',
  id: 'ID',
  ids: 'IDs',
  rag: 'RAG',
  sql: 'SQL',
  url: 'URL',
  utc: 'UTC',
};

/**
 * A translator for tool titles. Takes the i18n key and the English fallback
 * this module would otherwise have produced, and returns whatever the active
 * locale has — or the fallback when that locale carries no entry.
 *
 * Shaped to accept `useSafeTranslate()` directly, so a caller passes the hook's
 * result and nothing else changes.
 */
export type ToolTitleTranslator = (key: string, fallback: string) => string;

/** The i18n key a tool title is looked up under. */
export function toolTitleKey(name: string): string {
  return `chatbot.tool.${String(name).trim()}`;
}

/**
 * Convert a snake_case / kebab-case tool name into a human-readable title.
 *
 * With no translator this is what it always was: an ENGLISH title-caser. That
 * is why a fully Chinese conversation still read
 * `Describe object 已完成 / Visualize data 已完成` (cloud#1658) — every other
 * string on the card was localized and the tool name could not be, because the
 * name never passed through i18n at all. The step the user most needs to read
 * ("what is it doing right now?") was the one left in a foreign language.
 *
 * Pass `translate` (e.g. `useSafeTranslate()`) to look the title up as
 * `chatbot.tool.<tool_name>`; a locale with no entry for that tool falls back
 * to the same English title as before, so packs can be filled in gradually and
 * an unknown//custom tool is never worse off than today.
 *
 * @example
 *   humanizeToolName('list_objects')                 // → 'List objects'
 *   humanizeToolName('query_records')                // → 'Query records'
 *   humanizeToolName('describe-api-tool')            // → 'Describe API tool'
 *   humanizeToolName('describe_object', tt)          // → '查看对象结构' (zh)
 */
export function humanizeToolName(
  name: string | undefined | null,
  translate?: ToolTitleTranslator,
): string {
  if (!name) return '';
  const trimmed = String(name).trim();
  if (!trimmed) return '';
  const words = trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return trimmed;
  const english = words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (HUMAN_WORDS[lower]) return HUMAN_WORDS[lower];
      if (idx === 0) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      return lower;
    })
    .join(' ');
  // The English title is the FALLBACK, not a second choice computed only on
  // miss: building it either way keeps this function total and side-effect
  // free, and costs one string join.
  return translate ? translate(toolTitleKey(trimmed), english) : english;
}

/**
 * Detect the MCP-style `{ type: 'text', value: '<json|text>' }` envelope used
 * by `@objectstack/service-ai` tool outputs and peel it. When the inner value
 * looks like JSON we parse it so the renderer shows a real object tree
 * instead of `"{\\\"objects\\\":[...]}"`.
 *
 * Non-envelope payloads are returned unchanged.
 */
export function unwrapToolResult(value: unknown): unknown {
  if (value == null) return value;

  // Many backends wrap outputs in an envelope ({type:'text', value: '...'}).
  // Detect and peel one level. Repeat once in case the value was itself a
  // stringified envelope.
  let current: unknown = value;
  for (let depth = 0; depth < 2; depth++) {
    if (
      typeof current === 'object' &&
      current !== null &&
      !Array.isArray(current) &&
      (current as Record<string, unknown>).type === 'text' &&
      typeof (current as Record<string, unknown>).value === 'string'
    ) {
      current = (current as { value: string }).value;
      continue;
    }
    break;
  }

  // If we landed on a string that looks like JSON, parse it. Otherwise leave
  // the string as-is so plain text outputs render correctly.
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Fall through and return the raw string.
      }
    }
  }
  return current;
}

/**
 * Produce a short, headline error string from a possibly-long backend error.
 * The Vercel AI Gateway, in particular, emits multi-sentence messages with
 * doc URLs that overflow the chat error banner. We keep the first sentence
 * (capped to 140 chars) for the headline and expose the full text via the
 * `details` field so callers can render an expandable disclosure.
 */
export function summarizeChatError(err: unknown): {
  summary: string;
  details?: string;
} {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { summary: 'Something went wrong. Please try again.' };
  }

  // Strip "Failed after N attempts. Last error: " prefix that the AI SDK
  // chat client adds to retried streaming failures.
  const stripped = cleaned.replace(
    /^Failed after \d+ attempts?\.\s*Last error:\s*/i,
    '',
  );

  const headlineSource =
    stripped.match(/^Invalid error response format:\s*(.+)$/i)?.[1]?.trim() ??
    stripped;

  const colonPrefix = headlineSource.match(/^([^:]{8,80}):\s+(.+)$/)?.[1]?.trim();

  // Headline = a human-sized prefix or sentence, otherwise the first 140
  // characters. Avoid preserving a trailing colon as the visible summary.
  const sentence =
    colonPrefix ??
    headlineSource.match(/^([^.;!?]+[.;!?])\s/)?.[1]?.trim() ??
    (headlineSource.length > 140
      ? `${headlineSource.slice(0, 137).trimEnd()}…`
      : headlineSource);

  return {
    summary: sentence.replace(/:$/, ''),
    details: stripped.length > sentence.length ? stripped : undefined,
  };
}

/**
 * AI quota refusal codes emitted by the cloud token guardrail (HTTP 429).
 *
 * TWO vocabularies, both live. cloud#1238 (the cloud#1168 convergence) landed
 * the SCREAMING_SNAKE ledger codes — which is what a spec-conformant
 * `error.code` must be, an `ErrorCode` ledger member. The lowercase trio is
 * the legacy vocabulary that transition-period producers still emit, so it is
 * KEPT rather than swapped out: dropping it would silently stop parsing every
 * producer that has not converged yet (objectui#3804).
 */
export type AiQuotaCode =
  // Ledger vocabulary (cloud#1238) — registered `ErrorCode` members.
  | 'AI_DESIGN_QUOTA_EXHAUSTED'
  | 'AI_DATA_CHAT_TRIAL_EXHAUSTED'
  | 'AI_ALLOWANCE_EXHAUSTED'
  // Legacy vocabulary — still emitted by producers that have not converged.
  | 'ai_design_quota_exhausted'
  | 'ai_data_chat_trial_exhausted'
  | 'ai_allowance_exhausted';

export interface AiQuotaError {
  code: AiQuotaCode;
  /** Localized (zh) message from the backend. */
  message: string;
  /** English message from the backend. */
  messageEn?: string;
  /** Free tier -> upgrade to a paid plan. */
  upgrade: boolean;
  /** Paid tier -> buy a credit top-up pack. */
  topUp: boolean;
  /**
   * The allowance replenishes at the next daily reset, so "wait" is a real
   * option alongside the CTA. Only set when the producer sends an actual
   * boolean: the landed envelope carries this inside `error.details`
   * (cloud#1238) and that POSITION is measured, but an absent or
   * otherwise-typed value stays `undefined` rather than being coerced to a
   * `false` no producer declared.
   *
   * ⚠️ objectui#7587 — measured on this tree: NOTHING reads this field once the
   * parse fills it in. `useAiQuotaCopy` (ChatbotEnhanced), the only consumer of
   * the parsed shape's fields, builds the banner from `message` / `messageEn` /
   * `topUp`; the other two `parseAiQuotaError` call sites use the parse as a
   * yes/no predicate. So cloud PR #1852's free-plan inversion (`true` ->
   * `false`, the rolling 7-day window) changes nothing on screen, and the ISO
   * `resetsAt` that producer now sends beside this flag is deliberately NOT
   * read here: with no renderer for it, a read would pin a wire position this
   * repo cannot measure (`objectstack-ai/cloud` is out of scope) and would add
   * a second unread field rather than answer anyone's question. Both halves are
   * pinned — the flag's inertness by
   * `__tests__/ChatbotEnhanced.quotaResetPromise-7587.test.tsx`, the parse's
   * silence about the instant by `tool-display.test.ts`. Wiring reset copy to
   * this BOOLEAN is the one move to avoid: it is `false` for exactly the plan
   * that needs the answer.
   */
  resetsTonight?: boolean;
}

const AI_QUOTA_CODES = new Set<string>([
  // Ledger vocabulary (cloud#1238).
  'AI_DESIGN_QUOTA_EXHAUSTED',
  'AI_DATA_CHAT_TRIAL_EXHAUSTED',
  'AI_ALLOWANCE_EXHAUSTED',
  // Legacy vocabulary, still live during the transition.
  'ai_design_quota_exhausted',
  'ai_data_chat_trial_exhausted',
  'ai_allowance_exhausted',
]);

/** The value as a recognized quota code, or undefined for anything else. */
function asAiQuotaCode(value: unknown): AiQuotaCode | undefined {
  return typeof value === 'string' && AI_QUOTA_CODES.has(value)
    ? (value as AiQuotaCode)
    : undefined;
}

/**
 * The value as non-empty text, or undefined — so an empty string falls through
 * to the next candidate source instead of winning as the message (the
 * `{ error: '', code: … }` dialect emits exactly that).
 */
function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * The first candidate that is an actual boolean, or undefined. Lets the
 * declared `error.details` position win over the legacy top-level one while a
 * non-boolean (`'true'`, `1`) is ignored exactly as the old `=== true` read
 * ignored it.
 */
function asOptionalFlag(...candidates: unknown[]): boolean | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'boolean') return candidate;
  }
  return undefined;
}

/** {@link asOptionalFlag} for the CTA flags, which are never absent. */
function asFlag(...candidates: unknown[]): boolean {
  return asOptionalFlag(...candidates) ?? false;
}

/**
 * Recognize the cloud AI token guardrail's 429 quota refusals so the chat UI can
 * show a friendly upgrade / top-up CTA instead of a generic "response failed".
 *
 * The ai-sdk chat transport throws a plain Error whose `message` is the response
 * body text (no HTTP status is preserved), so the only signal is the JSON body:
 * strip the same retry/format prefixes summarizeChatError handles, locate the
 * JSON object, and find the code in it. Returns null for anything else.
 *
 * ## Four dialects, two vocabularies
 *
 * The two cloud 429 producers fill the same `error` key in OPPOSITE ways
 * (objectui#3491, cloud#944), and ADR-0112's declared envelope has now LANDED
 * on the producer side (cloud#1168 -> cloud PR #1238), adding a fourth
 * dialect: the declared envelope carrying the SCREAMING_SNAKE ledger
 * vocabulary with its companion fields inside `error.details`. All four are
 * read here, because the producers converge asymmetrically and the legacy
 * dialects are still live (objectui#3804):
 *
 * | dialect                       | shape                                           |
 * |-------------------------------|-------------------------------------------------|
 * | declared envelope + ledger    | `{ error: { code: AI_*, message, details } }`    |
 * | declared envelope + legacy    | `{ success: false, error: { code, message } }`   |
 * | flat guardrail                | `{ error: CODE, message, upgrade, topUp }`       |
 * | service-ai sibling key        | `{ error: PROSE, code: CODE }`                   |
 *
 * Both the code's LOCATION and the recognized code SET widen; an unknown shape
 * still degrades to today's behavior (null).
 *
 * ## What this deliberately does NOT recognize: generic `QUOTA_EXCEEDED`
 *
 * `POST /api/v1/ai/agents/:name/chat`'s per-turn message cap keeps emitting the
 * standard `QUOTA_EXCEEDED` (`error.details.resetAt`, `category: 'rate_limit'`)
 * and did NOT move to the three `AI_*` codes — it has no upgrade / top-up /
 * trial next step, which is exactly the distinction the 2026-08-11 Option A
 * ruling drew when it admitted the three codes to the closed ledger.
 *
 * It is NOT dropped, it is handled one branch along: `isUnsentSendError` +
 * `isRateLimitError` route it to the "you're sending too quickly" notice, with
 * the user's text restored. Returning an `AiQuotaError` for it here would put
 * an "Upgrade plan" CTA in front of a user whose cap resets in a minute.
 * `tool-display.test.ts` pins that routing so the split cannot close silently.
 *
 * ## Parse priority (a total order, deliberately)
 *
 * `declared envelope > flat guardrail > sibling code key`. A payload that
 * satisfies two dialects at once — a transitional producer double-emitting the
 * new envelope alongside the legacy top-level keys is the realistic case — must
 * have ONE defined outcome, so the most-declared position wins, and the legacy
 * limbs remain reachable when the nested code is absent or unrecognized.
 */
export function parseAiQuotaError(err: unknown): AiQuotaError | null {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (!raw) return null;
  const stripped = raw
    .replace(/^Failed after \d+ attempts?\.\s*Last error:\s*/i, '')
    .replace(/^Invalid error response format:\s*/i, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let body: any;
  try {
    body = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;

  // The declared envelope's nested error object, when `error` carries one.
  const nested =
    body.error && typeof body.error === 'object'
      ? (body.error as Record<string, unknown>)
      : undefined;

  // The declared envelope nests the companion fields under `error.details`
  // (cloud#1238); the legacy flat dialects keep them top-level. Same total
  // order as the code itself — the declared position wins, and the legacy limb
  // stays reachable when the declared one is absent.
  const details =
    nested?.details && typeof nested.details === 'object' && !Array.isArray(nested.details)
      ? (nested.details as Record<string, unknown>)
      : undefined;

  const flatCode = asAiQuotaCode(body.error);
  const code = asAiQuotaCode(nested?.code) ?? flatCode ?? asAiQuotaCode(body.code);
  if (!code) return null;

  return {
    code,
    message:
      asText(nested?.message) ??
      asText(body.message) ??
      // The service-ai dialect puts prose in `error`. Read it as text only when
      // `error` is not itself the code slot, or the flat dialect would surface
      // its own code ('ai_allowance_exhausted') to the user as the message.
      (flatCode ? undefined : asText(body.error)) ??
      '',
    // Companion fields: `error.details` is the position cloud#1238 shipped, and
    // it wins; the top-level read stays for the flat/legacy dialects that still
    // emit them there. No longer a presumption — the position is measured.
    messageEn: asText(details?.messageEn) ?? asText(body.messageEn),
    upgrade: asFlag(details?.upgrade, body.upgrade),
    topUp: asFlag(details?.topUp, body.topUp),
    resetsTonight: asOptionalFlag(details?.resetsTonight, body.resetsTonight),
  };
}

/**
 * The chat POST was rejected BEFORE any assistant tokens streamed — an HTTP
 * error (429 rate-limit, 5xx, …) or an outright network failure. `sendAwareFetch`
 * (useObjectChat) tags these with `notSent: true` because the AI SDK otherwise
 * surfaces a bare Error that can't be told apart from a mid-stream drop (which
 * may have completed server-side and is *reconciled*, not retried).
 *
 * A "not sent" failure means the user's message never reached the model: the
 * composer must RESTORE the text and show a clear error instead of silently
 * dropping it (the rate-limit incident this fixes).
 */
export function isUnsentSendError(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && (err as { notSent?: unknown }).notSent === true,
  );
}

/** HTTP status tagged onto an unsent send failure (e.g. 429), when one was received. */
export function sendErrorStatus(err: unknown): number | undefined {
  const status =
    err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined;
  return typeof status === 'number' ? status : undefined;
}

/**
 * True when a send failure was a rate-limit (HTTP 429), so the composer can show
 * "you're sending too quickly — wait a moment" rather than a generic failure.
 * Prefers the tagged status; falls back to a message probe (the AI SDK drops the
 * status, and older runtimes / proxies phrase 429s in the body).
 */
export function isRateLimitError(err: unknown): boolean {
  if (sendErrorStatus(err) === 429) return true;
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /\b429\b|too many requests|rate[\s_-]?limit/i.test(raw);
}

