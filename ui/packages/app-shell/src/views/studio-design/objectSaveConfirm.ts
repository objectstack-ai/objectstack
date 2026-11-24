// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — what an object's Save would do to data the moment it is
 * live: a published field removed, or a published field given another type.
 * A Save makes the object live at once, so the author is asked first, with the
 * consequence of each change named.
 *
 * Only fields the published object declares count: a field added on this page
 * and removed again, or one only a pending draft holds, has no records yet.
 */

import { readFields } from '../metadata-admin/previews/object-fields-io.js';
import { fieldTypeName } from '../metadata-admin/previews/fieldTypeName.js';
import { tFormat } from '../metadata-admin/i18n.js';

function fieldLabelOf(def: Record<string, unknown> | undefined, name: string): string {
  const label = def?.label;
  return typeof label === 'string' && label.trim() !== '' ? label.trim() : name;
}

/**
 * One sentence per irreversible change from `stored` (the object as the server
 * holds it for the open buffer) to `next` (the body Save would send), among
 * the fields in `published`. Empty when there is nothing to ask about.
 */
export function irreversibleFieldChanges(
  stored: Record<string, unknown> | null,
  next: Record<string, unknown>,
  published: ReadonlySet<string>,
  locale: string,
): string[] {
  if (!stored) return [];
  const before = readFields(stored.fields).entries;
  const after = new Map(readFields(next.fields).entries.map((e) => [e.name, e.def as Record<string, unknown>]));
  const lines: string[] = [];
  for (const { name, def } of before) {
    if (!published.has(name)) continue;
    const was = def as Record<string, unknown>;
    const now = after.get(name);
    if (!now) {
      lines.push(tFormat('engine.studio.save.confirmRemoveField', locale, { field: fieldLabelOf(was, name) }));
      continue;
    }
    const from = typeof was.type === 'string' ? was.type : '';
    const to = typeof now.type === 'string' ? now.type : '';
    if (from && to && from !== to) {
      lines.push(
        tFormat('engine.studio.save.confirmRetypeField', locale, {
          field: fieldLabelOf(now, name),
          from: fieldTypeName(from, locale),
          to: fieldTypeName(to, locale),
        }),
      );
    }
  }
  return lines;
}
