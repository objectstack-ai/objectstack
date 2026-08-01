
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
  // Views
  ListViewsRequestSchema,
  ListViewsResponseSchema,
  GetViewRequestSchema,
  CreateViewRequestSchema,
  UpdateViewRequestSchema,
  DeleteViewRequestSchema,
  DeleteViewResponseSchema,
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

  it('validates Views operations', () => {
    expect(ListViewsRequestSchema.safeParse({ object: 'project', type: 'list' }).success).toBe(true);
    expect(ListViewsResponseSchema.safeParse({
      object: 'project',
      views: [{ list: { columns: [] } }],
    }).success).toBe(true);
    expect(GetViewRequestSchema.safeParse({ object: 'project', viewId: 'v1' }).success).toBe(true);
    expect(CreateViewRequestSchema.safeParse({
      object: 'project',
      data: { list: { columns: [] } },
    }).success).toBe(true);
    expect(UpdateViewRequestSchema.safeParse({
      object: 'project',
      viewId: 'v1',
      data: { list: { columns: [] } },
    }).success).toBe(true);
    expect(DeleteViewRequestSchema.safeParse({ object: 'project', viewId: 'v1' }).success).toBe(true);
    expect(DeleteViewResponseSchema.safeParse({ object: 'project', viewId: 'v1', success: true }).success).toBe(true);
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

describe('GetDiscoveryResponseSchema (capabilities)', () => {
  it('should accept response with hierarchical capabilities', () => {
    const result = GetDiscoveryResponseSchema.safeParse({
      version: 'v1',
      name: 'ObjectStack API',
      capabilities: {
        feed: { enabled: true },
        comments: { enabled: true, features: { threaded: true } },
        automation: { enabled: false },
        search: { enabled: true, description: 'Full-text search' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities?.feed?.enabled).toBe(true);
      expect(result.data.capabilities?.automation?.enabled).toBe(false);
    }
  });

  it('should accept response without capabilities (optional)', () => {
    const result = GetDiscoveryResponseSchema.safeParse({
      version: 'v1',
      apiName: 'ObjectStack API',
    });
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
