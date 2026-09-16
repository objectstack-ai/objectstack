// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17022] ADR-0090 D10 rule 4 — 「Dual attribution: every write records
 * `performed_by` (agent) + `on_behalf_of` (user)」 — has a writer.
 *
 * ## What was measured before this file existed
 *
 * Two writes by the same human, one through an OAuth-connected MCP client and
 * one through a plain session, produced `sys_audit_log` rows that were
 * IDENTICAL on every attribution-bearing column:
 *
 *     via OAuth MCP client : {"user_id":"u_sales_manager","actor":"u_sales_manager","metadata":null, …}
 *     via plain session    : {"user_id":"u_sales_manager","actor":"u_sales_manager","metadata":null, …}
 *     attribution-bearing columns identical? true
 *     any column naming the client?          false
 *
 * `assembleExecutionContext` consumed the OAuth `azp` as a BOOLEAN and dropped
 * the value, so the acting client did not exist downstream of the door at all.
 * This file is the inverse of that reading, asserted on both rows in one run.
 *
 * ## Why it drives the chain from `assembleExecutionContext`
 *
 * A pin written at the hook layer is VACUOUS by default. `buildSession`
 * returns `undefined` when the context yields nothing session-worthy, and the
 * writer's `ctx.session ?? {}` then resolves every identity read to
 * `undefined` WITHOUT throwing — so an assertion that only says "the client is
 * not the human" passes on the early-out, before any of this code runs. The
 * control below (`user_id` is the human on BOTH rows) is what proves the
 * identity channel is open, and the fixture starts at the real door so the
 * envelope under test is the one a transport actually builds.
 *
 * ## The four seams this crosses, in one run
 *
 *   1. `@objectstack/core` — `assembleExecutionContext` decides
 *      `performedBy` on the same branch that decides `principalKind: 'agent'`;
 *   2. `@objectstack/spec` — `ExecutionContext.performedBy` and
 *      `HookContext.provenance.performedByClientId` declare it;
 *   3. `@objectstack/objectql` — `buildProvenance`'s fixed copy list carries it
 *      into the CLOSED hook-context literal. ⚠️ This package resolves
 *      `@objectstack/objectql` through its `exports` (i.e. `dist/`) by design
 *      — it is a registered entry in `check:test-source-alias`'s
 *      `KNOWN_UNALIASED_TEST_IMPORTS` — so a change to that copy list only
 *      reaches this suite after `pnpm --filter @objectstack/objectql build`;
 *   4. this package — the row.
 *
 * Omitting seam 3 would leave a key declared on a published schema and
 * populated by nothing, which is the ADR-0049 defect this card exists to
 * close, and every assertion here would still be about a real row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, assembleExecutionContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { installAuditWriters } from './audit-writers.js';
import { SysAuditLog } from './objects/index.js';

/** The compliance ledger under test — the REAL shipped object, not a stand-in. */
const LEDGER = 'sys_audit_log';
const AUDITED_OBJECT = 'contact';

/** The one human on both sides. Same person, two doors — that is the whole point. */
const HUMAN = 'u_sales_manager';
const ORG = 'org_1';
/** The registered OAuth client (`azp`) the MCP access token was issued to. */
const CLIENT = 'cli_mcp_agent';

const AGENT_RECORD = 'c_via_agent';
const HUMAN_RECORD = 'c_via_console';

/** Owning package for the harness objects — `registerObject` requires one. */
const HARNESS_PACKAGE = 'com.objectstack.audit.test';

/** The shared authorization envelope. Byte-identical on both doors. */
const AUTHZ = {
  userId: HUMAN,
  tenantId: ORG,
  email: 'manager@example.com',
  positions: ['sales_manager'],
  permissions: ['contact_read', 'contact_write'],
  systemPermissions: [],
  org_user_ids: [HUMAN],
  accessible_org_ids: [ORG],
};

const contactObject = {
  name: AUDITED_OBJECT,
  label: 'Contact',
  fields: {
    full_name: { name: 'full_name', label: 'Name', type: 'text' as const },
  },
};

/** knex wraps some results as `[rows]`; normalize both shapes. */
function rows(result: unknown): Record<string, unknown>[] {
  const list = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  expect(Array.isArray(list)).toBe(true);
  return list as Record<string, unknown>[];
}

/**
 * The columns the card is about: everything on a `sys_audit_log` row that can
 * name WHO. `object_name` / `record_id` / `action` are excluded on purpose —
 * they differ between any two writes and would make the inequality below true
 * for reasons that have nothing to do with attribution.
 */
function attributionOf(row: Record<string, unknown>) {
  return {
    user_id: row.user_id ?? null,
    actor: row.actor ?? null,
    metadata: row.metadata ?? null,
  };
}

