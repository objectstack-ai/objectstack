
import { describe, it, expect } from 'vitest';
import { 
  GetDataRequestSchema, 
  GetDataResponseSchema,
  FindDataRequestSchema,
  FindDataResponseSchema,
  HttpFindQueryParamsSchema,
  CreateDataRequestSchema,
  CreateDataResponseSchema,
  UpdateDataRequestSchema,
  DeleteDataResponseSchema,
  BatchDataRequestSchema,
  CreateManyDataResponseSchema,
  UpdateManyDataRequestSchema,
  DeleteManyDataRequestSchema,
  // View-management schemas removed with the retired ViewProtocol (#6239, v17)
  // Permissions
  CheckPermissionRequestSchema,
  CheckPermissionResponseSchema,
  GetObjectPermissionsRequestSchema,
  GetObjectPermissionsResponseSchema,
  GetEffectivePermissionsResponseSchema,
  // Workflow schemas removed with the retired slot (#4451, v17)
  // Realtime
  RealtimeConnectRequestSchema,
  RealtimeConnectResponseSchema,
  RealtimeSubscribeRequestSchema,
  RealtimeSubscribeResponseSchema,
  SetPresenceRequestSchema,
  GetPresenceResponseSchema,
  // Notifications
  RegisterDeviceRequestSchema,
  RegisterDeviceResponseSchema,
  NotificationPreferencesSchema,
  NotificationSchema,
  ListNotificationsRequestSchema,
  ListNotificationsResponseSchema,
  MarkNotificationsReadRequestSchema,
  // AI
  AiChatRequestSchema,
  AiAgentsResponseSchema,
  AiAgentChatRequestSchema,
  ListAiPendingActionsRequestSchema,
  ListAiPendingActionsResponseSchema,
  ApproveAiPendingActionResponseSchema,
  RejectAiPendingActionResponseSchema,
  AiChatResponseSchema,
  AiCompleteRequestSchema,
  AiModelsResponseSchema,
  CreateAiConversationRequestSchema,
  ListAiConversationsResponseSchema,
  UpdateAiConversationRequestSchema,
  // i18n
  GetLocalesResponseSchema,
  GetTranslationsRequestSchema,
  GetTranslationsResponseSchema,
  GetFieldLabelsRequestSchema,
  GetFieldLabelsResponseSchema,
} from './protocol.zod';
import type { ListNotificationsRequest } from './protocol.zod';
import { expectTypeOf } from 'vitest';
import type {
  MetadataProtocol,
  GetMetaItemLayeredRequest,
  GetMetaItemLayeredResponse,
} from './protocol.zod';

