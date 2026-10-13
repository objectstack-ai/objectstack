// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23086] `FileSystemRepository` reports the acting user's id, or `null` —
 * never the label `'fs'`.
 *
 * The contract is `PutOptions.actor` (`@objectstack/metadata-core`, #4556):
 * the acting user id, or `null` for a write with no actor. `authoredBy` and
 * `MetadataEvent.actor` carry the same rule. The repository broke it twice:
 *
 *  - its constructor defaulted `fsActor` to `'fs'`, and `MetadataPlugin`
 *    attaches it without one, so every edit observed on disk and every file
 *    with no recorded write reported the label;
 *  - every `authoredBy` read was `meta?.actor ?? fsActor`, and `??` treats a
 *    recorded `null` as absent, so a `put()` with `actor: null` read back as
 *    authored by the fallback.
 *
 * The origin stays named, on `source: 'fs'`. These cases read every surface a
 * caller sees: the `put()` receipt, `get()`, the `list()` header and the
 * `history()` event. The watcher face (an edit made on disk) is pinned by the
 * `actor` assertions in this package's watcher suites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MetaRef, MetadataEvent, MetadataItemHeader } from '@objectstack/metadata-core';
import { FileSystemRepository } from '../src/index.js';

const ref = (name: string): MetaRef => ({ org: 'system', type: 'view', name });

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('[#23086] FileSystemRepository: the acting user id, or null, never the label "fs"', () => {
  let root: string;
  let repo: FileSystemRepository | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fs-actor-'));
  });

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  /** What every read surface reports as the writer of `name`'s HEAD. */
  async function writerSeenBy(r: FileSystemRepository, name: string) {
    const got = await r.get(ref(name));
    const headers: MetadataItemHeader[] = await collect(r.list({ org: 'system', type: 'view', nameContains: name }));
    const events: MetadataEvent[] = await collect(r.history(ref(name)));
    return {
      get: got?.authoredBy,
      list: headers.map((h) => h.authoredBy),
      history: events.map((e) => e.actor),
    };
  }

  it('a write with no actor records null on every surface, never "fs"', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    const put = await repo.put(ref('nobody'), { label: 'v1' }, { parentVersion: null, actor: null });
    expect(put.item.authoredBy).toBeNull();
    expect(await writerSeenBy(repo, 'nobody')).toEqual({ get: null, list: [null], history: [null] });

    // A no-op write (same content) reads the recorded writer back too.
    const again = await repo.put(ref('nobody'), { label: 'v1' }, { parentVersion: put.version, actor: null });
    expect(again.item.authoredBy).toBeNull();
  });

  it('a write with an actor records that actor on every surface', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    const put = await repo.put(ref('mine'), { label: 'v1' }, { parentVersion: null, actor: 'usr_alice' });
    expect(put.item.authoredBy).toBe('usr_alice');
    expect(await writerSeenBy(repo, 'mine')).toEqual({
      get: 'usr_alice', list: ['usr_alice'], history: ['usr_alice'],
    });
  });

  it('a file no recorded write produced reports null as its writer', async () => {
    // Placed on disk before `start()`, as an editor or a checkout leaves it:
    // the boot scan indexes it, and the log holds no record for it.
    await fs.mkdir(path.join(root, 'view'), { recursive: true });
    await fs.writeFile(path.join(root, 'view', 'placed.json'), JSON.stringify({ label: 'from disk' }));
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    expect(await writerSeenBy(repo, 'placed')).toEqual({ get: null, list: [null], history: [] });
  });

  it('a named fsActor answers only where no write is recorded; a recorded null stays null', async () => {
    await fs.mkdir(path.join(root, 'view'), { recursive: true });
    await fs.writeFile(path.join(root, 'view', 'placed.json'), JSON.stringify({ label: 'from disk' }));
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true, fsActor: 'usr_operator' });
    await repo.start();
    expect((await repo.get(ref('placed')))?.authoredBy).toBe('usr_operator');

    await repo.put(ref('nobody'), { label: 'v1' }, { parentVersion: null, actor: null });
    expect(await writerSeenBy(repo, 'nobody')).toEqual({ get: null, list: [null], history: [null] });
  });
});
