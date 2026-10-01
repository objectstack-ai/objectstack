// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20946, #20761 ruling rule 1, ADR-0126 §2, ADR-0131 D6] For a flow name the
// loader ships from a managed package, the by-name read and the list read
// answer ONE body — the loader's — and a stored row of that name stays what the
// list and the boot receipt already say it is: a shadowed contender, never the
// package's definition. Over the real showcase composition, on a database file.
//
// ## What was broken
//
// Since #20913 the flattened flow view (the list door and the execution view)
// serves a shipped name from the loader's entries alone. The by-name read did
// not: it adopted the environment-wide stored row first and then grafted the
// artifact's protection envelope over it, so `GET /meta/flow/NAME` answered the
// stored body as the package's definition while `GET /meta/flow` answered the
// loader's. Two read doors, two answers about one name.
//
// ## Why a booted stack, over two boots
//
// The unit pins (`protocol.flow-by-name-shipped-name.test.ts`) hold the read's
// branches with doubles. What they cannot answer is the composition: that the
// by-name door's real sources — the stored row, the metadata service and the
// registry the boot hydration filled — all resolve to the loader's body once
// the row is at rest. A stored row is only read back by a cold boot, so the
// stack is booted twice on one file.
//
// ## What each case pins (triage's pins, plus the two controls)
//
//   - by name, a shipped name with a stored row answers the loader's body, on
//     both spellings of the door (with and without a package scope);
//   - by name and in the list, that name answers the same body;
//   - the stored row is still reported as a shadowed contender;
//   - a shipped name with no stored row is unchanged (control);
//   - an organization-scoped row stays out of reach (control);
//   - a name no managed package ships still answers its stored row (control).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative connector refs resolve against the cwd — see the sibling boots. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

/** The package the showcase composition loads its flows from. */
const SHOWCASE_PACKAGE = 'com.example.showcase';
/** A shipped flow given an environment-wide stored row of its name: the subject. */
const SUBJECT = 'showcase_urgent_task_alert';
/** A shipped flow given no stored row at all: the control. */
const CONTROL = 'showcase_task_completed';
/** A shipped flow given an ORGANIZATION-scoped row only. */
const ORG_SUBJECT = 'showcase_task_assigned_notify';
const ORG_ID = 'org_dogfood_20946';
/** A shipped screen flow whose body seeds the customer flow below (no trigger). */
const CUSTOMER_SOURCE = 'showcase_reassign_wizard';
/** A flow name no managed package ships, given an environment-wide stored row. */
const CUSTOMER = 'dogfood_20946_customer_flow';

/** The node id and label a stored body carries, so it can be told from the loader's. */
const STORED_NODE = 'stored_node_20946';
const STORED_LABEL = 'Stored body 20946';
const CUSTOMER_LABEL = 'Customer flow 20946';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

interface FlowBody {
    name?: string;
    label?: string;
    nodes?: Array<{ id: string }>;
}
interface Engine {
    getFlow(name: string): Promise<FlowBody | null>;
    getShadowedFlows(): Array<{ name: string; armed: unknown; shadowed: unknown[] }>;
    packagedFlowOwner(name: string): string | undefined;
}
interface Ql {
    insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
}

const plugins = () => [
    new RecordChangeTriggerPlugin(),
    new ConnectorRestPlugin(),
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
];

async function boot(databaseFile: string): Promise<VerifyStack> {
    return bootStack(showcaseStack, { automation: true, databaseFile, extraPlugins: plugins() });
}

const nodeIds = (flow: FlowBody | null | undefined) => (flow?.nodes ?? []).map((n) => n.id);

/** A copy of a loader's body with every underscore-prefixed key dropped. */
function plainCopy(loader: FlowBody | null): Record<string, unknown> {
    const body: Record<string, unknown> = JSON.parse(JSON.stringify(loader));
    for (const key of Object.keys(body)) if (key.startsWith('_')) delete body[key];
    return body;
}

/** The loader's body, as a distinguishable stored body: a new label, one node renamed. */
function storedBodyFrom(loader: FlowBody | null): Record<string, unknown> {
    const body = plainCopy(loader);
    body.label = STORED_LABEL;
    const nodes = body.nodes as Array<{ id: string }>;
    const edges = body.edges as Array<{ source: string; target: string }>;
    const from = nodes[1].id;
    nodes[1].id = STORED_NODE;
    for (const edge of edges) {
        if (edge.source === from) edge.source = STORED_NODE;
        if (edge.target === from) edge.target = STORED_NODE;
    }
    return body;
}

