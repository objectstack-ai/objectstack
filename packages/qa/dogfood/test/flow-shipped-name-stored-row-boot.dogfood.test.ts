// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20913, #20761 ruling rule 1, ADR-0126 §2, ADR-0131 D6] For a flow name the
// loader ships from a managed package, what a cold boot arms is the loader's
// body — at BOTH boot steps — and a stored row of the same name is reported,
// never armed. Over the real showcase composition, on a database file.
//
// ## What was broken
//
// The boot pull in the automation plugin's `start()` resolved precedence over
// the registry and armed the loader's body. The `kernel:ready` sync then
// re-registered every name from the protocol's execution view with no
// precedence at all, and that view's per-package merge had picked the stored
// row for the package's slot and put the package's provenance on it. So the
// stored body was what dispatched, while the engine's shadowing receipt still
// described the boot pull's choice — and rendered both contenders as the same
// package, so it could not tell them apart.
//
// ## Why a booted stack, over two boots
//
// The unit pins sit beside each seam: the precedence
// (`flow-precedence-loader-set.test.ts`), the two syncs
// (`flow-sync-one-precedence.test.ts`) and the protocol's merge and hydration
// (`protocol.flow-stored-row-shipped-name.test.ts`). What none of them can
// answer is the composition: that the row the store holds reaches the boot
// pull and the sync through the real hydration and the real execution view,
// and that the trigger which fires is bound to the armed body. A stored row is
// only read back by a cold boot, so the stack is booted twice on one file.
//
// ## What each case pins (the triage direction's four pins)
//
//   - a shipped name with a stored row arms and executes the loader's body;
//   - the receipt and the armed body agree, and the stored row is its own
//     contender in it, never the package;
//   - a shipped name with no stored row is unchanged (the control);
//   - an organization-scoped row stays out of reach.

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
/** A shipped, record-triggered flow: the subject, given a stored row of its name. */
const SUBJECT = 'showcase_urgent_task_alert';
/** A shipped flow given no stored row at all: the control. */
const CONTROL = 'showcase_task_completed';
/** A shipped flow given an ORGANIZATION-scoped row only. */
const ORG_SUBJECT = 'showcase_task_assigned_notify';
const ORG_ID = 'org_dogfood_20913';

/** The node id the stored body renames the subject's notify node to. */
const STORED_NODE = 'stored_alert_20913';
const STORED_LABEL = 'Stored body 20913';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

