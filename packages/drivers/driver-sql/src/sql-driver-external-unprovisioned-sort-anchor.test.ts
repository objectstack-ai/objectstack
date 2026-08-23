// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── A PREMISE PIN: the SORT axis over an UNPROVISIONED injected anchor (#10744) ──
//
// ⚠️ READ THIS BEFORE "FIXING" A RED IN THIS FILE. Nothing here asserts that the
// platform behaves WELL. Every case below pins a behaviour that is, on its own
// terms, a defect: a list view ordered by a registry-injected anchor on an
// ADR-0015 `external` object answers `200` with the rows in the driver's
// arbitrary order, on the view's first fetch and every fetch after it. This file
// exists because ANOTHER gate's justification rests on that fact being true, so
// the fact must become red-on-change instead of silently stale.
//
// The gate is `sort-field-unprovisioned` (`@objectstack/lint`,
// `validate-sortable-fields.ts`, #10474) — an author-time WARNING whose entire
// warrant is that NEITHER runtime door refuses this ORDER BY, which makes the
// authoring gate the only door there is. If a future change makes a runtime door
// refuse it, or makes the driver honour it, that warning silently becomes wrong:
// it would describe a silent degradation that no longer happens, on a path that
// is now a loud `400`, at the wrong severity, and nothing would turn red.
//
// ## So what does a red here mean? Not necessarily a regression.
//
// Two readings, and the second is the one a reader will not think of:
//
//  1. Someone BROKE something — the driver stopped sorting, or the fixture
//     drifted. The CONTROL case below is what separates this reading from the
//     rest; see "why the control is load-bearing".
//  2. Someone FIXED the runtime — a door was widened to refuse an ORDER BY over
//     an unprovisioned anchor, or the #3821 ladder was narrowed into a hard
//     error. That is a legitimate improvement, and the correct response is to
//     RETIRE OR RE-LEVEL `sort-field-unprovisioned` and delete the cases here
//     that its warrant needed — ⛔ NOT to restore the behaviour this file
//     documents. A premise pin whose red is misread as a regression gets
//     "fixed" by putting back the very defect it records.
//
// Either way the answer is a decision, not a patch. The same posture, and for
// the same reason, as `engine-external-tenant-scope.test.ts` (#7738), the
// precedent this file follows.
//
// ## The premise, stated exactly
//
// The two SORT doors both narrow on `formula` ALONE, so an injected anchor —
// a `datetime` or a `lookup` — clears every verdict at both of them:
//
//   - `assertSortFieldsExist` (`@objectstack/metadata-protocol`, `protocol.ts`,
//     #6994) — the REST ingress. Precedence `unknown` > `dotted` >
//     unmaterializable; the third verdict filters `UNMATERIALIZED_SORT_TYPES`,
//     which is `formula` alone. An injected anchor IS in `gate.known` (the
//     registry injected it into the served schema) and is undotted.
//   - `assertOrderByIsMaterializable` (`@objectstack/objectql`, `engine.ts`,
//     #7095) — the engine's own boundary, for callers that never pass ingress:
//     `schema.fields[f]?.type === 'formula'`, the same narrowing.
//
// Both live in packages that sit ABOVE this one in the dependency graph
// (`driver-sql` depends on `spec`/`core`/`types` only), so this file cannot
// import either door and does not try to. What it pins is the half that is
// observable from here and that the warning actually describes: the ORDER BY
// reaches the driver, and the driver answers success with the sort dropped.
// The doors' own wording and their agreement are pinned one layer up, in
// `packages/objectql/src/query-expression-conformance.test.ts` — which pins the
// FORMULA axis and the doors' agreement about wording, and NOT this case.
// The type half is pinned here from the spec's own injected definitions
// (`ANCHORS ARE NOT 'formula'` below): that is the property both doors narrow
// on, so it is what carries an anchor past both of them.
//
// ## Measured, on this file's own fixture (re-measured 2026-08-22 on `main`)
//
// A real `SqlDriver` over better-sqlite3, `schemaMode: 'external'`, against a
// remote `customers` table carrying exactly `[id, name, email, region,
// lifetime_value]` and none of the seven injected anchors:
//
// ```
// orderBy name       asc -> [c1,c2,c3]   desc -> [c3,c2,c1]   (a real column: reverses)
// orderBy created_at asc -> [c1,c2,c3]   desc -> [c1,c2,c3]   asc === desc, 3 rows, no error
// orderBy owner_id   asc -> [c1,c2,c3]   desc -> [c1,c2,c3]   asc === desc, 3 rows, no error
// ```
//
// …and the same for the other five anchors. The MECHANISM case records how,
// from the emitted SQL:
//
// ```
// select * from `customers` order by `created_at` asc   -- sqlite: no such column
// select * from `customers`                             -- the #3821 ladder's retry
// ```
//
// So the sort is not "never issued" — it is issued, rejected by the remote
// database, and DROPPED by the #3821 recovery ladder, which returns the rows
// unordered under a success because rows matter more than their order. (On this
// stack knex quotes identifiers with backticks, so SQLite raises rather than
// degrading the name to a string literal the way a double-quoted one would —
// the #5348 shape. Both routes end at the same answer; this one is the measured
// one.)
//
// ## Why the CONTROL is load-bearing, and must never be dropped
//
// `asc === desc` on its own is satisfied by a driver that stopped sorting
// ENTIRELY — a far bigger defect that would leave every anchor case green. The
// reversing control on a real remote column is what makes the anchor result a
// DROPPED sort rather than a coincidence, and it is why the card and triage both
// refused the anchor legs without it. ⛔ Do not delete the control to "simplify"
// this file; deleting it converts every other case here into a tautology.
//
// ## Why the fixture constructs the situation instead of finding it
//
// `examples/app-showcase` declares two federated objects (`showcase_ext_customer`,
// `showcase_ext_order`) and NO list view, view record or page binds either of
// them, so the federated read path has no authored SORT surface anywhere in the
// example apps (#10744). The object below is declared the way
// `examples/app-showcase/src/data/objects/external/customer.object.ts` declares
// it — copied rather than imported, because a test that reads outside its own
// package is invisible to turbo's affected-set and to the `test` task's input
// hashing. It is a fixture of that shape, not a mirror of that file: it does not
// go red when the showcase app changes, and it should not.
//
// The served field set is built the way `applySystemFields`
// (`@objectstack/objectql`, above this package) builds it — the author's fields
// plus the spec's OWN injected definitions, read from
// `injectedSystemColumnDefs`. `Engine.syncObjectSchema` hands
// `registerExternalObject` the post-injection registry object, so this is what
// the driver really receives for a federated object. The anchor list is likewise
// derived from `unprovisionedInjectedColumns` (#7865 / #8116) rather than typed
// out, so an ADR that adds or removes an anchor is covered here automatically
// instead of quietly leaving a hand-written list short.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ObjectSchema,
  Field,
  injectedSystemColumnDefs,
  unprovisionedInjectedColumns,
} from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from '../src/index.js';

