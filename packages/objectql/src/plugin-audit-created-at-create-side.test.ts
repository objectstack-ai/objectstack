// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15964 — on an ORDINARY create the audit binder stamps `created_at` from the
// system clock, so a caller-supplied value never survives a plain REST `POST`.
//
// ## The hole, and why it needed the three controls below
//
// Measured on a live rig (framework `e581457baaaf`): a normal authenticated
// caller `POST /api/v1/data/OBJECT` with a forged `created_at` kept that value
// on the stored row, on objects that declare `created_at` as `readonly: true`.
// The same request, same path, same object family:
//
//   field                  declaration          sent          stored     verdict
//   ---------------------  -------------------  ------------  ---------  --------
//   id                     readonly: true       forged        minted     stripped
//   run_at                 readonly, datetime   1999-01-01    now        stripped
//   updated_at             readonly, datetime   1999-01-01    now        stripped
//   created_at             readonly, datetime   1999-01-01    1999-01-01 KEPT
//
// The three stripped rows are the reading's in-experiment controls: they prove
// the create-side strip IS running on this path and DOES take other
// author-declared `readonly` datetimes, so `created_at` surviving is "the strip
// ran and spared exactly this one", never "the strip did not run".
//
// ## Mechanism
//
// Since #15395 the static-`readonly` strip runs INSIDE `engine.insert`, AFTER
// the `beforeInsert` hooks, and its #14259 guard treats a key a hook ASSIGNED
// as the hook's write rather than a caller forgery (`rowHookWrittenKeys`). The
// audit binder stamped `record.created_at = record.created_at ?? now`, so on a
// forged payload the hook "wrote" a value whose bytes came entirely from the
// caller — and the strip spared it. `updated_at`'s `preserveAudit ? (… ?? now)
// : now` overwrote the forgery first, which is why it is a control here rather
// than a second symptom.
//
// ## Maintainer ruling, 2026-09-06 (decision batch #54, option A), verbatim
// 「同意」
//
//   - the beforeInsert stamp for `created_at` takes the SAME SHAPE as
//     `updated_at` — the system clock wins on an ordinary create;
//   - the historical-import channel KEEPS working: `treatAsHistorical` sets
//     `preserveAudit` on the write context (`packages/rest/src/import-runner.ts`),
//     and that branch still reinstates an original `created_at`. That is the
//     third case below, and it is the reason the ruled shape is the
//     `preserveAudit`-branching one rather than a bare `= now`.
//
// Consistent with the 2026-08-08 ruling that narrowed `preserveAudit` to the
// UPDATE path: `created_at` is preserved here by the audit binder's own
// `preserveAudit` branch, which is where the flag has always been read on this
// path — the create-side strip still does not read it (#14147).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

const FORGED_AT = '1999-01-01T00:00:00.000Z';
const FORGED_ID = 'conv_REST_FORGED';