describe('the by-name flow read agrees with the list for a shipped name across a cold boot (showcase)', () => {
    let stack: VerifyStack;
    let token: string;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    const loader: Record<string, FlowBody | null> = {};

    const engine = () => stack.kernel.getServiceAsync('automation') as unknown as Promise<Engine>;
    const ql = () => stack.kernel.getServiceAsync('objectql') as unknown as Promise<Ql>;

    const call = async (path: string) => {
        const res = await stack.apiAs(token, 'GET', path);
        const json: unknown = await res.json().catch(() => ({}));
        return { status: res.status, json };
    };
    /** `GET /meta/flow/:name` — the served document, unwrapped from whichever envelope carries it. */
    const byName = async (name: string, query = '') => {
        const read = await call(`/meta/flow/${name}${query}`);
        const json = read.json as Record<string, unknown>;
        const doc = (json?.data ?? json?.item ?? json) as Record<string, unknown>;
        return { status: read.status, doc: (doc?.item ?? doc) as FlowBody };
    };
    /** `GET /meta/flow` — every served entry of one name. */
    const listed = async (name: string) => {
        const read = await call('/meta/flow');
        const json = read.json as Record<string, unknown>;
        const data = (json?.data ?? json) as Record<string, unknown> | unknown[];
        const items = (Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? []) as FlowBody[];
        return { status: read.status, entries: items.filter((it) => it?.name === name) };
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-20946-'));
        dbFile = join(dir, 'showcase.db');

        // First boot: read the loader's bodies, then put rows in the store.
        stack = await boot(dbFile);
        const first = await engine();
        const store = await ql();
        for (const name of [SUBJECT, CONTROL, ORG_SUBJECT, CUSTOMER_SOURCE]) loader[name] = await first.getFlow(name);

        const now = new Date().toISOString();
        const row = (name: string, organizationId: string | null, body: Record<string, unknown>) => ({
            type: 'flow',
            name,
            organization_id: organizationId,
            package_id: null,
            state: 'active',
            version: 1,
            checksum: null,
            created_at: now,
            updated_at: now,
            metadata: JSON.stringify(body),
        });
        const customer = { ...plainCopy(loader[CUSTOMER_SOURCE]), name: CUSTOMER, label: CUSTOMER_LABEL };
        for (const data of [
            row(SUBJECT, null, storedBodyFrom(loader[SUBJECT])),
            row(ORG_SUBJECT, ORG_ID, storedBodyFrom(loader[ORG_SUBJECT])),
            row(CUSTOMER, null, customer),
        ]) {
            await store.insert('sys_metadata', data, { context: SYSTEM_CTX });
        }
        await stack.stop();

        // The measured boot: cold, on the same file.
        stack = await boot(dbFile);
        token = await stack.signIn();
    }, 360_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('the store holds the rows the second boot read, and the loader still ships the subject', async () => {
        const rows = await (await ql()).find('sys_metadata', {
            where: { type: 'flow', state: 'active' },
            context: SYSTEM_CTX,
        });
        const names = rows.map((r) => `${String(r.name)}@${String(r.organization_id ?? '')}`);
        expect(names).toContain(`${SUBJECT}@`);
        expect(names).toContain(`${ORG_SUBJECT}@${ORG_ID}`);
        expect(names).toContain(`${CUSTOMER}@`);
        expect((await engine()).packagedFlowOwner(SUBJECT)).toBe(SHOWCASE_PACKAGE);
        expect(loader[SUBJECT]?.label).not.toBe(STORED_LABEL);
    });

    it('by name, a shipped name with a stored row answers the loader\'s body', async () => {
        const read = await byName(SUBJECT);

        expect(read.status).toBe(200);
        expect(read.doc.label).toBe(loader[SUBJECT]?.label);
        expect(nodeIds(read.doc)).toEqual(nodeIds(loader[SUBJECT]));
        expect(nodeIds(read.doc)).not.toContain(STORED_NODE);
    });

    it('the package-scoped spelling of the by-name read answers the loader\'s body too', async () => {
        const read = await byName(SUBJECT, `?package=${SHOWCASE_PACKAGE}`);

        expect(read.status).toBe(200);
        expect(read.doc.label).toBe(loader[SUBJECT]?.label);
        expect(nodeIds(read.doc)).toEqual(nodeIds(loader[SUBJECT]));
    });

    it('by name and in the list, the shipped name answers one and the same body', async () => {
        const list = await listed(SUBJECT);
        const read = await byName(SUBJECT);

        expect(list.status).toBe(200);
        expect(list.entries).toHaveLength(1);
        expect(list.entries[0].label).toBe(read.doc.label);
        expect(nodeIds(list.entries[0])).toEqual(nodeIds(read.doc));
    });

    it('the stored row is still reported as a shadowed contender, and the loader\'s body is what is armed', async () => {
        const e = await engine();
        expect(e.getShadowedFlows().find((r) => r.name === SUBJECT)).toEqual({
            name: SUBJECT,
            armed: { source: 'package', packageId: SHOWCASE_PACKAGE },
            shadowed: [{ source: 'runtime' }],
        });
        expect((await e.getFlow(SUBJECT))?.label).toBe(loader[SUBJECT]?.label);
    });

    it('control: a shipped name with no stored row answers the loader\'s body by name, unchanged', async () => {
        const read = await byName(CONTROL);

        expect(read.status).toBe(200);
        expect(read.doc.label).toBe(loader[CONTROL]?.label);
        expect(nodeIds(read.doc)).toEqual(nodeIds(loader[CONTROL]));
    });

    it('control: an organization-scoped row stays out of the by-name read\'s reach', async () => {
        const read = await byName(ORG_SUBJECT);

        expect(read.status).toBe(200);
        expect(read.doc.label).toBe(loader[ORG_SUBJECT]?.label);
        expect(nodeIds(read.doc)).toEqual(nodeIds(loader[ORG_SUBJECT]));
    });

    it('control: a flow name no managed package ships answers its stored row by name and in the list', async () => {
        const read = await byName(CUSTOMER);
        const list = await listed(CUSTOMER);

        expect(read.status).toBe(200);
        expect(read.doc.label).toBe(CUSTOMER_LABEL);
        expect(list.entries.map((it) => it.label)).toEqual([CUSTOMER_LABEL]);
    });
});