describe('ObjectStack Protocol', () => {

  it('validates GetData', () => {
    const request = {
      object: 'project',
      id: 'p1'
    };
    expect(GetDataRequestSchema.safeParse(request).success).toBe(true);

    const response = {
      object: 'project',
      id: 'p1',
      record: { id: 'p1', name: 'Project A' }
    };
    expect(GetDataResponseSchema.safeParse(response).success).toBe(true);
  });

  it('validates FindData', () => {
    const request = {
      object: 'project',
      query: {
        object: 'project',
        where: { status: 'active' }
      }
    };
    expect(FindDataRequestSchema.safeParse(request).success).toBe(true);

    const response = {
      object: 'project',
      records: [
        { id: 'p1', name: 'Project A', status: 'active' }
      ],
      total: 1
    };
    expect(FindDataResponseSchema.safeParse(response).success).toBe(true);
  });

  it('validates CRUD Operations', () => {
    const createReq = {
      object: 'task',
      data: { title: 'New Task' }
    };
    expect(CreateDataRequestSchema.safeParse(createReq).success).toBe(true);

    const createRes = {
        object: 'task',
        id: 't1',
        record: { id: 't1', title: 'New Task' }
    };
    expect(CreateDataResponseSchema.safeParse(createRes).success).toBe(true);

    const updateReq = {
      object: 'task',
      id: 't1',
      data: { status: 'completed' }
    };
    expect(UpdateDataRequestSchema.safeParse(updateReq).success).toBe(true);

    const deleteRes = {
      object: 'task',
      id: 't1',
      success: true
    };
    expect(DeleteDataResponseSchema.safeParse(deleteRes).success).toBe(true);
  });

  it('validates Batch Operations', () => {
    const batchReq = {
      object: 'task',
      request: {
        operation: 'create',
        records: [{ data: { title: 'T1' } }]
      }
    };
    expect(BatchDataRequestSchema.safeParse(batchReq).success).toBe(true);
  });

  it('validates Bulk Operations', () => {
    const createManyRes = {
      object: 'task',
      records: [{ id: 't1' }, { id: 't2' }],
      count: 2
    };
    expect(CreateManyDataResponseSchema.safeParse(createManyRes).success).toBe(true);

    const updateManyReq = {
      object: 'task',
      records: [{ id: 't1', data: { status: 'done' } }],
      options: { atomic: true }
    };
    expect(UpdateManyDataRequestSchema.safeParse(updateManyReq).success).toBe(true);

    const deleteManyReq = {
      object: 'task',
      ids: ['t1', 't2'],
      options: { atomic: false }
    };
    expect(DeleteManyDataRequestSchema.safeParse(deleteManyReq).success).toBe(true);
  });

  it('no longer publishes a viewId-addressed view CRUD surface (#6239)', async () => {
    // Retired at protocol 17: five methods, ten schemas, zero implementations
    // and zero routes — and already mis-read once as the contract of
    // `GET /ui/view/:object/:type` (#5948). The unit test that stood here
    // asserted the ten shapes parse; the shapes are what was removed, so it is
    // replaced wholesale rather than re-spelled (the retirement playbook's
    // third fixture disposition — an assertion that keeps passing because
    // nothing is produced is not coverage).
    //
    // Reverse verification, direction predicted first: these are
    // `false`-expecting existence checks over a runtime namespace, so restoring
    // any removed limb turns exactly this test red. Plain red, not one of the
    // inverted directions — nothing downstream counts these names.
    const protocol = await import('./protocol.zod');
    for (const name of [
      'ListViewsRequestSchema', 'ListViewsResponseSchema',
      'GetViewRequestSchema', 'GetViewResponseSchema',
      'CreateViewRequestSchema', 'CreateViewResponseSchema',
      'UpdateViewRequestSchema', 'UpdateViewResponseSchema',
      'DeleteViewRequestSchema', 'DeleteViewResponseSchema',
    ]) {
      expect(name in protocol, `${name} must not be exported`).toBe(false);
    }
  });

  it('keeps the two view surfaces that ARE routed', async () => {
    // The point of the removal, asserted positively so a later reader cannot
    // mistake it for "views left the protocol". `getUiView` serves the resolved
    // render-time view; the stored definition travels on the generic metadata
    // methods with `type: 'view'`.
    const protocol = await import('./protocol.zod');
    expect('GetUiViewRequestSchema' in protocol).toBe(true);
    expect('GetUiViewResponseSchema' in protocol).toBe(true);
    expect('GetMetaItemRequestSchema' in protocol).toBe(true);
    expect('SaveMetaItemRequestSchema' in protocol).toBe(true);
  });

  it('validates Permissions operations', () => {
    expect(CheckPermissionRequestSchema.safeParse({
      object: 'account',
      action: 'edit',
      recordId: 'a1',
    }).success).toBe(true);
    expect(CheckPermissionResponseSchema.safeParse({ allowed: false, reason: 'Insufficient privileges' }).success).toBe(true);
    expect(GetObjectPermissionsRequestSchema.safeParse({ object: 'account' }).success).toBe(true);
    expect(GetObjectPermissionsResponseSchema.safeParse({
      object: 'account',
      permissions: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false },
      fieldPermissions: { email: { readable: true, editable: false } },
    }).success).toBe(true);
    expect(GetEffectivePermissionsResponseSchema.safeParse({
      objects: { account: { allowRead: true } },
      systemPermissions: ['manage_users', 'view_reports'],
    }).success).toBe(true);
    // #3391: the effective response carries per-object apiOperations.
    const withOps = GetEffectivePermissionsResponseSchema.safeParse({
      objects: { account: { allowRead: true, apiOperations: ['get', 'list', 'export'] } },
      systemPermissions: [],
    });
    expect(withOps.success).toBe(true);
    if (withOps.success) {
      expect((withOps.data.objects.account as any).apiOperations).toEqual(['get', 'list', 'export']);
    }
  });

  // 'validates Workflow operations' removed (#4451, v17): the workflow
  // schemas were deleted with the retired slot — nothing ever implemented
  // the protocol they described.

  it('validates Realtime operations', () => {
    expect(RealtimeConnectRequestSchema.safeParse({
      transport: 'websocket', channels: ['project.updates'], token: 'tok_abc',
    }).success).toBe(true);
    expect(RealtimeConnectResponseSchema.safeParse({
      connectionId: 'conn_1', transport: 'websocket', url: 'wss://rt.example.com',
    }).success).toBe(true);
    expect(RealtimeSubscribeRequestSchema.safeParse({
      channel: 'project.updates', events: ['record.created', 'record.updated'],
    }).success).toBe(true);
    expect(RealtimeSubscribeResponseSchema.safeParse({
      subscriptionId: 'sub_1', channel: 'project.updates',
    }).success).toBe(true);
    expect(SetPresenceRequestSchema.safeParse({
      channel: 'project.updates',
      state: { userId: 'u1', status: 'online', lastSeen: '2024-01-15T10:00:00Z' },
    }).success).toBe(true);
    expect(GetPresenceResponseSchema.safeParse({
      channel: 'project.updates',
      members: [{ userId: 'u1', status: 'online', lastSeen: '2024-01-15T10:00:00Z' }],
    }).success).toBe(true);
  });

  it('validates Notification operations', () => {
    expect(RegisterDeviceRequestSchema.safeParse({
      token: 'fcm_token_xyz', platform: 'android', deviceId: 'dev_1', name: 'Pixel 8',
    }).success).toBe(true);
    expect(RegisterDeviceResponseSchema.safeParse({ deviceId: 'dev_1', success: true }).success).toBe(true);
    expect(NotificationPreferencesSchema.safeParse({
      email: true, push: true, inApp: true, digest: 'daily',
      channels: { alerts: { enabled: true, push: false } },
    }).success).toBe(true);
    expect(NotificationSchema.safeParse({
      id: 'n1', type: 'task_assigned', title: 'New Task', body: 'You were assigned a task',
      read: false, actionUrl: '/tasks/t1', createdAt: '2024-01-15T10:00:00Z',
    }).success).toBe(true);
    expect(ListNotificationsRequestSchema.safeParse({ read: false, limit: 10 }).success).toBe(true);
    expect(ListNotificationsResponseSchema.safeParse({
      notifications: [{ id: 'n1', type: 'info', title: 'Hi', body: 'Hello', read: false, createdAt: '2024-01-15T10:00:00Z' }],
      unreadCount: 1,
    }).success).toBe(true);
    expect(MarkNotificationsReadRequestSchema.safeParse({ ids: ['n1', 'n2'] }).success).toBe(true);
  });

  /**
   * [#6361] `GET /api/v1/notifications` declares no pagination — on either half.
   *
   * Maintainer ruling 2026-08-07 (Option A), ruled jointly with #6363: one
   * capability's two halves are never half-deleted. `cursor` was declared on the
   * request AND the response and honoured on neither, and `limit` declared a
   * `.default(20)` no request path has ever applied (the server windows at 50).
   *
   * Asserted on the SHAPES rather than only through `safeParse`, and that choice
   * is the whole point: both retired keys were `optional`, so every parse was
   * green before the removal and every parse is green after it. A value-level
   * test cannot see this class of defect at all — which is exactly why the
   * family's double-assertion ratchet (#3877 Stage D) was blind to it.
   */
  it('[#6361] tombstones `cursor` on BOTH halves, with the prescription', () => {
    // BOTH halves or neither — the ruling's "one capability, two halves" clause,
    // asserted rather than trusted. A half-deletion is the specific outcome the
    // maintainer ruled out, so it gets a test rather than a comment.
    for (const [half, schema] of [
      ['request', ListNotificationsRequestSchema],
      ['response', ListNotificationsResponseSchema],
    ] as const) {
      const probe = half === 'request'
        ? { read: false, limit: 10, cursor: 'n_42' }
        : { notifications: [], unreadCount: 0, cursor: 'n_42' };
      const result = schema.safeParse(probe);

      // Refused, not stripped. Neither schema is `.strict()`, so a BARE DELETION
      // would have parsed this cleanly and dropped the key — the silent-strip
      // class (#3733, ADR-0104), i.e. the very defect this issue reports,
      // re-created one layer down. That is why the assertion is on the refusal.
      expect(result.success, `${half} half must refuse a retired \`cursor\``).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'cursor');
      expect(issue, `${half} half must fault on the \`cursor\` path`).toBeDefined();

      // The message IS the migration doc (retiredKey's contract), so its
      // substance is asserted, not merely its existence: what was removed, that
      // the route is not paginated, and the replacement to reach for.
      expect(issue!.message).toMatch(/`cursor` was removed from GET \/api\/v1\/notifications/);
      expect(issue!.message).toMatch(/not paginated/i);
      expect(issue!.message).toMatch(/limit/);
      expect(issue!.message).toMatch(/#6361/);
    }

    // `tsc` is the first channel retiredKey buys — the input type is `never`.
    // Pinned as a compile-time fact so deleting the tombstone cannot pass as a
    // refactor. @ts-expect-error fails the build if the key becomes writable.
    // @ts-expect-error `cursor` is retired: its input type is `never`.
    const rejectedByTsc: ListNotificationsRequest = { cursor: 'n_42' };
    void rejectedByTsc;

    // The surviving keys, named. `limit` is plainly optional now — parsing an
    // empty query stamps NO number onto it, where it used to stamp 20 that no
    // request path had ever applied. Stated through the parse result so it holds
    // if Zod's internal representation of a default ever moves.
    expect(Object.keys((ListNotificationsRequestSchema as any).shape)).toEqual(['read', 'type', 'limit', 'cursor']);
    const parsedEmpty = ListNotificationsRequestSchema.parse({});
    expect(Object.prototype.hasOwnProperty.call(parsedEmpty, 'limit')).toBe(false);
    expect(ListNotificationsRequestSchema.parse({ limit: 7 }).limit).toBe(7);
    // The response half keeps exactly #6363's landed business, and gains nothing.
    expect(ListNotificationsResponseSchema.safeParse({ notifications: [], unreadCount: 0 }).success).toBe(true);
  });

  /**
   * These replace the `AiNlq*` / `AiSuggest*` / `AiInsights*` cases (#3718).
   * Those parsed cleanly for years against endpoints no repo has ever mounted
   * — a schema is a shape, never evidence that anything serves it. What is
   * asserted here is the shape of the routes `service-ai` really mounts, which
   * `cloud`'s ledger checks against `buildAIRoutes()` itself.
   */
  it('validates AI operations', () => {
    // chat — Vercel `useChat` flat form, and the JSON (stream:false) reply
    expect(AiChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'how many open orders?' }],
      system: 'You are a helpful assistant', model: 'gpt-4o-mini', stream: false,
    }).success).toBe(true);
    // v6 `parts` messages carry no `content` at all — the routes accept them
    expect(AiChatRequestSchema.safeParse({
      messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }],
    }).success).toBe(true);
    expect(AiChatRequestSchema.safeParse({ messages: [] }).success, 'the routes 400 an empty message list').toBe(false);
    expect(AiChatResponseSchema.safeParse({
      content: '42 open orders', model: 'gpt-4o-mini',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, conversationId: 'conv_1',
    }).success).toBe(true);

    // complete
    expect(AiCompleteRequestSchema.safeParse({ prompt: 'Summarise:', options: { maxTokens: 64 } }).success).toBe(true);
    expect(AiCompleteRequestSchema.safeParse({}).success).toBe(false);

    // models — both live shapes: the ADR-0028 allowlist and the bare-id fallback
    expect(AiModelsResponseSchema.safeParse({
      models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini', default: true }], defaultModel: 'gpt-4o-mini',
    }).success).toBe(true);
    expect(AiModelsResponseSchema.safeParse({ models: ['gpt-4o-mini'] }).success).toBe(true);

    // conversations
    expect(CreateAiConversationRequestSchema.safeParse({ title: 'Q3 pipeline', metadata: { source: 'sdk' } }).success).toBe(true);
    expect(ListAiConversationsResponseSchema.safeParse({
      conversations: [{
        id: 'conv_1', messages: [{ role: 'user', content: 'hi' }],
        createdAt: '2026-07-27T10:00:00Z', updatedAt: '2026-07-27T10:00:00Z',
      }],
    }).success).toBe(true);
    expect(UpdateAiConversationRequestSchema.safeParse({ title: 'Renamed' }).success).toBe(true);
    expect(
      UpdateAiConversationRequestSchema.safeParse({}).success,
      'PATCH with neither title nor metadata is a 400 on the wire',
    ).toBe(false);

    // agents — the named-agent surface `objectui` hand-built URLs for (#3718)
    expect(AiAgentsResponseSchema.safeParse({
      agents: [{
        name: 'build', label: 'Builder', role: 'authoring',
        capabilities: { authoring: true, canvas: true, debug: true, resume: true },
      }],
    }).success).toBe(true);
    expect(
      AiAgentsResponseSchema.safeParse({ agents: [] }).success,
      'an access-filtered catalog is legitimately empty for a seat-less caller',
    ).toBe(true);
    expect(
      AiAgentsResponseSchema.safeParse({ agents: [{ name: 'build', label: 'Builder', role: 'authoring' }] }).success,
      'capabilities drive UI affordances — a row without them is not a row this route returns',
    ).toBe(false);
    expect(AiAgentChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'add a status field' }],
      context: { appId: 'crm', objectName: 'account' },
    }).success).toBe(true);
    expect(
      AiAgentChatRequestSchema.safeParse({ messages: [] }).success,
      'the agent chat route 400s an empty message list, same as /ai/chat',
    ).toBe(false);

    // pending actions — the HITL queue
    expect(ListAiPendingActionsResponseSchema.safeParse({
      items: [{
        id: 'pa_1', object_name: 'account', action_name: 'update', tool_name: 'record_update',
        tool_input: '{"id":"a_1"}', status: 'pending', proposed_at: '2026-07-27T10:00:00Z',
      }],
      total: 1,
    }).success).toBe(true);
    expect(
      ListAiPendingActionsRequestSchema.safeParse({ status: 'archived' }).success,
      'status is the persisted lifecycle enum, not free text',
    ).toBe(false);
    expect(ListAiPendingActionsRequestSchema.safeParse({ status: 'pending', limit: 20 }).success).toBe(true);
    // Approval and execution are separate outcomes on one 200 response: a tool
    // that fails after approval is `status: 'failed'`, NOT an HTTP error. A
    // caller reading only `res.ok` reports a failed write as a success.
    expect(ApproveAiPendingActionResponseSchema.safeParse({ status: 'executed', result: { id: 'a_1' } }).success).toBe(true);
    expect(ApproveAiPendingActionResponseSchema.safeParse({ status: 'failed', error: 'row locked' }).success).toBe(true);
    expect(
      ApproveAiPendingActionResponseSchema.safeParse({ status: 'rejected' }).success,
      'approve never yields "rejected" — that is the other route',
    ).toBe(false);
    expect(RejectAiPendingActionResponseSchema.safeParse({ status: 'rejected', id: 'pa_1' }).success).toBe(true);
  });

  it('validates i18n operations', () => {
    expect(GetLocalesResponseSchema.safeParse({
      locales: [
        { code: 'en-US', label: 'English (US)', isDefault: true },
        { code: 'es-ES', label: 'Spanish (Spain)' },
      ],
    }).success).toBe(true);
    expect(GetTranslationsRequestSchema.safeParse({ locale: 'en-US' }).success).toBe(true);
    // The request is locale-only. `namespace`/`keys` were declared here but read
    // by no serving surface, so they were trimmed (#3676). Asserting on the
    // PARSED OUTPUT is the point: `safeParse` still succeeds on a payload
    // carrying them (z.object strips unknown keys), so a success-only assertion
    // would keep passing green whether the fields were trimmed or not.
    const trimmed = GetTranslationsRequestSchema.parse({ locale: 'en-US', namespace: 'objects', keys: ['a'] });
    expect(trimmed).toEqual({ locale: 'en-US' });
    expect(GetTranslationsResponseSchema.safeParse({
      locale: 'en-US',
      translations: { objects: { task: { label: 'Task', pluralLabel: 'Tasks' } }, messages: { save: 'Save' } },
    }).success).toBe(true);
    expect(GetFieldLabelsRequestSchema.safeParse({ object: 'task', locale: 'en-US' }).success).toBe(true);
    expect(GetFieldLabelsResponseSchema.safeParse({
      object: 'task', locale: 'en-US',
      labels: { status: { label: 'Status', help: 'Current task status', options: { open: 'Open', closed: 'Closed' } } },
    }).success).toBe(true);
  });

});

