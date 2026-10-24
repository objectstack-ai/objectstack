/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE client-side answer to "is this field's value the PRODUCER's to
 * supply?" — the other half of {@link isMissingForRequired}.
 *
 * A `required` verdict is a question about two facts: is the value absent
 * (`required-presence.ts`), and was the client ever supposed to provide it.
 * This module owns the second one. Both live here in `@object-ui/core` because
 * every layer that decides required-ness reads them: the form renderer
 * (`resolveFieldRuleState`), the wizard's cross-step gate, and the
 * create-form field builders in `@object-ui/plugin-form`.
 *
 * ## What makes a value server-owned
 *
 * A `defaultValue` may be a literal, or an *instruction* the server resolves
 * per insert:
 *
 *   - a runtime token — `'NOW()'` / `'current_user'`, the whole
 *     `DEFAULT_VALUE_TOKENS` family from `@objectstack/spec/data`
 *   - a CEL Expression envelope — `{ dialect: 'cel', source: 'today()' }`
 *
 * A CREATE form deliberately leaves such a control EMPTY and omits the key
 * from the payload, because `ObjectQL.applyFieldDefaults` resolves a declared
 * default only for a field that arrives absent or null (#4047 / #4068). The
 * field is therefore not "missing" on that submit — it is server-owned, and
 * nothing the client evaluates may declare it required (#4069 / #4085).
 *
 * ## Create only
 *
 * On an EDIT form the token was already resolved at insert. The control shows
 * a persisted value, so blanking it is a real removal and `required` (static
 * or conditional) enforces normally.
 */

import { isRuntimeDefaultToken } from '@objectstack/spec/data';

/**
 * Is `v` a CEL/template Expression envelope rather than a literal value?
 *
 * Same shape test the engine applies before handing a default to
 * `ExpressionEngine` (`{ dialect, source }`), kept structural on purpose: the
 * point is "the server evaluates this", which is true for every dialect.
 */
function isExpressionEnvelope(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { dialect?: unknown }).dialect === 'string' &&
    typeof (v as { source?: unknown }).source === 'string'
  );
}

/**
 * Is this declared `defaultValue` a RUNTIME INSTRUCTION the server resolves per
 * insert, rather than a literal value?
 *
 * True for the `DEFAULT_VALUE_TOKENS` family (`'NOW()'` / `'current_user'`) and
 * for CEL/template Expression envelopes. This is THE classifier for "the
 * producer owns this field's create value", and every consumer reads THIS one
 * — a second copy would be free to disagree about, say, a CEL envelope, and
 * then a form would seed a field it also refuses to submit. Today's consumers:
 *
 *   1. seeding (#4047 / #4068) — such a default is not seeded, because putting
 *      the literal text `NOW()` into a datetime input and submitting it
 *      suppresses the very resolution the declaration asked for;
 *   2. the create-mode static `required` rule (#4069) —
 *      `isRequiredInForm` in `@object-ui/plugin-form`;
 *   3. the create-mode `requiredWhen` rule (#4085) —
 *      {@link isServerOwnedValue}, read by `resolveFieldRuleState`;
 *   4. the "Set automatically when saved." hint (objectui#12108) — the form
 *      renderer reads the same {@link isServerOwnedValue} answer it hands to
 *      `resolveFieldRuleState`, so the hint and the lowered `required` are
 *      one verdict.
 */
export function isRuntimeDefault(v: unknown): boolean {
  return isRuntimeDefaultToken(v) || isExpressionEnvelope(v);
}

/**
 * A runtime `FormField` as far as this module is concerned: the resolved
 * object-field metadata stash, and whatever else the field carries.
 *
 * Stated structurally rather than as `@object-ui/types`' `FormField` so the
 * one key this module reads is visible in the signature — and with an index
 * signature so a caller (or a test) may hand over an object literal carrying
 * the rest of the field without tripping TypeScript's excess-property check.
 */
export interface FieldWithDeclaredDefault {
  field?: { defaultValue?: unknown } | null;
  [key: string]: unknown;
}

/**
 * Does the PRODUCER supply this field's value for the submit this form is
 * about to make? (#4085)
 *
 * The single derivation of that fact, so the three call sites that feed
 * `resolveFieldRuleState` cannot each answer "where does the declared default
 * live" differently. It reads the runtime FormField's `field` slot — the
 * resolved object-field metadata the object-bound builders stash there
 * (`ObjectForm`, `sectionFields`, and the containers' no-sections paths), and
 * the only spelling of a declared `defaultValue` that reaches the renderer.
 * A hand-authored FormField carries no object metadata, so it is never
 * server-owned and its rules are untouched.
 *
 * `isCreateForm` is the CALLER's fact, never inferred here: the form renderer
 * reads it off `FormSchema.previousValues` (whose absence *is* the declared
 * "this is an insert" signal, objectui#3484), while the wizard's step gate
 * reads its own `mode`. An evaluator guessing from a `previous` argument would
 * call an edit-mode caller that simply passes no `previous` a create form, and
 * silently drop a `requiredWhen` the author meant to enforce.
 */
export function isServerOwnedValue(
  field: FieldWithDeclaredDefault | null | undefined,
  isCreateForm: boolean,
): boolean {
  if (!isCreateForm) return false;
  return isRuntimeDefault(field?.field?.defaultValue);
}
