/**
 * useApiDiscovery — fetches the API discovery payload and builds a flat list
 * of REST endpoint definitions grouped by service / metadata type / object.
 *
 * Console is not project-scoped, so there is no `projectId` parameter and no
 * `/projects/:projectId/...` URL rewriting.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAdapter } from '@object-ui/app-shell';
import { isServiceUsable, type DiscoveryServiceStatus } from '@object-ui/react';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

export interface EndpointDef {
  method: HttpMethod;
  path: string;
  desc: string;
  group: string;
  bodyTemplate?: Record<string, unknown>;
}

export interface EndpointGroup {
  key: string;
  label: string;
  endpoints: EndpointDef[];
}

interface ServiceEndpointEntry {
  method: HttpMethod;
  path: string;
  desc: string;
  bodyTemplate?: Record<string, unknown>;
}

const EXCLUDED_META_TYPES = ['plugin', 'plugins', 'kind', 'package'];

function buildAuthEndpoints(authBase: string): EndpointDef[] {
  return [
    { method: 'POST', path: `${authBase}/sign-in/email`, desc: 'Sign in (email)', group: 'Auth', bodyTemplate: { email: 'user@example.com', password: '' } },
    { method: 'POST', path: `${authBase}/sign-up/email`, desc: 'Sign up (email)', group: 'Auth', bodyTemplate: { email: '', password: '', name: '' } },
    { method: 'POST', path: `${authBase}/sign-out`, desc: 'Sign out', group: 'Auth' },
    { method: 'GET', path: `${authBase}/get-session`, desc: 'Get session', group: 'Auth' },
  ];
}

/**
 * Service-gated endpoint groups, keyed by **canonical service-slot name**.
 *
 * The key is not a label and not a route — it is the name this page looks up in
 * `/discovery`'s `services` map, which the framework keys by `CoreServiceName`
 * (`@objectstack/spec/system`). A key that is not a member of that vocabulary
 * can never match, and because the lookup miss is deliberately fail-closed
 * (ADR-0076 D12) the group then renders NOWHERE, silently, on every host.
 *
 * `useApiDiscovery.test.ts` pins the keys against the spec's slot enum so a
 * rename on either side goes red instead of going quiet.
 */
