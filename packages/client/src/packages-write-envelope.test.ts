// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12034 — shipping half] `client.packages.install` / `enable` / `disable`
 * answer the BARE `InstalledPackage` row, and the `{ package; message? }`
 * envelope they used to declare is emitted by nothing.
 *
 * ## What was wrong
 *
 * These three declared `{ package: any; message?: string }`. That is not an
 * ERASED type — it is a FALSE one: no surface has ever sent that body. Because
 * the member was `any`,
 *
 *     (await client.packages.enable(id)).package
 *
 * compiled, and was `undefined` at runtime. The `any` is precisely what kept
 * the falsehood invisible; a bound-but-wrong declaration is the shape an AI
 * consumer reads as ground truth and writes against.
 *
 * ## Why there was no "which surface do we match" question
 *
 * `GET /packages/:id` genuinely forks between the two mounted surfaces, which
 * is why its declaration is untouched (see `index.ts`, and the cost analysis on
 * #12034). These three do not fork, because the REST registrar mounts no twin
 * for any of them — MEASURED by driving `registerPackageRoutes` and
 * enumerating what came back:
 *
 *     ["POST /api/v1/packages/publish", "GET /api/v1/packages",
 *      "GET /api/v1/packages/:id",      "DELETE /api/v1/packages/:id"]
 *
 * `POST /packages`, `PATCH /packages/:id/enable` and
 * `PATCH /packages/:id/disable` are absent. One producer, therefore one true
 * type, therefore nothing to choose between.
 *
 * ## Why this file is a WIRE test and not a type test
 *
 * The two halves are separate on purpose and neither substitutes for the other
 * (`return-type-precision.test.ts` states the rule in its header):
 *
 *   - a runtime test cannot observe a return-type narrowing at all — the value
 *     is identical whatever the declaration says. The DECLARATION half is
 *     pinned type-level in `return-type-precision.test.ts`.
 *   - a type test cannot observe whether the declaration is TRUE. That is this
 *     file's job, and it is why nothing here mocks a response body: a mock body
 *     would assert my own assumption about the producer, which is exactly the
 *     mistake that produced the false declaration in the first place.
 *
 * So the chain below is real end to end — a real `SchemaRegistry` from
 * `@objectstack/objectql`, the real `HttpDispatcher` from `@objectstack/runtime`
 * answering it, and the real `ObjectStackClient` (real `unwrapResponse`)
 * reading the result. The only stand-in is the socket: `fetch` hands the
 * request to the dispatcher in-process instead of over TCP, and hands back the
 * dispatcher's own body untouched.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Restoring `{ package: any; message?: string }` on the three methods leaves
 * THIS file green — the wire value does not change — and turns
 * `return-type-precision.test.ts` RED under `tsc`. That asymmetry is the whole
 * reason both files exist; the ablation is recorded on the PR against the type
 * half, which is the half a declaration change can move.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '@objectstack/runtime';
import { ObjectStackClient } from './index';

const BASE_URL = 'http://localhost:3000';
const PACKAGES_PATH = '/api/v1/packages';

const MANIFEST = {
    id: 'com.acme.crm',
    name: 'Acme CRM',
    version: '1.0.0',
    type: 'app',
    namespace: 'acme',
} as const;

/**
 * The caller the `/packages` domain gates on: ADR-0106 D4 read capabilities for
 * the reads, `manage_metadata` for the writes. Anonymous is refused before any
 * of this (a separate, already-pinned rule), so the envelope under test is only
 * reachable with a resolved principal.
 */
const CONTEXT = (): any => ({
    request: {},
    environmentId: 'os-12034-envelope',
    executionContext: {
        userId: 'u_admin',
        isSystem: false,
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
});

/**
 * The in-process socket. Everything either side of it is production code: the
 * URL the client built goes in, the body the dispatcher produced comes back,
 * and nothing in between rewrites a key.
 */
function dispatcherBackedClient(registry: SchemaRegistry) {
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? { registry } : null) },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const seen: Array<{ method: string; path: string; body: unknown }> = [];

    const fetchImpl = async (url: string, init: RequestInit = {}): Promise<any> => {
        const parsed = new URL(String(url));
        expect(parsed.pathname.startsWith(PACKAGES_PATH)).toBe(true);
        const subPath = parsed.pathname.slice(PACKAGES_PATH.length);
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        seen.push({ method, path: subPath, body });

        const result = await dispatcher.handlePackages(
            subPath,
            method,
            body,
            Object.fromEntries(parsed.searchParams),
            CONTEXT(),
        );
        const status = result.response?.status ?? 500;
        const payload = result.response?.body;
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: String(status),
            headers: new Headers(),
            json: async () => payload,
        };
    };

    const client = new ObjectStackClient({ baseUrl: BASE_URL, fetch: fetchImpl as any });
    return { client, dispatcher, seen };
}

