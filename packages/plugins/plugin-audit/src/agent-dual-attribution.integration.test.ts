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
  directPermissions: [],
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

/**
 * [ADR-0151 D5 · O4] One question for both kinds of agent, and the account
 * attributed as itself.
 *
 * Three doors over one engine, each envelope built by the REAL assembler:
 * an OAuth client acting for a person, an AI service account acting as itself
 * (its row's kind arrives on `authz.principalKind`, as `resolveAuthzContext`
 * reads it off `sys_user.principal_kind`), and the person on their own. A hook
 * on the audited object records what each write's `HookContext` said; the
 * ledger records what the writer wrote. Both read through `buildSession`
 * (objectql `dist/`, so rebuild it before an ablation reads here).
 */
describe('[ADR-0151 D5] a hook reads principalKind for both kinds of agent, and the account is the ledger\'s user_id', () => {
  const ACCOUNT = 'u_invoice_bot';
  const OAUTH_RECORD = 'c_o4_via_oauth';
  const ACCOUNT_RECORD = 'c_o4_via_account';
  const PERSON_RECORD = 'c_o4_via_person';

  let kernel: ObjectKernel;
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let sql: (statement: string, bindings?: unknown[]) => Promise<unknown>;
  /** What the hook saw, keyed by the record it saw it for (the writes run one after another). */
  const seen: Record<string, { userId: unknown; principalKind: unknown; hasKind: boolean; performedByClientId: unknown }> = {};
  let writing = '';

  const assemble = (authz: Record<string, unknown>, oauth?: Record<string, unknown>) =>
    assembleExecutionContext({
      authz: authz as any,
      oauth: oauth as any,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
      authGate: undefined,
    }) as unknown as Record<string, unknown>;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    sql = (statement, bindings) =>
      (driver as unknown as { execute(s: string, b: unknown[]): Promise<unknown> }).execute(statement, bindings ?? []);
    engine.registry.registerObject(contactObject as any, HARNESS_PACKAGE);
    engine.registry.registerObject(SysAuditLog as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    installAuditWriters(engine, HARNESS_PACKAGE);

    engine.registerHook('beforeInsert', async (ctx: any) => {
      const session = ctx.session ?? {};
      seen[writing] = {
        userId: session.userId,
        principalKind: session.principalKind,
        hasKind: 'principalKind' in session,
        performedByClientId: ctx.provenance?.performedByClientId,
      };
    }, { object: AUDITED_OBJECT });

    const oauthCtx = assemble({ ...AUTHZ }, {
      userId: HUMAN,
      scopes: ['data:read', 'data:write'],
      clientId: CLIENT,
      scopePermissions: ['agent_data_read', 'agent_data_write'],
      delegatesActions: false,
    });
    const accountCtx = assemble({
      ...AUTHZ,
      userId: ACCOUNT,
      email: 'invoice-bot@placeholder.invalid',
      positions: [],
      org_user_ids: [ACCOUNT],
      principalKind: 'agent',
    });
    const personCtx = assemble({ ...AUTHZ });

    writing = OAUTH_RECORD;
    await engine.insert(AUDITED_OBJECT, { id: OAUTH_RECORD, full_name: 'Via OAuth' }, { context: oauthCtx as any });
    writing = ACCOUNT_RECORD;
    await engine.insert(AUDITED_OBJECT, { id: ACCOUNT_RECORD, full_name: 'Via account' }, { context: accountCtx as any });
    writing = PERSON_RECORD;
    await engine.insert(AUDITED_OBJECT, { id: PERSON_RECORD, full_name: 'Via person' }, { context: personCtx as any });
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  async function ledgerRow(recordId: string): Promise<Record<string, unknown>> {
    const list = rows(await sql(
      `SELECT * FROM "${LEDGER}" WHERE object_name = ? AND action = ? AND record_id = ?`,
      [AUDITED_OBJECT, 'create', recordId],
    ));
    expect(list).toHaveLength(1);
    return list[0]!;
  }

  it('control — the hook ran for all three writes, with a live identity channel', () => {
    expect(seen[OAUTH_RECORD]?.userId).toBe(HUMAN);
    expect(seen[ACCOUNT_RECORD]?.userId).toBe(ACCOUNT);
    expect(seen[PERSON_RECORD]?.userId).toBe(HUMAN);
  });

  it('both kinds of agent read `agent`; the provenance alone tells the OAuth client from the account', () => {
    expect(seen[OAUTH_RECORD]).toMatchObject({ principalKind: 'agent', performedByClientId: CLIENT });
    expect(seen[ACCOUNT_RECORD]).toMatchObject({ principalKind: 'agent', performedByClientId: undefined });
  });

  it('CONTROL — the person on their own reads `human`', () => {
    expect(seen[PERSON_RECORD]).toMatchObject({ principalKind: 'human', hasKind: true, performedByClientId: undefined });
  });

  it('the account\'s write is its own on the ledger: `user_id` is the account, and the row names no performer, no delegator and no kind', async () => {
    const row = await ledgerRow(ACCOUNT_RECORD);
    expect(row.user_id).toBe(ACCOUNT);
    expect(row.actor).toBe(ACCOUNT);
    // ADR-0151 D5: no `performedBy` naming the account, no `on_behalf_of`
    // itself; ADR-0118 D5: no kind column, and no kind folded into metadata.
    expect(row.metadata ?? null).toBeNull();
    expect(Object.keys(row).filter((k) => /principal|kind/i.test(k))).toEqual([]);
  });
});

/**
 * [#33694, owner ruling on objectstack-ai/cloud#3826 「3826 照建议（征询版）」]
 * The in-product AI's write is marked on the ledger like the OAuth client's:
 * the agent in `performed_by` beside the person in `on_behalf_of` (the existing
 * pair, no new actor vocabulary), plus the conversation and, when the person
 * confirmed the call, the confirmation.
 *
 * The envelope starts at the real door for the PERSON (the in-product AI runs
 * as them, so it is a `human` principal) and adds the `performedBy` the
 * server-constructed in-product AI path stamps; that producer lives outside
 * this repository, so the key is set here exactly as the spec declares it.
 * Everything after the envelope is real: `buildProvenance` (objectql `dist/`,
 * rebuild it before an ablation reads here), the closed hook context and the
 * shipped writer.
 */
describe('[#33694] an in-product AI write names the agent, the conversation and the confirmation on the ledger', () => {
  const AGENT = 'data_chat';
  const CONVERSATION = 'conv_7f3a';
  const CONFIRMATION = 'pa_91c2';
  const CONFIRMED_RECORD = 'c_ai_confirmed';
  const UNCONFIRMED_RECORD = 'c_ai_unconfirmed';
  const PERSON_RECORD = 'c_ai_person_control';
  const CLIENT_MARKS_RECORD = 'c_ai_client_with_marks';
  const BOTH_PERFORMERS_RECORD = 'c_ai_both_performers';

  let kernel: ObjectKernel;
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let sql: (statement: string, bindings?: unknown[]) => Promise<unknown>;
  let personCtx: Record<string, unknown>;

  const aiCtx = (performedBy: Record<string, string>) => ({ ...personCtx, performedBy });

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    sql = (statement, bindings) =>
      (driver as unknown as { execute(s: string, b: unknown[]): Promise<unknown> }).execute(statement, bindings ?? []);
    engine.registry.registerObject(contactObject as any, HARNESS_PACKAGE);
    engine.registry.registerObject(SysAuditLog as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    installAuditWriters(engine, HARNESS_PACKAGE);

    personCtx = assembleExecutionContext({
      authz: { ...AUTHZ } as any,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
      authGate: undefined,
    }) as unknown as Record<string, unknown>;

    await engine.insert(
      AUDITED_OBJECT,
      { id: CONFIRMED_RECORD, full_name: 'Confirmed by the person' },
      { context: aiCtx({ agentId: AGENT, conversationId: CONVERSATION, confirmationId: CONFIRMATION }) as any },
    );
    await engine.insert(
      AUDITED_OBJECT,
      { id: UNCONFIRMED_RECORD, full_name: 'Needed no confirmation' },
      { context: aiCtx({ agentId: AGENT, conversationId: CONVERSATION }) as any },
    );
    await engine.insert(
      AUDITED_OBJECT,
      { id: PERSON_RECORD, full_name: 'Typed by the person' },
      { context: personCtx as any },
    );
    // No producer in the tree builds these two envelopes (each door sets only
    // its own performer key, and the OAuth door no conversation or
    // confirmation); they pin what the spec tells a reader of `performed_by`.
    await engine.insert(
      AUDITED_OBJECT,
      { id: CLIENT_MARKS_RECORD, full_name: 'Client beside stray marks' },
      { context: aiCtx({ clientId: CLIENT, conversationId: CONVERSATION, confirmationId: CONFIRMATION }) as any },
    );
    await engine.insert(
      AUDITED_OBJECT,
      { id: BOTH_PERFORMERS_RECORD, full_name: 'Both performers' },
      { context: aiCtx({ clientId: CLIENT, agentId: AGENT, conversationId: CONVERSATION, confirmationId: CONFIRMATION }) as any },
    );
    await engine.update(
      AUDITED_OBJECT,
      { full_name: 'Renamed by the AI' },
      { where: { id: PERSON_RECORD }, context: aiCtx({ agentId: AGENT, conversationId: CONVERSATION, confirmationId: CONFIRMATION }) as any },
    );
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  async function ledgerRow(recordId: string, action: 'create' | 'update'): Promise<Record<string, unknown>> {
    const list = rows(await sql(
      `SELECT * FROM "${LEDGER}" WHERE object_name = ? AND action = ? AND record_id = ?`,
      [AUDITED_OBJECT, action, recordId],
    ));
    expect(list).toHaveLength(1);
    return list[0]!;
  }

  it('CONTROL — the in-product AI runs as the person: a human principal, and `user_id` is the person on every row', async () => {
    expect(personCtx.principalKind).toBe('human');
    expect('performedBy' in personCtx).toBe(false);
    for (const [id, action] of [
      [CONFIRMED_RECORD, 'create'], [UNCONFIRMED_RECORD, 'create'], [PERSON_RECORD, 'create'], [PERSON_RECORD, 'update'],
    ] as const) {
      const row = await ledgerRow(id, action);
      expect(row.user_id, `${id} ${action}`).toBe(HUMAN);
      // ADR-0118 D1/D5: `actor` stays the person, never the agent.
      expect(row.actor, `${id} ${action}`).toBe(HUMAN);
    }
  });

  it('a confirmed AI write records the agent, the person, the conversation and the confirmation', async () => {
    const row = await ledgerRow(CONFIRMED_RECORD, 'create');
    expect(JSON.parse(String(row.metadata))).toEqual({
      performed_by: AGENT,
      on_behalf_of: HUMAN,
      conversation_id: CONVERSATION,
      confirmation_id: CONFIRMATION,
    });
  });

  it('an AI write that needed no confirmation carries no confirmation key', async () => {
    const row = await ledgerRow(UNCONFIRMED_RECORD, 'create');
    expect(JSON.parse(String(row.metadata))).toEqual({
      performed_by: AGENT,
      on_behalf_of: HUMAN,
      conversation_id: CONVERSATION,
    });
  });

  it('conversation_id / confirmation_id never ride beside an OAuth client id, so a client row carries only the pair', async () => {
    const row = await ledgerRow(CLIENT_MARKS_RECORD, 'create');
    expect(JSON.parse(String(row.metadata))).toEqual({ performed_by: CLIENT, on_behalf_of: HUMAN });
  });

  it('an envelope naming both performers is recorded as the OAuth client, without the agent\'s marks', async () => {
    const row = await ledgerRow(BOTH_PERFORMERS_RECORD, 'create');
    expect(JSON.parse(String(row.metadata))).toEqual({ performed_by: CLIENT, on_behalf_of: HUMAN });
  });

  it('an AI update of a record the person created is marked on the update row, and the person\'s own create row stays unmarked', async () => {
    const created = await ledgerRow(PERSON_RECORD, 'create');
    expect(created.metadata ?? null).toBeNull();

    const updated = await ledgerRow(PERSON_RECORD, 'update');
    expect(JSON.parse(String(updated.metadata))).toEqual({
      performed_by: AGENT,
      on_behalf_of: HUMAN,
      conversation_id: CONVERSATION,
      confirmation_id: CONFIRMATION,
    });
  });
});
