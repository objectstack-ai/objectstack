// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rows of an installed app's "Customizations in this environment" section
 * in Setup → Packages (objectstack#36908, which moved it from the removed
 * Studio home, objectstack#34714): every change this deployment made to the
 * app, in one list.
 *
 * The rows are the server's per-package customization read
 * (`GET /api/v1/packages/:id/customizations`, ADR-0146 D3, D8 item 4), one row
 * per served entry:
 *
 *  - `overrides` → "changed" (an item of the app the pair overrides);
 *  - `extensions` → "added" (a field, validation or index the pair adds to one
 *    of the app's objects);
 *  - `arrangements` → "rearranged" (an object's field groups, tabs or action
 *    layout the pair declares whole, ADR-0146 D10);
 *  - `switchedOff` → "switched off" (an item of the app this deployment turned
 *    off).
 *
 * `contributions` (what OTHER packages bring to the app) are not this
 * deployment's changes and make no row. Nothing is folded or deduped, so the
 * rows match the counts {@link customizedCountOf} reads: every served list's
 * length.
 *
 * The answer carries names, not labels. A row's label is read from the app's
 * own published list of that type (one list per type that has rows); a
 * field's from its object. A label that cannot be read leaves the row on its
 * name: a failed label read never hides a row.
 *
 * ⛔ No diff against the app, no "based on" version and no clone lineage
 * (ADR-0146 D6): a row says what changed and where, nothing more.
 */

import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import type { PackageCustomizations } from './packageCustomizations-io.js';
import { studioMetadataAreaPath } from './metadataArea.js';
import { switchedOffActionPath, type ActionObjects } from './switchedOffActionTargets.js';

/** How a row changed the app. */
export type CustomizationMode = 'changed' | 'added' | 'arranged' | 'switchedOff';

/** Which arrangement an arranged row names. */
export type ArrangementKey = PackageCustomizations['arrangements'][number]['key'];

/** One row of the section. */
export interface CustomizationRow {
  /** Stable key: mode and the entry's identity. */
  key: string;
  mode: CustomizationMode;
  /**
   * The row's metadata type: the served `type` for a changed or switched-off
   * item; for an added member its kind (`field`, `validation`, `index`); for
   * an arrangement `object`, the item it rearranges.
   */
  type: string;
  /** The entry's name; for an added member, `object.name`; for an arrangement, the object. */
  name: string;
  /** For an arrangement: which one (`fieldGroups`, `relatedLists`, `actionLayout`). */
  arrangement?: ArrangementKey;
  /** The key {@link loadCustomizationLabels} answers a label under. */
  labelKey: string;
  /** Where the row opens in Studio. */
  href: string;
}

/**
 * objectstack#36833 — what "customized" counts: every change the pair makes,
 * the served overrides, extensions AND arrangements. A package whose only
 * change is a tab arrangement is customized; the Studio home's count left the
 * arrangements out.
 */
export function customizedCountOf({ counts }: Pick<PackageCustomizations, 'counts'>): number {
  return counts.overrides + counts.extensions + counts.arrangements;
}

/** The address of one item on an app's metadata area; a pillar type opens its pillar from there. */
const itemHref = (appId: string, type: string, name: string) =>
  `${studioMetadataAreaPath(appId)}/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;

/**
 * The rows one app's served answer makes, in the served order: changed, added,
 * rearranged, switched off. `actionObjects` (objectstack#34724) names the
 * object holding each switched-off action: such an action opens on its
 * object's Actions view, since one declared inside its object has no item
 * page; any other action opens its own page, as every other type does.
 */
export function customizationRowsOf(
  appId: string,
  read: Pick<PackageCustomizations, 'overrides' | 'extensions' | 'arrangements' | 'switchedOff'>,
  actionObjects?: ActionObjects,
): CustomizationRow[] {
  const rows: CustomizationRow[] = [];
  for (const o of read.overrides) {
    const name = o.member ? `${o.name} (${o.member})` : o.name;
    rows.push({
      key: `changed\u0000${o.type}\u0000${o.name}\u0000${o.member ?? ''}`,
      mode: 'changed',
      type: o.type,
      name,
      labelKey: `${o.type}:${o.name}`,
      href: itemHref(appId, o.type, o.name),
    });
  }
  read.extensions.forEach((e, i) => {
    const member = e.name ?? (e.fields?.join(', ') || String(i + 1));
    rows.push({
      key: `added\u0000${e.object}\u0000${e.kind}\u0000${e.name ?? `#${i}`}`,
      mode: 'added',
      type: e.kind,
      name: `${e.object}.${member}`,
      labelKey: e.kind === 'field' && e.name ? `field:${e.object}.${e.name}` : `${e.kind}:${e.object}.${member}`,
      // A member opens on its object: the Data pillar designs the object's fields and rules.
      href: itemHref(appId, 'object', e.object),
    });
  });
  for (const a of read.arrangements) {
    rows.push({
      key: `arranged\u0000${a.object}\u0000${a.key}`,
      mode: 'arranged',
      type: 'object',
      name: a.object,
      arrangement: a.key,
      labelKey: `object:${a.object}`,
      // An arrangement is the object's record page: it opens on the object.
      href: itemHref(appId, 'object', a.object),
    });
  }
  for (const s of read.switchedOff) {
    rows.push({
      key: `switchedOff\u0000${s.type}\u0000${s.name}`,
      mode: 'switchedOff',
      type: s.type,
      name: s.name,
      labelKey: `${s.type}:${s.name}`,
      href: s.type === 'action' ? switchedOffActionPath(appId, s.name, actionObjects?.[s.name]) : itemHref(appId, s.type, s.name),
    });
  }
  return rows;
}

/** The slice of the metadata client the label read uses. */
export interface LabelClient {
  list(type: string, options?: { packageId?: string }): Promise<unknown>;
}

const labelOf = (label: unknown, locale: string | undefined): string | undefined => {
  if (label === null || label === undefined) return undefined;
  const resolved = resolveI18nLabel(label as I18nLabel, locale)?.trim();
  return resolved || undefined;
};

/** A served object's fields, as a map or as a list, by name. */
function fieldsOf(object: Record<string, unknown>): Array<[string, unknown]> {
  const fields = object.fields;
  if (Array.isArray(fields)) {
    return fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string')
      .map((f) => [String(f.name), f.label]);
  }
  if (fields && typeof fields === 'object') {
    return Object.entries(fields as Record<string, unknown>).map(([name, f]) => [
      name,
      f && typeof f === 'object' ? (f as { label?: unknown }).label : undefined,
    ]);
  }
  return [];
}

/**
 * Read the labels of one app's rows: one `list(type, { packageId })` per type
 * its changed, rearranged and switched-off rows name, and one
 * `list('object', …)` when it has added fields. Answers `labelKey → label` for
 * the labels it could read; a failed list leaves its rows out of the answer,
 * so they keep their names. No row, no request.
 */
export async function loadCustomizationLabels(
  client: LabelClient,
  appId: string,
  rows: readonly CustomizationRow[],
  locale?: string,
): Promise<Record<string, string>> {
  const types = new Set(rows.filter((r) => r.mode !== 'added').map((r) => r.type));
  const wantsFields = rows.some((r) => r.mode === 'added' && r.type === 'field');
  if (wantsFields) types.add('object');
  const labels: Record<string, string> = {};
  await Promise.all(
    [...types].map(async (type) => {
      let items: unknown;
      try {
        items = await client.list(type, { packageId: appId });
      } catch {
        return;
      }
      if (!Array.isArray(items)) return;
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name : '';
        if (!name) continue;
        const label = labelOf(item.label, locale);
        if (label) labels[`${type}:${name}`] = label;
        if (type === 'object' && wantsFields) {
          for (const [field, fieldLabel] of fieldsOf(item)) {
            const l = labelOf(fieldLabel, locale);
            if (l) labels[`field:${name}.${field}`] = l;
          }
        }
      }
    }),
  );
  return labels;
}