// ==========================================
// GetDiscoveryResponseSchema — capabilities
// ==========================================
import { GetDiscoveryResponseSchema } from './protocol.zod';
import { WELL_KNOWN_CAPABILITY_KEYS } from './discovery.zod';

describe('GetDiscoveryResponseSchema (capabilities)', () => {
  /** The full vocabulary as hierarchical descriptors, all off. */
  const allCapabilitiesOff = () =>
    Object.fromEntries(WELL_KNOWN_CAPABILITY_KEYS.map(k => [k, { enabled: false }]));

  it('should accept response with hierarchical capabilities', () => {
    const result = GetDiscoveryResponseSchema.safeParse({
      version: 'v1',
      name: 'ObjectStack API',
      capabilities: {
        ...allCapabilitiesOff(),
        comments: { enabled: true, features: { threaded: true } },
        automation: { enabled: false },
        search: { enabled: true, description: 'Full-text search' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities?.comments?.enabled).toBe(true);
      expect(result.data.capabilities?.comments?.features?.threaded).toBe(true);
      expect(result.data.capabilities?.automation?.enabled).toBe(false);
    }
  });

  // [#5672] This fixture used to lead with `feed: { enabled: true }` and assert
  // it round-tripped. It did — `capabilities` was an open `z.record`, so a key
  // no producer emits and no consumer reads looked exactly like a real one.
  // That is the phantom the closed vocabulary removes, and it is worth a test
  // of its own rather than a silent deletion.
  it('[#5672] rejects a capability key outside the vocabulary', () => {
    const result = GetDiscoveryResponseSchema.safeParse({
      version: 'v1',
      name: 'ObjectStack API',
      capabilities: { ...allCapabilitiesOff(), feed: { enabled: true } },
    });

    // A zod object STRIPS unknown keys rather than failing, so the parse itself
    // stays green — the fact to pin is that `feed` does not survive into the
    // parsed value, i.e. a consumer reading the spec-parsed body can never see
    // it. (The producers' own gates carry the complementary key-set check that
    // makes emitting it an error rather than a silent drop.)
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).not.toHaveProperty('feed');
    }
  });

  it('[#5672] rejects a capability map that is missing part of the vocabulary', () => {
    const { comments: _dropped, ...partial } = allCapabilitiesOff();
    const result = GetDiscoveryResponseSchema.safeParse({
      version: 'v1',
      name: 'ObjectStack API',
      capabilities: partial,
    });

    // `.partial()` makes the `capabilities` BLOCK optional at this layer; it
    // does not make the vocabulary inside it optional. Present ⇒ complete.
    expect(result.success).toBe(false);
  });

  it('should accept response without capabilities (optional)', () => {
    const result = GetDiscoveryResponseSchema.safeParse({
      version: 'v1',
      apiName: 'ObjectStack API',
    });
    // Still optional HERE and only here: `GetDiscoveryResponseSchema` is
    // `DiscoverySchema.partial()`, the lenient wire wrapper. The canonical
    // `DiscoverySchema` — the one every producer's conformance gate parses
    // against since #4828 — requires it (#5672).
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toBeUndefined();
    }
  });

  it('should accept response with apiName for backward compatibility', () => {
    const result = GetDiscoveryResponseSchema.safeParse({
      version: 'v1',
      apiName: 'ObjectStack API',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiName).toBe('ObjectStack API');
    }
  });

  it('should accept full DiscoverySchema-compatible response', () => {
    const result = GetDiscoveryResponseSchema.safeParse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'development',
      routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
      locale: { default: 'en', supported: ['en'], timezone: 'UTC' },
      services: {
        data: { enabled: true, status: 'available', route: '/api/v1/data', provider: 'kernel' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('ObjectStack');
      expect(result.data.environment).toBe('development');
    }
  });
});

