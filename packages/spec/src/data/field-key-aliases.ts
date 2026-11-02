// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { FIELD_KEY_GUIDANCE } from './authoring-key-lint';

/**
 * The rename tables of a field and of one of its options — ONE copy each, read
 * by every surface that spells those keys.
 *
 * Two surfaces read them:
 *
 * - `FieldSchema` and `SelectOptionSchema` (`field.zod.ts`), whose `aliases`
 *   they are;
 * - the field and option patches of `ObjectExtensionSchema.fieldPatches`
 *   (`object.zod.ts`, ADR-0146 D10), which carry the rows whose TARGET the
 *   display whitelist admits — `helpText` → `inlineHelpText` on a patch as on
 *   the field it patches — taken by filter, never restated.
 *
 * Why a module of its own: `action-target-aliases.ts`'s reason. The two files
 * must read the SAME object, never two copies of it; exported from
 * `field.zod.ts` the tables would ride the `data` barrel into the published
 * API, a contract for what is authoring judgement. This module is reached by
 * relative import only.
 */

/**
 * `FIELD_KEY_GUIDANCE`, re-expressed as `strictObject` options.
 *
 * That table is the curated list of near-misses and retirements on the field
 * surface — twenty-odd entries, every one found in the wild, and already held
 * honest by `authoring-key-lint.test.ts` (every `to` must name a key
 * `FieldSchema` really declares; no entry may exist for a key that is still
 * live). Copying it into `FieldSchema`'s options would have made a second copy
 * of the truth, which is the thing this campaign keeps finding rotted.
 *
 * It also carries knowledge the fallback cannot rederive, and the proof is in
 * that file: `pii` is three edits from `min`, so an edit-distance suggester
 * offers "did you mean `min`?" — confident, wrong, and about an unrelated
 * concept. The lint suppressed that years ago. Closing the field shape without
 * reusing the table reintroduced it verbatim, which is how this wiring got
 * written.
 *
 * `to` becomes an alias (the concept survives under another key); `why` becomes
 * guidance (a retirement with no successor, which also suppresses the rename).
 * The table's consumer changes here — the lint no longer reaches `field` now
 * that the parse rejects first — but the table itself is unchanged and still
 * tested.
 */
export function fieldKeyGuidanceAsStrictOptions() {
  const aliases: Record<string, string> = {};
  const guidance: Record<string, string> = {};
  for (const [key, hint] of Object.entries(FIELD_KEY_GUIDANCE)) {
    if (hint.to) aliases[key] = hint.to;
    else if (hint.why) guidance[key] = hint.why;
  }
  return { aliases, guidance };
}

/** `FieldSchema`'s own rename rows, beside the ones {@link fieldKeyGuidanceAsStrictOptions} derives. */
const FIELD_ALIAS_ROWS: Readonly<Record<string, string>> = {
  fieldName: 'name', key: 'name', column: 'name',
  dataType: 'type', fieldType: 'type',
  title: 'label', displayName: 'label',
  help: 'inlineHelpText', helpText: 'inlineHelpText', hint: 'inlineHelpText', tooltip: 'inlineHelpText',
  default: 'defaultValue', initialValue: 'defaultValue',
  // `notNull` is NOT here, deliberately — see COLUMN_CONSTRAINT_FLAT_KEYS
  // in `field.zod.ts`. `isRequired` / `mandatory` stay: both are genuine
  // spellings of the WRITE contract, and ADR-0113 moved neither.
  isRequired: 'required', mandatory: 'required',
  isUnique: 'unique',
  // `picklist` is not here: it is a declared key of `FieldSchema` — the
  // reference to a shared option list, mutually exclusive with `options`.
  values: 'options', choices: 'options', selectOptions: 'options',
  valueSet: 'picklist', globalValueSet: 'picklist', optionSet: 'picklist',
  relatedTo: 'reference', referenceTo: 'reference', target: 'reference', targetObject: 'reference', lookupObject: 'reference',
  onDelete: 'deleteBehavior', deleteRule: 'deleteBehavior', cascade: 'deleteBehavior',
  formula: 'expression', calculation: 'expression', compute: 'expression',
  // `rollup` alone covers `rollUp` / `roll_up` / `Roll-Up` — `aliasProbe`
  // folds case and separators, so a second spelling was never reachable
  // (#5481).
  rollup: 'summaryOperations', summary: 'summaryOperations', aggregate: 'summaryOperations',
  length: 'maxLength', size: 'maxLength',
  decimals: 'scale', decimalPlaces: 'scale', digits: 'precision',
  isReadonly: 'readonly', disabled: 'readonly',
  isHidden: 'hidden', invisible: 'hidden',
  // `showWhen` has only one reading — a predicate — so it renames. Its
  // sibling `visible` has two on the field surface and is answered in prose
  // in `field.zod.ts`; `disabled` already renames onto `readonly` above, which
  // is the right target because a field has `readonlyWhen`, not
  // `disabledWhen` (#7832).
  showWhen: 'visibleWhen',
  section: 'group', category: 'group', fieldset: 'group',
  component: 'widget', renderer: 'widget', control: 'widget',
  mimeTypes: 'accept', allowedTypes: 'accept', fileTypes: 'accept',
  maxFileSize: 'maxSize', maxBytes: 'maxSize',
  trackChanges: 'trackHistory', feedTracked: 'trackHistory',
  permissions: 'requiredPermissions', requiredCapabilities: 'requiredPermissions',
};

/**
 * `FieldSchema`'s whole `aliases` table: the renames `FIELD_KEY_GUIDANCE`
 * carries, then the field's own rows (which win on a shared key).
 *
 * A function, not a constant: `FIELD_KEY_GUIDANCE` sits across the
 * `field.zod` ↔ `suggestions.zod` import cycle, so the table is read when a
 * `lazySchema` body asks for it, never at module scope.
 */
export function fieldSchemaAliases(): Readonly<Record<string, string>> {
  return { ...fieldKeyGuidanceAsStrictOptions().aliases, ...FIELD_ALIAS_ROWS };
}

/** `SelectOptionSchema`'s `aliases` table. */
export const SELECT_OPTION_ALIASES: Readonly<Record<string, string>> = {
  text: 'label', name: 'label', title: 'label',
  key: 'value', id: 'value',
  isDefault: 'default', selected: 'default',
  colour: 'color',
  visible: 'visibleWhen', showWhen: 'visibleWhen',
};
