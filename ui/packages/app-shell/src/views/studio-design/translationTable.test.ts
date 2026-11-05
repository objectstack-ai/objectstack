// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30285 — the rows of Studio's translation table.
 *
 * Pinned:
 *  - the rows are the walk's keys (`collectExpectedEntries`), each with the
 *    text the package declares, and nothing from the registry-driven
 *    `metadataForms` group;
 *  - a row is translated by the item's own value, by what the language serves
 *    from another bundle, or by an inline locale map naming the language;
 *    everything else is untranslated, and that is the count;
 *  - an edit writes the item's JSON at the row's key, and clearing it leaves
 *    no empty slot, so the saved item has the shape the JSON editor writes;
 *  - the package is read as declared (the layered read, a view by its bare
 *    key), the platform objects it points at are read too, and no more than
 *    the bounded number of reads is ever in flight.
 */

import { describe, expect, it } from 'vitest';
import { collectExpectedEntries } from '@objectstack/lint';
import {
  DECLARED_STACK_READ_CONCURRENCY,
  buildTranslationRows,
  countUntranslated,
  readDeclaredStack,
  readTranslationAt,
  referencedObjects,
  translatableEntries,
  writeTranslationAt,
  type DeclaredStackClient,
} from './translationTable';

const STACK = {
  objects: [
    {
      name: 'repair_ticket',
      label: 'Repair Ticket',
      fields: {
        priority: {
          type: 'select',
          label: 'Priority',
          options: [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ],
        },
        owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
      },
    },
  ],
  apps: [
    {
      name: 'service',
      label: 'Service',
      navigation: [{ id: 'nav_tickets', type: 'object', objectName: 'repair_ticket', label: 'Tickets' }],
    },
  ],
};

const ENTRIES = collectExpectedEntries(STACK, { warnedGroups: new Set() });
const keysOf = (rows: Array<{ key: string }>) => rows.map((row) => row.key);

describe('buildTranslationRows', () => {
  it('lists every key the walk yields for the package, each with its declared text', () => {
    const rows = buildTranslationRows(ENTRIES, {}, null, 'fr-FR');
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get('objects.repair_ticket.label')).toMatchObject({ sourceText: 'Repair Ticket', kind: 'object', group: 'objects', groupKey: 'objects.repair_ticket' });
    expect(byKey.get('objects.repair_ticket.fields.priority.label')).toMatchObject({ sourceText: 'Priority', kind: 'field' });
    expect(byKey.get('objects.repair_ticket.fields.priority.options.high')).toMatchObject({ sourceText: 'High', kind: 'option' });
    expect(byKey.get('apps.service.label')).toMatchObject({ sourceText: 'Service', kind: 'app', groupKey: 'apps.service' });
    expect(byKey.get('apps.service.navigation.nav_tickets.label')).toMatchObject({ sourceText: 'Tickets', kind: 'navigation' });
    // The rows are exactly the walk's translatable keys: the table cannot invent or drop one.
    expect(keysOf(rows)).toEqual(translatableEntries(ENTRIES).map((entry) => entry.path.join('.')));
  });

  it('leaves the registry-driven metadata-form copy to the JSON view', () => {
    expect(ENTRIES.some((entry) => entry.path[0] === 'metadataForms')).toBe(true);
    expect(buildTranslationRows(ENTRIES, {}, null, 'fr-FR').some((row) => row.group === 'metadataForms')).toBe(false);
  });

  it('counts what neither the item, the served language nor an inline map translates', () => {
    const empty = buildTranslationRows(ENTRIES, {}, null, 'fr-FR');
    const total = empty.length;
    expect(countUntranslated(empty)).toEqual({ untranslated: total, total });

    const draft = { objects: { repair_ticket: { label: 'Ticket de réparation' } } };
    const served = { apps: { service: { label: 'Service client' } } };
    const rows = buildTranslationRows(ENTRIES, draft, served, 'fr-FR');
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get('objects.repair_ticket.label')).toMatchObject({ status: 'here', value: 'Ticket de réparation' });
    expect(byKey.get('apps.service.label')).toMatchObject({ status: 'elsewhere', value: '', served: 'Service client' });
    expect(byKey.get('objects.repair_ticket.fields.priority.label')).toMatchObject({ status: 'missing', value: '' });
    expect(countUntranslated(rows)).toEqual({ untranslated: total - 2, total });
  });

  it('reads an inline locale map naming the language as translated, and shows its English as the source', () => {
    const entries = collectExpectedEntries(
      { objects: [{ name: 'note', label: { en: 'Note', 'fr-FR': 'Remarque' }, fields: {} }] },
      { warnedGroups: new Set() },
    );
    const fr = buildTranslationRows(entries, {}, null, 'fr-FR').find((row) => row.key === 'objects.note.label');
    expect(fr).toMatchObject({ status: 'inline', sourceText: 'Note', served: 'Remarque' });
    const vi = buildTranslationRows(entries, {}, null, 'vi-VN').find((row) => row.key === 'objects.note.label');
    expect(vi).toMatchObject({ status: 'missing', sourceText: 'Note' });
  });
});