export const SERVICE_ENDPOINT_CATALOG: Record<string, { group: string; defaultRoute: string; endpoints: ServiceEndpointEntry[] }> = {
  // The `/api/v1/ai/**` family, in ledger order (framework#3718).
  //
  // `/nlq`, `/suggest` and `/insights` used to sit here with "try it" bodies and
  // always 404'd — they were declared in the framework's `DEFAULT_AI_ROUTES` and
  // never implemented anywhere, so this page offered three endpoints that had no
  // server. The audited table is cloud's `packages/service-ai/src/
  // ai-route-ledger.ts`; when a route is added, renamed or retired there, mirror
  // it here.
  //
  // That first fix listed one server-side builder, `buildAIRoutes()`. The family
  // is several builders plus one route mounted by `objectos-runtime`, so this
  // page still showed under half of it. The rows below mirror the ledger,
  // grouped as the ledger groups them.
  //
  // TWO KINDS OF ENTRY LIVE HERE, and both belong:
  //  - routes the SDK also expresses (`/chat`, `/conversations/*`) — this page is
  //    where you check the wire shape behind `client.ai.*`;
  //  - routes it deliberately does not (`/status`, `/effective-model`, `/tools/*`,
  //    `/evals/runs`, `/usage`) — operator and console surfaces, which is exactly
  //    why they belong on a page that explores raw HTTP rather than `client.*`.
  //
  // MOUNTING IS CONDITIONAL for three of the builders (see AI_ROUTE_MOUNT_GATES
  // in the ledger): `/agents/*` needs a metadata service, `/evals/runs` also
  // needs a data engine, `/conversations/:id/debug` needs one.
  // A full Cloud deployment wires all of them; a stripped host may not, and there
  // these 404 because they are not mounted — NOT because they do not exist. That
  // is a different failure from the one above, and the only honest place to say so
  // is here.
  ai: {
    group: 'AI',
    defaultRoute: '/api/v1/ai',
    endpoints: [
      // The endpoint STREAMS unless told otherwise, so the JSON template says so:
      // without `stream: false` a "try it" here buffers an SSE body as text.
      // `/chat/stream` below is the one that means to stream.
      { method: 'POST', path: '/chat', desc: 'Chat completion (JSON)', bodyTemplate: { messages: [{ role: 'user', content: '' }], stream: false } },
      { method: 'POST', path: '/chat/stream', desc: 'Streaming chat (SSE)', bodyTemplate: { messages: [{ role: 'user', content: '' }] } },
      { method: 'POST', path: '/complete', desc: 'Text completion', bodyTemplate: { prompt: '' } },
      { method: 'GET', path: '/models', desc: 'List available models' },
      { method: 'GET', path: '/status', desc: 'Active LLM adapter provenance' },
      { method: 'GET', path: '/effective-model', desc: 'Effective model ids and where they came from' },
      { method: 'POST', path: '/conversations', desc: 'Create conversation', bodyTemplate: {} },
      { method: 'GET', path: '/conversations', desc: 'List conversations' },
      { method: 'GET', path: '/conversations/:id', desc: 'Get conversation with message history' },
      { method: 'PATCH', path: '/conversations/:id', desc: 'Update conversation (title, metadata)', bodyTemplate: { title: '' } },
      { method: 'DELETE', path: '/conversations/:id', desc: 'Delete conversation' },
      { method: 'POST', path: '/conversations/:id/messages', desc: 'Add message to conversation', bodyTemplate: { role: 'user', content: '' } },
      { method: 'GET', path: '/conversations/:id/debug', desc: 'Reconcile a build conversation: agent-claimed vs live metadata' },

      // Named agents. `/agents/:agentName/chat` is dual-mode on the same flag as
      // `/chat` above — `stream: false` for the JSON reply this page can render.
      { method: 'GET', path: '/agents', desc: 'List active agents' },
      { method: 'POST', path: '/agents/:agentName/chat', desc: 'Chat with a named agent (JSON)', bodyTemplate: { messages: [{ role: 'user', content: '' }], stream: false } },

      // Tools. `execute` is the mounted verb — the metadata-admin tool preview
      // used to deep-link here with `/invoke`, which has never existed.
      { method: 'GET', path: '/tools', desc: 'List registered AI tools' },
      { method: 'POST', path: '/tools/:toolName/execute', desc: 'Execute one tool directly (playground)', bodyTemplate: { parameters: {} } },

      // HITL approval queue. Reads take `ai:read`; approve/reject take the
      // separate `ai:approve` — a token that lists the queue may not clear it.
      { method: 'GET', path: '/pending-actions', desc: 'List pending actions awaiting approval' },
      { method: 'GET', path: '/pending-actions/:id', desc: 'Get one pending action' },
      { method: 'POST', path: '/pending-actions/:id/approve', desc: 'Approve a pending action and execute it', bodyTemplate: {} },
      { method: 'POST', path: '/pending-actions/:id/reject', desc: 'Reject a pending action', bodyTemplate: { reason: '' } },

      // Operator surfaces. A run here makes real (paid) LLM calls — hence
      // `ai:admin`, and hence the warning in the description rather than a
      // friendlier one-liner.
      { method: 'POST', path: '/evals/runs', desc: 'Run an eval case — ai:admin, makes paid LLM calls', bodyTemplate: { caseId: '' } },

      // Mounted by `objectos-runtime`, not `service-ai`: the console usage ring
      // reads it. Reports a fraction of quota, never a token count.
      { method: 'GET', path: '/usage', desc: 'AI quota headroom per meter (console usage indicator)' },
    ],
  },
  realtime: {
    group: 'Realtime',
    defaultRoute: '/api/v1/realtime',
    endpoints: [
      { method: 'POST', path: '/connect', desc: 'Establish realtime connection', bodyTemplate: { transport: 'websocket' } },
      { method: 'POST', path: '/disconnect', desc: 'Close realtime connection', bodyTemplate: { connectionId: '' } },
      { method: 'POST', path: '/subscribe', desc: 'Subscribe to channel', bodyTemplate: { channel: '' } },
      { method: 'POST', path: '/unsubscribe', desc: 'Unsubscribe from channel', bodyTemplate: { channel: '' } },
      { method: 'PUT', path: '/presence/:channel', desc: 'Set presence state', bodyTemplate: { status: 'online' } },
      { method: 'GET', path: '/presence/:channel', desc: 'Get channel presence' },
    ],
  },
  notification: {
    group: 'Notifications',
    defaultRoute: '/api/v1/notifications',
    endpoints: [
      { method: 'GET', path: '', desc: 'List notifications' },
      { method: 'POST', path: '/devices', desc: 'Register device for push', bodyTemplate: { token: '', platform: 'web' } },
      { method: 'DELETE', path: '/devices/:deviceId', desc: 'Unregister device' },
      { method: 'GET', path: '/preferences', desc: 'Get notification preferences' },
      { method: 'PATCH', path: '/preferences', desc: 'Update notification preferences', bodyTemplate: { email: true, push: true } },
      { method: 'POST', path: '/read', desc: 'Mark notifications as read', bodyTemplate: { ids: [] } },
      { method: 'POST', path: '/read/all', desc: 'Mark all as read' },
    ],
  },
  analytics: {
    group: 'Analytics',
    defaultRoute: '/api/v1/analytics',
    endpoints: [
      { method: 'POST', path: '/query', desc: 'Execute analytics query', bodyTemplate: { measures: [], dimensions: [] } },
      { method: 'GET', path: '/meta', desc: 'Get analytics metadata' },
    ],
  },
  automation: {
    group: 'Automation',
    defaultRoute: '/api/v1/automation',
    endpoints: [
      { method: 'POST', path: '/trigger', desc: 'Trigger automation', bodyTemplate: { name: '', params: {} } },
    ],
  },
  i18n: {
    group: 'i18n',
    defaultRoute: '/api/v1/i18n',
    endpoints: [
      { method: 'GET', path: '/locales', desc: 'Get available locales' },
      { method: 'GET', path: '/translations/:locale', desc: 'Get translations for locale' },
      { method: 'GET', path: '/labels/:object/:locale', desc: 'Get translated field labels' },
    ],
  },
  ui: {
    group: 'UI',
    defaultRoute: '/api/v1/ui',
    endpoints: [
      { method: 'GET', path: '/views', desc: 'List views' },
      { method: 'GET', path: '/views/:id', desc: 'Get view by ID' },
      { method: 'POST', path: '/views', desc: 'Create view', bodyTemplate: { name: '', object: '', type: 'list' } },
      { method: 'PATCH', path: '/views/:id', desc: 'Update view', bodyTemplate: { name: '' } },
      { method: 'DELETE', path: '/views/:id', desc: 'Delete view' },
    ],
  },
  // The KEY is the canonical service-slot name, because it is looked up
  // straight in `/discovery`'s `services` map (`discoveredServices[serviceName]`
  // below) — and that map is keyed by `CoreServiceName`. A key the map does not
  // carry misses on every host, and the miss is indistinguishable from "no such
  // service": the deliberate fail-closed branch then hides all three endpoints
  // everywhere, silently. #4240 was exactly that miss.
  //
  // `storage` is the canonical slot (framework #9683, maintainer ruling
  // 2026-08-18). `file-storage` is its deprecated v17 alias, which both
  // discovery producers fill with a byte-equal copy of the `storage` row until
  // the alias retires at the next major. So this page reads the canonical key
  // and nothing else: there is no alias to bridge (#5291 removed the
  // console-side alias table #5286 had added). A backend older than that
  // mirror reports `file-storage` alone, and there this group stays hidden, by
  // the fail-closed rule above. The group's display name `Storage` is the
  // route's name and the user-facing one; it is not derived from the key.
  storage: {
    group: 'Storage',
    defaultRoute: '/api/v1/storage',
    endpoints: [
      { method: 'POST', path: '/upload', desc: 'Upload file (multipart/form-data)' },
      { method: 'GET', path: '/:fileId', desc: 'Download file' },
      { method: 'DELETE', path: '/:fileId', desc: 'Delete file' },
    ],
  },
};

