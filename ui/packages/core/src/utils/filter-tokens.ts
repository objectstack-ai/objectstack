/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  CONTEXT_TOKENS,
  CONTEXT_TOKEN_SUGGESTIONS,
  isContextToken,
  isRecordContextToken,
  type RecordContextToken,
} from '@objectstack/spec/data';

import { resolveDateMacros } from './date-macros.js';

/**
 * Session-scoped filter placeholders — the sibling vocabulary to
 * `{date-macros}`.
 *
 * Filter values travel as JSON, so a user-scoped slice cannot call
 * `currentUser().id` inline; it writes a placeholder that this module expands
 * immediately before the filter reaches the data source:
 *
 *     { owner_id: '{current_user_id}' }
 *
 * ## Why this module exists (objectstack-ai/objectstack#3574)
 *
 * There used to be no shared resolver. Three ad-hoc implementations had grown
 * up independently — one in `ObjectView` for list views, one in
 * `ObjectDataPage` for URL filter triples, one in `NavigationRenderer` for
 * hrefs — and each handled only the shape its own surface happened to use.
 * Dashboard widgets never got one at all, so `{current_user_id}` in a widget
 * filter reached SQL as a literal, matched no row, and the widget rendered
 * `0` with no error in the console or the server log.
 *
 * The failure mode is the point: a metric reading `0` is indistinguishable
 * from a metric that is legitimately zero, so the bug survived review and
 * shipped. Any *new* surface that resolves placeholders itself will
 * eventually reproduce it, which is why resolution lives here, once, and
 * every surface calls {@link resolveFilterPlaceholders}.
 *
 * ## Presentation scope, NOT a security boundary
 *
 * These tokens scope what a surface *shows*. They do not decide what a caller
 * is *allowed* to read — that is RLS, enforced server-side against a
 * different vocabulary rooted at `current_user` (`owner_id = current_user.id`).
 * Dropping a `{current_user_id}` filter widens a view; it must never widen
 * access. Never use a context token as an access control.
 *
 * ## `{record_id}` — the record in view, not the session (objectui#7297)
 *
 * `@objectstack/spec` declares one sibling of the two session tokens:
 * `RECORD_CONTEXT_TOKENS` = `{record_id}`, the id of the record a
 * `type: 'record'` page is showing (objectstack-ai/objectstack#20003). It is a
 * separate list, not a member of `CONTEXT_TOKENS`, because it resolves against
 * the SURFACE rather than the session, and only here: the server never knows
 * which record a page shows, so it refuses a filter still carrying the token
 * by name (`FILTER_TOKEN_UNRESOLVED`).
 *
 * Its value is `FilterTokenScope.recordId`, which `useFilterScope()` in
 * `@object-ui/react` fills from the mounted `RecordContextProvider` and from
 * nothing else — never a URL parameter, never a page variable. With no record
 * in scope the token is refused by name through `onUnresolved`, in the voice
 * an unresolved session token gets, and left as written: it never becomes
 * `null` (a count about nobody) and its condition is never dropped (a count
 * about everybody). Like the session tokens it scopes what a record page
 * SHOWS; which of those rows the caller may read is still RLS's decision.
 *
 * ## Contract source
 *
 * The canonical vocabulary is published as part of the platform contract at
 * `@objectstack/spec/data` → `CONTEXT_TOKENS`. This module used to carry a
 * hand-written copy of that tuple under the spec's own name, with a comment
 * saying the duplication was "temporary until the next coordinated release"
 * — the installed spec (17.0.0-rc.0) has exported it for some time, so the
 * copy was simply a fork wearing the spec's name (objectstack#4115).
 *
 * It is now a **re-export**, which is the only form that cannot drift: the
 * copy was byte-identical, so every value comparison and every behavioural
 * test passed while it sat here. Reference identity is the one check that
 * distinguishes a re-export from a fork (objectui#3003).
 *
 * The same argument retired the two module-local copies that sat beside it
 * until objectui#7265 — the near-miss suggestion map and the membership
 * predicate are imported from `@objectstack/spec/data` now, so neither can
 * drift either. Both were re-measured against the RESOLVED pin (17.4.0; the
 * card had measured 17.2.0) before the swap, because "byte-identical" is a
 * statement about a version, not a property: the map matched on nine keys, in
 * the same order, with the same values, and the two predicates agreed on every
 * one of 61 real vocabulary members — the token tuple, both suggestion key
 * sets, the date-macro tokens and their aliases, plus casing, whitespace and
 * prototype-key spellings. Each comparison ran a lit control of the same kind
 * through the same comparator (the spec's own token-description map, and its
 * date-macro predicate), so "no difference" came from an instrument shown able
 * to report one.
 */