describe('writeTranslationAt', () => {
  const item = { name: 'crm_vi', label: 'Vietnamese', locale: 'vi-VN', objects: { repair_ticket: { label: 'Phiếu sửa chữa' } } };

  it("writes the item's JSON at the row's key, leaving everything else as it was", () => {
    const next = writeTranslationAt(item, ['objects', 'repair_ticket', 'fields', 'priority', 'options', 'high'], 'Cao');
    expect(next).toEqual({
      ...item,
      objects: { repair_ticket: { label: 'Phiếu sửa chữa', fields: { priority: { options: { high: 'Cao' } } } } },
    });
    expect(item.objects.repair_ticket).toEqual({ label: 'Phiếu sửa chữa' });
    expect(readTranslationAt(next, ['objects', 'repair_ticket', 'fields', 'priority', 'options', 'high'])).toBe('Cao');
  });

  it('removes a cleared key and the groups it leaves empty, so the saved item is the JSON editor’s shape', () => {
    const cleared = writeTranslationAt(item, ['objects', 'repair_ticket', 'label'], '');
    expect(cleared).toEqual({ name: 'crm_vi', label: 'Vietnamese', locale: 'vi-VN' });
    expect(writeTranslationAt(cleared, ['apps', 'service', 'label'], '')).toBe(cleared);
  });

  it('round-trips: what a row writes is what the next build of the rows reads back', () => {
    const next = writeTranslationAt({ locale: 'vi-VN' }, ['apps', 'service', 'navigation', 'nav_tickets', 'label'], 'Phiếu');
    const row = buildTranslationRows(ENTRIES, next, null, 'vi-VN').find((r) => r.key === 'apps.service.navigation.nav_tickets.label');
    expect(row).toMatchObject({ status: 'here', value: 'Phiếu' });
    expect(JSON.parse(JSON.stringify(next))).toEqual({ locale: 'vi-VN', apps: { service: { navigation: { nav_tickets: { label: 'Phiếu' } } } } });
  });
});

describe('referencedObjects', () => {
  it('names the objects a lookup or a navigation entry points at that the package does not declare', () => {
    expect(
      referencedObjects({
        objects: [{ name: 'a', fields: { u: { reference: 'sys_user' }, b: { reference: 'a' } } }],
        apps: [{ navigation: [{ type: 'group', children: [{ type: 'object', objectName: 'sys_org' }] }, { type: 'object', objectName: 'a' }] }],
      }),
    ).toEqual(['sys_org', 'sys_user']);
  });
});

