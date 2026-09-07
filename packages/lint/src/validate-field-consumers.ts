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
 *     hook or action body, a dataset dimension or measure, a widget filter, a
 *     sharing-rule condition.
 *   - **display** — the field is drawn: a view column, a form section, a page
 *     binding, `highlightFields`, `searchableFields`, an index.
 *   - **carrier** — the field is merely carried along: a translation label, a
 *     seed value, an import-mapping column, a field-level permission grant, a
 *     flow's WRITE of the field, prose that names it. These are what a REMOVAL
 *     must clean up; none of them is evidence that anything reads the field.
 *     A seeded value nothing reads is precisely the shape being hunted.
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

import { resolveDisplayField } from '@objectstack/spec/data';
import type { DisplayNameObjectMeta } from '@objectstack/spec/data';
import { collectionEntries } from './collection-entries.js';
import { recordsOf } from './object-graph.js';
import { injectedColumnsFor } from './system-fields.js';

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
 * Keys whose value is a literal from some other vocabulary, never a field
 * name. Without this list `type: 'summary'` on a roll-up reads as a reference
 * to a field named `summary`, and `accept: ['image/png']` as one to `image`.
 * `source` is deliberately ABSENT: it is the text of a CEL envelope
 * (`{ language: 'cel', source: 'record.quantity * record.unit_price' }`), and
 * skipping it read every tagged-template formula as reading nothing.
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
  /** `object.field` → sites */
  readonly sites = new Map<string, Site[]>();
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
  if (CARRIER_ROOTS.includes(root)) return 'carrier';
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
): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'function') {
    scanText(ledger, Function.prototype.toString.call(node), ctx, root, path, segments, leafKey);
    return;
  }
  if (typeof node === 'string') {
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
  for (const [key, value] of Object.entries(rec)) {
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
    // A map KEYED by object name — `translations[].en.objects.crm_x`,
    // `permissions[].objects.crm_x` — names its object in a position no
    // `object:` lookup reaches.
    walk(ledger, value, ledger.isObject(key) ? key : inner, root, childPath, childSegments, key);
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
    const reference = strName(field.reference);
    const displayField = strName(field.displayField);
    if (reference && displayField && ledger.declares(reference, displayField)) {
      ledger.record(reference, displayField, { root: 'objects', path: `${fieldPath}.displayField`, kind: 'display' });
    }
    for (const [key, value] of Object.entries(field)) {
      if (FIELD_SELF_KEYS.has(key) || key === 'displayField') continue;
      walk(ledger, value, objectName, 'objects', `${fieldPath}.${key}`, [key], key);
    }
  }
}

/** Build the display-name meta the spec's ladder reads, whatever shape `fields` was authored in. */
function displayMetaOf(obj: AnyRec, fields: { rec: AnyRec; path: string }[]): DisplayNameObjectMeta {
  const map: Record<string, AnyRec> = {};
  for (const { rec } of fields) {
    const n = strName(rec.name);
    if (n) map[n] = rec;
  }
  return { nameField: strName(obj.nameField), displayNameField: strName(obj.displayNameField), fields: map };
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
    for (const { rec: field, path: fieldPath } of fields) {
      const fieldName = strName(field.name);
      if (!fieldName) continue;
      ledger.declare(objectName, fieldName);
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
        `it: no view column, form section, page binding, flow node, dataset, widget, formula, validation, ` +
        `hook or action names it. A translation label, a seed value, an import mapping, a permission grant ` +
        `or a flow that only WRITES it is a carrier, not a consumer. ${verdictClause}${sharedClause}`,
      hint:
        `Give "${field}" a consumer — a view column, a form section, a page binding, a formula, a ` +
        `validation, a flow node, a dataset dimension — or remove the declaration` +
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
