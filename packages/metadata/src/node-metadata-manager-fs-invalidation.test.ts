// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5218 — a filesystem change must invalidate THIS node's caches, not just wake
 * its watchers.
 *
 * `NodeMetadataManager.handleFileEvent()` used to do exactly two things when
 * chokidar reported `add` / `change` / `unlink`: re-`load()` the file (a pure
 * read — it delegates to `loadDiagnosed`, which only walks the loaders and
 * writes neither cache) and `notifyWatchers()`. It never touched `listCache`
 * or `registry`. So after editing `rootDir/view/x.json` the manager's two read
 * surfaces contradicted each other for up to `LIST_CACHE_TTL_MS` (30s):
 * `get()` returned the new definition because it falls through to the
 * FilesystemLoader, while `list()` — REST `/api/v1/metadata/:type`, the Studio
 * left rail, `listViews()` — kept serving the pre-change set. The HMR/SSE
 * consumers the event woke answer it by re-reading through `list()`, so the
 * wake-up handed back precisely the stale data it was announcing.
 *
 * Same defect shape as #5109 (a cluster peer's write) with a different
 * trigger, and it is fixed by reusing that fix's helper —
 * `invalidateForForeignWrite`, widened `private` → `protected`. A file event
 * is a foreign write on the definition that matters: it did not come through
 * this manager's write API, so nothing refreshed the caches on its behalf.
 *
 * **Test approach.** These drive `handleFileEvent` directly with a synthetic
 * event rather than waiting on real chokidar — everything else is real (real
 * files in a real tmpdir, the real default `FilesystemLoader`, the real
 * `list()` / `get()` / `matchEndpoint` read paths), so only the notification
 * is synthesized. `startWatching` polls at `interval: 1000`, which would make
 * every case here a multi-second wait for no added coverage of the seam under
 * test. The one thing a synthetic event cannot prove — that chokidar's
 * callbacks actually reach `handleFileEvent` — is pinned by the end-to-end
 * case at the bottom, which uses a real watcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeMetadataManager } from './node-metadata-manager.js';
import type { MetadataManager } from './metadata-manager.js';

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

let rootDir: string;
const managers: NodeMetadataManager[] = [];

beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'os-5218-'));
});

afterEach(async () => {
    for (const mgr of managers.splice(0)) await mgr.stopWatching();
    await fs.rm(rootDir, { recursive: true, force: true });
});

/** Write `rootDir/<type>/<name>.json`, returning the absolute path. */
async function writeMetadataFile(
    type: string,
    name: string,
    data: Record<string, unknown>,
): Promise<string> {
    const dir = path.join(rootDir, type);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
    return filePath;
}

function makeManager(watch = false): NodeMetadataManager {
    // No `loaders`, so the constructor installs the default FilesystemLoader
    // over `rootDir` — the real read path this issue is about.
    const mgr = new NodeMetadataManager({ rootDir, watch, formats: ['json'] });
    managers.push(mgr);
    return mgr;
}

/**
 * Deliver a chokidar-shaped event straight to the handler under test. See the
 * "Test approach" note above for why this is preferred over a real watcher.
 */
function fireFileEvent(
    mgr: NodeMetadataManager,
    eventType: 'added' | 'changed' | 'deleted',
    filePath: string,
): Promise<void> {
    return (
        mgr as unknown as {
            handleFileEvent(t: 'added' | 'changed' | 'deleted', p: string): Promise<void>;
        }
    ).handleFileEvent(eventType, filePath);
}

/** Read the private list cache without waiting on any async seam. */
const cachedTypes = (mgr: MetadataManager): string[] =>
    Array.from((mgr as unknown as { listCache: Map<string, unknown> }).listCache.keys());

const view = (name: string, title = name) => ({ name, title, object: 'account' });

const viewNames = (items: unknown[]): string[] =>
    (items as { name: string }[]).map((v) => v.name).sort();

