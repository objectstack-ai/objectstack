// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DATE_MACRO_WRAPPED_RE, isDateMacroToken } from './date-macros.zod.js';

/**
 * Context Tokens — the declarative placeholders that resolve against the
 * **caller's session** (who am I, which org am I in) rather than the clock,
 * plus one sibling that resolves against the **surface**: `{record_id}`, the
 * record a `type: 'record'` page is showing.
 *
 * The two resolve against different things, so they are two lists, never one:
 *
 * | | `CONTEXT_TOKENS` | `RECORD_CONTEXT_TOKENS` |
 * |---|---|---|
 * | Tokens | `{current_user_id}`, `{current_org_id}` | `{record_id}` |
 * | Resolves against | the caller's session | the record the page is bound to |
 * | Known on the server | yes — `ExecutionContext` | never — only the page renderer knows which record is in view |
 * | Valid on | every filter surface | a component on a `type: 'record'` page, and nowhere else |
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
 * `{record_id}` is resolved on ONE side of the wire only: by the page
 * renderer, which substitutes the id of the record a `type: 'record'` page
 * is showing before the filter leaves the browser. The server never knows
 * which record a page is showing, so a filter that reaches
 * `resolveFilterTokens()` still carrying `{record_id}` is refused by name
 * (`FILTER_TOKEN_UNRESOLVED` / 400) — which is also what an author sees
 * from a renderer that does not resolve the token yet. It never becomes
 * `null`, `undefined` or the literal string: a number written as "about
 * this record" must neither silently become "about everybody" (the
 * condition dropped) nor "about nobody" (the token compared as text).
 *
 * # Presentation scope, NOT a security boundary
 *
 * This is the single most important thing to understand about these
 * tokens. `{current_user_id}` scopes what a surface *shows*; it does not
 * decide what a caller is *allowed* to read. `{record_id}` is the same: it
 * narrows a record-page component to the record in view, and which of those
 * rows the caller may read is still not its decision. Enforcement is RLS, which
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
 * `{current_user_id}` and `{current_org_id}`: filter values on every surface
 * that resolves placeholders — object list views, dashboard widgets,
 * reports, datasets, SDUI page components — and on the server's ObjectQL
 * read and write paths and analytics doors.
 *
 * `{record_id}`: filter values on a component of a `type: 'record'` page,
 * and nowhere else. `@objectstack/lint`'s `validate-filter-tokens` refuses it
 * by name ("no record in context on this surface") on list views, dashboard
 * widgets, reports, datasets, apps, object definitions and every page that is
 * not `type: 'record'`. The server refuses it on every path, because no
 * server path has a record in context.
 *
 * Navigation (`recordId` / `params`) additionally resolves
 * `AppContextSelector` ids such as `{active_package}`; those are nav-only and
 * are NOT valid inside filter values, because filters are not evaluated with
 * the sidebar's selector state.
 *
 * # `{record_id}` is not `{recordId}`, and not the `'record_id'` variable type
 *
 * Three spellings look alike and are three different mechanisms:
 *
 * - `{record_id}` — this filter token. A whole filter VALUE, resolved to the
 *   id of the record the page shows.
 * - `{recordId}` — a URL / flow-template placeholder: an action's
 *   `newTabUrl` (`action.zod.ts`) and the flow template dialect
 *   (`@objectstack/lint`'s `flow-template-grammar.ts`). It is interpolated by
 *   those surfaces' own template engines and is NOT a filter token. Written
 *   inside a filter it is refused, with `{record_id}` suggested.
 * - `'record_id'` — a page-variable TYPE (`PageVariableSchema.type` in
 *   `page.zod.ts`), naming what a page variable holds, e.g. the selection of
 *   an `element:record_picker`. It is read in expressions as `page.<name>`,
 *   never written as a placeholder.
 *
 * # Out of scope
 *
 * - `current_user.*` RLS expressions — see `@objectstack/plugin-security`.
 * - `{date-macros}` — the clock-based sibling; see `./date-macros.zod.ts`.
 * - `titleFormat` field interpolation (`{user_id}` etc.) — that substitutes
 *   *record fields*, an unrelated mechanism that happens to share braces.
 * - Tokens for a record OTHER than the one in view (a related record, a
 *   parent of the record). Each is its own contract with its own resolver,
 *   not an extension of `{record_id}`.
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
 * The complete set of RECORD-scoped filter tokens: resolved against the
 * SURFACE, meaning the record a `type: 'record'` page is showing, never
 * against the caller's session.
 *
 * `record_id` is the id of that record. On a person's record page,
 * `{ assignee: '{record_id}' }` counts that person's tasks. Without it, the
 * only filter an author can write counts the whole organisation's, under
 * that person's name.
 *
 * A sibling of {@link CONTEXT_TOKENS}, not a member, because every consumer
 * of that list resolves it from the session: the client resolver fills it
 * from the signed-in user and org, and the server from `ExecutionContext`.
 * Neither knows which record a page is showing. So a record-context token
 * resolves only in the page renderer. `resolveFilterTokens()` refuses it by
 * name on every server path, and lint refuses it on every surface that is not
 * a record page.
 *
 * Deliberately tiny, for the reason `CONTEXT_TOKENS` is. A token for any
 * record other than the one in view (a related record, a parent) is its own
 * contract, not an entry here.
 */
