// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
import { ERROR_CODE_LEDGER, ErrorCode } from '../api/error-code-ledger.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import type { IAutomationService } from '../contracts/automation-service';
import type { ApplyConversionsOptions } from './apply';
import type { ConversionContext } from './types';

// ─── [#24001] ADR-0078's conversion-CONFLICT channel is RETIRED ─────────────
//
// ADR-0049 enforce-or-remove, under the startup-stage rule that a published
// surface with no producer retires at once (no sunk-cost exemption). The
// channel's only producer was the live-executor guard inside the
// `flow-node-http-callout-rename` conversion; protocol 18 reserved the three
// old callout names (`FLOW_RESERVED_NODE_TYPES`), so the engine refuses an
// executor under one, no live owner can collide with the rename, and the guard
// went. Measured on `origin/main` fd9664ffac before removal: no conversion
// entry called the context's conflict sink — the only references were the
// bridge in `apply.ts`, its declarations, the engine's empty plumbing and four
// consumer branches in `metadata-protocol`, none of which could fire.
//
// What left, and where each pin below holds it:
//
//   1. three root exports — the notice code constant and the two notice
//      types — by resolved symbol identity over every public entry (§1);
//   2. the two conversion-option members, the two context members and the
//      canonicalize result's `conflicts` array — by key absence at the type
//      level, which `check:test-typecheck` compiles (§2);
//   3. the error code, by the ledger's own "Retiring a code" rule: its row
//      came out with its last emitter, so `ErrorCode` no longer parses it (§3);
//   4. every spelling of all of it, by a tree-scoped absence scan over the
//      declared radius, so the channel cannot come back one consumer at a
//      time (§4).
//
// No D2 conversion and no tombstone: no metadata document ever carried any of
// it. The D3 semantic entry `conversion-conflict-channel-removed` is the
// declaration, and §1 checks it is registered on step 18.

/** The exports that left. */
const RETIRED_EXPORTS = [
  'CONVERSION_CONFLICT_CODE',
  'ConversionConflictNotice',
  'ConversionConflictDetail',
] as const;

/** The retired error code. */
const RETIRED_CODE = 'FLOW_CONVERSION_CONFLICT';

describe('§1 the retired exports have zero holders; the TODO channel stands', () => {
  it('every retired name has ZERO holders on any public entry, and the survivors still stand on the root', () => {
    // Anti-vacuity: the baseline covers the real surface.
    expect(EXPORT_ENTRY_POINTS).toContain('.');
    expect(exportNamesOf('.').length, 'the root must export a non-trivial surface').toBeGreaterThan(500);

    for (const name of RETIRED_EXPORTS) {
      expect(holdersOf(name), `${name} must have zero holders after its retirement`).toEqual([]);
    }

    // The conversion API keeps its notice and TODO channels: a too-wide sweep
    // that took them with the conflict channel is the failure this catches.
    const root = exportNamesOf('.');
    for (const survivor of [
      'CONVERSION_NOTICE_CODE',
      'CONVERSION_TODO_CODE',
      'ConversionNotice',
      'ConversionTodoNotice',
      'ConversionTodoDetail',
      'ConversionContext',
      'ApplyConversionsOptions',
      'applyConversions',
    ]) {
      expect(root, `${survivor} must SURVIVE this retirement on the root`).toContain(survivor);
    }
  });

  it('the runtime barrel resolves without the retired constant and keeps its TODO twin', async () => {
    const conversions = await import('./index');
    expect(conversions).not.toHaveProperty('CONVERSION_CONFLICT_CODE');
    // Anti-vacuity: the barrel really resolved.
    expect(conversions).toHaveProperty('CONVERSION_TODO_CODE', 'OS_METADATA_CONVERSION_TODO');
    expect(conversions).toHaveProperty('applyConversions');
  });

  it('the D3 semantic entry is registered on step 18', () => {
    const ids = (MIGRATIONS_BY_MAJOR[18]?.semantic ?? []).map((entry) => entry.id);
    expect(ids).toContain('conversion-conflict-channel-removed');
  });
});

