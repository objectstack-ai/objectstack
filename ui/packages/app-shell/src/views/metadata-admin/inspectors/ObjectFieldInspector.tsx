// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectFieldInspector — scoped editor for the selected Object field.
 *
 * Selection shape:  { kind: 'field', id: '<field_name>' }
 *
 * The inspector edits one field at a time. Sections:
 *   • Basic     — name (rename), label, type, required, unique, description
 *   • Specific  — picklist options / lookup target / formula / numeric
 *                 precision / max length / value domain, conditional on type
 *   • Advanced  — readonly, hidden, externalId, group
 *
 * All edits are applied as immutable splices of `draft.fields` via
 * the object-fields-io helpers, preserving the original array-vs-record
 * shape AND any unknown keys on the field definition — except the
 * spec-rejected keys `object-fields-io` strips on read
 * (`RETIRED_FIELD_KEYS`). The same holds one level down for a picklist
 * option: `readOptions` carries the keys the option editor has no control
 * for and `patchOptions` writes them back (objectui#7540), and an option the
 * editor cannot represent AT ALL is reported on its own row and written back
 * verbatim rather than shown blank and dropped (objectui#8632 — see
 * `classifyOption`).
 *
 * There is deliberately no `Indexed` control here (objectui#4644): the
 * spec has no field-level index flag, `FieldSchema.safeParse` rejects
 * `indexed` by name, and offering it only ever produced a 422 that blocked
 * the save. Object-level `indexes[]` is the real surface.
 *
 * Nor is there a `Relationship name` control on a lookup-family field
 * (objectui#12758): it wrote `relationshipName`, a key `FieldSchema` never
 * declared under any spelling, so typing into it put the field in the spec
 * banner and every autosave of the object came back `422 unrecognized_keys`.
 * The spec has no inverse-collection key on the child's field; the parent's
 * detail-page view of the child collection is `relatedList` /
 * `relatedListTitle`, a different concept, and declaring one is a spec card.
 *
 * Rename: changing the `name` rewrites the field's key in-place and
 * re-issues the selection so the inspector stays bound to the same
 * field. Other fields/options that reference the old name are NOT
 * auto-rewritten — callers should re-validate downstream.
 */

import * as React from 'react';
import {
  FieldSchema,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  VALUE_DOMAIN_FIELD_TYPES,
} from '@objectstack/spec/data';
import { ValueDomainSchema } from '@objectstack/spec/shared';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import {
  assertObjectMetadataWritable,
  CHOICE_TYPES_REQUIRING_OPTIONS,
  MetadataClient,
  OBJECT_METADATA_TYPE,
  RELATIONSHIP_TYPES_REQUIRING_REFERENCE,
} from '@object-ui/data-objectstack';
import { useObjectTranslation, useSafeFieldLabel } from '@object-ui/i18n';
import { useMetadataClient } from '../useMetadata.js';
import {
  InspectorShell,
  InspectorReorderButtons,
  InspectorTextField,
  InspectorNumberField,
  InspectorSelectField,
  InspectorCheckboxField,
  InspectorRemoveButton,
  InspectorEmptyState,
  moveArray,
} from './_shared.js';
import { Button, Input, Label, Badge } from '@object-ui/components';
import { Plus, X, ArrowUp, ArrowDown, Copy, AlertTriangle } from 'lucide-react';
import { InspectorComboField, type InspectorComboOption } from './InspectorComboField.js';
import { ObjectPicker } from './ObjectPicker.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import {
  readFields,
  writeFields,
  toFieldNameLoose,
  indexOfField,
  type FieldsView,
  type FieldEntry,
} from '../previews/object-fields-io.js';
import {
  FIELD_TYPE_META,
  type FieldTypeId,
} from '../previews/field-types.js';
import { FieldTypePicker } from './FieldTypePicker.js';
import { CelPredicateField } from '../CelPredicateField.js';
import type { CelLintIssue } from '../celAuthoring.js';
import { t, tFormat, type SupportedLocale } from '../i18n.js';
import { usePickerLoad, type LoadState } from '../loadState.js';


/**
 * One row of the picklist option editor.
 *
 * `value` / `label` / `color` are the keys this editor DISPLAYS and owns — it
 * renders a control for each and is authoritative for their values. `rest`
 * carries every OTHER authored key of the same option verbatim, so a round
 * trip through this inspector is not lossy for keys it has no opinion about.
 * Today that is `default` and `visibleWhen`: both are ACCEPTED by
 * `SelectOptionSchema` and both are honoured by the platform (`default` is
 * ruled `enforce` on the object-field face, objectstack#7246 — the engine
 * seeds the insert path from the option holding it), yet neither had any way
 * to survive this editor before objectui#7540.
 *
 * Two properties of `rest` are load-bearing:
 *
 *   • It is EDITOR-INTERNAL and must never appear as a key of the WRITTEN
 *     option. `SelectOptionSchema` is strict (`unrecognized_keys` at
 *     `[options.<i>]` on `FieldSchema`), so leaking it would turn every save
 *     into a 422. `patchOptions` therefore spreads its CONTENTS and never
 *     spreads an `Option`.
 *   • The three parts move TOGETHER. Widening this type without moving both
 *     `readOptions` and `patchOptions` would declare keys the editor still
 *     cannot carry — the declared-but-not-carried divergence the select-option
 *     convergence (`98d4108a2`) set out to remove.
 */
interface Option {
  value: string;
  label?: string;
  color?: string;
  /** Authored keys this editor has no control for, carried through untouched. */
  rest?: Record<string, unknown>;
}

/* ─────────────── Helpers ─────────────── */

/**
 * Why an option this editor cannot represent is REPORTED rather than coerced
 * (objectui#8632).
 *
 * `MalformedOption` is the other half of `Option`: one authored entry of
 * `def.options` that this editor has no faithful representation for. It is not
 * an error state of a row — it is a row of its own kind, and the two travel
 * together in `OptionRow` so a malformed entry keeps its POSITION in the list.
 *
 * `raw` is the authored entry verbatim, and it is what `patchOptions` writes
 * back. That is the whole repair: the reader stops inventing a value it was
 * never given, and the writer stops deleting what it cannot read.
 */
type MalformedReason =
  /** The entry is not an option object at all — a bare string, `null`, a number, an array. */
  | 'not-an-object'
  /** `value` is absent, or present with a non-string type. */
  | 'value-not-text'
  /** `value` is a string but blank — authored, so NOT this editor's own trailing blank row. */
  | 'value-empty'
  /** `label` is present with a non-string type. */
  | 'label-not-text'
  /** `color` is present with a non-string type. */
  | 'color-not-text';

interface MalformedOption {
  /** The authored entry, untouched. Written back byte-for-byte on commit. */
  raw: unknown;
  reason: MalformedReason;
}

/**
 * One row of the option editor: either an option it owns, or an entry it
 * refuses to represent. `kind` is an explicit tag rather than a `'malformed' in
 * row` test so every consumer has to answer the question.
 */
type OptionRow =
  | { kind: 'option'; option: Option }
  | { kind: 'malformed'; malformed: MalformedOption };

/**
 * Why the reader stays STRICT — the ruling this function is the subject of.
 *
 * This reader used to open with `value: String(o?.value ?? '')`. That single
 * expression is consumer-side tolerance (AGENTS.md #0.1) and it produced BOTH
 * halves of objectui#8632, in two different directions, each measured on the
 * unfixed reader:
 *
 *   • It manufactured an empty value for every entry it could not read — a bare
 *     string, `null`, `5`, `true`, `{}`, `{ label }` with no `value`. The author
 *     saw a BLANK row: three authored options rendered as three empty boxes.
 *     Then `OptionsEditor.commit` — which persists only rows with a non-empty
 *     `value` — DELETED them. Measured trigger: one click on "Add value", with
 *     nothing typed, wrote `options: []` over three authored options.
 *   • It silently REWROTE every entry whose `value` it could stringify into
 *     something else: `{ value: 5 }` was written back as `"5"`, `{ value: true }`
 *     as `"true"`, `{ value: ['alpha'] }` as `"alpha"` (indistinguishable on
 *     screen from a well-formed option), `{ value: { a: 1 } }` as
 *     `"[object Object]"`. Same for the other two keys this editor owns:
 *     `label: 5` was written back as `label: ''`, and a non-string `color` was
 *     dropped from the document entirely.
 *
 * A repair that only caught the first family would have looked complete and
 * left the second one deleting authored content exactly as before, so the rule
 * here is one rule, not a list of shapes: an entry this editor cannot represent
 * FAITHFULLY is not represented. It is reported on its own row and carried
 * through verbatim, and the author removes or repairs it deliberately.
 *
 * Two boundaries this classifier deliberately does NOT cross, because both are
 * prior rulings in this file rather than oversights:
 *
 *   • A MISSING `label` is not malformed. `patchOptions` emits `label: ''` for
 *     it, which is the ruling `f0f774b0d` landed: `''` is what the Label box has
 *     been showing the author all along, and the spec accepts it. A present but
 *     non-string `label` is a different fact — there are authored bytes being
 *     destroyed — and that one IS malformed.
 *   • A `value` this editor can represent but the SPEC rejects (`'a'` — the
 *     select option's two-character minimum) stays an ordinary editable row.
 *     The author can see it and fix it in place, and the draft validator is the
 *     surface that names it. This reader reports only what it cannot show.
 */
function classifyOption(raw: unknown): OptionRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'malformed', malformed: { raw, reason: 'not-an-object' } };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.value !== 'string') {
    return { kind: 'malformed', malformed: { raw, reason: 'value-not-text' } };
  }
  if (o.value.trim() === '') {
    return { kind: 'malformed', malformed: { raw, reason: 'value-empty' } };
  }
  if (o.label !== undefined && typeof o.label !== 'string') {
    return { kind: 'malformed', malformed: { raw, reason: 'label-not-text' } };
  }
  if (o.color !== undefined && typeof o.color !== 'string') {
    return { kind: 'malformed', malformed: { raw, reason: 'color-not-text' } };
  }
  // Representable. Everything below is the projection this reader has always
  // produced for a well-formed option, unchanged — see the round-trip control
  // in `ObjectFieldInspector.malformedOptions.test.tsx`.
  const rest: Record<string, unknown> = { ...o };
  // The keys the editor owns live in their own named slots. Removing them
  // here is what keeps `patchOptions` from having two sources for one key.
  delete rest.value;
  delete rest.label;
  delete rest.color;
  const option: Option = {
    value: o.value,
    label: typeof o.label === 'string' ? o.label : undefined,
    color: typeof o.color === 'string' ? o.color : undefined,
  };
  // Only attach the carrier when there is something to carry, so an option
  // with nothing extra stays byte-identical to what this reader used to
  // produce.
  if (Object.keys(rest).length > 0) option.rest = rest;
  return { kind: 'option', option };
}

/**
 * Read `def.options` into editor rows, keeping the WHOLE authored option.
 *
 * The three displayed keys are normalized exactly as before; everything else
 * on the authored option travels untouched in `rest`.
 *
 * This projection was the loss site (objectui#7540). It used to return exactly
 * `value` / `label` / `color`, which is why a writer-only repair could not
 * have closed the bug: whatever `patchOptions` were taught to carry, it can
 * only carry what this function handed it, and this function handed it three
 * keys. The reader is where `default` and `visibleWhen` disappeared.
 *
 * It is the loss site a second time for objectui#8632, and in the same shape:
 * an entry it could not read was handed on as an empty row and deleted by the
 * writer. Both repairs are the same move — hand on WHAT WAS AUTHORED — which is
 * why the classifier above lives here and not in `OptionsEditor`.
 *
 * The shape mirrors the field-level door one level up: `readFields` in
 * `previews/object-fields-io.ts` preserves unknown keys on a field definition
 * the same way (its `...rest`), stripping only the named keys a shipped build
 * actually wrote that the spec now refuses (`RETIRED_FIELD_KEYS`). There is no
 * counterpart tombstone list for OPTION keys and none is owed: this editor has
 * only ever written `value` / `label` / `color`, so no key it authored can
 * come back as one the spec rejects.
 */
