// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20761, ADR-0126 §2 / §7.1 / §7.3, ADR-0131 D6] A flow's package provenance
// is the server's fact — over the real showcase composition.
//
// ## Why this runs on a booted stack
//
// The unit pins sit beside each module: the one authoring rule in
// `@objectstack/metadata-protocol` (`protocol.tenant-authored-write.test.ts`),
// the doors in `@objectstack/runtime` (`automation-tenant-authored-write.test.ts`)
// and the engine's classification in `@objectstack/service-automation`
// (`packaged-flow-source.test.ts`). What none of them can answer is a question
// about the COMPOSITION: whether, on the stack an operator runs, every flow
// write door reaches the same protocol instance, whether the automation engine
// is really handed the loader's set through the plugin wiring, and whether a
// clone lands as a row a cold boot reads back. A composition that wired none
// of it would leave every unit test green.
//
// ## What each case pins (the ruling recorded on the card, point 4)
//
//   - a definition asserting a package's provenance for a name no package ships
//     is refused on the create door, on the update door and on `/meta`, and
//     nothing is written;
//   - a round trip of a SHIPPED flow is refused as a locked base on both doors;
//   - a round trip of a CUSTOMER flow is accepted unchanged on both doors;
//   - the activation door treats a customer flow as customer-authored, and no
//     activation row is attributed to a package from an authoring path;
//   - a clone of a shipped flow is saved as a tenant row: it reads back on the
//     metadata door, and it is still there after a cold boot on the same file;
//   - `/meta` on another metadata type keeps its old handling (the control).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { isCodeArtifactBody } from '@objectstack/metadata-core';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative connector refs resolve against the cwd — see the sibling boots. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

/** A flow the showcase package ships (`com.example.showcase`). */
const SHIPPED = 'showcase_urgent_task_alert';
/** Names no package ships, each used by one case. */
const ASSERTED = 'dogfood_asserted_flow_20761';
const CUSTOMER = 'dogfood_customer_flow_20761';
const META_ASSERTED = 'dogfood_meta_asserted_flow_20761';
const META_CUSTOMER = 'dogfood_meta_customer_flow_20761';
const CLONE = 'dogfood_clone_20761';
const META_BOUND = 'dogfood_bound_flow_20761';
/** A package this test creates through the package door — a tenant's own base, not a managed package. */
const TENANT_PACKAGE = 'com.dogfood.flows20761';

const LEDGER = 'sys_metadata_activation';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** A package the showcase composition really loads — the claim a caller must not be able to make. */
const REAL_PACKAGE = 'com.example.showcase';
const ASSERTION = { _packageId: REAL_PACKAGE, _provenance: 'package' };

