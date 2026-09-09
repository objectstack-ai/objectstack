// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16311 — on an ORDINARY create the audit binder stamps `created_by` from the
// SESSION, so a caller-supplied value never survives a plain REST `POST`.
//
// This is the one-field-over twin of #15964 / PR #16313 (`created_at`), and it
// is deliberately shaped the same way: two fields fixed two ways inside one
// function is how this card came to exist in the first place.
//
// ## The hole
//
// The audit binder's `beforeInsert` read
//
//   record.created_by = record.created_by ?? session.userId;                                   // client-preferred, no flag
//   record.updated_by = preserveAudit ? (record.updated_by ?? session.userId) : session.userId; // server-set
//
// — two spellings in one `if` block, one line apart. Since #15395 the
// static-`readonly` strip runs INSIDE `engine.insert`, AFTER the `beforeInsert`
// hooks, and #14259's guard reads a key a hook ASSIGNED as the hook's write
// rather than a caller forgery (`rowHookWrittenKeys`). The `??` therefore
// LAUNDERED the caller's bytes past that strip: an ordinary authenticated POST
// stored `created_by: 'forged_user'` on an object whose `created_by` is the
// registry-injected `AUDIT_FIELD_DEFS` shape, `readonly: true`.
//
// ## The card's rig, reproduced verbatim in the first case below
//
//   row0: title=a created_by=forged_user updated_by=real_user   session { userId: 'real_user' }
//   row1: title=b created_by=undefined   updated_by=undefined   session {} (no userId)
//   row2: title=c created_by=forged_user updated_by=real_user   session { userId: 'real_user' }
//
// row0/row2 carry the reading, and `updated_by` in the SAME payload is the
// in-experiment control: it proves the strip ran on this row and took the
// sibling audit field, so `created_by` surviving was "the strip ran and spared
// exactly this one", never "the strip did not run".
//
// ## row1 is an ACCEPTANCE criterion, not a nicety
//
// `created_by` is NOT symmetric with `created_at`. The `created_at` stamp is
// unconditional (driver-sql provisions that column on every table), while
// `created_by` sits inside `if (session?.userId)` and behind `hasField`. With no
// session the hook assigns nothing and the engine strip then takes the caller's
// forgery correctly — the right outcome, reached by a path this card is not
// about. So the fix stays INSIDE that guard.
//
// A shape that assigned `session.userId` unconditionally would write `undefined`
// into the key on a session-less insert, making it a key the hook "wrote"; the
// strip would then spare it, and a branch that is correct today would become a
// NEW hole. row1 pins `undefined` so that regression cannot land silently.
//
// ## Ruling
//
// Direction settled by the maintainer ruling of 2026-09-06 on #15964 (decision
// batch #54, option A, verbatim 「同意」) and applied to this sibling field per
// the triage ruling on #16311: the audit anchor may not be supplied by the
// caller on an ordinary create, and the historical-import channel keeps working
// through `preserveAudit` — what `runImport({ treatAsHistorical: true })` sets
// on the write context (`packages/rest/src/import-runner.ts`). That is why the
// fix is the `preserveAudit` ternary and not a bare `= session.userId`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

const FORGED_USER = 'forged_user';
const REAL_USER = 'real_user';
const FORGED_AT = '1999-01-01T00:00:00.000Z';
const FORGED_ID = 'conv_REST_FORGED';