export const RECORD_CONTEXT_TOKENS = [
  'record_id',
] as const;

export type RecordContextToken = (typeof RECORD_CONTEXT_TOKENS)[number];

/**
 * Is `token` (without braces) a record-context token, one that resolves only
 * where a record is in context? See {@link RECORD_CONTEXT_TOKENS}.
 */
export function isRecordContextToken(token: string): boolean {
  return (RECORD_CONTEXT_TOKENS as readonly string[]).includes(token);
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
 *
 * The `record_id` rows follow the same rule. `recordid` is `{recordId}`
 * lower-cased, and `{recordId}` is the URL / flow-template placeholder
 * (`newTabUrl`, the flow template dialect), which is a correct spelling
 * somewhere else. `record.id` is the flow template dialect's path to its
 * triggering record. `record-id` is the kebab shape #5586 recognised, and
 * `current_record_id` is the `current_*` shape the session tokens teach.
 */
export const CONTEXT_TOKEN_SUGGESTIONS: Readonly<Record<string, ContextToken | RecordContextToken>> = {
  current_user:            'current_user_id',
  current_user_email:      'current_user_id',
  user_id:                 'current_user_id',
  userid:                  'current_user_id',
  me:                      'current_user_id',
  current_organization_id: 'current_org_id',
  org_id:                  'current_org_id',
  organization_id:         'current_org_id',
  current_tenant_id:       'current_org_id',
  recordid:                'record_id',
  'record.id':             'record_id',
  'record-id':             'record_id',
  current_record_id:       'record_id',
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
 *
 * It is deliberately narrower than {@link classifyFilterToken} too. The
 * record-context tokens ({@link RECORD_CONTEXT_TOKENS}) are NOT members,
 * because this predicate answers "can the server resolve it?", and no server
 * position has a record in context. Its one consumer is such a position: the
 * flow template engine's filter hand-off (`interpolateFilter` in
 * `@objectstack/service-automation`) passes a token it cannot resolve on to
 * ObjectQL only when this predicate says ObjectQL can. A flow addresses its
 * own record as `{record.id}`, so an unset `{record_id}` there stays the flow's
 * own unresolved-variable refusal.
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
 *
 * `record-context` is its own kind rather than a `context` token because the
 * verdict on it depends on WHERE it is written: it resolves on a record page
 * and nowhere else (see {@link RECORD_CONTEXT_TOKENS}). A caller that has no
 * record in context refuses it by name, never as `unknown`, because the
 * spelling is right and the surface is not.
 */
export function classifyFilterToken(
  value: unknown,
):
  | { kind: 'context'; token: ContextToken }
  | { kind: 'record-context'; token: RecordContextToken }
  | { kind: 'date-macro'; token: string }
  | { kind: 'unknown'; token: string; suggestion?: ContextToken | RecordContextToken }
  | null {
  if (typeof value !== 'string') return null;
  const m = value.match(FILTER_TOKEN_WRAPPED_RE);
  if (!m) return null;
  const token = m[1];
  if (isContextToken(token)) return { kind: 'context', token: token as ContextToken };
  if (isRecordContextToken(token)) return { kind: 'record-context', token: token as RecordContextToken };
  if (isDateMacroToken(token)) return { kind: 'date-macro', token };
  // Own-property guard: the table is a plain object literal, so a bare index
  // resolves `Object.prototype`'s members for an off-vocabulary token —
  // `{constructor}` put the `Object` FUNCTION and `{__proto__}`
  // `Object.prototype` itself into `suggestion`, whose declared type is a
  // token-name union. A TypeScript consumer holds a compile-time guarantee that
  // is false at runtime, and nothing in the type system will ever flag it.
  //
  // The reach is not bounded by the identifier shapes: `FILTER_TOKEN_WRAPPED_RE`
  // captures `[^{}]+`, anything but braces. What bounds it is that the key is
  // lower-cased, so only the prototype members whose names are already
  // lower-case are namable — `constructor` and `__proto__` today. `toString` /
  // `valueOf` / `hasOwnProperty` are quiet by that casing accident alone, ⛔ not
  // by a guard, and a future lower-case prototype member would join the noisy
  // set silently.
  //
  // The refusal value is this branch's own declared one: `suggestion` is
  // optional, so its absence — `undefined` — is what "resembles nothing" already
  // means here. The guard narrows: every near-miss that answered before is an
  // own key.
  //
  // ⛔ Not a null-prototype table (TS2353 against the `Readonly<Record<…>>`
  // annotation, or a silent loss of its exhaustiveness check via
  // `Object.assign(Object.create(null), …)`) and ⛔ not a list of prototype
  // member names, which the next prototype member defeats.
  const lower = token.toLowerCase();
  const suggestion = Object.prototype.hasOwnProperty.call(CONTEXT_TOKEN_SUGGESTIONS, lower)
    ? CONTEXT_TOKEN_SUGGESTIONS[lower]
    : undefined;
  return { kind: 'unknown', token, suggestion };
}