describe('[#17022] an MCP OAuth agent’s write is attributable to the agent, not only to the human', () => {
  let kernel: ObjectKernel;
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let sql: (statement: string, bindings?: unknown[]) => Promise<unknown>;

  /** The two envelopes, built at the real door rather than hand-written. */
  let agentCtx: Record<string, unknown>;
  let humanCtx: Record<string, unknown>;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');

    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    sql = (statement, bindings) =>
      (driver as unknown as { execute(s: string, b: unknown[]): Promise<unknown> }).execute(
        statement,
        bindings ?? [],
      );

    engine.registry.registerObject(contactObject as any, HARNESS_PACKAGE);
    engine.registry.registerObject(SysAuditLog as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    // The REAL shipped record-level writer, not a stand-in for it.
    installAuditWriters(engine, HARNESS_PACKAGE);

    // Door 1 — the `/mcp` OAuth dispatch door. `clientId` present ⇒ agent.
    agentCtx = assembleExecutionContext({
      authz: { ...AUTHZ },
      oauth: {
        userId: HUMAN,
        scopes: ['data:read', 'data:write'],
        clientId: CLIENT,
        scopePermissions: ['agent_data_read', 'agent_data_write'],
        delegatesActions: false,
      },
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
      authGate: undefined,
    }) as unknown as Record<string, unknown>;

    // Door 2 — the same human in the Console. No OAuth provenance at all.
    humanCtx = assembleExecutionContext({
      authz: { ...AUTHZ },
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
      authGate: undefined,
    }) as unknown as Record<string, unknown>;

    await engine.insert(
      AUDITED_OBJECT,
      { id: AGENT_RECORD, full_name: 'Wei Zhang' },
      { context: agentCtx as any },
    );
    await engine.insert(
      AUDITED_OBJECT,
      { id: HUMAN_RECORD, full_name: 'Li Na' },
      { context: humanCtx as any },
    );
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }, 30_000);

  /** Both ledger rows, keyed by the record they describe. */
  async function ledgerRows(): Promise<Record<string, Record<string, unknown>>> {
    const list = rows(
      await sql(
        `SELECT record_id, user_id, actor, metadata FROM "${LEDGER}" WHERE object_name = ? AND action = ?`,
        [AUDITED_OBJECT, 'create'],
      ),
    );
    const byRecord: Record<string, Record<string, unknown>> = {};
    for (const row of list) byRecord[String(row.record_id)] = row;
    return byRecord;
  }

  /**
   * CONTROL — the door decided the field, and decided it only for the agent.
   *
   * Read off the envelope rather than the row, so a failure here separates
   * "`assembleExecutionContext` never carried it" from "it was carried and
   * something downstream dropped it". Absence is spelled as a MISSING KEY
   * because `emit()` drops an `undefined` decision from the closed set.
   */
  it('control — the OAuth door decides `performedBy`, and the Console door decides against it', () => {
    expect(agentCtx.principalKind).toBe('agent');
    expect(agentCtx.performedBy).toEqual({ clientId: CLIENT });

    expect(humanCtx.principalKind).toBe('human');
    expect('performedBy' in humanCtx).toBe(false);

    // The premise the card rests on: same person, both doors. If these ever
    // diverged, the rows below would differ for a reason that is not the
    // delegation.
    expect(agentCtx.userId).toBe(HUMAN);
    expect(humanCtx.userId).toBe(HUMAN);
  });

  /**
   * ANTI-VACUITY CONTROL, and the one that matters most here.
   *
   * `buildSession` returns `undefined` for a context with nothing
   * session-worthy, and the writer's `ctx.session ?? {}` then makes every
   * identity read resolve to `undefined` without throwing — so a suite can go
   * green on the early-out while measuring nothing. A `user_id` equal to the
   * real human, on BOTH rows, can only have come through that channel.
   */
  it('control — both writes reached the writer with a live identity channel', async () => {
    const byRecord = await ledgerRows();

    expect(Object.keys(byRecord).sort()).toEqual([AGENT_RECORD, HUMAN_RECORD].sort());
    expect(byRecord[AGENT_RECORD]!.user_id).toBe(HUMAN);
    expect(byRecord[HUMAN_RECORD]!.user_id).toBe(HUMAN);
  });

  /**
   * THE CARD. The delegated row names the agent that acted AND the human it
   * acted for — rule 4's pair, on the row, in the D10 vocabulary.
   */
  it('a delegated write records `performed_by` (the client) beside `on_behalf_of` (the human)', async () => {
    const row = (await ledgerRows())[AGENT_RECORD]!;

    expect(JSON.parse(String(row.metadata))).toEqual({
      performed_by: CLIENT,
      on_behalf_of: HUMAN,
    });

    // ADR-0073 D3 — attribution is not ownership. The human stays the subject
    // the write was authorized as, so the `sys_user` lookup still joins.
    expect(row.user_id).toBe(HUMAN);
    // ADR-0118 D1/D5 — `actor` stays two-valued (a user id, or null for the
    // system). "Which non-user acted" is answered by the ADDED attribution
    // field above, never by a second actor vocabulary. A reader of historical
    // rows keeps reading this column exactly as before.
    expect(row.actor).toBe(HUMAN);
  });

  /**
   * The other half of the contract: the two shapes are distinguishable by
   * ABSENCE rather than by guesswork. A personal write claims no delegation.
   */
  it('a personal write records no delegation at all', async () => {
    const row = (await ledgerRows())[HUMAN_RECORD]!;

    expect(row.metadata ?? null).toBeNull();
    expect(row.user_id).toBe(HUMAN);
    expect(row.actor).toBe(HUMAN);
  });

  /**
   * The measured defect, inverted. This is the assertion the 2026-09-10
   * probe's `attribution-bearing columns identical? true` would have failed.
   */
  it('the two rows are no longer identical on the attribution-bearing columns', async () => {
    const byRecord = await ledgerRows();
    const viaAgent = attributionOf(byRecord[AGENT_RECORD]!);
    const viaConsole = attributionOf(byRecord[HUMAN_RECORD]!);

    expect(viaAgent).not.toEqual(viaConsole);
    // And named positively, so the failure message says WHICH column carries
    // the difference rather than only that one does.
    expect(viaAgent.metadata).not.toBeNull();
    expect(viaConsole.metadata).toBeNull();
    expect(viaAgent.user_id).toBe(viaConsole.user_id);
    expect(viaAgent.actor).toBe(viaConsole.actor);
  });
});
