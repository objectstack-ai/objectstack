// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 290 — spawns the real producer once per single-cause fixture: every case runs the real schema generator (build-schemas.ts --check) in its own sandbox git tree, one fixture per cause, and one generator run is about 7 s of JSON Schema emission and spec module load before any assertion; re-measured 2026-10-26 over the 10 executed readings in refresh PR #25960's window (hourly runs 40200279306 to 40272142430), slowest 226.64 s (run 40204927516) x 1.25, rounded up
//
// The manifest ratchet and its neighbours: a check reports, it does not write (#4711);
// an export that never published must be declared (#16431); the output clean spares a
// sibling generator (#5371); the bundle counts the definitions it carries (#12588).
//
// One of the `build-schemas-check-mode.*.test.ts` files (#25372 split the one
// file so the repo project's workers run its blocks in parallel). The family's
// header — what `--check` pins and why every case runs in a sandbox git tree —
// and the shared sandbox, helpers and constants live in
// `build-schemas-check-mode.fixture.ts`.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaStamp } from '../../../scripts/check-regen-pending.mjs';
import { RENAMED_DEFS } from './lib/renamed-defs';
import {
  UNEMITTED_BASELINE_FILE,
  type UnemittedBaseline,
  type UnemittedEntry,
} from './lib/unemitted-schemas';
import {
  entryFile,
  KNOWN_KEY,
  PHANTOM_KEY,
  PKG,
  pristine,
  readManifest,
  readManifestKeys,
  REGEN_COMMAND,
  run,
  sandbox,
  seedBase,
  seedManifest,
  seedSurface,
  seedSurfaceBase,
  SPAWN_TIMEOUT_MS,
  useSharedSandbox,
} from './build-schemas-check-mode.fixture';

// The repo-root `scripts/` every sandbox here symlinks in, and the generator
// imports from (#16175): an input from outside this package, so it is named in
// this file — `check:cross-package-test-inputs` reads a test file's own source,
// not the fixture module it imports (#25372).
const ROOT_SCRIPTS = fileURLToPath(new URL('../../../scripts', import.meta.url));

useSharedSandbox(ROOT_SCRIPTS);

