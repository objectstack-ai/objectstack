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
  // (`.objectui-sha` = `9dfaca654`, `packages/plugin-grid`; re-measured at
  // that pin, 2026-10-05: on the hop off `2e818d0b5`, `ObjectGrid.tsx` changed
  // in three type docblocks only (9 insertions, 6 deletions: objectui#8347
  // re-wording its `BaseSchema` index-signature notes in the past tense), all
  // above the selection block, which only MOVED by +3:
  // `ObjectGrid.tsx:4813-4840` here (`4810-4837` at `2e818d0b5`), still
  // hashing to `c88443302d40c2db739ddb235470bafa29056e2e` (hash-object of the
  // block), re-READ with the same reading below; `hooks/useBulkExecutor.ts` is
  // byte-identical to `2e818d0b5` and its `:298-303` still hashes to
  // `01083348330f10a201cdf1078b4c21c236402b6a`. At `2e818d0b5`, 2026-10-04:
  // `ObjectGrid.tsx` and `hooks/useBulkExecutor.ts` are
  // byte-identical across the hop off `ab1879721` (`git diff --quiet`), so
  // every anchor held unmoved. Re-measured at `ab1879721`, 2026-10-03. On the
  // hop off `89cad75d5`, `ObjectGrid.tsx` changed
  // again (74 insertions, 11 deletions: objectui#11544's group-header labels
  // read from the object field's `options` only, objectui#11475's percent
  // storage `max` copied onto the cell's field meta on three paths and one
  // import edited in place, above the selection block; objectui#11068's
  // `keyboardNavigation`, objectui#11475's mobile-card percent face and
  // objectui#11227's resolved empty-state labels, below it), none of it inside
  // the selection block, which only MOVED by +19: `ObjectGrid.tsx:4810-4837`
  // here (`4791-4818` at `89cad75d5`), still hashing to
  // `c88443302d40c2db739ddb235470bafa29056e2e` (hash-object of the block),
  // re-READ with the same reading below; `hooks/useBulkExecutor.ts` is
  // byte-identical to `89cad75d5` and its `:298-303` still hashes to
  // `01083348330f10a201cdf1078b4c21c236402b6a`. At `89cad75d5`, 2026-10-02:
  // on the hop off `31971ff1e`, `ObjectGrid.tsx` changed
  // again (42 insertions, 17 deletions: objectui#11322's built-in bulk-delete
  // gate asking `partitionRowsByPredicate` directly and objectui#11254's
  // mobile-card percent width, plus their two import lines, each edited in
  // place), every hunk either a same-length import edit or below the
  // selection block, which did NOT move: `ObjectGrid.tsx:4791-4818` there as at
  // `31971ff1e`, still hashing to `c88443302d40c2db739ddb235470bafa29056e2e`
  // (hash-object of the block), re-READ with the same reading below;
  // `hooks/useBulkExecutor.ts` is byte-identical to `31971ff1e` and its
  // `:298-303` still hashes to `01083348330f10a201cdf1078b4c21c236402b6a`.
  // At `31971ff1e`, 2026-10-01: on the hop off `e420df310`, `ObjectGrid.tsx` changed
  // again (41 insertions, 1 deletion: objectui#10689's re-read on a harvested
  // query input), every hunk above the selection block, which only MOVED by
  // +40: `ObjectGrid.tsx:4791-4818` there (`4751-4778` at `e420df310`), still
  // hashing to `c88443302d40c2db739ddb235470bafa29056e2e` (hash-object of the
  // block), re-READ with the same reading below; `hooks/useBulkExecutor.ts` is
  // byte-identical to `e420df310` and its `:298-303` still hashes to
  // `01083348330f10a201cdf1078b4c21c236402b6a`. At `e420df310`, 2026-09-30:
  // on the hop off `db11afd49`, `ObjectGrid.tsx` changed
  // again (164 insertions, 48 deletions: objectui#9853's display page size,
  // objectui#11021's searched grouped grid, objectui#9547's `onNavigate` prop,
  // objectui#7297's `{record_id}` filter values and objectui#11070's
  // `reference` spelling among them), none of it inside the selection block,
  // which only MOVED by +114: `ObjectGrid.tsx:4751-4778` there (`4637-4664` at
  // `db11afd49`), still hashing to
  // `c88443302d40c2db739ddb235470bafa29056e2e` (hash-object of the block),
  // re-READ with the same reading below; `hooks/useBulkExecutor.ts` is
  // byte-identical to `db11afd49` and its `:298-303` still hashes to
  // `01083348330f10a201cdf1078b4c21c236402b6a`. At `db11afd49`, 2026-09-29:
  // on the hop off `dd3f7e1be`, `ObjectGrid.tsx` changed
  // again (105 insertions, 16 deletions: objectui#11068's grid keys,
  // objectui#11105's server-grouped column-name fix, objectui#10993's title
  // locale map among them), none of it inside the selection block, which only
  // MOVED by +32: `ObjectGrid.tsx:4637-4664` here (`4605-4632` at
  // `dd3f7e1be`), still hashing to
  // `c88443302d40c2db739ddb235470bafa29056e2e` (hash-object of the block),
  // re-READ with the same reading below; `hooks/useBulkExecutor.ts` is
  // byte-identical to `dd3f7e1be` and its `:298-303` still hashes to
  // `01083348330f10a201cdf1078b4c21c236402b6a`. Previously measured at
  // `89cad75d5`, `31971ff1e`, `e420df310`, `db11afd49`, `dd3f7e1be`, `f8a9d0fb0`, `62597c588`,
  // `87af769e9`, `53ded82bf`, `a472b0716`, `00d3f09c5`, `67dadd602`, before
  // that at `d8ec8d6d4`, `9602dc820`, `190fbd01d`, `9a3daf8d3`, originally at
  // `6314e87f2`. On the hop off `f8a9d0fb0`, `ObjectGrid.tsx` changed hard
  // (745 insertions, 161 deletions: objectui#7189's server-side grid grouping
  // and objectui#10881's grouped-grid refusal among them), none of it inside
  // the selection block, which only MOVED: `ObjectGrid.tsx:4605-4632` then
  // (`4032-4059` at `f8a9d0fb0`), still hashing to
  // `c88443302d40c2db739ddb235470bafa29056e2e`, re-READ with the same reading
  // below — the one edit in the surrounding selection-mode region (from its
  // `Determine selection mode` comment to `singleSelection`) is a comment tag
  // (`[#3720]` -> `[objectstack#3720]`). On the hop off
  // `62597c588`, `ObjectGrid.tsx` changed too (18 insertions, 5 deletions:
  // objectui#10083's `rowActionsDeclared` row-menu signal and objectui#9909's
  // currency display locale), none of it inside the selection block, which
  // only MOVED then as well (`4024-4051` to `4032-4059`), re-READ with the
  // same reading. `ObjectGrid.tsx` changed across the move off
  // `87af769e9` too (119 insertions, 9 deletions), and THAT time the selection block's CONTENT
  // moved, not only its position: objectui#10218 (`62597c588` itself)
  // rewrote the `selection` arm to "presence enables; an explicit off wins",
  // so an authored `selection` object with no `type` now selects
  // (`DEFAULT_SELECTION_TYPE`, `'multiple'`) where it used to fall through.
  // The block was `ObjectGrid.tsx:4024-4051` at `62597c588` — `3940-3955` at `87af769e9`,
  // `3538-3553` at `53ded82bf` — and no longer hashes to the
  // `6133933199230670e29d8c7f51c558d86a0af1d2` the previous three hops
  // recorded (`c88443302d40c2db739ddb235470bafa29056e2e` now). Re-READ, the
  // arm this record relies on is unchanged: with neither `selection` nor
  // `selectable` authored, multi-select is still enabled only by
  // `hasBulkActions`, and the rewritten arm is reachable only by a view that
  // declares `selection` — which none of these four does. The earlier hop off
  // `00d3f09c5` is the one that caught the previous record's OWN grid anchor as
  // wrong rather than merely shifted: `3790-3805` there is
  // `runBulkActionAggregate` and says nothing about selection. That is the
  // class commit d1ba685ec gates, and the reason a citation refresh re-READS instead of moving
  // numbers — arithmetic on a wrong anchor produces a fresh-looking span still
  // describing the wrong function. The second claim,
  // `hooks/useBulkExecutor.ts:298-303`, sits in a file that is byte-identical
  // to `f8a9d0fb0`, to `62597c588` and to `87af769e9` on the last three hops
  // (`git diff --quiet`; it last changed on the hop off `53ded82bf`, 36
  // insertions, 22 deletions, when it was re-READ rather than carried on file
  // identity): the six lines hash to
  // `01083348330f10a201cdf1078b4c21c236402b6a` at every one of those pins and
  // still end on
  // `label = 'bulk delete'`, the line the `284-288` span cited nine
  // pins ago stopped short of, truncating the second of the two branches it
  // names (byte-identity is never taken as proof an anchor is right):
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
    'the action runner rather than hitting /batch.',
  // #15873 — maintainer ruling 2026-09-07 (decision batch #64, option (a),
  // verbatim 「同意」): the data door admits `update` so an administrator can set
  // the four platform-owned columns (`require_mfa`, `parent_organization_id`,
  // `sort_order`, `timezone`) the ADR-0092 D2 whitelist already admitted on
  // the engine path. The ruling named ONE verb on an identity table, and
  // `bulk` is a second widening it did not take: granting it would open
  // `POST /data/sys_organization/batch` and the `*Many` routes to every API
  // client. What `update` DOES derive is admitted, and named: `import` is
  // `any: ['create', 'update']` in `API_METHOD_DERIVATION`, so update-mode
  // `POST /data/sys_organization/import` now passes the method gate and
  // updates N rows in one request — each row clamped to the D2 whitelist under
  // the caller's context, insert/upsert modes still 405. That is not the batch
  // shape this ledger is about (`bulk` gates `/batch` and `*Many`, `import`
  // does not read it), which is why the exemption stands beside it. The
  // object's one list view (`all_orgs`) declares no `bulkActions` /
  // selection, and the implicit bulk-delete entry gates on the `delete`
  // affordance — off three times over (`managedBy: 'better-auth'` denies by
  // default, `userActions` opens `edit` alone, `delete` is not in
  // `apiMethods`) — so there is no multi-select to batch today. The cost the
  // header prices — a promoted multi-select edit fanning out per row through
  // the action runner — is accepted for a table that holds one row in
  // single-org deployments. Should a batch organization edit gain a real
  // caller, that is a further widening for the contract-review lane: delete
  // this entry and add `'bulk'`; the stale-entry test below refuses to let
  // both stand.
  sys_organization:
    'Administrators set the platform-owned columns through single-record PATCH ' +
    'and the derived update-mode import door (a ruling grants `update`; both are ' +
    'column-clamped per row by ADR-0092 D2). `bulk` — /batch and the *Many ' +
    'routes — is not granted: no console surface multi-selects organizations ' +
    '(the list view declares no bulk actions and the object grants no delete ' +
    'affordance), and a promoted bulk edit would fan out per row through the ' +
    'action runner rather than hitting /batch.',
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

describe('apiMethods conformance — single-record writes imply batch', () => {
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