export function buildServiceEndpoints(serviceName: string, routePrefix: string): EndpointDef[] {
  const catalog = SERVICE_ENDPOINT_CATALOG[serviceName];
  if (!catalog) return [];
  return catalog.endpoints.map(ep => ({
    method: ep.method,
    path: `${routePrefix}${ep.path}`,
    desc: ep.desc,
    group: catalog.group,
    ...(ep.bodyTemplate ? { bodyTemplate: ep.bodyTemplate } : {}),
  }));
}

export function useApiDiscovery() {
  const adapter = useAdapter();
  const [groups, setGroups] = useState<EndpointGroup[]>([]);
  const [allEndpoints, setAllEndpoints] = useState<EndpointDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async () => {
    setLoading(true);
    setError(null);

    const scopePrefix = '/api/v1';
    const discoveryUrl = `${scopePrefix}/discovery`;
    const systemEndpoints: EndpointDef[] = [
      { method: 'GET', path: discoveryUrl, desc: 'API Discovery', group: 'System' },
      { method: 'GET', path: `${scopePrefix}/meta/types`, desc: 'List metadata types', group: 'Metadata' },
      { method: 'GET', path: `${scopePrefix}/packages`, desc: 'List packages', group: 'System' },
      { method: 'GET', path: '/api/v1/health', desc: 'Health check', group: 'System' },
    ];

    try {
      let authBase = '/api/v1/auth';
      let discoveredServices: Record<string, { enabled: boolean; route?: string }> = {};
      let discoveredRoutes: Record<string, string> = {};

      try {
        const discRes = await fetch(discoveryUrl);
        if (discRes.ok) {
          const discData = await discRes.json();
          const data = discData?.data ?? discData;
          discoveredRoutes = data?.routes ?? {};
          discoveredServices = data?.services ?? {};
          if (discoveredRoutes.auth) authBase = discoveredRoutes.auth;
        }
      } catch {
        // discovery may not be available
      }

      const serviceEndpoints: EndpointDef[] = [];
      for (const [serviceName, catalog] of Object.entries(SERVICE_ENDPOINT_CATALOG)) {
        const serviceInfo = discoveredServices[serviceName] as
          (DiscoveryServiceStatus & { route?: string }) | undefined;
        // ADR-0076 D12 (framework#2462): gate on the shared honest-capability
        // check — `stub`/`unavailable`/`handlerReady:false` entries must not
        // render endpoint groups (`degraded` still serves and stays visible).
        // Services absent from discovery keep the historical fail-closed
        // behavior of this page: no entry → no endpoint group.
        const usable = serviceInfo ? isServiceUsable(serviceInfo) : false;
        const routePrefix = serviceInfo?.route
          ?? discoveredRoutes[serviceName]
          ?? catalog.defaultRoute;
        if (usable) {
          serviceEndpoints.push(...buildServiceEndpoints(serviceName, routePrefix));
        }
      }

      const client: any = adapter?.getClient?.();
      let metaTypes: string[] = [];
      try {
        const typesResult = await client?.meta?.getTypes?.();
        if (typesResult && Array.isArray(typesResult.types)) metaTypes = typesResult.types;
        else if (Array.isArray(typesResult)) metaTypes = typesResult as any;
      } catch {
        // meta types may not be available
      }

      let objectNames: string[] = [];
      try {
        const objectType = metaTypes.includes('object') ? 'object' : null;
        if (objectType && client?.meta?.getItems) {
          const objectResult = await client.meta.getItems(objectType);
          let items: any[] = [];
          if (Array.isArray(objectResult)) items = objectResult;
          else if (objectResult && Array.isArray(objectResult.items)) items = objectResult.items;
          else if (objectResult && Array.isArray((objectResult as any).value)) items = (objectResult as any).value;
          objectNames = items.map((item: any) => item.name || item.id).filter(Boolean);
        }
      } catch {
        // objects may not be available
      }

      const dataEndpoints: EndpointDef[] = objectNames.flatMap(name => {
        const isSystem = name.startsWith('sys_');
        const group = isSystem ? 'Data: system tables' : `Data: ${name}`;
        return [
          { method: 'GET' as HttpMethod, path: `${scopePrefix}/data/${name}`, desc: `List ${name}`, group },
          { method: 'POST' as HttpMethod, path: `${scopePrefix}/data/${name}`, desc: `Create ${name}`, group, bodyTemplate: { name: 'example' } },
          { method: 'GET' as HttpMethod, path: `${scopePrefix}/data/${name}/:id`, desc: `Get ${name} by ID`, group },
          { method: 'PATCH' as HttpMethod, path: `${scopePrefix}/data/${name}/:id`, desc: `Update ${name}`, group, bodyTemplate: { name: 'updated' } },
          { method: 'DELETE' as HttpMethod, path: `${scopePrefix}/data/${name}/:id`, desc: `Delete ${name}`, group },
        ];
      });

      const metaEndpoints: EndpointDef[] = metaTypes
        .filter(t => !EXCLUDED_META_TYPES.includes(t))
        .map(type => ({
          method: 'GET' as HttpMethod,
          path: `${scopePrefix}/meta/${type}`,
          desc: `List ${type} metadata`,
          group: 'Metadata',
        }));

      const schemaEndpoints: EndpointDef[] = objectNames.map(name => ({
        method: 'GET' as HttpMethod,
        path: `${scopePrefix}/meta/object/${name}`,
        desc: `${name} schema`,
        group: 'Metadata',
      }));

      const all = [
        ...systemEndpoints,
        ...buildAuthEndpoints(authBase),
        ...serviceEndpoints,
        ...metaEndpoints,
        ...schemaEndpoints,
        ...dataEndpoints,
      ];

      const groupMap = new Map<string, EndpointDef[]>();
      for (const ep of all) {
        const existing = groupMap.get(ep.group) || [];
        existing.push(ep);
        groupMap.set(ep.group, existing);
      }

      const GROUP_SORT_ORDER = ['System', 'Auth', 'AI', 'Workflow', 'Realtime', 'Notifications', 'Analytics', 'Automation', 'i18n', 'UI', 'Feed', 'Storage', 'Metadata'];
      const grouped = Array.from(groupMap.entries())
        .sort(([a], [b]) => {
          const aIdx = GROUP_SORT_ORDER.indexOf(a);
          const bIdx = GROUP_SORT_ORDER.indexOf(b);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
          return a.localeCompare(b);
        })
        .map(([key, endpoints]) => ({ key, label: key, endpoints }));

      setGroups(grouped);
      setAllEndpoints(all);
    } catch (err: any) {
      setError(err.message || 'Failed to discover APIs');
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => { discover(); }, [discover]);

  return { groups, allEndpoints, loading, error, refresh: discover };
}
