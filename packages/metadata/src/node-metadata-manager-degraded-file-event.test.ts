// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5228 — a file the loader cannot read must not be announced as `data: null`.
 *
 * `NodeMetadataManager.handleFileEvent()` used to wrap its re-read in a
 * `try/catch` that logged "Failed to load changed file" and returned without
 * announcing. That `catch` was unreachable for the failure it was written to
 * catch: `load()` is `(await loadDiagnosed(...)).data`, and `loadDiagnosed`
 * (ADR-0110 D3) absorbs a loader throw into `{ data: null, degraded: true }`
 * rather than rethrowing. `FilesystemLoader.load()` does throw on an
 * unparseable file — the throw simply died one frame below the handler.
 *
 * So an unreadable file was announced with `data: null`, which is the wire
 * shape of "this metadata legitimately holds nothing": a miss and an outage,
 * the two facts ADR-0110 D3 exists to keep apart, arrived at every subscriber
 * in exactly the same shape. The fix reads through `loadDiagnosed` and splits
 * on `degraded`.
 *
 * **What each case discriminates.** Reverting the fix turns the "no watcher is
 * notified" cases red — the old handler announced `data: null` there. The
 * invalidation half is the *other* direction and is why it is asserted in the
 * same case rather than its own: a fix that returned before invalidating would
 * also produce "no event", so only "no event AND the caches went" rules out
 * both the pre-fix handler and the naive fix. #5218's own regression case
 * ("still invalidates when the changed file cannot be parsed") is green on both
 * sides of this change and therefore discriminates nothing here — its note was
 * corrected, not its assertions.
 *
 * **Test approach** matches `node-metadata-manager-fs-invalidation.test.ts`:
 * synthetic events into the real handler, over real files in a real tmpdir,
 * read by the real default `FilesystemLoader`. Only the chokidar notification
 * is synthesized; #5218's end-to-end case already pins that chokidar reaches
 * the handler at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MetadataWatchEvent } from '@objectstack/spec/system';
import { NodeMetadataManager } from './node-metadata-manager.js';
import type { MetadataManager } from './metadata-manager.js';

// Hoisted so the `vi.mock` factory below (which vitest evaluates during the
// import phase) can close over a logger that already exists. A plain
// module-level `const` would be in its TDZ at that point.
const { logger } = vi.hoisted(() => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
    createLogger: () => logger,
}));

let rootDir: string;
const managers: NodeMetadataManager[] = [];

beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'os-5228-'));
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

