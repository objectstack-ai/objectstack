// TEMPORARY MEASUREMENT — deleted before commit. #18402 dialect re-derivation.
import { describe, it, vi } from 'vitest';
import { RestServer } from './rest-server';

const ANON = { api: { requireAuth: false } };

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}
function makeRes() {
    const res: any = { statusCode: 200, body: undefined, sent: false };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; res.sent = true; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    res.send = vi.fn(() => { res.sent = true; return res; });
    return res;
}
function absentItemEnvelope(type: string, name: string) {
    return { type, name, item: undefined, lock: 'none', editable: true, deletable: true, resettable: false };
}
function setup(corpus: Record<string, unknown> = {}, opts: any = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: opts.getMetaItem ?? vi.fn(async ({ type, name }: any) => {
            const hit = corpus[`${type}/${name}`];
            return hit === undefined
                ? absentItemEnvelope(type, name)
                : { type, name, item: JSON.parse(JSON.stringify(hit)), lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        findData: vi.fn().mockResolvedValue([]),
        ...(opts.cached !== undefined ? { getMetaItemCached: opts.cached } : {}),
    };
    const rest = new RestServer(mockServer() as any, protocol as any, (opts.config ?? ANON) as any);
    (rest as any).resolveExecCtx = async () => (opts.ctx === null ? undefined : { userId: 'u1', systemPermissions: opts.perms ?? [], ...(opts.ctx ?? {}) });
    if (opts.masker) (rest as any).resolveObjectMasker = opts.masker;
    rest.registerRoutes();
    return { rest, protocol };
}
async function getItem(rest: any, type: string, name: string, query: any = {}, headers: any = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type, name }, query, body: {}, headers }, res);
    return res;
}
function dump(label: string, res: any) {
    const bytes = res.body === undefined ? '<no json body>' : JSON.stringify(res.body);
    // eslint-disable-next-line no-console
    console.log(`\n### ${label}\n    status=${res.statusCode}\n    bytes=${bytes}\n    body.error.code=${JSON.stringify(res.body?.error?.code)}  body.code=${JSON.stringify(res.body?.code)}  top-keys=${JSON.stringify(Object.keys(res.body ?? {}))}`);
}

const UNPUBLISHED_APP = { name: 'production_management', label: 'PM', _unpublished: true, navigation: [{ id: 'n1', type: 'object', objectName: 'secret_line' }] };
const FINANCE_APP = { name: 'finance', label: 'Finance', requiredPermissions: ['finance.access'], navigation: [{ id: 'n2', type: 'object', objectName: 'invoice' }] };
const GATED_BOOK = { name: 'admin_guide', label: 'Admin Guide', audience: { permissionSet: 'crm_admin' }, groups: [] };
const GATED = { 'app/production_management': UNPUBLISHED_APP, 'app/finance': FINANCE_APP };

describe('#18402 MEASUREMENT on current origin/main', () => {
    it('drives every refusal arm and dumps wire bytes', async () => {
        dump('A1 absent name (uncached, app)', await getItem(setup(GATED, { perms: ['manage_users'] }).rest, 'app', 'no_such_app_xyz'));
        dump('A2 UNPUBLISHED app (uncached)', await getItem(setup(GATED, { perms: ['manage_users'] }).rest, 'app', 'production_management'));
        dump('A3 app permission denied', await getItem(setup(GATED, { perms: ['manage_users'] }).rest, 'app', 'finance'));
        dump('A4 book audience denied (authed non-holder)', await getItem(setup({ 'book/admin_guide': GATED_BOOK }).rest, 'book', 'admin_guide'));
        dump('A5 book audience anonymous', await getItem(setup({ 'book/admin_guide': GATED_BOOK }, { ctx: null }).rest, 'book', 'admin_guide'));

        const cachedMiss = Object.assign(new Error('Metadata item view/no_such_view not found'), { code: 'RESOURCE_NOT_FOUND', status: 404 });
        dump('A6 CACHED arm miss (getMetaItemCached throws)', await getItem(setup({}, { cached: vi.fn().mockRejectedValue(cachedMiss) }).rest, 'view', 'no_such_view'));

        dump('A7 UNCACHED arm, producer THROWS the miss', await getItem(setup({}, { getMetaItem: vi.fn().mockRejectedValue(Object.assign(new Error('Metadata item object/acct not found'), { code: 'RESOURCE_NOT_FOUND', status: 404 })), config: { api: { requireAuth: false }, metadata: { enableCache: false } } }).rest, 'object', 'acct'));

        dump('A8 uncached absence, non-app type (enableCache:false)', await getItem(setup({}, { config: { api: { requireAuth: false }, metadata: { enableCache: false } } }).rest, 'view', 'no_such_view'));

        dump('A9 store outage 503', await getItem(setup({}, { getMetaItem: vi.fn().mockRejectedValue(Object.assign(new Error('The metadata store could not be read.'), { code: 'SERVICE_UNAVAILABLE', status: 503 })), config: { api: { requireAuth: false }, metadata: { enableCache: false } } }).rest, 'object', 'acct'));

        // field-visibility 503 — masker throws ObjectSchemaMaskEvaluationError
        const { ObjectSchemaMaskEvaluationError } = await import('@objectstack/types');
        dump('A10 field-visibility unresolved 503', await getItem(setup({}, {
            masker: async () => { throw new ObjectSchemaMaskEvaluationError('nope'); },
        }).rest, 'object', 'acct'));

        // repeated query param refusal (ADR-0112 nested, per Route & surface ownership)
        dump('A11 repeated query param', await getItem(setup({}).rest, 'object', 'acct', { state: ['draft', 'draft'] }));
    }, 60_000);
});
