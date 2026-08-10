// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DATE_MACRO_WRAPPED_RE, isDateMacroToken } from './date-macros.zod.js';

/**
 * Context Tokens — the declarative placeholders that resolve against the
 * **caller's session** (who am I, which org am I in) rather than the clock.
 *
 * # Why this lives in `spec`
 *
 * These are the sibling vocabulary to `{date-macros}`. Filter values in
 * dashboards, views, reports and pages travel as JSON, so a user-scoped
 * slice cannot call `currentUser().id` inline — it writes a placeholder:
 *
 *     { owner_id: '{current_user_id}' }
 *     [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }]
 *
 * Like date macros, the placeholders are expanded on **both** sides of
 * the wire (framework#3582): `resolveContextTokens()` in
 * `@object-ui/core` before the filter leaves the browser, and
 * `resolveFilterTokens()` in `@objectstack/core` on the ObjectQL read
 * AND write paths and the analytics dataset executor, for filters that
 * reach the database without passing through a renderer. The DRIVER
 * only ever sees concrete ids, never `{tokens}`.
 *
 * The write verbs matter as much as the read ones (#3810): a filter has
 * to select the same rows whether `find`, `update` or `delete` consumes
 * it, or a flow that previews with one and acts with the other operates
 * on two different row sets.
 *
 * The server resolver reads `ExecutionContext` — `{current_user_id}` is
 * `userId`, `{current_org_id}` is `tenantId`. A request that carries
 * neither is an ERROR, not a null comparand: resolving to `null`
 * degrades to `IS NULL` on most drivers and would hand back the rows
 * the filter was written to exclude.
 *
 * # Presentation scope, NOT a security boundary
 *
 * This is the single most important thing to understand about these
 * tokens. `{current_user_id}` scopes what a surface *shows*; it does not
 * decide what a caller is *allowed* to read. Enforcement is RLS, which
 * uses a different and genuinely server-side vocabulary rooted at
 * `current_user` (`owner_id = current_user.id`, compiled by
 * `@objectstack/plugin-security`'s RLS compiler).
 *
 * The two look alike and are easy to confuse, so keep them straight:
 *
 * | | `{current_user_id}` | `current_user.id` |
 * |---|---|---|
 * | Where | filter values (JSON) | RLS `using` expressions |
 * | Resolved | client-side, before the query | server-side, during the query |
 * | Purpose | presentation scope | access enforcement |
 * | Bypassable | yes — it's just a filter | no |
 *
 * Never reach for a context token to keep a user away from data. Removing
 * a `{current_user_id}` filter widens a *view*; it must never widen
 * *access*.
 *
 * # Where the tokens are honoured
 *
 * Filter values on every surface that resolves placeholders — object list
 * views, dashboard widgets, reports, SDUI page components. Navigation
 * (`recordId` / `params`) additionally resolves `AppContextSelector` ids
 * such as `{active_package}`; those are nav-only and are NOT valid inside
 * filter values, because filters are not evaluated with the sidebar's
 * selector state.
 *
 * # Out of scope
 *
 * - `current_user.*` RLS expressions — see `@objectstack/plugin-security`.
 * - `{date-macros}` — the clock-based sibling; see `./date-macros.zod.ts`.
 * - `titleFormat` field interpolation (`{user_id}` etc.) — that substitutes
 *   *record fields*, an unrelated mechanism that happens to share braces.
 */

/**
 * The complete set of session-scoped filter tokens.
 *
 * Deliberately tiny. Every addition is a platform contract that three
 * surfaces and one lint pass must honour, so a token earns its place only
 * when it cannot be expressed as a plain field filter.
 */
export const CONTEXT_TOKENS = [
  'current_user_id',
  'current_org_id',
] as const;

export type ContextToken = (typeof CONTEXT_TOKENS)[number];

/**
 * Test helper: is `token` (without braces) a recognised context token?
 * Use in lint passes and AI-side validators.
 */
export function isContextToken(token: string): boolean {
  return (CONTEXT_TOKENS as readonly string[]).includes(token);
}

/**
 * Match the **wrapped** form a filter author actually writes —
 * `{current_user_id}` or `${current_user_id}`. Shares the date-macro
 * grammar so a single walk over a filter tree can classify both.
 *
 * This is the **well-formed token NAME** grammar: what a spelling has to look
 * like before it can be a member of either vocabulary. It is deliberately NOT
 * the grammar that decides whether a value is a placeholder *attempt* — see
 * {@link FILTER_TOKEN_WRAPPED_RE}.
 */
export const CONTEXT_TOKEN_WRAPPED_RE = DATE_MACRO_WRAPPED_RE;

