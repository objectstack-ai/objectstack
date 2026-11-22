// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] The third layer of an installed object's record-page
 * arrangement: the whole arrangement the base's paired `.custom` package
 * declares, applied by the registry fold (`foldExtendersOntoDefinition`)
 * LAST, after every extension's `place` entries
 * (`applyExtensionPlacements`), so the record page, the forms, the preview
 * and Studio read one result.
 *
 *  1. the owner's arrangement (the object's `fieldGroups` / `relatedLists`);
 *  2. each extension's `place` entries, inserted into it;
 *  3. where the `.custom` extension writes `fieldGroups` or `relatedLists`
 *     (`CUSTOM_ARRANGEMENT_KEYS`), that key REPLACES the result of 1–2,
 *     whole. A key it does not write keeps that result. Nothing is merged
 *     entry by entry.
 *
 * What the replacement leaves to the object's own rules:
 *
 *  - a FIELD no group of the arrangement lists is never dropped: it shows
 *    after the last group (`deriveFieldGroupLayout`'s trailing bucket),
 *    whatever group the owner or another extension had put it in. Replaced
 *    whole means their membership statements are replaced in either
 *    spelling: a group that lists `fields` shows exactly its list, so a
 *    field of theirs that no list names loses a `group` naming such a group
 *    or a group the arrangement does not have, and a listed field's own
 *    `group` is rewritten to the group that lists it. The arrangement's own statements stay the object's rule: a field
 *    the `.custom` extension declares keeps its `group`, and a group that
 *    lists no `fields` keeps the fields whose `group` names it. A `group`
 *    naming a group that now places a body table is taken off. The served
 *    object stays one an object parse accepts;
 *  - a TAB the arrangement does not name is not hidden, the reverse of an
 *    object's own `relatedLists`. Where steps 1–2 gave a declared tab list,
 *    each of its entries no entry of the arrangement covers is carried over,
 *    after the listed ones and before a trailing approvals / activity-stream
 *    run. Where they gave none (the automatic list: every list shows), the
 *    served object says so beside its `relatedLists`
 *    ({@link RelatedListsArrangement}, `unlisted: 'shown'`), because only
 *    the record page knows which lists exist for the reader. The lists the
 *    arrangement hides (`{ list, hidden: true }`) travel the same way: a
 *    served `relatedLists` cannot hide another package's list by leaving it
 *    out.
 *
 * Only a `.custom` package's extension is read (`isCustomizationPackage`,
 * the `__c` judge's predicate). The doors refuse any other writer at publish,
 * `os validate` / `os build` and install; a manifest's body reaches the
 * registry unparsed, so the fold skips such a key too and names it. Where
 * more than one `.custom` package writes a key for one object, the pair of
 * the object's owner is served, else the one folded last, and the others are
 * named.
 *
 * Nothing here is stored: disabling or uninstalling the `.custom` package,
 * or removing the key, leaves its contribution out of the fold, and the
 * result of steps 1–2 is served again.
 */

import {
  extensionArrangementKeys,
  relatedListEntryHidden,
  relatedListEntryName,
  relatedListNameCovers,
} from '@objectstack/spec/data';
import type { CustomArrangementKey, RelatedListsArrangement, ServiceObject } from '@objectstack/spec/data';
import { isCustomizationPackage, isCustomizationPairOf } from '@objectstack/spec/kernel';
import type { ExtensionPlacementNote } from './registry-extension-placement.js';
import type { ObjectContributor } from './registry-top-level.js';

/** The record-page tabs a trailing run of which the carried-over tabs go before. */
const TRAILING_BUILTIN_TABS: ReadonlySet<string> = new Set(['sys_approval_request', 'sys_activity']);

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the fold knows beyond the object itself. */
export interface CustomArrangementContext {
  /** The extended object's name, for the notes. */
  readonly objectName: string;
  /** The package that owns the extended object (`undefined` when it is registered with none). */
  readonly ownerPackageId: string | undefined;
}

/** What {@link applyCustomArrangement} answers. */
export interface CustomArrangementResult {
  /** The object to serve (by reference when no `.custom` arrangement applies). */
  readonly object: ServiceObject;
  /** What was skipped, named once by the fold. */
  readonly notes: ExtensionPlacementNote[];
  /**
   * What the served `relatedLists` cannot say about the `.custom` tab list:
   * the served read's `_relatedListsArrangement` decoration. `undefined` when
   * no `.custom` package arranges the tabs.
   */
  readonly relatedLists: RelatedListsArrangement | undefined;
}

/**
 * The served objects whose tabs a `.custom` package arranges, each with what
 * its `relatedLists` cannot say. Keyed on the served body's identity, so a
 * fold of other contributors (a package's own export layer, a disabled
 * package folded back in) answers for itself, and an entry leaves with the
 * body it describes.
 */
const servedRelatedListsArrangements = new WeakMap<object, RelatedListsArrangement>();

/** Record what a served body's `relatedLists` cannot say. The fold calls it once per body. */
export function rememberRelatedListsArrangement(served: unknown, arrangement: RelatedListsArrangement | undefined): void {
  if (arrangement === undefined || typeof served !== 'object' || served === null) return;
  servedRelatedListsArrangements.set(served, arrangement);
}

/** What a served body's `relatedLists` cannot say, or `undefined` when no `.custom` package arranges its tabs. */
export function relatedListsArrangementOf(served: unknown): RelatedListsArrangement | undefined {
  return typeof served === 'object' && served !== null ? servedRelatedListsArrangements.get(served) : undefined;
}

/** One `.custom` (or refused) writer of an arrangement key. */
interface ArrangementWriter {
  readonly packageId: string | undefined;
  readonly body: AnyRecord;
}

/**
 * [ADR-0146 D10] Apply the paired `.custom` package's arrangement to `object`
 * (the fold's merged body, placements applied). Pure: the caller names the
 * notes and records the tab arrangement.
 */
export function applyCustomArrangement(
  object: ServiceObject,
  contributors: readonly ObjectContributor[],
  context: CustomArrangementContext,
): CustomArrangementResult {
  const notes: ExtensionPlacementNote[] = [];
  const writers = new Map<CustomArrangementKey, ArrangementWriter[]>();
  for (const contributor of contributors) {
    if (contributor.ownership !== 'extend') continue;
    const body = contributor.definition as unknown;
    if (!isRecord(body)) continue;
    for (const key of extensionArrangementKeys(body)) {
      const list = writers.get(key) ?? [];
      list.push({ packageId: contributor.packageId, body });
      writers.set(key, list);
    }
  }
  if (writers.size === 0) return { object, notes, relatedLists: undefined };

  const objectName = context.objectName;
  const from = (packageId: string | undefined): string => (packageId ? ` from package "${packageId}"` : '');
  const note = (writer: ArrangementWriter, key: CustomArrangementKey, message: string): void => {
    const text = `[Registry] An extension of object "${objectName}"${from(writer.packageId)} ${message}`;
    notes.push({ key: `arrangement|${key}|${text}`, packageId: writer.packageId, message: text });
  };

  /** The one writer of `key` the fold serves, the others named. */
  const servedWriter = (key: CustomArrangementKey): ArrangementWriter | undefined => {
    const admitted: ArrangementWriter[] = [];
    for (const writer of writers.get(key) ?? []) {
      if (!isCustomizationPackage(writer.packageId)) {
        note(writer, key,
          `declares \`${key}\`, which is not applied: only the object extension of a base's paired \`.custom\` ` +
          'package declares the whole arrangement of an object. An extension places the fields, groups and ' +
          'child lists it brings with `place`.');
        continue;
      }
      if (!Array.isArray(writer.body[key])) {
        note(writer, key, `declares \`${key}\` that is not a list, so it is not applied.`);
        continue;
      }
      admitted.push(writer);
    }
    if (admitted.length === 0) return undefined;
    const served = admitted.find((writer) => isCustomizationPairOf(writer.packageId, context.ownerPackageId))
      ?? admitted[admitted.length - 1];
    for (const writer of admitted) {
      if (writer === served) continue;
      note(writer, key,
        `declares \`${key}\`, which is not applied: package "${served.packageId}" declares it for this object ` +
        'too, and one arrangement is served. Keep it in one package.');
    }
    return served;
  };

  const record = object as unknown as AnyRecord;
  const out: AnyRecord = { ...record };
  let changed = false;
  let relatedLists: RelatedListsArrangement | undefined;

  // ── fieldGroups ─────────────────────────────────────────────────────────
  const groupsWriter = servedWriter('fieldGroups');
  if (groupsWriter !== undefined) {
    const groups = (groupsWriter.body.fieldGroups as unknown[]).filter(isRecord).map((group) => ({ ...group }));
    out.fieldGroups = groups;
    changed = true;
    // Replaced whole means the membership the owner and the other extensions
    // stated is replaced too, in either spelling. A group that lists `fields`
    // shows exactly its list: a listed field's own `group` follows the group
    // that lists it, and a field of the object or of another extension that
    // no list names loses a `group` naming a listing group, or a group the
    // arrangement does not have (a placement's `group` names the owner's
    // group, which is gone with the owner's list), so it shows after the
    // last group. The arrangement's own statements stay: a field this
    // extension declares keeps its `group`, and a group that lists no
    // `fields` keeps the fields whose `group` names it. No field names a
    // group that places a body table (a refusal on an object parse).
    const listedIn = new Map<string, string>();
    const groupKeys = new Set<string>();
    const listingGroups = new Set<string>();
    const tableGroups = new Set<string>();
    for (const group of groups) {
      if (typeof group.key !== 'string') continue;
      groupKeys.add(group.key);
      if (typeof group.relatedList === 'string') {
        tableGroups.add(group.key);
        continue;
      }
      if (!Array.isArray(group.fields)) continue;
      listingGroups.add(group.key);
      for (const name of group.fields) {
        if (typeof name === 'string' && !listedIn.has(name)) listedIn.set(name, group.key);
      }
    }
    const declaredHere = isRecord(groupsWriter.body.fields) ? groupsWriter.body.fields : {};
    if (isRecord(record.fields)) {
      let fields: AnyRecord | undefined;
      for (const [name, field] of Object.entries(record.fields)) {
        if (!isRecord(field) || typeof field.group !== 'string') continue;
        const listing = listedIn.get(name);
        if (listing !== undefined) {
          if (field.group !== listing) fields = { ...(fields ?? record.fields), [name]: { ...field, group: listing } };
          continue;
        }
        const own = Object.prototype.hasOwnProperty.call(declaredHere, name);
        const replaced = !groupKeys.has(field.group) || listingGroups.has(field.group);
        if (tableGroups.has(field.group) || (replaced && !own)) {
          const { group: _replaced, ...rest } = field;
          fields = { ...(fields ?? record.fields), [name]: rest };
        }
      }
      if (fields !== undefined) out.fields = fields;
    }
  }

  // ── relatedLists ────────────────────────────────────────────────────────
  const tabsWriter = servedWriter('relatedLists');
  if (tabsWriter !== undefined && typeof tabsWriter.packageId === 'string') {
    const declared = tabsWriter.body.relatedLists as unknown[];
    const shown: unknown[] = [];
    const hidden: string[] = [];
    const named: string[] = [];
    for (const entry of declared) {
      const name = relatedListEntryName(entry);
      if (name === undefined || name === '') continue;
      named.push(name);
      if (relatedListEntryHidden(entry)) {
        if (!hidden.includes(name)) hidden.push(name);
        continue;
      }
      if (isRecord(entry)) {
        // `hidden: false` says nothing the served entry needs; an entry left
        // with its name alone is the bare name.
        const { hidden: _shown, ...rest } = entry;
        shown.push(Object.keys(rest).length === 1 ? name : rest);
      } else {
        shown.push(entry);
      }
    }
    // The tab list steps 1–2 gave: declared (non-empty), or the automatic one.
    const before = Array.isArray(record.relatedLists) ? record.relatedLists : [];
    const carried = before.filter((entry) => {
      const name = relatedListEntryName(entry);
      return name !== undefined && name !== '' && !named.some((written) => relatedListNameCovers(written, name));
    });
    let end = shown.length;
    while (end > 0 && TRAILING_BUILTIN_TABS.has(relatedListEntryName(shown[end - 1]) ?? '')) end -= 1;
    out.relatedLists = [...shown.slice(0, end), ...carried, ...shown.slice(end)];
    changed = true;
    relatedLists = {
      packageId: tabsWriter.packageId,
      hidden,
      unlisted: before.length > 0 ? 'hidden' : 'shown',
    };
  }

  if (!changed) return { object, notes, relatedLists: undefined };
  return { object: out as unknown as ServiceObject, notes, relatedLists };
}
