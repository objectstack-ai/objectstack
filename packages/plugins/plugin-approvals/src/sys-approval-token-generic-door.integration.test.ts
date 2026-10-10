// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22616] `sys_approval_token` — the action-link tokens of ADR-0043 — is
 * served by the GENERIC doors to no caller, as the approvals door serves it to
 * nobody. The third request-keyed table of the approval engine, after the
 * request itself (#22559) and its two child tables (#22589).
 *
 * ## Why no caller, and not "the participants"
 *
 * One operation, two implementations: the approvals door never reads a token
 * row back to anyone — the engine mints, looks up by digest and consumes them,
 * all as the system — while the generic doors served a row to any caller an
 * application granted read on the object. The governed implementation wins,
 * and the object's own declaration already said "never via the data API". So
 * the declaration now says it in the form every door enforces:
 *
 *  - `apiEnabled: false` — the declared off switch of the automatic API
 *    (`ObjectCapabilities.apiEnabled`, "Expose object via automatic APIs").
 *    `apiExposureDenialReason` judges it FIRST and for every operation, so the
 *    REST door, the dispatcher and MCP all refuse every verb, for every caller,
 *    with `404 OBJECT_API_DISABLED`; and it is the one flag the cross-object
 *    search reads (`searchAll` skips `apiEnabled === false`), which never
 *    consults `apiMethods` at all.
 *  - `apiMethods: []` — `deny-all` in the three-state table of
 *    `api-derivation.ts` (`undefined` = fully open, `[]` = fully closed). The
 *    read methods are retired rather than the key dropped: an ABSENT whitelist
 *    resolves to `unrestricted`, so dropping it would leave the whitelist
 *    advertising every operation behind the switch.
 *
 * ⛔ No visibility rule for tokens is invented here (no participant rule, no
 * approver-sees-own-tokens rule): nothing reads this object through a generic
 * door, so there is no reader to keep.
 *
 * ## What each block pins
 *
 *  - the declaration, and the decision every door delegates to: every
 *    operation refused with the `api-disabled` discriminant. The function takes
 *    no caller, so the answer is the same for a member the application granted
 *    read on the object and for an administrator;
 *  - the cross-object search, on a real engine with token rows present: no
 *    token row for any caller, while the search itself still answers;
 *  - positive control: a link minted by `remind()` still peeks, redeems once and
 *    is refused as consumed on replay — the engine's mint, lookup-by-digest and
 *    consume path runs as the system and is untouched by the door.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  API_OPERATION_ORDER,
  apiExposureDenialReason,
  canServeApiOperation,
  resolveEffectiveApiMethods,
  type EnableLike,
  type EngineQueryOptions,
} from '@objectstack/spec/data';
import { REGISTERED_ERROR_CODES } from '@objectstack/spec/api';
import type { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';

const TOKEN = 'sys_approval_token';
const OBJECT = 'tokdoor_sheet';
const ENABLE = SysApprovalToken.enable as EnableLike;

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const ADMIN = { userId: 'u_admin', positions: [], permissions: [], posture: 'PLATFORM_ADMIN' } as any;

const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
/** Takes part in no request; holds read on every object (no security plugin is mounted). */
const MEMBER = 'u_member';

describe('the declaration: the generic doors serve token rows to no caller', () => {
  it('is not exposed through the automatic API, and its whitelist grants nothing', () => {
    expect(ENABLE?.apiEnabled).toBe(false);
    expect(ENABLE?.apiMethods).toEqual([]);
    expect(resolveEffectiveApiMethods(ENABLE).mode).toBe('deny-all');
  });

  it('every operation — list, count, by id, query, search, export, and every write — is refused as api-disabled, for every caller', () => {
    // `apiExposureDenialReason` is the decision the REST door
    // (`apiAccessDenialFromEnable`), the dispatcher and the MCP bridge all turn
    // into their refusal; it takes no user, so this is the granted member's
    // answer and the administrator's alike.
    expect(API_OPERATION_ORDER.length).toBeGreaterThanOrEqual(14);
    const served = API_OPERATION_ORDER.filter((op) => apiExposureDenialReason(ENABLE, op) !== 'api-disabled');
    expect(served).toEqual([]);
    for (const child of ['create', 'update', 'delete', 'upsert']) {
      expect(apiExposureDenialReason(ENABLE, 'bulk', { bulkChild: child }), child).toBe('api-disabled');
    }
    expect(API_OPERATION_ORDER.filter((op) => canServeApiOperation(ENABLE, op))).toEqual([]);
    // The REST door's envelope for this discriminant is `404 OBJECT_API_DISABLED`
    // (`@objectstack/rest`, which this package does not depend on); the code is
    // registered vocabulary, so a rename cannot pass silently on the spec side.
    expect(REGISTERED_ERROR_CODES).toContain('OBJECT_API_DISABLED');
  });
});

interface Rig {
  engine: ObjectQL;
  svc: ApprovalService;
  protocol: any;
  links: Array<{ label: string; url: string }>;
  requestId: string;
}

let current: ObjectQL | undefined;

afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

/** A real engine, the real plugin, one pending request and the links one reminder minted. */
async function boot(): Promise<Rig> {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  const sheet = {
    name: OBJECT,
    label: 'Token Door Sheet',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
    },
  };
  for (const def of [sheet, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation, SysApprovalToken]) {
    engine.registry.registerObject(def as any, 'approvals-token-door-test', 'approvals-token-door-test');
  }
  await engine.syncSchemas();
  await engine.insert(OBJECT, { id: 'sheet_1', title: 'tokdoor ledger sheet' }, { context: SYSTEM } as any);

  // The delivered message is where a raw link exists at all: storage holds its digest only.
  const links: Rig['links'] = [];
  const services: Record<string, unknown> = {
    objectql: engine,
    messaging: {
      emit: async (event: any) => {
        for (const action of event?.payload?.actions ?? []) {
          if (typeof action?.url === 'string') links.push({ label: String(action.label), url: action.url });
        }
      },
    },
  };
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: () => {},
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
  };
  await new ApprovalsServicePlugin().start(ctx);
  const svc = services.approvals as ApprovalService;

  const opened: any = await svc.openNodeRequest({
    object: OBJECT, recordId: 'sheet_1', runId: 'run_1', nodeId: 'review', flowName: 'tokdoor_review',
    config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
    submitterId: SUBMITTER, record: { id: 'sheet_1', title: 'tokdoor ledger sheet' },
  }, asUser(SUBMITTER));
  const requestId = String(opened.id);
  await svc.remind(requestId, { actorId: SUBMITTER }, asUser(SUBMITTER));

  return { engine, svc, protocol: new ObjectStackProtocolImplementation(engine as any), links, requestId };
}