/**
 * Match a filter value that is a placeholder **by intent**: entirely wrapped
 * in one pair of braces, whatever the characters inside (#5586).
 *
 * # Why this is wider than {@link CONTEXT_TOKEN_WRAPPED_RE}
 *
 * Recognition and vocabulary are two different questions, and conflating them
 * left the diagnostic with a hole exactly where authors fall in. While
 * recognition used the token-NAME grammar (`[a-zA-Z0-9_]+`), any placeholder
 * carrying a non-word character — `{TODAY()}`, `{current-user-id}`,
 * `{30 days ago}`, `{user.id}` — was not classified as a token at all. It was
 * therefore handed to the driver verbatim and compared as a **literal string**:
 * the silent-wrong-result mode this vocabulary exists to abolish. The failure
 * was inverted against the author, too — misspelling `{today}` as `{TODAY}`
 * produced a loud `UnknownFilterTokenError`, while misspelling it as
 * `{TODAY()}` produced *rows*, and on a string comparison the wrong ones
 * (`'2026-…' < '{'` in lexicographic order, so a `<` window silently gained
 * every future-dated row).
 *
 * The shapes that leaked are precisely the ones an author migrating from
 * another system's macro syntax writes first: `TODAY()` (Salesforce/Excel-style
 * call syntax), kebab-case, natural language, dotted paths.
 *
 * So: wide in, strict out. Anything fully brace-wrapped is read as "the author
 * meant a placeholder", and the *vocabulary* check then either resolves it or
 * refuses it by name. No author writes a filter comparand whose intended
 * literal value is the six characters `{foo}`; a value that merely CONTAINS
 * braces (`'acme {x} deal'`) is untouched, as are `{a}{b}` and `{{x}}`, which
 * are not one wrapped token.
 *
 * The flow template engine's filter position already used exactly this shape
 * (`interpolateFilter` in `@objectstack/service-automation`, #3810) to decide
 * "is this string one whole token?" before consulting the vocabulary — this
 * aligns the platform diagnostic with the recognition rule that surface had.
 */
export const FILTER_TOKEN_WRAPPED_RE = /^\$?\{([^{}]+)\}$/;

/** Strict zod schema for the **token name** (the bit inside `{}`). */
export const ContextTokenSchema = z
  .string()
  .refine(isContextToken, {
    message: `Unknown context token. Must be one of: ${CONTEXT_TOKENS.join(', ')}`,
  });

/**
 * Zod schema for a complete placeholder string (`'{current_user_id}'`).
 * Use as an opt-in refinement on filter values to fail loudly on unknown
 * tokens instead of silently sending them to SQL.
 */
export const ContextTokenPlaceholderSchema = z
  .string()
  .refine(
    (s) => {
      const m = s.match(CONTEXT_TOKEN_WRAPPED_RE);
      return !!m && isContextToken(m[1]);
    },
    { message: 'Not a recognised {context-token} placeholder' },
  );
export type ContextTokenPlaceholder = z.input<typeof ContextTokenPlaceholderSchema>;

/**
 * Description table — feeds skill / docs generation. Pure data,
 * intentionally not exported through any zod schema.
 */
export const CONTEXT_TOKEN_DESCRIPTIONS: Record<ContextToken, string> = {
  current_user_id: "The signed-in user's id (`sys_user.id`).",
  current_org_id:  'The active organization id.',
};

/**
 * Near-miss spellings → the token the author meant.
 *
 * Every entry here is a real mistake observed in authored metadata, and
 * each one used to fail the same way: the literal string reached SQL,
 * matched nothing, and the surface rendered an empty result with no error
 * anywhere. Silent-zero is especially costly for AI authors, which read a
 * `0` as a successful query and build on it.
 *
 * `current_user` and `user_id` dominate because both are correct spellings
 * *somewhere else* in the platform — `current_user.id` is the RLS root, and
 * `{user_id}` is valid `titleFormat` field interpolation. Lint quotes the
 * suggestion so the author is corrected at authoring time, where an AI can
 * still see and act on it.
 */
export const CONTEXT_TOKEN_SUGGESTIONS: Readonly<Record<string, ContextToken>> = {
  current_user:            'current_user_id',
  current_user_email:      'current_user_id',
  user_id:                 'current_user_id',
  userid:                  'current_user_id',
  me:                      'current_user_id',
  current_organization_id: 'current_org_id',
  org_id:                  'current_org_id',
  organization_id:         'current_org_id',
  current_tenant_id:       'current_org_id',
};

/**
 * Is `token` (without braces) resolvable inside a **filter value**?
 *
 * The union of the two filter vocabularies: date macros and context
 * tokens. This is the predicate a lint pass wants — anything else in a
 * filter value is passed through to the data engine verbatim and will
 * match nothing.
 *
 * Note this is deliberately narrower than what navigation accepts:
 * `recordId` / `params` also resolve `AppContextSelector` ids, which are
 * meaningless in a filter.
 */
export function isKnownFilterToken(token: string): boolean {
  return isContextToken(token) || isDateMacroToken(token);
}

/**
 * Classify a filter *value*. Returns `null` when the value is not a
 * placeholder at all (a plain literal), so callers can walk a whole filter
 * tree and only act on the strings that look like placeholders.
 *
 * Distinguishing `unknown` from "not a placeholder" is what lets lint stay
 * quiet about ordinary values while still catching `{current_user}`.
 *
 * Recognition is {@link FILTER_TOKEN_WRAPPED_RE} — placeholder by INTENT, not
 * by well-formedness (#5586). A fully brace-wrapped value whose inside is not
 * a legal token name (`{TODAY()}`, `{user.id}`, `{30 days ago}`) is `unknown`,
 * NOT `null`: `null` would send it to the data engine to be compared as a
 * literal string, which is the silent-wrong-rows outcome this classification
 * exists to prevent. The token reported is the raw text between the braces, so
 * the caller's error names exactly what the author wrote.
 */
export function classifyFilterToken(
  value: unknown,
):
  | { kind: 'context'; token: ContextToken }
  | { kind: 'date-macro'; token: string }
  | { kind: 'unknown'; token: string; suggestion?: ContextToken }
  | null {
  if (typeof value !== 'string') return null;
  const m = value.match(FILTER_TOKEN_WRAPPED_RE);
  if (!m) return null;
  const token = m[1];
  if (isContextToken(token)) return { kind: 'context', token: token as ContextToken };
  if (isDateMacroToken(token)) return { kind: 'date-macro', token };
  return { kind: 'unknown', token, suggestion: CONTEXT_TOKEN_SUGGESTIONS[token.toLowerCase()] };
}