/** The complete set of session-scoped filter tokens (spec-owned, re-exported). */
export { CONTEXT_TOKENS };

export type ContextTokenName = (typeof CONTEXT_TOKENS)[number];

/** Session values a filter placeholder can resolve against. */
export interface FilterTokenScope {
  /** The signed-in user's id. */
  currentUserId?: string | null;
  /** The active organization id. */
  currentOrgId?: string | null;
  /**
   * The id of the record the surface is bound to, which resolves
   * `{record_id}` (objectui#7297): the mounted record context of a
   * `type: 'record'` page. `useFilterScope()` in `@object-ui/react` fills it
   * from the nearest `RecordContextProvider`, and a host that renders no
   * record leaves it unset, so the token is refused there. ⛔ Never fill it
   * from a URL parameter or a page variable.
   */
  recordId?: string | null;
  /**
   * Called when a placeholder cannot be resolved — either a recognised token
   * with no value in scope (signed out, or no record in context), or a
   * near-miss spelling that resolves in no vocabulary. Defaults to a
   * `console.warn`; pass `null` to silence.
   */
  onUnresolved?: ((message: string) => void) | null;
}

/** Whole-string placeholder: `{token}` or `${token}`, anchored. */
const WHOLE_TOKEN_RE = /^\$?\{([a-zA-Z0-9_]+)\}$/;

/**
 * A null-prototype copy of the spec's near-miss suggestion map (objectui#9129).
 *
 * `CONTEXT_TOKEN_SUGGESTIONS` is a plain object, so indexing it with an
 * author-controlled, lower-cased string reaches `Object.prototype` for any
 * spelling that happens to be an inherited member name — `constructor` and
 * `__proto__` today, and, silently, whichever future member is added in
 * lower case (see the lookup below). This is a read-only console hint, never
 * an assignment, so no filter value is ever widened, narrowed or mismatched
 * by it; the only externally visible effect of the underlying bug is a
 * confusing suggestion string in a `warn()` call.
 *
 * Copying into an `Object.create(null)` base closes the whole class rather
 * than special-casing the two spellings measured today: this object has no
 * prototype at all, so *no* key — known or future — can resolve through it.
 * `@objectstack/spec`'s own map is left untouched (out of scope here; the
 * identical shape in its `classifyFilterToken` is the one objectstack `4342c9923` closed).
 */
const NEAR_MISS_SUGGESTIONS: Readonly<Record<string, ContextTokenName | RecordContextToken>> = Object.assign(
  Object.create(null),
  CONTEXT_TOKEN_SUGGESTIONS,
);

/**
 * Expand `{current_user_id}` / `{current_org_id}`, and `{record_id}` where a
 * record is in scope, inside a filter.
 *
 * Walks arrays and plain objects recursively, which is what makes one
 * resolver cover both platform filter shapes: the MongoDB-style object a
 * dashboard widget carries (`{ owner_id: '{current_user_id}' }`) and the
 * condition/triple arrays a list view carries (`[{ field, operator, value }]`
 * / `[['owner','=','…']]`). The predecessor helper in `ObjectView` bailed on
 * non-arrays (`if (!Array.isArray(filter)) return filter`), which is why
 * lifting it into the dashboard would have been a silent no-op.
 *
 * Only whole-string placeholders are substituted — an id is an opaque value,
 * so embedding it in a larger string (`'user-{current_user_id}'`) is never
 * what an author means, and substituting there would silently produce a value
 * that matches nothing. Unknown tokens are passed through untouched so that
 * date macros and nav-only `AppContextSelector` ids survive this pass.
 *
 * An unresolvable *known* token is deliberately left as-is rather than
 * dropped: leaving it yields an empty result, whereas dropping the clause
 * would widen the result set — and a filter that silently widens is far worse
 * than one that silently narrows.
 */