/** The raw token a delivered action link carries (relative when no public base URL is configured). */
const tokenOf = (url: string) => String(new URL(url, 'http://localhost').searchParams.get('token') ?? '');

/** The engine's own read of the token rows, as the system. */
async function tokenRows(rig: Rig): Promise<any[]> {
  return rig.engine.find(TOKEN, { context: SYSTEM } satisfies EngineQueryOptions) as Promise<any[]>;
}

describe('the cross-object search, on a real engine with token rows present', () => {
  it('the scene: one reminder minted one approve and one reject link for the concrete approver', async () => {
    const rig = await boot();
    const rows = await tokenRows(rig);
    expect(rows.map((r) => r.action).sort()).toEqual(['approve', 'reject']);
    expect(rows.every((r) => r.approver_id === APPROVER && r.request_id === rig.requestId)).toBe(true);
    expect(rig.links).toHaveLength(2);
  });

  it('serves no token row to any caller — by the bound slot, by the request, alone or swept with other objects', async () => {
    const rig = await boot();
    for (const ctx of [asUser(MEMBER), ADMIN]) {
      for (const q of [APPROVER, rig.requestId]) {
        const scoped = await rig.protocol.searchAll({ q, objects: [TOKEN], context: ctx });
        expect(scoped.hits, `${ctx.userId} ${q} scoped`).toEqual([]);
        // Swept beside other objects. (A sweep naming no object also searches
        // the page store, which this engine-only rig does not provision.)
        const swept = await rig.protocol.searchAll({ q, objects: [OBJECT, 'sys_approval_request', TOKEN], context: ctx });
        expect(swept.hits.filter((h: any) => h.object === TOKEN), `${ctx.userId} ${q} swept`).toEqual([]);
      }
    }
  });

  it('control — the search itself still answers: the business record is found', async () => {
    const rig = await boot();
    const res = await rig.protocol.searchAll({ q: 'tokdoor ledger', objects: [OBJECT], context: asUser(MEMBER) });
    expect(res.hits.map((h: any) => h.id)).toEqual(['sheet_1']);
  });
});

describe('positive control: the engine\'s own token path is unchanged', () => {
  it('a link minted by remind() peeks, redeems exactly once, and is refused as consumed on replay', async () => {
    const rig = await boot();
    const approve = rig.links.find((l) => l.label === 'Approve');
    expect(approve, 'the reminder carried an Approve link').toBeTruthy();
    const raw = tokenOf(approve!.url);
    expect(raw.length).toBeGreaterThan(0);

    expect(await rig.svc.peekActionToken(raw)).toMatchObject({ ok: true, action: 'approve', approverId: APPROVER });
    expect(await rig.svc.redeemActionToken(raw)).toMatchObject({ ok: true, action: 'approve', approverId: APPROVER });
    expect(await rig.svc.redeemActionToken(raw)).toMatchObject({ ok: false, reason: 'consumed' });

    // The engine reads its rows as the system, unnarrowed: the redeemed one is consumed.
    const rows = await tokenRows(rig);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.consumed_at).map((r) => r.action)).toEqual(['approve']);
    const request: any = await rig.engine.findOne('sys_approval_request', { where: { id: rig.requestId }, context: SYSTEM } as any);
    expect(request?.status).toBe('approved');
  });
});