/**
 * Declared exactly as `examples/app-showcase`'s `showcase_ext_customer` is
 * declared: an ADR-0015 federated object bound to a remote table whose name
 * differs from the object's.
 */
const ExternalCustomer = ObjectSchema.create({
  name: 'showcase_ext_customer',
  sharingModel: 'public_read_write',
  label: 'External Customer',
  pluralLabel: 'External Customers',
  icon: 'database',
  datasource: 'showcase_external',
  external: { remoteName: 'customers' },
  fields: {
    name: Field.text({ label: 'Name', searchable: true }),
    email: Field.text({ label: 'Email' }),
    region: Field.text({ label: 'Region' }),
    lifetime_value: Field.currency({ label: 'Lifetime Value', scale: 2 }),
  },
});

/** The platform's injected anchors for this object, with no storage behind them. */
const ANCHOR_DEFS = injectedSystemColumnDefs(ExternalCustomer);
/** Their names, from the spec's own provenance derivation (#7865). */
const ANCHORS = unprovisionedInjectedColumns(ExternalCustomer);

/** What the driver is registered with — `applySystemFields`' output shape. */
function servedSchema(): any {
  const source = ExternalCustomer as any;
  const fields: Record<string, unknown> = { ...source.fields };
  for (const [name, def] of Object.entries(ANCHOR_DEFS)) fields[name] = { ...def };
  return { ...source, fields };
}

/** The remote table's real columns — none of the anchors among them. */
const REMOTE_COLUMNS = ['id', 'name', 'email', 'region', 'lifetime_value'] as const;

const ROWS = [
  { id: 'c1', name: 'Acme', email: 'acme@example.com', region: 'EMEA', lifetime_value: 100 },
  { id: 'c2', name: 'Globex', email: 'globex@example.com', region: 'APAC', lifetime_value: 200 },
  { id: 'c3', name: 'Initech', email: 'initech@example.com', region: 'AMER', lifetime_value: 300 },
] as const;

const ASC = ['c1', 'c2', 'c3'];
const DESC = ['c3', 'c2', 'c1'];

let file: string;
let ext: SqlDriver;
/** Every statement the external driver issues, for the MECHANISM case. */
let statements: string[] = [];