describe('build-schemas.ts --check — a check reports, it does not write (#4711)', () => {
  it(
    'fails on a manifest behind on additions, and leaves the file byte-identical',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(pristine).toContain(KNOWN_KEY);
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));

      const { status, output } = run(['--check']);

      // The exit code is half the fix: before #4711 this branch exited 0.
      expect(status).toBe(1);
      expect(output).toMatch(/json-schema\.manifest\/ is out of date \(1 schema\(s\) not recorded\)/);
      expect(output).toContain(`+ json-schema/${KNOWN_KEY}.json`);
      // The remedy must be the generator, exactly as the other seven artifacts say.
      expect(output).toMatch(/gen:schema/);
      // …and the file is the other half: not rewritten, not touched.
      expect(readManifest()).toBe(stale);
      expect(output).not.toContain('📒');
    },
  );

  it(
    'fails on a manifest still listing a def RENAMED_DEFS moved away, without writing it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The other half of the same condition, and the half that has no other
      // reporter: a renamed-away source key is deliberately NOT "missing" (the
      // disappearance ratchet excludes it, since the def is published under the
      // new name), so before #4711 the only thing that ever noticed it was the
      // silent rewrite. #4684 / #4703 both depend on that key actually leaving
      // the manifest.
      const [renamedSource] = Object.keys(RENAMED_DEFS);
      // Loud on purpose: an empty table makes this branch dead code, which is a
      // decision (delete the branch, or the test) — not something to skip past.
      expect(renamedSource, 'RENAMED_DEFS is empty — this test exercises nothing').toBeTruthy();
      const withStaleRename = seedManifest((s) => [...s, renamedSource].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(
        /json-schema\.manifest\/ is out of date .*1 renamed-away key\(s\) still listed/,
      );
      expect(output).toContain(`- json-schema/${renamedSource}.json  (renamed away)`);
      expect(readManifest()).toBe(withStaleRename);
    },
  );

  it(
    'keeps the disappearance ratchet intact: a schema in the manifest that no build emits still exits 1',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const withPhantom = seedManifest((s) => [...s, PHANTOM_KEY].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/1 previously published schema\(s\) disappeared from this build/);
      expect(output).toContain(`- json-schema/${PHANTOM_KEY}.json`);
      // The deliberate-removal route registers through the generated table's
      // entry FILE and the generator — never by typing into the table.
      expect(output).toContain(entryFile('retired-defs', PHANTOM_KEY));
      expect(output).toContain(`export const entry = '${PHANTOM_KEY}';`);
      expect(output).toContain(REGEN_COMMAND);
      expect(output).not.toContain('migrations/registry.ts');
      expect(readManifest()).toBe(withPhantom);
    },
  );

  it(
    'still writes the manifest outside --check, so gen:schema keeps recording additions',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));

      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(output).toContain('📒 json-schema.manifest/ updated (+1 schema(s) across 1 shard(s))');
      expect(readManifest()).not.toBe(stale);
      expect(readManifestKeys()).toContain(KNOWN_KEY);
    },
  );

  it(
    'is silent about the manifest when it is up to date — the new failure is staleness, not --check itself',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Negative control. Without it, "always exit 1 in check mode" would pass
      // every assertion above while breaking the gate for everyone.
      // NOTE: this asserts status 0, so it also re-proves that the COMMITTED
      // manifest and authorable-surface snapshots are current — the same thing
      // `check:authorable-surface` asserts in CI. If it fails here, run
      // `pnpm --filter @objectstack/spec gen:schema` and commit the result.
      const current = seedManifest((s) => s);

      const { status, output } = run(['--check']);

      expect(output).not.toMatch(/json-schema\.manifest\/ is out of date/);
      expect(output).not.toContain('📒');
      expect(readManifest()).toBe(current);
      expect(status).toBe(0);
    },
  );

  // ── #16175: the ONE write point, pinned where it can actually go missing ───
  //
  // `schema-tree-freshness.test.ts` pins what the freshness rule does with a
  // stamp. Nothing there can notice if the generator stops WRITING one — and
  // that failure is invisible by construction: the rule degrades to `unstamped`,
  // which is the conservative verdict, so every gate stays green and the only
  // symptom is that the mtime false refusal quietly comes back. These two cases
  // are the half that goes red when the write point is removed.
  it(
    'writes the generation stamp as its last step, in --check mode too',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const stampPath = path.join(sandbox, 'json-schema', '.build-input-hash-schema');
      seedManifest((s) => s);

      // A plain generation: `gen:schema`, the entry point `check:docs`'s own
      // remedy line names.
      fs.rmSync(stampPath, { force: true });
      expect(run([]).status).toBe(0);
      expect(fs.existsSync(stampPath), 'gen:schema wrote no freshness stamp').toBe(true);
      const written = fs.readFileSync(stampPath, 'utf8').trim();
      expect(written).toMatch(/^[0-9a-f]{64}$/);
      // The digest the READER computes for this tree, not a literal: writer and
      // reader disagreeing is the one failure that cannot be seen from either
      // side alone, and it fails in the acquitting direction only by accident.
      expect(schemaStamp(sandbox).state).toBe('match');

      // …and `--check` too. It runs the same unconditional regeneration before
      // its fork, so a tree it leaves behind is as current as `gen:schema`'s and
      // must be as believable. This is also the case that proves the stamp is
      // not the #4711 defect returning: `json-schema/` is this generator's own
      // gitignored output, cleared by it and rewritten by it, never a tracked
      // file a check repairs — the manifest assertion above still holds.
      const current = readManifest();
      fs.rmSync(stampPath, { force: true });
      expect(run(['--check']).status).toBe(0);
      expect(fs.existsSync(stampPath), '--check wrote no freshness stamp').toBe(true);
      expect(schemaStamp(sandbox).state).toBe('match');
      expect(readManifest()).toBe(current);
    },
  );

  it(
    'never leaves a stamp behind for a generation that was REFUSED',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The soundness argument for the write point's POSITION, asserted. The
      // stamp is the last line of the script, after every ratchet that can exit
      // 1 — so a run that refused vouches for nothing, and the next reader sees
      // `unstamped`, which is no evidence, which leaves the mtime rule standing.
      const stampPath = path.join(sandbox, 'json-schema', '.build-input-hash-schema');
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));
      fs.rmSync(stampPath, { force: true });

      expect(run(['--check']).status).toBe(1);

      expect(fs.existsSync(stampPath), 'a refused run stamped the tree anyway').toBe(false);
      expect(readManifest()).toBe(stale);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #16431 — an export that was NEVER published.
