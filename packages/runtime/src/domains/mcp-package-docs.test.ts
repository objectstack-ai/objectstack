// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35442] The HTTP MCP door's app-docs members (`search_package_docs` /
 * `read_package_doc`), driven through the bridge the real `/mcp` entry builds
 * for a caller, over a fixture package with two manual pages.
 *
 * - The maintainer's two questions reach the right pages: 「什么是回款」 (the
 *   client lifts 回款) finds the order-and-payment manual, and 「商机的审批流程」
 *   (商机, 审批) finds the opportunity stages-and-approval manual, each with the
 *   console address it opens at.
 * - One visibility rule, the `/meta/doc` docs-audience gate (ADR-0046 §6.7):
 *   a page only a `{ permissionSet }` manual claims is neither found nor read
 *   by a caller without that set, and is both for a holder — the control that
 *   it is a match at all.
 * - On an OAuth grant (ADR-0090 D10) the holdings are the delegating person's
 *   own, read by grant resolution in the token's organization: a holder finds
 *   and reads the page, a non-holder does not, a person who does not exist or
 *   holds no membership there holds no set, a set only the token's ceiling
 *   carries opens nothing, and a token whose scope does not reach the docs
 *   tools is carried no docs member at all.
 * - The address follows the Console's home-manual pick: the manual that claims
 *   the page, else the package's implicit manual (ADR-0046 §6.4).
 * - The door's twin for the tool layer is `packages/mcp/src/mcp-package-doc-tools-35442.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { MCP_AGENT_PERMISSION_SET_READ } from '@objectstack/spec/ai';
import { HttpDispatcher } from '../http-dispatcher.js';
import { resolveExecutionContext } from '../security/resolve-execution-context.js';
import { bindCatalogFromTables } from '../security/security-catalog.testkit.js';
// Paid at collection, not inside a case's clock: the dispatcher's reach loads it lazily.
import '@objectstack/metadata';

const CRM = 'com.example.crm';
const HR = 'com.example.hr';

const BOOKS = [
    {
        name: 'crm_sales',
        slug: 'sales',
        label: 'Sales manuals',
        order: 1,
        _packageId: CRM,
        groups: [
            { key: 'orders', label: 'Orders', pages: ['crm_order_payment'] },
            { key: 'opportunities', label: 'Opportunities', pages: ['crm_opportunity_stages'] },
        ],
    },
    {
        name: 'crm_admin_book',
        slug: 'admin',
        label: 'Administration',
        order: 2,
        audience: { permissionSet: 'crm_admin' },
        _packageId: CRM,
        groups: [{ key: 'rules', label: 'Rules', pages: ['crm_commission_rules'] }],
    },
];

const DOCS = [
    {
        name: 'crm_order_payment',
        label: '订单与回款手册',
        description: '从下单到回款的全过程。',
        _packageId: CRM,
        content: '# 订单与回款手册\n\n## 订单\n\n订单在报价确认后生成。\n\n## 回款\n\n回款是客户按合同约定支付的款项，到账后登记回款记录。\n',
        translations: {
            en: { label: 'Orders and payments', content: '# Orders and payments\n\n## Payment collection\n\nA payment is money the customer pays under the contract.\n' },
        },
    },
    {
        name: 'crm_opportunity_stages',
        label: '商机——阶段、提醒与审批',
        _packageId: CRM,
        content: '# 商机——阶段、提醒与审批\n\n## 阶段\n\n商机按阶段推进。\n\n## 审批\n\n折扣超过 20% 的商机需经 opportunity_approval 审批。\n',
    },
    {
        name: 'crm_commission_rules',
        label: '佣金规则',
        _packageId: CRM,
        content: '# 佣金规则\n\n回款到账后计提佣金。\n',
    },
    {
        name: 'hr_leave',
        label: 'Leave',
        _packageId: HR,
        content: '# Leave\n\nLeave requests go through approval.\n',
    },
];

/**
 * The grant rows behind the OAuth pins: `admin` holds `crm_admin` in `orgA`;
 * `u1` is a member of `orgA` holding it only in `orgB`; `ghost` has grant and
 * membership rows and no `sys_user` row.
 */
