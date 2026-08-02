// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defaultValue` runtime tokens — the reserved STRING sentinels a field's
 * `defaultValue` may carry that are **not literals to store**, but instructions
 * resolved at insert time by whoever owns the value.
 *
 * # Why this vocabulary has to live in one place
 *
 * `Field.defaultValue` is `z.unknown()`: an author may put a literal (`'open'`,
 * `0`, `false`), an Expression envelope (`{ dialect: 'cel', source: 'today()' }`,
 * ROADMAP §M9.9b), or one of these tokens in it. Two very different subsystems
 * then have to agree on which is which:
 *
 *   - the **engine** (`ObjectQL.applyFieldDefaults`), which fills an omitted
 *     field on the insert path, and
 *   - a **driver's DDL**, which turns `defaultValue` into a physical column
 *     DEFAULT.
 *
 * When only one of them knows a token, the other treats it as a literal — and a
 * literal token is silently WRONG data. That is exactly how `current_user`
 * became a column DEFAULT in SQL and how the string `'current_user'` ended up
 * stored in `lookup('sys_user')` columns for every write the engine had
 * deliberately left unset (#4560): the engine handled the token, the DDL had
 * never heard of it, and `col.defaultTo(dv)` passed it straight through.
 *
 * So the token set is declared HERE, once, and both sides read it. A token
 * added below is automatically excluded from literal column DEFAULTs by every
 * driver that consults {@link isRuntimeDefaultToken}, whether or not that driver
 * has learned to translate it.
 *
 * # Who resolves what
 *
 * | Token | Resolved by | Physical column DEFAULT |
 * |---|---|---|
 * | `NOW()` | the **database** (`CURRENT_TIMESTAMP` and friends) | yes — the driver's native now-expression |
 * | `current_user` | the **engine**, from the request's `ExecutionContext` | **none** |
 *
 * `current_user` has no database counterpart at all: SQL's own `CURRENT_USER`
 * is the *connection* role, not an ObjectStack `sys_user.id`, and the engine
 * deliberately leaves the field UNSET when there is no authenticated user
 * (system/anonymous writes) rather than stamp a bogus owner. A column DEFAULT
 * would override precisely that decision, which is why the split above is a
 * contract and not an implementation detail — see {@link isRuntimeDefaultToken}.
 *
 * # Out of scope
 *
 * - `{current_user_id}` / `{current_org_id}` — the braced **filter** vocabulary
 *   (`./context-tokens.zod.ts`). Different surface, different resolver; the
 *   near-miss overlap is catalogued there as `CONTEXT_TOKEN_SUGGESTIONS`.
 * - `current_user.*` in RLS `using` expressions — an expression root, not a
 *   default (`@objectstack/plugin-security`).
 * - Expression-envelope defaults (`{ dialect, source }`) — a structured value,
 *   recognised by shape rather than by spelling, and never a column DEFAULT.
 */

/**
 * "Use the clock at insert time." The one token with a native database
 * counterpart, so a driver translates it into a real column DEFAULT.
 */
export const DEFAULT_VALUE_TOKEN_NOW = 'NOW()';

/**
 * "Use the acting user's id at insert time." Resolved by the engine against the
 * request context; NEVER a column DEFAULT (see the module note).
 */
export const DEFAULT_VALUE_TOKEN_CURRENT_USER = 'current_user';

/**
 * The complete set of `defaultValue` runtime tokens.
 *
 * Deliberately tiny, for the same reason `CONTEXT_TOKENS` is: every entry is a
 * spelling that stops being usable as a literal default anywhere in the
 * platform, and it has to be honoured by the engine and by every driver's DDL.
 */
export const DEFAULT_VALUE_TOKENS = [
  DEFAULT_VALUE_TOKEN_NOW,
  DEFAULT_VALUE_TOKEN_CURRENT_USER,
] as const;

export type DefaultValueToken = (typeof DEFAULT_VALUE_TOKENS)[number];

/**
 * Description table — feeds skill / docs generation. Pure data, deliberately
 * not exported through any zod schema.
 */
export const DEFAULT_VALUE_TOKEN_DESCRIPTIONS: Record<DefaultValueToken, string> = {
  'NOW()': 'The database clock at insert time. Emitted as a native column DEFAULT.',
  current_user:
    "The acting user's id at insert time, from the request's ExecutionContext. " +
    'Never emitted as a column DEFAULT — with no authenticated user the field stays unset.',
};

/**
 * Is `v` the `'NOW()'` token?
 *
 * Case-insensitive and whitespace tolerant, which is the rule the SQL driver
 * has always applied to this token (`'now()'`, `' NOW() '` all count) and the
 * one the ~100 `defaultValue: 'NOW()'` declarations in the platform objects
 * rely on.
 */
export function isNowDefaultToken(v: unknown): v is string {
  return typeof v === 'string' && /^now\(\)$/i.test(v.trim());
}

/**
 * Is `v` the `'current_user'` token?
 *
 * EXACT match, matching `applyFieldDefaults`. Near-miss spellings
 * (`{current_user}`, `currentUser`) are authoring errors caught by lint — they
 * are deliberately NOT accepted here, because silently widening the token would
 * make a genuinely-intended literal unstorable.
 */
export function isCurrentUserDefaultToken(v: unknown): v is string {
  return v === DEFAULT_VALUE_TOKEN_CURRENT_USER;
}

/**
 * Is `v` **any** `defaultValue` runtime token?
 *
 * The predicate a DDL emitter wants: a token is an instruction, never a value,
 * so it must never reach `col.defaultTo(...)` as a literal. A driver that can
 * translate a particular token natively (as SQL does for `NOW()`) checks for
 * that one FIRST and falls through to this predicate for the rest — which means
 * a token added to {@link DEFAULT_VALUE_TOKENS} tomorrow degrades to "no column
 * default" (the engine's job) instead of leaking its own spelling into the
 * database.
 */
export function isRuntimeDefaultToken(v: unknown): v is string {
  return isNowDefaultToken(v) || isCurrentUserDefaultToken(v);
}

/**
 * Is `v` a runtime token that the **application layer** owns end to end — i.e.
 * one with no database counterpart, whose column must therefore carry NO
 * DEFAULT at all?
 *
 * The complement of {@link isNowDefaultToken} within the token set. This is what
 * a schema-evolution pass checks a pre-existing column's physical DEFAULT
 * against: a column whose default is the literal token text was created by a
 * build that did not know the token, and the default has to go (#4560).
 */
export function isAppResolvedDefaultToken(v: unknown): v is string {
  return isRuntimeDefaultToken(v) && !isNowDefaultToken(v);
}
