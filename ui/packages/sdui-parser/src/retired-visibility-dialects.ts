/**
 * ObjectUI — the retired node-level visibility dialects
 * `visibleOn` / `hiddenOn` / `disabledOn` (ADR-0089, ADR-0049)
 *
 * The three were `BaseSchema` members beside the canonical keys they
 * duplicated — `visibleOn` beside `visibleWhen`, `hiddenOn` beside `hidden`,
 * `disabledOn` beside `disabled` — each read as a lower-precedence leg of
 * `SchemaRenderer`'s predicate chains, and each taught as protocol by the
 * published skill. The canonical key takes the same predicate string or CEL
 * envelope with the same polarity, so a second spelling of each had nothing to
 * say; they are retired at both faces at once (a `?: never` tombstone on the
 * declaration, an alias refusal on the zod mirror) with no alias window.
 *
 * This module is the parser tier's half, in the shape `./body-dialect.ts`
 * established for the retired `body` spelling: it REPLACES the diagnostic the
 * prop walk would otherwise emit — "has no prop" — with one that NAMES the
 * replacement, rather than adding a second diagnostic for one mistake. After
 * the retirement "`<badge>` has no prop visibleOn" is true, but it is the answer
 * that sent authors the wrong way before: the tier built to accept AI-authored
 * pages owes the migration, not merely the refusal. Same code (`unknown-prop`),
 * so a consumer keying on the code still reads "undeclared key".
 *
 * SCOPE — asked INSIDE the `!input` branch, so a registration that declares its
 * own input under one of these names keeps its declared type check untouched.
 * Measured against the live registry when this landed: none does.
 */

import type { Diagnostic } from './types.js';

/** The retired spelling → the canonical key an author writes instead. */
export const RETIRED_VISIBILITY_DIALECTS: Readonly<Record<string, string>> = Object.freeze({
  visibleOn: 'visibleWhen',
  hiddenOn: 'hidden',
  disabledOn: 'disabled',
});

/**
 * The diagnostic for an authored retired dialect, or `null` when this module
 * has nothing to say about the key.
 *
 * @param tag  the node's component type, for the message and the `tag` field
 * @param key  the authored prop name
 */
export function checkRetiredVisibilityDialect(tag: string, key: string): Diagnostic | null {
  const canonical = RETIRED_VISIBILITY_DIALECTS[key];
  if (canonical === undefined) return null;
  return {
    severity: 'warning',
    code: 'unknown-prop',
    message:
      `<${tag}> has no prop "${key}" — the key is "${canonical}" ` +
      `("${key}" is a retired spelling of it; same predicate, same polarity)`,
    tag,
  };
}
