// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8414] The platform's background sweeps stop interrogating a federated
 * remote about columns that are not there — measured on a REAL boot of the
 * shipped showcase, which is where the waste was found.
 *
 * ## The before-picture this file replaces
 *
 * `applySystemFields` injects the platform anchors into every registered
 * object, ADR-0015 `external` ones included (#7865, direction B — deliberate).
 * `Engine.syncObjectSchema` then issues no DDL for a federated object: the
 * remote owns its schema. So the anchors exist in the registered schema and
 * nowhere else, and a sweep that enumerates columns off `fields` alone asks the
 * remote for all of them. Captured on this exact boot, before the fix, off the
 * `showcase_external` datasource whose `customers` table physically has only
 * `id, name, email, region, lifetime_value`:
 *
 * ```
 *   select `id`, `organization_id`, `created_by`, `updated_by`, `owner_id`,
 *          `owning_business_unit_id` from `customers` limit ?
 *   select * from `customers` limit ?          <- the recovery retry
 * ```
 *
 * The first statement cannot compile (`no such column`); `SqlDriver.find`'s
 * unknown-column recovery — the one pinned by
 * `sql-driver-unknown-column-recovery.test.ts` ("`find()` must not turn an
 * unknown column into 'no rows'") — caught it and retried `select *`, pulling
 * up to 500 whole rows to audit columns that cannot exist, every lifecycle
 * sweep interval, and emitting a #4363 non-deterministic-paging warning each
 * pass. No answer was ever wrong. The entire pass was waste, and that recovery
 * is a safety net rather than a design, so the fix is at the enumerator.
 *
 * ## Why the assertion is "zero statements", not "a narrower statement"
 *
 * Neither federated object the showcase ships declares a reference column of
 * its own, so once the phantom anchors are excluded there is nothing
 * referential left to read and the audit opens neither table at all. A
 * federated object that DOES declare a real remote reference keeps its audit on
 * exactly that column — pinned at the unit level, where the fixture can be
 * built for it, in
 * `objectql/src/integrity/dangling-reference-audit.federated-phantom-columns.test.ts`.
 *
 * ## The second sweep needed no code, and this file records why
 *
 * The card named `backfillSearchCompanion` too, for
 * `select `id`, `name`, `__search` from `customers``. That statement is already
 * gone at a seam one layer further up: #9469 stopped `provisionSearchCompanion`
 * from DECLARING `__search` on a federated object, so the backfill's own
 * `if (!schema.fields[SEARCH_COMPANION_FIELD]) continue` early-out drops those
 * objects before enumerating anything. Adding a second, federation-aware guard
 * inside the backfill would have been wrong twice over: redundant, and — if
 * spelled as "skip external objects" — it would have withheld the companion
 * from a federated object whose author declares a REAL remote `__search`, which
 * `provisionSearchCompanion` deliberately keeps working. So this file pins the
 * PRECONDITION that early-out depends on, on the same real boot.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';

/** The datasource the showcase federates from; also the driver's registered name. */
const EXTERNAL_DATASOURCE = 'showcase_external';
/** Both federated objects the showcase ships (remote tables `customers` / `orders`). */
const FEDERATED = ['showcase_ext_customer', 'showcase_ext_order'] as const;
/** A LOCAL object carrying real reference columns — the positive control. */
const LOCAL = 'showcase_project';

/** The injected anchors that are REFERENCES, i.e. the ones this audit enumerates. */
const INJECTED_REFERENCE_ANCHORS = [
  'organization_id',
  'created_by',
  'updated_by',
  'owner_id',
  'owning_business_unit_id',
] as const;

/** The companion column the pinyin sweep keys on (`SEARCH_COMPANION_FIELD`). */
const SEARCH_COMPANION_FIELD = '__search';

interface Captured {
  driver: string;
  sql: string;
}

/**
 * The two surfaces this file reaches for that the `objectql` SLOT CONTRACT does
 * not declare, spelled out rather than erased to `any` (#4251): the driver
 * registry, which is where SQL can be observed at all, and the audit entry
 * point, which is an engine method rather than a contract member. Naming their
 * shapes keeps the slot lookup itself typed by its contract — the only thing
 * `getService` is asked to promise here is `IObjectQLEngine`.
 */
interface EngineTestSurface {
  drivers: Map<string, { knex?: { on?: (event: string, cb: (q: { sql: string }) => void) => void } }>;
  inspectDanglingReferences(options: { objects: string[] }): Promise<{
    unreadableObjects: string[];
    unscannedObjects: string[];
    aborted: boolean;
  }>;
}

/** Read one object's field map off `getSchema`, which the contract types as `unknown`. */
function fieldsOf(schema: unknown): Record<string, unknown> {
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  return fields && typeof fields === 'object' ? (fields as Record<string, unknown>) : {};
}

/** Is this object bound to a remote table (ADR-0015)? */
function isExternal(schema: unknown): boolean {
  return (schema as { external?: unknown } | null | undefined)?.external != null;
}

describe('[#8414] background sweeps do not project phantom columns off a federated remote', () => {
  let stack: VerifyStack;
  let ql: IObjectQLEngine;
  let engine: EngineTestSurface;
  const captured: Captured[] = [];

  beforeAll(async () => {
    // Pinyin recall ON, explicitly. The last assertion in this file is that no
    // federated object carries `__search`, and that claim is only worth making
    // while the companion is actually being provisioned — otherwise it holds
    // for the trivial reason that the feature is off. The showcase's own
    // `zh-CN` locale turns it on in a real `os dev` boot, but the in-process
    // verify stack does not carry that config through to the registry
    // (measured: the LOCAL control below had no companion without this line,
    // and the control is what caught it). Env toggle ⇒ this file stays in the
    // `isolated` vitest project, per the eligibility rules in vitest.config.ts.
    process.env.OS_SEARCH_PINYIN_ENABLED = '1';
    // Provision the "remote" fixture database (the separate SQLite file the
    // declared external datasource auto-connects to at boot).
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack, { multiTenant: 'posture-only' });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    engine = ql as unknown as EngineTestSurface;

    // Capture at the SQL layer rather than at the engine's `find`: what this
    // card is about is the statement that reaches the remote database, and a
    // projection recorded one level up would still be true if the driver
    // widened it back out.
    for (const [name, driver] of engine.drivers) {
      driver?.knex?.on?.('query', (q) => captured.push({ driver: name, sql: q.sql }));
    }
    expect(
      engine.drivers.has(EXTERNAL_DATASOURCE),
      'the federated datasource must be connected, or this file proves nothing',
    ).toBe(true);
  }, 180_000);

  afterAll(async () => {
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
    await stack?.stop?.();
  });

  it('BEFORE-PICTURE PRESERVED: the federated objects still REGISTER the injected anchors', () => {
    for (const name of FEDERATED) {
      const schema = ql.getSchema(name);
      expect(isExternal(schema), `${name} must be federated`).toBe(true);
      const fields = Object.keys(fieldsOf(schema));
      for (const anchor of INJECTED_REFERENCE_ANCHORS) {
        expect(fields, `${name}.${anchor} is still injected — the fix withholds the QUERY, not the column`).toContain(anchor);
      }
    }
  });

  it('the dangling-reference audit issues NO statement against the federated remote', async () => {
    captured.length = 0;
    const report = await engine.inspectDanglingReferences({ objects: [...FEDERATED, LOCAL] });

    const remote = captured.filter((c) => c.driver === EXTERNAL_DATASOURCE);
    expect(
      remote.map((c) => c.sql),
      'the remote database must not be asked anything at all',
    ).toEqual([]);

    // ...and the run is honest about it: the federated tables are not filed as
    // unread, because a column that was never provisioned holds no reference to
    // dangle. Nothing was refused and nothing was skipped for budget.
    expect(report.unreadableObjects).toEqual([]);
    expect(report.unscannedObjects).toEqual([]);
    expect(report.aborted).toBe(false);
  }, 120_000);

  it('POSITIVE CONTROL: the ordinary object in the same run is still swept with its FULL column set', async () => {
    captured.length = 0;
    await engine.inspectDanglingReferences({ objects: [...FEDERATED, LOCAL] });

    const localReads = captured.filter((c) => c.sql.includes(`from \`${LOCAL}\``));
    expect(localReads, 'the local object must still be read').toHaveLength(1);
    for (const anchor of INJECTED_REFERENCE_ANCHORS) {
      expect(localReads[0]!.sql, `${LOCAL} must still be audited on ${anchor}`).toContain(`\`${anchor}\``);
    }
    // Its own declared reference columns too — the anchors are not the whole set.
    expect(localReads[0]!.sql).toContain('`account`');
  }, 120_000);

  it('the pinyin backfill has nothing to enumerate: no `__search` is declared on a federated object', () => {
    for (const name of FEDERATED) {
      expect(
        fieldsOf(ql.getSchema(name))[SEARCH_COMPANION_FIELD],
        `${name} must carry no companion column — backfillSearchCompanion's early-out keys on exactly this`,
      ).toBeUndefined();
    }
    // The control proves the companion is genuinely in play on this boot, so
    // the absence above is a fact about federation and not about the switch
    // being off.
    expect(
      fieldsOf(ql.getSchema(LOCAL))[SEARCH_COMPANION_FIELD],
      'the local object must still carry the companion',
    ).toBeDefined();
  });
});