const definition = (name: string) => ({
    name,
    label: `Dogfood ${name}`,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

interface DispatcherEnvelope {
    success?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
}
interface RestRefusal {
    error?: string;
    code?: string;
}
const dataOf = (json: unknown) => (json as DispatcherEnvelope).data;
const dispatcherCode = (json: unknown) => (json as DispatcherEnvelope).error?.code;
const restCode = (json: unknown) => (json as RestRefusal).code;

const plugins = () => [
    new ConnectorRestPlugin(),
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
];

async function boot(databaseFile: string): Promise<VerifyStack> {
    return bootStack(showcaseStack, { automation: true, databaseFile, extraPlugins: plugins() });
}

describe('a flow\'s package provenance is the server\'s fact at every door (showcase)', () => {
    let stack: VerifyStack;
    let token: string;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack.apiAs(token, method, path, body);
        const json: unknown = await res.json().catch(() => ({}));
        return { status: res.status, json };
    };
    /** `GET /meta/flow/:name` — the served document, unwrapped from whichever envelope carries it. */
    const metaRead = async (name: string) => {
        const read = await call('GET', `/meta/flow/${name}`);
        const json = read.json as Record<string, unknown>;
        const doc = (json?.data ?? json?.item ?? json) as Record<string, unknown>;
        return { status: read.status, doc: (doc?.item ?? doc) as Record<string, unknown> };
    };
    const ledgerRows = async (name: string) => {
        const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as {
            find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
        };
        return ql.find(LEDGER, { where: { metadata_type: 'flow', name }, context: SYSTEM_CTX });
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-20761-'));
        dbFile = join(dir, 'showcase.db');
        stack = await boot(dbFile);
        token = await stack.signIn();
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('the create door refuses a definition asserting a package for a name no package ships, and registers nothing', async () => {
        const created = await call('POST', '/automation', { ...definition(ASSERTED), ...ASSERTION });

        expect(created.status, JSON.stringify(created.json)).toBe(422);
        expect(dispatcherCode(created.json)).toBe('INVALID_METADATA');
        expect((await call('GET', `/automation/${ASSERTED}`)).status).toBe(404);
        expect(await ledgerRows(ASSERTED)).toEqual([]);
    });

    it('the update door refuses the same assertion on a customer flow, and the flow is unchanged', async () => {
        const created = await call('POST', '/automation', definition(CUSTOMER));
        expect(created.status, JSON.stringify(created.json)).toBe(200);
        const before = dataOf((await call('GET', `/automation/${CUSTOMER}`)).json);

        const updated = await call('PUT', `/automation/${CUSTOMER}`, { ...before, label: 'edited', ...ASSERTION });

        expect(updated.status, JSON.stringify(updated.json)).toBe(422);
        expect(dispatcherCode(updated.json)).toBe('INVALID_METADATA');
        expect(dataOf((await call('GET', `/automation/${CUSTOMER}`)).json)).toEqual(before);
    });

    it('a customer flow\'s own round trip through the automation door is accepted unchanged', async () => {
        const served = dataOf((await call('GET', `/automation/${CUSTOMER}`)).json)!;
        expect(isCodeArtifactBody(served)).toBe(false);

        const put = await call('PUT', `/automation/${CUSTOMER}`, served);

        expect(put.status, JSON.stringify(put.json)).toBe(200);
        expect(dataOf((await call('GET', `/automation/${CUSTOMER}`)).json)).toEqual(served);
    });

    it('a round trip of a shipped flow through the automation door is refused as a locked base', async () => {
        const served = dataOf((await call('GET', `/automation/${SHIPPED}`)).json)!;

        const put = await call('PUT', `/automation/${SHIPPED}`, served);

        expect(put.status, JSON.stringify(put.json)).toBe(403);
        expect(dispatcherCode(put.json)).toBe('NOT_OVERRIDABLE');
        expect(dataOf((await call('GET', `/automation/${SHIPPED}`)).json)).toEqual(served);
    });

    it('the activation door treats the customer flow as customer-authored, and writes no activation row', async () => {
        const off = await call('POST', `/automation/${CUSTOMER}/toggle`, { enabled: false });

        expect(off.status, JSON.stringify(off.json)).toBe(409);
        expect(dispatcherCode(off.json)).toBe('RESOURCE_CONFLICT');
        expect(await ledgerRows(CUSTOMER)).toEqual([]);
    });

    it('the metadata door applies the same rule to a flow: the assertion is refused and nothing is written', async () => {
        const put = await call('PUT', `/meta/flow/${META_ASSERTED}`, { ...definition(META_ASSERTED), ...ASSERTION });

        expect(put.status, JSON.stringify(put.json)).toBe(422);
        expect(restCode(put.json)).toBe('INVALID_METADATA');
        expect((await metaRead(META_ASSERTED)).status).toBe(404);
    });

    it('a customer flow\'s own round trip through the metadata door is accepted', async () => {
        const created = await call('PUT', `/meta/flow/${META_CUSTOMER}`, definition(META_CUSTOMER));
        expect(created.status, JSON.stringify(created.json)).toBe(200);
        const served = await metaRead(META_CUSTOMER);
        expect(served.status).toBe(200);
        expect(isCodeArtifactBody(served.doc)).toBe(false);

        const put = await call('PUT', `/meta/flow/${META_CUSTOMER}`, served.doc);

        expect(put.status, JSON.stringify(put.json)).toBe(200);
        expect((await metaRead(META_CUSTOMER)).doc.label).toBe(served.doc.label);
    });

    it('a customer flow bound to a tenant package round-trips through the metadata door, its binding echoed', async () => {
        const pkg = await call('POST', '/packages', { id: TENANT_PACKAGE, name: 'Dogfood flows', version: '1.0.0', type: 'app' });
        expect(pkg.status, JSON.stringify(pkg.json)).toBeLessThan(300);
        const created = await call('PUT', `/meta/flow/${META_BOUND}?package=${TENANT_PACKAGE}`, definition(META_BOUND));
        expect(created.status, JSON.stringify(created.json)).toBe(200);
        // MEASURED: the served body surfaces the row's binding as a package
        // stamp, which reads as code-shipped on its own — the edge the rule
        // must not break.
        const served = await metaRead(META_BOUND);
        expect(served.status).toBe(200);
        expect(isCodeArtifactBody(served.doc)).toBe(true);

        const echoed = await call('PUT', `/meta/flow/${META_BOUND}?package=${TENANT_PACKAGE}`, served.doc);
        expect(echoed.status, JSON.stringify(echoed.json)).toBe(200);
        const bare = await call('PUT', `/meta/flow/${META_BOUND}`, served.doc);
        expect(bare.status, JSON.stringify(bare.json)).toBe(200);
    });

    it('a round trip of a shipped flow through the metadata door is refused as a locked base', async () => {
        const served = await metaRead(SHIPPED);
        expect(served.status).toBe(200);

        const put = await call('PUT', `/meta/flow/${SHIPPED}`, served.doc);

        expect(put.status, JSON.stringify(put.json)).toBe(403);
        expect(['NOT_OVERRIDABLE', 'ITEM_LOCKED']).toContain(restCode(put.json));
    });

    it('control: the metadata door keeps its old handling of the same assertion on another type', async () => {
        const name = 'dogfood_control_20761';
        const put = await call('PUT', `/meta/dashboard/${name}`, {
            name,
            label: 'Control',
            widgets: [],
            ...ASSERTION,
        });

        expect(put.status, JSON.stringify(put.json)).toBe(200);
    });

    it('a clone of a shipped flow is saved as a tenant row that reads back on the metadata door', async () => {
        const res = await call('POST', `/automation/${SHIPPED}/clone`, { name: CLONE, label: 'Dogfood clone' });
        expect(res.status, JSON.stringify(res.json)).toBe(200);

        const served = await metaRead(CLONE);
        expect(served.status, JSON.stringify(served.doc)).toBe(200);
        expect(isCodeArtifactBody(served.doc)).toBe(false);
        // The clone is the customer's: the activation door refuses it too.
        const off = await call('POST', `/automation/${CLONE}/toggle`, { enabled: false });
        expect(off.status, JSON.stringify(off.json)).toBe(409);
        expect(await ledgerRows(CLONE)).toEqual([]);
    });

    it('the clone survives a cold boot on the same database file', async () => {
        await stack.stop();
        stack = await boot(dbFile);
        token = await stack.signIn();

        const automation = await call('GET', `/automation/${CLONE}`);
        expect(automation.status, JSON.stringify(automation.json)).toBe(200);
        expect(dataOf(automation.json)?.label).toBe('Dogfood clone');
        expect((await metaRead(CLONE)).status).toBe(200);
        // …and it is still classified as the customer's after the restart.
        const off = await call('POST', `/automation/${CLONE}/toggle`, { enabled: false });
        expect(off.status, JSON.stringify(off.json)).toBe(409);
        expect(dispatcherCode(off.json)).toBe('RESOURCE_CONFLICT');
    }, 180_000);

    it('after the cold boot, the package-bound customer flow round-trips through the automation door and is still the customer\'s', async () => {
        const read = await call('GET', `/automation/${META_BOUND}`);
        expect(read.status, JSON.stringify(read.json)).toBe(200);
        const served = dataOf(read.json)!;

        const put = await call('PUT', `/automation/${META_BOUND}`, served);
        expect(put.status, JSON.stringify(put.json)).toBe(200);

        // Its body names a package, and the engine still does not count it as
        // one: only the loader's set makes a flow packaged.
        const off = await call('POST', `/automation/${META_BOUND}/toggle`, { enabled: false });
        expect(off.status, JSON.stringify(off.json)).toBe(409);
        expect(dispatcherCode(off.json)).toBe('RESOURCE_CONFLICT');
        expect(await ledgerRows(META_BOUND)).toEqual([]);
    });
});