function readOptions(def: Record<string, unknown>): OptionRow[] {
  const raw = def.options;
  if (!Array.isArray(raw)) return [];
  return raw.map(classifyOption);
}

/** The rows the rest of the inspector can offer as real choices. */
function representableOptions(rows: OptionRow[]): Option[] {
  return rows.flatMap((row) => (row.kind === 'option' ? [row.option] : []));
}

function isPicklist(type: string): boolean {
  return type === 'select' || type === 'multiselect' || type === 'radio' || type === 'checkboxes';
}

/**
 * Whether a field of this type may name a shared `picklist` — the spec's own
 * option types (`SINGLE_OPTION_TYPES` ∪ `MULTI_OPTION_TYPES`), read from the
 * installed contract rather than re-listed. `FieldSchema` refuses `picklist` on
 * any other type, so a retype away from these drops the binding.
 */
function takesPicklist(type: string): boolean {
  return SINGLE_OPTION_TYPES.has(type) || MULTI_OPTION_TYPES.has(type);
}

function isLookup(type: string): boolean {
  return type === 'lookup' || type === 'master_detail' || type === 'tree';
}

/**
 * objectui#11786 — what the object write guard holds this field for: its
 * options (a choice type with no option source) or its target (a relationship
 * with no usable `reference`), else nothing. Asked of the guard itself, on the
 * field alone, so the hint under the input names exactly what keeps the save
 * from going: Studio's autosave holds the edit on the same verdict, and the
 * other hosts' doors refuse on it.
 */
function guardHeldNeed(name: string, def: Record<string, unknown>): 'options' | 'target' | null {
  try {
    assertObjectMetadataWritable(OBJECT_METADATA_TYPE, { fields: { [name]: def } }, 'ObjectFieldInspector');
    return null;
  } catch {
    const type = String(def.type);
    if (CHOICE_TYPES_REQUIRING_OPTIONS.includes(type)) return 'options';
    if (RELATIONSHIP_TYPES_REQUIRING_REFERENCE.includes(type)) return 'target';
    return null;
  }
}

/** objectui#11786 — the inline hint under the input that holds the save. */
function HeldHint({ children }: { children: React.ReactNode }) {
  return (
    <p data-testid="field-held-hint" className="text-[11px] leading-snug text-muted-foreground">
      {children}
    </p>
  );
}

function isComputed(type: string): boolean {
  return type === 'formula' || type === 'summary';
}

function isNumeric(type: string): boolean {
  return type === 'number' || type === 'currency' || type === 'percent';
}

/**
 * Whether the numeric section offers a `scale` (decimal places) control.
 *
 * Every numeric type but `currency` (objectui#10221). `scale` is retired from
 * the currency type (ruling B on objectstack-ai/objectstack#19629), and ruling
 * 乙 on objectstack-ai/objectstack#19910 is that a currency's decimal places are
 * the currency's ISO 4217 minor unit, not a setting — so no display face reads
 * `scale` on a currency and a control for it would only write a key nothing
 * honours. `precision` stays offered on currency: it is the field-level TOTAL
 * digit count of the stored decimal, not a decimal-places knob, and this
 * section writes it as that top-level key.
 */
function offersScale(type: string): boolean {
  return isNumeric(type) && type !== 'currency';
}

function isTexty(type: string): boolean {
  return type === 'text' || type === 'textarea' || type === 'email' || type === 'url' || type === 'phone' || type === 'password';
}

/**
 * Whether the type-specific section offers a `valueDomain` control
 * (objectui#7597, the consumer half of ruling A on objectstack#14168).
 *
 * Read from the spec's own `VALUE_DOMAIN_FIELD_TYPES` — the one constant both
 * of the platform's seams read: `FieldSchema` refuses the key at parse on
 * every type outside it, and the record validator judges exactly that set on
 * the write path. So the control is never rendered on a type whose save would
 * then be refused for carrying it; a hand-written type list here would be a
 * third opinion that could drift from the other two.
 */
function offersValueDomain(type: string): boolean {
  return VALUE_DOMAIN_FIELD_TYPES.has(type);
}

/**
 * The option label for one `valueDomain` member, taken from the spec's own
 * `describe()` prose on `FieldSchema.valueDomain` rather than from a label
 * table in this repo (objectui#7597 triage, delivery detail 2).
 *
 * The spec declares no per-member description: the vocabulary is a bare
 * `z.enum` (`ValueDomainSchema`, no `.describe()`), and the only prose is the
 * FIELD's description, which glosses each member in place as
 * `` `member` (gloss) ``. This reads that gloss:
 *
 *   - the text inside the parentheses that follow the member's code span,
 *     matched with nesting so a parenthesis inside the gloss cannot end it;
 *   - up to the first ` — ` — what follows it is the validator's membership
 *     rule (`iana_time_zone`'s "membership is the Intl.DateTimeFormat probe…"),
 *     which is a note about enforcement, not the name of the member;
 *   - with code-span backticks removed, since an option renders plain text.
 *
 * A member whose gloss cannot be found is labelled with the member itself —
 * the exact string the field stores — so no member of the spec's vocabulary is
 * ever hidden. The pin beside this file asserts that every member of the
 * INSTALLED spec yields a gloss, so a spec release that rewrites the prose
 * turns that pin red rather than quietly degrading the labels.
 */
