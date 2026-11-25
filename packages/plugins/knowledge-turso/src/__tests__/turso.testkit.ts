// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What this package's test files share: a fixed fake embedder, and stores on
 * `:memory:` and on a `file:` URL, each adapter in a database of its own. No
 * service, no image, no credentials: libSQL runs in the test process.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import type { IEmbedder } from '@objectstack/spec/contracts';
import { TursoKnowledgeAdapter, type TursoKnowledgeAdapterOptions } from '../index.js';

/**
 * A fixed embedder for tests: each lower-cased Latin word, and each CJK
 * character, hashed into one of `dimensions` slots, counted, and the vector
 * scaled to unit length. Two texts sharing words (or characters) point the
 * same way; texts sharing none are orthogonal. It counts its calls and the
 * texts it embedded.
 */
export class FakeEmbedder implements IEmbedder {
  readonly id = 'fake';
  readonly dimensions: number;
  model: string;
  calls = 0;
  texts: string[] = [];

  constructor(dimensions = 64, model = 'fake-bag-of-words') {
    this.dimensions = dimensions;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    this.texts.push(...texts);
    return texts.map((t) => this.vector(t));
  }

  private vector(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+|[一-鿿]/g) ?? [];
    for (const token of tokens) {
      const slot = createHash('sha256').update(token).digest().readUInt32BE(0) % this.dimensions;
      v[slot] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return norm === 0 ? v : v.map((x) => x / norm);
  }
}

export type StoreKind = 'memory' | 'file';

/**
 * Makes adapters on fresh databases of one kind: `:memory:` (one database per
 * client) or a `file:` URL in a temporary directory (one file per adapter).
 * `closeAll` closes every client it made and removes the directory.
 */
export function storeOf(kind: StoreKind) {
  const clients: Client[] = [];
  let dir: string | undefined;
  let n = 0;
  return {
    kind,
    /** A fresh database's URL. */
    url(): string {
      if (kind === 'memory') return ':memory:';
      dir ??= mkdtempSync(join(tmpdir(), 'knowledge-turso-'));
      return `file:${join(dir, `store-${++n}.db`)}`;
    },
    client(url = this.url()): Client {
      const client = createClient({ url, ...(kind === 'file' ? { timeout: 5000 } : {}) });
      clients.push(client);
      return client;
    },
    adapter(opts: Partial<TursoKnowledgeAdapterOptions> = {}): TursoKnowledgeAdapter {
      return new TursoKnowledgeAdapter({ id: 'under_test', client: this.client(), embedder: new FakeEmbedder(), ...opts });
    },
    closeAll(): void {
      for (const c of clients.splice(0)) c.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    },
  };
}
