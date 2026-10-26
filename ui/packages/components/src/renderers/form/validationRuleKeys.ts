/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The validation-rule names react-hook-form actually RUNS (objectui#5099).
 *
 * react-hook-form's field validator destructures a FIXED key set off the
 * field descriptor and silently drops every other key. From the installed
 * 7.85.0 bundle (`dist/index.cjs.js`, minified):
 *
 *     const{ref:c,refs:f,required:m,maxLength:y,minLength:p,min:g,max:b,
 *           pattern:V,validate:A,name:x,valueAsNumber:S,mount:k}=e._f
 *
 * Of those twelve, seven are authorable validation rules — the rest are
 * field-descriptor internals react-hook-form writes itself and an author
 * never supplies through `FieldValidationRules`. Any rule name outside the
 * seven — a misspelled `minlength`, an invented `email`, the numeric keys
 * left by spreading an ARRAY into `validation` — is dropped without a trace:
 * the field renders, the form looks validated, and the rule never runs. The
 * form renderer reports such names loudly (dev-time `console.error`; see
 * `form.tsx`).
 *
 * Both lists are PINNED against the installed react-hook-form bundle by
 * `__tests__/rhf-recognized-rule-keys.test.ts`, which re-derives the
 * destructured set from `dist/index.cjs.js` at test time. A react-hook-form
 * bump that changes the set turns that test red — forcing a human to re-sort
 * the new key into one of these two lists — instead of silently rotting the
 * diagnostic.
 */

/**
 * Keys react-hook-form's validator destructures that are NOT authorable
 * rules: descriptor internals the library maintains itself.
 */
export const RHF_DESCRIPTOR_NON_RULE_KEYS: readonly string[] = [
  'ref',
  'refs',
  'name',
  'valueAsNumber',
  'mount',
];

/**
 * The authorable rule names react-hook-form's validator reads. Exactly the
 * declared key set of `FieldValidationRules` in `@object-ui/types` —
 * declared = enforced; anything else in a field's `validation` object is a
 * bug in the metadata, not a rule.
 */
export const RHF_RECOGNIZED_RULE_KEYS: ReadonlySet<string> = new Set([
  'required',
  'minLength',
  'maxLength',
  'min',
  'max',
  'pattern',
  'validate',
]);