interface Engine {
    getFlow(name: string): Promise<{ label?: string; nodes?: Array<{ id: string }> } | null>;
    getShadowedFlows(): Array<{ name: string; armed: unknown; shadowed: unknown[] }>;
    packagedFlowOwner(name: string): string | undefined;
    listRuns(name: string, options?: { limit?: number }): Promise<Array<{ steps?: Array<{ nodeId: string }> }>>;
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

const nodeIds = (flow: { nodes?: Array<{ id: string }> } | null) => (flow?.nodes ?? []).map((n) => n.id);

/** The loader's body, as a distinguishable stored body: a new label, one node renamed. */
function storedBodyFrom(loader: Record<string, unknown>, renamedNode: string): Record<string, unknown> {
    const body: Record<string, unknown> = JSON.parse(JSON.stringify(loader));
    for (const key of Object.keys(body)) if (key.startsWith('_')) delete body[key];
    body.label = STORED_LABEL;
    const nodes = body.nodes as Array<{ id: string }>;
    const edges = body.edges as Array<{ source: string; target: string }>;
    const from = nodes[1].id;
    nodes[1].id = renamedNode;
    for (const edge of edges) {
        if (edge.source === from) edge.source = renamedNode;
        if (edge.target === from) edge.target = renamedNode;
    }
    return body;
}

describe('a stored row under a shipped flow name is reported, never armed, across a cold boot (showcase)', () => {
    let stack: VerifyStack;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    const loaderLabels: Record<string, string | undefined> = {};
    const loaderNodes: Record<string, string[]> = {};

    const engine = () => stack.kernel.getServiceAsync('automation') as unknown as Promise<Engine>;
    const ql = () => stack.kernel.getServiceAsync('objectql') as unknown as Promise<Ql>;

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-20913-'));
        dbFile = join(dir, 'showcase.db');

        // First boot: read the loader's bodies, then put rows in the store.
        stack = await boot(dbFile);
        const first = await engine();
        const store = await ql();
        for (const name of [SUBJECT, CONTROL, ORG_SUBJECT]) {
            const flow = await first.getFlow(name);
            loaderLabels[name] = flow?.label;
            loaderNodes[name] = nodeIds(flow);
        }
        const now = new Date().toISOString();
        const row = (name: string, organizationId: string | null) => ({
            type: 'flow',
            name,
            organization_id: organizationId,
            package_id: null,
            state: 'active',
            version: 1,
            checksum: null,
            created_at: now,
            updated_at: now,
        });
        const subjectLoader = (await first.getFlow(SUBJECT)) as unknown as Record<string, unknown>;
        const orgLoader = (await first.getFlow(ORG_SUBJECT)) as unknown as Record<string, unknown>;
        await store.insert(
            'sys_metadata',
            { ...row(SUBJECT, null), metadata: JSON.stringify(storedBodyFrom(subjectLoader, STORED_NODE)) },
            { context: SYSTEM_CTX },
        );
        await store.insert(
            'sys_metadata',
            { ...row(ORG_SUBJECT, ORG_ID), metadata: JSON.stringify(storedBodyFrom(orgLoader, STORED_NODE)) },
            { context: SYSTEM_CTX },
        );
        await stack.stop();

        // The measured boot: cold, on the same file.
        stack = await boot(dbFile);
    }, 360_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('the store holds the rows the second boot read', async () => {
        const rows = await (await ql()).find('sys_metadata', {
            where: { type: 'flow', state: 'active' },
            context: SYSTEM_CTX,
        });
        const names = rows.map((r) => `${String(r.name)}@${String(r.organization_id ?? '')}`);
        expect(names).toContain(`${SUBJECT}@`);
        expect(names).toContain(`${ORG_SUBJECT}@${ORG_ID}`);
    });

    it('a shipped name with a stored row arms the loader\'s body after both boot steps', async () => {
        const e = await engine();
        expect(e.packagedFlowOwner(SUBJECT)).toBe(SHOWCASE_PACKAGE);
        const armed = await e.getFlow(SUBJECT);
        expect(armed?.label).toBe(loaderLabels[SUBJECT]);
        expect(armed?.label).not.toBe(STORED_LABEL);
        expect(nodeIds(armed)).toEqual(loaderNodes[SUBJECT]);
        expect(nodeIds(armed)).not.toContain(STORED_NODE);

        const token = await stack.signIn();
        const res = await stack.apiAs(token, 'GET', `/automation/${SUBJECT}`);
        expect(res.status).toBe(200);
        const served = ((await res.json()) as { data?: { label?: string } }).data;
        expect(served?.label).toBe(loaderLabels[SUBJECT]);
    });

    it('the record trigger executes the loader\'s body', async () => {
        const token = await stack.signIn();
        const post = async (object: string, body: Record<string, unknown>) => {
            const res = await stack.apiAs(token, 'POST', `/data/${object}`, body);
            const text = await res.text();
            expect(res.status, text).toBeLessThan(300);
            const json = JSON.parse(text) as { data?: { id?: string }; id?: string };
            return String(json.data?.id ?? json.id);
        };
        const account = await post('showcase_account', { name: 'Dogfood 20913 account' });
        const project = await post('showcase_project', { name: 'Dogfood 20913 project', account, status: 'planned' });
        await post('showcase_task', { title: 'Dogfood 20913 urgent', priority: 'urgent', project });

        const e = await engine();
        let runs: Array<{ steps?: Array<{ nodeId: string }> }> = [];
        for (let i = 0; i < 50 && runs.length === 0; i++) {
            runs = await e.listRuns(SUBJECT, { limit: 5 });
            if (runs.length === 0) await new Promise((r) => setTimeout(r, 100));
        }
        expect(runs.length).toBeGreaterThan(0);
        const executed = (runs[0].steps ?? []).map((s) => s.nodeId);
        expect(executed).toContain(loaderNodes[SUBJECT][1]);
        expect(executed).not.toContain(STORED_NODE);
    });

    it('the receipt names the armed body as the package\'s and the stored row as its own contender', async () => {
        const record = (await engine()).getShadowedFlows().find((r) => r.name === SUBJECT);
        expect(record).toEqual({
            name: SUBJECT,
            armed: { source: 'package', packageId: SHOWCASE_PACKAGE },
            shadowed: [{ source: 'runtime' }],
        });
    });

    it('control: a shipped name with no stored row is unchanged, with no receipt', async () => {
        const e = await engine();
        const armed = await e.getFlow(CONTROL);
        expect(armed?.label).toBe(loaderLabels[CONTROL]);
        expect(nodeIds(armed)).toEqual(loaderNodes[CONTROL]);
        expect(e.getShadowedFlows().find((r) => r.name === CONTROL)).toBeUndefined();
    });

    it('an organization-scoped row stays out of reach: the loader\'s body, no receipt', async () => {
        const e = await engine();
        const armed = await e.getFlow(ORG_SUBJECT);
        expect(armed?.label).toBe(loaderLabels[ORG_SUBJECT]);
        expect(nodeIds(armed)).toEqual(loaderNodes[ORG_SUBJECT]);
        expect(e.getShadowedFlows().find((r) => r.name === ORG_SUBJECT)).toBeUndefined();
    });
});
