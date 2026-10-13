// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23086] The `FileSystemRepository` that `MetadataPlugin` attaches reports
 * the acting user's id, or `null` — never the label `'fs'`.
 *
 * `MetadataPlugin.start()` attaches the repository with no `fsActor`, and the
 * repository used to default that to `'fs'`. So on every host that boots the
 * plugin, a file no recorded write produced, and an edit seen on disk, named
 * `'fs'` as their writer, against the `PutOptions.actor` contract (#4556):
 * the acting user id, or `null`. An actor-less `put()` read back as `'fs'`
 * too, because the `authoredBy` read fell back on a recorded `null`.
 *
 * This drives a real `LiteKernel` through a real bootstrap and reads the real
 * repository handle the plugin attached, so the plugin's actor rule is what is
 * measured: a future attach that passes a label as `fsActor` turns the first
 * assertion red. The repository's own semantics are pinned in
 * `packages/metadata-fs/test/actor-never-a-label.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiteKernel } from '@objectstack/core';
import type { MetaRef, MetadataRepository } from '@objectstack/metadata-core';
import { MetadataPlugin } from './plugin.js';

const temps: string[] = [];
const kernels: LiteKernel[] = [];

afterEach(async () => {
    while (kernels.length) await kernels.pop()!.shutdown().catch(() => undefined);
    while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const ref = (name: string): MetaRef => ({ org: 'system', type: 'view', name });

describe('[#23086] the repository MetadataPlugin attaches records the user id or null, never "fs"', () => {
    it('a file no recorded write produced, and a write with no actor, both report null as the writer', async () => {
        const rootDir = mkdtempSync(join(tmpdir(), 'metadata-plugin-fs-actor-'));
        temps.push(rootDir);
        // Under the plugin's repository root (`REPO_SUBDIR`), placed before boot
        // the way a checkout leaves it: indexed by the boot scan, absent from
        // the change log.
        const viewDir = join(rootDir, '.objectstack', 'metadata', 'view');
        mkdirSync(viewDir, { recursive: true });
        writeFileSync(join(viewDir, 'placed.json'), JSON.stringify({ label: 'from disk' }));

        const kernel = new LiteKernel();
        kernels.push(kernel);
        kernel.use(new MetadataPlugin({ rootDir, watch: false }));
        await kernel.bootstrap();
        const repo = kernel
            .getService<{ getRepository(): MetadataRepository | undefined }>('metadata')
            .getRepository();

        // POSITIVE CONTROL — the plugin attached a repository and it indexed the
        // placed file, so the writer read below is a reading, not an absence.
        expect(repo).toBeDefined();
        const placed = await repo!.get(ref('placed'));
        expect(placed?.body).toEqual({ label: 'from disk' });
        expect(placed!.authoredBy).toBeNull();

        await repo!.put(ref('nobody'), { label: 'v1' }, { parentVersion: null, actor: null });
        expect((await repo!.get(ref('nobody')))?.authoredBy).toBeNull();
    });
});
