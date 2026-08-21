// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Conformance ratchet: a tightened `apiMethods` whitelist that grants
// single-record writes must also grant the `bulk` primitive (#3026 follow-up).
//
// The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
// request is admitted only when the object grants the `bulk` PRIMITIVE and the
// batched child operation is itself allowed. Before that, the `*Many` routes
// checked only the child verb, so a boilerplate CRUD-five whitelist batched
// fine. Every object carrying an explicit whitelist therefore needed `bulk`
// added — and the sweep that did it was scoped to `platform-objects`, so eight
// objects in `plugin-security`, `plugin-approvals` and `metadata-core` silently
// kept 405-ing `/batch`, `createMany`, `updateMany` and `deleteMany` while
// their single-record writes stayed wide open (fixed in #3745).
//
// The bug was not a wrong judgement — it was an audit whose SCOPE was a package
// name while the gap lived in packages nobody thought to open. This test
// replaces that manual sweep with a scan of every `*.object.ts` in the
// monorepo, so a new declaration anywhere is covered by construction. Scanning
// source (rather than importing the packages) keeps the check next to the
// derivation table without inverting the spec → * dependency direction — the
// same technique as `system/constants/platform-object-names.test.ts`.
//
// If this fails, pick one deliberately:
//   - the object should batch  → add `'bulk'` to its `apiMethods`;
//   - it genuinely must not    → register it in SINGLE_RECORD_WRITE_ONLY below
//                                with the reason, so the choice is on the record.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_PRIMITIVES } from './api-derivation';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/spec/src/data → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** The single-record write primitives whose batch shape `bulk` unlocks. */
const WRITE_PRIMITIVES = ['create', 'update', 'delete'] as const;

/**
 * Objects that deliberately expose single-record writes but NO batch route,
 * keyed by object name with the reason. Every other tightened whitelist in the
 * monorepo either grants `bulk` or grants no write verb at all.
 *
 * Adding an entry is a real decision — but price it correctly per #3757's
 * two corrections (that issue's premise was retracted by its own author and
 * closed not planned). `data-objectstack` does rethrow the 405, but its only
 * caller, `useBulkExecutor` → `executeBulkBatch`, falls back to per-row
 * writes on ANY throw; and the grid's built-in bulk-delete entry gates on the
 * child verb `delete`, not on `bulk` (gating it on `bulk` would be a
 * regression). So an exemption costs a wasted round trip plus N per-row
 * writes, not a hard user-visible error. Write down why the object is worth
 * that.
 */
const SINGLE_RECORD_WRITE_ONLY: Record<string, string> = {
  // #7802. `update` arrived in #7727/#7769 for exactly one gesture on exactly
  // one column: the `revoke_api_key` / `restore_api_key` row actions PATCH
  // `revoked` on ONE key. The multi-select surface this rule protects does not
  // exist for API keys, and the shape a future one would take does not need
  // `bulk` either — both read off the console build this release pins
  // (`.objectui-sha` = `9a3daf8d3`, `packages/plugin-grid`; re-measured at
  // that pin, 2026-08-21 — originally measured at `6314e87f2`):
  //
  //  · No checkbox column is rendered. None of the object's four list views
  //    declares `bulkActions` / `bulkActionDefs` / `selection`, and `ObjectGrid`
  //    auto-enables multi-select only when a bulk action exists. The single
  //    implicit one is bulk-delete, gated on the resolved `delete` affordance —
  //    false here three times over (`managedBy: 'better-auth'` denies by
  //    default, `userActions` opens `edit` alone, and `delete` is not in
  //    `apiMethods`). So there is no selection to batch.
  //  · A multi-select revoke, if the product ever wants one, still would not
  //    reach `/batch`. Both actions are `locations: ['list_item']`; naming one
  //    in a view's `bulkActions` promotes it to `operation: 'custom'` +
  //    `actionDef`, which `useBulkExecutor` fans out through the action runner
  //    as N single-record PATCHes against the route #7769 opened. The data-plane
  //    `bulk` primitive is reached only by an `update`/`delete` bulk def, which
  //    this object neither declares nor can acquire implicitly.
  //
  // Granting `bulk` would therefore open `POST /data/sys_api_key/batch` and the
  // `*Many` routes to every API client, on a better-auth identity table whose
  // authorable surface is one boolean — ADR-0092 D2's write guard whitelists
  // `revoked` and strips everything else — with no consumer asking for it.
  // Should a batch key lifecycle ever gain a real caller, delete this entry and
  // add `'bulk'`; the stale-entry test below refuses to let both stand.
  sys_api_key:
    'Revoke/restore is a one-row, one-column PATCH (`revoked`, the only column ' +
    "ADR-0092 D2's identity write guard admits). No console surface multi-selects " +
    'API keys — the grid renders no checkbox column because the object grants no ' +
    'delete affordance — and a promoted bulk revoke would fan out per row through ' +
    'the action runner rather than hitting /batch (#7802).',
};

