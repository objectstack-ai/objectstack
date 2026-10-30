/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "What will publishing change?" — the draft changeset, answered before the
 * user commits. Lists every pending ADR-0033 draft grouped by metadata type,
 * and classifies each as NEW (no published version exists — publishing adds
 * it) or UPDATE (a published version exists — publishing overwrites it).
 * Each entry expands into the fields (objects) and top-level keys it adds,
 * changes and removes, lazily fetched on first expand. An entry whose drill-in
 * finds the draft equal to its published version drops the UPDATE mark
 * (objectui#11807): publishing still promotes it, but it changes nothing. What
 * the platform wrote rather than the author — the system columns it provisions,
 * the keys it derives — folds into one collapsed line (objectstack#25890). This
 * is the review surface that turns Publish from a leap of faith into an
 * informed click.
 *
 * Read-only by default: fetches `_drafts` + published lists on open, and
 * never writes. When the caller passes `onPublish`, the panel additionally
 * renders a confirm footer — review-then-publish in one surface — but the
 * publish action itself still belongs to the caller. With a package as well,
 * an added object field the batch door could backfill carries an unchecked
 * "backfill default" choice (objectui#12929); the checked ones ride on the
 * footer's call as the door's `backfill` option.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Equal, FilePlus2, FilePen, Loader2, Rocket, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Checkbox,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '@object-ui/react';
import { readDraftChanges, type DraftChange, type MetadataClient } from '@object-ui/data-objectstack';
// The `/meta` URL-spelling fold (objectstack#7894, objectstack-ai/objectstack#8424), applied once in
// `listPendingDrafts` below.
//
// CORRECTED, and the correction matters more than the number. An earlier
// version of this comment stated that this import puts `@objectstack/spec/shared`
// on the console's EAGER graph, at +213.4 KB minified / +60.1 KB gzipped. The
// attribution is false: that cost was never this import's. Measured by ablation
// on `origin/main` at 0fce2ef81 (2026-08-24) — delete this import, rebuild
// `apps/console`, read the `eagerGzipBytes` in `dist/eager-closure.json` — the
// eager closure moves +285 bytes gzipped, i.e. minifier noise. Read that figure
// as what it is, one tree on one day; the full measurement, with the
// counter-probes that discriminate it, is recorded on objectui#5359.
//
// The MECHANISM is the part that survives the next release. `/shared` is held on
// the eager graph by an edge upstream of this repo: `@objectstack/core`, shipped
// inside `@objectstack/client` and a direct dependency of `apps/console`, has a
// runtime `import { pluralToSingular } from '@objectstack/spec/shared'`. Every
// OTHER importer of `/shared` in objectui's own source is type-only and erased
// at build, so ablating this one still leaves the subpath in the eagerly loaded
// `vendor-objectstack` chunk. Deferring or deleting this import therefore moves
// ~nothing while that edge stands, and the lever lives at the producer — it is
// tracked in objectstack#11503.
//
// Still true, and still why laziness is not the local answer: each published
// spec subpath is a self-contained bundle and nothing tree-shakes it
// (`@objectstack/spec` declares no `sideEffects`), and the console's
// `vendor-objectstack` chunk group claims every `@objectstack/*` module except
// `@objectstack/lint`, that group's chunk being a static import of the app entry
// (objectui#5266). So an `await import()` here would relocate nothing either.
//
// ⛔ Do not "optimize" this into a local copy of the spelling table: a
// spec-named local declaration is what `scripts/check-spec-symbol-derivation.mjs`
// refuses, and a faithful copy is exactly the fork that guard exists to prevent.
import { fetchPendingDrafts } from './usePendingDrafts.js';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { MetadataProtectionFields, stripReadDecorations } from '@objectstack/spec/kernel';
// objectui#12929 — the ONE discriminator of an authored default's shape, the
// same function the batch door's backfill judgement calls. Moves nothing onto
// the eager graph for the reason recorded above (`vendor-objectstack`).
import {
  discriminateDefaultValueShape,
  injectedSystemColumnDefs,
  isInjectedColumnDefinition,
  provisionPrimary,
} from '@objectstack/spec/data';
import { diffFields, readFields } from '../views/metadata-admin/previews/object-fields-io.js';
// objectui#13125 — the Data pillar's rule for a column the platform injected
// and hides (objectui#11780), reused rather than restated. A leaf module with
// no imports, so it adds nothing else to the eager graph described above.
import { isStudioHiddenSystemField } from '../views/studio-design/studioHiddenSystemField.js';
// The live `?surface=` channel, and NOT `useSurfaceDeepLink` beside it: this
// import must stay React-only, because that module reaches `nav-selection.js`
// and through it the App-nav inspector, and this panel sits in the console's
// EAGER graph (see the `@objectstack/spec` note above for what that costs).
import { useSurfaceNavigator } from '../views/studio-design/surfaceDeepLinkChannel.js';
import { lintDraftSecurityPosture, type DraftSecurityProblem } from './securityPostureLint.js';
// objectstack#27835 — a property by its label on the item type's form.
import { formKeyLabel, labelSpellsKey } from './changeKeyLabels.js';

export interface DraftChangeEntry {
  /**
   * The CANONICAL SINGULAR metadata type (objectstack#9180). The `_drafts`
   * feed returns whatever spelling each row was stored under, so the spelling
   * is folded once — at the boundary that builds these entries — and every
   * consumer below (both `/meta` item routes, the grouping, the heading) reads
   * this one value. Nothing downstream ever sees the raw stored spelling.
   */
  type: string;
  name: string;
  packageId: string | null;
  /**
   * The bundle member this draft is, exactly as `_drafts` served it
   * (objectstack#23073): present for a type whose identity is a pair (today
   * only `email_template`, `(name, locale)`), absent otherwise. Every by-name
   * `/meta` read below passes it as `?member=`, so two members of one name are
   * two rows, each with its own reads; an entry without one sends no selector.
   */
  member?: string;
  /**
   * The label this draft's `_drafts` row carries (objectui#11862): the draft
   * body's own label, read off the row (objectstack-ai/objectstack#22200).
   * Absent when the body declares none. The row leads with it and shows the
   * name beneath it; with none, the name alone is the row's text.
   */
  label?: I18nLabel;
  /** `new` = no published version; `update` = overwrites one; undefined = probing. */
  kind?: 'new' | 'update';
}

/** Pending drafts straight from the ADR-0033 `_drafts` endpoint. */
async function listPendingDrafts(packageId?: string | null): Promise<DraftChangeEntry[]> {
  // Shared fetch (objectui#5801); the fold below stays HERE because this module
  // builds `/meta` item URLs from the type.
  const rows = await fetchPendingDrafts(packageId);
  return rows
    .map((d) => ({
      // The one fold, at the one boundary where a stored spelling enters this
      // module: the `/meta` type segment is singular, always (objectstack#9180).
      // Everything below — both `/meta` item routes, the grouping and the
      // heading — reads the folded value, so a route added later has no raw
      // spelling in scope to interpolate.
      //
      // `canonicalMetaUrlType` and not `pluralToSingular`: that map's keys are
      // `defineStack()` collection properties, and `field`, `seed`,
      // `external_catalog` and `translation` are absent from it because none is
      // a stack-level collection. That absence is also how the residue folded
      // here got written — `PUT /meta/fields/…` fell through to the permissive
      // plugin-type path and minted rows under `type='fields'` while
      // `PUT /meta/field/…` was refused (objectstack#7894).
      //
      // Fold, never strip: `capabilities` folds to `capability`, where a
      // `replace(/s$/, '')` emits `capabilitie`. And this is EMIT-side only —
      // residue stored under a plural type stays exactly as it is on the
      // server; nothing here writes, migrates or re-keys anything.
      type: canonicalMetaUrlType(d.type),
      name: d.name,
      packageId: d.packageId,
      ...(d.member ? { member: d.member } : {}),
      ...(d.label !== undefined ? { label: d.label } : {}),
    }));
}

/**
 * A row's identity: type, name AND member (objectstack#23073). Two members of
 * one `email_template` share `type` and `name`, so a `type:name` key made them
 * one React row, one expanded state and one no-change mark. Serialized as a
 * JSON tuple so no name or member spelling can collide with another entry.
 */
function entryKey(entry: Pick<DraftChangeEntry, 'type' | 'name' | 'member'>): string {
  return JSON.stringify([entry.type, entry.name, entry.member ?? null]);
}

/**
 * Names that exist in the PUBLISHED world for a type — the plain (no
 * `preview=draft`) list. One request classifies every draft of that type:
 * a draft whose name is absent here is NEW; present means publish UPDATES it.
 * (A per-item `/published` probe would be O(drafts) requests, and the REST
 * tree has no such sub-route — the generic :name handler answers anything.)
 *
 * A name match says a published version EXISTS, not that the draft differs
 * from it (objectui#11807). Answering that needs both bodies of every entry —
 * two item reads per draft at open, the O(drafts) cost this read avoids — and
 * neither `_drafts` (type, name, scope, package, updatedAt, updatedBy) nor
 * this list can stand in: the list read is projected (doc content slimmed,
 * object fields masked per caller), so two list bodies can compare equal
 * while the documents differ. So an UPDATE that changes nothing is found
 * where both bodies are already read — the entry's drill-in, below.
 */
async function publishedNamesOf(type: string): Promise<Set<string>> {
  // `type` is already the canonical singular — folded in `listPendingDrafts`.
  const res = await fetch(`/api/v1/meta/${encodeURIComponent(type)}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`published list HTTP ${res.status}`);
  const data = (await res.json()) as unknown[] | { items?: unknown[] };
  const list = Array.isArray(data) ? data : data?.items ?? [];
  return new Set(
    (list as Array<{ name?: unknown }>)
      .map((it) => (typeof it?.name === 'string' ? it.name : null))
      .filter((n): n is string => n !== null),
  );
}

/**
 * Some framework reads wrap the body in a `{ type, name, item }` envelope
 * (draft reads do; published reads return the bare body). Unwrap defensively.
 */
/**
 * Take the body out of a `/meta` response, decoration-free (objectui#8181).
 *
 * ⚠️ The strip is not cosmetic here — it is what makes the review diff below
 * TRUE. `computeChangeDetail` compares every top-level key of the published
 * body against the draft body, and the framework decorates the two reads
 * ASYMMETRICALLY: the draft branch stamps `_draft: true` before decorating,
 * the published branch does not. So `_draft` differed on every entry that has
 * a published counterpart, and the sheet listed it as a key this publish
 * changes — a framework-internal key presented to the author as their own
 * edit, on the door where they decide whether to publish. `_diagnostics` rides
 * the same asymmetry whenever the two bodies' read-time verdicts differ.
 *
 * The key list is the spec's (`METADATA_READ_DECORATIONS`), never a local
 * copy. The ADR-0010 protection envelope is deliberately NOT on it, and this
 * body keeps it: the security-posture lint reads these same bodies as served.
 * The review diff leaves the envelope out where it compares, in
 * `computeChangeDetail` (objectui#12594).
 */
function unwrapItem(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const body = p.item && typeof p.item === 'object' ? (p.item as Record<string, unknown>) : p;
  return stripReadDecorations(body) as Record<string, unknown>;
}

async function fetchItemBody(
  type: string,
  name: string,
  opts: { draft?: boolean; packageId?: string | null; member?: string } = {},
): Promise<Record<string, unknown> | null> {
  return (await fetchItemRead(type, name, opts))?.body ?? null;
}

/**
 * The item read {@link fetchItemBody} unwraps, with the `draftChanges` the
 * strict draft read serves beside `item` (objectstack#24298) — `null` when it
 * served none ("not recorded"), and always on the published read.
 */
async function fetchItemRead(
  type: string,
  name: string,
  opts: { draft?: boolean; packageId?: string | null; member?: string } = {},
): Promise<{ body: Record<string, unknown> | null; changes: DraftChange[] | null } | null> {
  // `type` is already the canonical singular — folded in `listPendingDrafts`.
  const params: string[] = [];
  if (opts.draft) params.push('state=draft');
  if (opts.packageId) params.push(`package=${encodeURIComponent(opts.packageId)}`);
  // The by-name doors' bundle-member selector (objectstack `038d4c958`). Sent
  // only for an entry `_drafts` served a member for: the doors refuse it on a
  // type with no members, and refuse a blank one.
  if (opts.member) params.push(`member=${encodeURIComponent(opts.member)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  const res = await fetch(
    `/api/v1/meta/${encodeURIComponent(type)}/${encodeURIComponent(name)}${qs}`,
    { credentials: 'include', headers: { Accept: 'application/json' }, cache: 'no-store' },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  return { body: unwrapItem(payload), changes: opts.draft ? readDraftChanges(payload) : null };
}

/**
 * objectstack#27176 — who of the AI tools drafted part of this item, as the
 * drill-in names them: the AI copilot once, and each MCP client once (by its
 * OAuth client id; a client that registered no name, and an `mcp` write that
 * recorded no client, fold into one unnamed entry). In the order the entries
 * first name them. `studio` and `api` writes are a person's or another
 * caller's, and are not listed: the row's own `updatedBy` already names who.
 */
export type DraftAgentSource = { by: 'copilot' } | { by: 'mcp'; client?: string };

export function draftAgentSources(changes: readonly DraftChange[] | null | undefined): DraftAgentSource[] {
  const out: DraftAgentSource[] = [];
  const seen = new Set<string>();
  for (const change of changes ?? []) {
    if (change.by !== 'copilot' && change.by !== 'mcp') continue;
    const name = change.by === 'mcp' ? change.client?.name : undefined;
    const key = change.by === 'copilot' ? 'copilot' : name ? `mcp:${change.client!.id}` : 'mcp';
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(change.by === 'copilot' ? { by: 'copilot' } : name ? { by: 'mcp', client: name } : { by: 'mcp' });
  }
  return out;
}

export interface EntryChangeDetail {
  /**
   * Field-level diff — present when either side carries a `fields` map. A
   * field the platform injected and hides is never listed (objectui#13125):
   * see {@link computeChangeDetail}.
   */
  fields: {
    added: string[];
    changed: Array<{ name: string; keys: string[] }>;
    removed: string[];
    /**
     * The label of each listed field that declares one (objectui#13125), read
     * off the definition the row describes: the draft's for an added or a
     * changed field, the published one's for a removed field. The row leads
     * with it, as the item row leads with the item's label (objectui#11862).
     * A Map, never a plain object: `__proto__` is a legal field name.
     */
    labels: ReadonlyMap<string, string>;
    /**
     * objectstack#27516 — publishing changes the order of the fields both
     * bodies declare. An `object`'s field order is content (the spec declares
     * it the display order), so a pure reorder publishes a new version; see
     * {@link fieldOrderChanged}.
     */
    reordered: boolean;
  } | null;
  /**
   * Node-level diff of a flow's `nodes` (objectstack#27356): each node is
   * matched by its `id`, named by its `label` when it has one, and a changed
   * node lists the properties that differ (`config` one level down, as
   * `config.KEY`). Present only for a flow whose two bodies key every node by
   * a string `id`; otherwise `nodes` stays a top-level key row.
   */
  nodes: ListEntryDiff | null;
  /**
   * Top-level keys (other than `fields`) whose values differ, split the way the
   * `fields` diff is (objectui#11807): `added` has no published value, `removed`
   * has no draft value, `changed` has both. An absent key and a `null` one read
   * as the same value, as they always have here. A view's body is compared one
   * level down, as `config.KEY` (objectstack#27835): its inspector edits that
   * body, so `config` alone would name every view change the same.
   */
  keys: {
    added: string[];
    changed: string[];
    removed: string[];
  };
  /**
   * objectstack#27835 — the entries of each listed key whose value is a list
   * of named entries (an object's `validations` by `name`, its `fieldGroups`
   * by `key`): the key's row names each entry that publishing adds, changes or
   * removes, by its `label` when it has one, as a flow names its nodes. A Map,
   * keyed by the key as it appears in `keys`. Never read for a flow, whose
   * lists are its nodes above.
   */
  entries: ReadonlyMap<string, ListEntryDiff>;
  /**
   * What publishing installs that the PLATFORM wrote, not the author: the
   * system columns it provisions for the object and the keys it derives
   * (objectstack#25890). Listed once, in a collapsed group of its own, never in
   * `fields` or `keys` above. Field rows sort before key rows; each sorts by
   * name. A generated field's label, when it declares one, is in
   * `fields.labels`.
   */
  generated: Array<{ name: string; kind: 'added' | 'changed' | 'removed'; scope: 'field' | 'key' }>;
  /**
   * True when there is no published body, so publishing ADDS the item
   * (objectstack#25890). Every key it lists is then something the new item
   * includes, not something else that changed, and the drill-in heads them so.
   */
  isNew: boolean;
}

/** Stable equality for metadata values (small JSON — order-sensitive is fine). */
function valueEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * One list entry in the drill-in — a flow node, a validation rule: its
 * identity (`id`, `name` or `key`), and its `label` when it declares one.
 */
export interface ListEntryRow {
  id: string;
  label?: string;
}

/** One flow node in the drill-in (objectstack#27356): a list entry keyed by `id`. */
export type FlowNodeRow = ListEntryRow;

/** A list's entries that publishing adds, changes (with the properties that differ) and removes. */
export interface ListEntryDiff {
  added: ListEntryRow[];
  changed: Array<ListEntryRow & { keys: string[] }>;
  removed: ListEntryRow[];
}

/** True when the detail lists nothing: no field row, no node row, no key row and no generated row. */
function isEmptyChangeDetail(detail: EntryChangeDetail): boolean {
  const { fields, nodes, keys, generated } = detail;
  const fieldRows = fields
    ? fields.added.length + fields.changed.length + fields.removed.length + (fields.reordered ? 1 : 0)
    : 0;
  const nodeRows = nodes ? nodes.added.length + nodes.changed.length + nodes.removed.length : 0;
  return fieldRows + nodeRows + keys.added.length + keys.changed.length + keys.removed.length + generated.length === 0;
}

function isPlainBody(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A list's entries by their identity key `idKey`, or `null` when the value is
 * not a list of entries each keyed by a distinct non-empty string there (the
 * drill-in then compares the list whole). An absent list is an empty one: a
 * new item adds every entry.
 */
function listEntriesById(value: unknown, idKey: string): Map<string, Record<string, unknown>> | null {
  if (value == null) return new Map();
  if (!Array.isArray(value)) return null;
  const out = new Map<string, Record<string, unknown>>();
  for (const entry of value) {
    if (!isPlainBody(entry)) return null;
    const id = entry[idKey];
    if (typeof id !== 'string' || id === '' || out.has(id)) return null;
    out.set(id, entry);
  }
  return out;
}

function listEntryRow(entry: Record<string, unknown>, idKey: string): ListEntryRow {
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';
  return label === '' ? { id: entry[idKey] as string } : { id: entry[idKey] as string, label };
}

/**
 * The properties that differ between two versions of one body — a node, a
 * list entry, a view: its top-level keys, with `config` read one level down
 * (`config.fields`), since nearly every edit in the flow inspector lands there
 * and a view's whole body sits there.
 */
function changedNodeKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (valueEqual(before[k], after[k])) continue;
    const b = before[k];
    const a = after[k];
    if (k === 'config' && (b == null || isPlainBody(b)) && (a == null || isPlainBody(a))) {
      const bc = (b ?? {}) as Record<string, unknown>;
      const ac = (a ?? {}) as Record<string, unknown>;
      for (const ck of [...new Set([...Object.keys(bc), ...Object.keys(ac)])].sort()) {
        if (!valueEqual(bc[ck], ac[ck])) out.push(`config.${ck}`);
      }
      continue;
    }
    out.push(k);
  }
  return out;
}

/**
 * The entry rows of one list, matched by `idKey`, or `null` when either side
 * is not a list keyed by it. Entries sort by id, as field rows sort by name.
 * A flow's nodes (objectstack#27356, by `id`) and an item's named lists
 * (objectstack#27835, by `name` or `key`) both read this one diff.
 */
function diffListEntries(before: unknown, after: unknown, idKey: string): ListEntryDiff | null {
  const pub = listEntriesById(before, idKey);
  const cur = listEntriesById(after, idKey);
  if (!pub || !cur) return null;
  const byId = (x: ListEntryRow, y: ListEntryRow) => x.id.localeCompare(y.id);
  const added: ListEntryRow[] = [];
  const changed: Array<ListEntryRow & { keys: string[] }> = [];
  const removed: ListEntryRow[] = [];
  for (const [id, entry] of cur) {
    const was = pub.get(id);
    if (!was) added.push(listEntryRow(entry, idKey));
    else if (!valueEqual(was, entry)) changed.push({ ...listEntryRow(entry, idKey), keys: changedNodeKeys(was, entry) });
  }
  for (const [id, entry] of pub) if (!cur.has(id)) removed.push(listEntryRow(entry, idKey));
  return { added: added.sort(byId), changed: changed.sort(byId), removed: removed.sort(byId) };
}

/**
 * objectstack#27835 — the keys a list entry can be named by, in the order
 * tried: a validation rule's `name`, a field group's `key`. The first key
 * every entry on both sides carries as a distinct string identifies them;
 * a list none of them identifies stays one key row.
 */
const LIST_ENTRY_IDENTITY_KEYS = ['name', 'key'] as const;

function diffNamedList(before: unknown, after: unknown): ListEntryDiff | null {
  if (!Array.isArray(before) && !Array.isArray(after)) return null;
  for (const idKey of LIST_ENTRY_IDENTITY_KEYS) {
    const diff = diffListEntries(before, after, idKey);
    if (diff) return diff;
  }
  return null;
}

function listEntryRowCount(diff: ListEntryDiff | null): number {
  return diff ? diff.added.length + diff.changed.length + diff.removed.length : 0;
}

/**
 * Did the platform write this field definition (objectstack#25890)? The spec's own
 * mark: `system: true`, which `FieldSchema` declares as the auto-injected
 * system/audit field and tells tools that surface system fields apart from the
 * author's to branch on. Read as a boolean and nothing else, as the spec
 * declares it.
 */
function isPlatformSystemField(def: Record<string, unknown> | undefined): boolean {
  return def?.system === true;
}

/**
 * Is `body.nameField` the pointer the registry DERIVES, rather than one the
 * author chose (objectstack#25890)? The `/meta` reads replay the registry's
 * materialization seam, which stamps `nameField` through `provisionPrimary` in
 * designate-only mode. The answer is that same function over the body without
 * the pointer — the registry's own write-side test for the same question — so
 * no derivation rule is restated here. A pointer naming any other field is the
 * author's choice and stays an author row; an absent pointer is no stamp.
 */
function isDerivedNameField(body: Record<string, unknown>): boolean {
  const present = body.nameField;
  if (typeof present !== 'string' || present === '') return false;
  const withoutPointer = { ...body };
  delete withoutPointer.nameField;
  return provisionPrimary(withoutPointer, { synthesize: false }).nameField === present;
}

/** Top-level keys whose every present value is platform-derived (objectstack#25890). */
const DERIVED_KEY_TESTS: Readonly<Record<string, (body: Record<string, unknown>) => boolean>> = {
  nameField: isDerivedNameField,
};

/**
 * The ADR-0010 protection envelope (`_lock`, `_packageId`, `_provenance`, …),
 * read off the spec's own declaration so no key list lives here. The review
 * diff compares what the author wrote, and none of these keys is that:
 * `_packageId`, `_packageVersion` and `_provenance` are stamped by the
 * registry, and the `_lock*` family is set only by a code package's loader —
 * the metadata API refuses a save that would set, change or remove a lock
 * (ADR-0010 §3.5). So on a NEW item, whose every key reads as added, the
 * package stamp was listed under "Also changed:" as if the author had typed
 * it (objectui#12594).
 */
const PROTECTION_ENVELOPE_KEYS: readonly string[] = Object.freeze(Object.keys(MetadataProtectionFields));

/** `body` without its top-level protection envelope; a copy, never a mutation. */
function withoutProtectionEnvelope(body: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...body };
  for (const key of PROTECTION_ENVELOPE_KEYS) delete rest[key];
  return rest;
}

/**
 * objectstack#27516 — does publishing `cur` over `pub` change the order of the
 * object's fields? The publish door already says yes: its no-op test compares
 * content hashes under `canonicalize(body, type)` (`@objectstack/metadata-core`),
 * whose `ORDERED_MAPS` table keeps the key order of exactly one map, an
 * `object`'s `fields`, so a pure reorder publishes. That module hashes with
 * `node:crypto` and is not a dependency of this package, so the comparison is
 * restated here for that one row, gated on the same type; a row added to that
 * table owes a row here.
 *
 * The door compares the bodies it STORES, and the `/meta` reads this drill-in
 * diffs add what the write strips again, so those fields are left out on
 * either side before the orders are compared:
 *
 * - a column the platform injects, while its definition is byte-for-byte the
 *   platform's (`isInjectedColumnDefinition` over `injectedSystemColumnDefs`,
 *   `@objectstack/spec/data`): the read puts it ahead of the declared fields
 *   (`applyInjectedSystemColumns`) and the write takes it out
 *   (`stripInjectedSystemColumns`), so its place is never the author's;
 * - a column the platform injects and hides (`isStudioHiddenSystemField`,
 *   the search companion among them), which the registry materializes on read.
 *
 * Only fields both bodies declare are compared: an added or a removed field is
 * already a row of its own.
 */
function fieldOrderChanged(pub: Record<string, unknown>, cur: Record<string, unknown>): boolean {
  const storedOrder = (body: Record<string, unknown>): string[] => {
    const injected = injectedSystemColumnDefs(body);
    return readFields(body.fields)
      .entries.filter(({ name, def }) => {
        if (isStudioHiddenSystemField(def)) return false;
        const platform = Object.prototype.hasOwnProperty.call(injected, name) ? injected[name] : undefined;
        return !(platform && isInjectedColumnDefinition(def, platform));
      })
      .map((e) => e.name);
  };
  const before = storedOrder(pub);
  const after = storedOrder(cur);
  const inBefore = new Set(before);
  const inAfter = new Set(after);
  const kept = after.filter((name) => inBefore.has(name));
  return before.filter((name) => inAfter.has(name)).some((name, i) => name !== kept[i]);
}

/** Each field's definition by name, in either `fields` shape the diff reads. */
function fieldDefsByName(fieldsInput: unknown): Map<string, Record<string, unknown>> {
  return new Map(readFields(fieldsInput).entries.map((e) => [e.name, e.def] as const));
}

/**
 * A field definition's label, as the spec declares it (`label` is a string on
 * a field): anything else, or a blank one, is no label.
 */
function fieldLabelOf(def: Record<string, unknown> | undefined): string | undefined {
  const label = def?.label;
  if (typeof label !== 'string') return undefined;
  const trimmed = label.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * What publishing this draft actually changes, computed client-side from the
 * published body (null when the item is NEW) and the pending draft body.
 * `fields` gets the dedicated designer diff; every other top-level key is
 * compared wholesale — enough to answer "which parts of this item move".
 *
 * Both bodies lose their protection envelope first (above), here and nowhere
 * else, so every list this returns and the no-change mark read the same
 * envelope-free pair.
 *
 * A field row is dropped, here and nowhere else for the same reason, when the
 * platform injected that column and hides it (objectui#13125): every
 * definition of it the two bodies carry has `system: true` and `hidden: true`,
 * the Data pillar's own test (`isStudioHiddenSystemField`, objectui#11780).
 * The `/meta` reads serve an object with the platform's columns already
 * stamped on, so a NEW object's drill-in listed the search companion
 * `__search` as a field the author added. Only that rule drops a row
 * outright.
 *
 * A column the platform injects but does NOT hide — the audit columns,
 * `owner_id` — is a row, but not the author's (objectstack#25890): a field this
 * publish adds or removes whose every definition carries `system: true` moves
 * to `generated`, the collapsed group of what the platform wrote. So does a
 * top-level key whose value is the platform's derivation (`nameField`, see
 * {@link isDerivedNameField}). A system field CHANGED between two bodies stays
 * an author row: the platform injects the same definition on both reads, so a
 * difference there is an edit someone made.
 *
 * Why not `computeDiffRows` from `LayeredDiff.tsx`, which splits top-level keys
 * the same way: that module imports the metadata-admin string table
 * (`./i18n.js`) at module scope, and this panel sits on the console's EAGER
 * graph (`ConsoleLayout` → `DraftPreviewBar` → here). An import would carry
 * the module, and the table with it, onto every page load.
 */
export function computeChangeDetail(
  published: Record<string, unknown> | null,
  draft: Record<string, unknown> | null,
  type?: string,
): EntryChangeDetail {
  const pub = withoutProtectionEnvelope(published ?? {});
  const cur = withoutProtectionEnvelope(draft ?? {});
  let fields: EntryChangeDetail['fields'] = null;
  const generatedFields: EntryChangeDetail['generated'] = [];
  if (pub.fields != null || cur.fields != null) {
    const d = diffFields(pub.fields, cur.fields);
    const pubDefs = fieldDefsByName(pub.fields);
    const curDefs = fieldDefsByName(cur.fields);
    const listed = (name: string): boolean => {
      const defs = [pubDefs.get(name), curDefs.get(name)].filter((def) => def !== undefined);
      return !(defs.length > 0 && defs.every((def) => isStudioHiddenSystemField(def)));
    };
    // objectstack#25890 — added or removed, and the platform's on every side.
    const platformWrote = (name: string): boolean =>
      [pubDefs.get(name), curDefs.get(name)].every((def) => def === undefined || isPlatformSystemField(def));
    const addedAll = Object.values(d.byName)
      .filter((e) => e.status === 'added' && listed(e.name))
      .map((e) => e.name)
      .sort();
    const changed = Object.values(d.byName)
      .filter((e) => e.status === 'changed' && listed(e.name))
      .map((e) => ({ name: e.name, keys: e.changedKeys }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const removedAll = d.removed
      .map((e) => e.name)
      .filter(listed)
      .sort();
    const added = addedAll.filter((name) => !platformWrote(name));
    const removed = removedAll.filter((name) => !platformWrote(name));
    for (const name of addedAll) if (platformWrote(name)) generatedFields.push({ name, kind: 'added', scope: 'field' });
    for (const name of removedAll) {
      if (platformWrote(name)) generatedFields.push({ name, kind: 'removed', scope: 'field' });
    }
    generatedFields.sort((a, b) => a.name.localeCompare(b.name));
    const labels = new Map<string, string>();
    for (const name of [...addedAll, ...changed.map((f) => f.name), ...removedAll]) {
      // The draft's definition where there is one: it is what publishing installs.
      const label = fieldLabelOf(curDefs.get(name) ?? pubDefs.get(name));
      if (label !== undefined) labels.set(name, label);
    }
    // objectstack#27516 — the order the publish door hashes, for an `object` only.
    const reordered = type === 'object' && fieldOrderChanged(pub, cur);
    fields = { added, changed, removed, labels, reordered };
  }
  const isNew = published === null;
  const names = new Set([...Object.keys(pub), ...Object.keys(cur)]);
  names.delete('fields');
  // objectstack#27356 — a flow names the nodes that changed, not "~ nodes".
  // A reorder alone changes no node, so it keeps the key row.
  let nodes: EntryChangeDetail['nodes'] = null;
  if (type === 'flow') {
    nodes = diffListEntries(pub.nodes, cur.nodes, 'id');
    if (listEntryRowCount(nodes) > 0) names.delete('nodes');
  }
  // objectstack#27835 — a view's body sits under `config`, one level down.
  const viewBody =
    type === 'view' && (pub.config == null || isPlainBody(pub.config)) && (cur.config == null || isPlainBody(cur.config));
  const valueAt = (body: Record<string, unknown>, k: string): unknown =>
    viewBody && k.startsWith('config.')
      ? ((body.config ?? {}) as Record<string, unknown>)[k.slice('config.'.length)]
      : body[k];
  if (viewBody) {
    names.delete('config');
    for (const ck of Object.keys((pub.config ?? {}) as Record<string, unknown>)) names.add(`config.${ck}`);
    for (const ck of Object.keys((cur.config ?? {}) as Record<string, unknown>)) names.add(`config.${ck}`);
  }
  const keys: EntryChangeDetail['keys'] = { added: [], changed: [], removed: [] };
  const entries = new Map<string, ListEntryDiff>();
  const generatedKeys: EntryChangeDetail['generated'] = [];
  for (const k of [...names].sort()) {
    const before = valueAt(pub, k);
    const after = valueAt(cur, k);
    if (valueEqual(before, after)) continue;
    const kind = before == null ? 'added' : after == null ? 'removed' : 'changed';
    const derived = Object.prototype.hasOwnProperty.call(DERIVED_KEY_TESTS, k) ? DERIVED_KEY_TESTS[k] : undefined;
    // Derived only when every body that carries the key carries the derivation.
    if (derived && [before == null ? null : pub, after == null ? null : cur].every((b) => b === null || derived(b))) {
      generatedKeys.push({ name: k, kind, scope: 'key' });
      continue;
    }
    keys[kind].push(k);
    const list = type === 'flow' ? null : diffNamedList(before, after);
    if (listEntryRowCount(list) > 0) entries.set(k, list!);
  }
  return { fields, nodes, keys, entries, generated: [...generatedFields, ...generatedKeys], isNew };
}

/**
 * What the footer's Publish hands its host (objectui#12929): the batch door's
 * own options, by reference to `MetadataClient.publishPackageDrafts`, so the
 * sheet can only ask for what that door sends. Today that is the protocol's
 * opt-in `backfill`.
 */
export type DraftPublishOptions = NonNullable<Parameters<MetadataClient['publishPackageDrafts']>[1]>;

/** One field a publish is asked to backfill: `{ object, field }`, the door's element. */
export type DraftBackfillEntry = NonNullable<DraftPublishOptions['backfill']>[number];

/**
 * The field additions of one object draft that the sheet may offer to backfill
 * (objectui#12929), each with the literal its draft declares.
 *
 * The rule is the batch door's own (objectstack#24253), applied to the two
 * bodies the drill-in already read, because the door refuses the WHOLE publish
 * with a 400 for any field it would not honour. So a field is offered only
 * when every condition the door checks holds on the sheet's side too:
 *
 * - the object is already published (`published` is a body): only a published
 *   object has existing records, and only those are written;
 * - the field is one this publish ADDS (`added`, the drill-in's own diff);
 * - the draft declares it in the `fields` map, the one shape the door reads;
 * - it declares a `defaultValue` (absent and `null` are both "none", the
 *   engine's presence rule), and that default is a LITERAL. A runtime token
 *   (`NOW()`, `current_user`) or an expression envelope resolves per insert,
 *   so there is no one value to write into rows other people wrote; the
 *   discriminator is the spec's, never a local copy.
 *
 * The one condition the sheet cannot see is the door's "absent from the object
 * the engine serves" (a draft can name a field the engine injects). That one
 * stays the door's loud refusal, read back through the host's error toast.
 */
export function backfillCandidates(
  published: Record<string, unknown> | null,
  draft: Record<string, unknown> | null,
  added: readonly string[],
): Array<{ field: string; value: unknown }> {
  if (published === null || draft === null) return [];
  const fields = draft.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const out: Array<{ field: string; value: unknown }> = [];
  for (const name of added) {
    if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
    const def = (fields as Record<string, unknown>)[name];
    if (!def || typeof def !== 'object') continue;
    const value = (def as { defaultValue?: unknown }).defaultValue;
    if (value === undefined || value === null) continue;
    if (discriminateDefaultValueShape(value) !== 'literal') continue;
    out.push({ field: name, value });
  }
  return out;
}

type Translate = ReturnType<typeof useObjectTranslation>['t'];

/**
 * objectui#13147 — one summary segment per type group, in the count's form:
 * "1 flow", "2 flows". Each known type is an i18next count family
 * (`preview.changes.typeCount.*`), so every pack picks its own CLDR slot and
 * word order. The keys are spelled out, not built from `type`: a type with no
 * row keeps the raw-name `summaryType` segment rather than a guessed plural.
 *
 * objectui#13221 — each per-type group heading reads the same segment, so a
 * heading and the summary line name a type the same way, in the user's locale.
 */
const TYPE_COUNT: Readonly<Record<string, (t: Translate, count: number) => string>> = {
  object: (t, count) => t('preview.changes.typeCount.object', { count, defaultValue: '{{count}} objects' }),
  view: (t, count) => t('preview.changes.typeCount.view', { count, defaultValue: '{{count}} views' }),
  page: (t, count) => t('preview.changes.typeCount.page', { count, defaultValue: '{{count}} pages' }),
  dashboard: (t, count) => t('preview.changes.typeCount.dashboard', { count, defaultValue: '{{count}} dashboards' }),
  app: (t, count) => t('preview.changes.typeCount.app', { count, defaultValue: '{{count}} apps' }),
  action: (t, count) => t('preview.changes.typeCount.action', { count, defaultValue: '{{count}} actions' }),
  report: (t, count) => t('preview.changes.typeCount.report', { count, defaultValue: '{{count}} reports' }),
  flow: (t, count) => t('preview.changes.typeCount.flow', { count, defaultValue: '{{count}} flows' }),
  permission: (t, count) =>
    t('preview.changes.typeCount.permission', { count, defaultValue: '{{count}} permission sets' }),
  agent: (t, count) => t('preview.changes.typeCount.agent', { count, defaultValue: '{{count}} agents' }),
  email_template: (t, count) =>
    t('preview.changes.typeCount.email_template', { count, defaultValue: '{{count}} email templates' }),
};

function summaryTypeSegment(t: Translate, type: string, count: number): string {
  const counted = Object.prototype.hasOwnProperty.call(TYPE_COUNT, type) ? TYPE_COUNT[type] : undefined;
  return counted
    ? counted(t, count)
    : t('preview.changes.summaryType', { n: count, type, defaultValue: '{{n}} {{type}}' });
}

/** A backfill choice's identity: object and field, as a JSON tuple so no spelling collides. */
function backfillKey(entry: DraftBackfillEntry): string {
  return JSON.stringify([entry.object, entry.field]);
}

/**
 * The sheet's backfill choices, handed to each drill-in (objectui#12929).
 * Present only where the footer publishes a package as one batch: the door
 * that takes `backfill` is the batch door, and nowhere else is there a
 * Publish for the choice to ride on.
 */
interface EntryBackfillControl {
  selected: ReadonlySet<string>;
  onToggle: (entry: DraftBackfillEntry, checked: boolean) => void;
  disabled: boolean;
}

const FIELD_ROW_MARK = { added: '+', changed: '~', removed: '−' } as const;
const FIELD_ROW_TONE = {
  added: 'text-emerald-700 dark:text-emerald-400',
  changed: 'text-amber-700 dark:text-amber-400',
  removed: 'text-red-700 line-through dark:text-red-400',
} as const;

/**
 * One field row of the drill-in (objectui#13125). The field's label leads and
 * its machine name follows as secondary text, the way the item row reads
 * (objectui#11862). With no label, or a label that is the name itself, the name
 * alone is the row's text, in monospace, as before.
 */
function FieldRow({
  kind,
  name,
  label,
  children,
  testId = 'draft-field-row',
}: {
  kind: keyof typeof FIELD_ROW_MARK;
  name: string;
  label: string | undefined;
  children?: ReactNode;
  testId?: string;
}) {
  const lead = label !== undefined && label !== name ? label : undefined;
  return (
    <p
      data-testid={testId}
      className={`${lead === undefined ? 'font-mono ' : ''}text-xs ${FIELD_ROW_TONE[kind]}`}
    >
      {FIELD_ROW_MARK[kind]}{' '}
      {lead === undefined ? (
        name
      ) : (
        <>
          {lead}{' '}
          <span className="font-mono text-[11px] text-muted-foreground">{name}</span>
        </>
      )}
      {children}
    </p>
  );
}

/**
 * One property row of the drill-in (objectstack#27835): the property's label
 * on the item type's form leads ({@link formKeyLabel}), with its key as
 * secondary text when the label does not already spell it. A property the
 * form has no row for reads as its key, in monospace, as before.
 */
function KeyRow({
  kind,
  type,
  name,
  children,
}: {
  kind: keyof typeof FIELD_ROW_MARK;
  type: string;
  name: string;
  children?: ReactNode;
}) {
  const label = formKeyLabel(type, name);
  return (
    <div data-testid="draft-key-row">
      <p className={`${label === undefined ? 'font-mono ' : ''}text-xs ${FIELD_ROW_TONE[kind]}`}>
        {FIELD_ROW_MARK[kind]}{' '}
        {label === undefined ? (
          name
        ) : (
          <>
            {label}
            {labelSpellsKey(label, name) ? null : (
              <>
                {' '}
                <span className="font-mono text-[11px] text-muted-foreground">{name}</span>
              </>
            )}
          </>
        )}
      </p>
      {children}
    </div>
  );
}

/**
 * The properties a changed field or list entry lists after its name, each by
 * its label on `type`'s form where the form has a row for it, else its key.
 */
function propertyList(type: string, keys: readonly string[]): string {
  return keys.map((key) => formKeyLabel(type, key) ?? key).join(', ');
}

/**
 * objectstack#27835 — the entries of one listed key, under its row: each by
 * its label, identity beside it, in the shape of the field rows. A changed
 * entry lists what differs by the labels the list's own form row declares for
 * its sub-rows (`fieldGroups` → "Label", "Collapse").
 */
function ListEntryRows({ type, listKey, diff }: { type: string; listKey: string; diff: ListEntryDiff }) {
  const entryKeys = (keys: readonly string[]) =>
    keys.map((key) => formKeyLabel(type, `${listKey}.${key}`) ?? key).join(', ');
  return (
    <div className="ml-3 flex flex-col gap-0.5">
      {diff.added.map((e) => (
        <FieldRow key={`+${e.id}`} kind="added" name={e.id} label={e.label} testId="draft-list-entry-row" />
      ))}
      {diff.changed.map((e) => (
        <FieldRow key={`~${e.id}`} kind="changed" name={e.id} label={e.label} testId="draft-list-entry-row">
          {e.keys.length > 0 && <span className="text-muted-foreground"> · {entryKeys(e.keys)}</span>}
        </FieldRow>
      ))}
      {diff.removed.map((e) => (
        <FieldRow key={`-${e.id}`} kind="removed" name={e.id} label={e.label} testId="draft-list-entry-row" />
      ))}
    </div>
  );
}

/**
 * Lazily-loaded drill-in for one draft entry: published vs draft, rendered as
 * added / changed / removed field rows, then the top-level keys split the same
 * way.
 *
 * `onCompared` reports whether the two bodies compared equal — true only when
 * BOTH reads returned a body and the diff lists nothing (objectui#11807). It is
 * the comparison this drill-in renders, read-decoration strip included, so the
 * row can never call a draft unchanged on any other evidence: a NEW item (no
 * published body) and a draft that is gone (no draft body) are never equal.
 *
 * `backfill` (objectui#12929) adds, under each added field the door would
 * honour ({@link backfillCandidates}), an unchecked "backfill default" choice
 * naming how many records the object holds today. That number is the console's
 * footer probe — the adapter's `find` with `$top: 0`, read as the signed-in
 * caller, the same caller the door writes as — and it is shown only when the
 * answer carries a numeric `total`: with none, the choice names no number
 * rather than a guessed one. What the publish actually wrote is the door's
 * receipt, which the host reports.
 *
 * `classifying` (objectstack-ai/objectstack#25894): the panel's new-vs-update
 * reads are still in flight. A NEW entry has no published body, so its
 * published read is not sent: it could only answer 404, logged as a failed
 * request on the console for every draft-only item. The drill-in waits while
 * the entry is unclassified and the reads are pending; one whose read failed
 * (still unclassified once they settle) is read both ways, as before.
 */
function EntryDetail({
  entry,
  classifying = false,
  onCompared,
  backfill,
}: {
  entry: DraftChangeEntry;
  classifying?: boolean;
  onCompared?: (unchanged: boolean) => void;
  backfill?: EntryBackfillControl;
}) {
  const { t } = useObjectTranslation();
  const [detail, setDetail] = useState<EntryChangeDetail | null>(null);
  const [agents, setAgents] = useState<DraftAgentSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<{ field: string; value: unknown }>>([]);
  const [recordCount, setRecordCount] = useState<number | undefined>(undefined);
  const optionId = useId();
  // The count read keys on primitives (AGENTS.md #10): the adapter is read
  // through a ref, never as an effect dependency.
  const adapter = useAdapter();
  const adapterRef = useRef(adapter);
  useEffect(() => {
    adapterRef.current = adapter;
  });
  // Read through a ref so the load below keys on the entry alone, never on the
  // identity of the callback the panel hands down (AGENTS.md #10). Kept current
  // from an effect, not during render.
  const onComparedRef = useRef(onCompared);
  useEffect(() => {
    onComparedRef.current = onCompared;
  });

  const classifiedNew = entry.kind === 'new';
  const awaitingKind = entry.kind === undefined && classifying;
  useEffect(() => {
    if (awaitingKind) return;
    let cancelled = false;
    (async () => {
      try {
        const [published, draftRead] = await Promise.all([
          // A NEW item has no published body: not asked
          // (objectstack-ai/objectstack#25894). An item the
          // classification could not answer still 404s here when it is new —
          // that's data, not an error.
          classifiedNew
            ? null
            : fetchItemBody(entry.type, entry.name, { packageId: entry.packageId, member: entry.member }),
          fetchItemRead(entry.type, entry.name, {
            draft: true,
            packageId: entry.packageId,
            member: entry.member,
          }),
        ]);
        if (cancelled) return;
        const draft = draftRead?.body ?? null;
        const computed = computeChangeDetail(published, draft, entry.type);
        setAgents(draftAgentSources(draftRead?.changes));
        setDetail(computed);
        // Only an object's added fields can be backfilled (objectui#12929).
        setCandidates(
          entry.type === 'object' ? backfillCandidates(published, draft, computed.fields?.added ?? []) : [],
        );
        onComparedRef.current?.(published !== null && draft !== null && isEmptyChangeDetail(computed));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.type, entry.name, entry.packageId, entry.member, classifiedNew, awaitingKind]);

  // objectui#12929 — how many records the choice would reach: asked once per
  // object, and only where a choice is offered.
  const offersBackfill = backfill !== undefined && candidates.length > 0;
  useEffect(() => {
    const source = adapterRef.current;
    if (!offersBackfill || !source || typeof source.find !== 'function') return;
    let cancelled = false;
    source
      .find(entry.name, { $top: 0 })
      .then((result) => {
        if (!cancelled && typeof result?.total === 'number') setRecordCount(result.total);
      })
      .catch(() => {
        // No count is a choice that names no number, never a failed sheet.
      });
    return () => {
      cancelled = true;
    };
  }, [offersBackfill, entry.name]);

  if (error) {
    return (
      <p className="px-2 py-1 text-xs text-destructive">
        {t('preview.changes.detailLoadFailed', { defaultValue: 'Could not load change detail:' })}{' '}
        {error}
      </p>
    );
  }
  if (!detail) {
    return (
      <p className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('preview.changes.detailLoading', { defaultValue: 'Loading detail…' })}
      </p>
    );
  }

  const { fields, nodes, keys, entries, generated, isNew } = detail;
  const hasKeyRows = keys.added.length > 0 || keys.changed.length > 0 || keys.removed.length > 0;
  // objectstack#27176 — which AI tools drafted part of this item, one line each.
  const agentLines = agents.map((source) => (
    <p
      key={source.by === 'mcp' ? `mcp:${source.client ?? ''}` : 'copilot'}
      className="text-xs text-muted-foreground"
      data-testid="draft-entry-agent"
    >
      {source.by === 'copilot'
        ? t('preview.changes.draftedByCopilot', { defaultValue: 'Includes changes drafted by the AI copilot' })
        : source.client
          ? t('preview.changes.draftedByMcpClient', {
              client: source.client,
              defaultValue: 'Includes changes drafted by the MCP client “{{client}}”',
            })
          : t('preview.changes.draftedByMcp', { defaultValue: 'Includes changes drafted by an MCP client' })}
    </p>
  ));
  if (isEmptyChangeDetail(detail)) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">
        {t('preview.changes.detailNone', {
          defaultValue: 'No differences detected — the draft matches the published version.',
        })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1" data-testid="draft-entry-detail">
      {agentLines}
      {fields?.added.map((name) => {
        const candidate = backfill ? candidates.find((c) => c.field === name) : undefined;
        const choice: DraftBackfillEntry = { object: entry.name, field: name };
        const id = `${optionId}-backfill-${name}`;
        return (
          <div key={`+${name}`}>
            <FieldRow kind="added" name={name} label={fields.labels.get(name)} />
            {backfill && candidate ? (
              // objectui#12929 — unchecked until the author checks it: nothing
              // is backfilled that was not asked for.
              <div className="ml-3 flex items-center gap-1.5 py-0.5" data-testid="draft-backfill-option">
                <Checkbox
                  id={id}
                  className="h-3.5 w-3.5"
                  checked={backfill.selected.has(backfillKey(choice))}
                  disabled={backfill.disabled}
                  onCheckedChange={(checked) => backfill.onToggle(choice, checked === true)}
                />
                <label htmlFor={id} className="cursor-pointer text-xs text-muted-foreground">
                  {recordCount === undefined
                    ? t('preview.changes.backfillOptionNoCount', { defaultValue: 'Backfill default' })
                    : t('preview.changes.backfillOption', {
                        count: recordCount,
                        defaultValue: 'Backfill default ({{count}} existing records)',
                      })}
                </label>
                {/* The literal the door would write, as the draft declares it. */}
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  = {JSON.stringify(candidate.value)}
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
      {fields?.changed.map((f) => (
        <FieldRow key={`~${f.name}`} kind="changed" name={f.name} label={fields.labels.get(f.name)}>
          {f.keys.length > 0 && <span className="text-muted-foreground"> · {propertyList('field', f.keys)}</span>}
        </FieldRow>
      ))}
      {fields?.removed.map((name) => (
        <FieldRow key={`-${name}`} kind="removed" name={name} label={fields.labels.get(name)} />
      ))}
      {fields?.reordered && (
        // objectstack#27516 — a pure reorder publishes a new version, so it is a row.
        <p className={`text-xs ${FIELD_ROW_TONE.changed}`} data-testid="draft-field-order-row">
          {FIELD_ROW_MARK.changed} {t('preview.changes.fieldOrderChanged', { defaultValue: 'Field order changed' })}
        </p>
      )}
      {/* objectstack#27356 — a flow's nodes, each by its label, in the field rows' shape. */}
      {nodes?.added.map((n) => (
        <FieldRow key={`n+${n.id}`} kind="added" name={n.id} label={n.label} testId="draft-node-row" />
      ))}
      {nodes?.changed.map((n) => (
        <FieldRow key={`n~${n.id}`} kind="changed" name={n.id} label={n.label} testId="draft-node-row">
          {n.keys.length > 0 && <span className="text-muted-foreground"> · {n.keys.join(', ')}</span>}
        </FieldRow>
      ))}
      {nodes?.removed.map((n) => (
        <FieldRow key={`n-${n.id}`} kind="removed" name={n.id} label={n.label} testId="draft-node-row" />
      ))}
      {hasKeyRows && (
        <p className="text-xs text-muted-foreground">
          {isNew
            ? // objectstack#25890 — every key of a NEW item is new: what it includes, not what else changed.
              t('preview.changes.detailNewKeys', { defaultValue: 'Includes:' })
            : t('preview.changes.detailChangedKeys', { defaultValue: 'Also changed:' })}
        </p>
      )}
      {(['added', 'changed', 'removed'] as const).flatMap((kind) =>
        keys[kind].map((name) => {
          const list = entries.get(name);
          return (
            <KeyRow key={`k${FIELD_ROW_MARK[kind]}${name}`} kind={kind} type={entry.type} name={name}>
              {list ? <ListEntryRows type={entry.type} listKey={name} diff={list} /> : null}
            </KeyRow>
          );
        }),
      )}
      {generated.length > 0 && <GeneratedGroup rows={generated} labels={fields?.labels} />}
    </div>
  );
}

/**
 * objectstack#25890 — what the platform wrote into this publish, folded into
 * one line: the system columns it provisions and the keys it derives. Collapsed
 * on every open, the confirm posture's too (that posture expands the item rows,
 * not this group); the toggle shows the rows, read-only, in the same shape as
 * the author's.
 */
function GeneratedGroup({
  rows,
  labels,
}: {
  rows: EntryChangeDetail['generated'];
  labels: ReadonlyMap<string, string> | undefined;
}) {
  const { t } = useObjectTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="draft-generated-group">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        data-testid="draft-generated-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {t('preview.changes.generatedGroup', {
          n: rows.length,
          defaultValue: 'Generated by the platform ({{n}})',
        })}
      </button>
      {open && (
        <div className="ml-4 flex flex-col gap-0.5 opacity-80">
          {rows.map((row) =>
            row.scope === 'field' ? (
              <FieldRow key={`g${row.kind}${row.name}`} kind={row.kind} name={row.name} label={labels?.get(row.name)} />
            ) : (
              <p key={`gk${row.kind}${row.name}`} className={`font-mono text-xs ${FIELD_ROW_TONE[row.kind]}`}>
                {FIELD_ROW_MARK[row.kind]} {row.name}
              </p>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export interface DraftChangesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When set, list only pending drafts belonging to this package (Studio is
   * package-scoped), and the confirm note says they publish as one atomic
   * batch. Without one, the note says each draft publishes by itself
   * (objectui#11591).
   */
  packageId?: string | null;
  /**
   * Narrows the listed drafts further, for a host whose scope the `_drafts`
   * query cannot express on its own. Studio's package-less scope passes its
   * own predicate (package-less FLOW drafts, objectui#11553) so the sheet
   * reviews exactly what that scope's Publish ships. Applied to the folded
   * entries, before anything is classified or linted.
   */
  include?: (entry: DraftChangeEntry) => boolean;
  /**
   * When provided, the panel renders a confirm footer whose button invokes
   * this — turning the panel into the review-then-publish step. The caller
   * still owns the actual publish request and closing the panel on success.
   *
   * With a `packageId`, the drill-ins also offer to backfill the default of
   * each added field the batch door would honour (objectui#12929). The button
   * passes the checked ones as `{ backfill }` — the door's own options — and
   * passes NOTHING when none is checked, so the caller's request is the one it
   * sent before.
   */
  onPublish?: (options?: DraftPublishOptions) => void | Promise<void>;
  /** Disables the confirm button and shows a spinner while the caller publishes. */
  publishing?: boolean;
  /**
   * How the sheet opens (objectui#12517). `review` — the default, and what
   * every host but the Studio's Publish gets: rows collapsed, focus on the
   * list. `confirm` — the host's Publish opened it: every row expanded to
   * show what changes, a per-type summary line above the list, and focus on
   * the footer's Publish all once it renders. Read on each open; a posture
   * never changes what the footer button does (objectui#2261: only it
   * publishes).
   */
  posture?: DraftChangesPosture;
  /**
   * objectstack#26730 — the host's note on one entry, shown under its row
   * whether or not the row is expanded: Studio keeps a refused publish's
   * reason here until it is resolved. Rendered by the host, so the reader that
   * words it stays off this panel's eager graph. `null` for an entry with
   * nothing to say.
   */
  renderEntryNote?: (entry: DraftChangeEntry) => ReactNode;
}

export type DraftChangesPosture = 'review' | 'confirm';

export function DraftChangesPanel({
  open,
  onOpenChange,
  packageId,
  include,
  onPublish,
  publishing = false,
  posture = 'review',
  renderEntryNote,
}: DraftChangesPanelProps) {
  const { t, language } = useObjectTranslation();
  const [entries, setEntries] = useState<DraftChangeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The new-vs-update reads of the latest load are in flight
   * (objectstack-ai/objectstack#25894): a drill-in holds its published read
   * until its entry is classified or they settle. Keyed by load generation, so
   * an earlier load settling late does not end a later one's.
   */
  const [classifying, setClassifying] = useState(false);
  const loadGenRef = useRef(0);
  /**
   * Author-time security findings that the publish door would REFUSE
   * (`7a90afdf9`). Surfaced here, next to the button, so the refusal is
   * something the author reads before committing rather than a toast that
   * arrives after the batch has already rolled back.
   */
  const [problems, setProblems] = useState<DraftSecurityProblem[]>([]);
  /**
   * Null wherever no host listens for a surface request — the degradation this
   * panel owes its second home (Home / the draft-preview bar). Never a route
   * string test: reachability is answered by the tree that mounted us.
   */
  const openSurface = useSurfaceNavigator();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /**
   * Entries whose drill-in compared the two bodies equal (objectui#11807): a
   * draft identical to its published version. Learned on expand, where both
   * bodies are read anyway, rather than by reading every body at open.
   */
  const [unchanged, setUnchanged] = useState<ReadonlySet<string>>(new Set());
  /**
   * objectui#12929 — the fields the author checked for a default backfill, in
   * the order checked, keyed by {@link backfillKey}. Empty at every open: a
   * choice is made on the drafts this open reviews, never carried over.
   */
  const [backfill, setBackfill] = useState<ReadonlyMap<string, DraftBackfillEntry>>(new Map());
  const toggleBackfill = useCallback((entry: DraftBackfillEntry, checked: boolean) => {
    setBackfill((prev) => {
      const key = backfillKey(entry);
      if (prev.has(key) === checked) return prev;
      const next = new Map(prev);
      if (checked) next.set(key, entry);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * objectui#12517 — the posture's two openings. Each open starts collapsed;
   * the confirm posture expands every row ONCE, when the list first arrives,
   * so a row the author then collapses stays collapsed while the type reads
   * below re-map the entries. Focus lands on the list at open (the Publish
   * all button does not exist until the list loads) and moves to Publish all
   * on that same arrival — only if the author has not moved it meanwhile.
   * Layout effects, so the frame that first paints the list already paints
   * it expanded: a passive effect let one collapsed frame through first.
   */
  const listRef = useRef<HTMLDivElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const settledRef = useRef(false);
  // The list as it stood when the sheet opened: the previous open's, until
  // this open's load replaces it. Only a list newer than that one settles.
  const entriesAtOpenRef = useRef<DraftChangeEntry[] | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    settledRef.current = false;
    entriesAtOpenRef.current = entries;
    setExpanded(new Set());
    // Keyed on the open transition alone: `entries` is read, not watched.
  }, [open]);
  useLayoutEffect(() => {
    if (!open || settledRef.current || entries === null || entries === entriesAtOpenRef.current) return;
    settledRef.current = true;
    if (posture !== 'confirm') return;
    setExpanded(new Set(entries.map(entryKey)));
    const button = publishRef.current;
    if (button && document.activeElement === listRef.current) button.focus();
  }, [open, posture, entries]);

  const markCompared = (key: string, isUnchanged: boolean) => {
    setUnchanged((prev) => {
      if (prev.has(key) === isUnchanged) return prev;
      const next = new Set(prev);
      if (isUnchanged) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setClassifying(true);
    setEntries(null);
    setError(null);
    setProblems([]);
    setUnchanged(new Set());
    setBackfill(new Map());
    try {
      const listed = await listPendingDrafts(packageId);
      const drafts = include ? listed.filter(include) : listed;
      setEntries(drafts);
      // Mirror the publish door's own security-posture rule over these drafts.
      // Deliberately not awaited with the classification below: a finding is
      // advisory and must never gate the sheet's ability to render, so its
      // failure mode is "no findings", exactly like an unavailable lint.
      void lintDraftSecurityPosture(
        {
          getDraft: (type, name, opts) =>
            fetchItemBody(type, name, {
              draft: true,
              packageId: (opts?.packageId as string | undefined) ?? packageId ?? null,
            }),
        },
        drafts,
      ).then(setProblems, () => setProblems([]));
      // Classify new-vs-update per TYPE: one published-list read covers every
      // draft of that type. A type whose read fails stays unclassified
      // (rendered neutrally) rather than failing the whole panel.
      //
      // A member entry is classified by its OWN published read instead
      // (objectstack#23073): the name list says the NAME is published, which
      // for `email_template` is true as soon as any one language is — so the
      // first `zh-CN` draft of a published `en-US` template read *Update*.
      // Whether this member is published is answered by the by-name door with
      // its `?member=`; nothing here derives a member from the name.
      const memberEntries = drafts.filter((d) => d.member);
      const types = [...new Set(drafts.filter((d) => !d.member).map((d) => d.type))];
      const classifyMembers = memberEntries.map(async (target) => {
        let exists: boolean;
        try {
          exists =
            (await fetchItemBody(target.type, target.name, {
              packageId: target.packageId,
              member: target.member,
            })) !== null;
        } catch {
          return;
        }
        const key = entryKey(target);
        setEntries((prev) =>
          prev
            ? prev.map((entry) =>
                entryKey(entry) === key ? { ...entry, kind: exists ? 'update' : 'new' } : entry,
              )
            : prev,
        );
      });
      await Promise.all([
        ...classifyMembers,
        ...types.map(async (type) => {
          let published: Set<string> | null = null;
          try {
            published = await publishedNamesOf(type);
          } catch {
            return;
          }
          setEntries((prev) =>
            prev
              ? prev.map((entry) =>
                  entry.type === type && !entry.member
                    ? { ...entry, kind: published!.has(entry.name) ? 'update' : 'new' }
                    : entry,
                )
              : prev,
          );
        }),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (loadGenRef.current === gen) setClassifying(false);
    }
  }, [packageId, include]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /**
   * Clear the toast stack when this panel opens (`add10d8f9`).
   *
   * The console mounts its toaster bottom-right (`apps/console/src/App.tsx`)
   * and this sheet is `side="right"` with a `mt-auto` footer, so the stack
   * lands exactly on top of the confirm button: a save toast raised moments
   * earlier on the way here (`对象「…」已存为草稿`, 4s default duration)
   * covered `全部发布` until it timed out, on the author's first trip through
   * Studio.
   *
   * Moving the toaster is NOT the fix, which is why this sits here and not in
   * `ConsoleToaster`: every corner of this console is already occupied — the
   * draft preview bar is `sticky top-0` and carries its own publish actions,
   * `NotificationSnackbar` anchors bottom-centre, the nav rail owns the left
   * edge — so a reposition only moves the same collision onto a different
   * primary control. What is genuinely wrong is the toast's lifetime, not its
   * corner: the author has left the surface that raised it and is now reading
   * a review screen about the very drafts it announced.
   *
   * Keyed on `open` alone (not on `load`, which changes identity with
   * `packageId`) so this fires on the open transition and never mid-session —
   * a toast this panel's OWN publish raises is untouched.
   */
  useEffect(() => {
    if (open) toast.dismiss();
  }, [open]);

  const noChangeText = t('preview.changes.detailNone', {
    defaultValue: 'No differences detected — the draft matches the published version.',
  });

  // objectui#12929 — offered only where the footer publishes one package as a
  // batch: the package-less scope publishes by reference, a door with no
  // `backfill`, and a read-only host has no Publish to carry the choice.
  const backfillControl: EntryBackfillControl | undefined =
    onPublish && packageId
      ? { selected: new Set(backfill.keys()), onToggle: toggleBackfill, disabled: publishing }
      : undefined;

  const byType = new Map<string, DraftChangeEntry[]>();
  for (const entry of entries ?? []) {
    const bucket = byType.get(entry.type) ?? [];
    bucket.push(entry);
    byType.set(entry.type, bucket);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[420px] flex-col sm:max-w-[420px]"
        data-testid="draft-changes-panel"
        data-posture={posture}
        onOpenAutoFocus={(event) => {
          // objectui#12517 — the list, not the first tabbable (the close
          // button): see the posture effect above for where focus goes next.
          event.preventDefault();
          listRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>
            {t('preview.changes.title', { defaultValue: 'Pending changes' })}
          </SheetTitle>
          <SheetDescription>
            {t('preview.changes.description', {
              defaultValue: 'What publishing will change. New items are added; updates overwrite the live version.',
            })}
          </SheetDescription>
        </SheetHeader>
        {posture === 'confirm' && entries && entries.length > 0 && !error ? (
          // objectui#12517 — what the publish carries, counted off the same
          // per-type grouping the headings below read.
          <p data-testid="draft-changes-summary" className="mt-3 px-4 text-xs font-medium text-foreground">
            {[
              t('preview.changes.summaryItems', { count: entries.length, defaultValue: '{{count}} items' }),
              ...[...byType.entries()].map(([type, items]) => summaryTypeSegment(t, type, items.length)),
            ].join(' · ')}
          </p>
        ) : null}
        <div
          ref={listRef}
          tabIndex={-1}
          aria-label={t('preview.changes.title', { defaultValue: 'Pending changes' })}
          data-testid="draft-changes-list"
          className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 outline-none"
        >
          {error ? (
            <p className="text-sm text-destructive">
              {t('preview.changes.loadFailed', { defaultValue: 'Could not load pending changes:' })}{' '}
              {error}
            </p>
          ) : entries === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('preview.changes.loading', { defaultValue: 'Loading pending changes…' })}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('preview.changes.empty', { defaultValue: 'Nothing pending — every draft has been published.' })}
            </p>
          ) : (
            [...byType.entries()].map(([type, items]) => (
              <div key={type}>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {summaryTypeSegment(t, type, items.length)}
                </h4>
                <ul className="flex flex-col gap-1">
                  {items.map((entry) => {
                    const key = entryKey(entry);
                    const isExpanded = expanded.has(key);
                    // objectui#11807 — the drill-in found nothing this publish
                    // changes: not an UPDATE, whatever the name list said.
                    const isUnchanged = unchanged.has(key);
                    // objectui#11862 — the row's label leads, in the console
                    // language, for a NEW row and an UPDATE row alike: the one
                    // `_drafts` serves, so this list never chooses between a
                    // published and a draft label. The name follows as
                    // secondary text, or is the row's text when there is no
                    // label.
                    const labelText = resolveI18nLabel(entry.label, language)?.trim() ?? '';
                    const note = renderEntryNote?.(entry);
                    return (
                      <li key={key} className="rounded-md border text-sm">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(key)}
                          aria-expanded={isExpanded}
                          title={isUnchanged ? noChangeText : undefined}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50"
                          data-testid="draft-entry-toggle"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                          {isUnchanged ? (
                            // Named, not hidden: this glyph is where the row
                            // says why it carries no badge. The drill-in under
                            // it prints the same sentence as text.
                            <Equal
                              role="img"
                              aria-label={noChangeText}
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                          ) : entry.kind === 'new' ? (
                            <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          ) : entry.kind === 'update' ? (
                            <FilePen className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          ) : (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                          )}
                          {labelText ? (
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">{labelText}</span>
                              {labelText !== entry.name ? (
                                <span className="truncate font-mono text-[11px] leading-tight text-muted-foreground">
                                  {entry.name}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
                          )}
                          {entry.member ? (
                            // The member is what tells two rows of one name
                            // apart (objectstack#23073); shown as served.
                            <span
                              className="shrink-0 font-mono text-xs text-muted-foreground"
                              data-testid="draft-entry-member"
                            >
                              {entry.member}
                            </span>
                          ) : null}
                          {!isUnchanged && entry.kind ? (
                            <Badge
                              variant="outline"
                              className={
                                entry.kind === 'new'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                              }
                            >
                              {entry.kind === 'new'
                                ? t('preview.changes.kindNew', { defaultValue: 'New' })
                                : t('preview.changes.kindUpdate', { defaultValue: 'Update' })}
                            </Badge>
                          ) : null}
                        </button>
                        {note ? (
                          <div className="border-t px-2.5 py-2" data-testid="draft-entry-note">
                            {note}
                          </div>
                        ) : null}
                        {isExpanded && (
                          <div className="border-t bg-muted/20">
                            <EntryDetail
                              entry={entry}
                              classifying={classifying}
                              onCompared={(same) => markCompared(key, same)}
                              backfill={backfillControl}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        {problems.length > 0 && !error && (
          <div
            data-testid="draft-security-problems"
            className="mt-auto border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              {t('preview.changes.securityBlockTitle', {
                count: problems.length,
                defaultValue: 'Publishing will be refused — {{count}} item(s) need a decision first',
              })}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {problems.map((p) => (
                <li key={`${p.type}:${p.name}:${p.rule}`} className="text-[11px] leading-5 text-amber-900 dark:text-amber-200">
                  {/* `type/name`, the way the server's own publish refusal names
                      the item (`object/crmext_visit: …`) — and, unlike a bare
                      name, text that cannot collide with the same draft's row in
                      the list above.

                      Clickable ONLY where a host publishes the surface channel,
                      i.e. inside Studio. This sheet is shared with the Home /
                      draft-preview bar, where the designer is not a reachable
                      destination at all: there `openSurface` is null and the
                      name stays the plain prose it has always been, because a
                      link that goes nowhere is worse than the sentence below
                      telling you where to go. */}
                  {openSurface ? (
                    <button
                      type="button"
                      onClick={() => openSurface({ type: p.type, name: p.name })}
                      className="font-mono underline decoration-dotted underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
                    >
                      {p.type}/{p.name}
                    </button>
                  ) : (
                    <span className="font-mono">
                      {p.type}/{p.name}
                    </span>
                  )}{' '}
                  — {p.hint || p.message}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
              {t('preview.changes.securityBlockWhere', {
                defaultValue: 'Fix it on the object under Settings → Record sharing, then publish again.',
              })}
            </p>
          </div>
        )}
        {onPublish && (entries?.length ?? 0) > 0 && !error && (
          <div className="mt-auto flex flex-col gap-2 border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {/* objectui#11591 — the note states what THIS scope's Publish
                  does. Only a package publishes as one atomic batch (`POST
                  /packages/:id/publish-drafts`); with no package there is no
                  batch door, so the caller promotes each draft by itself and a
                  draft that fails stays pending while the others go live. */}
              {packageId
                ? t('preview.changes.confirmNote', {
                    count: entries!.length,
                    defaultValue:
                      'Publishing releases all {{count}} pending drafts of this package atomically.',
                  })
                : t('preview.changes.confirmNoteSeparate', {
                    count: entries!.length,
                    defaultValue:
                      'Publishing releases the {{count}} pending drafts one at a time: a draft that fails stays pending while the others go live.',
                  })}
            </p>
            <Button
              ref={publishRef}
              size="sm"
              // objectui#12929 — the checked backfill choices, or no options at
              // all: an unchecked sheet sends the request it always sent.
              onClick={() =>
                void (backfill.size > 0 ? onPublish({ backfill: [...backfill.values()] }) : onPublish())
              }
              disabled={publishing}
              data-testid="draft-changes-publish"
            >
              {publishing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t('preview.changes.publishConfirm', { defaultValue: 'Publish all' })}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