async function seedRemote(path: string): Promise<void> {
  // A "remote" database the platform does not own: the table is created with
  // raw DDL rather than `initObjects`, so its column set is exactly the card's
  // and carries nothing the platform would have injected.
  const fixture = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: path },
    useNullAsDefault: true,
  });
  (fixture as any).name = 'fixture';
  await fixture.connect?.();
  const k = (fixture as any).knex;
  await k.schema.createTable('customers', (t: any) => {
    t.string('id').primary();
    t.string('name');
    t.string('email');
    t.string('region');
    t.float('lifetime_value');
  });
  await k('customers').insert(ROWS.map((r) => ({ ...r })));
  await fixture.disconnect?.();
}

async function orderedIds(field: string, order: 'asc' | 'desc'): Promise<string[]> {
  const query: DriverQuery = { orderBy: [{ field, order }] };
  const rows = await ext.find('showcase_ext_customer', query);
  return rows.map((r: any) => r.id);
}

beforeAll(async () => {
  file = join(tmpdir(), `os-ext-sort-anchor-${process.pid}-${Date.now()}.db`);
  await seedRemote(file);
  ext = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
    schemaMode: 'external',
  } as any);
  (ext as any).name = 'extds';
  await ext.connect?.();
  (ext as any).knex.on('query', (q: any) => statements.push(String(q?.sql ?? '')));
  // DDL-free registration (ADR-0015) with the POST-INJECTION schema.
  ext.registerExternalObject!(servedSchema());
});

afterAll(async () => {
  await ext?.disconnect?.();
  if (file) {
    try { rmSync(file, { force: true }); } catch { /* ignore */ }
  }
});

describe('SORT over an unprovisioned injected anchor on a federated object (premise pin, #10744)', () => {
  it('FIXTURE the remote table carries none of the injected anchors', async () => {
    const columns = Object.keys(await (ext as any).knex('customers').columnInfo());
    expect(columns.sort()).toEqual([...REMOTE_COLUMNS].sort());

    // The anchors are addressable on the served object and backed by nothing —
    // the `injected-unprovisioned` provenance (#7865) this whole file is about.
    expect(ANCHORS).toContain('created_at');
    expect(ANCHORS).toContain('owner_id');
    for (const anchor of ANCHORS) {
      expect(Object.keys(servedSchema().fields)).toContain(anchor);
      expect(columns).not.toContain(anchor);
    }
  });

  it("ANCHORS ARE NOT 'formula' — the type both SORT doors narrow on", () => {
    // Why both doors let this ORDER BY through, asserted from the spec's own
    // injected definitions. `UNMATERIALIZED_SORT_TYPES` (metadata-protocol) and
    // the engine's `=== 'formula'` are unreachable from this package; this is
    // the same fact from the side this package CAN see. If an anchor ever
    // becomes a `formula`, the doors refuse it and this file's premise is gone.
    for (const anchor of ANCHORS) {
      const type = String((ANCHOR_DEFS as any)[anchor]?.type ?? '');
      expect(type).not.toBe('formula');
      expect(['datetime', 'lookup']).toContain(type);
    }
  });

  // ── The CONTROL. Read the header before touching this case. ───────────────
  it('CONTROL a real remote column IS sorted — asc and desc are reverses', async () => {
    expect(await orderedIds('name', 'asc')).toEqual(ASC);
    expect(await orderedIds('name', 'desc')).toEqual(DESC);
  });

  it.each(ANCHORS)(
    'ORDER BY %s is neither refused nor applied — asc === desc, all rows, no error',
    async (anchor) => {
      const asc = await orderedIds(anchor, 'asc');
      const desc = await orderedIds(anchor, 'desc');

      // Not refused: no door threw, the driver did not throw, all rows came back.
      expect(asc).toHaveLength(ROWS.length);
      expect(desc).toHaveLength(ROWS.length);

      // Not applied: reversing the direction changes nothing. Against the
      // CONTROL above — which does reverse — this is a DROPPED sort, not a
      // table that happens to be ordered the same way both times.
      expect(desc).toEqual(asc);
      expect(asc).toEqual(ASC);
    },
  );

  it('MECHANISM the ORDER BY reaches the remote database and the #3821 ladder drops it', async () => {
    statements = [];
    const query: DriverQuery = { orderBy: [{ field: 'created_at', order: 'desc' }] };
    const rows = await ext.find('showcase_ext_customer', query);
    expect(rows).toHaveLength(ROWS.length);

    // Two statements: the sort IS issued against the remote table (which raises
    // an unknown-column error), then the ladder retries with no ORDER BY at all.
    expect(statements.length).toBeGreaterThanOrEqual(2);
    expect(statements[0]).toMatch(/order by\s+.?created_at.?\s+desc/i);
    expect(statements[statements.length - 1]).not.toMatch(/order by/i);
  });
});
