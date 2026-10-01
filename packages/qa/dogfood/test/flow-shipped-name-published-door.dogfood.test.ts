// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21002, #20761 ruling rule 1, ADR-0126 §2, ADR-0131 D6] For a flow name the
// loader ships from a managed package, the published-snapshot door answers the
// loader's body once a stored row of that name is at rest — the body the layered
// read reports as effective. Over the real showcase composition, on a database
// file, across a cold boot.
//
// ## What was broken
//
// Since #21002's first half the layered read decides its effective layer for a
// shipped flow name with `isShippedFlowName`: the loader's body, with the stored
// row reported beside it as a shadowed layer. The published doors read that same
// layered answer but served its stored layer whenever one was present, so they
// still answered the stored body for a sealed name — ADR-0126 §2's "never an
// overlay read path", left open on one door and its twin.
//
// ## The ruling these cases pin (triage, scoped by the decision, not by type)
//
// When the predicate decided the effective layer — the loader's body over a
// stored row — the doors serve that effective layer. In every other case they
// serve exactly what they served before. So:
//
//   - a shipped flow name with a stored row: the door answers the loader's
//     body, the same body the layered read reports as effective;
//   - a flow name no managed package ships, with a stored row: the door still
//     answers the stored body (control);
//   - an `object` with a published stored row, whose effective layer differs
//     from its stored layer by folding and governance (not by the predicate):
//     the door still answers the stored layer, unchanged (control).
//
// ## Why only the REST door is booted here
//
// This composition serves `/meta` through the REST route alone; the
// dispatcher's `/meta` domain is reached only on hosts that mount the
// dispatcher's catch-all, which this harness does not. Its twin of this door is
// pinned with the real protocol and the real `HttpDispatcher` in
// `packages/runtime/src/domains/meta-published-runtime-publish.test.ts`.

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
/** A shipped screen flow whose body seeds the customer flow below (no trigger). */
const CUSTOMER_SOURCE = 'showcase_reassign_wizard';
/** A flow name no managed package ships, given an environment-wide stored row. */
const CUSTOMER = 'dogfood_21002_pub_customer_flow';
/** A writable base and an object published into it at runtime: the `object` control. */
const OBJECT_BASE = 'app.dogfood_21002_pub';
const OBJECT_NAME = 'dogfood_21002_pub_widget';

/** The node id and label a stored body carries, so it can be told from the loader's. */
const STORED_NODE = 'stored_node_21002_pub';
const STORED_LABEL = 'Stored body 21002 pub';
const CUSTOMER_LABEL = 'Customer flow 21002 pub';
const OBJECT_LABEL = 'Widget 21002 pub';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

