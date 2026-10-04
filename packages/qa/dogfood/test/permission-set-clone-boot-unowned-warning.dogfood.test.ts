// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21669] A permission set the environment CLONED is not reported, on the next
// boot, as a package declaration with no owner — over the real showcase
// composition, across a cold boot on one database file.
//
// ## What was broken
//
// The declared-permission boot loop (`bootstrapDeclaredPermissions`,
// plugin-security) walks every `permission` item in the engine registry. That
// registry holds more than package declarations: `loadMetaFromDb` hydrates every
// env-wide `sys_metadata` `permission` row into the same collection, and a set
// made with Setup's Clone action is one — with no package id, because it has
// none. The loop judged "unowned" before it looked at the row, so every boot
// (and every `metadata:reloaded`) logged
// `[permission_set_declaration_unowned] … the Setup admin surface … cannot see
// this set` for a set whose `managed_by:'admin'` row Setup lists and edits.
// Measured on `origin/main` before the fix through this file's own steps: one
// such line naming the clone, `skippedUnowned: 1`.
//
// ## Why a booted stack, booted twice
//
// The unit pins (`bootstrap-declared-permissions.test.ts`, `[#21669]`) hand the
// loop the item shape this boot produces. What they cannot show is that the
// real boot puts the clone into the walk at all — that is a property of the
// hydration, not of the loop, and only a restart on the same file shows it. So
// this file asserts the walk holds the clone with no package id BEFORE it
// asserts the warning is absent; without that precondition the absence would be
// vacuous.
//
// ## The clone is made the way the Setup dialog makes it
//
// The payload is built from the shipped `clone_permission_set` action's own
// declaration — its `target`, its `bodyExtra` and its `params` (the typed
// `label`/`name`, and every `defaultFromRow` facet copied from the base row) —
// and POSTed to the data door as the signed-in admin. Read, never restated: a
// facet added to the action reaches this pin without an edit here.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { securityObjects } from '@objectstack/plugin-security';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative refs resolve against the cwd — see the sibling cold-boot files. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const SYS = { context: { isSystem: true } } as const;
const TOKEN = 'permission_set_declaration_unowned';
/** A set the showcase package ships (`com.example.showcase`) — the clone's base. */
const BASE = 'showcase_contributor';
/** A name no package ships. */
const CLONE = 'showcase_contributor_local_21669';
const API_BASE = '/api/v1';

interface CloneParam { name?: string; field?: string; defaultFromRow?: boolean }
interface CloneAction { method: string; target: string; bodyExtra?: Record<string, unknown>; params: CloneParam[] }

/** The shipped Clone action, read off the object the security plugin registers. */
function cloneAction(): CloneAction {
    const object = (securityObjects as any[]).find((o) => o?.name === 'sys_permission_set');
    const action = (object?.actions ?? []).find((a: any) => a?.name === 'clone_permission_set');
    if (!action) throw new Error('clone_permission_set is missing from sys_permission_set.actions');
    return action as CloneAction;
}

/** Every line the process writes while `run` is in flight — the kernel logger writes to the streams. */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
    const lines: string[] = [];
    const stdout = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write.bind(process.stderr);
    const warn = console.warn;
    (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stdout(chunk as any, ...rest); };
    (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stderr(chunk as any, ...rest); };
    console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); warn(...args); };
    try {
        return { value: await run(), lines };
    } finally {
        (process.stdout as any).write = stdout;
        (process.stderr as any).write = stderr;
        console.warn = warn;
    }
}

describe('[#21669] a cloned permission set boots without the unowned-declaration warning (showcase, cold boot)', () => {
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let stack: VerifyStack | undefined;
    /** Everything boot 2 wrote. */
    let bootLines: string[] = [];
    /** Boot 2's engine. */
    let ql: any;

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21669-'));
        dbFile = join(dir, 'showcase.db');

        // ── boot 1: clone a packaged set through the Setup dialog's own path ──
        stack = await bootStack(showcaseStack, { databaseFile: dbFile });
        const token = await stack.signIn();
        const engine: any = await stack.kernel.getServiceAsync('objectql');
        const [base] = await engine.find('sys_permission_set', { where: { name: BASE }, limit: 1 }, SYS);
        expect(base?.managed_by, 'the base is a package-declared set').toBe('package');

        const read = await stack.apiAs(token, 'GET', `/data/sys_permission_set/${base.id}`);
        const served: any = await read.json();
        const row = served?.record ?? served?.data?.record ?? served?.data;
        const action = cloneAction();
        const body: Record<string, unknown> = { ...(action.bodyExtra ?? {}) };
        for (const p of action.params) {
            if (p.name === 'label') body.label = 'Contributor (local)';
            else if (p.name === 'name') body.name = CLONE;
            else if (p.field && p.defaultFromRow) body[p.field] = row?.[p.field];
        }
        expect(action.target.startsWith(API_BASE), action.target).toBe(true);
        const created = await stack.apiAs(token, action.method, action.target.slice(API_BASE.length), body);
        expect(created.status, JSON.stringify(await created.clone().json().catch(() => ({})))).toBe(201);

        // Harness health: the clone is the environment's own set — the row
        // Setup lists, and the env-wide metadata row the next boot hydrates.
        const [clone] = await engine.find('sys_permission_set', { where: { name: CLONE }, limit: 1 }, SYS);
        expect({ managed_by: clone?.managed_by, package_id: clone?.package_id ?? null })
            .toEqual({ managed_by: 'admin', package_id: null });
        const stored = await engine.find('sys_metadata', { where: { type: 'permission', name: CLONE } }, SYS);
        expect(stored.map((r: any) => ({ state: r.state, organization_id: r.organization_id ?? null })))
            .toEqual([{ state: 'active', organization_id: null }]);
        await stack.stop();
        stack = undefined;

        // ── boot 2: same file, nothing authored ───────────────────────────────
        const second = await captureOutput(() => bootStack(showcaseStack, { databaseFile: dbFile }));
        stack = second.value;
        bootLines = second.lines;
        ql = await stack.kernel.getServiceAsync('objectql');
    }, 300_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('precondition: the boot loop walks the clone, with no package id', () => {
        // ⛔ Without this the absence below proves nothing: a boot that stopped
        // hydrating the clone would also log no warning for it.
        const item = (ql.registry.listItems('permission') ?? []).find((i: any) => i?.name === CLONE);
        expect(item, `${CLONE} is in the registry the loop walks`).toBeDefined();
        expect(item._packageId ?? item.packageId ?? null).toBeNull();
    });

    it('control: the capture saw the loop report its pass', () => {
        // The seeding pass logs one summary line per run, through the same
        // logger the warning used — so an empty capture cannot pass the next case.
        expect(bootLines.some((l) => l.includes('declared permission sets seeded into sys_permission_set'))).toBe(true);
    });

    it('the cloned set is not reported as an unowned declaration', () => {
        const unowned = bootLines.filter((l) => l.includes(TOKEN) && l.includes(CLONE));
        expect(unowned).toEqual([]);
    });
});