describe('audit binder: create-side `created_by` (#16311)', () => {
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
    // `created_by` / `updated_by` are NOT declared here: the registry injects
    // the whole audit family from `AUDIT_FIELD_DEFS`, where `created_by` is a
    // `readonly: true` lookup to `sys_user` — the declaration the card's rig
    // describes, and the contract this fix pulls back to.
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

  const forgedPayload = (title: string) => ({
    id: FORGED_ID,
    title,
    run_at: FORGED_AT,
    created_by: FORGED_USER,
    updated_by: FORGED_USER,
  });

  /** Prints the card's own three-row table for the rows that reached the driver. */
  function printRig(rows: Record<string, any>[], sessions: string[]) {
    const cell = (v: unknown) => String(v);
    // eslint-disable-next-line no-console
    console.log(
      `\n[#16311 rig — what reached driver.create]\n` +
        rows
          .map(
            (r, i) =>
              `  row${i}: title=${cell(r.title)} created_by=${cell(r.created_by)} ` +
              `updated_by=${cell(r.updated_by)}   ${sessions[i]}`,
          )
          .join('\n') +
        '\n',
    );
  }

  it("the card's three-row rig: a forged `created_by` does NOT survive an ordinary create, and the session-less row stays `undefined`", async () => {
    const { objectql, captured } = await boot('repro_conversations');

    // row0 and row2 — an ordinary authenticated caller.
    await objectql.insert('repro_conversations', forgedPayload('a'), {
      context: { userId: REAL_USER },
    });
    // row1 — the SECOND control: no `session.userId` at all.
    await objectql.insert('repro_conversations', forgedPayload('b'), { context: {} });
    await objectql.insert('repro_conversations', forgedPayload('c'), {
      context: { userId: REAL_USER },
    });

    expect(captured.length).toBe(3);
    const [row0, row1, row2] = captured;
    printRig(captured, [
      `session { userId: '${REAL_USER}' }`,
      'session {} (no userId)',
      `session { userId: '${REAL_USER}' }`,
    ]);

    for (const row of [row0, row2]) {
      // The in-experiment controls — both were already correct BEFORE this
      // change, and a fix that closes `created_by` while opening either of them
      // is a regression on a security card.
      expect(row.id).not.toBe(FORGED_ID);
      expect(row.run_at).not.toBe(FORGED_AT);
      expect(row.updated_by).toBe(REAL_USER);

      // The card's row. Overwritten by the binder rather than deleted, so the
      // column is still a real attribution stamp.
      expect(row.created_by).not.toBe(FORGED_USER);
      expect(row.created_by).toBe(REAL_USER);
    }

    // row1 — the acceptance criterion the triage ruling makes mandatory. With
    // no session the hook must assign NOTHING, so the engine strip takes the
    // forgery and the key is absent. A shape that assigned `session.userId`
    // unconditionally would store `undefined` as a hook write and the strip
    // would spare it, turning a correct branch into a new hole.
    expect(row1.created_by).toBeUndefined();
    expect(row1.updated_by).toBeUndefined();
    // …and its own controls, proving the strip really did run on this row.
    expect(row1.id).not.toBe(FORGED_ID);
    expect(row1.run_at).not.toBe(FORGED_AT);
  });

  it('a create that sends no `created_by` is still stamped from the session (the binder keeps doing its job)', async () => {
    const { objectql, captured } = await boot('repro_plain');

    await objectql.insert('repro_plain', { title: 'x' }, { context: { userId: REAL_USER } });

    const row = captured[0];
    expect(row.created_by).toBe(REAL_USER);
    expect(row.updated_by).toBe(REAL_USER);
  });

  it('`preserveAudit` (what `treatAsHistorical` sets) still reinstates the original `created_by`', async () => {
    const { objectql, captured } = await boot('repro_historical');

    await objectql.insert('repro_historical', forgedPayload('h'), {
      context: { userId: REAL_USER, preserveAudit: true },
    });

    const row = captured[0];
    expect(row.created_by).toBe(FORGED_USER);
    // Symmetric with `updated_by`, which has had this branch since #3493.
    expect(row.updated_by).toBe(FORGED_USER);
    // …and the exemption is the audit binder's, not the strip's: an ordinary
    // author-declared readonly field is still taken on the create side
    // (2026-08-08 ruling, unchanged by this card).
    expect(row.run_at).not.toBe(FORGED_AT);
  });

  it('`preserveAudit` without a session does NOT resurrect the forgery — the guard still wins', async () => {
    const { objectql, captured } = await boot('repro_historical_anon');

    await objectql.insert('repro_historical_anon', forgedPayload('n'), {
      context: { preserveAudit: true },
    });

    // Both audit-user keys stay inside `if (session?.userId)`, so with no
    // session there is nobody to attribute the row to and nothing is written —
    // the strip takes the caller's value on both, exactly as on row1.
    const row = captured[0];
    expect(row.created_by).toBeUndefined();
    expect(row.updated_by).toBeUndefined();
  });
});