let osHome: string;
let previousOsHome: string | undefined;

beforeAll(() => {
    // `enable` / `disable` persist the operator's choice under OS_HOME. Point
    // that at a scratch dir so the suite never writes to a real home.
    previousOsHome = process.env.OS_HOME;
    osHome = mkdtempSync(join(tmpdir(), 'os-12034-'));
    process.env.OS_HOME = osHome;
});

afterAll(() => {
    if (previousOsHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = previousOsHome;
    rmSync(osHome, { recursive: true, force: true });
});

describe('#12034 — the packages write verbs answer the bare row, not `{ package }`', () => {
    it('install resolves to the row itself, and has no `package` member to read', async () => {
        const registry = new SchemaRegistry();
        const { client, seen } = dispatcherBackedClient(registry);

        const installed = await client.packages.install(MANIFEST);

        // It reached the route the card is about.
        expect(seen).toEqual([{ method: 'POST', path: '', body: { manifest: MANIFEST } }]);

        // THE LINE THAT WAS A LIE: the declaration promised `.package`.
        expect((installed as any).package).toBeUndefined();
        expect((installed as any).message).toBeUndefined();

        // What actually comes back is the row — identical to what the registry
        // holds, which is the value the new declaration names.
        expect(installed.manifest).toEqual(MANIFEST);
        expect(installed).toEqual(registry.getPackage(MANIFEST.id));
    });

    it('enable resolves to the row, carrying the flag it just set', async () => {
        const registry = new SchemaRegistry();
        registry.installPackage(MANIFEST as any);
        registry.disablePackage(MANIFEST.id);
        const { client, seen } = dispatcherBackedClient(registry);

        const row = await client.packages.enable(MANIFEST.id);

        expect(seen).toEqual([{ method: 'PATCH', path: '/com.acme.crm/enable', body: undefined }]);
        expect((row as any).package).toBeUndefined();
        expect((row as any).message).toBeUndefined();
        // The state the verb changed is read OFF THE ROW — the read the old
        // declaration sent callers looking for under `.package`.
        expect(row.enabled).toBe(true);
        expect(row).toEqual(registry.getPackage(MANIFEST.id));
    });

    it('disable resolves to the row, carrying the flag it just cleared', async () => {
        const registry = new SchemaRegistry();
        registry.installPackage(MANIFEST as any);
        const { client, seen } = dispatcherBackedClient(registry);

        const row = await client.packages.disable(MANIFEST.id);

        expect(seen).toEqual([{ method: 'PATCH', path: '/com.acme.crm/disable', body: undefined }]);
        expect((row as any).package).toBeUndefined();
        expect((row as any).message).toBeUndefined();
        expect(row.enabled).toBe(false);
        expect(row).toEqual(registry.getPackage(MANIFEST.id));
    });

    /**
     * The premise the three assertions above rest on. `unwrapResponse` strips
     * exactly ONE `{ success, data }` envelope, so "the dispatcher sends
     * `success(pkg)`" and "the caller receives `pkg`" are the same statement
     * only while that stays true. Pinned here against the REAL dispatcher body
     * rather than a written-out literal.
     */
    it('the dispatcher wraps the row exactly once, and the client strips exactly that', async () => {
        const registry = new SchemaRegistry();
        registry.installPackage(MANIFEST as any);
        const { client, dispatcher } = dispatcherBackedClient(registry);

        const raw = await dispatcher.handlePackages('/com.acme.crm/enable', 'PATCH', undefined, {}, CONTEXT());
        const body: any = raw.response?.body;

        // The producer's own body: one envelope, the row under `data`, and no
        // `package` key anywhere in it.
        expect(Object.keys(body).sort()).toEqual(['data', 'meta', 'success']);
        expect(body.success).toBe(true);
        expect('package' in body.data).toBe(false);

        // …and the post-unwrap value the SDK hands the caller is that `data`.
        expect(await client.packages.enable(MANIFEST.id)).toEqual(body.data);
    });
});