function grantQl() {
    const tables: Record<string, any[]> = {
        sys_user: [{ id: 'admin' }, { id: 'u1' }],
        sys_organization: [{ id: 'orgA' }, { id: 'orgB' }],
        sys_member: ['admin', 'u1', 'ghost'].map((user_id) => ({ user_id, organization_id: 'orgA', role: 'member' })),
        sys_user_permission_set: [
            { id: 'g1', user_id: 'admin', permission_set_id: 'ps_crm_admin', permission_set: 'crm_admin', organization_id: 'orgA' },
            { id: 'g2', user_id: 'ghost', permission_set_id: 'ps_crm_admin', permission_set: 'crm_admin', organization_id: 'orgA' },
            { id: 'g3', user_id: 'u1', permission_set_id: 'ps_crm_admin', permission_set: 'crm_admin', organization_id: 'orgB' },
        ],
        sys_permission_set: [{ id: 'ps_crm_admin', name: 'crm_admin', object_permissions: '{}' }],
        sys_position: [], sys_position_permission_set: [], sys_user_position: [],
    };
    const match = (opts: any) => (row: any) => Object.entries(opts?.where ?? {}).every(([k, v]) =>
        v !== null && typeof v === 'object'
            ? (Array.isArray((v as any).$in) ? (v as any).$in.includes(row[k]) : true)
            : (v ?? null) === (row[k] ?? null));
    return bindCatalogFromTables({
        async find(object: string, opts: any) {
            const rows = (tables[object] ?? []).filter(match(opts));
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
        async findOne(object: string, opts: any) {
            return (tables[object] ?? []).find(match(opts)) ?? null;
        },
    }, tables);
}

/** The envelope the real `/mcp` identity door resolves for an OAuth token `person` consented to in `orgA`. */
async function oauthEnvelope(person: string, scopes: string[], ql = grantQl()) {
    return resolveExecutionContext({
        acceptOAuthAccessToken: true,
        getService: async (name: string) => name === 'auth'
            ? { verifyMcpAccessToken: async () => ({ userId: person, scopes, clientId: 'c1', organizationId: 'orgA' }) }
            : undefined,
        getQl: async () => ql,
        request: { headers: { authorization: 'Bearer a.b.c' } },
    } as never) as Promise<Record<string, unknown>>;
}

/**
 * A kernel over a protocol serving `items`, a security service, a data engine
 * (`grantQl`) and an `mcp` service that hands back the bridge. The security
 * fake answers the set names a context carries (`permissions`), as the real
 * resolver requests them with the baseline left out: an agent envelope's are
 * the token's scope-derived ceiling, a person's are their own.
 */
function kernelOver(items: { doc: any[]; book: any[] } | null) {
    const mcp: any = {
        lastOpts: undefined,
        handleHttpRequest: async (_req: Request, o: any) => {
            mcp.lastOpts = o;
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
    };
    const protocol = items
        ? { getMetaItems: async ({ type }: { type: string }) => ({ type, items: (items as any)[type] ?? [] }) }
        : {};
    const security = { resolvePermissionSetNames: async (ctx: any) => [...(ctx?.permissions ?? [])] };
    const all: Record<string, any> = { protocol, security, mcp, objectql: grantQl() };
    const get = (n: string) => all[n] ?? null;
    return { getService: get, getServiceAsync: async (n: string) => get(n), context: { getService: get } } as any;
}

/** A signed-in session's envelope carries the person's own sets: `admin` holds `crm_admin`. */
const session = (userId: string) => ({ userId, isSystem: false, permissions: userId === 'admin' ? ['crm_admin'] : [] });

/** The options the `/mcp` route hands the MCP runtime for this caller. */
async function servedFor(caller: string | Record<string, unknown>, items: { doc: any[]; book: any[] } | null = { doc: DOCS, book: BOOKS }) {
    const kernel = kernelOver(items);
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await dispatcher.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        request: new Request('http://localhost/api/v1/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: '{}',
        }),
        response: {},
        environmentId: undefined,
        executionContext: typeof caller === 'string' ? session(caller) : caller,
    } as any);
    expect(res.response?.status, 'precondition: the MCP route must have been served').toBe(200);
    return kernel.getService('mcp').lastOpts;
}

async function bridgeFor(caller: string | Record<string, unknown>, items?: { doc: any[]; book: any[] } | null) {
    return (await servedFor(caller, items)).bridge;
}

const MAX = { maxResults: 10 };

describe('[#35442] the maintainer\'s two questions reach the right manual pages', () => {
    it('「什么是回款」: 回款 finds the order-and-payment manual, with the address it opens at', async () => {
        const bridge = await bridgeFor('u1');
        const answer = await bridge.searchPackageDocs({ terms: ['回款'] }, MAX);
        expect(answer.results[0]).toMatchObject({
            name: 'crm_order_payment',
            package: CRM,
            title: '订单与回款手册',
            book: { name: 'crm_sales', label: 'Sales manuals' },
            url: `/_console/apps/${CRM}/docs/sales/crm_order_payment`,
            matchedOn: 'title',
            matchedTerms: ['回款'],
        });
        const page = await bridge.readPackageDoc({ name: 'crm_order_payment' });
        expect(page.content).toContain('回款是客户按合同约定支付的款项');
        expect(page.url).toBe(`/_console/apps/${CRM}/docs/sales/crm_order_payment`);
    });

    it('「商机的审批流程」: 商机 and 审批 find the opportunity manual first, both terms matched', async () => {
        const bridge = await bridgeFor('u1');
        const answer = await bridge.searchPackageDocs({ terms: ['商机', '审批'] }, MAX);
        expect(answer.results[0]).toMatchObject({
            name: 'crm_opportunity_stages',
            title: '商机——阶段、提醒与审批',
            url: `/_console/apps/${CRM}/docs/sales/crm_opportunity_stages`,
            matchedTerms: ['商机', '审批'],
        });
        const page = await bridge.readPackageDoc({ name: 'crm_opportunity_stages' });
        expect(page.content).toContain('opportunity_approval');
    });
});