describe('§2 the conversion options, the context and the contract carry no conflict member', () => {
  /** `true` when `K` is a key of `T` — compiled by `check:test-typecheck`. */
  type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;
  type CanonicalizeResult = ReturnType<NonNullable<IAutomationService['canonicalizeStoredFlow']>>;

  it('the retired members are absent at the type level, the surviving ones present', () => {
    // Each tuple element's TYPE is the assertion: a member coming back flips
    // its `Has<…>` to `true` and the `false` literal stops compiling.
    const absent: [
      Has<ApplyConversionsOptions, 'onConflict'>,
      Has<ApplyConversionsOptions, 'reservedNodeTypes'>,
      Has<ConversionContext, 'reservedNodeTypes'>,
      Has<ConversionContext, 'reportConflict'>,
      Has<CanonicalizeResult, 'conflicts'>,
    ] = [false, false, false, false, false];
    const present: [
      Has<ApplyConversionsOptions, 'onNotice'>,
      Has<ApplyConversionsOptions, 'onTodo'>,
      Has<ConversionContext, 'reportTodo'>,
      Has<CanonicalizeResult, 'notices'>,
      Has<CanonicalizeResult, 'todos'>,
    ] = [true, true, true, true, true];
    expect(absent.every((v) => v === false)).toBe(true);
    expect(present.every((v) => v === true)).toBe(true);
  });
});

describe('§3 the error code left the ledger with its last emitter', () => {
  it('ErrorCode no longer parses it, and no owner lists it', () => {
    expect(ErrorCode.safeParse(RETIRED_CODE).success).toBe(false);
    for (const [owner, codes] of Object.entries(ERROR_CODE_LEDGER)) {
      expect(codes as readonly string[], `${owner} must not register ${RETIRED_CODE}`).not.toContain(RETIRED_CODE);
    }
    // Control: the same owner's sibling 409/422 rows still parse.
    expect(ErrorCode.safeParse('DEFAULT_RECORD_PAGE_CONFLICT').success).toBe(true);
    expect(ErrorCode.safeParse('CONCURRENT_UPDATE').success).toBe(true);
  });
});

// ─── §4 tree-scoped absence ────────────────────────────────────────────────
//
// Every identifier the channel published, plus the notice code's wire value and
// the save door's old lowercase message prefix. None of these spellings has a
// live meaning anywhere else in the tree (measured before removal), so a bare
// substring match is the matcher; `onConflict` and a bare `conflicts` are NOT
// on the list — both name live, unrelated members elsewhere (a flow
// concurrency policy, a query alias fold, the package and security-catalog
// refusals), and §2 holds this channel's spellings of them at the type level.
//
// Radius, declared in `scripts/cross-package-test-inputs.mjs` under
// `@objectstack/spec` (the #15513 pin's rows; this file is a further witness
// on each): `packages/` per extension (never `.tsx` — a typed `.tsx`
// resurrection fails `tsc` in its own package), `examples/` for the non-code
// extensions only (every example has its own `typecheck`), and `skills/`,
// `content/`, `scripts/` whole.
describe('tree-scoped absence: no spelling of the conversion-conflict channel survives inside the declared radius', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  /** tsup's transient bundle of `tsup.config.ts` (see the #15513 pin for the measured crash). */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const SPELLINGS = [
    ...RETIRED_EXPORTS,
    RETIRED_CODE,
    'OS_METADATA_CONVERSION_CONFLICT',
    'flow_conversion_conflict',
    'reservedNodeTypes',
    'reportConflict',
  ];

  /** Structural exclusions, each with its reason. NOT an allowlist file: these are the retirement kit and its projections. */
  const EXCLUDED = new Set([
    // This pin spells the retired names to assert their absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // Registers the retirement (the D3 entry's prose names what left; the
    // generated, git-ignored `registry.ts` concatenates it).
    'packages/spec/src/migrations/',
    // Release prose records the removal (release-owned; never edited by a code PR).
    'content/docs/releases/',
    '.changeset/',
  ];

  const vanished: string[] = [];
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('no retired spelling survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        for (const spelling of SPELLINGS) {
          if (text.includes(spelling)) offenders.push(`${rel} spells \`${spelling}\``);
        }
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(
      offenders,
      'the ADR-0078 conversion-conflict channel has no producer since protocol 18 reserved the old callout names — a rename over an open namespace reserves its old names instead of reporting a conflict',
    ).toEqual([]);
  });
});