describe('#5218 — an FS change invalidates the local listCache', () => {
    it('a pre-warmed list() sees a new file without waiting out the 30s TTL', async () => {
        // The issue's repro, verbatim.
        await writeMetadataFile('view', 'v_a', view('v_a'));
        const mgr = makeManager();

        expect(viewNames(await mgr.list('view'))).toEqual(['v_a']);   // pre-warm

        const added = await writeMetadataFile('view', 'v_b', view('v_b'));
        await fireFileEvent(mgr, 'added', added);

        // Same tick, no timers: the 30s TTL has not lapsed. Before the fix this
        // returned ['v_a'] for another 30 seconds.
        expect(viewNames(await mgr.list('view'))).toEqual(['v_a', 'v_b']);
    });

    it('stops get() and list() contradicting each other', async () => {
        const filePath = await writeMetadataFile('view', 'v_a', view('v_a', 'old'));
        const mgr = makeManager();
        await mgr.list('view');                                       // pre-warm

        await fs.writeFile(filePath, JSON.stringify(view('v_a', 'new')), 'utf-8');
        await fireFileEvent(mgr, 'changed', filePath);

        // `get()` was ALWAYS right — it falls through to the loader. The bug
        // was that `list()` disagreed with it, which is what this pins.
        expect((await mgr.get('view', 'v_a') as { title: string }).title).toBe('new');
        expect((await mgr.list('view') as { title: string }[])[0].title).toBe('new');
    });

    it('drops a deleted file from a pre-warmed list()', async () => {
        const filePath = await writeMetadataFile('view', 'v_doomed', view('v_doomed'));
        const mgr = makeManager();
        expect(viewNames(await mgr.list('view'))).toEqual(['v_doomed']);

        await fs.rm(filePath);
        await fireFileEvent(mgr, 'deleted', filePath);

        expect(await mgr.list('view')).toEqual([]);
    });

    it('invalidates BEFORE notifying — a watcher never sees the pre-event cache', async () => {
        await writeMetadataFile('view', 'v_a', view('v_a'));
        const mgr = makeManager();
        await mgr.list('view');
        expect(cachedTypes(mgr)).toEqual(['view']);

        // `notifyWatchersLocal` is synchronous, so this callback runs INSIDE
        // the notify. Ordering the invalidation after it would leave a window
        // in which the event and the stale cache are observable together —
        // every `await` in a request handler is such a window.
        const cacheSeenByWatcher: string[][] = [];
        mgr.subscribe('view', () => { cacheSeenByWatcher.push(cachedTypes(mgr)); });

        const added = await writeMetadataFile('view', 'v_b', view('v_b'));
        await fireFileEvent(mgr, 'added', added);

        expect(cacheSeenByWatcher).toEqual([[]]);
    });

    it('a watcher that re-reads via list() on the wake-up gets the post-change set', async () => {
        await writeMetadataFile('view', 'v_a', view('v_a'));
        const mgr = makeManager();
        await mgr.list('view');

        // The Studio HMR SSE stream and the ObjectQL SchemaRegistry bridge both
        // react to the event by re-reading. That re-read is what used to
        // contradict the notification it was answering.
        let seenByWatcher: string[] = [];
        const observed = new Promise<void>((resolve) => {
            mgr.subscribe('view', () => {
                void mgr.list('view').then((items) => {
                    seenByWatcher = viewNames(items);
                    resolve();
                });
            });
        });

        const added = await writeMetadataFile('view', 'v_b', view('v_b'));
        await fireFileEvent(mgr, 'added', added);
        await observed;

        expect(seenByWatcher).toEqual(['v_a', 'v_b']);
    });

    it('drops a shadowing registry entry so reads fall through to the file', async () => {
        // FS-loaded items never enter the registry, so usually there is nothing
        // to delete. But `register()` writes one, and it SHADOWS the loader in
        // both `get()` and `list()` (registry is merged first). Dropping only
        // the list cache would leave this stale copy answering forever.
        const filePath = await writeMetadataFile('view', 'v_shared', view('v_shared', 'from-file'));
        const mgr = makeManager();
        // FilesystemLoader is read-only at runtime, so this stays registry-only
        // — exactly the shadowing shape.
        await mgr.register('view', 'v_shared', view('v_shared', 'from-registry'));
        expect((await mgr.get('view', 'v_shared') as { title: string }).title).toBe('from-registry');

        await fs.writeFile(filePath, JSON.stringify(view('v_shared', 'edited-on-disk')), 'utf-8');
        await fireFileEvent(mgr, 'changed', filePath);

        // Deleted, never pre-filled from the event's `data` — the answer comes
        // from the loader, which is where the truth is.
        expect((await mgr.get('view', 'v_shared') as { title: string }).title).toBe('edited-on-disk');
        expect((await mgr.list('view') as { title: string }[])[0].title).toBe('edited-on-disk');
    });

    it('keeps in-memory-only entries of OTHER names intact', async () => {
        // `invalidateForForeignWrite` deletes one name, never the whole type
        // store: `registerInMemory` artefacts (code-owned datasources, ADR-0015
        // Addendum) exist in no loader, so evicting one is unrecoverable.
        const mgr = makeManager();
        mgr.registerInMemory('datasource', 'crm_db', { name: 'crm_db', origin: 'code' });
        await mgr.list('datasource');

        const added = await writeMetadataFile('datasource', 'other_db', { name: 'other_db' });
        await fireFileEvent(mgr, 'added', added);

        expect(await mgr.get('datasource', 'crm_db')).toMatchObject({ name: 'crm_db' });
        expect(viewNames(await mgr.list('datasource'))).toEqual(['crm_db', 'other_db']);
    });

    it('still invalidates when the changed file cannot be parsed', async () => {
        // An unparseable file is a real change to the stored set — `loadMany`
        // skips it, so the cached list is stale either way and must go.
        //
        // This case was written expecting the handler's `catch` to fire and
        // return early; it does not, and finding out why is what became #5228.
        // `load()` delegates to `loadDiagnosed`, which absorbs a loader throw
        // into `{ data: null, degraded: true }` rather than rethrowing, so the
        // `catch` was unreachable and the event went out claiming the view was
        // empty. #5228 fixed the announcement (degraded now reads through
        // `loadDiagnosed` and announces nothing — see
        // `node-metadata-manager-degraded-file-event.test.ts`) and moved the
        // invalidation ABOVE the read so this contract survived it. What this
        // case pins is unchanged and deliberately narrow: whatever the read
        // says, the caches go. It is green on both sides of #5228, which is
        // exactly why that change needed pins of its own.
        await writeMetadataFile('view', 'v_a', view('v_a'));
        const mgr = makeManager();
        await mgr.list('view');
        expect(cachedTypes(mgr)).toEqual(['view']);

        const broken = path.join(rootDir, 'view', 'v_broken.json');
        await fs.writeFile(broken, '{ not json', 'utf-8');
        await fireFileEvent(mgr, 'added', broken);

        expect(cachedTypes(mgr)).toEqual([]);
        // The good sibling still lists; the unparseable file simply is not there.
        expect(viewNames(await mgr.list('view'))).toEqual(['v_a']);
    });

    it('ignores paths that are not metadata files', async () => {
        await writeMetadataFile('view', 'v_a', view('v_a'));
        const mgr = makeManager();
        await mgr.list('view');

        // Fewer than 2 path segments below rootDir — no type to invalidate.
        await fireFileEvent(mgr, 'changed', path.join(rootDir, 'README.md'));

        expect(cachedTypes(mgr)).toEqual(['view']);
    });
});