// ==========================================
// GetDataRequestSchema — select/expand params
// ==========================================

describe('GetDataRequestSchema (select/expand)', () => {
  it('should accept request with select and expand', () => {
    const result = GetDataRequestSchema.safeParse({
      object: 'contact',
      id: 'c1',
      select: ['name', 'email'],
      expand: ['account', 'owner'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.select).toEqual(['name', 'email']);
      expect(result.data.expand).toEqual(['account', 'owner']);
    }
  });

  it('should accept request without select/expand (optional)', () => {
    const result = GetDataRequestSchema.safeParse({
      object: 'contact',
      id: 'c1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.select).toBeUndefined();
      expect(result.data.expand).toBeUndefined();
    }
  });

  it('should strip unknown query parameters via strict parsing', () => {
    const result = GetDataRequestSchema.strict().safeParse({
      object: 'contact',
      id: 'c1',
      select: ['name'],
      // Unknown params that should be rejected by strict mode
      unknownParam: 'should-be-stripped',
    });
    expect(result.success).toBe(false);
  });
});

// ==========================================
// HttpFindQueryParamsSchema — HTTP parameter naming
// ==========================================

describe('HttpFindQueryParamsSchema', () => {
  it('should accept canonical filter (singular) parameter', () => {
    const result = HttpFindQueryParamsSchema.safeParse({
      filter: '{"status":"active"}',
      select: 'name,email',
      top: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filter).toBe('{"status":"active"}');
      expect(result.data.top).toBe(10);
    }
  });

  it('should accept deprecated filters (plural) parameter for backward compat', () => {
    const result = HttpFindQueryParamsSchema.safeParse({
      filters: '{"status":"active"}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters).toBe('{"status":"active"}');
    }
  });

  it('should coerce string numbers for top/skip', () => {
    const result = HttpFindQueryParamsSchema.safeParse({
      top: '25',
      skip: '50',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.top).toBe(25);
      expect(result.data.skip).toBe(50);
    }
  });

  it('should accept sort, orderBy, expand, search, count', () => {
    const result = HttpFindQueryParamsSchema.safeParse({
      sort: 'name asc,created_at desc',
      expand: 'owner,account',
      search: 'John',
      count: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects ?distinct — the querystring spelling of the removed query.distinct (#4286)', () => {
    const result = HttpFindQueryParamsSchema.safeParse({ distinct: true });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/query\.distinct.*removed/s);
  });

  it('should accept empty object (all params optional)', () => {
    expect(HttpFindQueryParamsSchema.safeParse({}).success).toBe(true);
  });
});

import { SaveMetaItemResponseSchema } from './protocol.zod';

/**
 * #5745 — `SaveMetaItemResponseSchema` must describe the FULL body the save
 * route returns, not a subset of it.
 *
 * Before this suite the declaration was `{ success, message? }`, so parsing a
 * real response silently DROPPED `version` / `seq` / `state` /
 * `projectionApplied` — `safeParse` stayed green while the data disappeared,
 * which is the worst shape of failure to leave for a consumer. The first case
 * below is the one that was red: it asserts nothing is stripped.
 *
 * Optionality is measured, not assumed (evidence in the PR): the sole producer
 * always emits `version` / `seq` / `state` on its only reachable success
 * return, and emits `projectionApplied` only when an ADR-0094 mutation
 * projector is registered for the type.
 */
describe('SaveMetaItemResponseSchema (#5745 — declares the full save response)', () => {
  /** A verbatim capture of a real `saveMetaItem` return (repo write path). */
  const realResponse = {
    success: true,
    version: 'sha256:7aad99c8d969efb5067fff275fb3e5be7ec90f9cd610d41709fcddbf8c34b1f0',
    seq: 1,
    state: 'active',
    message: 'Saved customization overlay (org=org_x, state=active) — type=view, name=cases [seq=1]',
  };

  it('round-trips a real response without stripping any field', () => {
    const parsed = SaveMetaItemResponseSchema.parse(realResponse);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(realResponse).sort());
    expect(parsed).toEqual(realResponse);
  });

  it('carries the ADR-0008 OCC token: version survives parse as the If-Match value', () => {
    const parsed = SaveMetaItemResponseSchema.parse(realResponse);
    expect(parsed.version).toBe(realResponse.version);
  });

  it('keeps seq as an integer and rejects a fractional one', () => {
    expect(SaveMetaItemResponseSchema.parse(realResponse).seq).toBe(1);
    expect(SaveMetaItemResponseSchema.safeParse({ ...realResponse, seq: 1.5 }).success).toBe(false);
  });

  it('accepts both lifecycle states and rejects any other', () => {
    expect(SaveMetaItemResponseSchema.safeParse({ ...realResponse, state: 'draft' }).success).toBe(true);
    expect(SaveMetaItemResponseSchema.safeParse({ ...realResponse, state: 'active' }).success).toBe(true);
    expect(SaveMetaItemResponseSchema.safeParse({ ...realResponse, state: 'published' }).success).toBe(false);
  });

  it('requires version / seq / state — the producer always emits them', () => {
    for (const missing of ['version', 'seq', 'state'] as const) {
      const body: Record<string, unknown> = { ...realResponse };
      delete body[missing];
      expect(
        SaveMetaItemResponseSchema.safeParse(body).success,
        `omitting '${missing}' must fail parse`,
      ).toBe(false);
    }
  });

  it('leaves projectionApplied optional — absent means no projector ran', () => {
    expect(SaveMetaItemResponseSchema.safeParse(realResponse).success).toBe(true);
    const withProjection = SaveMetaItemResponseSchema.parse({
      ...realResponse,
      projectionApplied: { success: false, error: 'boom-from-projector' },
    });
    expect(withProjection.projectionApplied).toEqual({ success: false, error: 'boom-from-projector' });
  });

  it('projectionApplied.success is required once the key is present', () => {
    expect(
      SaveMetaItemResponseSchema.safeParse({ ...realResponse, projectionApplied: { error: 'x' } }).success,
    ).toBe(false);
  });
});

import { PublishMetaItemResponseSchema } from './protocol.zod';

/**
 * #7294 — the same suite one door over, for `POST /meta/:type/:name/publish`.
 *
 * The publish door had NO declaration at all: `PublishMetaItem` appeared
 * nowhere under `packages/spec/src/`, so its `version` — the same ADR-0008 OCC
 * token the save door already declares — rode the wire with no contract behind
 * it, and `PublishMetaItemResponse` could not be named at the type level.
 *
 * Optionality is measured, not assumed (evidence in the PR): the sole producer
 * is `ObjectStackProtocolImplementation.publishMetaItem`, whose single response
 * literal always sets `success` / `version` / `seq`, and attaches each of the
 * three `*Applied` receipts only when the matching side effect ran.
 */
describe('PublishMetaItemResponseSchema (#7294 — declares the full publish response)', () => {
  /** A verbatim capture of a real `publishMetaItem` return (promotion path). */
  const realResponse = {
    success: true,
    version: 'sha256:7aad99c8d969efb5067fff275fb3e5be7ec90f9cd610d41709fcddbf8c34b1f0',
    seq: 2,
    message: 'Published draft — type=view, name=cases [seq=2]',
  };

  it('round-trips a real response without stripping any field', () => {
    const parsed = PublishMetaItemResponseSchema.parse(realResponse);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(realResponse).sort());
    expect(parsed).toEqual(realResponse);
  });

  it('carries the ADR-0008 OCC token: version survives parse as the If-Match value', () => {
    expect(PublishMetaItemResponseSchema.parse(realResponse).version).toBe(realResponse.version);
  });

  it('keeps seq as an integer and rejects a fractional one', () => {
    expect(PublishMetaItemResponseSchema.parse(realResponse).seq).toBe(2);
    expect(PublishMetaItemResponseSchema.safeParse({ ...realResponse, seq: 2.5 }).success).toBe(false);
  });

  it('requires success / version / seq — the producer always emits them', () => {
    for (const missing of ['success', 'version', 'seq'] as const) {
      const body: Record<string, unknown> = { ...realResponse };
      delete body[missing];
      expect(
        PublishMetaItemResponseSchema.safeParse(body).success,
        `omitting '${missing}' must fail parse`,
      ).toBe(false);
    }
  });

  it('carries seedApplied — present only when a `seed` was published', () => {
    expect(PublishMetaItemResponseSchema.safeParse(realResponse).success).toBe(true);
    const withSeed = PublishMetaItemResponseSchema.parse({
      ...realResponse,
      seedApplied: { success: true, inserted: 3, updated: 1 },
    });
    expect(withSeed.seedApplied).toEqual({ success: true, inserted: 3, updated: 1 });
    // The loader's per-record failure list is part of the shape, not extra
    // baggage the schema drops on the floor.
    const withErrors = PublishMetaItemResponseSchema.parse({
      ...realResponse,
      seedApplied: { success: false, inserted: 0, updated: 0, errors: [{ row: 1, reason: 'bad ref' }] },
    });
    expect(withErrors.seedApplied?.errors).toHaveLength(1);
  });

  it('seedApplied counters are required integers once the key is present', () => {
    expect(
      PublishMetaItemResponseSchema.safeParse({ ...realResponse, seedApplied: { success: true } }).success,
    ).toBe(false);
    expect(
      PublishMetaItemResponseSchema.safeParse({
        ...realResponse, seedApplied: { success: true, inserted: 1.5, updated: 0 },
      }).success,
    ).toBe(false);
  });

  it('carries materializeApplied — present only when an ADR-0086 P2 materializer is registered', () => {
    const parsed = PublishMetaItemResponseSchema.parse({
      ...realResponse,
      materializeApplied: { success: false, inserted: 0, updated: 0, error: 'boom-from-materializer' },
    });
    expect(parsed.materializeApplied)
      .toEqual({ success: false, inserted: 0, updated: 0, error: 'boom-from-materializer' });
  });

  it('carries projectionApplied — the same ADR-0094 receipt the save door declares', () => {
    const parsed = PublishMetaItemResponseSchema.parse({
      ...realResponse,
      projectionApplied: { success: false, error: 'boom-from-projector' },
    });
    expect(parsed.projectionApplied).toEqual({ success: false, error: 'boom-from-projector' });
    expect(
      PublishMetaItemResponseSchema.safeParse({ ...realResponse, projectionApplied: { error: 'x' } }).success,
    ).toBe(false);
  });

  it('leaves all three receipts optional — absent means that side effect did not run', () => {
    for (const key of ['seedApplied', 'materializeApplied', 'projectionApplied'] as const) {
      expect(realResponse).not.toHaveProperty(key);
    }
    expect(PublishMetaItemResponseSchema.safeParse(realResponse).success).toBe(true);
  });
});

import { RuntimeAuthoringIssueSchema } from './protocol.zod';

/**
 * #4717 — `advisories`, the #4463 D3 advisory half, on the save response.
 *
 * The gate runs the shared author-time rule registry over every body going
 * `active` and splits its findings by severity. `error` becomes the 422; the
 * rest are advisory — they do not block the write, and until #4717 they went
 * only to a process-deduped `console.warn`, which is unreachable by exactly the
 * Studio / MCP / AI authors #4463 exists for.
 *
 * ⚠️ This field is CONDITIONAL, and that has a consequence worth stating where
 * the next reader will meet it: the producer-side conformance gate
 * (`packages/objectql/src/save-meta-response-conformance.test.ts`) works by
 * asserting that nothing was stripped, and a key that is absent strips nothing.
 * So it stays green whether or not this declaration exists — measured, not
 * assumed (the PR's R1/R3 rows). The declaration is deliberate rather than
 * test-driven, and these cases are what make it checkable at all.
 */
describe('SaveMetaItemResponseSchema.advisories (#4717 — #4463 D3 on the response)', () => {
  const realResponse = {
    success: true,
    version: 'sha256:7aad99c8d969efb5067fff275fb3e5be7ec90f9cd610d41709fcddbf8c34b1f0',
    seq: 1,
    state: 'active',
    message: 'Saved flow \'nightly_purge\' (env-wide, state=active) [seq=1]',
  };

  /** A verbatim capture of a real finding — `lintFlowPatterns`, warning tier. */
  const advisory = {
    rule: 'flow-multi-write-unfiltered',
    path: 'flow \'nightly_purge\' · node \'purge\' (delete_record)',
    where: 'flow \'nightly_purge\' · node \'purge\' (delete_record)',
    message: 'declares `multi: true` with no `filter` key — this is a WHOLE-OBJECT write.',
    hint: 'Add a `filter`, or state the whole-object intent explicitly.',
    severity: 'warning' as const,
  };

  it('carries a real advisory through parse without stripping it', () => {
    const parsed = SaveMetaItemResponseSchema.parse({ ...realResponse, advisories: [advisory] });
    expect(parsed.advisories).toEqual([advisory]);
  });

  it('is OPTIONAL — absence means "nothing to report", never "the gate did not run"', () => {
    expect(SaveMetaItemResponseSchema.safeParse(realResponse).success).toBe(true);
    expect(SaveMetaItemResponseSchema.parse(realResponse).advisories).toBeUndefined();
  });

  it('does not fabricate an empty array when the key is absent', () => {
    // The producer omits the key rather than emitting `[]`, so a clean save's
    // response bytes are unchanged. A `.default([])` here would quietly undo
    // that on the consumer side: every caller would see a key the server never
    // sent, and "absent" would stop being distinguishable at all.
    expect('advisories' in SaveMetaItemResponseSchema.parse(realResponse)).toBe(false);
  });

  it('rejects a non-array, so a single issue object cannot masquerade as the list', () => {
    expect(
      SaveMetaItemResponseSchema.safeParse({ ...realResponse, advisories: advisory }).success,
    ).toBe(false);
  });
});

/**
 * #9176 — `advisories` on the PUBLISH response: the same #4463 D3 key, mirrored
 * onto the other write door. The gate runs on both doors by D1 (a draft→active
 * promotion is gated exactly as a direct active save), but until #9176 only the
 * save door reported — the promotion call site received the gate's advisory
 * return and discarded it. Studio's designer takes draft-then-publish on every
 * edit, so the door its authors actually use was the one that said nothing.
 *
 * Same conditional-field caveat as the save door: the producer-side conformance
 * gate (`packages/objectql/src/publish-meta-response-conformance.test.ts`)
 * asserts nothing is stripped, and an absent key strips nothing — so these
 * declaration pins are what make the key checkable at all, in both directions.
 */
describe('PublishMetaItemResponseSchema.advisories (#9176 — #4463 D3 on the publish door)', () => {
  const realPublishResponse = {
    success: true,
    version: 'sha256:7aad99c8d969efb5067fff275fb3e5be7ec90f9cd610d41709fcddbf8c34b1f0',
    seq: 2,
    message: 'Published draft — type=flow, name=nightly_purge [seq=2]',
  };

  /** A verbatim capture of a real finding — `lintFlowPatterns`, warning tier. */
  const advisory = {
    rule: 'flow-multi-write-unfiltered',
    path: 'flow \'nightly_purge\' · node \'purge\' (delete_record)',
    where: 'flow \'nightly_purge\' · node \'purge\' (delete_record)',
    message: 'declares `multi: true` with no `filter` key — this is a WHOLE-OBJECT write.',
    hint: 'Add a `filter`, or state the whole-object intent explicitly.',
    severity: 'warning' as const,
  };

  it('carries a real advisory through parse without stripping it', () => {
    const parsed = PublishMetaItemResponseSchema.parse({ ...realPublishResponse, advisories: [advisory] });
    expect(parsed.advisories).toEqual([advisory]);
  });

  it('is OPTIONAL — absence means "nothing to report", never "the gate did not run"', () => {
    expect(PublishMetaItemResponseSchema.safeParse(realPublishResponse).success).toBe(true);
    expect(PublishMetaItemResponseSchema.parse(realPublishResponse).advisories).toBeUndefined();
  });

  it('does not fabricate an empty array when the key is absent', () => {
    // The producer omits the key rather than emitting `[]`, so a clean
    // publish's response bytes are unchanged. A `.default([])` here would
    // quietly undo that on the consumer side: every caller would see a key
    // the server never sent, and "absent" would stop being distinguishable.
    expect('advisories' in PublishMetaItemResponseSchema.parse(realPublishResponse)).toBe(false);
  });

  it('rejects a non-array, so a single issue object cannot masquerade as the list', () => {
    expect(
      PublishMetaItemResponseSchema.safeParse({ ...realPublishResponse, advisories: advisory }).success,
    ).toBe(false);
  });

  it('element shape is the ONE declared finding shape — a lossy element is refused, not narrowed', () => {
    // The element schema is `RuntimeAuthoringIssueSchema` by reference, not a
    // local re-declaration — so an element missing a required key fails the
    // whole parse rather than surviving with keys silently dropped. This is
    // what keeps the save door's `advisories[]`, the publish door's, and the
    // 422 `issues[]` one dialect (#4717).
    const partial = { rule: 'x', severity: 'warning' };
    expect(
      PublishMetaItemResponseSchema.safeParse({ ...realPublishResponse, advisories: [partial] }).success,
    ).toBe(false);
  });
});

/**
 * The element shape itself — declared once (#4717) and re-exported by
 * `@objectstack/metadata-protocol` as its `RuntimeAuthoringIssue`, so the 422's
 * `issues[]` and the 2xx's `advisories[]` cannot drift into two dialects.
 */
describe('RuntimeAuthoringIssueSchema (#4717 — the ONE finding shape)', () => {
  const issue = {
    rule: 'flow-multi-write-unfiltered',
    path: 'flows[0].nodes[1].config.multi',
    where: 'flow "nightly_purge" · node "purge"',
    message: 'unbounded bulk delete',
    hint: 'add a filter',
    severity: 'warning',
  };

  it('accepts a finding with all six keys', () => {
    expect(RuntimeAuthoringIssueSchema.parse(issue)).toEqual(issue);
  });

  it('requires every one of the six — a partial finding is not a finding', () => {
    for (const missing of ['rule', 'path', 'where', 'message', 'hint', 'severity'] as const) {
      const body: Record<string, unknown> = { ...issue };
      delete body[missing];
      expect(
        RuntimeAuthoringIssueSchema.safeParse(body).success,
        `omitting '${missing}' must fail parse`,
      ).toBe(false);
    }
  });

  it('closes severity to the three the gate emits', () => {
    for (const severity of ['error', 'warning', 'info']) {
      expect(RuntimeAuthoringIssueSchema.safeParse({ ...issue, severity }).success).toBe(true);
    }
    expect(RuntimeAuthoringIssueSchema.safeParse({ ...issue, severity: 'advisory' }).success).toBe(false);
    expect(RuntimeAuthoringIssueSchema.safeParse({ ...issue, severity: 'fatal' }).success).toBe(false);
  });
});

import { PublishPackageDraftsResponseSchema } from './protocol.zod';

/**
 * #9406 — the same suite one door over again, for the BATCH publish door
 * `POST /packages/:id/publish-drafts` (Studio's "publish whole app").
 *
 * The batch door sat in exactly the undeclared state the single-item publish
 * door sat in before #7294: its face lived only as an inline TypeScript return
 * type in `@objectstack/metadata-protocol`, so a field added to or dropped
 * from the response could not turn any declared-contract gate red — #9343's
 * discarded advisories were the measured instance.
 *
 * Optionality is measured, not assumed (receipts in the PR): the producer pair
 * is `ObjectStackProtocolImplementation.publishPackageDrafts` (three return
 * sites, all setting the five required keys) plus the REST door's response
 * mutations in `packages/runtime/src/domains/packages.ts` (`seedApplied`
 * back-fill, `unhiddenApps` / `unhideError` / `rebindError`). The producer
 * side is pinned in
 * `packages/objectql/src/publish-package-drafts-response-conformance.test.ts`
 * and the route mutations in
 * `packages/runtime/src/domains/packages-publish-drafts-response-conformance.test.ts`.
 */
describe('PublishPackageDraftsResponseSchema (#9406 — declares the batch publish response)', () => {
  /** A verbatim-shaped capture of a real `publishPackageDrafts` return (happy path). */
  const realResponse = {
    success: true,
    publishedCount: 2,
    failedCount: 0,
    published: [
      { type: 'view', name: 'cases', version: 'sha256:7aad99c8d969efb5067fff275fb3e5be7ec90f9cd610d41709fcddbf8c34b1f0' },
      { type: 'flow', name: 'nightly_purge', version: 'sha256:1bad99c8d969efb5067fff275fb3e5be7ec90f9cd610d41709fcddbf8c34b1f1' },
    ],
    failed: [],
    commitId: 'cmt_01HZX3V9K2',
  };

  it('round-trips a real response without stripping any field', () => {
    const parsed = PublishPackageDraftsResponseSchema.parse(realResponse);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(realResponse).sort());
    expect(parsed).toEqual(realResponse);
  });

  it('requires the five always-emitted keys — every producer return site sets them', () => {
    for (const missing of ['success', 'publishedCount', 'failedCount', 'published', 'failed'] as const) {
      const body: Record<string, unknown> = { ...realResponse };
      delete body[missing];
      expect(
        PublishPackageDraftsResponseSchema.safeParse(body).success,
        `omitting '${missing}' must fail parse`,
      ).toBe(false);
    }
  });

  it('keeps the counters integers and rejects fractional ones', () => {
    expect(PublishPackageDraftsResponseSchema.safeParse({ ...realResponse, publishedCount: 1.5 }).success).toBe(false);
    expect(PublishPackageDraftsResponseSchema.safeParse({ ...realResponse, failedCount: 0.5 }).success).toBe(false);
  });

  it('published[] elements carry the ADR-0008 OCC token: version is required per element', () => {
    const parsed = PublishPackageDraftsResponseSchema.parse(realResponse);
    expect(parsed.published[0]!.version).toBe(realResponse.published[0]!.version);
    const lossy = {
      ...realResponse,
      published: [{ type: 'view', name: 'cases' }],
    };
    expect(PublishPackageDraftsResponseSchema.safeParse(lossy).success).toBe(false);
  });

  it('failed[] carries the refusal shape, code optional — BATCH_ABORTED marks non-causal items', () => {
    const rolledBack = {
      success: false,
      publishedCount: 0,
      failedCount: 2,
      published: [],
      failed: [
        { type: 'object', name: 'ticket', error: "[invalid_metadata] object name 'ticket' must carry the package namespace prefix", code: 'PACKAGE_NAMESPACE_PREFIX_REQUIRED' },
        { type: 'view', name: 'cases', error: 'not published — the batch is all-or-nothing (ADR-0067 D2) and object/ticket failed; the transaction rolled back', code: 'BATCH_ABORTED' },
      ],
    };
    const parsed = PublishPackageDraftsResponseSchema.parse(rolledBack);
    expect(parsed.failed).toEqual(rolledBack.failed);
    // `error` is required once an element exists — a failure with no reason
    // is the shape this declaration exists to refuse.
    expect(
      PublishPackageDraftsResponseSchema.safeParse({
        ...rolledBack,
        failed: [{ type: 'object', name: 'ticket' }],
      }).success,
    ).toBe(false);
  });

  it('carries seedApplied — counters optional ONLY for the route-level fallback producer', () => {
    // The in-batch producer (`applySeedBodies`) always emits both counters.
    const inBatch = PublishPackageDraftsResponseSchema.parse({
      ...realResponse,
      seedApplied: { success: true, inserted: 3, updated: 1, errors: [] },
    });
    expect(inBatch.seedApplied).toEqual({ success: true, inserted: 3, updated: 1, errors: [] });
    // The route back-fill's early-failure shape has no counters — measured on
    // `applyPublishedSeeds` ("required services unavailable") and the door's
    // own catch. The wire face is the union, so the counters are optional.
    const routeFallback = PublishPackageDraftsResponseSchema.parse({
      ...realResponse,
      seedApplied: { success: false, error: 'seed apply failed' },
    });
    expect(routeFallback.seedApplied).toEqual({ success: false, error: 'seed apply failed' });
    // `success` stays required either way.
    expect(
      PublishPackageDraftsResponseSchema.safeParse({ ...realResponse, seedApplied: { inserted: 1, updated: 0 } }).success,
    ).toBe(false);
  });

  it('carries materializeApplied with the batch\'s per-item failures[], not the single door\'s scalar error', () => {
    const parsed = PublishPackageDraftsResponseSchema.parse({
      ...realResponse,
      materializeApplied: {
        success: false, inserted: 1, updated: 0,
        failures: [{ type: 'permission', name: 'sales_reps', error: 'materialize failed' }],
      },
    });
    expect(parsed.materializeApplied?.failures).toHaveLength(1);
    // `failures` is REQUIRED once the key is present — the aggregate's whole
    // point is naming WHICH items never went live (an omitted list would
    // read as "none failed" while `success: false` says otherwise).
    expect(
      PublishPackageDraftsResponseSchema.safeParse({
        ...realResponse,
        materializeApplied: { success: true, inserted: 1, updated: 0 },
      }).success,
    ).toBe(false);
  });

  it('probes is opaque BY DECLARATION (#9406 ruling): any shape passes through unmodified, unstripped', () => {
    // The real `BuildProbeReport` shape of today…
    const report = { issues: [], checked: { seeds: 1, views: 2, widgets: 0 } };
    const parsed = PublishPackageDraftsResponseSchema.parse({ ...realResponse, probes: report });
    expect(parsed.probes).toEqual(report);
    // …and a future shape this contract deliberately does NOT constrain. If a
    // consumer ever needs a field of `probes`, upgrade the declaration on its
    // own card instead of relaxing this pin.
    expect(
      PublishPackageDraftsResponseSchema.safeParse({ ...realResponse, probes: { anything: 'else' } }).success,
    ).toBe(true);
  });

  it('declares the route-attached ADR-0045 receipts: unhiddenApps / unhideError / rebindError', () => {
    const withFlip = PublishPackageDraftsResponseSchema.parse({
      ...realResponse,
      unhiddenApps: ['crm', 'ops'],
    });
    expect(withFlip.unhiddenApps).toEqual(['crm', 'ops']);
    // #5242's split report: the persisted half rides BESIDE the failure.
    const partWay = PublishPackageDraftsResponseSchema.parse({
      ...realResponse,
      unhiddenApps: ['crm'],
      unhideError: 'visibility flip failed',
    });
    expect(partWay.unhiddenApps).toEqual(['crm']);
    expect(partWay.unhideError).toBe('visibility flip failed');
    const withRebind = PublishPackageDraftsResponseSchema.parse({
      ...realResponse,
      rebindError: 'metadata:reloaded announce failed',
    });
    expect(withRebind.rebindError).toBe('metadata:reloaded announce failed');
  });

  it('leaves every conditional key optional — absent means "did not apply", never "failed"', () => {
    const minimal = {
      success: false,
      publishedCount: 0,
      failedCount: 0,
      published: [],
      failed: [],
    };
    for (const key of ['seedApplied', 'materializeApplied', 'probes', 'commitId', 'unhiddenApps', 'unhideError', 'rebindError'] as const) {
      expect(minimal).not.toHaveProperty(key);
    }
    expect(PublishPackageDraftsResponseSchema.safeParse(minimal).success).toBe(true);
  });

  it('does not fabricate any key: parse of a lean body adds nothing (byte-stability half)', () => {
    // No `.default()` anywhere — a declaration that invents keys on the
    // consumer side would make "absent" unobservable and change what callers
    // see relative to the wire bytes. The other half of the byte-stability
    // proof (the wire itself is unchanged) lives in the producer-side
    // conformance suites: nothing on the serving path parses this schema.
    const parsed = PublishPackageDraftsResponseSchema.parse(realResponse) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(realResponse).sort());
  });
});

/**
 * #9406 / #9343 — `advisories` on the batch door's `published[]` elements: the
 * same #4463 D3 key the single-item doors carry, riding each element (the
 * maintainer ruled against a parallel top-level map on #9343). Same
 * conditional-field caveat as both siblings: a strip-nothing conformance gate
 * cannot go red for an absent key, so these declaration pins are what make the
 * key checkable in both directions.
 */
describe('PublishPackageDraftsResponseSchema published[].advisories (#9343 — #4463 D3 per element)', () => {
  const base = {
    success: true,
    publishedCount: 1,
    failedCount: 0,
    failed: [],
    commitId: 'cmt_01HZX3V9K2',
  };

  /** A verbatim capture of a real finding — `lintFlowPatterns`, warning tier. */
  const advisory = {
    rule: 'flow-multi-write-unfiltered',
    path: 'flow \'nightly_purge\' · node \'purge\' (delete_record)',
    where: 'flow \'nightly_purge\' · node \'purge\' (delete_record)',
    message: 'declares `multi: true` with no `filter` key — this is a WHOLE-OBJECT write.',
    hint: 'Add a `filter`, or state the whole-object intent explicitly.',
    severity: 'warning' as const,
  };

  const el = (extra?: Record<string, unknown>) => ({
    type: 'flow', name: 'nightly_purge',
    version: 'sha256:7aad99c8d969efb5067fff275fb3e5be7ec90f9cd610d41709fcddbf8c34b1f0',
    ...(extra ?? {}),
  });

  it('carries a real advisory through parse on its element, unstripped', () => {
    const parsed = PublishPackageDraftsResponseSchema.parse({
      ...base,
      published: [el({ advisories: [advisory] })],
    });
    expect(parsed.published[0]!.advisories).toEqual([advisory]);
  });

  it('is OPTIONAL per element — absence means "nothing to report", never "the gate did not run"', () => {
    const parsed = PublishPackageDraftsResponseSchema.parse({ ...base, published: [el()] });
    expect(parsed.published[0]!.advisories).toBeUndefined();
    expect('advisories' in parsed.published[0]!).toBe(false);
  });

  it('element shape is the ONE declared finding shape — a lossy element is refused, not narrowed', () => {
    // `RuntimeAuthoringIssueSchema` by reference, not a local re-declaration —
    // the save door's advisories[], the single publish door's, this door's,
    // and the 422 issues[] stay one dialect (#4717).
    const partial = { rule: 'x', severity: 'warning' };
    expect(
      PublishPackageDraftsResponseSchema.safeParse({
        ...base,
        published: [el({ advisories: [partial] })],
      }).success,
    ).toBe(false);
  });

  it('rejects a non-array, so a single issue object cannot masquerade as the list', () => {
    expect(
      PublishPackageDraftsResponseSchema.safeParse({
        ...base,
        published: [el({ advisories: advisory })],
      }).success,
    ).toBe(false);
  });
});

// Deliberately its own import line, matching the file's later blocks: this
// group pins one change (#9726) and reads as one unit.
import {
  GetMetaItemsRequestSchema,
  GetMetaItemRequestSchema,
  GetMetaItemCachedRequestSchema,
  GetMetaItemLayeredRequestSchema,
} from './protocol.zod';

describe('meta-read request schemas declare organizationId (#9726 — declared = enforced)', () => {
  // The implementation (`@objectstack/metadata-protocol`) accepts and HONOURS
  // `organizationId` on all four read verbs: it selects the org partition in
  // the ADR-0005 overlay read order, i.e. it decides which tenant's row is
  // served. These pins hold the DECLARED surface to that enforced shape.
  //
  // Why the accept-pin asserts the parsed VALUE, not just `success`: these are
  // non-strict objects, so before #9726 a request carrying `organizationId`
  // still parsed green — the member was silently STRIPPED. Presence in the
  // parse OUTPUT is the observable that actually changed.
  const cases = [
    ['GetMetaItemsRequestSchema', GetMetaItemsRequestSchema, { type: 'object' }],
    ['GetMetaItemRequestSchema', GetMetaItemRequestSchema, { type: 'view', name: 'account_list' }],
    ['GetMetaItemCachedRequestSchema', GetMetaItemCachedRequestSchema, { type: 'view', name: 'account_list' }],
    ['GetMetaItemLayeredRequestSchema', GetMetaItemLayeredRequestSchema, { type: 'view', name: 'account_list' }],
  ] as const;

  it.each(cases)('%s accepts organizationId and PRESERVES it through parse', (_n, schema, base) => {
    const result = schema.safeParse({ ...base, organizationId: 'org_alpha' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { organizationId?: string }).organizationId).toBe('org_alpha');
    }
  });

  it.each(cases)('%s keeps organizationId OPTIONAL — an env-wide (org-less) read stays valid', (_n, schema, base) => {
    const result = schema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('organizationId' in (result.data as object)).toBe(false);
    }
  });

  it.each(cases)('%s rejects a non-string organizationId — the scope key is a value, not a bag', (_n, schema, base) => {
    expect(schema.safeParse({ ...base, organizationId: 42 }).success).toBe(false);
    expect(schema.safeParse({ ...base, organizationId: { id: 'org_alpha' } }).success).toBe(false);
  });

  it('GetMetaItemLayeredRequestSchema mirrors the implementation inline type member for member', () => {
    // `{ type, name, packageId?, organizationId? }` — the exact parameter type
    // of `getMetaItemLayered` in metadata-protocol. packageId scopes the code
    // layer (ADR-0048); nothing else is declared because nothing else is
    // enforced.
    const full = GetMetaItemLayeredRequestSchema.safeParse({
      type: 'view',
      name: 'account_list',
      packageId: 'pkg_crm',
      organizationId: 'org_alpha',
    });
    expect(full.success).toBe(true);
    expect(GetMetaItemLayeredRequestSchema.safeParse({ type: 'view' }).success).toBe(false);
    expect(GetMetaItemLayeredRequestSchema.safeParse({ name: 'account_list' }).success).toBe(false);
  });
});

