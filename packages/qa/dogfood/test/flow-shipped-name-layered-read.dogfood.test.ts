// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21002, #20761 ruling rule 1, ADR-0126 §2, ADR-0131 D6] For a flow name the
// loader ships from a managed package, the LAYERED read reports the loader's
// body as the effective layer — the body the by-name read and the list answer
// for that name — and a stored row of that name as a shadowed layer, never as
// the effective layer under the package's lock and provenance flags. Over the
// real showcase composition, on a database file.
//
// ## What was broken
//
// Since #20913 the flattened flow view (the list door and the execution view)
// serves a shipped name from the loader's entries alone, and since #20946 the
// by-name read does too. The layered read did not: its effective layer was
// "overlay wins", so `GET /meta/flow/NAME/layers` answered the stored body as
// the effective definition while its lock and provenance flags named the
// package — and its own docblock promises the effective layer is "what
// `getMetaItem` would return". Three read doors, two answers about one name.
//
// ## Why a booted stack, over two boots
//
// The unit pins (`protocol.flow-layered-shipped-name.test.ts`) hold the read's
// branches with doubles. What they cannot answer is the composition: that the
// layered door's real sources — the stored row, the metadata service and the
// registry the boot hydration filled — resolve the effective layer to the
// loader's body once the row is at rest. A stored row is only read back by a
// cold boot, so the stack is booted twice on one file.
//
// ## What each case pins (triage's pins, plus the controls)
//
//   - the layered read of a shipped name with a stored row: the effective layer
//     is the loader's body, and the stored row is still reported, as a shadowed
//     layer of its own scope, under the package's flags;
//   - the layered read, the by-name read and the list agree on that body;
//   - the deprecated layers flag on the by-name door answers the same;
//   - a shipped name with no stored row is unchanged (control);
//   - an organization-scoped row stays out of reach (control);
//   - a name no managed package ships keeps its stored row as the effective
//     layer (control).
//
// Not pinned here: the published-snapshot door. It reads the layered answer but
// picks its layer by itself, so it does not follow the effective layer; what it
// answers for a shipped name is left to the card's decision.

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
const ORG_ID = 'org_dogfood_21002';
/** A shipped screen flow whose body seeds the customer flow below (no trigger). */
const CUSTOMER_SOURCE = 'showcase_reassign_wizard';
/** A flow name no managed package ships, given an environment-wide stored row. */
const CUSTOMER = 'dogfood_21002_customer_flow';

/** The node id and label a stored body carries, so it can be told from the loader's. */
const STORED_NODE = 'stored_node_21002';
const STORED_LABEL = 'Stored body 21002';
const CUSTOMER_LABEL = 'Customer flow 21002';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

