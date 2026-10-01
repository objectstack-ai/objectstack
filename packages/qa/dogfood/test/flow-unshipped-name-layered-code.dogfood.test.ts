// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21059] The LAYERED read's code layer for a flow name no package ships is
// `null` before the stored row is hydrated and after a cold boot hydrated it —
// the spec's layer 1, "`null` when no artifact ships this item (it exists only
// as an overlay)". Over the real showcase composition, on a database file.
//
// ## What was broken
//
// The code layer is the artifact lookup, then a fallback that reads the
// registry's plain slot for items registered at runtime without a package. A
// stored row that a hydration registers lands in that same slot, so once the
// cold boot had hydrated the row, `GET /meta/flow/NAME/layers` answered the
// stored body as the code layer — and derived the lock and provenance flags
// from it — while the same read before the hydration answered a null code
// layer. The answer depended on hydration state.
//
// ## Why a booted stack, over two boots
//
// The unit pins (`protocol.layered-code-unshipped-name.test.ts`) hold the
// read's branches with doubles. What they cannot answer is the composition: the
// real registry, the real boot hydration and the metadata service behind the
// layered door. The first boot reads the door with the rows in the store and
// none of them hydrated; the second boot is cold, on the same file, after the
// boot hydration put the rows in the registry.
//
// ## What each case pins (triage's pins, plus the controls)
//
//   - an unshipped name's layered read answers a null code layer before and
//     after hydration, on the layered door and on the deprecated layers flag;
//   - a stored body carrying package-provenance stamps under an unshipped name
//     is no code layer either, and its lock-state flags read the same on both
//     sides of the hydration (triage's ruling on the open corner);
//   - a shipped name keeps the loader's body as its code layer (control);
//   - an item registered at runtime with no package keeps its code layer
//     (control — the fallback's stated purpose).

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
/** A shipped screen flow (no trigger) whose body seeds the stored rows below. */
const SOURCE = 'showcase_reassign_wizard';
/** A shipped flow given an environment-wide stored row of its name: the control. */
const SHIPPED = 'showcase_urgent_task_alert';
/** A flow name no package ships, given an environment-wide stored row: the subject. */
const UNSHIPPED = 'dogfood_21059_unshipped_flow';
/** A flow name no package ships, whose stored body claims the showcase package. */
const STAMPED = 'dogfood_21059_stamped_flow';
/** A flow registered at runtime with no package, on the measured boot. */
const RUNTIME = 'dogfood_21059_runtime_flow';

