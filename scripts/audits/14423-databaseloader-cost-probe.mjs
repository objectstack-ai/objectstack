#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14423 step 1 (census) — empirical confirmation that `DatabaseLoader.loadManyKeyed()`
// costs NOTHING extra over `loadMany()` (same query, same cache — `readTypeRows()`,
// `packages/metadata/src/loaders/database-loader.ts:936`), while a `listNames()` +
// per-name `load()` read costs a SEPARATE query (`list()`, `:1062`) plus one query
// PER NAME (`load()`'s `_findOne`, via `baseFilter(type,name)`) — a real N+1 against
// `loadMany`'s single query. MEASUREMENT ONLY — ships nothing.

import { MetadataManager } from '../../packages/metadata/dist/index.js';
import { DatabaseLoader } from '../../packages/metadata/dist/index.js';

function countingEngine(rows) {
  const calls = { find: 0, findOne: 0 };
  const matches = (r, w) => Object.entries(w).every(([k, v]) => r[k] === v);
  return {
    calls,
    async find(_t, q) { calls.find++; return rows.filter((r) => matches(r, q?.where ?? {})); },
    async findOne(_t, q) { calls.findOne++; return rows.find((r) => matches(r, q?.where ?? {})) ?? null; },
    async count(_t, q) { return rows.filter((r) => matches(r, q?.where ?? {})).length; },
  };
}

function row(name, body) {
  return { id: `md_${name}`, name, type: 'action', namespace: 'default', scope: 'platform', state: 'active', version: 1, metadata: JSON.stringify(body) };
}

const NAMES = ['a1', 'a2', 'a3', 'a4', 'a5'];
const rows = NAMES.map((n) => row(n, { name: n, type: 'script', target: n }));

// Scenario A: loadManyKeyed alone, FRESH loader/cache.
{
  const engine = countingEngine(rows);
  const loader = new DatabaseLoader({ engine, trackHistory: false, cache: { enabled: true } });
  await loader.loadManyKeyed('action');
  console.log('loadManyKeyed alone:', JSON.stringify(engine.calls));
}

// Scenario B: loadMany alone, FRESH loader/cache — same query shape as A?
{
  const engine = countingEngine(rows);
  const loader = new DatabaseLoader({ engine, trackHistory: false, cache: { enabled: true } });
  await loader.loadMany('action');
  console.log('loadMany alone:      ', JSON.stringify(engine.calls));
}

// Scenario C: listNames() (MetadataManager, one loader) + per-name load() for
// every name it reported — the candidate "keyed read" shape from the ruling.
{
  const engine = countingEngine(rows);
  const loader = new DatabaseLoader({ engine, trackHistory: false, cache: { enabled: true } });
  const mgr = new MetadataManager({});
  mgr.registerLoader(loader);
  const names = await mgr.listNames('action');
  for (const n of names) {
    await mgr.loadDiagnosed('action', n);
  }
  console.log(`listNames + ${names.length}x loadDiagnosed:`, JSON.stringify(engine.calls),
    `(1 list-query + ${names.length} point-queries = ${1 + names.length} total, vs loadMany's 1)`);
}