describe('[#35442] one visibility rule: the /meta/doc docs-audience gate', () => {
    it('a page only a permission-set manual claims is neither found nor read without the set', async () => {
        const bridge = await bridgeFor('u1');
        const names = (await bridge.searchPackageDocs({ terms: ['回款'] }, MAX)).results.map((r: any) => r.name);
        expect(names).toEqual(['crm_order_payment']);
        await expect(bridge.readPackageDoc({ name: 'crm_commission_rules' })).rejects.toMatchObject({
            code: 'RESOURCE_NOT_FOUND',
            status: 404,
        });
    });

    it('control: the holder of the set finds and reads it, addressed through the manual that claims it', async () => {
        const bridge = await bridgeFor('admin');
        const names = (await bridge.searchPackageDocs({ terms: ['回款'] }, MAX)).results.map((r: any) => r.name);
        expect(names).toEqual(expect.arrayContaining(['crm_order_payment', 'crm_commission_rules']));
        const page = await bridge.readPackageDoc({ name: 'crm_commission_rules' });
        expect(page.url).toBe(`/_console/apps/${CRM}/docs/admin/crm_commission_rules`);
    });
});

/** The page names a search for 回款 finds, and whether the restricted page reads. */
async function reach(bridge: any): Promise<{ found: string[]; reads: boolean }> {
    const found = (await bridge.searchPackageDocs({ terms: ['回款'] }, MAX)).results.map((r: any) => r.name).sort();
    const reads = await bridge.readPackageDoc({ name: 'crm_commission_rules' }).then(
        () => true,
        (e: any) => {
            expect(e).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
            return false;
        },
    );
    return { found, reads };
}

const OPEN = { found: ['crm_commission_rules', 'crm_order_payment'], reads: true };
const CLOSED = { found: ['crm_order_payment'], reads: false };

describe('[#35584] on an OAuth grant the audience reads the delegating person\'s own holdings (ADR-0090 D10)', () => {
    it('precondition: the envelope is the agent acting for the person, its sets the token\'s ceiling', async () => {
        const ec = await oauthEnvelope('admin', ['data:read']);
        expect(ec).toMatchObject({ principalKind: 'agent', onBehalfOf: { userId: 'admin' }, tenantId: 'orgA', permissions: [MCP_AGENT_PERMISSION_SET_READ] });
    });

    // Edited in place: before ADR-0090 D10 was applied here the agent envelope's
    // ceiling was the caller, and this holder answered CLOSED.
    it('the holder of the set finds and reads the page, addressed through the manual that claims it', async () => {
        const bridge = await bridgeFor(await oauthEnvelope('admin', ['data:read']));
        expect(await reach(bridge)).toEqual(OPEN);
        expect((await bridge.readPackageDoc({ name: 'crm_commission_rules' })).url).toBe(`/_console/apps/${CRM}/docs/admin/crm_commission_rules`);
    });

    it('control: a person who does not hold the set in the token\'s organization neither finds nor reads it', async () => {
        expect(await reach(await bridgeFor(await oauthEnvelope('u1', ['data:read'])))).toEqual(CLOSED);
    });

    it('a token whose scope does not reach the docs tools is carried no docs member, whatever the person holds', async () => {
        const opts = await servedFor(await oauthEnvelope('admin', ['metadata:write', 'actions:execute']));
        expect(opts.toolOptions).toEqual({ grantedScopes: ['metadata:write', 'actions:execute'] });
        expect(opts.bridge.searchPackageDocs).toBeUndefined();
        expect(opts.bridge.readPackageDoc).toBeUndefined();
    });

    it('fails closed: a person with no user row, or with no membership in the request\'s organization, holds no set', async () => {
        const held = await oauthEnvelope('admin', ['data:read']);
        const ghost = { ...held, userId: 'ghost', onBehalfOf: { userId: 'ghost', principalKind: 'human' } };
        expect(await reach(await bridgeFor(ghost))).toEqual(CLOSED);
        // `u1` holds the set in orgB only, and is a member of orgA only.
        const outside = { ...(await oauthEnvelope('u1', ['data:read'])), tenantId: 'orgB' };
        expect(await reach(await bridgeFor(outside))).toEqual(CLOSED);
    });

    it('no union: a manual whose audience is a set only the token\'s ceiling carries stays closed', async () => {
        const books = [...BOOKS.slice(0, 1), { ...BOOKS[1], audience: { permissionSet: MCP_AGENT_PERMISSION_SET_READ } }];
        expect(await reach(await bridgeFor(await oauthEnvelope('admin', ['data:read']), { doc: DOCS, book: books }))).toEqual(CLOSED);
    });

    it('an AI service account keeps its own sets', async () => {
        const account = { userId: 'svc_bot', isSystem: false, principalKind: 'agent', positions: [], permissions: ['crm_admin'] };
        expect(await reach(await bridgeFor(account))).toEqual(OPEN);
    });
});

