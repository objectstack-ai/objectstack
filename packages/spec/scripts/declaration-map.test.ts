// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins over the committed `declaration-map/` artifact (#13712).
 *
 * The artifact's funding consumer is diff-side tooling that holds a changed
 * line's ENCLOSING DECLARATION name and must decide whether it declares an
 * authorable container — so the two measured true positives of that consumer
 * are pinned here BY NAME, against the committed bytes (not against a fresh
 * computation: `check:declaration-map` already proves bytes ↔ sources; these
 * pins prove the bytes carry the specific facts the consumer was funded on).
 *
 *   - `ObjectSchemaBase` → `data/Object` — the module-private base case: the
 *     name exists only in source text, recovered by the generator's syntactic
 *     unwinding. If this pin reds, that pass regressed (or the base was
 *     renamed — update the pin and the generator's canary together).
 *   - `DatasourceSchema` → `data/Datasource` — the plain export case. (The
 *     issue's prose used `DatasourceDef` as a stand-in; no such declaration
 *     exists — `schemaMode`'s enclosing declaration is `DatasourceSchema`.)
 *
 * Plus the guards that keep the pins from passing vacuously: the aggregate map
 * is NON-EMPTY at scale, a known-absent name really misses (a permissive
 * reader — a Proxy, a prototype hit — would answer everything), and every
 * recorded value is a def key the schema manifest actually publishes.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_DIR = path.resolve(PKG_DIR, 'declaration-map');
const MANIFEST_DIR = path.resolve(PKG_DIR, 'json-schema.manifest');

interface Shard {
  description: string;
  category: string;
  entries: Record<string, string>;
  collisions: string[];
}

function readShards(dir: string): Record<string, unknown>[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, unknown>);
}

const shards = readShards(MAP_DIR) as unknown as Shard[];
const entries: Record<string, string> = Object.assign({}, ...shards.map((s) => s.entries));

describe('declaration-map/ (#13712)', () => {
  it('is non-empty at the scale the surface implies', () => {
    // ~1,600 def keys each contribute at least one name; a truncated or
    // half-composed artifact cannot reach this floor.
    expect(Object.keys(entries).length).toBeGreaterThan(1000);
    expect(shards.length).toBeGreaterThanOrEqual(10);
  });

  it('pins the module-private base case: ObjectSchemaBase → data/Object', () => {
    expect(entries['ObjectSchemaBase']).toBe('data/Object');
  });

  it('pins the plain export case: DatasourceSchema → data/Datasource', () => {
    expect(entries['DatasourceSchema']).toBe('data/Datasource');
  });

  it('positive control: a known-absent name misses, so a hit means something', () => {
    // `DatasourceDef` is the issue's stand-in spelling; no such declaration
    // exists in src/. A reader that answered it would answer anything, and
    // both pins above would stop being evidence.
    expect(Object.prototype.hasOwnProperty.call(entries, 'DatasourceDef')).toBe(false);
    expect(entries['ThisDeclarationDoesNotExist13712']).toBeUndefined();
  });

  it('every recorded value is a def key the schema manifest publishes', () => {
    const published = new Set(
      readShards(MANIFEST_DIR).flatMap((s) => (s as { schemas?: string[] }).schemas ?? []),
    );
    expect(published.size).toBeGreaterThan(1000);
    const strays = Object.entries(entries).filter(([, defKey]) => !published.has(defKey));
    expect(strays).toEqual([]);
  });

  it('a name never appears as both an entry and a collision', () => {
    const collided = new Set(shards.flatMap((s) => s.collisions));
    const both = Object.keys(entries).filter((n) => collided.has(n));
    expect(both).toEqual([]);
  });
});