export function resolveContextTokens<T = any>(filter: T, scope: FilterTokenScope = {}): T {
  if (filter == null) return filter;

  const { currentUserId, currentOrgId, recordId } = scope;
  const warn =
    scope.onUnresolved === null
      ? () => {}
      : scope.onUnresolved ??
        ((message: string) => {
          console.warn(`[object-ui] ${message}`);
        });

  // Annotated `Record<string, …>` because the spec's predicate returns a plain
  // `boolean`, not the narrowing `token is ContextTokenName` the deleted local
  // copy declared, so the narrowed branch below hands this lookup a `string`.
  // The `satisfies` clause keeps the one thing that narrowing bought: a third
  // context token in the spec reds this literal at compile time instead of
  // resolving to `undefined` at runtime.
  const values: Record<string, string | null | undefined> = {
    current_user_id: currentUserId,
    current_org_id: currentOrgId,
  } satisfies Record<ContextTokenName, string | null | undefined>;
  // The record-context sibling, kept apart for the reason the spec keeps the
  // two lists apart: it is filled from the record in view, never from the
  // session. The same `satisfies` ratchet: a second record-context token in
  // the spec reds this literal at compile time.
  const recordValues: Record<string, string | null | undefined> = {
    record_id: recordId,
  } satisfies Record<RecordContextToken, string | null | undefined>;

  const walk = (value: any): any => {
    if (value == null) return value;

    if (typeof value === 'string') {
      const m = value.match(WHOLE_TOKEN_RE);
      if (!m) return value;
      const token = m[1];

      if (isContextToken(token)) {
        const resolved = values[token];
        if (resolved != null && resolved !== '') return resolved;
        warn(
          `Filter placeholder "{${token}}" could not be resolved — no ${
            token === 'current_user_id' ? 'signed-in user' : 'active organization'
          } in scope. The filter will match no records.`,
        );
        return value;
      }

      // `{record_id}` (objectui#7297). Resolved only from the record in scope.
      // With none, it is refused BY NAME, in the voice of the unresolved
      // session token above, and left as written: never `null` (a count about
      // nobody), never dropped (a count about everybody), and never reported as
      // an unknown spelling, because the spelling is right and the surface is
      // not. The ObjectStack server then refuses the same filter by name
      // (`FILTER_TOKEN_UNRESOLVED`), since no server path has a record in view.
      if (isRecordContextToken(token)) {
        const resolved = recordValues[token];
        if (resolved != null && resolved !== '') return resolved;
        warn(
          `Filter placeholder "{${token}}" could not be resolved — no record in context ` +
            `on this surface. It resolves only on a component of a \`type: 'record'\` page, ` +
            `to the id of the record that page shows. It is left as written, so the filter ` +
            `never widens: the server refuses it by name, and a backend with no resolver ` +
            `matches no records.`,
        );
        return value;
      }

      // Not ours. Warn only for near-misses, which resolve in no vocabulary
      // at all and would otherwise fail silently; genuine date macros and
      // nav context-selector ids must pass through quietly.
      //
      // Every spelling in the imported map is a real authoring mistake, and
      // each is a correct spelling *somewhere else* in the platform, which is
      // exactly why authors reach for it: `current_user` is the RLS expression
      // root, `{user_id}` is valid `titleFormat` field interpolation,
      // `organization_id` is a real column name. The map only makes the runtime
      // warning actionable; the authoring-time gate (`validateFilterTokens` in
      // `@objectstack/lint`) is what actually prevents these from shipping.
      const suggestion = NEAR_MISS_SUGGESTIONS[token.toLowerCase()];
      if (suggestion) {
        warn(
          `Filter placeholder "{${token}}" is not a recognised token — did you mean ` +
            `"{${suggestion}}"? It is sent to the server as a literal string and will ` +
            `match no records.`,
        );
      }
      return value;
    }

    if (Array.isArray(value)) return value.map(walk);
    // Only a PLAIN object (prototype `Object.prototype` or `null`) is a bag to
    // walk. Anything else is a leaf, returned as the same instance: rebuilding
    // a `Date` from its own keys — it has none — turned a comparand the spec
    // admits (`ACCEPTED_FILTER_COMPARAND_TYPES`) into `{}` (objectui#10506).
    if (typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return value;
      const out: Record<string, any> = {};
      for (const k of Object.keys(value)) out[k] = walk((value as any)[k]);
      return out;
    }
    return value;
  };

  return walk(filter) as T;
}

/**
 * Resolve **every** placeholder vocabulary a filter value understands — date
 * macros and context tokens — in one call.
 *
 * This is the function surfaces should call. Calling only one of the two
 * resolvers is the defect behind objectstack-ai/objectstack#3574: dashboard widgets called
 * `resolveDateMacros` alone, so `{today}` worked and `{current_user_id}`
 * silently did not.
 *
 * Order is irrelevant (the vocabularies are disjoint) but fixed here so
 * behaviour is identical everywhere.
 */
export function resolveFilterPlaceholders<T = any>(
  filter: T,
  scope: FilterTokenScope = {},
  now: Date = new Date(),
): T {
  if (filter == null) return filter;
  return resolveContextTokens(resolveDateMacros(filter, now), scope);
}
