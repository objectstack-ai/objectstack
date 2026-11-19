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
 * - The address follows the Console's home-manual pick: the manual that claims
 *   the page, else the package's implicit manual (ADR-0046 §6.4).
 * - The door's twin for the tool layer is `packages/mcp/src/mcp-package-doc-tools-35442.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

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

/** A kernel over a protocol serving `items`, a security service granting `crm_admin` to `admin`, and an `mcp` service that hands back the bridge. */
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
    const security = {
        resolvePermissionSetNames: async (ctx: any) => (ctx?.userId === 'admin' ? ['crm_admin'] : []),
    };
    const all: Record<string, any> = { protocol, security, mcp };
    const get = (n: string) => all[n] ?? null;
    return { getService: get, getServiceAsync: async (n: string) => get(n), context: { getService: get } } as any;
}

async function bridgeFor(userId: string, items: { doc: any[]; book: any[] } | null = { doc: DOCS, book: BOOKS }) {
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
        executionContext: { userId, isSystem: false },
    } as any);
    expect(res.response?.status, 'precondition: the MCP route must have been served').toBe(200);
    return kernel.getService('mcp').lastOpts.bridge;
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

    it('a host whose protocol has no list read carries neither member', async () => {
        const bridge = await bridgeFor('u1', null);
        expect(bridge.searchPackageDocs).toBeUndefined();
        expect(bridge.readPackageDoc).toBeUndefined();
    });
});