describe('MetadataProtocol declares getMetaItemLayered (#9740)', () => {
  // Type-level pins (compiled by the spec test typecheck, the
  // translation-typegen.test.ts pattern). The member is an interface
  // declaration with no runtime shadow, so its presence and shape are only
  // observable to tsc — these pins are what turns red if the member is
  // dropped again or drifts off the layered schemas.

  it('declares the member optional, against the layered request/response schemas', () => {
    // Optional like its `getMetaItemCached` / `deleteMetaItem` siblings:
    // additive to a shipped contract, implementation predating declaration.
    expectTypeOf<MetadataProtocol['getMetaItemLayered']>().toEqualTypeOf<
      ((request: GetMetaItemLayeredRequest) => Promise<GetMetaItemLayeredResponse>) | undefined
    >();
  });

  it("keeps the layered lockSource vocabulary closed — no 'overlay' arm", () => {
    // The drift this card closed: the implementation's inline annotation
    // carried an 'overlay' arm no producer on the layered read path can emit
    // (the only `lockSource: 'overlay'` producer is `getEffectiveLock`, a
    // write/delete-door helper). The declared wire enum stays
    // artifact | package | env-forced; widening it without a producer is the
    // declared-but-unenforced direction Prime Directive #10 forbids.
    expectTypeOf<GetMetaItemLayeredResponse['lockSource']>().toEqualTypeOf<
      'artifact' | 'package' | 'env-forced' | undefined
    >();
  });
});