//
// The block above pins the ratchet for a schema that STOPS being emitted. This
// one pins its sibling, and the two are deliberately not the same instrument:
// the disappearance ratchet's baseline is `json-schema.manifest/`, which an
// export that never emitted has never been in, so it has nothing to miss. The
// last case here is that separation, asserted rather than assumed.
//
// The population is the repo's own — `src/` is symlinked into the sandbox — so
// every fixture works by mutating the LEDGER and letting the real build
// adjudicate it. Each case restores the ledger afterwards, because the shared
// sandbox outlives the block.
// ─────────────────────────────────────────────────────────────────────────────

/** An export this build emits a JSON Schema for — the negative control's subject. */
const EMITTED_EXPORT = 'Data.QueryFilterSchema';

/** A ledger entry naming no export at all. */
const PHANTOM_EXPORT = 'Data.ZzzNeverExportedByAnyBuild';

const unemittedPath = (): string => path.join(sandbox, UNEMITTED_BASELINE_FILE);

const readUnemittedBytes = (): string => fs.readFileSync(unemittedPath(), 'utf8');

/** Rewrite the sandbox ledger's `entries`, keeping `$comment`; returns the bytes. */
function seedUnemitted(
  mutate: (entries: Record<string, UnemittedEntry>) => Record<string, UnemittedEntry>,
): string {
  const doc = JSON.parse(readUnemittedBytes()) as UnemittedBaseline & { $comment?: unknown };
  const text = JSON.stringify({ ...doc, entries: mutate({ ...doc.entries }) }, null, 2) + '\n';
  fs.writeFileSync(unemittedPath(), text);
  return text;
}

