// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7561] THE BASELINE PIN — a healthy registry validates clean.
 *
 * ## Why this file exists
 *
 * `GET /api/v1/meta/diagnostics` reports every metadata entry that fails its
 * registered Zod schema. That verdict is only worth reading if the baseline is
 * ZERO: at 94 of 94 entries INVALID — where the platform's own
 * `applySystemFields`/`provisionSearchCompanion` stamps supplied both error
 * shapes — a genuinely broken object is indistinguishable from the baseline,
 * and any gate or dashboard built on the endpoint reads permanently red.
 *
 * The 94/94 state was not caught by any suite. It survived until a human read
 * the endpoint by hand during a QA run (#7514), which is the actual failure
 * this file addresses: nothing asserted the baseline. So this pin walks a
 * registry built the way the platform builds one — every stamper live, the
 * tenancy branch that #6810 broke armed — and asserts the sweep finds NOTHING.
 *
 * Companion to `stamped-system-fields-spec-conformance.test.ts`: that one pins
 * the PRODUCERS (whatever a stamper writes, `FieldSchema` accepts); this one
 * pins the OBSERVABLE the card was filed against (the served documents sweep
 * clean). A regression that slipped past the first — a bad key on a document
 * assembled somewhere other than a stamper — still fails here.
 */

import { computeMetadataDiagnostics } from '@objectstack/metadata-protocol';
import { describe, it, expect } from 'vitest';

import { SchemaRegistry } from './registry.js';

const PKG = 'showcase';

/**
 * A baseline shaped like the registry the card was filed against: `sys_*` and
 * `showcase_*` alike, spanning the branches that decide which system columns
 * get stamped, and every one carrying a title-eligible field so the `__search`
 * companion is actually provisioned (an object with no companion could not
 * reproduce #7561 and would pass vacuously).
 */
const OBJECTS: Array<Record<string, unknown>> = [
  { name: 'showcase_account', label: 'Account', fields: { name: { type: 'text' }, revenue: { type: 'number' } } },
  {
    name: 'showcase_contact',
    label: 'Contact',
    ownership: 'user',
    fields: { name: { type: 'text' }, email: { type: 'email' } },
  },
  {
    name: 'showcase_order',
    label: 'Order',
    ownership: 'org',
    fields: { name: { type: 'text' }, total: { type: 'currency' } },
  },
  { name: 'sys_thing', label: 'Thing', fields: { name: { type: 'text' } } },
  {
    name: 'showcase_note',
    label: 'Note',
    managedBy: 'platform',
    fields: { name: { type: 'text' }, body: { type: 'textarea' } },
  },
];

/**
 * The `datasource` row `DefaultDatasourcePlugin.registerVisibility` publishes.
 * Reproduced as a literal rather than imported because the pin is about the
 * SHAPE that reaches the metadata list — importing `@objectstack/runtime` here
 * would invert the package dependency (runtime depends on objectql).
 * `default-datasource-plugin.ts` carries the matching `[#7561]` note.
 */
const DEFAULT_DATASOURCE_ROW = {
  name: 'default',
  label: 'Default',
  driver: 'sqlite',
  config: {},
  origin: 'code',
};

function buildBaseline(multiTenant: boolean): SchemaRegistry {
  // `searchCompanion: true` explicitly: the flag defaults off the environment
  // (`OS_SEARCH_PINYIN_ENABLED`), and a pin that silently skipped the companion
  // would be green on exactly the deployments #7561 was reported from.
  const registry = new SchemaRegistry({ multiTenant, searchCompanion: true });
  for (const def of OBJECTS) registry.registerObject(structuredClone(def) as any, PKG);
  return registry;
}

describe('[#7561] the baseline registry sweeps clean through /meta/diagnostics', () => {
  describe.each([true, false])('multiTenant: %s', (multiTenant) => {
    it('every served object document is spec-valid', () => {
      const registry = buildBaseline(multiTenant);
      const served = registry.getAllObjects(PKG);
      expect(served.length, 'no objects registered — pin would pass vacuously').toBe(OBJECTS.length);

      // Report the SUBSTANCE — which entry, which path, which code — so a
      // regression names itself instead of asserting a bare boolean.
      const invalid: string[] = [];
      for (const doc of served) {
        const diag = computeMetadataDiagnostics('object', doc);
        expect(diag, `object/${(doc as any).name}: no schema registered`).toBeDefined();
        for (const err of diag!.errors ?? []) {
          invalid.push(`object/${(doc as any).name} → ${err.path}: ${err.code}`);
        }
      }
      expect(invalid).toEqual([]);
    });

    it('the platform stamps the companion, and it is one of the entries swept', () => {
      // Guards the guard: the sweep above is only meaningful while `__search`
      // is actually present on the documents it validates.
      const registry = buildBaseline(multiTenant);
      const withCompanion = registry
        .getAllObjects(PKG)
        .filter((o: any) => o.fields?.__search !== undefined);
      expect(withCompanion.length).toBe(OBJECTS.length);
    });
  });

  it('the default datasource row is spec-valid as registered', () => {
    // The second of the card's two error shapes: `config: expected record,
    // received undefined`, produced by the datasource-visibility registration
    // omitting a key `DatasourceSchema` requires.
    const diag = computeMetadataDiagnostics('datasource', DEFAULT_DATASOURCE_ROW);
    expect(diag, 'datasource has no registered schema').toBeDefined();
    expect(
      (diag!.errors ?? []).map((e) => `${e.path}: ${e.code}`),
    ).toEqual([]);
  });

  it("neither of the card's two error shapes appears anywhere in the sweep", () => {
    // Named explicitly so a REINTRODUCTION of either fails on the shape the
    // card reported, not on a generic count. These are the two strings a human
    // read off the endpoint during #7514.
    const all: Array<{ entry: string; path: string; message: string }> = [];
    for (const multiTenant of [true, false]) {
      for (const doc of buildBaseline(multiTenant).getAllObjects(PKG)) {
        for (const err of computeMetadataDiagnostics('object', doc)?.errors ?? []) {
          all.push({ entry: `object/${(doc as any).name}`, path: err.path ?? '', message: err.message ?? '' });
        }
      }
    }
    for (const err of computeMetadataDiagnostics('datasource', DEFAULT_DATASOURCE_ROW)?.errors ?? []) {
      all.push({ entry: 'datasource/default', path: err.path ?? '', message: err.message ?? '' });
    }

    expect(all.filter((e) => e.path === 'fields.__search')).toEqual([]);
    expect(all.filter((e) => /Unrecognized key/i.test(e.message) && /`index`/.test(e.message))).toEqual([]);
    expect(all.filter((e) => e.path === 'config' && /expected record/i.test(e.message))).toEqual([]);
  });
});