interface FlowBody {
    name?: string;
    label?: string;
    nodes?: Array<{ id: string }>;
}
interface Layered {
    type?: string;
    name?: string;
    code?: Record<string, unknown> | null;
    overlay?: Record<string, unknown> | null;
    overlayScope?: 'org' | 'env' | null;
    effective?: Record<string, unknown> | null;
}
interface Engine {
    getFlow(name: string): Promise<FlowBody | null>;
    packagedFlowOwner(name: string): string | undefined;
}
interface Ql {
    insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
}
interface Protocol {
    saveMetaItem(request: Record<string, unknown>): Promise<unknown>;
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

const nodeIds = (flow: unknown) => ((flow as FlowBody | null | undefined)?.nodes ?? []).map((n) => n.id);
const labelOf = (doc: unknown) => (doc as { label?: unknown } | null | undefined)?.label;

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

describe('the published-snapshot door answers the loader\'s body for a shipped flow name with a stored row, across a cold boot (showcase)', () => {
    let stack: VerifyStack;
    let token: string;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    const loader: Record<string, FlowBody | null> = {};

    const engine = () => stack.kernel.getServiceAsync('automation') as unknown as Promise<Engine>;
    const ql = () => stack.kernel.getServiceAsync('objectql') as unknown as Promise<Ql>;

    /** `GET /meta/:type/:name/published` on the REST route — the served document itself. */
    const restPublished = async (type: string, name: string) => {
        const res = await stack.apiAs(token, 'GET', `/meta/${type}/${name}/published`);
        const body: unknown = await res.json().catch(() => ({}));
        return { status: res.status, doc: body as Record<string, unknown> };
    };
    /** `GET /meta/:type/:name/layers` — the three-layer answer the door reads. */
    const layers = async (type: string, name: string) => {
        const res = await stack.apiAs(token, 'GET', `/meta/${type}/${name}/layers`);
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { status: res.status, doc: (body?.data ?? body) as Layered };
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21002-pub-'));
        dbFile = join(dir, 'showcase.db');

        // First boot: read the loader's bodies, put the flow rows in the store,
        // and publish the control object through the runtime authoring door.
        stack = await boot(dbFile);
        const first = await engine();
        const store = await ql();
        for (const name of [SUBJECT, CUSTOMER_SOURCE]) loader[name] = await first.getFlow(name);

        const now = new Date().toISOString();
        const row = (name: string, body: Record<string, unknown>) => ({
            type: 'flow',
            name,
            organization_id: null,
            package_id: null,
            state: 'active',
            version: 1,
            checksum: null,
            created_at: now,
            updated_at: now,
            metadata: JSON.stringify(body),
        });
        const customer = { ...plainCopy(loader[CUSTOMER_SOURCE]), name: CUSTOMER, label: CUSTOMER_LABEL };
        for (const data of [row(SUBJECT, storedBodyFrom(loader[SUBJECT])), row(CUSTOMER, customer)]) {
            await store.insert('sys_metadata', data, { context: SYSTEM_CTX });
        }

        const protocol = await stack.kernel.getServiceAsync<Protocol>('protocol');
        const objectBody = {
            name: OBJECT_NAME,
            label: OBJECT_LABEL,
            sharingModel: 'private',
            fields: { title: { type: 'text', label: 'Title' } },
        };
        await protocol.saveMetaItem({ type: 'object', name: OBJECT_NAME, item: objectBody, packageId: OBJECT_BASE, mode: 'draft' });
        await protocol.saveMetaItem({ type: 'object', name: OBJECT_NAME, item: objectBody, packageId: OBJECT_BASE, mode: 'publish' });
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

    it('the store holds the rows the second boot read, and the layered read puts the loader\'s body over the stored row', async () => {
        const rows = await (await ql()).find('sys_metadata', {
            where: { state: 'active' },
            context: SYSTEM_CTX,
        });
        const keys = rows.map((r) => `${String(r.type)}/${String(r.name)}@${String(r.organization_id ?? '')}`);
        expect(keys).toContain(`flow/${SUBJECT}@`);
        expect(keys).toContain(`flow/${CUSTOMER}@`);
        expect(keys).toContain(`object/${OBJECT_NAME}@`);
        expect((await engine()).packagedFlowOwner(SUBJECT)).toBe(SHOWCASE_PACKAGE);
        expect(labelOf(loader[SUBJECT])).not.toBe(STORED_LABEL);

        // The decision the doors follow: a stored layer is present, and the
        // effective layer is the loader's body, not that stored layer.
        const read = await layers('flow', SUBJECT);
        expect(read.status).toBe(200);
        expect(nodeIds(read.doc.overlay)).toContain(STORED_NODE);
        expect(nodeIds(read.doc.effective)).toEqual(nodeIds(loader[SUBJECT]));
    });

    it('the REST published door answers the loader\'s body for a shipped flow name with a stored row', async () => {
        const read = await restPublished('flow', SUBJECT);

        expect(read.status).toBe(200);
        expect(labelOf(read.doc)).toBe(labelOf(loader[SUBJECT]));
        expect(nodeIds(read.doc)).toEqual(nodeIds(loader[SUBJECT]));
        expect(nodeIds(read.doc)).not.toContain(STORED_NODE);
    });

    it('the published door serves the body the layered read reports as effective', async () => {
        const layered = await layers('flow', SUBJECT);
        const rest = await restPublished('flow', SUBJECT);

        expect(rest.doc).toEqual(layered.doc.effective);
    });

    it('control: a flow name no managed package ships keeps its stored body on the published door', async () => {
        const layered = await layers('flow', CUSTOMER);
        const rest = await restPublished('flow', CUSTOMER);

        expect(layered.doc.overlayScope).toBe('env');
        expect(rest.status).toBe(200);
        expect(labelOf(rest.doc)).toBe(CUSTOMER_LABEL);
        expect(rest.doc).toEqual(layered.doc.overlay);
    });

    it('control: an object\'s published stored layer is served unchanged, not its effective layer', async () => {
        const layered = await layers('object', OBJECT_NAME);
        const rest = await restPublished('object', OBJECT_NAME);

        expect(layered.status).toBe(200);
        // The control discriminates: this object's effective layer is NOT its
        // stored layer, so a door that served the effective layer would fail here.
        expect(layered.doc.overlay).not.toBeNull();
        expect(layered.doc.effective).not.toEqual(layered.doc.overlay);

        expect(rest.status).toBe(200);
        expect(labelOf(rest.doc)).toBe(OBJECT_LABEL);
        expect(rest.doc).toEqual(layered.doc.overlay);
    });
});