const STORED_LABEL = 'Stored body 21059';
const RUNTIME_LABEL = 'Runtime flow 21059';

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
    lock?: string;
    lockSource?: string;
    provenance?: string;
    packageId?: string;
    packageVersion?: string;
    editable?: boolean;
    deletable?: boolean;
    resettable?: boolean;
}
interface Engine {
    getFlow(name: string): Promise<FlowBody | null>;
}
interface Ql {
    insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
    registry: {
        getItem(type: string, name: string): unknown;
        registerItem(type: string, item: Record<string, unknown>, keyField?: string): void;
    };
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

/** A copy of a loader's body with every underscore-prefixed key dropped. */
function plainCopy(loader: FlowBody | null): Record<string, unknown> {
    const body: Record<string, unknown> = JSON.parse(JSON.stringify(loader));
    for (const key of Object.keys(body)) if (key.startsWith('_')) delete body[key];
    return body;
}

/** The ADR-0010 protection flags the layered response derives from its layers. */
const flagsOf = (doc: Layered) => ({
    lock: doc.lock,
    lockSource: doc.lockSource,
    provenance: doc.provenance,
    packageId: doc.packageId,
    packageVersion: doc.packageVersion,
    editable: doc.editable,
    deletable: doc.deletable,
    resettable: doc.resettable,
});

describe('the layered flow read answers a null code layer for a name no package ships, across a cold boot (showcase)', () => {
    let stack: VerifyStack;
    let token: string;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let loaderShipped: FlowBody | null = null;
    /** What the first boot answered, with the rows stored and none hydrated. */
    const before: Record<string, { status: number; doc: Layered; registered: boolean }> = {};

    const engine = () => stack.kernel.getServiceAsync('automation') as unknown as Promise<Engine>;
    const ql = () => stack.kernel.getServiceAsync('objectql') as unknown as Promise<Ql>;

    const unwrap = (json: unknown) => {
        const body = json as Record<string, unknown>;
        return (body?.data ?? body) as Record<string, unknown>;
    };
    /** `GET /meta/flow/:name/layers` — the three-layer diagnostic. */
    const layers = async (name: string, path = `/meta/flow/${name}/layers`) => {
        const res = await stack.apiAs(token, 'GET', path);
        const json: unknown = await res.json().catch(() => ({}));
        return { status: res.status, doc: unwrap(json) as Layered };
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21059-'));
        dbFile = join(dir, 'showcase.db');

        // First boot: put the rows in the store, then read the layered door
        // before anything has hydrated them.
        stack = await boot(dbFile);
        token = await stack.signIn();
        const first = await engine();
        const store = await ql();
        const source = await first.getFlow(SOURCE);
        loaderShipped = await first.getFlow(SHIPPED);

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
        const stored = (name: string) => ({ ...plainCopy(source), name, label: STORED_LABEL });
        for (const data of [
            row(UNSHIPPED, stored(UNSHIPPED)),
            row(STAMPED, { ...stored(STAMPED), _packageId: SHOWCASE_PACKAGE, _provenance: 'package' }),
            row(SHIPPED, { ...plainCopy(loaderShipped), label: STORED_LABEL }),
        ]) {
            await store.insert('sys_metadata', data, { context: SYSTEM_CTX });
        }
        for (const name of [UNSHIPPED, STAMPED, SHIPPED]) {
            const registered = (store.registry.getItem('flow', name) as FlowBody | undefined)?.label === STORED_LABEL;
            before[name] = { ...(await layers(name)), registered };
        }
        await stack.stop();

        // The measured boot: cold, on the same file — the boot hydration reads the rows.
        stack = await boot(dbFile);
        token = await stack.signIn();
    }, 360_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('the first boot read the rows unhydrated, and the cold boot hydrated them into the registry', async () => {
        for (const name of [UNSHIPPED, STAMPED, SHIPPED]) expect(before[name].registered).toBe(false);
        const registry = (await ql()).registry;
        for (const name of [UNSHIPPED, STAMPED]) {
            expect((registry.getItem('flow', name) as FlowBody | undefined)?.label).toBe(STORED_LABEL);
        }
    });

    it('an unshipped name\'s layered read answers a null code layer before and after hydration', async () => {
        expect(before[UNSHIPPED].status).toBe(200);
        expect(before[UNSHIPPED].doc.code).toBeNull();

        const after = await layers(UNSHIPPED);

        expect(after.status).toBe(200);
        expect(after.doc.code).toBeNull();
        expect(after.doc.overlay?.label).toBe(STORED_LABEL);
        expect(after.doc.overlayScope).toBe('env');
        expect(after.doc.effective?.label).toBe(STORED_LABEL);
        expect(flagsOf(after.doc)).toEqual(flagsOf(before[UNSHIPPED].doc));
    });

    it('the deprecated layers flag on the by-name door answers the same null code layer', async () => {
        const after = await layers(UNSHIPPED, `/meta/flow/${UNSHIPPED}?layers=true`);

        expect(after.status).toBe(200);
        expect(after.doc.code).toBeNull();
        expect(after.doc.overlay?.label).toBe(STORED_LABEL);
    });

    it('a stored body carrying package-provenance stamps under an unshipped name is no code layer, and its lock-state flags do not move across hydration', async () => {
        expect(before[STAMPED].status).toBe(200);
        expect(before[STAMPED].doc.code).toBeNull();

        const after = await layers(STAMPED);

        expect(after.status).toBe(200);
        expect(after.doc.code).toBeNull();
        expect(after.doc.overlay?.label).toBe(STORED_LABEL);
        expect(flagsOf(after.doc)).toEqual(flagsOf(before[STAMPED].doc));
    });

    it('control: a shipped name keeps the loader\'s body as its code layer, before and after hydration', async () => {
        expect(before[SHIPPED].doc.code?.label).toBe(loaderShipped?.label);

        const after = await layers(SHIPPED);

        expect(after.status).toBe(200);
        expect(after.doc.code?.label).toBe(loaderShipped?.label);
        expect(after.doc.overlay?.label).toBe(STORED_LABEL);
        expect(after.doc.packageId).toBe(SHOWCASE_PACKAGE);
        expect(after.doc.provenance).toBe('package');
    });

    it('control: a flow registered at runtime with no package keeps its code layer', async () => {
        const store = await ql();
        store.registry.registerItem('flow', { ...plainCopy(loaderShipped), name: RUNTIME, label: RUNTIME_LABEL });

        const read = await layers(RUNTIME);

        expect(read.status).toBe(200);
        expect(read.doc.code?.label).toBe(RUNTIME_LABEL);
        expect(read.doc.overlay).toBeNull();
        expect(read.doc.effective?.label).toBe(RUNTIME_LABEL);
    });
});
