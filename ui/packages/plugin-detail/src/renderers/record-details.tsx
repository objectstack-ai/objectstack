/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:details` — page-level record component that renders the canonical
 * field-detail block. Reads the bound record from <RecordContextProvider> and
 * synthesizes a DetailViewSchema for the existing DetailView component. A
 * `dataSource` binding on the node supplies that record instead of the record
 * page (objectui#12294, see `./recordBinding`).
 */

import React from 'react';
import { useRecordContext, useHighlightFieldNames, useSafeFieldLabel, usePredicateScope, usePrintPage } from '@object-ui/react';
import { useFieldPermissions, usePermissions } from '@object-ui/permissions';
import { useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import type { RecordDetailsComponentProps } from '@object-ui/types';
import { SECTION_HEADING_COUNT_HOLE } from '@objectstack/spec/ui';
import {
  columnIdentity,
  declaredNameField,
  deriveTitleField,
  formatTitleTemplate,
  isElementDataSourceConfig,
  resolveAffordance,
  type FieldRulePredicate,
  recordDisplayValueAt,
  evalFieldPredicate,
  resolveNameField,
  toPredicateRecord,
  withoutDeniedFields,
} from '@object-ui/core';
import { DetailView } from '../DetailView';
import { hasCellValue } from '../emptiness';
import { RecordPageProvenanceContext } from '../recordPageProvenance';
import { deriveFieldGroupDetailEntries, type FieldGroupDetailEntry } from '../synth/buildDefaultPageSchema';
import { useRecordAriaProps } from './recordComponentAria';
import { recordBindingBlock } from './recordBinding';

/** Normalize a field entry (string | {field} | {name}) to its machine name. */
const fieldName = (entry: any): string | null => columnIdentity(entry) ?? null;

/**
 * The ONE boundary between `record:details`' authored body width and the
 * internal detail node (objectui#9056).
 *
 * `@objectstack/spec`'s `RecordDetailsProps.columns` is a STRING enum
 * (`z.enum(['1','2','3','4'])`, default `'2'`). Everything this renderer hands
 * it to is a NUMBER: `DetailViewSchema.columns` and `DetailViewSection.columns`
 * in `@object-ui/types`, the `columns` parameter of `applyDetailAutoLayout` /
 * `applyAutoSpan`, and the `DetailViewField.span` that `applyAutoSpan` writes
 * FROM it. Handing the authored value straight through left every one of those
 * declared-`number` slots carrying the string `'2'` at runtime — measured, on
 * the real render: `span` came out `typeof 'string'`.
 *
 * TypeScript could not see it because `synthesized` below is annotated `any`,
 * which launders the assignment. (Measured three ways: the same value written
 * into a `DetailViewSchema` directly is `TS2322`, from this renderer's own prop
 * type AND from the bare `RecordDetailsComponentProps` — only the `any` hides
 * it.)
 *
 * ⛔ The direction is contract-first (AGENTS.md #0.1): the protocol keeps its
 * string enum, `@object-ui/types` keeps `number`, and neither is widened to
 * meet the other. This function is the TRANSLATION between two declared types,
 * not a tolerant reader — its parameter is spelled as the contract's own type
 * so a protocol change arrives here as a compile error rather than as another
 * silent string.
 *
 * ⚠️ NOT `sections[].columns`, one level down. That key is
 * `z.number().int().min(1).max(4)` — already a number, and correct as one;
 * objectui#8604 measured that copying either declaration onto the other is
 * refused at publish. A section's width never passes through here.
 *
 * ⚠️ The `undefined` arm is load-bearing, not defensive. `applyDetailAutoLayout`
 * treats `undefined` as "author said nothing" and infers the width from the
 * field count; `Number(undefined)` is `NaN`, which is NOT `undefined`, so a
 * bare `Number(...)` here would silently replace inference with a `NaN` width
 * on every unauthored body.
 */
function detailBodyColumns(
  columns: RecordDetailsComponentProps['columns'],
): number | undefined {
  return columns === undefined ? undefined : Number(columns);
}

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

/**
 * `sections[].group` references that resolved to no declared group, already
 * reported. Keyed `<object>.<group>` so one typo is loud once per object
 * rather than once per render (the shape `reportRetiredFieldType` established
 * in `@object-ui/core` — the repo's one pattern for an authoring diagnostic
 * this renderer cannot fix for the author).
 */
const reportedUnresolvedGroups = new Set<string>();

/**
 * Report a `group` that names no entry in the object's `fieldGroups`.
 *
 * ⚠️ Reported, not rendered, and that split is the spec's, not a convenience.
 * `@objectstack/spec`'s `field-group-layout.ts` states existence is NOT a parse
 * question — the key names something on a DIFFERENT schema, so parse takes any
 * well-formed key and `page-section-group-unknown` (`@objectstack/lint`) is the
 * declared reporter of one that resolves to nothing. `deriveFieldGroupLayout`'s
 * own documented semantics drop a declared group no visible field references,
 * so an unresolvable REFERENCE dropping is the same rule one level out. What
 * the drop must never be is silent, which is what this reporter buys.
 */
function reportUnresolvedSectionGroup(objectName: string, group: string): void {
  const key = `${objectName}.${group}`;
  if (reportedUnresolvedGroups.has(key)) return;
  reportedUnresolvedGroups.add(key);
  console.error(
    `[record:details] section group "${group}" is not declared in fieldGroups on object "${objectName}" — `
    + 'the section renders nothing. Declare the group on the object, or enumerate `fields` on the section. '
    + '(`@objectstack/lint` reports this as `page-section-group-unknown`.)',
  );
}

/** Test seam — forget which unresolved group references have been reported. */
export function resetUnresolvedSectionGroupReports(): void {
  reportedUnresolvedGroups.clear();
}

/**
 * How many values a field holds on the record — the number a section heading's
 * `{{ count }}` hole shows (objectui#12192, the renderer half of
 * `@objectstack/spec`'s `RecordDetailsProps.sections[].count`).
 *
 * - An empty value counts 0, as the spec's `count` describe states ("an absent
 *   or empty value counts 0"). Emptiness is `hasCellValue`, this page's one
 *   definition, so a heading never counts a value its own body draws as the
 *   `No value` placeholder.
 * - An array counts its entries. That is the value contract of every
 *   multi-value field the spec allows here (`isMultiValueField` → an array of
 *   option codes, ids, expanded records or files).
 * - Any other non-empty value counts 1: it is one value, and the body draws it
 *   as one (`SelectCellRenderer` renders a non-array value as a single badge).
 *   Only a single-valued field reaches this arm, and naming one in
 *   `count.field` is refused at authoring time by `@objectstack/lint`
 *   (`page-section-count-not-multi-value`, ERROR). This renderer does not judge
 *   the field's declaration again.
 */
function sectionHeadingCount(value: unknown): number {
  if (!hasCellValue(value)) return 0;
  return Array.isArray(value) ? value.length : 1;
}

/**
 * Write `count` into every `{{ count }}` hole of an already-translated heading.
 *
 * ⛔ The hole grammar is the spec's own `SECTION_HEADING_COUNT_HOLE`, never a
 * second pattern written here: the parse refinement that refuses a heading
 * without a hole reads the same RegExp, so the two cannot disagree about what a
 * hole is. The export is non-global on purpose (a shared `g` RegExp carries
 * `lastIndex` between calls), and the spec asks the renderer to build its own
 * global copy from `.source`, which is what this does.
 */
function fillSectionHeadingCount(heading: string, count: number): string {
  return heading.replace(new RegExp(SECTION_HEADING_COUNT_HOLE.source, 'g'), String(count));
}

/**
 * The record a section's `visibleWhen` is evaluated against — assembled the
 * way the entry form assembles its own (objectui#11630).
 *
 * The form's `ruleRecord` (`@object-ui/components`' form renderer) seeds every
 * declared field to `null` and then overlays the DEFINED values it holds, so a
 * predicate naming a column the read did not return compares against `null`
 * instead of faulting on a missing key. This does the same over the object's
 * declared fields and the bound record.
 *
 * Relations are collapsed back to their stored foreign key first
 * (`toPredicateRecord`): the edit form reads its record without `$expand`, so
 * `record.owner == 'u1'` sees the id there, while this page's record may arrive
 * expanded. Without the collapse one predicate would reach two verdicts on the
 * same record.
 */
function sectionPredicateRecord(
  data: Record<string, unknown> | null | undefined,
  objectFields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (objectFields && typeof objectFields === 'object' && !Array.isArray(objectFields)) {
    for (const name of Object.keys(objectFields)) out[name] = null;
  }
  const row = toPredicateRecord(data ?? {}, objectFields) as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

/**
 * Does a field GROUP's ADR-0089 `visibleWhen` admit its section on this
 * record? (objectui#11630 — "the detail page evaluates `visibleWhen` per group
 * exactly as the form does".)
 *
 * Asked of exactly one kind of section: an authored or synthesized
 * `{ group: KEY }` reference, which inherits the group's `visibleWhen` per
 * `@objectstack/spec`'s `RecordDetailsProps.sections[].group` describe. The
 * predicate comes from the object's `fieldGroups` through
 * `deriveFieldGroupDetailEntries`, which carries it beside the resolved
 * section, never on it.
 *
 * ⛔ NOT read off an enumerated section. `RecordDetailsProps.sections[]` is
 * strict and refuses `visibleWhen` on parse (`unrecognized_keys`), so a
 * `visibleWhen` written on a `{ name, label, fields }` entry is a key the
 * protocol rejects, and this renderer does not honour it either: declared =
 * enforced, in both directions. To gate a section, gate the field GROUP and
 * reference it with `{ group }` — which is what the synthesized default page
 * and a Studio seed now emit.
 *
 * ⭐ ONE engine, the form's: `evalFieldPredicate` from `@object-ui/core`, the
 * call the form renderer makes for a field group's `section-divider` gate
 * (`sectionGateVisible` in `@object-ui/components`' form renderer), with the
 * same three inputs it passes —
 *
 *  - `record` — {@link sectionPredicateRecord}; values bind under `record.`
 *    only, so a bare `kind == 'pro'` is an unbound identifier on both
 *    surfaces;
 *  - `previous` — the SAME record. An edit form binds `previous` to the
 *    persisted row, and the row this page shows IS the persisted row, so a
 *    `previous.*` predicate reaches the verdict it reaches on that record's
 *    unedited edit form;
 *  - `scope` — `usePredicateScope()`, the host's `current_user` / `features`
 *    roots, the hook the form calls.
 *
 * Both spellings are the evaluator's to read — a bare string is CEL, an
 * envelope is read by its `dialect` — so neither is special-cased here. The
 * shared derivation types the predicate structurally (a string or any plain
 * object); the evaluator itself answers a shape it cannot evaluate (no string
 * `source`, `{}`) as a fault, which is why handing it over as a
 * `FieldRulePredicate` is safe.
 *
 * ⚠️ A predicate that cannot be evaluated (parse error, unbound identifier, a
 * blank or `source`-less declaration) HIDES the section — fail-CLOSED, the
 * direction `@objectstack/spec` declares for this slot
 * (`ObjectFieldGroupSchema.visibleWhen`: "else hidden (fail-closed)") and the
 * one the form takes for the same group (objectui#13055). It is NOT the
 * field-rule triad's fail-open (`VISIBLE_WHEN_FAULTED`, ADR-0137 D3), whose
 * scope note leaves this slot its own direction. The one-time warning names
 * `false` as the default taken. Only field-group references reach this
 * function, so there is no fail-open origin to tell apart here.
 */
function sectionPredicateVisible(
  visibleWhen: FieldRulePredicate,
  record: Record<string, unknown>,
  scope: Record<string, unknown>,
  where: string,
): boolean {
  return evalFieldPredicate(visibleWhen, record, false, record, scope, {
    context: `visibleWhen of ${where} — fail-closed, the group is hidden`,
  });
}

/**
 * Fold a declared pointer pair's TYPE half into its id half's card
 * (objectui#13102).
 *
 * `@objectstack/spec` declares a polymorphic record pointer as a pair: the id
 * half (`record_id`) names its sibling with `referenceVia` (`object_name`), and
 * the sibling holds the target object's machine name. `DetailSection` draws the
 * id half as the record card, which already names the target object by its
 * label. Drawing the type half as a row of its own beside that card shows the
 * stored machine name next to the label that names the same object.
 *
 * So a type half leaves the body when its id half is drawn in the same body.
 * The pair is read off the OBJECT's declared fields only: a field is a type
 * half because a declared field names it in `referenceVia`, never because of
 * what it is called. A type half whose id half this body does not draw keeps
 * its row, since no card on this body says what it holds.
 *
 * Only the row goes. The record still carries the value, so the card still
 * resolves the pair from the row, and every other reader still reads it.
 */
function foldPointerTypeHalves<S>(
  fields: unknown[] | undefined,
  sections: S,
  objectFields: Readonly<Record<string, { readonly referenceVia?: unknown } | null | undefined>> | undefined,
): { fields: unknown[] | undefined; sections: S } {
  if (!objectFields) return { fields, sections };
  // id half -> type half, for every pair the object declares.
  const typeHalfOf = new Map<string, string>();
  for (const [name, def] of Object.entries(objectFields)) {
    const via = def?.referenceVia;
    if (typeof via === 'string' && via !== '' && via !== name && objectFields[via] != null) {
      typeHalfOf.set(name, via);
    }
  }
  if (typeHalfOf.size === 0) return { fields, sections };

  const sectionFields = (s: unknown): unknown[] | undefined => {
    const list = s && typeof s === 'object' ? (s as { fields?: unknown }).fields : undefined;
    return Array.isArray(list) ? list : undefined;
  };
  const lists: unknown[][] = [];
  if (Array.isArray(fields)) lists.push(fields);
  if (Array.isArray(sections)) {
    for (const s of sections) {
      const list = sectionFields(s);
      if (list) lists.push(list);
    }
  }
  const drawn = new Set<string>();
  for (const list of lists) {
    for (const entry of list) {
      const n = fieldName(entry);
      if (n) drawn.add(n);
    }
  }
  const folded = new Set<string>();
  for (const [idHalf, typeHalf] of typeHalfOf) {
    if (drawn.has(idHalf)) folded.add(typeHalf);
  }
  if (folded.size === 0) return { fields, sections };

  const drop = (list: unknown[]): unknown[] =>
    list.filter((e) => {
      const n = fieldName(e);
      return !(n && folded.has(n));
    });
  return {
    fields: Array.isArray(fields) ? drop(fields) : fields,
    sections: (Array.isArray(sections)
      ? sections.map((s: unknown) => {
          const list = sectionFields(s);
          return list ? { ...(s as object), fields: drop(list) } : s;
        })
      : sections) as S,
  };
}

export interface RecordDetailsRendererProps {
  schema?: RecordDetailsComponentProps & Record<string, any>;
  className?: string;
  [k: string]: any;
}

const RecordDetailsBody: React.FC<RecordDetailsRendererProps> = ({
  // ⛔ NOT `{} as any` (objectui#8649). A destructuring default's type joins
  // the annotated property type at the binding, so `any` here ERASED
  // `RecordDetailsRendererProps` for every read site in this file: declared
  // keys (`hideFields`, `sections`, `columns`, …) and ones the mirror did not
  // declare then (`enforceFieldSecurity`, …) all read `any`, indistinguishably. That is what
  // made objectui#8327's checker census unable to classify eleven of this
  // card's twelve reads, and it is a LOCAL type defect — the exported
  // annotation above was always correct, so repairing it moves no published
  // surface. Spelled THROUGH the annotation rather than restating it, so a
  // later change to `RecordDetailsRendererProps` cannot silently re-erase it.
  // Pinned by `__tests__/detailRendererUndeclaredKeys-8649.test.ts`.
  schema = {} as NonNullable<RecordDetailsRendererProps['schema']>,
  className,
  ...props
}) => {
  // ── Hooks (unconditional — before ANY early return) ──────────────────────
  // Rules of hooks: every hook below MUST run on every render, whether or not
  // a record is bound and whether or not the viewer has permission. Returning
  // early *between* hooks — the designer placeholder (`!ctx`) or the
  // permission-denied notice — changes the hook count between renders and
  // throws React error #310 ("Rendered fewer hooks than expected"). That is
  // precisely the crash a related-list row click produced: `onRowClick` flips
  // the bound record / permission state, `ctx` (or the capability verdict)
  // toggles,
  // and the previously-mounted `record:details` re-renders with fewer hooks.
  // Keep all hooks here; move all conditional returns below them.
  const ctx = useRecordContext();
  const { designer } = splitDesigner(props);
  /**
   * The block's authored `aria` bag, honoured through the family's ONE read
   * point (objectui#9556). Called here, with the other hooks, because every
   * renderer below it has early returns.
   *
   * ⛔ No `defaultRole`: with nothing authored this container stays the bare
   * `div` it has always been, so a page that never wrote `aria` renders
   * byte-identical DOM. An author who does write one gets a `region` to carry
   * it — see `recordComponentAria.ts` for why the attribute alone would reach
   * nobody.
   */
  const ariaProps = useRecordAriaProps(schema.aria);

  const objectName = ctx?.objectName || '';
  const perms = usePermissions();
  const { readableFields } = useFieldPermissions(objectName);
  const { sectionLabel } = useSafeFieldLabel();
  const { language } = useObjectTranslation();
  // The host predicate scope (`current_user`, `features`, …) a section's
  // `visibleWhen` binds beside `record` — the hook the entry form reads for the
  // same predicate (objectui#11630). Called here with the other hooks because
  // the returns below are conditional.
  const predicateScope = usePredicateScope();

  // Phase N.4b: field names registered live by a mounted `record:highlights`
  // instance via HighlightFieldsContext (used to dedupe them out of the grid).
  const liveHighlightNames = useHighlightFieldNames();

  // objectui#12787: on a page that declares `print` the H1 title dedupe below
  // does not apply. Read the way `DetailView` and `DetailSection` read the
  // same context, here with the other hooks because the returns below are
  // conditional.
  const isPrintPage = usePrintPage() !== null;

  // Inline-edit save + OCC now live in the record-level <InlineEditSaveBar>
  // (objectui#2407 P1): it commits the whole draft in ONE atomic
  // `dataSource.update(..., { ifMatch: data.updated_at })` and reuses
  // <ConcurrentUpdateDialog> on a 409. This renderer just supplies the draft
  // scope (<InlineEditProvider>) + the save bar with the bound record's
  // DataSource / id / version / refresh.

  // ── Conditional returns (safe now — all hooks above have run) ────────────

  // Studio designer / palette: render an empty shell when no record bound.
  if (!ctx) {
    return (
      <div
        className={className}
        data-record-details-placeholder
        {...designer}
      >
        <div className="text-xs text-muted-foreground italic px-3 py-2 border border-dashed rounded">
          record:details — bind a record to preview
        </div>
      </div>
    );
  }

  // Read UN-CAST (objectui#8649): the mirror declares the field-security
  // triple since `@objectstack/spec` 17.5.0 declared it on this block, so this
  // read and the `enforceFieldSecurity` / `redactFields` reads below carry the
  // declared types. Output-identical to the cast they replace.
  const required: string[] = Array.isArray(schema.requiredPermissions)
    ? schema.requiredPermissions
    : [];
  /**
   * Block-level ADR-0066 CAPABILITY gate, read fail-closed (objectui#10155 —
   * the sibling family of objectui#10058, ruling batch #192 item 5 letter B).
   *
   * `requiredPermissions` on a record block is a **system capability set** —
   * the one meaning the word carries on `action`, `app`, `field` and
   * `bulkAction` — so it is read through the permission context's capability
   * path (`hasCapabilities` over the reported `systemPermissions`). An unheld
   * or unrecognised capability withholds the block's content, and an
   * insufficient-permissions notice (`role="status"`) renders in its place:
   * the block is not hidden. That is what the contract's describe on
   * `RecordDetailsProps.requiredPermissions` says ("an insufficient-permissions
   * notice takes its place").
   *
   * ⛔ NOT `perms.can(objectName, name)`. That call's second argument is the
   * closed object-action enum, and the stock `/me/permissions` provider maps
   * only eight verbs (`read`, `view`, `create`, `update`, `edit`, `delete`,
   * `import`, `export`) before its `?? 'allowRead'` tail sends everything else
   * to the object's read bit — so a capability nobody holds passed for every
   * reader of the object, with no refusal, no warning and no log. The full
   * reproduction behind that sentence is written once, at the same gate in
   * `record-quick-actions.tsx`, and is not restated here.
   *
   * ⛔ The object name is deliberately ABSENT from the verdict. A system
   * capability is not object-scoped, and the old `&& objectName` conjunct was
   * a second silent fail-open: a block rendered with no `objectName` in its
   * record context skipped its declared gate entirely.   *
   * ⚠️ A provider that never REPORTS capabilities (`systemPermissions`
   * `undefined` — the role-based `PermissionProvider`, a backend predating
   * ADR-0066, or no provider at all) still opens this gate. That is
   * `hasCapabilities`'s own ruled unreported-vs-empty doctrine
   * (objectui#4656), shared with every other capability gate in the tree; a
   * REPORTED empty array (`[]`, "holds nothing") is a real answer and gates
   * strictly.
   */
  if (required.length > 0 && !perms.hasCapabilities(required)) {
    return (
      <div className={className} {...designer} role="status" aria-live="polite">
        <p className="text-sm text-muted-foreground italic">
          Insufficient permissions to view details.
        </p>
      </div>
    );
  }

  const enforceFLS = schema.enforceFieldSecurity === true;
  const redact: string[] = Array.isArray(schema.redactFields)
    ? schema.redactFields
    : [];
  const filterList = (list: any[] | undefined): any[] | undefined => {
    if (!list) return list;
    if (!enforceFLS && redact.length === 0) return list;
    const names = list.map(fieldName).filter((n): n is string => !!n);
    const allowed = new Set(
      (enforceFLS && objectName ? readableFields(names) : names)
        .filter((n) => !redact.includes(n)),
    );
    return list.filter((e) => {
      const n = fieldName(e);
      // Fail CLOSED on an entry this fold cannot NAME (objectui#9054). The
      // else-branch used to KEEP such an entry, so anything that is not a bare
      // string, `{ field }`, `{ name }` or `{ fieldName }` escaped BOTH
      // `enforceFieldSecurity` and `redactFields` — a field-security control
      // defaulting to *permit* on the one input it could not understand.
      //
      // The same one-arm repair objectui#8793 / PR objectui#9058 made on
      // `record:related_list`'s fold, deliberately identical: one defect on two
      // paths gets one shape. `record-highlights.tsx` expresses the same
      // semantics by dropping unnamed entries BEFORE its allow-list; that is
      // this line's meaning, not a third policy.
      //
      // ⚠️ What this does NOT claim. On the related list the kept entry
      // rendered its REAL VALUE, because `RelatedList` resolves a column as
      // `accessorKey || columnIdentity(c)` — a second read point that could
      // name what the fold could not. This path has no such second reader:
      // `DetailSection` renders from `field.name` only, and an entry the fold
      // cannot name has no `name` for it either, so the kept entry painted a
      // labelless `—` placeholder row and never a record value (measured on
      // the real DOM in the pin beside this file). The defect closed here is
      // therefore the fail-open DEFAULT on a security boundary, not a measured
      // value leak.
      //
      // Scoped to the filtering path only: with neither key set this whole
      // function returns `list` by reference above, so an ordinary detail
      // block renders exactly what it always did.
      return n ? allowed.has(n) : false;
    });
  };

  // Normalise field entries to the DetailViewField shape that DetailSection
  // expects. Schemas authored against `@objectstack/spec` declare fields as
  // bare strings (`fields: ['first_name', ...]`), but DetailSection reads
  // `field.name` / `field.label`, so we must coerce string → object form
  // before handing the schema to DetailView. Object entries pass through.
  // The bound object definition. Declared HERE rather than beside the
  // title-dedupe ladder below because two readers now need it and it must
  // precede the earlier of them: `withDeclaredLabel` (the field-label ladder)
  // and `deriveFieldGroupDetailEntries` (the `sections[].group` reference
  // form). One read, one name.
  const objSchema: any = (ctx as any).objectSchema;
  const objSchemaFields: Record<string, any> | undefined = objSchema?.fields;

  /**
   * Rung 2 of the label ladder: the label the OBJECT declares (objectui#8497).
   *
   * `DetailSection` renders `fieldLabel(objectName, field.name, field.label ||
   * field.name)` — an i18n lookup whose third argument is the fallback. So the
   * ladder is `bundle key -> field.label -> field.name`, and an enumerated
   * `sections[].fields` list is `['our_entity', ...]`: bare strings, which
   * `normaliseField` turned into `{ name }` with NO `label`. Rung 2 was
   * therefore missing entirely and the ladder collapsed to `bundle key ->
   * field name`. With no bundle — the default for an app that has not
   * configured translations — EVERY detail page rendered raw snake_case field
   * names under a `text-transform: uppercase`, while `clm_contract.our_entity`
   * declared `label: 'Our Signing Entity'` all along and nothing reported it.
   *
   * The label is NOT invented here and it is not a new source: this is the
   * same read the GROUP-derived body already performed (`toField` in
   * `synth/buildDefaultPageSchema.ts`: `label: f.label || name`), which is
   * exactly why the platform's synthesized default page showed declared labels
   * while a hand-authored enumeration of the same fields did not. Filling the
   * rung here is what makes the two bodies agree.
   *
   * ⚠️ An AUTHORED `label` on the entry still wins — `withDeclaredLabel` only
   * fills a `label` the author left undefined, so a view's explicit override
   * keeps its precedence, and an app WITH a full bundle is untouched because
   * rung 1 resolves before this value is ever read.
   *
   * `pickLocalized` rather than a raw read: a field label may be authored as an
   * inline `{ en, 'zh-CN' }` map, and handing that object through would render
   * `[object Object]`. It returns '' for a value it cannot resolve, which the
   * emptiness check below rejects so the ladder falls through to the name.
   */
  const withDeclaredLabel = (entry: any): any => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') return entry;
    if (entry.label !== undefined) return entry;
    const declared = objSchemaFields?.[entry.name]?.label;
    if (declared == null) return entry;
    const label = pickLocalized(declared, language);
    return label ? { ...entry, label } : entry;
  };

  const normaliseField = (entry: any): any => {
    if (typeof entry === 'string') return withDeclaredLabel({ name: entry });
    if (entry && typeof entry === 'object' && !entry.name && entry.field) {
      return withDeclaredLabel({ ...entry, name: entry.field });
    }
    return withDeclaredLabel(entry);
  };
  const normaliseList = (list: any[] | undefined): any[] | undefined =>
    Array.isArray(list) ? list.map(normaliseField) : list;

  // Phase N.4: dedupe with the highlight strip — when authors include a
  // field in `record:highlights` we drop it from the details grid so it
  // isn't shown twice. The synth pipeline passes the highlight list via
  // `hideFields`; authors can also set it directly on the schema. We also
  // merge in any field names registered live via HighlightFieldsContext
  // (see `liveHighlightNames` above) to cover hand-authored Lightning pages
  // that don't go through the synth dedup path.
  //
  // ⛔ Read UN-CAST (objectui#9965). `hideFields` is DECLARED on the mirror
  // (`RecordDetailsComponentProps.hideFields`, `string[]`, since objectui#9040,
  // aligned to `@objectstack/spec` `RecordDetailsProps.hideFields`). A
  // `(schema as any)` here SPENT that declaration at the one site it exists
  // for: measured with `getTypeAtLocation` on this very expression, the cast
  // read carried `any` and the un-cast read carries `string[] | undefined`.
  // ⚠️ What it does NOT buy: `RecordDetailsRendererProps['schema']` is
  // intersected with `Record<string, any>`, so a MISSPELLED key still
  // type-checks here — this buys wrong-TYPE refusal, not wrong-SPELLING
  // refusal. Both halves are pinned by
  // `__tests__/record-details.hideFieldsUncast-9965.test.ts`.
  //
  // The `{name}` / `{field}` entries `fieldName` still tolerates below are
  // NOT a second declared dialect — the contract declares
  // `z.array(z.string())` and refuses them on parse (see the mirror's own
  // note on `hideFields`); this reader stays tolerant of what already reaches
  // it at runtime, which is why the callbacks below keep their `any`.
  const hideFieldNames = new Set<string>(
    (Array.isArray(schema.hideFields) ? schema.hideFields : [])
      .map((n: any) => (typeof n === 'string' ? n : fieldName(n)))
      .filter((n: any): n is string => !!n),
  );
  for (const n of liveHighlightNames) hideFieldNames.add(n);

  // Phase P.0: also hide the field that's already shown as the page H1
  // title. Repeating that same value in the body grid is pure duplication —
  // every record detail page used to show "客户名称: Acme Corporation"
  // immediately below an H1 that said "Acme Corporation". Authors who
  // want the field anyway can override via the schema (we only add it
  // when the field exists in the data and the dedup wouldn't empty the
  // section).
  //
  // ⚠️ This ladder is a DEDUPE, not a title resolver: the question it answers
  // is "which ROW disappears", and it is keyed on the record value being
  // non-empty because a row with no value is not duplicating a heading.
  // The H1 itself is drawn a package away, by `@object-ui/components`'
  // `PageHeaderRenderer` (`page:header`, synthesized by
  // `buildDefaultPageSchema`) — the names below mirror THAT chain, which is
  // why a change to either half must re-read the other.
  //
  // ⭐ The first two candidates are the unified ADR-0079 resolver, in NAME
  // space (objectui#8175). Before them this list was the six literal names
  // alone — the TAIL of the header's chain with no equivalent of the resolver
  // rung above it — so an object declaring `nameField: 'contract_no'` got BOTH
  // halves of the dedupe wrong at once: the duplicate survived (`contract_no`,
  // the value the H1 was showing) and an ordinary field disappeared instead
  // (`name`, the literal walk's first entry, a row the H1 never showed).
  // Pinned in `__tests__/record-details.nameFieldDedupe-8175.test.tsx`, which
  // asserts which row RENDERS and which row DROPS — never the heading, which
  // this package does not draw.
  //
  // ⚠️ The resolver rung is UNROLLED into two candidates on purpose, and
  // `resolveNameField` alone is NOT enough. It returns ONE answer and
  // short-circuits: a declared pointer wins outright and `deriveTitleField`
  // never runs. This ladder is VALUE-keyed, and so is the header's — when the
  // declared pointer is blank on a record, `getRecordDisplayName` keeps
  // walking and lands on the derivation (step 4). Listing both rungs is what
  // lets the fall-through happen here too. When nothing is declared the two
  // return the same name and the first one simply wins.
  //
  // ⚠️ Two rungs of the header chain name no FIELD at all, so a dedupe keyed
  // on "which single field is the H1" is structurally unable to answer them
  // (objectui#8351). They are NOT symmetric and only ONE is answered here:
  //   - `objectSchema.titleFormat` — ANSWERED, below, by the ruled option B:
  //     the template's rendered output is compared against the candidates'
  //     values, then against the fields the template rendered
  //     (objectui#10360), and a composite that is no field's value hides no
  //     row.
  //   - `page:header`'s own `schema.title` — NOT answered, and not answerable
  //     from this package: it is a key on the HEADER schema, which
  //     `record:details` never receives. Same shape, its own card.
  //
  // ⭐ THE ORDER between those rungs is now the protocol's, in all three
  // readers (objectui#9436, ruled C1). The ADR-0079 declared pointer
  // (`nameField`, then its `displayNameField` alias) OUTRANKS the interpolated
  // `titleFormat`, as `getRecordDisplayName` documents it (pointer at steps
  // 1+2, template at step 3). `PageHeaderRenderer` used to rank the template
  // ABOVE the pointer, and this ladder mirrored that. It checked the template
  // first, so once the header moved it hid the wrong row and kept the real
  // duplicate. The header pin in `@object-ui/components`'
  // `__tests__/page-header-title.test.tsx` now asserts the protocol order.
  //
  // ⚠️ So this ladder DOES depend on the order, and it reads it first: when
  // the declared pointer holds a value on this record, that field IS the H1.
  // Its row is hidden and the template is never consulted, because the header
  // never reaches it either. The template branch below only runs when the
  // declared pointer is absent or blank on the record. The two halves are
  // pinned rendered together in
  // `__tests__/record-details.headerDedupeAgreement-9436.test.tsx`, which reads
  // the real H1 beside the real body.
  //
  // ⛔ `objSchema?.primaryField` used to top this list, and it is gone
  // (objectui#7586). It is a `DetailViewSchema` key (`@object-ui/types`
  // `views.ts`) — a VIEW key, read here off an OBJECT def, where nothing can
  // declare it: `@objectstack/spec`'s object schema is a `strictObject`
  // answering `unrecognized_keys: ['primaryField']`, and
  // `ObjectSchema.create()` throws. objectstack#6326 removed the identical
  // read from two lint rules; objectui#7287 / PR #7585 removed it from
  // `resolveTitleField`, and the same removal from the header chain above is
  // what keeps the two halves agreeing. `DetailView.resolveDisplayTitle`
  // still reads `schema.primaryField` off the VIEW schema and is welcome to.
  //
  // ⚠️ The docstring here used to name `objectSchema.primaryField` as the
  // chip's first source. That stopped being true when PR #7585 landed, and
  // this ladder outlived the sentence describing it — hence the rewrite
  // above rather than a one-line deletion. Pinned in
  // `__tests__/record-details.primaryFieldRetired-7586.test.tsx`, which
  // asserts the DEDUPE outcome (which row the grid hides), not the title.
  //
  // ⭐ The ladder reads the record AS THE VIEWER MAY READ IT (objectui#10434):
  // the fields the loaded policy denies on this object are removed first,
  // `id` kept, the row ObjectStack's `FieldMasker` already serves. A denied
  // pointer or `titleFormat` token therefore reads here exactly as an absent
  // one, and this ladder answers what it answers on a stripping backend.
  // `DetailView`'s own header (`showHeader: true`) builds its H1 from the
  // same row, so the row hidden is the one that H1 now shows; reading the raw
  // row instead printed that row directly under it. ⚠️ `page:header` still
  // builds its H1 from the row as served, so under it, on a backend that does
  // not strip, the H1 can show a denied value while this ladder hides the row
  // a stripping backend's H1 would show; gating that host is its own change.
  // A denied field's own row is hidden by `DetailView`'s field gate whatever
  // this ladder picks. Before the policy loads nothing is removed.
  const data: any = withoutDeniedFields(ctx.data ?? {}, perms, objectName);
  // The `.filter(…): n is string` guard is back, for a different reason than
  // the one objectui#7586 retired: it used to drop an `objSchema?.primaryField`
  // entry that was absent always, and now it drops the two resolver rungs when
  // an object declares and derives nothing — `string | undefined` is those
  // functions' real return type, not a stand-in for a key nothing can produce.
  const titleCandidates = [
    resolveNameField(objSchema),
    deriveTitleField(objSchema),
    'name',
    'full_name',
    'title',
    'subject',
    'display_name',
    'label',
  ].filter((n): n is string => typeof n === 'string' && n.length > 0);
  //
  // ⚠️ EMPTINESS IS THE HEADER'S DEFINITION, NOT A LOCAL ONE (objectui#8350).
  // `recordDisplayValueAt` is the very function every value-keyed rung of
  // `getRecordDisplayName` uses to decide whether a rung resolved — imported,
  // not re-spelled, because the two halves must agree about WHAT COUNTS AS A
  // VALUE exactly as objectui#8175 made them agree about WHICH FIELD.
  //
  // This line used to be a raw `undefined` / `null` / `''` test. A
  // whitespace-only value passes that and does NOT pass the header's, so on a
  // record whose title field held only spaces the ladder concluded that field
  // was what the H1 showed and hid its row, while the H1 had already walked on
  // to the next rung and was showing something else. A field disappeared from
  // the grid to deduplicate against a heading that never displayed it — silent,
  // nothing errored, a row was simply absent.
  //
  // ⛔ Never "just add a `.trim()`" here. That is a SECOND implementation of the
  // same test, which is the shape of the defect this line closes, one level
  // down: it would still disagree with the header about an expanded lookup
  // object whose display chain yields nothing (`{ id: 'u1' }` is not a title),
  // which the raw test — and a trim of it — both read as a value.
  //
  // ⭐ THE `titleFormat` RUNG (objectui#8351, maintainer ruling option B).
  //
  // A `titleFormat` H1 is a rendered TEMPLATE, not a field. On a multi-field
  // format it is no single field's value, so NO row duplicates it and the walk
  // below must not run at all — it would hide `resolveNameField`'s row, a row
  // the H1 never showed, exactly the "a field silently vanished" shape
  // objectui#8175 closed one rung higher.
  //
  // ⚠️ "Fully interpolates" is measured, not assumed, and it is measured with
  // the instruments already here — no new predicate, which is the same rule
  // the emptiness note below states:
  //   - `formatTitleTemplate` is THE renderer of this rung. It is what
  //     `getRecordDisplayName` step 3 calls and what this package's own
  //     `DetailView.resolveDisplayTitle` step 2 calls, so all three agree
  //     about what the template produces on a given record.
  //   - `recordDisplayValueAt` then answers the only question a dedupe has:
  //     is that string some candidate's value, or the value of a field the
  //     template rendered (objectui#10360, see the note on the scan below)?
  //
  // Three outcomes, and the two that are NOT the ruled case are what keep this
  // honest:
  //   - composite (no compared field's value equals it) → hide NOTHING. The
  //     ruled case: "the H1 is not any single field's value, so there is no
  //     row to hide".
  //   - empty (no placeholder resolved on this record) → the header walks on
  //     past this rung to the unified resolver, so the value-keyed walk below
  //     runs unchanged. Suppressing on the mere PRESENCE of a `titleFormat`
  //     would blind the dedupe on every record where the template renders
  //     nothing.
  //   - collapsed onto ONE field's value (a blank placeholder was dropped with
  //     its orphan separator, or the format names a single field) → that row
  //     IS the duplicate, and it still goes. A presence-only rule prints that
  //     field's row directly beneath an H1 showing the same value, which is
  //     the duplication Phase P.0 exists to remove.
  //
  // All three outcomes are reached only when the declared pointer did not
  // answer first (objectui#9436, see the ORDER note above).
  //
  // Pinned in `__tests__/record-details.titleFormatNoDedupe-8351.test.tsx`,
  // which asserts which row RENDERS and which row DROPS — never the heading,
  // which this package does not draw.
  //
  // ⚠️ The match is a SCAN of the candidates, not a peek at the first one with
  // a value. With `titleFormat: '{subject}'` on an object that declares no
  // pointer and derives `name`, the first resolving candidate is `name` while
  // the H1 is `subject`'s value. Stopping early would hide the wrong row AND
  // leave the real duplicate.
  //
  // ⭐ The "collapsed" outcome is matched against EVERY field the template
  // rendered, not only the candidates (objectui#10360). The candidates are the
  // resolver rungs and six literal names, so a template that collapsed onto
  // any other field — `{contract_no} - {name}` with a blank `name` renders
  // exactly `contract_no`'s value — matched none of them, and that row printed
  // directly under an H1 showing the same value. The comparison is ruling B's,
  // unchanged: equality with the rendered string, never the presence of a
  // template. Only the set compared is wider, and in a fixed order:
  //   1. the candidate scan, exactly as before, so a candidate match still
  //      wins and no row that was hidden before moves;
  //   2. only then, each record field whose value equals the H1 AND that the
  //      template actually rendered. At most one row goes (the first in record
  //      key order), as in step 1.
  //
  // ⛔ "Actually rendered" is asked of `formatTitleTemplate` ITSELF, never of a
  // second placeholder parser: blank that one field, render again, and see
  // whether the title changed. So this agrees with the renderer on every token
  // shape it accepts (`{{…}}`, whitespace inside the braces, dotted lookup
  // paths), and cannot drift from it. It is also stricter than "a field the
  // template names", and that is on purpose: `{owner.nickname} - {rep}` with a
  // blank nickname renders `rep`'s value, and an `owner` lookup whose display
  // name happens to equal it is named by the template yet rendered nothing.
  // Hiding `owner` there would leave the real duplicate printed. Pinned in
  // `__tests__/record-details.titleFormatPlaceholderDedupe-10360.test.tsx`.
  //
  // The declared pointer is read through core's one exported spelling,
  // `declaredNameField`, exactly as `PageHeaderRenderer` reads it: the same
  // expression on both halves, never a re-typed `??` chain.
  //
  // ⭐ On a print page none of this ladder runs (objectui#12787): the page
  // refuses `page:header`, so no H1 draws the title and there is nothing to
  // deduplicate against. `record:details` prints every field it declares, the
  // title field included. Pinned in
  // `__tests__/record-details.printTitleField-12787.test.tsx`.
  const declaredTitleField = declaredNameField(objSchema);
  if (isPrintPage) {
    // Nothing hidden for the H1; `hideFields` and the highlights still apply.
  } else if (recordDisplayValueAt(data, declaredTitleField) !== undefined) {
    hideFieldNames.add(declaredTitleField);
  } else {
    const titleFormat = objSchema?.titleFormat;
    const interpolatedTitle = formatTitleTemplate(titleFormat, data);
    if (interpolatedTitle) {
      const showsTitle = (field: string) =>
        recordDisplayValueAt(data, field) === interpolatedTitle;
      const shownAs =
        titleCandidates.find(showsTitle) ??
        Object.keys(data).find(
          (field) =>
            showsTitle(field) &&
            formatTitleTemplate(titleFormat, { ...data, [field]: undefined }) !== interpolatedTitle,
        );
      if (shownAs) hideFieldNames.add(shownAs);
    } else {
      for (const candidate of titleCandidates) {
        if (recordDisplayValueAt(data, candidate) !== undefined) {
          hideFieldNames.add(candidate);
          break;
        }
      }
    }
  }

  const dropHidden = (list: any[] | undefined): any[] | undefined => {
    if (!list || hideFieldNames.size === 0) return list;
    return list.filter((e) => {
      const n = fieldName(e);
      return n ? !hideFieldNames.has(n) : true;
    });
  };

  // ── The declared fallback body (objectui#12433) ─────────────────────────
  //
  // `@objectstack/spec` declares what a node with no authored body draws, on
  // `RecordDetailsProps`' retired `layout` entry: "`sections` renders the
  // explicit groups (the old `custom`), and omitting it falls back to the
  // object's `highlightFields` (the old `auto`)"; its `fields` describe says
  // the same from the other side ("overrides highlightFields"). This renderer
  // published both sentences in its registry `inputs` and honoured neither: a
  // bare node handed `DetailView` no body at all, so objectstack's served
  // `sys_approval_request_detail` Details tab was empty for every approver.
  //
  // ⭐ "Omitted" means the author wrote neither key. An authored `sections` or
  // `fields` is the body, an empty one included: `[]` is not omission. The
  // test is on the AUTHORED keys, never on what the fold below leaves, so a
  // list the field-security fold empties stays empty and is never re-derived
  // (the objectui#9053 hazard on `record:related_list`).
  //
  // The list then takes the path an authored `fields` list takes: the fold
  // (`enforceFieldSecurity` / `redactFields`), the label ladder, and the
  // dedupe against the mounted strip and the page H1 (`dropHidden`).
  //
  // ⛔ An object that declares no `highlightFields` draws what it drew before,
  // an empty body: the spec names no further fallback, and none is invented
  // here. Pinned in `__tests__/record-details.highlightFieldsFallback-12433.test.tsx`.
  const bodyFieldsOmitted = schema.sections === undefined && schema.fields === undefined;
  const bodyFields: string[] | undefined = bodyFieldsOmitted
    ? (Array.isArray(objSchema?.highlightFields) ? objSchema.highlightFields : undefined)
    : schema.fields;
  const filteredFields = dropHidden(normaliseList(filterList(bodyFields)));

  // ── `sections[].group` — the ADR-0085 §5 REFERENCE form ──────────────────
  //
  // `{ group: 'parties' }` inherits the object's `fieldGroups` entry with that
  // key: its members (every visible field pointing at it, in declaration
  // order) and its own presentation (label, icon, description, collapse) —
  // `@objectstack/spec` 17.3.0 `RecordDetailsProps.sections[].group`
  // (objectstack#13855), whose semantics are single-sourced in
  // `deriveFieldGroupLayout`. This renderer used to read the key NOWHERE, and
  // its own `inputs` description told authors so ("authoring it does nothing
  // on this renderer"). Both were wrong in the worst direction: a section
  // carrying `group` carries no `fields`, and `DetailView` mapped every
  // section through `s.fields` unguarded, so an on-spec document did not
  // no-op — it threw out of a `useMemo` ABOVE the section loop and the
  // `SchemaErrorBoundary` replaced the WHOLE component with "Component
  // `record:details` failed to render", taking every well-formed sibling
  // section with it (objectui#8497). The declaration was right and the
  // runtime had never honoured it.
  //
  // Resolved through `deriveFieldGroupDetailEntries` — the derivation behind
  // the public `deriveFieldGroupDetailSections` AND behind the `{ group }`
  // references the synthesized default page emits — deliberately, not a
  // second derivation: that is what makes the two bodies agree. Authoring an
  // object's fields as a group reference and enumerating the same fields by
  // hand must render the same labels, and they do because one of them IS the
  // other's code path.
  const authoredSections: any[] = Array.isArray(schema.sections) ? (schema.sections as any[]) : [];
  const groupEntryByKey = new Map<string, FieldGroupDetailEntry>();
  if (authoredSections.some((s) => s && typeof s === 'object' && typeof s.group === 'string')) {
    for (const entry of deriveFieldGroupDetailEntries(objSchema) ?? []) {
      // The trailing ungrouped bucket carries no `key`, so no reference can
      // ever resolve to it — which is correct: it is not a declared group.
      if (typeof entry.key === 'string') groupEntryByKey.set(entry.key, entry);
    }
  }

  // The record a group's `visibleWhen` is evaluated against — assembled only
  // when a referenced group actually declares one, so a page without a gated
  // group does no extra work and renders exactly as before.
  let sectionRecord: Record<string, unknown> | undefined;

  /**
   * Resolve one authored entry to the section the body renders, or `null` when
   * a `group` reference names no declared group — or names a group whose
   * `visibleWhen` is FALSE for this record (objectui#11630).
   *
   * The gate drops the section whole, heading and members, which is what the
   * form does with the same group: its divider row claims the members, and a
   * FALSE verdict hides the row and every claimed field. Display only — the
   * record API serves the gated fields either way, exactly as a hidden form
   * section's values still submit. An enumerated entry is returned untouched:
   * see {@link sectionPredicateVisible} for why its `visibleWhen`, if any, is
   * not read.
   *
   * The spread order IS the spec's precedence. `sectionGroupReferenceRefinement`
   * refuses, on a section carrying `group`, every key the group itself declares
   * (`name`, `label`, `icon`, `description`, `collapsible`, `defaultCollapsed`)
   * and `fields`; it permits exactly the keys that describe how THIS page lays
   * the section out (`columns`, `showBorder`, `headerColor`). So the authored
   * half can only ever carry layout, and letting it win over the derived half
   * gives the group its presentation and the page its layout, with no key able
   * to have two sources.
   */
  const resolveSectionGroup = (s: any): any | null => {
    if (!s || typeof s !== 'object' || typeof s.group !== 'string') return s;
    const entry = groupEntryByKey.get(s.group);
    if (!entry) {
      reportUnresolvedSectionGroup(objectName, s.group);
      return null;
    }
    if (entry.visibleWhen != null) {
      sectionRecord ??= sectionPredicateRecord(ctx.data, objSchemaFields);
      const shown = sectionPredicateVisible(
        entry.visibleWhen as FieldRulePredicate,
        sectionRecord,
        predicateScope,
        `group '${s.group}' of record:details on object '${objectName}'`,
      );
      if (!shown) return null;
    }
    const { group: _group, ...authored } = s;
    return { ...entry.section, ...authored };
  };

  const filteredSections = Array.isArray(schema.sections)
    ? (schema.sections as any[]).map(resolveSectionGroup).filter((s) => s != null).map((s) => {
        // Authored labels may carry inline translations (`{ en, 'zh-CN' }`) —
        // resolve via pickLocalized before any convention-based lookup.
        //
        // `label` is the ONE heading slot (objectui#6190). This used to read
        // `s.title ?? s.label`: a second spelling of the same slot, with
        // byte-identical localization on both limbs and strict priority for
        // `title`, so a producer emitting both silently disagreed with itself
        // and `title` won. The spec face refuses `title` on sections
        // (objectstack#11902 pins that refusal) and `@object-ui/types` and the
        // authoring inspector declare only `label`, so the alias limb served no
        // accepted spelling; the three producers that still emitted `title`
        // moved to `label` in the same change that removed it.
        const rawTitleSrc = s.label;
        const rawTitle = rawTitleSrc != null ? pickLocalized(rawTitleSrc, language) : undefined;
        // Translate the section label when authors provided a stable `name`.
        // Convention: `{ns}.objects.{objectName}._sections.{name}.label`.
        // Falls back to the raw English label when no translation exists.
        const translatedTitle = s.name && objectName
          ? sectionLabel(objectName, s.name, rawTitle ?? s.name)
          : rawTitle;
        // `count: { field }` (objectui#12192): fill the heading's `{{ count }}`
        // hole with how many values that field holds on this record. Filled
        // AFTER translation, so the inline-map arm, the bundle arm
        // (`objects.OBJECT._sections.NAME.label`, whose `t()` pass keeps a hole
        // it was given no value for) and the authored text all carry the same
        // hole. Read off `data`, the record as the viewer may read it, so a
        // field the policy denies counts as absent, never as its hidden values.
        // A section without `count` keeps its heading exactly as written,
        // including a literal hole. ⛔ No section, object or field is special
        // here: `count` is generic, like every other section key.
        const countField: unknown = s.count?.field;
        const title = typeof countField === 'string' && typeof translatedTitle === 'string'
          ? fillSectionHeadingCount(translatedTitle, sectionHeadingCount(data?.[countField]))
          : translatedTitle;
        return ({
        ...s,
        title,
        // Titled sections get a Card wrapper for visual grouping. Untitled
        // flat sections stay borderless so the page chrome alone provides
        // containment. Authors can override explicitly via `showBorder`.
        showBorder: s.showBorder ?? (translatedTitle ? true : false),
        // The authored empty-section key, and THE RENDERER DEFAULT ITSELF.
        //
        // `@objectstack/spec` declares `hideEmpty` on this renderer's section
        // entry with no schema default, and states the fallback as the
        // renderer's: hiding is on, so a section whose fields are ALL empty
        // renders nothing at all — no heading, no skeleton — and `false` keeps
        // the section a brand-new record needs (read-only, its heading plus one
        // fold row since objectui#13386; edit mode, every row).
        //
        // ⭐ The default is resolved HERE, on an AUTHORED section, and that
        // placement is the whole design. `DetailSection` tests `=== true`, so
        // the default reaches exactly the authored sections this renderer
        // resolves it on. Every other section stays out. The direct-`fields`
        // fallback body below synthesizes a section nobody can write the key
        // on, and a hide there would be one with no declarable spelling to
        // ask the skeleton back — the defect upstream declared this key to
        // fix, reintroduced one surface over. The `detail-section` node
        // declares the key (objectui#10485) but applies no default of its
        // own, so an omitted one keeps the skeleton there too; only an
        // authored `true` hides.
        //
        // ⚠️ `?? true` is the spelling objectui#7064 removed, and it is back
        // deliberately. ⛔ Read that ruling's ground as it was written, not as
        // this line makes convenient: the maintainer ruled on 2026-08-31 that
        // an empty detail body is a PLATFORM concern and that a metadata
        // application should not have to author its way out of one. (The
        // ruling's own wording is on objectui#7064; it is deliberately not
        // transcribed here — AGENTS.md commandment #-1 keeps this codebase
        // English-only, and a translation of a ruling is not the ruling.) The
        // objection was to the AUTHORING
        // SHAPE — every application hand-writing `hideEmpty: false` per section
        // as per-app tax — and it was made KNOWING the key was declared
        // upstream (PR objectstack#11662); the deliverable was a sparse record
        // keeping a full structural skeleton with zero app-side authoring. The
        // spec-refusal reading came later, out of that card's own execution,
        // and was routed to objectui#7129; ⛔ it was not this ruling's ground.
        //
        // ⇒ objectui#8603 REVERSES the behavioural half of that ruling, and
        // the authoring it rejected is what a page now writes to keep the
        // skeleton. The reversal is undisclosed — the #8603 ruling does not
        // name objectui#7064 — and its standing was ruled on this change's
        // isolated at-tier contract review (Decision 1): a director-seat batch
        // item carrying the maintainer's assent has the same authority as the
        // live ruling it reverses, so it stands. ⛔ Whether it SHOULD is not a
        // question this file answers.
        //
        // What the spelling does here is narrower than either ruling: it
        // CONFINES the default to the authored surface instead of applying it
        // to every section this file hands on.
        //
        // ⚠️ Measured, so the next reader does not have to: the `...s` above
        // already spreads an authored value through, which is why #7129's
        // ablation found deleting this slot alone changed nothing and left its
        // suite green. This line is not a pass-through — it is the default —
        // but an ablation that only deletes it still has to reach
        // `DetailSection` to turn anything red on an AUTHORED `true`.
        //
        // History, because this key has been reversed twice: the slot forced
        // `s.hideEmpty ?? true` until objectui#7064 passed the authored value
        // through, and objectui#7129 (maintainer 2026-09-01) then retired the
        // key outright — four contracts, three answers, and
        // `@objectstack/spec` REFUSING it at the 17.2.0 pin. The pin moved to
        // 17.3.0, which DECLARES `hideEmpty` on the `record:details` section
        // entry with a describe() promising the behaviour this repo had just
        // removed, so that premise expired. objectui#8603 (director seat batch
        // #137 item 3, maintainer 2026-09-15) ruled the protocol correct and
        // restored the read; #7129's Q1-A is superseded for this key, and its
        // Q2-C — the auto-hide heuristic owning the empty ROWS of a
        // partly-filled section — is untouched. Pinned four ways in
        // `__tests__/record-details.hideEmptyRetired-7129.test.tsx`.
        hideEmpty: s.hideEmpty ?? true,
        fields: dropHidden(normaliseList(filterList(s.fields))),
      });
      })
    : schema.sections;

  // A pointer pair's type half is drawn by its id half's card, not as a row
  // of its own (objectui#13102; see `foldPointerTypeHalves`). Applied after
  // every other fold, so it reads the rows this body actually draws.
  const body = foldPointerTypeHalves(filteredFields, filteredSections, objSchemaFields);

  // Inline-edit by default, but gated by the object's lifecycle: system /
  // Engine-owned system / append-only / better-auth objects are not
  // user-editable, so the per-field double-click / pencil affordances must not
  // be offered on them — unless the object opened `userActions.edit` (the
  // ADR-0103 admin/user-writable set). This is the shared resolved `edit`
  // affordance from `@object-ui/core`, the single source of truth — formerly a hand-mirrored `NON_EDITABLE_BUCKETS` set kept
  // in lockstep by hand because plugin-detail can't depend on app-shell.
  // Authors can still force-disable with `inlineEdit: false`.
  // [objectstack#3546] Also AND inline-editability with the server's effective API
  // operation set for this object (`/me/permissions` `apiOperations`) — the
  // record body must not offer double-click/pencil editing the server would
  // 405. `undefined` (unrestricted / old backend) leaves the bucket affordance
  // untouched (backward-compatible).
  // [objectui#12082] …and AND the caller's update grant: this is the
  // `recordEdit` row of the affordance-to-grant map (`resolveAffordance` from
  // `@object-ui/core`), the SAME row the record page's header Edit reads, so
  // the body's pencils and the header CTA cannot disagree. Before the map the
  // body read no grant, so a standalone `record:details` offered in-place
  // editing to a read-only caller. With no provider the grant reads open.
  const objectInlineEditable = resolveAffordance('recordEdit', {
    objectSchema: objSchema,
    objectName,
    perms,
  }).allowed;
  const inlineEditDefault = (schema.inlineEdit ?? true) && objectInlineEditable;

  const synthesized: any = {
    type: 'detail-view',
    objectName: ctx.objectName,
    resourceId: ctx.recordId as any,
    data: ctx.data,
    // Constant by contract, not by omission. `record:details` HAD a `layout`
    // key; @objectstack/spec 17.0.0 removed it (objectstack#6946, ADR-0087 D2)
    // because its published `auto` | `custom` values were never implemented —
    // the only read here tested `inline` | `compact`, two values the schema
    // never permitted, so both legal values took this same branch. What
    // actually chooses the body is what you author: `sections` renders the
    // explicit groups, omitting it falls back to the object's highlightFields
    // (see `filteredSections` / `filteredFields` above; the fallback itself
    // landed with objectui#12433). objectui#3818.
    layout: 'vertical',
    // objectui#9056 — the protocol's STRING width becomes the internal node's
    // NUMBER here, and only here. See `detailBodyColumns` above for why the
    // coercion belongs on this side of the boundary rather than in
    // `applyAutoSpan` (which would be a tolerant reader) or in the published
    // `@object-ui/types` declaration (which would be a surface widening).
    columns: detailBodyColumns(schema.columns),
    sections: body.sections,
    fields: body.fields,
    showBack: false,
    // Suppress DetailView's own Airtable-style header chip. When
    // record:details is composed under a Lightning page:header the inner
    // title/star/copy chip would duplicate the surrounding page header.
    showHeader: schema.showHeader ?? false,
    inlineEdit: inlineEditDefault,
  };

  // The inline-edit session (InlineEditProvider) + the atomic Save bar are now
  // hosted by the PAGE host (app-shell RecordDetailView) so ONE draft spans the
  // highlights strip AND this body (objectui#2407 P2). DetailView here just
  // consumes that shared context; `inlineEdit` gates the affordance to this
  // object's lifecycle/permission.
  //
  // objectui#12307 — the provenance footer is the record PAGE's, drawn once by
  // the page host, so the DetailView below draws none of its own when this node
  // reads the page's record. That is the unbound node: with no `dataSource`
  // binding, the record context above is the record page's (see the module doc
  // of `./recordBinding`). A bound node shows the first row of its own query —
  // a record the page does not show — and keeps its footer. The predicate is
  // the one the binding gate and `recordBinding`'s `isBound` read.
  const readsPageRecord = !isElementDataSourceConfig(
    (schema as { dataSource?: unknown }).dataSource,
  );
  return (
    <div className={className} {...designer} {...ariaProps}>
      <RecordPageProvenanceContext.Provider value={readsPageRecord}>
        {/* objectui#12701 — the record is the context host's (the record
            page's read, or the binding's row above); this body never reads it
            again, it waits for `ctx.data`. */}
        <DetailView
          schema={synthesized}
          dataSource={ctx.dataSource}
          inlineEdit={inlineEditDefault}
          recordFromHost
        />
      </RecordPageProvenanceContext.Provider>
    </div>
  );
};

/**
 * `record:details` with the spec's per-element `dataSource` binding honoured
 * (objectui#12294). Unbound, the body reads the record page's record exactly as
 * before; bound, it reads the FIRST row of the bound set. `recordBindingBlock`
 * (`./recordBinding`, which states the semantics) wraps the body in the gate and
 * the one-record scope, and passes the result through the declaration seam.
 *
 * Wraps the EXPORTED name, as `record:related_list` does, so a host that
 * imports this renderer directly gets the binding too.
 */
export const RecordDetailsRenderer: React.FC<RecordDetailsRendererProps> = recordBindingBlock(RecordDetailsBody, 'record:details');

export default RecordDetailsRenderer;