/** Write `rootDir/<type>/<name>.json` with a body no serializer can parse. */
async function writeUnparseableFile(type: string, name: string): Promise<string> {
    const dir = path.join(rootDir, type);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.json`);
    await fs.writeFile(filePath, '{ not json', 'utf-8');
    return filePath;
}

function makeManager(): NodeMetadataManager {
    // No `loaders`, so the constructor installs the default FilesystemLoader
    // over `rootDir` — the real read path this issue is about.
    const mgr = new NodeMetadataManager({ rootDir, watch: false, formats: ['json'] });
    managers.push(mgr);
    return mgr;
}

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

/** Collect every event announced for `type`. */
function record(mgr: NodeMetadataManager, type: string): MetadataWatchEvent[] {
    const seen: MetadataWatchEvent[] = [];
    mgr.subscribe(type, (evt) => { seen.push(evt); });
    return seen;
}

/** Read the private list cache without waiting on any async seam. */
const cachedTypes = (mgr: MetadataManager): string[] =>
    Array.from((mgr as unknown as { listCache: Map<string, unknown> }).listCache.keys());

/** The "Failed to load changed file" calls, newest last. */
const loadFailureLogs = (): Record<string, unknown>[] =>
    logger.error.mock.calls
        .filter((call) => call[0] === 'Failed to load changed file')
        .map((call) => call[2] as Record<string, unknown>);

const view = (name: string, title = name) => ({ name, title, object: 'account' });

const viewNames = (items: unknown[]): string[] =>
    (items as { name: string }[]).map((v) => v.name).sort();

describe('#5228 — a degraded read is not announced', () => {
    it('announces nothing, and drops the caches anyway', async () => {
        await writeMetadataFile('view', 'v_a', view('v_a'));
        const mgr = makeManager();
        await mgr.list('view');                                        // pre-warm
        expect(cachedTypes(mgr)).toEqual(['view']);

        const seen = record(mgr, 'view');
        const broken = await writeUnparseableFile('view', 'v_broken');
        await fireFileEvent(mgr, 'added', broken);

        // Before the fix this was one event carrying `data: null` — the file
        // the loader could not read, announced as a file the author emptied.
        expect(seen).toEqual([]);

        // …and the #5218 contract is untouched by the early return: an
        // unreadable file IS a real change to the stored set (`loadMany` skips
        // it), so the caches must age out regardless of the read's verdict.
        // Asserting both here is deliberate — "no event" alone would also hold
        // for a fix that returned before invalidating.
        expect(cachedTypes(mgr)).toEqual([]);
        expect(viewNames(await mgr.list('view'))).toEqual(['v_a']);
    });

    it('finally reaches the logger.error that never printed once', async () => {
        const mgr = makeManager();
        const broken = await writeUnparseableFile('view', 'v_broken');

        await fireFileEvent(mgr, 'changed', broken);

        expect(loadFailureLogs()).toHaveLength(1);
        expect(loadFailureLogs()[0]).toMatchObject({
            filePath: broken,
            metadataType: 'view',
            name: 'v_broken',
        });
        // `errors[]` is what `loadDiagnosed` collected — the loader name plus
        // its message. Without it the log names a file and no cause.
        const errors = loadFailureLogs()[0]!.errors as string[];
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('filesystem:');
    });

    it('keeps a legitimate miss on its existing semantics — announced, data null', async () => {
        // Not degraded: every loader answered, none had the item (the file was
        // already gone by the time the event was drained). That is the fact
        // `data: null` is the correct wire shape for, so this path is
        // untouched — announced exactly as before.
        const mgr = makeManager();
        const seen = record(mgr, 'view');

        const vanished = path.join(rootDir, 'view', 'v_vanished.json');
        await fs.mkdir(path.dirname(vanished), { recursive: true });
        await fireFileEvent(mgr, 'changed', vanished);

        expect(seen).toHaveLength(1);
        expect(seen[0]!.data).toBeNull();
        expect(loadFailureLogs()).toEqual([]);
    });

    it('announces a readable file with its parsed body', async () => {
        const mgr = makeManager();
        const seen = record(mgr, 'view');

        const added = await writeMetadataFile('view', 'v_b', view('v_b', 'fresh'));
        await fireFileEvent(mgr, 'added', added);

        expect(seen).toHaveLength(1);
        expect(seen[0]!.data).toMatchObject({ name: 'v_b', title: 'fresh' });
        expect(loadFailureLogs()).toEqual([]);
    });

    it('never reads on a deleted event, so a deletion can never be degraded', async () => {
        // The file left behind here is unparseable. If `deleted` consulted the
        // loader at all it would come back degraded and be swallowed — and a
        // deletion that nobody announces is the one loss this change must not
        // introduce. `data` stays `undefined` (nothing was read), which is
        // distinct from the `null` a miss carries.
        const mgr = makeManager();
        const seen = record(mgr, 'view');

        const broken = await writeUnparseableFile('view', 'v_gone');
        await fireFileEvent(mgr, 'deleted', broken);

        expect(seen).toHaveLength(1);
        expect(seen[0]!.type).toBe('deleted');
        expect(seen[0]!.data).toBeUndefined();
        expect(loadFailureLogs()).toEqual([]);
    });
});

/**
 * The one in-repo subscriber whose job is pure invalidation — the endpoint
 * index (#5089) — keeps working without the broadcast, because it has a second
 * seam that does not go through a watcher. This is the case that makes
 * "degraded means no announcement" safe rather than merely quiet.
 */
describe('#5228 — a degraded `api` event still invalidates the endpoint index', () => {
    const endpoint = (name: string, urlPath: string) => ({
        name,
        path: urlPath,
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
    });

    it('rebuilds the index through invalidateListCache, not through subscribe()', async () => {
        await writeMetadataFile('api', 'list_tasks', endpoint('list_tasks', '/api/v1/apps/showcase/tasks'));
        const mgr = makeManager();

        // Build the index, so a stale one would be observable.
        expect(await mgr.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }))
            .toMatchObject({ endpoint: { name: 'list_tasks' } });

        // A second declaration lands on disk without an event of its own — an
        // editor writing two files, one of which is caught mid-save.
        await writeMetadataFile('api', 'list_users', endpoint('list_users', '/api/v1/apps/showcase/users'));
        const broken = await writeUnparseableFile('api', 'half_written');
        const announced = record(mgr, 'api');
        await fireFileEvent(mgr, 'added', broken);

        // No announcement, so `subscribe('api', … endpointMatcher.invalidate())`
        // never ran. `invalidateForForeignWrite` → `invalidateListCache('api')`
        // — the index's FIRST seam, the one that already covers the
        // `{ notify: false }` writes — carried it.
        expect(announced).toEqual([]);
        expect(await mgr.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/users' }))
            .toMatchObject({ endpoint: { name: 'list_users' } });
        expect(await mgr.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }))
            .toMatchObject({ endpoint: { name: 'list_tasks' } });
    });
});