describe('readDeclaredStack', () => {
  type Doc = Record<string, unknown>;
  /** `byPackage[pkg][type]` holds `{ code, effective }` layers; `platform[name]` a platform object's. */
  function fakeClient(
    byPackage: Record<string, Record<string, Array<{ code: Doc | null; effective: Doc }>>>,
    platform: Record<string, { code: Doc | null; effective: Doc }>,
  ) {
    const calls: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const slow = async <T,>(value: T): Promise<T> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return value;
    };
    const client: DeclaredStackClient = {
      list: (type, options) => {
        const pkg = options?.packageId ?? '';
        calls.push(`list ${type} ${pkg}`);
        // The list read is translated and decorated: the table must not take its text.
        return slow((byPackage[pkg]?.[type] ?? []).map(({ effective }) => ({ ...effective, label: `served ${String(effective.label)}`, _packageId: pkg })));
      },
      layered: (type, name, options) => {
        const pkg = options?.packageId ?? '';
        calls.push(`layered ${type} ${name} ${pkg}`);
        const lay = pkg ? (byPackage[pkg]?.[type] ?? []).find((l) => l.effective.name === name) : platform[name];
        return slow(lay ?? { code: null, effective: null });
      },
    };
    return { client, calls, peak: () => peak };
  }
  const OWNER = { type: 'lookup', label: 'Owner', reference: 'sys_user', system: true };

  it("reads each item's declared layer, a view by its bare key, within the bound", async () => {
    const declared = { name: 'repair_ticket', label: 'Repair Ticket', fields: { status: { type: 'text', label: 'Status' } } };
    const crm = {
      object: [
        { code: declared, effective: { ...declared, fields: { ...declared.fields, owner_id: OWNER } } },
        ...Array.from({ length: 9 }, (_, i) => {
          const doc = { name: `obj_${i}`, label: `Object ${i}`, fields: {} };
          return { code: doc, effective: doc };
        }),
      ],
      view: [{ code: { name: 'repair_ticket.all_open', object: 'repair_ticket', label: 'All open' }, effective: { name: 'repair_ticket.all_open', object: 'repair_ticket', label: 'All open' } }],
    };
    const fake = fakeClient({ 'com.example.crm': crm }, { sys_user: { code: { name: 'sys_user', label: 'User', fields: {} }, effective: { name: 'sys_user', label: 'User', fields: {} } } });
    const progress: Array<[number, number]> = [];
    const { stack, requests } = await readDeclaredStack(fake.client, ['com.example.crm'], (done, total) => progress.push([done, total]));

    const objects = stack.objects as Doc[];
    expect(objects[0]).toEqual(declared);
    expect((stack.views as Doc[])[0]).toMatchObject({ name: 'all_open', object: 'repair_ticket' });
    // The owner the platform injects points at the user object, which is walked too.
    expect(objects.map((o) => o.name).at(-1)).toBe('sys_user');
    // 14 list reads, 11 item reads, 1 platform object.
    expect(requests).toBe(14 + 11 + 1);
    expect(fake.calls).toHaveLength(requests);
    expect(fake.calls).toContain('layered object sys_user ');
    expect(fake.peak()).toBeLessThanOrEqual(DECLARED_STACK_READ_CONCURRENCY);
    expect(progress.at(-1)).toEqual([requests, requests]);
  });

  it('reads a database-authored object without the fields the platform injects, and a pair with its base', async () => {
    const custom = { name: 'acme_note', label: 'Note', fields: { body: { type: 'text', label: 'Body' }, owner_id: OWNER } };
    const fake = fakeClient(
      {
        'com.example.crm': { object: [{ code: { name: 'crm_account', label: 'Account', fields: {} }, effective: { name: 'crm_account', label: 'Account', fields: {} } }] },
        'com.example.crm.custom': { object: [{ code: null, effective: custom }] },
      },
      { sys_user: { code: { name: 'sys_user', label: 'User', fields: {} }, effective: { name: 'sys_user', label: 'User', fields: {} } } },
    );
    const { stack } = await readDeclaredStack(fake.client, ['com.example.crm', 'com.example.crm.custom']);
    const objects = stack.objects as Doc[];
    expect(objects.map((o) => o.name)).toEqual(['crm_account', 'acme_note', 'sys_user']);
    expect(objects[1]!.fields).toEqual({ body: { type: 'text', label: 'Body' } });
  });
});