interface FlowBody {
    name?: string;
    label?: string;
    nodes?: Array<{ id: string }>;
}
interface Layered {
    code?: FlowBody | null;
    overlay?: FlowBody | null;
    overlayScope?: 'org' | 'env' | null;
    effective?: FlowBody | null;
    provenance?: string;
    packageId?: string;
    lock?: string;
}
interface Engine {
    getFlow(name: string): Promise<FlowBody | null>;
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

describe('the layered flow read agrees with the by-name read and the list for a shipped name across a cold boot (showcase)', () => {
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
    const unwrap = (json: unknown) => {
        const body = json as Record<string, unknown>;
        return (body?.data ?? body) as Record<string, unknown>;
    };
    /** `GET /meta/flow/:name/layers` — the three-layer diagnostic. */
    const layers = async (name: string, path = `/meta/flow/${name}/layers`) => {
        const read = await call(path);
        return { status: read.status, doc: unwrap(read.json) as Layered };
    };
    /** `GET /meta/flow/:name` — the served document, unwrapped from whichever envelope carries it. */
    const byName = async (name: string) => {
        const read = await call(`/meta/flow/${name}`);
        const doc = unwrap(read.json);
        return { status: read.status, doc: (doc?.item ?? doc) as FlowBody };
    };
    /** `GET /meta/flow` — every served entry of one name. */
    const listed = async (name: string) => {
        const read = await call('/meta/flow');
        const data = unwrap(read.json) as Record<string, unknown> | unknown[];
        const items = (Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? []) as FlowBody[];
        return { status: read.status, entries: items.filter((it) => it?.name === name) };
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21002-'));
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

    it('the layered door reports the loader\'s body as the effective layer of a shipped name with a stored row, under the package\'s flags', async () => {
        const read = await layers(SUBJECT);

        expect(read.status).toBe(200);
        expect(read.doc.effective?.label).toBe(loader[SUBJECT]?.label);
        expect(nodeIds(read.doc.effective)).toEqual(nodeIds(loader[SUBJECT]));
        expect(nodeIds(read.doc.effective)).not.toContain(STORED_NODE);
        expect(nodeIds(read.doc.code)).toEqual(nodeIds(loader[SUBJECT]));
        expect(read.doc.packageId).toBe(SHOWCASE_PACKAGE);
        expect(read.doc.provenance).toBe('package');
    });

    it('the stored row is still reported, as a shadowed layer of its own scope', async () => {
        const read = await layers(SUBJECT);

        expect(read.doc.overlay?.label).toBe(STORED_LABEL);
        expect(nodeIds(read.doc.overlay)).toContain(STORED_NODE);
        expect(read.doc.overlayScope).toBe('env');
    });

    it('the layered door, the by-name read and the list answer one and the same body', async () => {
        const layered = await layers(SUBJECT);
        const read = await byName(SUBJECT);
        const list = await listed(SUBJECT);

        expect(read.status).toBe(200);
        expect(list.status).toBe(200);
        expect(list.entries).toHaveLength(1);
        expect(layered.doc.effective?.label).toBe(read.doc.label);
        expect(list.entries[0].label).toBe(read.doc.label);
        expect(nodeIds(layered.doc.effective)).toEqual(nodeIds(read.doc));
        expect(nodeIds(list.entries[0])).toEqual(nodeIds(read.doc));
    });

    it('the deprecated layers flag on the by-name door answers the same layers', async () => {
        const read = await layers(SUBJECT, `/meta/flow/${SUBJECT}?layers=true`);

        expect(read.status).toBe(200);
        expect(nodeIds(read.doc.effective)).toEqual(nodeIds(loader[SUBJECT]));
        expect(nodeIds(read.doc.overlay)).toContain(STORED_NODE);
    });

    it('control: a shipped name with no stored row is unchanged', async () => {
        const read = await layers(CONTROL);

        expect(read.status).toBe(200);
        expect(read.doc.overlay).toBeNull();
        expect(read.doc.overlayScope).toBeNull();
        expect(nodeIds(read.doc.effective)).toEqual(nodeIds(loader[CONTROL]));
    });

    it('control: an organization-scoped row stays out of the layered door\'s reach', async () => {
        const read = await layers(ORG_SUBJECT);

        expect(read.status).toBe(200);
        expect(read.doc.overlay).toBeNull();
        expect(read.doc.overlayScope).toBeNull();
        expect(read.doc.effective?.label).toBe(loader[ORG_SUBJECT]?.label);
        expect(nodeIds(read.doc.effective)).toEqual(nodeIds(loader[ORG_SUBJECT]));
    });

    it('control: a flow name no managed package ships keeps its stored row as the effective layer', async () => {
        const read = await layers(CUSTOMER);
        const byNameRead = await byName(CUSTOMER);

        expect(read.status).toBe(200);
        expect(read.doc.effective?.label).toBe(CUSTOMER_LABEL);
        expect(read.doc.overlay?.label).toBe(CUSTOMER_LABEL);
        expect(read.doc.overlayScope).toBe('env');
        expect(byNameRead.doc.label).toBe(CUSTOMER_LABEL);
    });
});