describe('audit binder: create-side `created_at` (#15964)', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  /**
   * Boots the REAL ingress this card is about: `ObjectQLPlugin` binds its
   * `sys_stamp_audit_insert` hook through `bindHooksToEngine`, and
   * `engine.insert` runs the static-readonly strip after it. What reaches the
   * driver's `create` IS the stored row, so the payload is the verdict.
   */
  async function boot(objectName: string) {
    const captured: Record<string, any>[] = [];
    const mockDriver = {
      name: 'audit-capture', version: '1.0.0',
      connect: async () => {}, disconnect: async () => {},
      find: async () => [], findOne: async () => null,
      create: async (_o: string, d: any) => {
        captured.push({ ...d });
        return { id: d.id ?? 'minted_id', ...d };
      },
      update: async (_o: string, i: any, d: any) => ({ id: i, ...d }),
      delete: async () => true, syncSchema: async () => {},
    };
    await kernel.use({
      name: 'audit-capture-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.audit-capture', mockDriver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService<ObjectQL>('objectql');
    // `created_at` / `updated_at` are NOT declared here: the registry injects
    // them from `AUDIT_FIELD_DEFS`, where both are `readonly: true` datetimes —
    // the same declaration the card's three live objects carry.
    const schema = {
      name: objectName,
      label: 'Repro Object',
      datasource: 'audit-capture',
      fields: {
        id: { name: 'id', label: 'Id', type: 'text', readonly: true },
        title: { name: 'title', label: 'Title', type: 'text' },
        run_at: { name: 'run_at', label: 'Run At', type: 'datetime', readonly: true },
      },
    } as any;
    objectql.registry.registerObject(schema, 'test', 'test');
    return { objectql, captured };
  }

  const forgedPayload = () => ({
    id: FORGED_ID,
    title: 'x',
    run_at: FORGED_AT,
    created_at: FORGED_AT,
    updated_at: FORGED_AT,
  });

  /** Prints the card's four-field table for the row that reached the driver. */
  function printTable(label: string, row: Record<string, any>) {
    const verdict = (v: unknown, forged: unknown) => (v === forged ? 'KEPT (forged)' : 'stripped/overwritten');
    // eslint-disable-next-line no-console
    console.log(
      `\n[#15964 ${label}]\n` +
      `  id         sent=${FORGED_ID} stored=${String(row.id)} -> ${verdict(row.id, FORGED_ID)}\n` +
      `  run_at     sent=${FORGED_AT} stored=${String(row.run_at)} -> ${verdict(row.run_at, FORGED_AT)}\n` +
      `  updated_at sent=${FORGED_AT} stored=${String(row.updated_at)} -> ${verdict(row.updated_at, FORGED_AT)}\n` +
      `  created_at sent=${FORGED_AT} stored=${String(row.created_at)} -> ${verdict(row.created_at, FORGED_AT)}\n`,
    );
  }

  it('an ordinary create: the caller-supplied `created_at` does NOT survive, and the three controls stay stripped', async () => {
    const { objectql, captured } = await boot('repro_conversations');

    await objectql.insert('repro_conversations', forgedPayload(), {
      context: { userId: 'user-1' },
    });

    expect(captured.length).toBe(1);
    const row = captured[0];
    printTable('after', row);

    // The three in-experiment controls — each was already stripped BEFORE this
    // change, and a fix that closes `created_at` while opening any of them is a
    // regression on a security card.
    expect(row.id).not.toBe(FORGED_ID);
    expect(row.run_at).not.toBe(FORGED_AT);
    expect(row.updated_at).not.toBe(FORGED_AT);

    // The card's row. Overwritten by the binder rather than deleted, which is
    // why `created_at` is still present and still a real stamp.
    expect(row.created_at).not.toBe(FORGED_AT);
    expect(typeof row.created_at).toBe('string');
    expect(Date.parse(row.created_at)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'));
    // …and the two audit timestamps agree on a create, as they did before.
    expect(row.updated_at).toBe(row.created_at);
  });

  it('a create that sends no `created_at` is still stamped (the binder keeps doing its job)', async () => {
    const { objectql, captured } = await boot('repro_plain');

    await objectql.insert('repro_plain', { title: 'x' }, { context: { userId: 'user-1' } });

    const row = captured[0];
    expect(typeof row.created_at).toBe('string');
    expect(Date.parse(row.created_at)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'));
  });

  // [#15964] `isSystem` on its own is NOT a back-dating channel, and never was.
  // It exempts the engine's readonly STRIP; the audit binder's stamp is not
  // gated on it at all. Before this change a system-context seed kept its
  // supplied `created_at` because of the `??`, not because of its elevation —
  // which is how a legitimate back-dating fixture came to depend on the hole
  // (`packages/qa/dogfood/test/analytics-timezone.dogfood.test.ts` seeds a
  // timezone-boundary instant exactly this way). Both halves are pinned here so
  // the next such seed is told which flag it actually needs.
  it('`isSystem` alone does NOT preserve it, and `isSystem` + `preserveAudit` does', async () => {
    const { objectql, captured } = await boot('repro_system_seed');

    await objectql.insert('repro_system_seed', forgedPayload(), {
      context: { isSystem: true },
    });
    await objectql.insert('repro_system_seed', forgedPayload(), {
      context: { isSystem: true, preserveAudit: true },
    });

    const [elevatedOnly, historical] = captured;
    printTable('isSystem only', elevatedOnly);
    printTable('isSystem + preserveAudit', historical);

    // The system context skips the strip, so `id` and `run_at` DO survive here —
    // that is the control proving the elevation really took effect, and it is
    // what makes the `created_at` row below a statement about the binder alone.
    expect(elevatedOnly.id).toBe(FORGED_ID);
    expect(elevatedOnly.run_at).toBe(FORGED_AT);
    // …and the binder still stamps, because it is not gated on `isSystem`.
    expect(elevatedOnly.created_at).not.toBe(FORGED_AT);
    expect(elevatedOnly.updated_at).not.toBe(FORGED_AT);

    // The explicit channel — `ExecutionContext.preserveAudit`, what REST's
    // `treatAsHistorical` import sets — reaches the binder through
    // `buildSession` independently of `isSystem`, so a back-dated seed works.
    expect(historical.created_at).toBe(FORGED_AT);
    expect(historical.updated_at).toBe(FORGED_AT);
  });

  // The ruled control: the historical-import channel is EXPLICIT and still
  // works. `runImport({ treatAsHistorical: true })` puts `preserveAudit: true`
  // on the write context (`packages/rest/src/import-runner.ts`), which is
  // exactly the context asserted here.
  it('`preserveAudit` (what `treatAsHistorical` sets) still reinstates the original `created_at`', async () => {
    const { objectql, captured } = await boot('repro_historical');

    await objectql.insert('repro_historical', forgedPayload(), {
      context: { userId: 'user-1', preserveAudit: true },
    });

    const row = captured[0];
    printTable('preserveAudit control', row);

    expect(row.created_at).toBe(FORGED_AT);
    // Symmetric with `updated_at`, which has had this branch since #3493.
    expect(row.updated_at).toBe(FORGED_AT);
    // …and the exemption is the audit binder's, not the strip's: a non-audit
    // readonly field is still taken on the create side (2026-08-08 ruling,
    // unchanged by this card).
    expect(row.run_at).not.toBe(FORGED_AT);
  });
});