describe('build-schemas.ts — an export that never published must be declared (#16431)', () => {
  let pristineUnemitted: string;
  /** A real member of the committed population, whatever it is called today. */
  let someUnemitted: string;

  beforeAll(() => {
    pristineUnemitted = fs.readFileSync(path.join(PKG, UNEMITTED_BASELINE_FILE), 'utf8');
    const entries = (JSON.parse(pristineUnemitted) as UnemittedBaseline).entries;
    const keys = Object.keys(entries);
    expect(keys.length, `${UNEMITTED_BASELINE_FILE} is empty — it is a committed ledger (#16431)`)
      .toBeGreaterThan(0);
    someUnemitted = keys[0];
  });

  // The manifest is seeded per test everywhere in this file rather than by
  // `createSandbox`, so a block run in isolation (`-t`) starts with none at all
  // — and every case here would then fail on a stale manifest instead of on the
  // thing it is testing. Seed before, restore after: the ledger has to go back
  // too, because the shared sandbox outlives this block.
  beforeEach(() => {
    seedManifest((s) => s);
  });

  afterEach(() => {
    fs.writeFileSync(unemittedPath(), pristineUnemitted);
    seedManifest((s) => s);
  });

  it(
    'refuses GROWTH: an un-emitted export missing from the ledger exits 1, and the ledger is untouched',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Deleting the line is how a NEW un-emitted export looks to this gate:
      // the build observes it, the ledger does not name it. That equivalence is
      // what lets the fixture stay inside the sandbox instead of mutating `src/`.
      const withoutOne = seedUnemitted((e) => {
        delete e[someUnemitted];
        return e;
      });

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/exported schema\(s\) emit NO JSON Schema and are not declared/);
      expect(output).toContain(`+ ${someUnemitted}`);
      // A check reports and never writes — the same discipline as #4711 above.
      expect(readUnemittedBytes()).toBe(withoutOne);
    },
  );

  it(
    'refuses a STALE entry: a ledger line whose export emits a JSON Schema exits 1',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const withStale = seedUnemitted((e) => ({
        ...e,
        [EMITTED_EXPORT]: { cause: 'date', reason: 'fixture: this export emits and must not be listed' },
      }));

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/ledger entry\(ies\) in .* now EMIT a JSON Schema/);
      expect(output).toContain(`- ${EMITTED_EXPORT}`);
      expect(readUnemittedBytes()).toBe(withStale);
    },
  );

  it(
    'refuses a ledger line that names no export at all',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedUnemitted((e) => ({
        ...e,
        [PHANTOM_EXPORT]: { cause: 'function', reason: 'fixture: no such export' },
      }));

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/ledger entry\(ies\) in .* name no exported schema/);
      expect(output).toContain(`- ${PHANTOM_EXPORT}`);
    },
  );

  it(
    'refuses a recorded cause this build does not observe',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The reason prose is written ABOUT the cause. Left unchecked, an entry
      // explaining a `z.date()` would keep reading as current after the date
      // became a function — a repair nobody made, recorded as one.
      seedUnemitted((e) => ({
        ...e,
        [someUnemitted]: { ...e[someUnemitted], cause: 'map' },
      }));

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/ledger entry\(ies\) record a cause this build does not observe/);
      expect(output).toContain(`~ ${someUnemitted}: recorded "map"`);
    },
  );

  it(
    'refuses an entry whose reason is empty — a count is not a ledger',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedUnemitted((e) => ({
        ...e,
        [someUnemitted]: { ...e[someUnemitted], reason: '   ' },
      }));

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/ledger entry\(ies\) carry an empty `reason`/);
      expect(output).toContain(`- ${someUnemitted}`);
    },
  );

  it(
    'does not replace the disappearance ratchet: a schema that STOPS being emitted is still its case',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The two ratchets guard opposite directions and must not trade domains.
      // A manifest key no build emits is #2978's case, and its remedy — delete
      // the key and declare it in RETIRED_DEFS_BY_MAJOR — is the right one; the
      // #16431 ledger's "declare it here" would be wrong advice for a schema
      // that was published yesterday. So that red must still be the one that
      // speaks, with the ledger untouched and unmentioned.
      seedManifest((s) => [...s, PHANTOM_KEY].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/1 previously published schema\(s\) disappeared from this build/);
      expect(output).toContain(`- json-schema/${PHANTOM_KEY}.json`);
      expect(output).not.toMatch(/emit NO JSON Schema and are not declared/);
    },
  );

  it(
    'is green on the committed ledger, and names the population it accepted',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Negative control, twice over. Without it, "always exit 1" would satisfy
      // every assertion above; and because the sandbox reads the repo's own
      // `src/`, a pass here re-proves that the COMMITTED ledger describes this
      // tree — the same thing `check:authorable-surface` asserts in CI.
      const current = seedUnemitted((e) => e);

      const { status, output } = run(['--check']);

      expect(status).toBe(0);
      expect(output).toMatch(/exported schema\(s\) emit no JSON Schema — all declared in/);
      expect(output).toContain(someUnemitted);
      expect(readUnemittedBytes()).toBe(current);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #4650 — a deleted authorable-surface line must prove itself.
//
// Checks (a)/(b) read authorable-surface.json from the SAME commit, so deleting
// a baseline line deleted the evidence they run on: #4638 and #4643 removed
// authorable keys with zero registered conversions and a green gate. Check (c)
// re-anchors deletions on the baseline at the merge base with origin/main — a
// version the PR cannot rewrite — and demands one of three proofs: an aged-out
// registered tombstone, unreachability from the metadata-type roots (2026-08-02
// ruling), or the whole def leaving the build (the manifest ratchet's domain).
//
// Fixtures sabotage the BASE (extra lines committed under origin/main) while
// the worktree file stays canonical: set-wise identical to the real attack
// (line present at base, absent from the PR) without editing symlinked src/.
// The live end-to-end shape — delete a prop from src AND its baseline line —
// is exercised in the PR's recorded sabotage evidence instead.

// ─────────────────────────────────────────────────────────────────────────────
// #5371 — the output clean is scoped to THIS generator's artifacts.
//
// `packages/spec/json-schema/` has two writers: this script emits
// `<category>/<Name>.json` and `objectstack.json`, and `gen:openapi`
// (build-openapi.ts) emits `openapi.json`. The clean used to remove the
// DIRECTORY, so it took the sibling's file with it. `pnpm build` never shows
// it (`gen:schema && gen:openapi` rewrites the file last), but every entry
// point that stops after this script leaves the artifact gone — and the tree is
// gitignored with no gate over it (`check:generated` says so itself: "Generated
// but ungated (2): gen:openapi, gen:sbom"), so nothing reports the hole.
//
// It surfaces two packages away instead, as `@objectstack/rest`'s openapi route
// tests failing `expected 503 to be 200` against a diff that never touched
// them. Four independent reports, each one an attribution lap: #5371 itself,
// then mid-#5126, mid-#5588 and mid-#5672.
//
// `--check` gets its own case because it is the reported trigger, not a variant
// of the write path: `check:authorable-surface` IS this script with that flag,
// `check:generated` runs it, and a command whose name says "check" destroying a
// build artifact is precisely what made the cause so hard to reach.
//
// The unit-level behaviour of the clean (nested trees, back-off, an entry it
// cannot remove) is pinned in scripts/json-schema-out-dir.test.ts. What these
// two cases add is the half that file cannot assert: that this script still
// routes its clean through it.
describe('build-schemas.ts — the output clean spares a sibling generator (#5371)', () => {
  const OUT = () => path.join(sandbox, 'json-schema');
  const OPENAPI = 'openapi.json';
  /** Bytes only `gen:openapi` could have written — identity, not just presence. */
  const OPENAPI_BYTES = JSON.stringify(
    { openapi: '3.1.0', 'x-fixture': 'written by gen:openapi, never by gen:schema' },
    null,
    2,
  );
  /** Output of this generator that no current build emits — the clean's own job. */
  const STALE_FILE = 'zzStaleFromAnEarlierRun.json';
  const STALE_DIR = 'zzretiredcategory';

  /** Seed json-schema/ the way a completed `pnpm build` leaves it, plus stale debris. */
  function seedOutDir(): void {
    fs.mkdirSync(path.join(OUT(), STALE_DIR), { recursive: true });
    fs.writeFileSync(path.join(OUT(), STALE_DIR, 'Gone.json'), '{}');
    fs.writeFileSync(path.join(OUT(), STALE_FILE), '{}');
    fs.writeFileSync(path.join(OUT(), OPENAPI), OPENAPI_BYTES);
  }

  /** The clean really ran, over a tree this run really regenerated. */
  function expectCleanedAndRegenerated(): void {
    expect(fs.existsSync(path.join(OUT(), STALE_FILE))).toBe(false);
    expect(fs.existsSync(path.join(OUT(), STALE_DIR))).toBe(false);
    expect(fs.existsSync(path.join(OUT(), 'objectstack.json'))).toBe(true);
    expect(fs.existsSync(path.join(OUT(), 'data', 'Object.json'))).toBe(true);
  }

  beforeEach(() => {
    // A current, self-consistent tree, so the run exits 0 and the assertions
    // below are about the clean rather than about some ratchet upstream of it.
    seedManifest((s) => s);
    const tip = seedBase((s) => s);
    seedSurface((s) => s);
    seedSurfaceBase(tip, (k) => k);
  });

  it(
    "leaves gen:openapi's artifact byte-identical while still sweeping its own stale output",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedOutDir();

      const { status, output } = run([]);

      expect(status).toBe(0);
      // "No stale files remain" is unchanged — this is not a narrower clean.
      expectCleanedAndRegenerated();
      // …and the sibling's artifact is neither deleted nor rewritten.
      expect(fs.readFileSync(path.join(OUT(), OPENAPI), 'utf8')).toBe(OPENAPI_BYTES);
      // Announced, so an exemption is never indistinguishable from a miss.
      expect(output).toContain(`kept ${OPENAPI}`);
      expect(output).toContain('gen:openapi');
    },
  );

  it(
    '--check does the same — the reported trigger was a command named check: (#5371)',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedOutDir();

      const { status } = run(['--check']);

      expect(status).toBe(0);
      // `--check` still rebuilds the gitignored tree it computes from (that is
      // #4711's boundary: it may not write a TRACKED file), so the clean runs
      // here too — which is exactly why this path could delete the artifact.
      expectCleanedAndRegenerated();
      expect(fs.readFileSync(path.join(OUT(), OPENAPI), 'utf8')).toBe(OPENAPI_BYTES);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #12588 — the bundle's `x-schema-count` counts what the bundle carries.
//
// `objectstack.json` ships in the npm tarball and a docs page publishes the
// field's meaning ("its `x-schema-count` field reports the total number of
// definitions"), so the number is a contract, not a build log. It used to be
// taken from `count` — incremented once per EMIT — while `$defs` is assembled
// from a map keyed by `<category>/<Name>`. Every def key written twice therefore
// widened a gap nothing reconciled: the published bundle declared 1596
// definitions and shipped 1585.
//
// The unit half (scripts/def-key-collisions.test.ts) pins the arithmetic. What
// only this sandbox can assert is that the artifact the generator really writes
// describes itself correctly — the assertions below read the emitted bytes, not
// a helper's return value. `src/` is symlinked into the sandbox, so this runs
// over the REAL spec surface (~1600 schemas), which is also what makes the
// non-vacuity guard below meaningful: this build genuinely collapses emits.
//
// The invariant is pinned, never today's absolute number — 1585 moves with
// every schema anyone adds, and a test that has to be edited by unrelated PRs
// gets edited without being read.
describe('build-schemas.ts — the bundle counts the definitions it carries (#12588)', () => {
  const OUT = () => path.join(sandbox, 'json-schema');

  beforeAll(() => {
    // A current, self-consistent tree, so the run exits 0 and these assertions
    // are about the bundle rather than about some ratchet upstream of it.
    seedManifest((s) => s);
    const tip = seedBase((s) => s);
    seedSurface((s) => s);
    seedSurfaceBase(tip, (k) => k);
  });

  /**
   * One generation for the block. Both cases read the same fixture and only
   * READ what the run printed and wrote, so the first case to need it runs the
   * generator and the other reads that run, the way
   * `openapi-self-consistency.test.ts` shares its shipped run.
   */
  let generation: ReturnType<typeof run> | undefined;
  const generated = (): ReturnType<typeof run> => (generation ??= run([]));

  it(
    'writes x-schema-count equal to its own $defs size, and to the files on disk',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = generated();
      expect(status).toBe(0);

      const bundle = JSON.parse(
        fs.readFileSync(path.join(OUT(), 'objectstack.json'), 'utf8'),
      ) as { 'x-schema-count': number; $defs: Record<string, unknown> };
      const defCount = Object.keys(bundle.$defs).length;

      // 1. The artifact describes itself.
      expect(bundle['x-schema-count']).toBe(defCount);

      // 2. A second, independent instrument: one file per def key on disk. The
      //    per-schema writes collapse the same way the map does, so the tree is
      //    a witness the bundle cannot fabricate. `openapi.json` belongs to
      //    gen:openapi and objectstack.json is the bundle itself.
      const onDisk = fs
        .readdirSync(OUT(), { recursive: true, encoding: 'utf8' })
        .filter(
          (entry) =>
            entry.endsWith('.json') &&
            path.basename(entry) !== 'objectstack.json' &&
            path.basename(entry) !== 'openapi.json',
        );
      expect(onDisk).toHaveLength(defCount);

      // 3. The generator's own console agrees, so a reader of the build log and
      //    a reader of the artifact reach the same number.
      expect(output).toContain(`objectstack.json (${defCount} definitions)`);
    },
  );

  it(
    'accounts for every emit the definition count does not include',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = generated();
      expect(status).toBe(0);

      const bundle = JSON.parse(
        fs.readFileSync(path.join(OUT(), 'objectstack.json'), 'utf8'),
      ) as { 'x-schema-count': number };
      const emitted = Number(/Successfully generated (\d+) schemas/.exec(output)?.[1]);
      expect(Number.isFinite(emitted), 'summary line must report the emit total').toBe(true);

      // Non-vacuity: this build must still collapse emits, or the case proves
      // nothing about the defect. If a future PR removes the last self-alias
      // from the spec, `x-schema-count: count` and the correct expression stop
      // differing and this pin can no longer fail — delete it deliberately
      // then, rather than discovering later that it had gone quiet.
      expect(
        emitted,
        'no emit collapses any more — this build no longer models #12588',
      ).toBeGreaterThan(bundle['x-schema-count']);

      // The delta is reported, not left as a subtraction between two lines —
      // that silence is what let a wrong number ship unnoticed. The reported
      // figure must reconcile the two totals exactly.
      const collapsed = Number(/ℹ️\s+(\d+) emit\(s\) collapsed/.exec(output)?.[1]);
      expect(Number.isFinite(collapsed), 'the collapsed-emit report line must be printed').toBe(true);
      expect(emitted - collapsed).toBe(bundle['x-schema-count']);

      // Every collapsed key is named, and named as a self-alias: the guard
      // upstream exits on any def key written twice by DIFFERENT schemas, so a
      // build that reaches here has only benign ones. Stating it in the report
      // is what makes that population readable instead of implied.
      expect(output).toContain('all self-aliases');
      const named = [...output.matchAll(/ {5}json-schema\/(\S+)\.json {2}<- {2}/g)].map((m) => m[1]);
      expect(named.length).toBeGreaterThan(0);
      for (const defKey of named) {
        expect(fs.existsSync(path.join(OUT(), `${defKey}.json`))).toBe(true);
      }
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #4659 — check (b) registers a tombstone by its EXACT key, not by its leaf.
//
// Until this change, "live → retired must be registered" was satisfied by
// matching the key's LEAF against every ' / '-separated conversion/migration
// `surface` in the ADR-0087 registries — `endsWith('.' + name)`, across all
// majors, ignoring which def the key belonged to. So any unrelated registration
// ending in the same leaf registered a tombstone for free. #4658 measured it:
// tombstoning `automation/Event:type` passed silently because protocol 11's
// `flow-node-http-callout-rename` had registered `flow.node.type`. #5509 widened
// the leaf vocabulary to `.description`, one of the most common keys on
// authorable shapes, and the exposure grew with every conversion.
//
// The registration now lives in its own table — RETIRED_KEYS_BY_MAJOR in
// src/migrations/registry.ts, values the literal `${defKey}:${name}` — and
// check (b) is exact set membership over it. Conversion `surface` prose is
// untouched: it addresses authors in the shape they write metadata
// (`flow.nodes[].outputSchema`) and no rule can map that back onto a def key.
//
// ── Why a SECOND sandbox ──────────────────────────────────────────────────
// These tests need the gate to read a registry that differs per case, and the
// sandbox above symlinks `src/`, so writing one there would write the repo's
// tracked registry. This one COPIES `src/` instead (10 MB, ~40 ms) so its
// `src/migrations/registry.ts` is a fixture. Nothing else changes: the gate
// under test is the same copied `scripts/build-schemas.ts`, reading a byte-equal
// spec source, and no test-only seam is added to it — the substituted table is
// fixture data exactly as the fabricated `refs/remotes/origin/main` is.
//
// ── Why the green cases still exit 1 ──────────────────────────────────────
// A live → retired transition exists only when the committed baseline disagrees
// with the emitted contract, so every fixture here is, by construction, a
// baseline the generated-form reporter at the end of the script will call stale.
// That reporter is a different failure with a different remedy, and the
// assertions below discriminate on the message, never on the exit code alone.
