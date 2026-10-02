// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15922] A declared field with ZERO consumers across the registered
 * metadata roots — the field-level remainder of the #4698 "declared but never
 * read" class, landed in the platform under the hotcrm#1543 ruling (F).
 *
 * ## The gap
 *
 * An authored field that nothing in the app consumes — no view column, no form
 * section, no page block, no flow node, no dataset dimension, no formula, no
 * validation, no hook or action — is schema-valid and passes `os validate`,
 * `os lint`, `tsc` and the app's test suite. The declaration is inert and
 * nothing in the toolchain says so. HotCRM carried its own scanner to answer
 * exactly this question; its ledger read fields that had passed every platform
 * check. That scanner is retired (lint belongs to the platform, uniformly), and
 * this rule is where the capability lives instead.
 *
 * ## Object-aware, by construction
 *
 * The same field name on two objects gets two verdicts. HotCRM measured why: a
 * name-only grep read `crm_product.tax_rate` as consumed because
 * `crm_quote_line_item.tax_rate` — a different object's field, read by its own
 * formula — spells the same token, so the product's rate reached no sweep. A
 * reference is therefore credited to the object whose declaration ENCLOSES it
 * (`object` / `objectName` / `targetObject` / `data.object` / `config.objectName`
 * / `list.data.object` / a `dataset` resolved through the dataset's object / a
 * map keyed by object name / a flow's trigger object), and only when that
 * object actually declares the token. Inside a text blob (a hook handler, an
 * action body, a CEL source) the nearest preceding mention of a declared object
 * is a second candidate — a handler that loads one object and reads its own
 * genuinely reads both, and under-crediting is the noisy direction.
 *
 * ## Consumption is not one thing — what counts, what does not
 *
 * Every site is bucketed, and the verdict reads off the buckets:
 *
 *   - **behaviour** — the field makes something happen: a formula or roll-up,
 *     a validation predicate, a view FILTER / sort / grouping, a flow node, a
 *     hook or action body, a dataset or cube dimension or measure (every
 *     field its column path reads — {@link creditAnalyticsColumns}), a widget
 *     filter, a sharing-rule condition.
 *   - **display** — the field is drawn: a view column, a form section, a page
 *     binding, an inline grid column ({@link creditInlineGridColumns}),
 *     `highlightFields`, `searchableFields`, an index.
 *   - **carrier** — the field is merely carried along: a translation label, a
 *     seed value, an import-mapping column, a field-level permission grant, a
 *     flow's WRITE of the field, prose that names it. These are what a REMOVAL
 *     must clean up; none of them is evidence that anything reads the field.
 *     A seeded value nothing reads is precisely the shape being hunted.
 *
 * ## Consumers that name the field nowhere
 *
 * A metadata reference is not the only way a field is read, and the first real
 * app to take this rule reported 12 fields that were all on screen or
 * load-bearing. Each path below is read off the SPEC, not off a hand-kept list:
 *
 *   - **The synthesized layout** ({@link deriveFieldGroupLayout}, ADR-0085 §5).
 *     An object's `fieldGroups` plus a field's `group` membership are what the
 *     form, detail, drawer and designer surfaces all render when no `*.page.ts`
 *     names the field. The author DID place the field; the placement is spelled
 *     as a group key, so no `fields: [...]` array anywhere mentions it. The
 *     derivation is the platform's own, so this rule credits exactly what a
 *     renderer draws — including the hidden-field exclusion, which is why a
 *     `hidden` field earns nothing here. Only a KEYED section counts: the
 *     derivation's trailing untitled bucket is the flat fallback that collects
 *     everything the author did NOT place, so crediting it would credit every
 *     visible field on every object and leave the rule judging nothing.
 *   - **A seed's or an import mapping's upsert identity**
 *     ({@link CARRIER_IDENTITY_SEGMENTS}). A carrier root is where written and
 *     carried values live, but `externalId` / `upsertKey` names the column the
 *     loader MATCHES ON — it reads every row's value to decide insert from
 *     update (`SeedSchema.externalId`: "Field (or composite list of fields)
 *     matched for the uniqueness check"). A seeder-only identity column is
 *     therefore consumed BY BEING an identity: it is `hidden` and `readonly`
 *     precisely so no real row can acquire one, and a consumer anywhere else
 *     would defeat it. Nothing here exempts `hidden` as such — a `hidden` field
 *     that no upsert matches on and nothing reads is still reported.
 *   - **A derived inline grid** ({@link creditDerivedInlineGrid},
 *     `deriveInlineGridColumns`). A relationship field that sets `inlineEdit`
 *     with no `inlineColumns`, and a `subforms` entry with no `columns`, both
 *     draw a grid of the child object whose columns are derived from the
 *     child's fields. The derivation is the spec's, and it is the renderer's
 *     rule reproduced exactly, so the rule credits exactly the columns it
 *     returns — the hidden, readonly, system and non-editable fields it leaves
 *     out stay uncredited.
 *   - **That grid's per-row expand form** ({@link creditDerivedRowForm},
 *     `deriveInlineRowFormFields` and `isInlineRowFormOffered`). Each row of
 *     a derived grid can open a full form whose fields are derived by a
 *     broader rule: it keeps the `readonly`, `richtext` and `json` fields the
 *     grid leaves out. Both the fields and the condition the form is offered
 *     under are the spec's; the hidden, system and computed fields stay
 *     uncredited. An authored `formFields` list is read against the child
 *     under the same condition ({@link creditAuthoredRowForm}).
 *
 *     NOT credited: a row form opened with NO field list — an authored grid
 *     (`inlineColumns`, or an entry's authored `columns` and
 *     `relationshipField`) in the `form` factor, with no `formFields`. The
 *     renderer then opens the child's default object form, which draws every
 *     visible field the way the child's own create and edit forms do. No
 *     spec derivation states that form's field set, and this rule counts the
 *     default layout nowhere else (only a KEYED section of
 *     {@link creditFieldGroupLayout} is a site), so whether it counts here is
 *     not decided by this rule.
 *
 * One consumer is the relationship itself: a `lookup` or `master_detail`
 * field that sets `inlineEdit` is the inline grid's join key — the renderer
 * loads the child rows filtered on it and stamps it on every row it saves —
 * so it is read whatever columns the grid draws.
 *
 * A field with at least one behaviour OR display site is consumed and gets no
 * finding — a field that is only drawn is the ordinary state of most fields
 * (`phone` on a contact), not a defect; HotCRM's ledger listed `display-only`
 * rows only under `--all`. The finding carries the two remaining verdicts as
 * data rather than as two rule ids: `carrier-only` (carriers exist, and the
 * finding lists them so the author knows what a removal cleans) and `inert`
 * (no site of any kind). One id, one fix sentence — an author acts the same
 * way on both, and a split would invite reading `carrier-only` as fine.
 *
 * ## An analytics member's column path reads every field on it
 *
 * [#21439] A dataset dimension's or measure's `field` and a cube dimension's or
 * measure's `sql` name a COLUMN, and a column path names more than one field:
 * `account.region.code` reads the `account` lookup on the base object, the
 * `region` lookup on the object it reaches, and `code` on the object the last
 * hop reaches — the field-level read gate in `service-analytics`
 * (`fieldsOfColumnSql`) names exactly those. A text scan sees one dotted
 * token and credits none of them — and on a cube not even a bare column, since
 * a cube names its object in its own `sql`, which {@link contextOf} does not
 * read as an object context. So {@link creditAnalyticsColumns} owns these four
 * slots, bare names included, and the general walk skips them. Each hop is
 * resolved the way the analytics door resolves it, by the resolvers this
 * package already shares: a cube's by `resolveCubeColumn` (its declared join
 * for the hop, else the lookup's `reference`), a dataset's by
 * `resolveFieldPath` (the `reference` its compiler joins through). A path the
 * door reads credits every field on it; a path the door refuses is a carrier
 * for each field it names, and one the graph cannot judge credits the fields
 * it can resolve — {@link creditColumnPath} says which is which.
 *
 * ## Advisory, deliberately — and the boundaries, stated
 *
 * A consumer can legitimately live outside this stack: an API client, a hook
 * body shipped by another package, a Studio-authored view the config never
 * carried. So a zero-consumer field is *suspicious*, never *wrong*, and the
 * ceiling for a static check is a warning (the `validate-nav-access` posture).
 *
 *   - **Roots scanned** are the ones {@link CONSUMER_ROOTS} and
 *     {@link CARRIER_ROOTS} name, on the stack handed to the rule. `test/`
 *     fixtures are NEVER scanned — the rule reads metadata, not a repository —
 *     and a field only a test reads is reported. That boundary is what made
 *     hotcrm#1543 a decision, so it is written here rather than left as lore.
 *   - **A stack that declares no consumer root at all** (objects only, or
 *     objects plus carriers) is skipped entirely: its consumers are declared
 *     elsewhere (a multi-package app's object library), and flagging every
 *     field there says nothing useful — the "empty collection ⇒ don't judge"
 *     gate `validate-nav-access` applies to permissions.
 *   - **Exempt** are fields the platform itself reads without any authored
 *     consumer, each derived from the spec rather than listed by hand: the
 *     registry-injected system columns an author re-declared
 *     ({@link injectedColumnsFor} — `resolveInjectedSystemColumns` in
 *     `@objectstack/spec/data`), the record's title field
 *     ({@link resolveDisplayField} — ADR-0079's `nameField` ladder, read for
 *     every record's display name), and a `master_detail` field (ADR-0035 —
 *     `packages/objectql/src/master-detail.ts` names cascade delete,
 *     `controlled_by_parent` sharing, roll-ups and inline grids as its
 *     readers; the relationship is consumed by being declared).
 *   - **Object extensions** (`objectExtensions`) are not judged: the fields
 *     they add belong to objects this stack does not own.
 *
 * Severity is `warning` and stays so: a refusal would narrow the authorable
 * surface (today-valid metadata would start being refused), which is the
 * maintainer's call, not this rule's.
 */

import {
  deriveFieldGroupLayout,
  deriveInlineGridColumns,
  deriveInlineRowFormFields,
  isInlineRowFormOffered,
  resolveDisplayField,
} from '@objectstack/spec/data';
import type { DisplayNameObjectMeta } from '@objectstack/spec/data';
import { referenceTargetOf } from '@objectstack/spec/data';
import { collectionEntries } from './collection-entries.js';
import {
  indexObjectGraph,
  isUnjudgeable,
  joinablePrefixes,
  recordsOf,
  resolveFieldPath,
  type FieldPathVerdict,
} from './object-graph.js';
import { injectedColumnsFor } from './system-fields.js';
import { resolveCubeColumn } from './validate-dataset-measure-aggregates.js';

export const FIELD_NO_CONSUMERS = 'field-no-consumers';

export type FieldConsumerSeverity = 'warning';

/** Why the field is reported: carriers only, or nothing at all. */
export type FieldConsumerVerdict = 'inert' | 'carrier-only';

export interface FieldConsumerFinding {
  /** Always `warning` — a consumer may live outside the stack (see module note). */
  severity: FieldConsumerSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "crm_product" · field "tax_rate"`. */
  where: string;
  /** Config path of the DECLARATION, e.g. `objects[3].fields.tax_rate` (map shape) or `objects[3].fields[2]` (array shape). */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
  /** The declaring object. */
  object: string;
  /** The field name. */
  field: string;
  /** `carrier-only` when carrier sites exist, `inert` when no site of any kind names the field. */
  verdict: FieldConsumerVerdict;
  /** Config paths of the carrier sites a removal must clean (empty for `inert`). */
  carriers: string[];
  /** The stack roots this verdict was measured over — consumer roots then carrier roots. */
  rootsScanned: readonly string[];
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Roots whose contents can CONSUME a field, walked with an object context.
 * `objects` is here for what an object carries besides its field map —
 * formulas, roll-ups, validations, built-in list views, hooks, actions,
 * indexes, `highlightFields`, `searchableFields`. Order is report order.
 */
export const CONSUMER_ROOTS: readonly string[] = [
  'objects',
  'views',
  'pages',
  'apps',
  'flows',
  'dashboards',
  'reports',
  'datasets',
  'actions',
  'hooks',
  'jobs',
  'emailTemplates',
  'agents',
  'tools',
  'skills',
  'apis',
  'webhooks',
  'sharingRules',
  'analyticsCubes',
];

/**
 * Roots whose contents carry a field without reading it. A locale row is a
 * label for a field, not a consumer of one; a seed VALUE nothing reads is the
 * shape being hunted; an import column and a field-level permission grant are
 * customer-facing surfaces a removal must clean, not evidence of a reader.
 */
export const CARRIER_ROOTS: readonly string[] = ['translations', 'data', 'mappings', 'permissions'];

/**
 * The one thing inside a carrier root that is a READ: the column an upsert
 * MATCHES ON. `externalId` is the canonical spelling on a seed
 * (`SeedSchema.externalId`, "Field (or composite list of fields) matched for
 * the uniqueness check") and `upsertKey` the canonical spelling on an import
 * mapping (`MappingSchema`, which aliases `externalId`/`matchOn`/`key` onto
 * it). Both are already in {@link BEHAVIOUR_SEGMENTS}; a carrier root just
 * never got to ask, because the root decided the bucket first.
 *
 * A seeded VALUE is still a carrier — the loader writes it and nothing reads
 * it back. The identity is the opposite: every replay reads the column on
 * every row to decide insert from update. That is what makes a seeder-only
 * identity column consumed while being invisible: it has exactly one reader,
 * and the reader is the loader.
 */
const CARRIER_IDENTITY_SEGMENTS: ReadonlySet<string> = new Set(['externalId', 'upsertKey']);

/** Roots whose sites are display by default; `BEHAVIOUR_SEGMENTS` earn behaviour back. */
const DISPLAY_ROOTS: ReadonlySet<string> = new Set(['views', 'pages', 'apps']);

/**
 * Leaf keys whose value is prose for a human, not a reference. A field name
 * inside a sentence is not a read; it is recorded as a carrier so the finding
 * can list the sentence a removal has to rewrite.
 */
const PROSE_KEYS: ReadonlySet<string> = new Set([
  'label', 'pluralLabel', 'description', 'message', 'successMessage', 'errorMessage',
  'title', 'placeholder', 'helpText', 'emptyText', 'tooltip', 'subtitle',
]);

/** Inside a display root (and everywhere else), these path segments make a site behavioural. */
const BEHAVIOUR_SEGMENTS: ReadonlySet<string> = new Set([
  'filter', 'filters', 'runtimeFilter', 'relatedListFilter', 'where', 'criteria', 'conditions',
  'condition', 'defaultFilter', 'userFilters', 'quickFilters', 'filterableFields',
  'sort', 'sortBy', 'defaultSort', 'grouping', 'groupBy', 'groupByField', 'groupField',
  'startField', 'endField', 'dateField', 'startDateField', 'endDateField', 'coverField',
  'titleField', 'colorField', 'latitudeField', 'longitudeField', 'locationField',
  'addressField', 'parentField', 'statusField', 'kanban', 'calendar', 'gantt', 'timeline',
  'map', 'tree', 'rowColor', 'rowTint', 'conditionalFormatting',
  'expression', 'formula', 'visibleWhen', 'readonlyWhen', 'requiredWhen', 'validations',
  'rules', 'summaryOperations', 'dimensions', 'measures', 'handler', 'body', 'script',
  'nameField', 'displayNameField', 'externalId', 'upsertKey',
]);

/** Path segments that make a site presentational when the root is not already a display root. */
const DISPLAY_SEGMENTS: ReadonlySet<string> = new Set([
  'highlightFields', 'searchableFields', 'indexes', 'columns', 'sections', 'groups',
  'hideFields', 'hiddenFields', 'fieldOrder', 'visibleFields', 'labelField', 'displayField',
  'descriptionField', 'tooltipFields', 'fieldGroups', 'recordTypes', 'listViews',
]);

/** Keys whose object VALUE is a predicate map — `{ is_active: true }` spells the field as a KEY. */
const PREDICATE_KEYS: ReadonlySet<string> = new Set([
  'filter', 'filters', 'runtimeFilter', 'relatedListFilter', 'where', 'criteria',
  'defaultFilter', 'conditions',
]);

/**
 * Keys whose object VALUE spells fields as keys it WRITES or CARRIES — a flow's
 * `fields: { added_date: '{NOW()}' }`, a seed row, a permission set's
 * field-level grants. Recorded as carriers, never as reads: a value that
 * automation stamps and nothing ever reads is exactly the inert shape.
 */
const WRITE_KEYS: ReadonlySet<string> = new Set([
  'fields', 'values', 'set', 'record', 'data', 'input', 'defaults', 'records',
]);

/**
 * [#20929] Keys whose array entries are INLINE CHILD COLLECTIONS: each entry
 * names its child object in `childObject` and the child's grid in `columns`.
 * That is a form view's `subforms` (`FormViewSchema.subforms`, on a view
 * container's `form` and on every `formViews` entry) and, since #20928, an
 * `object-master-detail-form` page block's `details`
 * (`ComponentPropsMap['object-master-detail-form']`). On both, `columns` is the
 * same `InlineGridColumnSchema` a relationship field's `inlineColumns` takes,
 * and `amountField` / `relationshipField` / `totalField` mean the same thing.
 *
 * A page's slot map also has a `details` key, whose value is one page
 * component or an array of them. A component carries none of a child entry's
 * keys at its own level (they sit under its `properties`), so reading it as an
 * entry credits nothing and skips nothing.
 *
 * One page block is a single entry rather than a list of them:
 * {@link CHILD_ENTRY_COMPONENT_TYPES}.
 */
const CHILD_COLLECTION_KEYS: ReadonlySet<string> = new Set(['subforms', 'details']);

/**
 * [#20951] Keys of a child collection entry whose value names a field of the
 * CHILD object, read per key against the entry's `childObject`. On a
 * `subforms` entry, `amountField` is "Numeric child column summed for the
 * running total" and `relationshipField` is "FK on the child pointing back to
 * the parent" (`FormViewSchema.subforms`). `totalField` is deliberately absent:
 * it is "Parent field to receive the rolled-up sum", so it stays on the object
 * the enclosing view is bound to, which is the context the walk already
 * carries. The read is per key, never a context switch for the whole entry.
 */
const CHILD_ENTRY_FIELD_KEYS: ReadonlySet<string> = new Set(['amountField', 'relationshipField']);

/**
 * [#21091] The key of a child collection entry whose value LISTS fields of the
 * CHILD object: an `object-master-detail-form` detail entry's `formFields`,
 * "Child field names for the per-row expand form". Read against the entry's
 * `childObject` by {@link creditAuthoredRowForm}, and skipped by the general
 * walk, which would read it against the parent.
 */
const CHILD_ENTRY_FORM_FIELDS_KEY = 'formFields';

/**
 * [#21091] Page component types whose `properties` IS one child collection
 * entry. `record:line_items` (objectui `plugin-form/src/LineItemsPanel.tsx`,
 * read at the `.objectui-sha` pin `31971ff1e28f`) lists the rows of
 * `childObject` whose `relationshipField` holds the record the page is on,
 * draws its authored `columns` over them, sums `amountField` across them and
 * writes the sum to the parent's `totalField` — the keys and meanings of a
 * `subforms` entry, read off the block's raw props.
 *
 * Unlike a `subforms` or `details` entry it derives nothing: with no authored
 * `columns` it draws no column, and it offers no per-row expand form. So it is
 * read as a {@link ChildEntryKind} `panel`: the authored columns and the
 * {@link CHILD_ENTRY_FIELD_KEYS} against the child, nothing derived — and
 * the two keys of {@link PANEL_CHILD_QUERY_KEYS}, walked in the child's
 * context.
 */
const CHILD_ENTRY_COMPONENT_TYPES: ReadonlySet<string> = new Set(['record:line_items']);

/**
 * [#21091] Keys of a `panel` entry that shape the CHILD query, so every field
 * they name is a field of `childObject`. `LineItemsPanel` (at the same pin)
 * converts `sort` (`SortConfig[]`) to the child fetch's order and merges
 * `filter` into its `$filter`, beside the relationship condition. The
 * contract declares `filter` as the ViewFilterRule array
 * (`RecordLineItemsProps`); the panel's lowering also takes the field-keyed
 * map and AST forms, and this rule reads whichever is authored. The general
 * walk reads them as it reads any sort or filter — behaviour sites, a
 * predicate map's keys included — but with `childObject` as the context
 * instead of the page's object, which is the parent here.
 */
const PANEL_CHILD_QUERY_KEYS: ReadonlySet<string> = new Set(['sort', 'filter']);

/**
 * How a child collection entry draws its child: a `collection` (a `subforms`
 * or `details` entry) derives its grid and row form when they are not
 * authored; a `panel` ({@link CHILD_ENTRY_COMPONENT_TYPES}) draws only what
 * is authored.
 */
type ChildEntryKind = 'collection' | 'panel';

/**
 * Keys whose value is a literal from some other vocabulary, never a field
 * name. Without this list `type: 'summary'` on a roll-up reads as a reference
 * to a field named `summary`, and `accept: ['image/png']` as one to `image`.
 * `source` is deliberately ABSENT: it is the text of a CEL envelope
 * (`{ language: 'cel', source: 'record.quantity * record.unit_price' }`), and
 * skipping it read every tagged-template formula as reading nothing.
 *
 * `name` is a literal here and stays one: it is the identity of nearly every
 * record in a stack. The one position where it names a field is an inline
 * grid column, and that position is read on its own, against the child object,
 * by {@link creditInlineGridColumns}, never by dropping `name` from this set.
 */
const LITERAL_KEYS: ReadonlySet<string> = new Set([
  'type', 'reference', 'accept', 'provider', 'dialect', 'operator', 'aggregate', 'mode',
  'severity', 'language', 'surface', 'format', 'icon', 'variant', 'colorVariant', 'align',
  'order', 'defaultValue', 'value', 'sourceFormat', 'transform', 'name', 'id', 'events',
  'locations', 'version', 'width', 'cardSize', 'coverFit', 'env', 'pinned', 'summary',
  'chartType', 'dateGranularity', 'kind', 'template', 'status', 'runAs', 'sharingModel',
  'objectName', 'object', 'targetObject', 'dataset', 'outputVariable', 'triggerType',
  'event', 'currency', 'color', 'size', 'layout', 'function', 'direction', 'model', 'role',
  'method', 'path', 'url', 'key', 'locale', 'namespace', 'engine', 'driver',
]);

/**
 * The shapes a field name takes when it is actually being REFERENCED inside a
 * text blob: `record.x` / `input.x`, a quoted `'x'`, a `{x}` template token, an
 * object-literal key `x:`. A bare word inside a sentence is none of these.
 */
const REFERENCE_SHAPES: readonly RegExp[] = [
  /\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
  /['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g,
  /\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
  /\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g,
];

/**
 * Keys whose string value is an EXPRESSION — a CEL envelope's `source`, a
 * trigger `condition`, a formula — where a bare identifier IS a read
 * (`total_amount >= 5000` in a flow trigger names the field with no `record.`
 * prefix). Under these keys every identifier is a candidate; everywhere else a
 * bare word is prose and only the reference shapes above count.
 */
const EXPRESSION_KEYS: ReadonlySet<string> = new Set([
  'source', 'expression', 'formula', 'condition', 'criteria', 'when', 'visibleWhen',
  'readonlyWhen', 'requiredWhen', 'where', 'predicate', 'script', 'body', 'handler', 'code',
]);

const IDENTIFIER_SHAPE = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;

/** Text blobs above this size are not scanned (a bundled source, not metadata). */
const MAX_TEXT_LENGTH = 200_000;

type SiteKind = 'behaviour' | 'display' | 'carrier';

interface Site {
  root: string;
  path: string;
  kind: SiteKind;
}

/** One declared field, with everything the report needs. */
interface Declared {
  object: string;
  field: string;
  /** Config path of the declaration. */
  path: string;
  exempt: boolean;
}

/** The walk's shared state — built per stack, consulted by every site. */
class ConsumerLedger {
  /** object → declared field names */
  readonly fieldsByObject = new Map<string, Set<string>>();
  /** field name → objects declaring it */
  readonly objectsByField = new Map<string, Set<string>>();
  /** dataset name → the object it reads */
  readonly datasetObject = new Map<string, string>();
  /** object → its declared field map, the shape the spec's derivations read */
  readonly fieldMapByObject = new Map<string, Record<string, AnyRec>>();
  /** `object.field` → sites */
  readonly sites = new Map<string, Site[]>();
  /**
   * [#21439] Config paths of the analytics column slots
   * {@link creditAnalyticsColumns} read. The general walk skips them: one
   * account of a slot, the one that resolves its path.
   */
  readonly analyticsColumns = new Set<string>();
  /** Tokens that looked like a field but resolved to no object — counted, never dropped. */
  unresolved = 0;
  private mentionRe: RegExp | undefined;

  declare(object: string, field: string): void {
    let fields = this.fieldsByObject.get(object);
    if (!fields) this.fieldsByObject.set(object, (fields = new Set()));
    fields.add(field);
    let owners = this.objectsByField.get(field);
    if (!owners) this.objectsByField.set(field, (owners = new Set()));
    owners.add(object);
  }

  declares(object: string | undefined, field: string): object is string {
    return object !== undefined && (this.fieldsByObject.get(object)?.has(field) ?? false);
  }

  isObject(v: unknown): v is string {
    return typeof v === 'string' && this.fieldsByObject.has(v);
  }

  record(object: string, field: string, site: Site): void {
    const key = `${object}.${field}`;
    const list = this.sites.get(key);
    if (list) list.push(site);
    else this.sites.set(key, [site]);
  }

  /** Every mention of a declared object in a blob, with the index the mention ENDS at. */
  mentionsIn(text: string): { end: number; object: string }[] {
    if (!this.mentionRe) {
      const names = [...this.fieldsByObject.keys()]
        .sort((a, b) => b.length - a.length)
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      this.mentionRe = names.length > 0 ? new RegExp(`\\b(?:${names.join('|')})\\b`, 'g') : /(?!)/g;
    }
    const out: { end: number; object: string }[] = [];
    for (const m of text.matchAll(this.mentionRe)) {
      out.push({ end: (m.index ?? 0) + m[0].length, object: m[0] });
    }
    return out;
  }
}

function bucketFor(root: string, segments: readonly string[], leafKey: string): SiteKind {
  // An upsert identity inside a carrier root is the one read there: the loader
  // matches rows on that column. Everything else a carrier root holds is a
  // value it writes or a label it carries.
  if (CARRIER_ROOTS.includes(root)) {
    return segments.some((s) => CARRIER_IDENTITY_SEGMENTS.has(s)) ? 'behaviour' : 'carrier';
  }
  if (PROSE_KEYS.has(leafKey)) return 'carrier';
  if (segments.some((s) => BEHAVIOUR_SEGMENTS.has(s))) return 'behaviour';
  if (DISPLAY_ROOTS.has(root)) return 'display';
  if (segments.some((s) => DISPLAY_SEGMENTS.has(s))) return 'display';
  return 'behaviour';
}

/**
 * Scan one text blob for field references. The nearest preceding mention of a
 * declared object and the enclosing declaration's object are both candidates;
 * a token is credited to each candidate that DECLARES it.
 */
function scanText(
  ledger: ConsumerLedger,
  text: string,
  ctx: string | undefined,
  root: string,
  path: string,
  segments: readonly string[],
  leafKey: string,
): void {
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return;
  if (LITERAL_KEYS.has(leafKey)) return;
  const hits: { token: string; at: number }[] = [];
  const trimmed = text.trim();
  if (ledger.objectsByField.has(trimmed)) hits.push({ token: trimmed, at: 0 });
  const shapes = EXPRESSION_KEYS.has(leafKey) ? [...REFERENCE_SHAPES, IDENTIFIER_SHAPE] : REFERENCE_SHAPES;
  for (const shape of shapes) {
    for (const m of text.matchAll(shape)) {
      if (ledger.objectsByField.has(m[1])) {
        hits.push({ token: m[1], at: (m.index ?? 0) + m[0].indexOf(m[1]) });
      }
    }
  }
  if (hits.length === 0) return;
  const mentions = ledger.mentionsIn(text);
  // Prose carries a bare word; an interpolation token inside it (`{record.x}`
  // in a notify message) is read at run time and is a consumer like any other.
  const templateRanges = [...text.matchAll(/\{[^{}]*\}/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const prose = PROSE_KEYS.has(leafKey);
  for (const { token, at } of hits) {
    const templated = templateRanges.some(([from, to]) => at >= from && at < to);
    const kind: SiteKind = prose && !templated ? 'carrier' : bucketFor(root, segments, templated ? '' : leafKey);
    let nearest: string | undefined;
    for (const mention of mentions) {
      if (mention.end <= at) nearest = mention.object;
      else break;
    }
    const candidates = nearest !== undefined && nearest !== ctx ? [nearest, ctx] : [ctx];
    let credited = false;
    for (const candidate of candidates) {
      if (ledger.declares(candidate, token)) {
        ledger.record(candidate, token, { root, path, kind });
        credited = true;
      }
    }
    if (!credited) ledger.unresolved += 1;
  }
}

/**
 * [#20929] Credit the fields an inline grid's columns name, on the CHILD object.
 *
 * A column's `name` is the child field the grid reads and writes on every row
 * (`InlineGridColumnSchema.name`), and the recommended entry is identity-only
 * (`{ name: 'quantity' }`), so the name is often all a column says. The
 * general walk skips `name` as a {@link LITERAL_KEYS} literal, which made every
 * field a grid draws read as inert. This is the one position where `name` is
 * read as a reference, and only against the child object its carrier resolves:
 *
 *   - a relationship field's `inlineColumns`: the field sits ON the child and
 *     its `reference` names the PARENT, whose form draws the grid. So the child
 *     is the object that DECLARES the field, not the related one. objectui's
 *     `attachInlineSubforms` builds `{ childObject: <declaring object>,
 *     columns: inlineColumns }`, and `collectHydratedInlineColumnErrors` in
 *     `stack.zod.ts` resolves the carrier the same way.
 *   - a child collection's `columns` ({@link CHILD_COLLECTION_KEYS}): the child
 *     is the entry's `childObject`. The object the enclosing view is bound to
 *     is the parent, so the context the walk carries is the wrong one here.
 *
 * A name the child does not declare is counted unresolved, like every other
 * token that looks like a field and lands on no object.
 */
function creditInlineGridColumns(
  ledger: ConsumerLedger,
  columns: unknown,
  childObject: string | undefined,
  kind: SiteKind,
  root: string,
  columnsPath: string,
): void {
  if (!Array.isArray(columns)) return;
  columns.forEach((column: unknown, i: number) => {
    const field = isRec(column) ? strName(column.name) : undefined;
    if (field === undefined || !ledger.objectsByField.has(field)) return;
    if (ledger.declares(childObject, field)) {
      ledger.record(childObject, field, { root, path: `${columnsPath}[${i}].name`, kind });
    } else {
      ledger.unresolved += 1;
    }
  });
}

/**
 * Whether a carrier's authored columns are the grid's columns. The renderer
 * draws an authored list only when it has at least one entry; an absent or
 * empty list is derived from the child object instead.
 */
function hasAuthoredColumns(columns: unknown): boolean {
  return Array.isArray(columns) && columns.length > 0;
}

/**
 * [#20951] Credit the fields a DERIVED inline grid draws, on the child object.
 *
 * An inline grid with no authored columns still draws columns: the ones
 * `deriveInlineGridColumns` (`@objectstack/spec/data`) derives from the child
 * object's declared fields. That function is the platform's own rule — the
 * renderer's column derivation, reproduced exactly — so this credits exactly
 * what it returns, the way
 * {@link creditFieldGroupLayout} credits `deriveFieldGroupLayout`. A column the
 * budget marks `defaultHidden` is credited too: it is collapsed into the
 * grid's column chooser, never dropped.
 *
 * `relationshipField` is the child's field back to the parent, which the grid
 * fills in and does not draw. A `subforms` entry that names none leaves the
 * renderer to detect it; this rule does not carry a second copy of that
 * detection, so the derived list it credits includes the relationship field.
 * That relationship is read either way: it is the key the child rows are
 * loaded and saved by.
 *
 * [#21091] The same grid offers each row a full expand form, credited here
 * too when `rowForm` is set — see {@link creditDerivedRowForm}.
 */
function creditDerivedInlineGrid(
  ledger: ConsumerLedger,
  childObject: string | undefined,
  relationshipField: string | undefined,
  rowForm: { inlineMode: 'grid' | 'form' | undefined } | undefined,
  root: string,
  path: string,
): void {
  const fields = childObject === undefined ? undefined : ledger.fieldMapByObject.get(childObject);
  if (childObject === undefined || fields === undefined) return;
  const columns = deriveInlineGridColumns({ fields }, { relationshipField });
  for (const { name } of columns) {
    if (ledger.declares(childObject, name)) ledger.record(childObject, name, { root, path, kind: 'display' });
  }
  if (rowForm === undefined) return;
  creditDerivedRowForm(ledger, childObject, fields, relationshipField, rowForm.inlineMode, columns, root, path);
}

/**
 * [#21091] An inline collection's form factor when it is DECLARED — `grid` or
 * `form`, the values `inlineEdit` and a detail entry's `inlineMode` both name.
 * Anything else (`true`, absent) leaves it to the renderer to resolve, which
 * this rule does not reproduce: `undefined`.
 */
function formFactorOf(v: unknown): 'grid' | 'form' | undefined {
  return v === 'grid' || v === 'form' ? v : undefined;
}

/**
 * [#21091] Credit the fields a DERIVED per-row expand form draws, on the child.
 *
 * Each row of an inline grid can open a full form whose fields, when nobody
 * listed them, are `deriveInlineRowFormFields` (`@objectstack/spec/data`) —
 * broader than the grid: a `richtext`, `json` or `readonly` field the grid
 * leaves out is drawn there. The renderer offers that form only when
 * `isInlineRowFormOffered` says so, and this rule credits it under the same
 * condition, both read off the spec rather than restated here.
 *
 * The derived grid's columns are a subset of the derived form's fields, so
 * the condition decides nothing the columns had not already credited: a form
 * that is not offered has no field the grid does not draw. That is why an
 * `inlineMode` this rule cannot resolve (the renderer's smart default for
 * `inlineEdit: true`) is passed as `undefined` without changing the verdict.
 */
function creditDerivedRowForm(
  ledger: ConsumerLedger,
  childObject: string,
  fields: Record<string, AnyRec>,
  relationshipField: string | undefined,
  inlineMode: 'grid' | 'form' | undefined,
  columns: readonly unknown[],
  root: string,
  path: string,
): void {
  const formFields = deriveInlineRowFormFields({ fields }, { relationshipField });
  if (!isInlineRowFormOffered({ inlineMode, formFields, columns })) return;
  for (const name of formFields) {
    if (ledger.declares(childObject, name)) ledger.record(childObject, name, { root, path, kind: 'display' });
  }
}

/**
 * [#21091] Credit an AUTHORED `formFields` list of a child collection entry,
 * against the entry's `childObject`.
 *
 * Each name is a child field the per-row expand form draws — when the form is
 * offered, which `isInlineRowFormOffered` decides from the entry's form
 * factor, its form fields and its grid's columns. The renderer resolves an
 * entry one of two ways (objectui `MasterDetailForm.tsx` at the `.objectui-sha`
 * pin `31971ff1e28f`), and the lint feeds the predicate what each one feeds the
 * expand control:
 *
 *   - **Kept as authored** — the entry names BOTH its `relationshipField` and
 *     at least one column. Nothing is derived: the form factor is the
 *     declared `inlineMode`, or none at all, and the grid is the authored
 *     columns. So the predicate decides exactly, and an omitted mode offers
 *     the form only when the list is longer than the grid.
 *   - **Derived** — anything else. A declared `inlineMode` is kept, and an
 *     omitted one is resolved from the relationship's `inlineEdit`, else
 *     from the child's shape — a resolution this rule does not reproduce, so
 *     with an omitted mode the list is credited as drawn. With a declared
 *     mode the predicate decides whenever the grid can be counted: authored
 *     columns, or the derived grid when the entry names its
 *     `relationshipField` (without one the renderer detects the relationship
 *     and leaves it out of the grid, and this rule keeps no copy of that
 *     detection, so the list is credited as drawn).
 *
 * A list the form is never offered for names its fields without drawing
 * them: a carrier a removal must clean, as `inlineColumns` is on a field that
 * does not set `inlineEdit`. A name the child does not declare is counted
 * unresolved.
 */
function creditAuthoredRowForm(
  ledger: ConsumerLedger,
  entry: AnyRec,
  childObject: string | undefined,
  root: string,
  path: string,
): void {
  const formFields = entry[CHILD_ENTRY_FORM_FIELDS_KEY];
  if (!Array.isArray(formFields)) return;
  const inlineMode = formFactorOf(entry.inlineMode);
  const relationshipField = strName(entry.relationshipField);
  const authoredColumns = hasAuthoredColumns(entry.columns);
  const keptAsAuthored = relationshipField !== undefined && authoredColumns;
  const childFields = childObject === undefined ? undefined : ledger.fieldMapByObject.get(childObject);
  const columns = authoredColumns
    ? (entry.columns as unknown[])
    : relationshipField !== undefined && childFields !== undefined
      ? deriveInlineGridColumns({ fields: childFields }, { relationshipField })
      : undefined;
  const decidable = columns !== undefined && (keptAsAuthored || inlineMode !== undefined);
  const offered = !decidable || isInlineRowFormOffered({ inlineMode, formFields, columns });
  formFields.forEach((value: unknown, i: number) => {
    const field = strName(value);
    if (field === undefined || !ledger.objectsByField.has(field)) return;
    if (ledger.declares(childObject, field)) {
      ledger.record(childObject, field, { root, path: `${path}[${i}]`, kind: offered ? 'display' : 'carrier' });
    } else {
      ledger.unresolved += 1;
    }
  });
}

/**
 * [#20951] Credit one {@link CHILD_ENTRY_FIELD_KEYS} value of a child
 * collection entry, against the entry's `childObject`. A name the child does
 * not declare is counted unresolved, like every other field-shaped token that
 * lands on no object.
 */
function creditChildEntryField(
  ledger: ConsumerLedger,
  value: unknown,
  childObject: string | undefined,
  root: string,
  path: string,
  segments: readonly string[],
  key: string,
): void {
  const field = strName(value);
  if (field === undefined || !ledger.objectsByField.has(field)) return;
  if (ledger.declares(childObject, field)) {
    ledger.record(childObject, field, { root, path, kind: bucketFor(root, segments, key) });
  } else {
    ledger.unresolved += 1;
  }
}

/** The object context a record establishes for its own subtree, if any. */
function contextOf(ledger: ConsumerLedger, rec: AnyRec, ctx: string | undefined): string | undefined {
  const named = (v: unknown): string | undefined => (ledger.isObject(v) ? v : undefined);
  const nested = (v: unknown, key: string): string | undefined => (isRec(v) ? named(v[key]) : undefined);
  const list = isRec(rec.list) ? rec.list : undefined;
  const dataset = typeof rec.dataset === 'string' ? ledger.datasetObject.get(rec.dataset) : undefined;
  return (
    named(rec.object) ??
    named(rec.objectName) ??
    named(rec.targetObject) ??
    nested(rec.data, 'object') ??
    nested(rec.config, 'objectName') ??
    nested(rec.config, 'object') ??
    // A `views[]` container names its object only inside `list.data` — without
    // this hoist the FORM section's fields would resolve to nothing.
    (list ? nested(list.data, 'object') : undefined) ??
    named(rec.name) ??
    dataset ??
    // A flow names its object on the TRIGGER node, and its later nodes read
    // `{record.x}` with no object of their own. Per-node `objectName` still
    // wins inside its own subtree.
    (Array.isArray(rec.nodes)
      ? (rec.nodes as unknown[])
          .map((n) => (isRec(n) ? (nested(n.config, 'objectName') ?? nested(n.config, 'object')) : undefined))
          .find((o) => o !== undefined)
      : undefined) ??
    ctx
  );
}

/** Walk any value under a root, carrying the object context down the tree. */
function walk(
  ledger: ConsumerLedger,
  node: unknown,
  ctx: string | undefined,
  root: string,
  path: string,
  segments: readonly string[],
  leafKey: string,
  entryKind?: ChildEntryKind,
): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'function') {
    scanText(ledger, Function.prototype.toString.call(node), ctx, root, path, segments, leafKey);
    return;
  }
  if (typeof node === 'string') {
    // [#21439] An analytics column slot was read whole, path and all.
    if (ledger.analyticsColumns.has(path)) return;
    scanText(ledger, node, ctx, root, path, segments, leafKey);
    return;
  }
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walk(ledger, node[i], ctx, root, `${path}[${i}]`, segments, leafKey);
    return;
  }
  const rec = node as AnyRec;
  const inner = contextOf(ledger, rec, ctx);
  // [#20929] An entry of a child collection: its grid draws `childObject`'s
  // fields, whatever object the enclosing view is bound to.
  const childEntry: ChildEntryKind | undefined = CHILD_COLLECTION_KEYS.has(leafKey) ? 'collection' : entryKind;
  if (childEntry !== undefined) {
    const childObject = strName(rec.childObject);
    creditInlineGridColumns(ledger, rec.columns, childObject, 'display', root, `${path}.columns`);
    // [#20951] With no authored columns, the grid draws the derived ones.
    // [#21091] With no authored `formFields` either, its per-row expand form
    // draws the derived fields; an authored list replaces them. A `panel`
    // derives neither.
    if (childEntry === 'collection' && !hasAuthoredColumns(rec.columns)) {
      const authoredRowForm = Array.isArray(rec[CHILD_ENTRY_FORM_FIELDS_KEY]);
      const rowForm = authoredRowForm ? undefined : { inlineMode: formFactorOf(rec.inlineMode) };
      const relationshipField = strName(rec.relationshipField);
      creditDerivedInlineGrid(ledger, childObject, relationshipField, rowForm, root, `${path}.childObject`);
    }
    // [#21091] An authored row form, read against the child.
    if (childEntry === 'collection') {
      creditAuthoredRowForm(ledger, rec, childObject, root, `${path}.${CHILD_ENTRY_FORM_FIELDS_KEY}`);
    }
    // [#20951] The child-field keys, each read against the child — and only
    // there, which is why the loop below skips them.
    for (const key of CHILD_ENTRY_FIELD_KEYS) {
      creditChildEntryField(ledger, rec[key], childObject, root, `${path}.${key}`, [...segments, key], key);
    }
  }
  for (const [key, value] of Object.entries(rec)) {
    if (childEntry !== undefined && CHILD_ENTRY_FIELD_KEYS.has(key)) continue;
    if (childEntry === 'collection' && key === CHILD_ENTRY_FORM_FIELDS_KEY) continue;
    const childPath = `${path}.${key}`;
    const childSegments = [...segments, key];
    // A predicate map spells the field as its KEY (`{ is_active: true }`); a
    // write/carrier map does too (`fields: { added_date: … }`). Nowhere else is
    // a key a reference — `type`, `name` and `label` are ubiquitous schema
    // keys AND plausible field names.
    if (ledger.objectsByField.has(key) && (PREDICATE_KEYS.has(leafKey) || WRITE_KEYS.has(leafKey))) {
      if (ledger.declares(inner, key)) {
        const kind: SiteKind = WRITE_KEYS.has(leafKey) ? 'carrier' : bucketFor(root, childSegments, leafKey);
        ledger.record(inner, key, { root, path: childPath, kind });
      } else {
        ledger.unresolved += 1;
      }
    }
    // [#21091] A `record:line_items` block's `properties` is a child entry,
    // and that entry's child-query keys name fields of its `childObject`.
    const panel = key === 'properties' && typeof rec.type === 'string' && CHILD_ENTRY_COMPONENT_TYPES.has(rec.type);
    if (childEntry === 'panel' && PANEL_CHILD_QUERY_KEYS.has(key)) {
      walk(ledger, value, strName(rec.childObject), root, childPath, childSegments, key);
      continue;
    }
    // A map KEYED by object name — `translations[].en.objects.crm_x`,
    // `permissions[].objects.crm_x` — names its object in a position no
    // `object:` lookup reaches.
    walk(ledger, value, ledger.isObject(key) ? key : inner, root, childPath, childSegments, key, panel ? 'panel' : undefined);
  }
}

/** The keys of a FIELD declaration that describe the field itself, never a reference to another. */
const FIELD_SELF_KEYS: ReadonlySet<string> = new Set(['name', 'label', 'type', 'reference']);

/**
 * Walk one object's declaration with the object as context: everything it
 * carries besides its field map, then each field's own body (a formula reads
 * OTHER fields; a roll-up reads the CHILD object's; a lookup's `displayField`
 * names a field on the REFERENCED object).
 */
function walkObject(ledger: ConsumerLedger, obj: AnyRec, objectName: string, objPath: string, fieldsPath: string): void {
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'fields' || key === 'name') continue;
    walk(ledger, value, objectName, 'objects', `${objPath}.${key}`, [key], key);
  }
  for (const { rec: field, path: fieldPath } of collectionEntries(obj.fields, fieldsPath)) {
    // [#18550] The target through the ONE arbiter: `strName` answered
    // `undefined` for an unreadable one exactly as it does for an absent one,
    // so the `displayField` consumer edge below was never recorded and the
    // ledger under-reported — a field a lookup DOES display read as unused.
    // Absence still answers `undefined` and records nothing, and an unreadable
    // carrier still REFUSES (`referenceTargetOf` reads it through
    // `referenceCarrierOf` before it judges anything).
    //
    // [#19289] The whole FIELD is passed through and the arbiter is
    // `referenceTargetOf`, ⛔ not `referenceCarrierOf`. There is no type gate
    // here, so a `{ type: 'user', displayField: … }` field reaches this line —
    // and for `user` the carrier is not the target
    // (`IMPLICIT_REFERENCE_TARGETS`: a CONSTANT OF THE TYPE, such metadata
    // "fully specified, not under-specified"). Reading the carrier dropped the
    // edge to `sys_user.<displayField>` wherever `sys_user` is compiled into
    // the linted stack, so a field that column DOES display was reported unused
    // — the same silent under-record #19198 and #19264 repaired elsewhere.
    // The synthesized `{ reference: field.reference }` literal is what made the
    // target question unaskable: it threw `type` away before the arbiter saw it.
    const reference = referenceTargetOf(field);
    const displayField = strName(field.displayField);
    if (reference && displayField && ledger.declares(reference, displayField)) {
      ledger.record(reference, displayField, { root: 'objects', path: `${fieldPath}.displayField`, kind: 'display' });
    }
    // [#20929] The grid's columns name fields of THIS object, the child. The
    // grid exists only where the field sets `inlineEdit`: the spec's help text
    // says `inlineColumns` is "used only when this field sets inlineEdit", and
    // objectui's `attachInlineSubforms` skips the field otherwise. Without it
    // the columns name the field and draw nothing, so they are a carrier a
    // removal must clean, not a consumer.
    creditInlineGridColumns(
      ledger,
      field.inlineColumns,
      objectName,
      field.inlineEdit ? 'display' : 'carrier',
      'objects',
      `${fieldPath}.inlineColumns`,
    );
    // [#20951] With `inlineEdit` and no authored `inlineColumns`, the parent's
    // form still draws a grid of THIS object: the derived columns. The grid
    // exists for a relationship to a parent, which is what objectui's
    // `attachInlineSubforms` requires before it builds one: a `master_detail`
    // or `lookup` field whose target resolves.
    const fieldName = strName(field.name);
    if (
      fieldName !== undefined &&
      field.inlineEdit &&
      (field.type === 'master_detail' || field.type === 'lookup') &&
      !!reference
    ) {
      // [#21091] The relationship itself is the grid's join key: the renderer
      // loads the child rows filtered on it and stamps it on every row it
      // saves. That holds whether the columns are authored or derived, and
      // for a `lookup` as for a `master_detail` — which is exempt anyway.
      ledger.record(objectName, fieldName, { root: 'objects', path: `${fieldPath}.inlineEdit`, kind: 'behaviour' });
      if (!hasAuthoredColumns(field.inlineColumns)) {
        // [#21091] The derived grid's per-row expand form draws more of THIS
        // object. An explicit `grid` / `form` is the form factor; `true` is
        // the renderer's smart default, which this rule does not resolve.
        const rowForm = { inlineMode: formFactorOf(field.inlineEdit) };
        creditDerivedInlineGrid(ledger, objectName, fieldName, rowForm, 'objects', `${fieldPath}.inlineEdit`);
      }
    }
    for (const [key, value] of Object.entries(field)) {
      if (FIELD_SELF_KEYS.has(key) || key === 'displayField') continue;
      walk(ledger, value, objectName, 'objects', `${fieldPath}.${key}`, [key], key);
    }
  }
}

/** The field map the spec helpers read, whatever shape `fields` was authored in. */
function fieldMapOf(fields: readonly { rec: AnyRec; path: string }[]): Record<string, AnyRec> {
  const map: Record<string, AnyRec> = {};
  for (const { rec } of fields) {
    const n = strName(rec.name);
    if (n) map[n] = rec;
  }
  return map;
}

/** Build the display-name meta the spec's ladder reads, whatever shape `fields` was authored in. */
function displayMetaOf(obj: AnyRec, fields: { rec: AnyRec; path: string }[]): DisplayNameObjectMeta {
  return {
    nameField: strName(obj.nameField),
    displayNameField: strName(obj.displayNameField),
    fields: fieldMapOf(fields),
  };
}

/**
 * Credit every field the SYNTHESIZED layout places in a declared group.
 *
 * `deriveFieldGroupLayout` is the platform's own derivation (ADR-0085 §5) — the
 * one implementation every renderer applies — so what it returns is what a form
 * or detail surface draws when no authored page names the field. Running it
 * here rather than re-reading `fieldGroups` by hand is the same discipline the
 * other two exemptions follow: the verdict moves when the renderer moves.
 *
 * Only a KEYED section is a site. The derivation's trailing untitled bucket
 * collects what the author did NOT place — every visible field that named no
 * group, plus, on an object declaring no groups at all, every field there is.
 * Crediting it would hand the display verdict to every visible field in every
 * app and leave this rule able to report `hidden` fields only.
 */
function creditFieldGroupLayout(
  ledger: ConsumerLedger,
  obj: AnyRec,
  objectName: string,
  fields: readonly { rec: AnyRec; path: string }[],
): void {
  const sections = deriveFieldGroupLayout({ fieldGroups: obj.fieldGroups, fields: fieldMapOf(fields) });
  if (sections === null) return;
  const pathOf = new Map<string, string>();
  for (const { rec, path } of fields) {
    const n = strName(rec.name);
    if (n !== undefined) pathOf.set(n, path);
  }
  for (const section of sections) {
    if (section.key === undefined) continue;
    for (const field of section.fields) {
      const path = pathOf.get(field);
      if (path === undefined) continue;
      ledger.record(objectName, field, { root: 'objects', path: `${path}.group`, kind: 'display' });
    }
  }
}

/**
 * [#21439] The two analytics member kinds, on a dataset and on a cube alike.
 * Each names its column in one slot: a dataset member's `field`, a cube
 * member's `sql` — the same value at two depths, since the dataset compiler
 * copies `field` into the `sql` of the cube member it compiles to.
 */
const ANALYTICS_MEMBER_KINDS = ['dimensions', 'measures'] as const;

/** The row wildcard a `count` measure aggregates: it reads no field value. */
const ROW_WILDCARD = '*';

/**
 * [#21439] Credit every field one analytics column path reads.
 *
 * The fields a path reads are the ones the analytics door's field-level read
 * gate names for it (`fieldsOfColumnSql`, `service-analytics`): each hop's
 * relationship field on the object before it, and the column on the object
 * the last hop reaches. Each is the LEAF of one prefix of the path, so
 * `resolve` — the door's own resolution, see {@link creditAnalyticsColumns} —
 * is asked about every prefix: `account`, `account.region`,
 * `account.region.code`. No hop is walked here.
 *
 * How the fields are recorded depends on whether the door reads the path:
 *
 *   - **Read** — every prefix resolves, and on a dataset the relationship
 *     prefix is declared in `include`: each field is a consumer, bucketed as
 *     any dimension or measure is.
 *   - **Refused** — a prefix resolves to nothing the graph declares (a hop
 *     that names no field or a field that is not a relationship, a column
 *     that does not exist), or the dataset's `include` does not declare the
 *     join (`compileDataset` refuses the dataset, `dataset-field-not-included`
 *     reports it). The door reads nothing, so each field the path does name
 *     is a carrier a removal must clean — the rule's word for a site that
 *     names a field and reads it nowhere, as an `inlineColumns` entry with no
 *     `inlineEdit` is — and none is credited as read.
 *   - **Not judgeable** — the graph cannot answer for some prefix (an object
 *     this stack does not define, a hop through an injected column, a
 *     relationship with no target), and none is refused. The fields it does
 *     resolve are credited as read: the door joins through them before it
 *     reaches the part the graph cannot see, and "cannot answer" is never
 *     evidence that nothing reads them.
 *
 * Only fields this stack declares are recorded; an injected column it does
 * not declare is no declaration to judge.
 */
function creditColumnPath(
  ledger: ConsumerLedger,
  column: string,
  resolve: (prefix: string) => FieldPathVerdict | undefined,
  joinDeclared: boolean,
  root: string,
  path: string,
  segments: readonly string[],
  leafKey: string,
): void {
  ledger.analyticsColumns.add(path);
  if (column === ROW_WILDCARD) return;
  const hops = column.split('.');
  const named: { object: string; field: string }[] = [];
  let refused = !joinDeclared;
  for (let i = 1; i <= hops.length; i++) {
    const verdict = resolve(hops.slice(0, i).join('.'));
    if (verdict?.kind === 'ok') named.push({ object: verdict.object, field: verdict.field });
    else if (!isUnjudgeable(verdict)) refused = true;
  }
  const kind: SiteKind = refused ? 'carrier' : bucketFor(root, segments, leafKey);
  for (const { object, field } of named) {
    if (ledger.declares(object, field)) ledger.record(object, field, { root, path, kind });
  }
}

/**
 * [#21439] Credit every field the analytics members of this stack read
 * through their column slots — a dataset dimension's and measure's `field`, a
 * cube dimension's and measure's `sql` — bare names and relationship paths
 * alike, through {@link creditColumnPath}. Each door is read the way it reads
 * the path, with the resolver `validate-dataset-measure-aggregates.ts` already
 * judges the same slots with:
 *
 *   - a **dataset** joins only what its `include` declares (ADR-0021 D-C,
 *     prefixes included — {@link joinablePrefixes}), and its compiler reaches
 *     each hop through the relationship's `reference`: `resolveFieldPath` on
 *     the dataset's `object`;
 *   - a **cube** joins every hop of a member's path, through the join it
 *     declares for that hop, else the relationship's `reference`:
 *     `resolveCubeColumn` on the object its `sql` names.
 *
 * A dataset or cube whose base object this stack does not define with a field
 * map is skipped, as that rule skips it, and its slots stay with the general
 * walk.
 */
function creditAnalyticsColumns(ledger: ConsumerLedger, stack: AnyRec): void {
  const graph = indexObjectGraph(stack);
  for (const { rec: ds, path: dsPath } of collectionEntries(stack.datasets, 'datasets')) {
    const object = strName(ds.object);
    if (!object || !graph.get(object)) continue;
    const joinable = joinablePrefixes(ds.include);
    for (const kind of ANALYTICS_MEMBER_KINDS) {
      for (const { rec: member, path } of collectionEntries(ds[kind], `${dsPath}.${kind}`)) {
        const column = strName(member.field);
        if (column === undefined) continue;
        const cut = column.lastIndexOf('.');
        const joinDeclared = cut < 0 || joinable.has(column.slice(0, cut));
        const resolve = (prefix: string) => resolveFieldPath(graph, object, prefix);
        creditColumnPath(ledger, column, resolve, joinDeclared, 'datasets', `${path}.field`, [kind, 'field'], 'field');
      }
    }
  }
  for (const { rec: cube, path: cubePath } of collectionEntries(stack.analyticsCubes, 'analyticsCubes')) {
    const object = typeof cube.sql === 'string' ? cube.sql.trim() : '';
    if (!object || !graph.get(object)) continue;
    for (const kind of ANALYTICS_MEMBER_KINDS) {
      for (const { rec: member, path } of collectionEntries(cube[kind], `${cubePath}.${kind}`)) {
        const column = strName(member.sql);
        if (column === undefined) continue;
        const resolve = (prefix: string) => resolveCubeColumn(graph, cube, object, prefix);
        creditColumnPath(ledger, column, resolve, true, 'analyticsCubes', `${path}.sql`, [kind, 'sql'], 'sql');
      }
    }
  }
}

function listPaths(paths: readonly string[]): string {
  return paths.join(', ');
}

/**
 * Report every declared field that nothing in the stack reads or displays.
 * Returns findings (empty = clean). Pure; safe on pre- or post-parse stacks.
 */
export function validateFieldConsumers(stack: AnyRec): FieldConsumerFinding[] {
  const findings: FieldConsumerFinding[] = [];
  if (!isRec(stack)) return findings;

  // Consumers declared elsewhere ⇒ nothing to judge here.
  const hasConsumerRoot = CONSUMER_ROOTS.some((root) => root !== 'objects' && recordsOf(stack[root]).length > 0);
  if (!hasConsumerRoot) return findings;

  const ledger = new ConsumerLedger();
  const declared: Declared[] = [];

  const objectEntries = collectionEntries(stack.objects, 'objects');
  for (const { rec: obj, path: objPath } of objectEntries) {
    const objectName = strName(obj.name);
    if (!objectName || !obj.fields || typeof obj.fields !== 'object') continue;
    const fields = collectionEntries(obj.fields, `${objPath}.fields`);
    const injected = injectedColumnsFor(obj);
    const titleField = resolveDisplayField(displayMetaOf(obj, fields));
    creditFieldGroupLayout(ledger, obj, objectName, fields);
    for (const { rec: field, path: fieldPath } of fields) {
      const fieldName = strName(field.name);
      if (!fieldName) continue;
      ledger.declare(objectName, fieldName);
      let fieldMap = ledger.fieldMapByObject.get(objectName);
      if (!fieldMap) ledger.fieldMapByObject.set(objectName, (fieldMap = {}));
      fieldMap[fieldName] = field;
      const exempt = injected.has(fieldName) || fieldName === titleField || field.type === 'master_detail';
      declared.push({ object: objectName, field: fieldName, path: fieldPath, exempt });
    }
  }
  if (declared.length === 0) return findings;

  for (const ds of recordsOf(stack.datasets)) {
    const name = strName(ds.name);
    const object = strName(ds.object);
    if (name && object) ledger.datasetObject.set(name, object);
  }

  // [#21439] Before the general walk, which skips the slots this reads.
  creditAnalyticsColumns(ledger, stack);

  for (const { rec: obj, path: objPath } of objectEntries) {
    const objectName = strName(obj.name);
    if (!objectName || !ledger.fieldsByObject.has(objectName)) continue;
    walkObject(ledger, obj, objectName, objPath, `${objPath}.fields`);
  }
  for (const root of [...CONSUMER_ROOTS, ...CARRIER_ROOTS]) {
    if (root === 'objects') continue;
    walk(ledger, stack[root], undefined, root, root, [], root);
  }

  const rootsScanned: readonly string[] = [...CONSUMER_ROOTS, ...CARRIER_ROOTS];

  for (const { object, field, path, exempt } of declared) {
    if (exempt) continue;
    const sites = ledger.sites.get(`${object}.${field}`) ?? [];
    if (sites.some((s) => s.kind !== 'carrier')) continue;

    const carriers = sites.map((s) => s.path);
    const verdict: FieldConsumerVerdict = carriers.length > 0 ? 'carrier-only' : 'inert';
    const sharedWith = [...(ledger.objectsByField.get(field) ?? [])].filter((o) => o !== object);

    const verdictClause =
      verdict === 'carrier-only'
        ? `Verdict: carrier-only — ${carriers.length} carrier site(s) name it without reading it, and a removal ` +
          `must clean each: ${listPaths(carriers)}.`
        : `Verdict: inert — no site of any kind names it.`;
    const sharedClause =
      sharedWith.length > 0
        ? ` The same name is declared on ${sharedWith.map((o) => `"${o}"`).join(', ')}; verdicts are per ` +
          `object, so a consumer there does not cover this declaration.`
        : '';

    findings.push({
      severity: 'warning',
      rule: FIELD_NO_CONSUMERS,
      where: `object "${object}" · field "${field}"`,
      path,
      message:
        `field "${field}" on object "${object}" is declared but nothing in this stack reads or displays ` +
        `it: no view column, inline grid column, form section, page binding, flow node, dataset or cube ` +
        `member, widget, formula, validation, hook or action names it, no declared field group places it on the ` +
        `synthesized layout, and no ` +
        `seed or import mapping matches on it. A translation label, a seed value, an import-mapping ` +
        `target, a permission grant, a flow that only WRITES it, an \`inlineColumns\` entry on a ` +
        `relationship field that does not set \`inlineEdit\` (no grid is drawn), or a dataset or cube ` +
        `member path the analytics door refuses (a hop or column that does not resolve, or a join the ` +
        `dataset's \`include\` does not declare) is a carrier, not a consumer. ` +
        `${verdictClause}${sharedClause}`,
      hint:
        `Give "${field}" a consumer — a view column, a form section, a page binding, a formula, a ` +
        `validation, a flow node, a dataset dimension, or a \`group\` naming one of this object's ` +
        `declared \`fieldGroups\` so the synthesized layout draws it — or remove the declaration` +
        (carriers.length > 0 ? ` together with its ${carriers.length} carrier site(s) listed above` : '') +
        `. Ignore this if the field is read only by an API client, by a hook or package this stack does not ` +
        `carry, or by a Studio-authored view. Roots scanned: ${CONSUMER_ROOTS.join(', ')} (consumers) · ` +
        `${CARRIER_ROOTS.join(', ')} (carriers); test fixtures are never scanned.`,
      object,
      field,
      verdict,
      carriers,
      rootsScanned,
    });
  }

  return findings;
}