describe('[#35442] search and read details', () => {
    it('a page no manual claims opens in its package\'s implicit manual; package narrows the search', async () => {
        const bridge = await bridgeFor('u1');
        const all = await bridge.searchPackageDocs({ terms: ['approval'] }, MAX);
        expect(all.results.map((r: any) => r.name)).toEqual(expect.arrayContaining(['hr_leave', 'crm_opportunity_stages']));
        const hr = await bridge.searchPackageDocs({ terms: ['approval'], package: HR }, MAX);
        expect(hr.results).toHaveLength(1);
        expect(hr.results[0]).toMatchObject({
            name: 'hr_leave',
            book: { name: HR },
            url: `/_console/apps/${HR}/docs/${HR}/hr_leave`,
            matchedOn: 'text',
        });
    });

    it('a term found only in a translation is reported in that locale, and read serves that translation', async () => {
        const bridge = await bridgeFor('u1');
        const answer = await bridge.searchPackageDocs({ terms: ['payment collection'] }, MAX);
        expect(answer.results[0]).toMatchObject({ name: 'crm_order_payment', matchedOn: 'heading', heading: 'Payment collection', locale: 'en' });
        const page = await bridge.readPackageDoc({ name: 'crm_order_payment', locale: 'en' });
        expect(page).toMatchObject({ title: 'Orders and payments', locale: 'en' });
        expect(page.content).toContain('money the customer pays');
    });

    it('the cap holds and says more matched; no term at all is refused', async () => {
        const bridge = await bridgeFor('u1');
        const capped = await bridge.searchPackageDocs({ terms: ['商机', '回款'] }, { maxResults: 1 });
        expect(capped.results).toHaveLength(1);
        expect(capped.truncated).toBe(true);
        await expect(bridge.searchPackageDocs({ terms: ['  '] }, MAX)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });

    it('a name two packages ship is refused until package names one', async () => {
        const twin = { ...DOCS[3], _packageId: CRM };
        const bridge = await bridgeFor('u1', { doc: [...DOCS, twin], book: BOOKS });
        await expect(bridge.readPackageDoc({ name: 'hr_leave' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect((await bridge.readPackageDoc({ name: 'hr_leave', package: HR })).package).toBe(HR);
    });

    it('a long-whitespace heading parses fast', async () => {
        const WIKI = 'com.example.wiki';
        const doc = { name: 'wiki_wide', _packageId: WIKI, content: `# a${' '.repeat(20_000)}b\n\nBody text.\n` };
        const bridge = await bridgeFor('u1', { doc: [doc], book: [] });
        const started = Date.now();
        const answer = await bridge.searchPackageDocs({ terms: ['body'] }, MAX);
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(answer.results).toHaveLength(1);
        expect(answer.results[0].title.startsWith('a ')).toBe(true);
        expect(answer.results[0].title.endsWith(' b')).toBe(true);
        expect(answer.results[0].matchedOn).toBe('text');
    });

    it('a bare \'#\' line followed by text is not a heading', async () => {
        const WIKI = 'com.example.wiki';
        const doc = { name: 'wiki_bare', _packageId: WIKI, content: '#\nPlain words under no heading.\n' };
        const bridge = await bridgeFor('u1', { doc: [doc], book: [] });
        const answer = await bridge.searchPackageDocs({ terms: ['plain words'] }, MAX);
        expect(answer.results[0]).toMatchObject({ name: 'wiki_bare', title: 'wiki_bare', matchedOn: 'text' });
        expect(answer.results[0].heading).toBeUndefined();
        expect((await bridge.readPackageDoc({ name: 'wiki_bare' })).title).toBe('wiki_bare');
    });

    it('a host whose protocol has no list read carries neither member', async () => {
        const bridge = await bridgeFor('u1', null);
        expect(bridge.searchPackageDocs).toBeUndefined();
        expect(bridge.readPackageDoc).toBeUndefined();
    });
});