/** Every `*.object.ts` under `packages/`, skipping build output and deps. */
function walkObjectFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkObjectFiles(full, out);
    else if (entry.endsWith('.object.ts')) out.push(full);
  }
  return out;
}

/** The object name declared by `ObjectSchema.create({ name: '…' })`, if any. */
function declaredObjectName(source: string): string | undefined {
  return source.match(/ObjectSchema\.create\(\{[\s\S]{0,600}?name:\s*'([a-z0-9_]+)'/)?.[1];
}

interface Whitelist {
  object: string;
  file: string;
  methods: string[];
}

/**
 * Every authored `apiMethods: [...]` array literal under `packages/`. Legacy /
 * unknown strings are kept as authored — the resolver ignores them, and this
 * check only reasons about primitives.
 */
function collectWhitelists(): Whitelist[] {
  const out: Whitelist[] = [];
  for (const file of walkObjectFiles(PACKAGES_DIR)) {
    const source = readFileSync(file, 'utf8');
    const object = declaredObjectName(source) ?? '(unnamed)';
    for (const match of source.matchAll(/apiMethods:\s*\[([^\]]*)\]/g)) {
      out.push({
        object,
        file: file.slice(REPO_ROOT.length + 1),
        methods: [...match[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]),
      });
    }
  }
  return out;
}

const WHITELISTS = collectWhitelists();

describe('apiMethods conformance — single-record writes imply batch (#3026)', () => {
  it('scans a plausible number of declarations (guards a silently empty sweep)', () => {
    // A scan that matches nothing passes every assertion below vacuously — the
    // exact failure mode this file exists to prevent. Pin a floor instead.
    expect(WHITELISTS.length).toBeGreaterThan(40);
  });

  it('only authors the six primitives (legacy verbs are derived, never declared)', () => {
    // Since the #3543 enum shrink a legacy verb in a whitelist is stripped at
    // parse and ignored by the resolver, so declaring one is silently dead
    // metadata — catch it at the source instead.
    const primitives = new Set<string>(API_PRIMITIVES);
    const offenders = WHITELISTS.flatMap(({ object, file, methods }) =>
      methods.filter((m) => !primitives.has(m)).map((m) => `${object} declares '${m}' (${file})`),
    );
    expect(offenders).toEqual([]);
  });

  it('grants bulk wherever it grants create / update / delete', () => {
    const offenders = WHITELISTS.filter(({ object, methods }) => {
      if (SINGLE_RECORD_WRITE_ONLY[object] !== undefined) return false;
      const grantsWrite = WRITE_PRIMITIVES.some((verb) => methods.includes(verb));
      return grantsWrite && !methods.includes('bulk');
    }).map(
      ({ object, file, methods }) =>
        `${object}: [${methods.join(', ')}] grants single-record writes but not 'bulk' — ` +
        `/batch and the *Many routes will 405 (${file})`,
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the exemption list free of stale entries', () => {
    // An exemption that no longer describes a real single-record-write-only
    // object reads as a documented decision while documenting nothing.
    const stale = Object.keys(SINGLE_RECORD_WRITE_ONLY).filter((object) => {
      const declared = WHITELISTS.filter((w) => w.object === object);
      if (declared.length === 0) return true;
      return declared.every(
        (w) => w.methods.includes('bulk') || !WRITE_PRIMITIVES.some((v) => w.methods.includes(v)),
      );
    });
    expect(stale).toEqual([]);
  });
});
