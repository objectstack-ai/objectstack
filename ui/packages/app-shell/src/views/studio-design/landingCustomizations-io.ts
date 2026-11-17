// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34714 — the rows of the Studio landing's "Customizations in this
 * environment" panel: every change this deployment made to its installed apps,
 * in one list.
 *
 * The rows are the server's per-app customization read
 * (`GET /api/v1/packages/:id/customizations`, ADR-0146 D3, D8 item 4), the same
 * answer each installed app's card counts, one row per served entry:
 *
 *  - `overrides` → "changed" (an item of the app the pair overrides);
 *  - `extensions` → "added" (a field, validation or index the pair adds to one
 *    of the app's objects);
 *  - `switchedOff` → "switched off" (an item of the app this deployment turned
 *    off).
 *
 * `contributions` (what OTHER packages bring to the app) are not this
 * deployment's changes and make no row. Nothing is folded or deduped, so the
 * panel's total is the cards' "customized" plus "switched off" by
 * construction: the served counts are each list's length.
 *
 * The answer carries names, not labels. A row's label is read from the app's
 * own published list of that type (one list per app and type that has rows);
 * a field's from its object. A label that cannot be read leaves the row on its
 * name: a failed label read never hides a row.
 *
 * ⛔ No diff against the app, no "based on" version and no clone lineage
 * (ADR-0146 D6): a row says what changed and where, nothing more.
 */

import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import type { PackageCustomizations } from './packageCustomizations-io.js';
import { studioMetadataAreaPath } from './metadataArea.js';

/** How a row changed the app. */
export type CustomizationMode = 'changed' | 'added' | 'switchedOff';

/** One row of the panel. */
export interface CustomizationRow {
  /** Stable key: app, mode and the entry's identity. */
  key: string;
  appId: string;
  appName: string;
  mode: CustomizationMode;
  /**
   * The row's metadata type: the served `type` for a changed or switched-off
   * item; for an added member its kind (`field`, `validation`, `index`).
   */
  type: string;
  /** The entry's name; for an added member, `object.name`. */
  name: string;
  /** For an added member: the object it is added to. */
  object?: string;
  /** The key {@link loadCustomizationLabels} answers a label under. */
  labelKey: string;
  /** Where the row opens in Studio. */
  href: string;
}

/** The address of one item on an app's metadata area; a pillar type opens its pillar from there. */
const itemHref = (appId: string, type: string, name: string) =>
  `${studioMetadataAreaPath(appId)}/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;

/** The rows one app's served answer makes, in the served order: changed, added, switched off. */
export function customizationRowsOf(
  app: { id: string; name: string },
  read: Pick<PackageCustomizations, 'overrides' | 'extensions' | 'switchedOff'>,
): CustomizationRow[] {
  const rows: CustomizationRow[] = [];
  for (const o of read.overrides) {
    const name = o.member ? `${o.name} (${o.member})` : o.name;
    rows.push({
      key: `${app.id}\u0000changed\u0000${o.type}\u0000${o.name}\u0000${o.member ?? ''}`,
      appId: app.id,
      appName: app.name,
      mode: 'changed',
      type: o.type,
      name,
      labelKey: `${o.type}:${o.name}`,
      href: itemHref(app.id, o.type, o.name),
    });
  }
  read.extensions.forEach((e, i) => {
    const member = e.name ?? (e.fields?.join(', ') || String(i + 1));
    rows.push({
      key: `${app.id}\u0000added\u0000${e.object}\u0000${e.kind}\u0000${e.name ?? `#${i}`}`,
      appId: app.id,
      appName: app.name,
      mode: 'added',
      type: e.kind,
      name: `${e.object}.${member}`,
      object: e.object,
      labelKey: e.kind === 'field' && e.name ? `field:${e.object}.${e.name}` : `${e.kind}:${e.object}.${member}`,
      // A member opens on its object: the Data pillar designs the object's fields and rules.
      href: itemHref(app.id, 'object', e.object),
    });
  });
  for (const s of read.switchedOff) {
    rows.push({
      key: `${app.id}\u0000switchedOff\u0000${s.type}\u0000${s.name}`,
      appId: app.id,
      appName: app.name,
      mode: 'switchedOff',
      type: s.type,
      name: s.name,
      labelKey: `${s.type}:${s.name}`,
      href: itemHref(app.id, s.type, s.name),
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
 * its changed and switched-off rows name, and one `list('object', …)` when it
 * has added fields. Answers `labelKey → label` for the labels it could read; a
 * failed list leaves its rows out of the answer, so they keep their names. No
 * row, no request.
 */
export async function loadCustomizationLabels(
  client: LabelClient,
  appId: string,
  rows: readonly CustomizationRow[],
  locale?: string,
): Promise<Record<string, string>> {
  const mine = rows.filter((r) => r.appId === appId);
  const types = new Set(mine.filter((r) => r.mode !== 'added').map((r) => r.type));
  const wantsFields = mine.some((r) => r.mode === 'added' && r.type === 'field');
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
