// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20862, ADR-0126 §2, ADR-0131 D6] The `/automation` definition doors keep
// what they answer `200` for — over the real showcase composition, across a
// cold boot on one database file.
//
// ## What was broken
//
// `POST /automation` and `PUT /automation/:name` registered the definition in
// the engine and wrote no metadata row. The next boot binds flows from the
// stored metadata, so a created flow was gone after a restart, and an update
// to a flow stored through `/meta` was overwritten by the stored definition.
// Measured on `origin/main` before the fix, through this file's own cases:
// the created flow answered `404` after the cold boot, and the updated flow
// served its stored label again.
//
// ## Why a booted stack
//
// The door-level pins sit beside the domain
// (`packages/runtime/src/domains/automation-authoring-doors-durable.test.ts`).
// What they cannot answer is whether, on the stack an operator runs, the door
// reaches a protocol whose save lands a row the next boot binds. Only a
// restart on the same file shows that.
//
// ## What each case pins
//
//   - a created flow reads back on the metadata door and survives a cold boot;
//   - an update to a `/meta`-stored flow reads back there and survives it;
//   - a save the store refuses leaves no engine registration: a create is
//     withdrawn, and an update puts back the definition the engine held;
//   - a flow created and then removed through the door stays removed after the
//     cold boot (the removal door keeps pace with the create door);
//   - a packaged flow's name is still refused as a locked base (the control).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
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
const CREATED = 'dogfood_created_flow_20862';
const META_STORED = 'dogfood_meta_stored_flow_20862';
const REMOVED = 'dogfood_removed_flow_20862';
/**
 * A name the engine registers and the store refuses: `FlowSchema.name` admits a
 * leading underscore, the metadata item-name grammar does not. So the engine's
 * registration succeeds and the save fails — a real store refusal, reached
 * through the public door.
 */
const UNSAVABLE = '_dogfood_unsavable_flow_20862';

const UPDATED_LABEL = 'Updated through the automation door';

const definition = (name: string, label = `Dogfood ${name}`) => ({
    name,
    label,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/**
 * A definition the engine registers and the store's publish gate refuses: a
 * default edge carrying a condition (`flow-default-edge-with-condition`, a
 * gating authoring rule the engine does not run).
 */
const gateRefused = (name: string) => ({
    ...definition(name, 'Refused by the publish gate'),
    edges: [{ id: 'e1', source: 'start', target: 'end', isDefault: true, condition: 'true' }],
});

interface DispatcherEnvelope {
    success?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
}
const dataOf = (json: unknown) => (json as DispatcherEnvelope).data;
const dispatcherCode = (json: unknown) => (json as DispatcherEnvelope).error?.code;

const plugins = () => [
    new ConnectorRestPlugin(),
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
];

async function boot(databaseFile: string): Promise<VerifyStack> {
    return bootStack(showcaseStack, { automation: true, databaseFile, extraPlugins: plugins() });
}

describe('the /automation definition doors persist what they register (showcase, cold boot)', () => {
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
    const engineLabel = async (name: string) => {
        const read = await call('GET', `/automation/${name}`);
        return { status: read.status, label: dataOf(read.json)?.label };
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-20862-'));
        dbFile = join(dir, 'showcase.db');
        stack = await boot(dbFile);
        token = await stack.signIn();
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('a flow created through the automation door reads back on the metadata door', async () => {
        const created = await call('POST', '/automation', definition(CREATED));
        expect(created.status, JSON.stringify(created.json)).toBe(200);

        const served = await metaRead(CREATED);
        expect(served.status, JSON.stringify(served.doc)).toBe(200);
        expect(served.doc.label).toBe(`Dogfood ${CREATED}`);
    });

    it('an update through the automation door to a /meta-stored flow reads back on the metadata door', async () => {
        const stored = await call('PUT', `/meta/flow/${META_STORED}`, definition(META_STORED, 'Stored through /meta'));
        expect(stored.status, JSON.stringify(stored.json)).toBe(200);

        const updated = await call('PUT', `/automation/${META_STORED}`, definition(META_STORED, UPDATED_LABEL));
        expect(updated.status, JSON.stringify(updated.json)).toBe(200);

        expect((await metaRead(META_STORED)).doc.label).toBe(UPDATED_LABEL);
        expect((await engineLabel(META_STORED)).label).toBe(UPDATED_LABEL);
    });

    it('a create whose save the store refuses answers the store\'s refusal and leaves no engine registration', async () => {
        const created = await call('POST', '/automation', definition(UNSAVABLE));

        expect(created.status, JSON.stringify(created.json)).toBe(400);
        expect(dispatcherCode(created.json)).toBe('INVALID_REQUEST');
        expect((await call('GET', `/automation/${UNSAVABLE}`)).status).toBe(404);
    });

    it('an update whose save the store refuses answers the refusal and the engine keeps the definition it held', async () => {
        const updated = await call('PUT', `/automation/${META_STORED}`, gateRefused(META_STORED));

        expect(updated.status, JSON.stringify(updated.json)).toBe(422);
        expect(dispatcherCode(updated.json)).toBe('INVALID_METADATA');
        expect(await engineLabel(META_STORED)).toEqual({ status: 200, label: UPDATED_LABEL });
        expect((await metaRead(META_STORED)).doc.label).toBe(UPDATED_LABEL);
    });

    it('a flow created and then removed through the automation door is gone from the metadata door too', async () => {
        const created = await call('POST', '/automation', definition(REMOVED));
        expect(created.status, JSON.stringify(created.json)).toBe(200);

        const removed = await call('DELETE', `/automation/${REMOVED}`);
        expect(removed.status, JSON.stringify(removed.json)).toBe(200);

        expect((await call('GET', `/automation/${REMOVED}`)).status).toBe(404);
        expect((await metaRead(REMOVED)).status).toBe(404);
    });

    it('control: a packaged flow\'s name is still refused as a locked base, on the update door and on a create onto it', async () => {
        const before = dataOf((await call('GET', `/automation/${SHIPPED}`)).json)!;

        const put = await call('PUT', `/automation/${SHIPPED}`, { ...before, label: 'Edited in place' });
        expect(put.status, JSON.stringify(put.json)).toBe(403);
        expect(dispatcherCode(put.json)).toBe('NOT_OVERRIDABLE');

        const post = await call('POST', '/automation', { ...before, label: 'Overwritten via create' });
        expect(post.status, JSON.stringify(post.json)).toBe(403);
        expect(dispatcherCode(post.json)).toBe('NOT_OVERRIDABLE');

        expect(dataOf((await call('GET', `/automation/${SHIPPED}`)).json)).toEqual(before);
    });

    it('after a cold boot on the same database file, every door\'s outcome is what it answered', async () => {
        await stack.stop();
        stack = await boot(dbFile);
        token = await stack.signIn();

        // Independent facts about one restart, so each is reported on its own.
        // The created flow survives.
        expect.soft(await engineLabel(CREATED)).toEqual({ status: 200, label: `Dogfood ${CREATED}` });
        // The update survives: the stored definition no longer wins over it.
        expect.soft(await engineLabel(META_STORED)).toEqual({ status: 200, label: UPDATED_LABEL });
        // The refused create left nothing to bind, and the removed flow stays removed.
        expect.soft((await call('GET', `/automation/${UNSAVABLE}`)).status).toBe(404);
        expect.soft((await call('GET', `/automation/${REMOVED}`)).status).toBe(404);
        // The packaged flow is the one its package ships.
        expect.soft((await engineLabel(SHIPPED)).status).toBe(200);
    }, 180_000);
});