function valueDomainMemberLabel(member: string, prose: string): string {
  const head = `\`${member}\` (`;
  const at = prose.indexOf(head);
  if (at < 0) return member;
  const start = at + head.length;
  let depth = 1;
  let end = start;
  for (; end < prose.length; end++) {
    const ch = prose[end];
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) break;
  }
  if (depth !== 0) return member;
  const gloss = prose.slice(start, end).split(' — ')[0].replace(/`/g, '').trim();
  return gloss ? `${member} (${gloss})` : member;
}

/**
 * The `valueDomain` select's members: the spec's closed vocabulary, in the
 * spec's order, each labelled from the spec's prose. Built once — both inputs
 * are module constants of the installed spec.
 */
const VALUE_DOMAIN_OPTIONS: ReadonlyArray<{ value: string; label: string }> = (() => {
  const prose = FieldSchema.shape.valueDomain.description ?? '';
  return ValueDomainSchema.options.map((member) => ({
    value: member,
    label: valueDomainMemberLabel(member, prose),
  }));
})();

type DefaultKind = 'bool' | 'number' | 'picklist' | 'text';

/**
 * Which default-value editor (if any) fits a field type. Computed,
 * relational, media and structural types have no meaningful literal
 * default in this UI, so they return null (no editor rendered).
 *
 * The structural row holds types whose stored value is an object or an
 * array (objectui#11947): `FieldSchema` judges a literal default against the
 * field's own stored value contract, so the string the text editor writes is
 * refused for them, and no editor here can author the structured value. A
 * default such a field already carries (authored in code) stays on the field
 * untouched. `ObjectFieldInspector.recordNoDefault-11947.test.tsx` pins
 * `record`, `location` and `address` through this inspector.
 *
 * The number editor serves every type in the spec's numeric value class,
 * `NUMERIC_VALUE_TYPES`, read from the installed contract rather than
 * re-listed (objectui#11966): `FieldSchema` judges a literal default of such a
 * field as a number, and a hand list here once left `rating`, `slider` and
 * `progress` on the text editor, whose string the spec refuses. A computed
 * member of the class (`summary`) still gets no editor. A default already
 * stored as a string is not converted: it stays on the field until the author
 * types a number over it. `ObjectFieldInspector.numericDefault-11966.test.tsx`
 * pins the three types through this inspector.
 */
function defaultValueKind(type: string): DefaultKind | null {
  if (type === 'boolean' || type === 'toggle') return 'bool';
  if (NUMERIC_VALUE_TYPES.has(type) && !isComputed(type)) return 'number';
  if (type === 'select' || type === 'radio') return 'picklist';
  const noDefault = [
    'formula', 'summary', 'autonumber',
    'lookup', 'master_detail', 'tree',
    'file', 'image', 'avatar', 'video', 'audio', 'signature', 'qrcode',
    'composite', 'repeater', 'record', 'location', 'address', 'vector',
    'multiselect', 'checkboxes', 'tags',
  ];
  if (noDefault.includes(type)) return null;
  return 'text';
}

/**
 * The scope roots a field conditional rule can actually reference at runtime:
 * `@object-ui/core`'s `evalFieldPredicate` binds the live record as `record`,
 * the saved record as `previous`, and (for master-detail line items) the
 * header as `parent` — nothing else (no `current_user`), so the autocomplete
 * must not advertise the wider RLS/flow root set (objectui#1582).
 */
const FIELD_RULE_ROOTS = ['record', 'previous', 'parent'];

/**
 * The only scope root a formula `expression` can reference: the engine
 * evaluates it against the live record alone — there is no `previous`
 * (formulas are recomputed on read, not diffed against a prior version) and
 * no `parent` (objectui#1582 follow-up).
 */
const FORMULA_ROOTS = ['record'];

/** Read a `*When` predicate for editing: a bare string or an Expression envelope's `source`. */
function readPredicate(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { source?: unknown }).source === 'string') {
    return (v as { source: string }).source;
  }
  return '';
}

/**
 * Write an edited predicate back. Empty clears the rule; a value authored over
 * an existing `{ dialect, source }` envelope preserves the envelope's other
 * keys (`meta.rationale` from an AI draft, etc.) instead of collapsing to a
 * bare string; otherwise the spec-blessed bare-string shorthand is written.
 */
function writePredicate(orig: unknown, next: string): unknown {
  if (!next.trim()) return undefined;
  if (orig && typeof orig === 'object' && !Array.isArray(orig)) {
    const env = orig as Record<string, unknown>;
    return { ...env, dialect: typeof env.dialect === 'string' ? env.dialect : 'cel', source: next };
  }
  return next;
}

/* ─────────────── Inspector ─────────────── */

/**
 * The CEL editors this inspector mounts, as aggregation keys. Errors are
 * counted PER SITE rather than into one running total: the four editors lint
 * independently and asynchronously, so a single shared counter would let
 * whichever reported last overwrite the others — the multi-source aggregation
 * bug that lets a still-broken rule hand back a writable Save (objectui#4306).
 */
type CelSite = 'formula' | 'visibleWhen' | 'readonlyWhen' | 'requiredWhen';

export function ObjectFieldInspector({
  selection,
  draft,
  onPatch,
  onClearSelection,
  onSelectionChange,
  onBlockingIssuesChange,
  readOnly,
  locale,
}: MetadataInspectorProps) {
  const tr = React.useCallback((key: string) => t(key, locale), [locale]);
  const view: FieldsView = React.useMemo(() => readFields((draft as any).fields), [draft]);
  const name = String(selection.id);
  const idx = indexOfField(view, name);
  const entry = idx >= 0 ? view.entries[idx] : null;

  const fieldGroups = Array.isArray((draft as any).fieldGroups)
    ? ((draft as any).fieldGroups as Array<{ key?: string; label?: string }>)
    : [];

  // objectui#10202 — the picklists the runtime serves, for the "use picklist"
  // picker. A `LoadState`, so a failed read is never shown as "no picklists".
  const picklistRoster = usePicklistRoster();

  // Spec `Field.returnType` is stamped from the formula's inferred CEL type,
  // but ONLY once the author actually edits the formula in this session —
  // stamping on mere selection would dirty the draft just by looking at a
  // field whose stored returnType lags the inference.
  const formulaEdited = React.useRef(false);
  React.useEffect(() => {
    formulaEdited.current = false;
  }, [name]);

  /* ─── Who owns the API name (objectui#7615) ──────────────────────────────
   *
   * The Label derives the API name only for as long as the API name is still
   * the derivation's OWN output. Before #7615 that question was answered by
   * pattern-matching `entry.name` against the auto-generated placeholder
   * shapes (`field_<N>` / `<type>` / `<type>_<N>`) — and the first derivation
   * DESTROYS the very shape it gated on. Measured: typing `Health Score` one
   * key at a time renamed `field_10` -> `h` on the `H`, after which `h` no
   * longer looked auto-generated and every later keystroke was ignored. One
   * paste of the same string still worked, which is why a single-`change`
   * test never saw it.
   *
   * So RECORD the answer instead of re-deriving it from a string this feature
   * itself rewrites. Same posture the object/app create surfaces already use
   * (`CreateViewDialog`'s `nameTouched`, `useCreateDerive`'s touched set): the
   * derivation yields the moment the value has an authoritative source.
   *
   *   'label'  — this inspector wrote the name from the label; the next label
   *              change may move it again.
   *   'author' — the author typed the name into the API name box; nothing the
   *              label does moves it again. This is the third state the triage
   *              asked to be answered explicitly: an unconditional follow
   *              would silently erase what the author had just typed, which is
   *              worse than not syncing at all. It also covers the one case no
   *              string test can decide — a hand-typed `field_9` is the
   *              author's value, not `nextFieldName()`'s output.
   *
   * A name that arrived from the store (a saved field, e.g. `priority`) is in
   * NEITHER state: it matches no placeholder shape and carries no record, so
   * it is locked — #2260's "lock it on first save" boundary. The record is
   * per mounted inspector, so a reload always falls back to that check; what
   * it buys is the one session in which the author is still creating the
   * field. A tighter signal would need the host to say "this field is
   * persisted", which is a prop this inspector does not have.
   *
   * Stamped with the OBJECT as well as the field name so it can only ever
   * speak for the field it was written for: one inspector instance serves
   * every selection, and selections cross objects. */
  const apiNameOwnerRef = React.useRef<{
    object: string;
    field: string;
    owner: 'label' | 'author';
  } | null>(null);
  /** The object this field belongs to — `draft` is the object document. */
  const objectName = String(draft.name ?? '');

  /* ─── Blocking CEL verdicts → the host's Save gate (objectui#4306) ─────
   *
   * Mirrors the shape PermissionAdvancedFacets uses for its per-clause map:
   * identity-preserving writes (so an unchanged verdict re-renders nothing),
   * a summed memo, and a reporter held in a ref so an unmemoized host callback
   * cannot re-fire the effect. Declared above the `!entry` early return —
   * these are hooks, and their order must not depend on the selection
   * resolving to a live field. */
  const fieldType: string | null = entry
    ? typeof entry.def.type === 'string'
      ? (entry.def.type as string)
      : 'text'
    : null;
  // The map is STAMPED with the field it describes, and the stale-verdict
  // rules are read at aggregation time rather than repaired by reset effects.
  // Deriving beats correcting here: an effect-based prune leaves a one-render
  // window in which Save is still gated by an editor that is already gone.
  const [celErrors, setCelErrors] = React.useState<{
    field: string;
    sites: Partial<Record<CelSite, number>>;
  }>({ field: name, sites: {} });
  const reportCel = React.useCallback(
    (site: CelSite, issues: CelLintIssue[]) => {
      const errs = issues.filter((i) => i.severity === 'error').length;
      setCelErrors((prev) => {
        // A verdict that arrives after the selection moved describes the field
        // now on screen, not the one it was queued for.
        if (prev.field !== name) return { field: name, sites: { [site]: errs } };
        if (prev.sites[site] === errs) return prev;
        return { field: name, sites: { ...prev.sites, [site]: errs } };
      });
    },
    [name],
  );

  const blockingIssues = React.useMemo(() => {
    // A different field re-binds every editor: the outgoing field's verdicts
    // must never gate Save for the one now open.
    if (celErrors.field !== name) return 0;
    let total = 0;
    for (const [site, count] of Object.entries(celErrors.sites)) {
      // The formula editor exists only while the field IS a formula. Counting
      // a verdict it left behind would wedge Save shut with no editor on
      // screen to fix it (#4306 ruling item 2).
      if (site === 'formula' && fieldType !== 'formula') continue;
      total += count ?? 0;
    }
    return total;
  }, [celErrors, name, fieldType]);
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  if (!entry) {
    return (
      <InspectorShell
        kindLabel={tr('designer.field.kind')}
        title={name || tr('designer.field.kind')}
        onClose={onClearSelection}
        closeLabel={tr('designer.field.close')}
      >
        <InspectorEmptyState message={tr('designer.field.missing')} />
      </InspectorShell>
    );
  }

  const def = entry.def;
  // Same value the prune effect above keys on — derived once so the two can
  // never drift apart.
  const type = fieldType as FieldTypeId;
  const typeMeta = FIELD_TYPE_META[type];

  /* ─── Patch helpers ─── */

  const writeView = (next: FieldsView) => {
    onPatch({ fields: writeFields(next) });
  };

  const patchDef = (patch: Record<string, unknown>) => {
    const nextEntries = [...view.entries];
    nextEntries[idx] = { ...entry, def: { ...def, ...patch } };
    writeView({ shape: view.shape, entries: nextEntries });
  };

  /**
   * objectui#12681 — write `nextDef` as the field's WHOLE definition: a key it
   * leaves out is ABSENT afterwards. `patchDef` cannot express that, because
   * its spread keeps a key patched to `undefined` as an OWN property, and the
   * client spec check's strict field parse reports an own key the spec does
   * not declare as `unrecognized_keys` whatever its value. The wire drops
   * `undefined`, so the save is unaffected; the banner on screen is not.
   */
  const writeDef = (nextDef: Record<string, unknown>) => {
    const nextEntries = [...view.entries];
    nextEntries[idx] = { ...entry, def: nextDef };
    writeView({ shape: view.shape, entries: nextEntries });
  };

  /** Remove `key` from the field def outright — the key is ABSENT afterwards,
   *  not present with `undefined` or `null` (objectui#7597). */
  const unsetDefKey = (key: string) => {
    const nextDef = { ...def };
    delete nextDef[key];
    const nextEntries = [...view.entries];
    nextEntries[idx] = { ...entry, def: nextDef };
    writeView({ shape: view.shape, entries: nextEntries });
  };

  /**
   * objectui#10202 — "use picklist". Naming a list sets `picklist` and removes
   * `options` outright (the key is ABSENT, as `unsetDefKey` leaves it): the
   * field's options come from exactly one source, and the spec refuses both.
   * Choosing the field's own options removes `picklist` AND any `options` the
   * field was carrying — those were the list's resolved copy, served onto the
   * field, never options the author wrote — so the author starts the inline
   * list from the editor below.
   */
  const bindPicklist = (picklist: string | undefined) => {
    const nextDef = { ...def };
    delete nextDef.options;
    if (picklist) nextDef.picklist = picklist;
    else delete nextDef.picklist;
    const nextEntries = [...view.entries];
    nextEntries[idx] = { ...entry, def: nextDef };
    writeView({ shape: view.shape, entries: nextEntries });
  };

  /**
   * objectui#12326 — on a `controlled_by_parent` object a `master_detail` field
   * is `required: true` and its Required box is locked on: the object derives
   * its master from exactly one required `master_detail` (ADR-0055 §1), and the
   * save door refuses any other value. `ObjectSettingsPanel` sets it when the
   * sharing model is chosen; this inspector keeps it from being cleared.
   */
  const cbpMasterDetail = draft.sharingModel === 'controlled_by_parent' && type === 'master_detail';

  /**
   * A retype keeps a picklist binding only on a type the spec lets name one.
   * A retype to `master_detail` starts the field required, as `newField` does
   * (objectui#12326): always on a `controlled_by_parent` object, and elsewhere
   * when the field says nothing about `required`.
   */
  const changeType = (nextType: string) => {
    const requireMaster =
      nextType === 'master_detail'
      && def.required !== true
      && (draft.sharingModel === 'controlled_by_parent' || def.required === undefined);
    if (def.picklist === undefined || takesPicklist(nextType)) {
      patchDef(requireMaster ? { type: nextType, required: true } : { type: nextType });
      return;
    }
    const nextDef: Record<string, unknown> = { ...def, type: nextType };
    if (requireMaster) nextDef.required = true;
    delete nextDef.picklist;
    const nextEntries = [...view.entries];
    nextEntries[idx] = { ...entry, def: nextDef };
    writeView({ shape: view.shape, entries: nextEntries });
  };

  const setKey = (rawNext: string) => {
    const nextName = toFieldNameLoose(rawNext);
    const rejected =
      !nextName ||
      nextName === entry.name ||
      // Disallow collision
      view.entries.some((e, i) => i !== idx && e.name === nextName);
    // Every keystroke in the API name box is the author claiming that value —
    // recorded even when the edit is REJECTED just above (cleared, unchanged,
    // or colliding), because a rejected keystroke is still an authorial edit
    // and the Label must not resume overwriting what they are typing. The
    // stamp names whichever value the field is left carrying (objectui#7615).
    apiNameOwnerRef.current = {
      object: objectName,
      field: rejected ? entry.name : nextName,
      owner: 'author',
    };
    if (rejected) return;
    const nextEntries = [...view.entries];
    nextEntries[idx] = { ...entry, name: nextName };
    writeView({ shape: view.shape, entries: nextEntries });
    onSelectionChange?.({ kind: 'field', id: nextName, label: String(def.label ?? nextName) });
  };

  /** The recorded owner of this field's API name, or null if none. */
  const recordedOwner = (): 'label' | 'author' | null => {
    const rec = apiNameOwnerRef.current;
    return rec && rec.object === objectName && rec.field === entry.name ? rec.owner : null;
  };

  // Derive the API name from the label live, per keystroke — with
  // toFieldNameLoose (prefix-stable, unlike slugify which trims trailing
  // underscores and would fight mid-word typing) — while the name is still
  // an auto-generated default and the user hasn't customised it. Mirrors the
  // object/app Name behaviour. toFieldNameLoose returns '' for non-Latin
  // labels, in which case the unique default name is kept. Pure — the
  // caller applies the label and (if any) the derived name in one write,
  // since two separate writeView() calls from the same stale `entry` closure
  // would have the second clobber the first.
  const deriveNameFor = (label: string): string | null => {
    if (readOnly) return null;
    const owner = recordedOwner();
    // The author's own value wins outright — including one that happens to be
    // SHAPED like a placeholder (objectui#7615).
    if (owner === 'author') return null;
    const base = type === 'select' ? 'status' : type;
    const isAutoName =
      // A name this derivation itself produced is still the label's to move;
      // the placeholder shapes below can only answer for a name the
      // derivation has NOT yet rewritten (objectui#7615).
      owner === 'label' ||
      entry.name === base ||
      (entry.name.startsWith(`${base}_`) && /^\d+$/.test(entry.name.slice(base.length + 1))) ||
      // Freshly added fields are named by nextFieldName() as `field_<N>`
      // (StudioDesignSurface.tsx), independent of the field's type — match
      // that scheme too, or a type-typed rename right after add never derives.
      /^field_\d+$/.test(entry.name);
    if (!isAutoName) return null;
    const derived = toFieldNameLoose(label);
    if (!derived || derived === entry.name) return null;
    if (view.entries.some((e, i) => i !== idx && e.name === derived)) return null;
    return derived;
  };

  const removeField = () => {
    const nextEntries = view.entries.filter((_, i) => i !== idx);
    writeView({ shape: view.shape, entries: nextEntries });
    onClearSelection();
  };

  const duplicateField = () => {
    // Clone the field below itself with a collision-free name and a
    // "(copy)" label, then select the clone so it's ready to tweak.
    const existing = new Set(view.entries.map((e) => e.name));
    const base = `${entry.name}_copy`;
    let name = base;
    let n = 1;
    while (existing.has(name)) { n += 1; name = `${base}_${n}`; }
    const labelStr = typeof def.label === 'string' && def.label ? def.label : '';
    const clone: FieldEntry = {
      name,
      def: { ...def, label: labelStr ? labelStr + tr('designer.field.copySuffix') : undefined },
    };
    const nextEntries = [...view.entries];
    nextEntries.splice(idx + 1, 0, clone);
    writeView({ shape: view.shape, entries: nextEntries });
    onSelectionChange?.({ kind: 'field', id: name, label: String(clone.def.label ?? name) });
  };

  const moveTo = (toIndex: number) => {
    const next = { shape: view.shape, entries: moveArray(view.entries, idx, toIndex) };
    writeView(next);
    // Keep selection on the moved field (its name is unchanged).
  };

  /* ─── Option editor ─── */

  const optionRows = readOptions(def);
  const options = representableOptions(optionRows);
  // objectui#10202 — a picklist-bound field offers the LIST's values: the
  // served field's resolved copy when it carries one, else the named list's
  // own options from the roster (a binding made in this session, or a stored
  // draft, carries no `options`).
  const boundListed =
    typeof def.picklist === 'string' && picklistRoster.status === 'loaded'
      ? picklistRoster.data.find((p) => p.name === def.picklist)
      : undefined;
  const offeredOptions =
    def.picklist === undefined || options.length > 0
      ? options
      : boundListed
        ? representableOptions(readOptions({ options: boundListed.options }))
        : [];
  const patchOptions = (next: OptionRow[]) => {
    const clean = next.map((row) => {
      // An entry this editor refuses to represent is written back EXACTLY as it
      // was authored (objectui#8632). It was never shown, so there is nothing
      // the author could have meant by "keep it" or "drop it" — and the writer
      // that used to drop it did so on the strength of an empty `value` this
      // reader had invented. Carrying it verbatim is what makes the inline
      // report on its row honest: the row says "this is what is in your
      // document", and the document still says it after the next edit.
      if (row.kind === 'malformed') return row.malformed.raw;
      const o = row.option;
      // `label` is REQUIRED by the spec's select option, and an EMPTY label is
      // a document it accepts: measured on `@objectstack/spec` 17.2.0,
      // `{ value: 'alpha', label: '' }` -> ACCEPT, while `{ value: 'alpha' }`
      // -> REJECT `invalid_type` at [label] (an explicit `label: undefined`
      // rejects identically, so "carry the key with no value" is not a way
      // out). A truthiness guard here therefore did the one thing an authoring
      // surface must never do: it rewrote a LEGAL document into an ILLEGAL one
      // the moment an author cleared the Label box, and the save came back 422
      // with nothing on screen explaining why (`f0f774b0d`).
      //
      // So emit what the author holds, empty string included. `??` rather than
      // `||` is load-bearing: `||` is the same truthiness bug spelled shorter.
      // The `?? ''` arm also covers the option that arrived without a `label`
      // key at all (`readOptions` maps a MISSING label to `undefined`; since
      // objectui#8632 a PRESENT non-string label is a malformed row instead,
      // and never reaches here) -- there is no legal document that omits the
      // key, and ''
      // is precisely what the Label input has been showing the author for that
      // option all along (`value={o.label ?? ''}`), so this emits what they
      // see rather than inventing content.
      //
      // Everything the editor does NOT display rides along in `o.rest`
      // (objectui#7540). It is spread FIRST so the three keys this editor owns
      // are authoritative for their own slots; `readOptions` already removed
      // them from `rest`, so that ordering is defence in depth rather than a
      // live collision. Note the emitted option is a plain document, NOT an
      // `Option` — `rest` is an editor-internal carrier and spreading the row
      // itself would leak that key into the payload, which `SelectOptionSchema`
      // rejects outright.
      const out: Record<string, unknown> = {
        ...o.rest,
        value: o.value,
        label: o.label ?? '',
      };
      if (o.color) out.color = o.color;
      return out;
    });
    patchDef({ options: clean });
  };

  /* ─── Render ─── */

  const headerActions = (
    <div className="flex items-center gap-1">
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={duplicateField}
          title={tr('designer.field.duplicate')}
          aria-label={tr('designer.field.duplicate')}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
      <InspectorReorderButtons
        index={idx}
        total={view.entries.length}
        onMove={moveTo}
        disabled={readOnly}
      />
    </div>
  );

  const footer = (
    <InspectorRemoveButton
      label={tFormat('designer.field.remove', locale, {
        label: typeof def.label === 'string' ? def.label : entry.name,
      })}
      onClick={removeField}
      disabled={readOnly}
    />
  );

  const typeMetaLabel = typeMeta ? t(`engine.fieldType.${typeMeta.id}`, locale) : undefined;
  // objectui#11786 — read off the field as it stands, for the hints below.
  const heldNeed = readOnly ? null : guardHeldNeed(entry.name, def);

  return (
    <InspectorShell
      kindLabel={tr('designer.field.kind')}
      title={typeof def.label === 'string' && def.label ? (def.label as string) : entry.name}
      onClose={onClearSelection}
      closeLabel={tr('designer.field.close')}
      headerActions={headerActions}
      footer={footer}
    >
      {/* Basic */}
      <Section title={tr('designer.field.section.basic')}>
        <InspectorTextField
          label={tr('designer.field.apiName')}
          value={entry.name}
          onCommit={setKey}
          disabled={readOnly}
          mono
          testId="field-apiname-input"
        />
        <InspectorTextField
          label={tr('designer.field.label')}
          value={typeof def.label === 'string' ? (def.label as string) : ''}
          onCommit={(v) => {
            const derivedName = deriveNameFor(v);
            const nextEntries = [...view.entries];
            nextEntries[idx] = {
              ...entry,
              name: derivedName ?? entry.name,
              def: { ...def, label: v },
            };
            writeView({ shape: view.shape, entries: nextEntries });
            if (derivedName) {
              // Carry the "still the label's" record forward onto the name we
              // just wrote, so the NEXT keystroke can move it again
              // (objectui#7615).
              apiNameOwnerRef.current = {
                object: objectName,
                field: derivedName,
                owner: 'label',
              };
              onSelectionChange?.({ kind: 'field', id: derivedName, label: v });
            }
          }}
          disabled={readOnly}
          testId="field-label-input"
        />
        <LabelTranslationHint
          objectName={objectName}
          fieldName={entry.name}
          sourceLabel={typeof def.label === 'string' ? (def.label as string) : ''}
          locale={locale}
        />
        {/* objectui#11793 — searchable, grouped by category, an icon and a
            one-line description per type; a choice still goes to `changeType`. */}
        <FieldTypePicker
          label={tr('designer.field.type')}
          value={type}
          onCommit={changeType}
          disabled={readOnly}
          locale={locale}
        />
        <div className="flex items-center gap-4 pt-1">
          <InspectorCheckboxField
            label={tr('designer.field.required')}
            value={!!def.required}
            onCommit={(v) => patchDef({ required: v || undefined })}
            // Locked once it is on: the box can still be ticked on a stored
            // master that lacks it, never cleared (objectui#12326).
            disabled={readOnly || (cbpMasterDetail && def.required === true)}
          />
          <InspectorCheckboxField
            label={tr('designer.field.unique')}
            value={!!def.unique}
            onCommit={(v) => patchDef({ unique: v || undefined })}
            disabled={readOnly}
          />
        </div>
        {cbpMasterDetail && (
          <p data-testid="field-required-cbp-master" className="text-[11px] text-muted-foreground">
            {tr('designer.field.requiredCbpMaster')}
          </p>
        )}
        <TextareaField
          label={tr('designer.field.description')}
          value={typeof def.description === 'string' ? (def.description as string) : ''}
          onCommit={(v) => patchDef({ description: v || undefined })}
          disabled={readOnly}
          rows={2}
        />
        {defaultValueKind(type) && (
          <DefaultValueField
            kind={defaultValueKind(type)!}
            value={def.defaultValue}
            options={offeredOptions}
            onCommit={(v) => patchDef({ defaultValue: v })}
            disabled={readOnly}
            locale={locale}
          />
        )}
        <TextareaField
          label={tr('designer.field.helpText')}
          value={typeof def.inlineHelpText === 'string' ? (def.inlineHelpText as string) : ''}
          onCommit={(v) => patchDef({ inlineHelpText: v || undefined })}
          disabled={readOnly}
          rows={2}
          placeholder={tr('designer.field.helpTextPlaceholder')}
        />
      </Section>

      {/* Type-specific */}
      {(isPicklist(type) || isLookup(type) || isComputed(type) || isNumeric(type) || isTexty(type) || offersValueDomain(type)) && (
        <Section title={tFormat('designer.field.section.options', locale, { type: typeMetaLabel ?? type })}>
          {isPicklist(type) && (
            <PicklistSourceField
              boundPicklist={typeof def.picklist === 'string' ? def.picklist : undefined}
              roster={picklistRoster}
              onCommit={bindPicklist}
              disabled={readOnly}
              locale={locale}
            />
          )}
          {isPicklist(type) && def.picklist !== undefined && (
            <BoundPicklistOptions
              picklistLabel={boundListed?.label ?? String(def.picklist)}
              options={offeredOptions}
              ownValuesOnly={options.length === 0}
              locale={locale}
            />
          )}
          {isPicklist(type) && def.picklist === undefined && (
            <OptionsEditor
              key={entry.name}
              rows={optionRows}
              onChange={patchOptions}
              disabled={readOnly}
              locale={locale}
            />
          )}
          {heldNeed === 'options' && <HeldHint>{tr('designer.field.hint.addOption')}</HeldHint>}
          {isLookup(type) && (
            <>
              <ObjectPicker
                label={tr('designer.field.relatedObject')}
                value={typeof def.reference === 'string' ? (def.reference as string) : ''}
                onCommit={(v) => patchDef({ reference: v || undefined })}
                disabled={readOnly}
                placeholder={tr('designer.field.objectNamePlaceholder')}
                locale={locale}
              />
              {heldNeed === 'target' && <HeldHint>{tr('designer.field.hint.pickTarget')}</HeldHint>}
              <LookupConfigFields
                def={def}
                patchDef={patchDef}
                hostFieldNames={view.entries.map((e) => e.name).filter((n) => n !== entry.name)}
                readOnly={readOnly}
                locale={locale}
              />
            </>
          )}
          {type === 'formula' && (
            <CelPredicateField
              id={`field-formula-${entry.name}`}
              label={tr('designer.field.formula')}
              // Legacy alias: older Studio drafts carry a `formula` key the
              // engine never reads (it computes from `expression`); it seeds
              // the editor and the first edit migrates it.
              value={readPredicate(def.expression ?? def.formula)}
              onChange={(v) => {
                formulaEdited.current = true;
                // The edit commits `expression` and the next definition is
                // built WITHOUT the legacy `formula` key (objectui#12681): a
                // `formula: undefined` patch would leave an own key on the
                // draft, and the spec check reports a present `formula` as the
                // retired key on a field that carries none — on every edit.
                const { formula: legacyFormula, ...rest } = def;
                writeDef({
                  ...rest,
                  expression: writePredicate(def.expression ?? legacyFormula, v),
                  ...(v.trim() ? {} : { returnType: undefined }),
                });
              }}
              onLintChange={(issues) => reportCel('formula', issues)}
              onInferredTypeChange={(inferred) => {
                if (!formulaEdited.current) return;
                // Spec: `returnType` carries only a PROVEN concrete type —
                // an ambiguous (`unknown`) or unavailable verdict clears it.
                const next = inferred && inferred !== 'unknown' ? inferred : undefined;
                if (def.returnType !== next) patchDef({ returnType: next });
              }}
              disabled={readOnly}
              placeholder="record.amount * 0.2"
              objectName={typeof (draft as any).name === 'string' ? ((draft as any).name as string) : undefined}
              // A formula may reference every sibling, not itself (circular).
              fieldNames={view.entries.map((e) => e.name).filter((n) => n !== entry.name)}
              scope="record"
              roots={FORMULA_ROOTS}
              role="value"
              t={tr}
            />
          )}
          {type === 'summary' && (
            <SummaryConfigFields
              def={def}
              patchDef={patchDef}
              readOnly={readOnly}
              locale={locale}
            />
          )}
          {isNumeric(type) && (
            <div className="grid grid-cols-2 gap-2">
              <InspectorNumberField
                label={tr('designer.field.precision')}
                value={typeof def.precision === 'number' ? (def.precision as number) : undefined}
                onCommit={(v) => patchDef({ precision: v })}
                disabled={readOnly}
              />
              {offersScale(type) && (
                <InspectorNumberField
                  label={tr('designer.field.scale')}
                  value={typeof def.scale === 'number' ? (def.scale as number) : undefined}
                  onCommit={(v) => patchDef({ scale: v })}
                  disabled={readOnly}
                />
              )}
              <InspectorNumberField
                label={tr('designer.field.min')}
                value={typeof def.min === 'number' ? (def.min as number) : undefined}
                onCommit={(v) => patchDef({ min: v })}
                disabled={readOnly}
              />
              <InspectorNumberField
                label={tr('designer.field.max')}
                value={typeof def.max === 'number' ? (def.max as number) : undefined}
                onCommit={(v) => patchDef({ max: v })}
                disabled={readOnly}
              />
            </div>
          )}
          {isTexty(type) && (
            <div className="grid grid-cols-2 gap-2">
              <InspectorNumberField
                label={tr('designer.field.minLength')}
                value={typeof def.minLength === 'number' ? (def.minLength as number) : undefined}
                onCommit={(v) => patchDef({ minLength: v })}
                disabled={readOnly}
                placeholder="0"
              />
              <InspectorNumberField
                label={tr('designer.field.maxLength')}
                value={typeof def.maxLength === 'number' ? (def.maxLength as number) : undefined}
                onCommit={(v) => patchDef({ maxLength: v })}
                disabled={readOnly}
                placeholder="255"
              />
            </div>
          )}
          {offersValueDomain(type) && (
            <InspectorSelectField
              label={tr('designer.field.valueDomain')}
              value={typeof def.valueDomain === 'string' ? (def.valueDomain as string) : ''}
              options={[
                { value: '', label: tr('designer.field.valueDomainNone') },
                ...VALUE_DOMAIN_OPTIONS,
              ]}
              // Unset DELETES the key. `FieldSchema` refuses both `null` and
              // `''` for `valueDomain` (`invalid_value`), and a present key is
              // a declaration the write path enforces — "no domain" is the
              // key's absence, never a value of it (objectui#7597).
              onCommit={(v) => (v ? patchDef({ valueDomain: v }) : unsetDefKey('valueDomain'))}
              disabled={readOnly}
            />
          )}
        </Section>
      )}

      {/* Advanced */}
      <Section title={tr('designer.field.section.advanced')}>
        <div className="grid grid-cols-2 gap-2">
          <InspectorCheckboxField
            label={tr('designer.field.readonly')}
            value={!!def.readonly}
            onCommit={(v) => patchDef({ readonly: v || undefined })}
            disabled={readOnly}
          />
          <InspectorCheckboxField
            label={tr('designer.field.hidden')}
            value={!!def.hidden}
            onCommit={(v) => patchDef({ hidden: v || undefined })}
            disabled={readOnly}
          />
          <InspectorCheckboxField
            label={tr('designer.field.externalId')}
            value={!!def.externalId}
            onCommit={(v) => patchDef({ externalId: v || undefined })}
            disabled={readOnly}
          />
          <InspectorCheckboxField
            label={tr('designer.field.trackHistory')}
            value={!!def.trackHistory}
            onCommit={(v) => patchDef({ trackHistory: v || undefined })}
            disabled={readOnly}
          />
        </div>
        <InspectorTextField
          label={tr('designer.field.placeholder')}
          value={typeof def.placeholder === 'string' ? (def.placeholder as string) : ''}
          onCommit={(v) => patchDef({ placeholder: v || undefined })}
          disabled={readOnly}
        />
        {/* Conditional rules (ADR-0036 B2) — CEL editors with live lint +
            field autocomplete against THIS object's fields (objectui#1582). */}
        <div className="space-y-2 border-t pt-2.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            {tr('designer.field.conditionalRules')}
          </div>
          <CelPredicateField
            id={`field-rule-visible-${entry.name}`}
            label={tr('designer.field.visibleWhen')}
            value={readPredicate(def.visibleWhen)}
            onChange={(v) => patchDef({ visibleWhen: writePredicate(def.visibleWhen, v) })}
            onLintChange={(issues) => reportCel('visibleWhen', issues)}
            disabled={readOnly}
            placeholder="record.status != 'draft'"
            objectName={typeof (draft as any).name === 'string' ? ((draft as any).name as string) : undefined}
            fieldNames={view.entries.map((e) => e.name)}
            scope="record"
            roots={FIELD_RULE_ROOTS}
            // The authored key, so the wrong-layer advisory reads the
            // platform's published per-slot verdict (`e3cb47624`). Sound
            // here because `FIELD_RULE_ROOTS` above IS that helper's
            // `FIELD_RULE_BOUND_ROOTS`; the formula editor above deliberately
            // names no slot, because `FORMULA_ROOTS` is not.
            slot="visibleWhen"
            t={tr}
          />
          <CelPredicateField
            id={`field-rule-readonly-${entry.name}`}
            label={tr('designer.field.readonlyWhen')}
            value={readPredicate(def.readonlyWhen)}
            onChange={(v) => patchDef({ readonlyWhen: writePredicate(def.readonlyWhen, v) })}
            onLintChange={(issues) => reportCel('readonlyWhen', issues)}
            disabled={readOnly}
            placeholder="record.status == 'closed'"
            objectName={typeof (draft as any).name === 'string' ? ((draft as any).name as string) : undefined}
            fieldNames={view.entries.map((e) => e.name)}
            scope="record"
            roots={FIELD_RULE_ROOTS}
            // The authored key, so the wrong-layer advisory reads the
            // platform's published per-slot verdict (`e3cb47624`). Sound
            // here because `FIELD_RULE_ROOTS` above IS that helper's
            // `FIELD_RULE_BOUND_ROOTS`; the formula editor above deliberately
            // names no slot, because `FORMULA_ROOTS` is not.
            slot="readonlyWhen"
            t={tr}
          />
          <CelPredicateField
            id={`field-rule-required-${entry.name}`}
            label={tr('designer.field.requiredWhen')}
            value={readPredicate(def.requiredWhen)}
            onChange={(v) => patchDef({ requiredWhen: writePredicate(def.requiredWhen, v) })}
            onLintChange={(issues) => reportCel('requiredWhen', issues)}
            disabled={readOnly}
            placeholder="record.amount > 10000"
            objectName={typeof (draft as any).name === 'string' ? ((draft as any).name as string) : undefined}
            fieldNames={view.entries.map((e) => e.name)}
            scope="record"
            roots={FIELD_RULE_ROOTS}
            // The authored key, so the wrong-layer advisory reads the
            // platform's published per-slot verdict (`e3cb47624`). Sound
            // here because `FIELD_RULE_ROOTS` above IS that helper's
            // `FIELD_RULE_BOUND_ROOTS`; the formula editor above deliberately
            // names no slot, because `FORMULA_ROOTS` is not.
            slot="requiredWhen"
            t={tr}
          />
          <p className="text-[11px] text-muted-foreground/80 px-0.5 leading-snug">
            {tr('designer.field.conditionalRulesHint')}
          </p>
        </div>
        {fieldGroups.length > 0 && (
          <InspectorSelectField
            label={tr('designer.field.group')}
            value={typeof def.group === 'string' ? (def.group as string) : ''}
            options={[
              { value: '', label: tr('designer.field.noGroup') },
              ...fieldGroups
                .filter((g) => typeof g.key === 'string')
                .map((g) => ({ value: g.key as string, label: String(g.label ?? g.key) })),
            ]}
            onCommit={(v) => patchDef({ group: v || undefined })}
            disabled={readOnly}
          />
        )}
      </Section>
    </InspectorShell>
  );
}

/* ─────────────── Sub-components ─────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/**
 * The label this field is SHOWN with, when a translation overrides the source
 * label the Label input edits (objectui#11782).
 *
 * The input edits `def.label`, the field's source label. Every surface that
 * shows the field reads its label through `@object-ui/i18n`'s
 * `useSafeFieldLabel().fieldLabel(object, field, fallback)`, and a translation
 * for the active language wins over the source there: the Data pillar's grid
 * headers (`ObjectGrid`) and its form canvas (`ObjectFormDesigner`) both call
 * it. So the showcase's `showcase_account.tax_id` read "Tax ID" on the canvas
 * beside an input reading "Tax ID (EIN)", and nothing on screen said why.
 *
 * Three readings keep this line from disagreeing with the canvas:
 *
 *   • The label comes from that SAME resolver, never from a second lookup.
 *   • The fallback handed to it is `''`. The resolver returns the fallback
 *     exactly when no translation exists, so an empty answer means "nothing
 *     overrides the source label", whatever the input currently holds.
 *   • The language named is the i18next language the resolver reads its bundle
 *     for, not the designer's `locale` prop: that one picks between this
 *     designer's two string tables and is `'en-US'` for every language that is
 *     not zh (`useMetadataLocale`), so a `ja` session would be told "en".
 *
 * Shown only when the translation differs from the input's CURRENT value. A
 * field with no translation, or one whose translation equals the label being
 * edited, renders nothing. How translations resolve is not changed here.
 */
function LabelTranslationHint({
  objectName,
  fieldName,
  sourceLabel,
  locale,
}: {
  objectName: string;
  fieldName: string;
  sourceLabel: string;
  locale?: string;
}) {
  const { fieldLabel } = useSafeFieldLabel();
  const { i18n } = useObjectTranslation();
  const translated = objectName ? fieldLabel(objectName, fieldName, '') : '';
  if (!translated || translated === sourceLabel) return null;
  return (
    <p className="-mt-1 text-[11px] leading-4 text-muted-foreground" data-testid="field-label-translation-hint">
      {tFormat('designer.field.labelTranslated', locale, { label: translated, language: i18n.language })}
    </p>
  );
}

/** Type-aware default-value editor. Stores the literal on `Field.defaultValue`. */
function DefaultValueField({
  kind,
  value,
  options,
  onCommit,
  disabled,
  locale,
}: {
  kind: DefaultKind;
  value: unknown;
  options: Option[];
  onCommit: (v: unknown) => void;
  disabled?: boolean;
  locale?: string;
}) {
  const label = t('designer.field.defaultValue', locale);
  const none = t('designer.field.defaultNone', locale);

  if (kind === 'bool') {
    const cur = value === true ? 'true' : value === false ? 'false' : '';
    return (
      <InspectorSelectField
        label={label}
        value={cur}
        options={[
          { value: '', label: none },
          { value: 'true', label: t('designer.field.true', locale) },
          { value: 'false', label: t('designer.field.false', locale) },
        ]}
        onCommit={(v) => onCommit(v === '' ? undefined : v === 'true')}
        disabled={disabled}
      />
    );
  }

  if (kind === 'number') {
    return (
      <InspectorNumberField
        label={label}
        value={typeof value === 'number' ? value : undefined}
        onCommit={(v) => onCommit(v)}
        disabled={disabled}
      />
    );
  }

  if (kind === 'picklist') {
    return (
      <InspectorSelectField
        label={label}
        value={typeof value === 'string' ? value : ''}
        options={[
          { value: '', label: none },
          ...options
            .filter((o) => o.value)
            .map((o) => ({ value: o.value, label: o.label || o.value })),
        ]}
        onCommit={(v) => onCommit(v || undefined)}
        disabled={disabled}
      />
    );
  }

  return (
    <InspectorTextField
      label={label}
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      onCommit={(v) => onCommit(v || undefined)}
      disabled={disabled}
    />
  );
}

function TextareaField({
  label,
  value,
  onCommit,
  disabled,
  rows = 2,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <textarea
        value={value}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onCommit(e.target.value)}
        className={
          'w-full text-sm rounded-md border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary ' +
          (mono ? 'font-mono text-xs ' : '')
        }
      />
    </div>
  );
}

/** The i18n key naming each refusal, one static literal per reason. */
const MALFORMED_REASON_KEY: Record<MalformedReason, string> = {
  'not-an-object': 'designer.field.optMalformed.notAnObject',
  'value-not-text': 'designer.field.optMalformed.valueNotText',
  'value-empty': 'designer.field.optMalformed.valueEmpty',
  'label-not-text': 'designer.field.optMalformed.labelNotText',
  'color-not-text': 'designer.field.optMalformed.colorNotText',
};

/** The authored entry, rendered for a human, with a ceiling so one bad row cannot own the panel. */
function describeMalformed(raw: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(raw) ?? String(raw);
  } catch {
    // A document that came off the wire cannot be cyclic, but this reader is
    // handed whatever the draft holds and must not be the thing that throws.
    text = String(raw);
  }
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

function OptionsEditor({
  rows: incoming,
  onChange,
  disabled,
  locale,
}: {
  rows: OptionRow[];
  onChange: (next: OptionRow[]) => void;
  disabled?: boolean;
  locale?: string;
}) {
  // Local editing buffer. We keep a blank trailing row visible for input but
  // only PERSIST rows whose `value` is non-empty — otherwise the blank row
  // fails the spec identifier rule ("System identifier must be at least 2
  // characters") and shows a confusing error mid-edit. The editor is remounted
  // per field (key={entry.name}), so seeding from `incoming` once is correct.
  //
  // ⚠️ That `value`-is-empty filter is HALF of objectui#8632, and the half that
  // did the damage. It is correct for the row it was written for — the trailing
  // blank this editor creates — and it was catastrophic for an AUTHORED entry
  // the old reader had collapsed into the same shape: one click on "Add value",
  // with nothing typed, wrote `options: []` over three authored options. The
  // fix is upstream, in `classifyOption`: an authored entry never arrives here
  // wearing the blank row's shape any more, so the filter below can go on
  // meaning exactly what it says. It is deliberately unchanged.
  const [rows, setRows] = React.useState<OptionRow[]>(
    () => (incoming.length > 0 ? incoming : [{ kind: 'option', option: { value: '', label: '' } }]),
  );
  const commit = (next: OptionRow[]) => {
    setRows(next);
    onChange(next.filter((r) => r.kind === 'malformed' || r.option.value.trim() !== ''));
  };
  const update = (i: number, patch: Partial<Option>) => {
    const next = [...rows];
    const row = next[i];
    // Only an `option` row has editable controls, so this is unreachable for a
    // malformed one; narrowing rather than asserting keeps it that way.
    if (row.kind !== 'option') return;
    next[i] = { kind: 'option', option: { ...row.option, ...patch } };
    commit(next);
  };
  const remove = (i: number) => commit(rows.filter((_, j) => j !== i));
  const move = (i: number, to: number) => commit(moveArray(rows, i, to));
  const add = () => commit([...rows, { kind: 'option', option: { value: '', label: '' } }]);

  /** Reorder + remove — identical for both row kinds, so an unreadable row is still movable and removable. */
  const rowControls = (i: number) => (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={() => move(i, i - 1)}
        disabled={disabled || i === 0}
        aria-label={t('designer.field.moveUp', locale)}
      >
        <ArrowUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={() => move(i, i + 1)}
        disabled={disabled || i === rows.length - 1}
        aria-label={t('designer.field.moveDown', locale)}
      >
        <ArrowDown className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-destructive"
        onClick={() => remove(i)}
        disabled={disabled}
        aria-label={t('designer.field.removeValue', locale)}
      >
        <X className="h-3 w-3" />
      </Button>
    </>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{t('designer.field.picklistValues', locale)}</Label>
        <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] italic text-muted-foreground px-1">{t('designer.field.noValues', locale)}</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, i) =>
            row.kind === 'malformed' ? (
              // An entry this editor cannot represent. It gets a row of its own
              // rather than the two blank inputs the old reader produced: the
              // reason, the authored entry verbatim, and the same reorder/remove
              // strip as any other row — so removing it stays available and
              // stays DELIBERATE (objectui#8632).
              <div
                key={i}
                role="alert"
                data-testid="option-malformed"
                className="rounded-md border border-destructive/60 bg-destructive/5 p-1.5 space-y-1"
              >
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-[11px] font-medium text-destructive">
                      {t('designer.field.optMalformed', locale)}
                    </div>
                    <div className="text-[11px] text-destructive">
                      {t(MALFORMED_REASON_KEY[row.malformed.reason], locale)}
                    </div>
                    <code className="block truncate rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                      {describeMalformed(row.malformed.raw)}
                    </code>
                    <div className="text-[10px] text-muted-foreground">
                      {t('designer.field.optMalformedHint', locale)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="flex-1" />
                  {rowControls(i)}
                </div>
              </div>
            ) : (
              // Two rows per option: the value/label inputs get the full panel
              // width (min-w-0 lets them shrink cleanly instead of clipping their
              // own placeholders), while the color swatch and reorder/remove
              // controls sit on a compact strip below — previously all six
              // controls shared one line, squeezing the inputs until "Value" /
              // "Label" and CJK option labels truncated (framework#2615 P3).
              <div key={i} className="rounded-md border border-border/60 p-1.5 space-y-1">
                <div className="flex items-center gap-1">
                  <Input
                    value={row.option.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder={t('designer.field.optValue', locale)}
                    disabled={disabled}
                    className="h-7 min-w-0 flex-1 text-xs font-mono"
                  />
                  <Input
                    value={row.option.label ?? ''}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder={t('designer.field.optLabel', locale)}
                    disabled={disabled}
                    className="h-7 min-w-0 flex-1 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    value={row.option.color ?? '#cccccc'}
                    onChange={(e) => update(i, { color: e.target.value })}
                    disabled={disabled}
                    className="h-6 w-6 rounded border bg-background cursor-pointer p-0.5"
                    title={t('designer.field.optColor', locale)}
                  />
                  <span className="flex-1" />
                  {rowControls(i)}
                </div>
              </div>
            ),
          )}
        </div>
      )}
      {!disabled && (
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={add}>
          <Plus className="h-3 w-3" />
          {t('designer.field.addValue', locale)}
        </Button>
      )}
    </div>
  );
}

/* ─────────────── Lookup picker config (displayField / filters / dependent) ─────────────── */

/**
 * The lookup filter's operators (objectui#10748). The word is a catalogue key,
 * resolved in the designer locale at render; the symbol a label leads with is
 * the same in every locale and stays OUTSIDE the word, so the four
 * `engine.inspector.condition.op.*` rows the condition builder already reads
 * serve here unchanged. The stored `value` never moves.
 */
const LOOKUP_OPERATORS: ReadonlyArray<{ value: string; symbol?: string; labelKey: string }> = [
  { value: 'eq', symbol: '=', labelKey: 'engine.inspector.condition.op.equals' },
  { value: 'ne', symbol: '≠', labelKey: 'engine.inspector.condition.op.notEquals' },
  { value: 'gt', symbol: '>', labelKey: 'engine.inspector.condition.op.greaterThan' },
  { value: 'lt', symbol: '<', labelKey: 'engine.inspector.condition.op.lessThan' },
  { value: 'gte', symbol: '≥', labelKey: 'engine.inspector.condition.op.atLeast' },
  { value: 'lte', symbol: '≤', labelKey: 'engine.inspector.condition.op.atMost' },
  { value: 'contains', labelKey: 'engine.inspector.condition.op.contains' },
  { value: 'in', labelKey: 'engine.inspector.condition.op.inAnyOf' },
  { value: 'notIn', labelKey: 'engine.inspector.condition.op.notIn' },
];

function lookupOperatorOptions(locale?: string): Array<{ value: string; label: string }> {
  return LOOKUP_OPERATORS.map((o) => {
    const word = t(o.labelKey, locale);
    return { value: o.value, label: o.symbol ? `${o.symbol} ${word}` : word };
  });
}

type LookupFilter = { field?: string; operator?: string; value?: unknown };

function readLookupFilters(def: Record<string, unknown>): LookupFilter[] {
  // objectui#7642 CENSUS — verdict KEEP. This is the one site of the six that
  // reads camel FIRST and writes camel back (`patchDef({ lookupFilters })`), so
  // its snake leg is purely a read of a STORED pre-strict document. Retiring it
  // would show an admin an EMPTY filter list for such a document and let a save
  // strand the real filters. The runtime widget (`@object-ui/fields` LookupField)
  // reads `lookupFilters` ONLY since objectui#7641 (merged 2026-09-04), so both
  // halves honour the camel key: this snake leg is the designer's read of a stored
  // document, not one side of a competing read order.
  const raw = def.lookupFilters ?? (def as Record<string, unknown>).lookup_filters;
  return Array.isArray(raw) ? (raw as LookupFilter[]) : [];
}

function readDependsOn(def: Record<string, unknown>): string[] {
  const raw = def.dependsOn ?? (def as Record<string, unknown>).depends_on;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => (typeof d === 'string' ? d : d && typeof d === 'object' ? (d as { field?: string }).field : undefined))
    .filter((x): x is string => !!x);
}

/**
 * Lookup/master_detail picker configuration. Surfaces the parts that
 * previously required hand-editing the raw JSON: which field labels each
 * candidate (`displayField`/`descriptionField`), which records are even
 * selectable (structured `lookupFilters` — the form the runtime LookupField
 * actually honours, not the legacy `referenceFilters` strings), and
 * dependent-lookup links to other fields on the same record (`dependsOn`).
 * Every field choice is picked from the referenced object's live schema.
 */
function LookupConfigFields({
  def,
  patchDef,
  hostFieldNames,
  readOnly,
  locale,
}: {
  def: Record<string, unknown>;
  patchDef: (patch: Record<string, unknown>) => void;
  hostFieldNames: string[];
  readOnly?: boolean;
  locale?: string;
}) {
  const tr = (key: string) => t(key, locale);
  const reference = typeof def.reference === 'string' ? (def.reference as string) : undefined;
  const { fields: targetFields, loading } = useObjectFields(reference);

  const fieldOptions: InspectorComboOption[] = React.useMemo(
    () => targetFields.filter((f) => !f.hidden).map((f) => ({ value: f.name, label: f.label, hint: f.type })),
    [targetFields],
  );
  const hostOptions: InspectorComboOption[] = React.useMemo(
    () => hostFieldNames.map((n) => ({ value: n, label: n })),
    [hostFieldNames],
  );

  const filters = readLookupFilters(def);
  const dependsOn = readDependsOn(def);

  const patchFilter = (i: number, patch: Partial<LookupFilter>) =>
    patchDef({ lookupFilters: filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const addFilter = () => patchDef({ lookupFilters: [...filters, { field: '', operator: 'eq', value: '' }] });
  const removeFilter = (i: number) => {
    const next = filters.filter((_, idx) => idx !== i);
    patchDef({ lookupFilters: next.length ? next : undefined });
  };

  // `in` / `notIn` take a list; everything else a scalar. Keep the editor a
  // single text input and (de)serialize the list form at the boundary.
  const valueToText = (v: unknown): string => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
  const textToValue = (op: string | undefined, s: string): unknown =>
    op === 'in' || op === 'notIn' ? s.split(',').map((x) => x.trim()).filter(Boolean) : s;

  const addDependsOn = (name: string) => {
    if (!name || dependsOn.includes(name)) return;
    patchDef({ dependsOn: [...dependsOn, name] });
  };
  const removeDependsOn = (name: string) => {
    const next = dependsOn.filter((n) => n !== name);
    patchDef({ dependsOn: next.length ? next : undefined });
  };

  const displayField = typeof def.displayField === 'string' ? (def.displayField as string) : '';
  const descriptionField = typeof def.descriptionField === 'string' ? (def.descriptionField as string) : '';
  const pageSize = typeof def.lookupPageSize === 'number' ? (def.lookupPageSize as number) : undefined;
  const allowCreate = def.allowCreate === true;
  const fieldPlaceholder = reference ? tr('designer.field.lookup.selectField') : tr('designer.field.lookup.setTargetFirst');

  return (
    <div className="space-y-2 border-t pt-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{tr('designer.field.lookup.pickerConfig')}</div>

      <InspectorComboField
        label={tr('designer.field.lookup.displayField')}
        value={displayField}
        onCommit={(v) => patchDef({ displayField: v || undefined })}
        options={fieldOptions}
        loading={loading}
        placeholder={fieldPlaceholder}
        searchPlaceholder={tr('designer.field.lookup.searchFields')}
        disabled={readOnly}
        mono
      />
      <InspectorComboField
        label={tr('designer.field.lookup.descriptionField')}
        value={descriptionField}
        onCommit={(v) => patchDef({ descriptionField: v || undefined })}
        options={fieldOptions}
        loading={loading}
        placeholder={fieldPlaceholder}
        searchPlaceholder={tr('designer.field.lookup.searchFields')}
        disabled={readOnly}
        mono
      />

      {/* Structured selectable-records filter (lookupFilters) */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">{tr('designer.field.lookup.selectableRecords')}</Label>
            <Badge variant="outline" className="text-[10px]">{filters.length}</Badge>
          </div>
          {!readOnly && (
            <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={addFilter}>
              <Plus className="h-3 w-3" /> {tr('designer.field.lookup.addFilter')}
            </Button>
          )}
        </div>
        {filters.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-center text-[11px] text-muted-foreground">
            {tFormat('designer.field.lookup.noFilter', locale, { ref: reference || 'related' })}
          </p>
        ) : (
          filters.map((f, i) => (
            <div key={i} className="rounded-md border p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{tFormat('designer.field.lookup.filterN', locale, { n: i + 1 })}</span>
                {!readOnly && (
                  <Button type="button" variant="ghost" size="sm" aria-label={tr('designer.field.lookup.removeFilter')} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeFilter(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <InspectorComboField
                label={tr('designer.field.lookup.filterField')}
                value={f.field ?? ''}
                onCommit={(v) => patchFilter(i, { field: v })}
                options={fieldOptions}
                loading={loading}
                placeholder={fieldPlaceholder}
                searchPlaceholder={tr('designer.field.lookup.searchFields')}
                disabled={readOnly}
                mono
              />
              <InspectorSelectField label={tr('designer.field.lookup.filterOperator')} value={f.operator ?? 'eq'} options={lookupOperatorOptions(locale)} onCommit={(v) => patchFilter(i, { operator: v })} disabled={readOnly} />
              <InspectorTextField
                label={tr('designer.field.lookup.filterValue')}
                value={valueToText(f.value)}
                onCommit={(v) => patchFilter(i, { value: textToValue(f.operator, v) })}
                placeholder={f.operator === 'in' || f.operator === 'notIn' ? 'comma,separated,values' : tr('engine.inspector.condition.valuePlaceholder')}
                disabled={readOnly}
                mono
              />
            </div>
          ))
        )}
      </div>

      {/* Dependent lookup (dependsOn) — narrow candidates by other fields on this record */}
      <div className="space-y-1.5 pt-1">
        <Label className="text-xs text-muted-foreground">{tr('designer.field.lookup.dependsOn')}</Label>
        {dependsOn.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {dependsOn.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-[11px] font-mono">
                {n}
                {!readOnly && (
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => removeDependsOn(n)} aria-label={tFormat('engine.form.removeNamed', locale, { name: n })}>×</button>
                )}
              </span>
            ))}
          </div>
        )}
        {!readOnly && hostOptions.length > 0 && (
          <InspectorComboField
            // The `Depends on` label above heads the whole group (chips + this
            // "add another" picker), so the picker names itself rather than
            // hijacking the group heading (objectui#3997).
            ariaLabel={tr('designer.field.lookup.addDependsOn')}
            value=""
            onCommit={(v) => addDependsOn(v)}
            options={hostOptions.filter((o) => !dependsOn.includes(o.value))}
            placeholder={tr('designer.field.lookup.addDependsOn')}
            searchPlaceholder={tr('designer.field.lookup.searchHostFields')}
            disabled={readOnly}
            allowCustom={false}
            mono
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <InspectorNumberField label={tr('designer.field.lookup.pageSize')} value={pageSize} onCommit={(v) => patchDef({ lookupPageSize: v })} placeholder="10" disabled={readOnly} />
        <div className="flex items-end pb-1.5">
          <InspectorCheckboxField label={tr('designer.field.lookup.allowCreate')} value={allowCreate} onCommit={(v) => patchDef({ allowCreate: v || undefined })} disabled={readOnly} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Roll-up summary config (summaryOperations) ─────────────── */

const SUMMARY_FUNCTIONS = ['count', 'sum', 'min', 'max', 'avg'] as const;

interface SummaryOps {
  object?: string;
  field?: string;
  function?: string;
  relationshipField?: string;
  /** FilterCondition (query `where` object) restricting which child rows aggregate. */
  filter?: Record<string, unknown>;
}

function readSummaryOps(def: Record<string, unknown>): SummaryOps {
  const raw = def.summaryOperations;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SummaryOps) : {};
}

/* ─── summary `filter` ⇆ structured rows ───────────────────────────────────
 * The spec models `summaryOperations.filter` as a FilterCondition OBJECT
 * (`{ status: 'approved' }`, `{ amount: { $gte: 500 } }`). The inspector edits
 * it as field/operator/value rows (the same shape as lookupFilters), converting
 * both ways. A filter using logic the rows can't represent ($or/$not/nested) is
 * flagged `advanced` so the editor shows it read-only instead of clobbering it. */
type SummaryFilterRow = { field: string; operator: string; value: unknown };

const SUMMARY_OP_TO_FC: Record<string, string> = {
  ne: '$ne', gt: '$gt', lt: '$lt', gte: '$gte', lte: '$lte',
  contains: '$contains', in: '$in', notIn: '$nin',
};
const FC_TO_SUMMARY_OP: Record<string, string> = {
  $eq: 'eq', $ne: 'ne', $gt: 'gt', $lt: 'lt', $gte: 'gte', $lte: 'lte',
  $contains: 'contains', $in: 'in', $nin: 'notIn',
};
const SUMMARY_NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'rating', 'slider', 'autonumber']);

/** Coerce an editor string to the type the child field stores, so the emitted
 *  FilterCondition matches on the real column (a boolean, not the text "true"). */
function coerceSummaryValue(raw: unknown, fieldType: string | undefined, isList: boolean): unknown {
  const one = (s: unknown): unknown => {
    if (typeof s !== 'string') return s; // already typed (round-tripped from an existing filter)
    const t = s.trim();
    if (fieldType === 'boolean' || fieldType === 'toggle') return t === 'true' || t === '1';
    if (fieldType && SUMMARY_NUMERIC_TYPES.has(fieldType)) {
      const n = Number(t);
      return t !== '' && Number.isFinite(n) ? n : s;
    }
    return s;
  };
  if (isList) {
    const arr = Array.isArray(raw) ? raw : String(raw ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return arr.map(one);
  }
  return one(raw);
}

/** FilterCondition object → editor rows. Understands the flat form and a
 *  top-level `$and` of flat conditions; anything else sets `advanced`. */
function summaryFilterToRows(filter: unknown): { rows: SummaryFilterRow[]; advanced: boolean } {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return { rows: [], advanced: false };
  const rows: SummaryFilterRow[] = [];
  let advanced = false;
  const consume = (obj: Record<string, unknown>) => {
    for (const [key, v] of Object.entries(obj)) {
      if (key === '$and' && Array.isArray(v)) {
        for (const c of v) {
          if (c && typeof c === 'object' && !Array.isArray(c)) consume(c as Record<string, unknown>);
          else advanced = true;
        }
        continue;
      }
      if (key.startsWith('$')) { advanced = true; continue; } // $or / $not / unknown
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const entries = Object.entries(v as Record<string, unknown>);
        if (entries.length === 0) { advanced = true; continue; }
        for (const [op, val] of entries) {
          const sop = FC_TO_SUMMARY_OP[op];
          if (sop) rows.push({ field: key, operator: sop, value: val });
          else advanced = true;
        }
      } else {
        rows.push({ field: key, operator: 'eq', value: v }); // scalar/array ⇒ implicit equality
      }
    }
  };
  consume(filter as Record<string, unknown>);
  return { rows, advanced };
}

/** Editor rows → FilterCondition object. Drops field-less rows; merges into a
 *  flat object when field keys are distinct, else wraps in `$and`. */
function summaryRowsToFilter(
  rows: SummaryFilterRow[],
  typeOf: (field: string) => string | undefined,
): Record<string, unknown> | undefined {
  const valid = rows.filter((r) => r.field);
  if (valid.length === 0) return undefined;
  const conds = valid.map((r) => {
    const isList = r.operator === 'in' || r.operator === 'notIn';
    const cv = coerceSummaryValue(r.value, typeOf(r.field), isList);
    return r.operator === 'eq' ? { [r.field]: cv } : { [r.field]: { [SUMMARY_OP_TO_FC[r.operator] ?? '$eq']: cv } };
  });
  if (conds.length === 1) return conds[0];
  const keys = conds.map((c) => Object.keys(c)[0]);
  return new Set(keys).size === keys.length ? Object.assign({}, ...conds) : { $and: conds };
}

const summaryValueToText = (v: unknown): string => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

/**
 * Structured editor for a `summary` field's roll-up definition. A summary
 * field has NO CEL expression — the spec models it as `summaryOperations`
 * ({object, field, function, relationshipField}) and the engine recomputes
 * the value when child records change. This replaces the formula textarea
 * that previously edited a `formula` key the runtime never read for either
 * computed type.
 */
function SummaryConfigFields({
  def,
  patchDef,
  readOnly,
  locale,
}: {
  def: Record<string, unknown>;
  patchDef: (patch: Record<string, unknown>) => void;
  readOnly?: boolean;
  locale?: SupportedLocale;
}) {
  const tr = (key: string) => t(key, locale);
  const ops = readSummaryOps(def);
  const childObject = typeof ops.object === 'string' ? ops.object : '';
  const fn = typeof ops.function === 'string' ? ops.function : '';
  const { fields: childFields, loading } = useObjectFields(childObject || undefined);

  const patchOps = (patch: Partial<SummaryOps>) => {
    const next: Record<string, unknown> = { ...ops, ...patch };
    for (const k of Object.keys(next)) {
      if (next[k] === undefined || next[k] === '') delete next[k];
    }
    patchDef({ summaryOperations: Object.keys(next).length > 0 ? next : undefined });
  };

  const aggregateOptions: InspectorComboOption[] = React.useMemo(
    () => childFields.filter((f) => !f.hidden).map((f) => ({ value: f.name, label: f.label, hint: f.type })),
    [childFields],
  );
  // The FK back to this parent lives on a child relation field.
  const relationshipOptions: InspectorComboOption[] = React.useMemo(
    () =>
      childFields
        .filter((f) => f.type === 'lookup' || f.type === 'master_detail')
        .map((f) => ({ value: f.name, label: f.label, hint: f.type })),
    [childFields],
  );
  const fieldPlaceholder = childObject
    ? tr('designer.field.lookup.selectField')
    : tr('designer.field.summary.setObjectFirst');

  // Filter editor: derive rows from the FilterCondition each render, edit, and
  // serialize back. `typeOf` coerces values to the child field's stored type.
  const typeOf = React.useCallback(
    (name: string) => childFields.find((f) => f.name === name)?.type,
    [childFields],
  );
  const { rows: filterRows, advanced: filterAdvanced } = summaryFilterToRows(ops.filter);
  const commitFilterRows = (rows: SummaryFilterRow[]) => patchOps({ filter: summaryRowsToFilter(rows, typeOf) });
  const patchFilterRow = (i: number, patch: Partial<SummaryFilterRow>) =>
    commitFilterRows(filterRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addFilterRow = () =>
    commitFilterRows([...filterRows, { field: aggregateOptions[0]?.value ?? '', operator: 'eq', value: '' }]);
  const removeFilterRow = (i: number) => commitFilterRows(filterRows.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <ObjectPicker
        label={tr('designer.field.summary.object')}
        value={childObject}
        onCommit={(v) => patchOps({ object: v || undefined })}
        disabled={readOnly}
        placeholder={tr('designer.field.objectNamePlaceholder')}
        locale={locale}
      />
      <InspectorSelectField
        label={tr('designer.field.summary.function')}
        value={fn}
        options={[
          { value: '', label: tr('designer.field.defaultNone') },
          ...SUMMARY_FUNCTIONS.map((f) => ({ value: f, label: tr(`designer.field.summary.fn.${f}`) })),
        ]}
        onCommit={(v) => patchOps({ function: v || undefined })}
        disabled={readOnly}
      />
      {/* The spec requires `field` even for `count` (documented as ignored),
          so it stays visible — hiding it would trap the author with an
          unfixable "required" issue in the draft banner. */}
      <InspectorComboField
        label={tr('designer.field.summary.field')}
        value={typeof ops.field === 'string' ? ops.field : ''}
        onCommit={(v) => patchOps({ field: v || undefined })}
        options={aggregateOptions}
        loading={loading}
        placeholder={fieldPlaceholder}
        searchPlaceholder={tr('designer.field.lookup.searchFields')}
        disabled={readOnly}
        mono
      />
      {fn === 'count' && (
        <p className="text-[11px] text-muted-foreground/70 px-0.5 -mt-1">
          {tr('designer.field.summary.countFieldHint')}
        </p>
      )}
      <InspectorComboField
        label={tr('designer.field.summary.relationshipField')}
        value={typeof ops.relationshipField === 'string' ? ops.relationshipField : ''}
        onCommit={(v) => patchOps({ relationshipField: v || undefined })}
        options={relationshipOptions}
        loading={loading}
        placeholder={fieldPlaceholder}
        searchPlaceholder={tr('designer.field.lookup.searchFields')}
        disabled={readOnly}
        mono
      />

      {/* Optional filter — only child rows matching these conditions aggregate
          (framework#1868). Reads/writes summaryOperations.filter as a
          FilterCondition; rows mirror the lookupFilters editor. */}
      <div className="space-y-1.5 border-t pt-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">{tr('designer.field.summary.filterSection')}</Label>
            {!filterAdvanced && <Badge variant="outline" className="text-[10px]">{filterRows.length}</Badge>}
          </div>
          {!readOnly && !filterAdvanced && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px]"
              onClick={addFilterRow}
              disabled={aggregateOptions.length === 0}
            >
              <Plus className="h-3 w-3" /> {tr('designer.field.summary.addFilter')}
            </Button>
          )}
        </div>
        {filterAdvanced ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            {tr('designer.field.summary.filterAdvanced')}
          </p>
        ) : filterRows.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-center text-[11px] text-muted-foreground">
            {tr('designer.field.summary.noFilter')}
          </p>
        ) : (
          filterRows.map((f, i) => (
            <div key={i} className="rounded-md border p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{tFormat('designer.field.lookup.filterN', locale, { n: i + 1 })}</span>
                {!readOnly && (
                  <Button type="button" variant="ghost" size="sm" aria-label={tr('designer.field.lookup.removeFilter')} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeFilterRow(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <InspectorComboField
                label={tr('designer.field.lookup.filterField')}
                value={f.field ?? ''}
                onCommit={(v) => patchFilterRow(i, { field: v })}
                options={aggregateOptions}
                loading={loading}
                placeholder={fieldPlaceholder}
                searchPlaceholder={tr('designer.field.lookup.searchFields')}
                disabled={readOnly}
                mono
              />
              <InspectorSelectField label={tr('designer.field.lookup.filterOperator')} value={f.operator ?? 'eq'} options={lookupOperatorOptions(locale)} onCommit={(v) => patchFilterRow(i, { operator: v })} disabled={readOnly} />
              <InspectorTextField
                label={tr('designer.field.lookup.filterValue')}
                value={summaryValueToText(f.value)}
                onCommit={(v) => patchFilterRow(i, { value: v })}
                placeholder={f.operator === 'in' || f.operator === 'notIn' ? 'comma,separated,values' : tr('engine.inspector.condition.valuePlaceholder')}
                disabled={readOnly}
                mono
              />
            </div>
          ))
        )}
        <p className="text-[11px] text-muted-foreground/80 px-0.5 leading-snug">
          {tr('designer.field.summary.filterHint')}
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground/80 px-0.5 leading-snug">
        {tr('designer.field.summary.hint')}
      </p>
    </div>
  );
}

/* ─────────────── "Use picklist" (objectui#10202) ─────────────── */

/** One picklist the runtime serves, as the picker and the bound view read it. */
interface PicklistRosterEntry {
  name: string;
  label: string;
  options: unknown[];
}

/**
 * The picklists the runtime serves (`GET /meta/picklist`), by name.
 *
 * The kind is package-owned: the registry declares no runtime create for it,
 * so this list is everything a field can name. Loaded through
 * {@link usePickerLoad}, so a failed read is its own arm and is never drawn as
 * "there are no picklists".
 */
function usePicklistRoster(): LoadState<PicklistRosterEntry[]> {
  const client: MetadataClient = useMetadataClient();
  // The loader is made ONCE per mount and held in state, whose identity React
  // guarantees, never in a `useMemo` keyed on `client` (AGENTS.md #10).
  // `usePickerLoad` re-runs its request whenever the loader's identity changes
  // and re-enters `loading` as it does, so a loader minted per render is a
  // render loop wherever the host's client is not referentially stable —
  // measured: an inspector suite whose mock returns a fresh client per call
  // spun one worker at 100% CPU until killed. The list is read for the client
  // this inspector mounted with.
  const [load] = React.useState(() => () => fetchPicklistRoster(client));
  return usePickerLoad(load);
}

/** `GET /meta/picklist`, reduced to what the picker and the bound view read. */
async function fetchPicklistRoster(client: MetadataClient): Promise<PicklistRosterEntry[]> {
  const items = await client.list<Record<string, unknown>>('picklist');
  return (items ?? [])
    .map((raw) =>
      raw && typeof raw === 'object' && 'item' in raw
        ? ((raw as { item?: Record<string, unknown> }).item ?? {})
        : (raw as Record<string, unknown>),
    )
    .filter((i): i is Record<string, unknown> & { name: string } => typeof i?.name === 'string' && i.name !== '')
    .map((i) => ({
      name: i.name,
      label: typeof i.label === 'string' && i.label ? i.label : i.name,
      options: Array.isArray(i.options) ? (i.options as unknown[]) : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where a choice field's options come from: its own inline list, or a served
 * picklist named here. A closed list — the field can only name a picklist the
 * runtime serves, so a misspelled name cannot be written; a stored name the
 * served list no longer carries is drawn flagged by {@link InspectorSelectField}.
 */
function PicklistSourceField({
  boundPicklist,
  roster,
  onCommit,
  disabled,
  locale,
}: {
  boundPicklist: string | undefined;
  roster: LoadState<PicklistRosterEntry[]>;
  onCommit: (picklist: string | undefined) => void;
  disabled?: boolean;
  locale?: string;
}) {
  const served = roster.status === 'loaded' ? roster.data : [];
  const options = [
    { value: '', label: t('designer.field.optionSourceInline', locale) },
    ...served.map((p) => ({ value: p.name, label: p.label === p.name ? p.name : `${p.label} (${p.name})` })),
  ];
  return (
    <InspectorSelectField
      label={t('designer.field.optionSource', locale)}
      value={boundPicklist ?? ''}
      options={options}
      roster={roster}
      onCommit={(v) => onCommit(v === '' ? undefined : v)}
      disabled={disabled}
    />
  );
}

/**
 * A picklist-bound field's options, read-only, in place of the inline options
 * editor: inline options are refused on a bound field, as the spec refuses
 * `picklist` with `options`. The options shown are the ones the field offers
 * (see `offeredOptions` in the inspector); nothing here writes.
 *
 * `ownValuesOnly` — the list shown is the picklist's OWN options from the
 * roster, not the served field's resolved copy: `GET /meta/picklist` does not
 * carry the options other packages add (`picklistExtensions`), so the note says
 * those are offered too rather than letting the list read as complete.
 */
function BoundPicklistOptions({
  picklistLabel,
  options,
  ownValuesOnly,
  locale,
}: {
  picklistLabel: string;
  options: Option[];
  ownValuesOnly: boolean;
  locale?: string;
}) {
  return (
    <div className="space-y-1" data-testid="picklist-bound-options">
      <Label className="text-xs text-muted-foreground">{t('designer.field.picklistValues', locale)}</Label>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {tFormat('designer.field.picklistBound', locale, { picklist: picklistLabel })}
      </p>
      {options.length > 0 && (
        <ul className="space-y-0.5 rounded border bg-muted/30 px-2 py-1.5">
          {options.map((o) => (
            <li key={o.value} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate">{o.label || o.value}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{o.value}</span>
            </li>
          ))}
        </ul>
      )}
      {ownValuesOnly && options.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('designer.field.picklistOwnValues', locale)}
        </p>
      )}
    </div>
  );
}