/**
 * The `api` seam the issue asked to confirm — and it confirms a NON-defect, so
 * read this block as a guard rather than a regression pin.
 *
 * Before this fix, an `api` file event still invalidated the endpoint index,
 * through one of that index's two seams: the `subscribe('api', …)` watcher the
 * base constructor registers (#5089). The other seam, `invalidateListCache`,
 * was empty on this path — an asymmetry with every other write path in the
 * manager, which the issue flagged as "worth confirming" precisely because it
 * was not itself a bug. This case passes on both sides of the change; what it
 * pins is that closing the second seam does not break the first. Per #5089's
 * note the overlap is free: `EndpointMatcher.invalidate()` is two assignments
 * to `undefined`, so invalidating twice per event is idempotent.
 */
describe('#5218 — the `api` path invalidates the endpoint index idempotently', () => {
    const endpoint = (name: string, urlPath: string) => ({
        name,
        path: urlPath,
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
    });

    it('a new api file becomes matchable, and double invalidation is harmless', async () => {
        await writeMetadataFile('api', 'list_tasks', endpoint('list_tasks', '/api/v1/apps/showcase/tasks'));
        const mgr = makeManager();

        // Build the index, so a stale one would be observable.
        expect(await mgr.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }))
            .toMatchObject({ endpoint: { name: 'list_tasks' } });

        const added = await writeMetadataFile('api', 'list_users', endpoint('list_users', '/api/v1/apps/showcase/users'));
        await fireFileEvent(mgr, 'added', added);

        // Both seams fired for this one event (invalidateListCache + the
        // watcher). Idempotent: the index rebuilt once and is correct.
        expect(await mgr.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/users' }))
            .toMatchObject({ endpoint: { name: 'list_users' } });
        expect(await mgr.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }))
            .toMatchObject({ endpoint: { name: 'list_tasks' } });
    });
});

/**
 * End-to-end with a REAL chokidar watcher — the one thing the synthetic events
 * above cannot show is that the watcher's callbacks actually reach
 * `handleFileEvent`. Polling at `interval: 1000` makes this slow, so it is
 * deliberately a single case rather than the house style for this file.
 */
describe('#5218 — end-to-end through the real chokidar watcher', () => {
    it('a real file write invalidates a pre-warmed list()', async () => {
        await writeMetadataFile('view', 'v_a', view('v_a'));
        const mgr = makeManager(true);

        // Wait for chokidar's initial scan. `ignoreInitial: true` means a file
        // created BEFORE `ready` is folded into the baseline and never raises
        // `add` — writing without this wait is a race that fails as a 30s
        // timeout. Subscribed synchronously after construction, so the event
        // cannot have been missed.
        const watcher = (mgr as unknown as { watcher: { once(e: string, cb: () => void): unknown } }).watcher;
        await new Promise<void>((resolve) => { watcher.once('ready', () => resolve()); });

        expect(viewNames(await mgr.list('view'))).toEqual(['v_a']);   // pre-warm

        const announced = new Promise<void>((resolve) => {
            mgr.subscribe('view', () => resolve());
        });
        await writeMetadataFile('view', 'v_b', view('v_b'));
        await announced;

        expect(viewNames(await mgr.list('view'))).toEqual(['v_a', 'v_b']);
    }, 30_000);
});
