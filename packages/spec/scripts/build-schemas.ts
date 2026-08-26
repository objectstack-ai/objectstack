// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Force eager Zod construction so lazySchema() Proxies resolve immediately —
// JSON Schema generation walks `_def` recursively and needs real schemas, not
// lazy stubs. See packages/spec/src/shared/lazy-schema.ts.
process.env.OS_EAGER_SCHEMAS = '1';

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { z } from 'zod';
import { schemaNameFromExportKey } from './lib/schema-name';
import {
  collapsedEmitCount,
  findDefKeyCollisions,
  findSelfAliasedDefKeys,
  formatDefKeyCollisions,
  type EmittedDef,
} from './lib/def-key-collisions';
import { RENAMED_DEFS, carryAuthorableKey, checkRenameTable } from './lib/renamed-defs';
// The Zod-graph walkers the authorable-surface reachability BFS runs on. Extracted
// at #5317 so the pipe-direction rule (#4488) is assertable without running the
// whole generator — see scripts/zod-graph.test.ts.
import { zodChildSchemas, zodShapeOf } from './lib/zod-graph';
// Who owns what under json-schema/. This generator shares that directory with
// gen:openapi, and used to clear it by deleting the directory itself (#5371).
import {
  FOREIGN_JSON_SCHEMA_ARTIFACTS,
  clearOwnedOutputs,
} from './lib/json-schema-out-dir';
import {
  AUTHORABLE_SURFACE_DIR_NAME,
  SCHEMA_MANIFEST_DIR_NAME,
  aggregateCategoryShards,
  authorableSurfaceShardTexts,
  readShardedKeysAtRev,
  schemaManifestShardTexts,
  serializeShard,
  writeShards,
  type GitRun,
  type ShardArrayField,
} from './lib/sharded-artifacts';
// The #4666 default-value ratchet: what an author gets when they OMIT a key.
// Its own module because the fingerprint's normalisation rules — and the
// direction-B boundary that keeps constraints out of them — are assertable
// without running the whole generator (scripts/authorable-defaults.test.ts).
import {
  AUTHORABLE_DEFAULTS_DIR_NAME,
  authorableDefaultsShardTexts,
  authoriseDefaultChanges,
  collectAuthorableDefaults,
  diffAuthorableDefaults,
  parseDefaultEntries,
} from './lib/authorable-defaults';
import { DEFAULT_CHANGES_BY_MAJOR } from './lib/default-changes';
import { RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../src/migrations/registry';
import {
  getMetadataTypeSchema,
  listMetadataTypeSchemaTypes,
} from '../src/kernel/metadata-type-schemas';
import * as AI from '../src/ai';
import * as API from '../src/api';
import * as Automation from '../src/automation';
import * as Cloud from '../src/cloud';
import * as Contracts from '../src/contracts';
import * as Data from '../src/data';
import * as Identity from '../src/identity';
import * as Integration from '../src/integration';
import * as Kernel from '../src/kernel';
import * as QA from '../src/qa';
import * as Security from '../src/security';
import * as Shared from '../src/shared';
import * as Studio from '../src/studio';
import * as System from '../src/system';
import * as UI from '../src/ui';

// Root index no longer re-exports namespaces (removed for tree-shaking — see
// packages/spec/src/index.ts). Build subpath-by-subpath instead so every
// category folder under json-schema/ gets populated.
const Protocol: Record<string, Record<string, unknown>> = {
  AI, API, Automation, Cloud, Contracts, Data, Identity, Integration,
  Kernel, QA, Security, Shared, Studio, System, UI,
};

/** The package root — every generated artifact below is resolved from here. */
const PKG_DIR = path.resolve(__dirname, '..');

const OUT_DIR = path.resolve(PKG_DIR, 'json-schema');
// Ratchet manifest: the committed record of every schema key this script has
// ever emitted. json-schema/ itself is a gitignored build artifact, so this
// directory is the durable "last time" — see the disappearance check below
// (#2978). Sharded by category since #5837: the ratchet reads the WHOLE
// directory as one set, so its semantics are byte-for-byte the old ones and only
// the merge surface changed. See scripts/lib/sharded-artifacts.ts.
const MANIFEST_DIR = path.resolve(__dirname, `../${SCHEMA_MANIFEST_DIR_NAME}`);
// Three modes, one code path:
//
//   (default)       `gen:schema` — regenerate json-schema/ and, when they are
//                   behind, the two committed PROJECTIONS of this source:
//                   json-schema.manifest/ and authorable-surface/.
//   `--check`       `check:authorable-surface` — verify both snapshots without
//                   rewriting either, so CI fails on an uncommitted ADDITION too
//                   (the write and check paths share the same code — same
//                   discipline as build-docs.ts). "Without rewriting" is
//                   load-bearing: a check that repairs what it detects can never
//                   report it, and it silently edits the tree of whoever ran it
//                   (#4711).
//   `--update-base` `gen:authorable-surface-base` — the ONLY mode that writes the
//                   deletion gate's in-tree ANCHOR, authorable-surface.base.json.
//                   See the flag's own comment below (#5358).
const CHECK = process.argv.includes('--check');
// `--update-base` re-anchors the in-tree baseline `authorable-surface.base.json`.
// It is a MODE OF ITS OWN, and nothing else writes that file — not `--check`, not
// a plain `gen:schema`, not the `pnpm build` that runs `gen:schema` as its first
// step (#5358).
//
// Why the anchor is different in kind from this script's other two artifacts.
// `json-schema.manifest/` and `authorable-surface/` are projections of
// the source being built: regenerating them is always right, and their diff is
// the change under review. The anchor is not a projection of anything local — it
// is a snapshot of an UPSTREAM commit, the baseline the #4650 deletion gate
// compares against precisely because the commit under test cannot rewrite it.
// Refreshing it on every build made that guarantee conditional on nobody ever
// running a build: three independent reports (#4990, #5155, #5660) each did a
// `pnpm --filter '<pkg>^...' build` for an unrelated package, found the anchor
// rewritten in `git status`, and caught it only by reading the diff by hand — one
// of them net −110 keys, exactly the batch #4988/#5321 had just retired. Anchored
// forward, the gate can no longer see that retirement, and BOTH states are green,
// so nothing anywhere reports it. A `git add -A` is all it takes.
//
// So the anchor moves only when a human types this flag, and the move is then the
// whole content of a reviewed diff rather than a rider on somebody else's PR.
// Staleness stays what it always was — not an error (see the anchor block near
// the end of this file): the gate proves the anchor AUTHENTIC, never current.
const UPDATE_BASE = process.argv.includes('--update-base');
if (CHECK && UPDATE_BASE) {
  console.error(
    `\n❌ --check and --update-base are mutually exclusive.\n\n` +
      `   --check is a verification: it reports and never writes (#4711). --update-base is the\n` +
      `   deliberate re-anchoring of authorable-surface.base.json (#5358). A run that did both\n` +
      `   would be a check that repairs what it detects, which can never report it.`,
  );
  process.exit(1);
}

/**
 * The ONE command that (re)writes the in-tree anchor (#5358). Every prescription
 * about that file names this and nothing else — a message that still said
 * `gen:schema` would send the reader to a command that no longer touches it.
 *
 * Declared up here, above the mode's own refusals, because the earliest of them
 * runs before this file has read a single schema (#5370).
 */
const REANCHOR_COMMAND = 'pnpm --filter @objectstack/spec gen:authorable-surface-base';

/**
 * The path git itself reports for `$GIT_DIR/MERGE_HEAD`, or null when this is not
 * a git repository at all (an image-build stage, an unpacked tarball).
 *
 * Asked of git rather than assembled by hand: in every linked worktree — which
 * AGENTS.md §11 requires every agent in this repo to work in — `.git` is a FILE,
 * and the real per-worktree MERGE_HEAD lives under `.git/worktrees/<name>/`. A
 * literal `.git/MERGE_HEAD` finds nothing there, so the hand-built path would
 * leave this guard dead in exactly the checkouts the repo tells people to use.
 */
function mergeHeadPath(cwd: string): string | null {
  const probe = spawnSync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], {
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  if (probe.status !== 0) return null;
  const reported = (probe.stdout ?? '').trim();
  // Relative to cwd inside a main worktree, absolute inside a linked one.
  return reported ? path.resolve(cwd, reported) : null;
}

// ── Re-anchoring mid-merge resolves the WRONG baseline (#5370) ────────
//
// `resolveSurfaceBase()` anchors on `merge-base(HEAD, origin/main)`. While a merge
// is stopped before its commit, HEAD is still the branch tip from BEFORE the
// merge, so that merge base is the branch's OLD fork point rather than the main
// tip being merged in. Re-anchoring there moves `baseRev` BACKWARDS.
//
// What makes this worth a refusal rather than a warning is that nothing else can
// catch it: the older rev is a genuine origin/main ancestor and the keys written
// are that commit's surface verbatim, so the anchor stays AUTHENTIC — the
// authenticity check, `check:authorable-surface` and the pre-commit os-regen
// guard all pass on the regressed file. The only trace is a reverse `baseRev`
// move in the diff, which is the #4650 attack shape, written by the generator
// itself. Observed on the #5312 sync relay: `baseRev` rolled from main's `1c3da1f`
// back to `5aae790`, returning the 109 keys #5321 had just retired.
//
// `scripts/regen-artifacts.mjs` states the same rule for the merge driver's side —
// "Re-anchor after the merge is committed, or not at all" — and keeps the driver
// from ever prescribing this command mid-merge. This is that sentence enforced for
// the human who types it anyway, and it refuses BEFORE the ~1600-schema
// generation, like the mutual-exclusion refusal above.
if (UPDATE_BASE) {
  const mergeHead = mergeHeadPath(path.resolve(__dirname, '..'));
  if (mergeHead && fs.existsSync(mergeHead)) {
    console.error(
      `\n❌ --update-base refuses to run mid-merge (#5370).\n\n` +
        `   MERGE_HEAD is present, so this merge has not been committed yet. The baseline this\n` +
        `   mode re-anchors on is \`merge-base(HEAD, origin/main)\`, and mid-merge HEAD is still\n` +
        `   the branch tip from before the merge — that merge base is the branch's OLD fork\n` +
        `   point, not the main tip being merged in. Re-anchoring here moves baseRev BACKWARDS,\n` +
        `   and nothing downstream reports it: the older rev is a real origin/main ancestor and\n` +
        `   its keys are that commit's surface verbatim, so the anchor stays AUTHENTIC while\n` +
        `   silently undoing whatever main had already anchored past — a retirement included.\n\n` +
        `   Commit the merge first, then re-anchor on the merged tree:\n\n` +
        `     git commit            # finish the merge\n` +
        `     ${REANCHOR_COMMAND}\n\n` +
        `   Re-anchor after the merge is committed, or not at all (scripts/regen-artifacts.mjs).`,
    );
    process.exit(1);
  }
}
const SPEC_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')).version;
const SCHEMA_BASE_URL = `https://schema.objectstack.io/v${SPEC_VERSION}`;

// Retry and delay configuration
const RETRY_DELAY_BASE_MS = 100; // Base delay in ms, multiplied by retry attempt number
const FS_SYNC_DELAY_MS = 50;     // Delay after rmSync to ensure filesystem consistency
const MAX_RETRIES = 3;            // Maximum number of retry attempts

/**
 * Synchronous sleep utility using a busy-wait loop
 * Only use for short delays in build scripts where blocking is acceptable
 * 
 * Note: This blocks the event loop and consumes CPU. For production code,
 * use async/await with setTimeout. For build scripts, this simple synchronous
 * approach is acceptable as we need to ensure filesystem operations complete
 * before proceeding.
 */
function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait
  }
}

/**
 * Safely ensure directory exists with retry logic
 */
function ensureDir(dirPath: string, retries = MAX_RETRIES): void {
  for (let i = 0; i < retries; i++) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      // Verify the directory was created successfully
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        return;
      }
    } catch (error) {
      if (i === retries - 1) {
        throw new Error(`Failed to create directory ${dirPath}: ${error}`);
      }
      // Wait a bit before retrying with exponential backoff
      const delay = RETRY_DELAY_BASE_MS * (i + 1);
      sleepSync(delay);
    }
  }
}

/**
 * Safely write file with retry logic
 */
function writeFileWithRetry(filePath: string, content: string, retries = MAX_RETRIES): void {
  for (let i = 0; i < retries; i++) {
    try {
      // Ensure the parent directory exists
      const dir = path.dirname(filePath);
      ensureDir(dir);
      
      fs.writeFileSync(filePath, content);
      return;
    } catch (error) {
      if (i === retries - 1) {
        throw new Error(`Failed to write file ${filePath}: ${error}`);
      }
      // Wait a bit before retrying with exponential backoff
      const delay = RETRY_DELAY_BASE_MS * (i + 1);
      sleepSync(delay);
    }
  }
}

// Clean THIS generator's outputs, so no stale file of ours remains — and only
// ours (#5371). `json-schema/` is shared with `gen:openapi`, which writes
// `openapi.json` there and is the last step of `pnpm build`; deleting the
// directory itself (what this block used to do) left every entry point that
// stops after `gen:schema` — `check:authorable-surface`, and therefore
// `check:generated` — with the artifact gone, and `@objectstack/rest`'s openapi
// route tests failing `expected 503 to be 200` in a package nobody had touched.
// The ownership registry and the deny-list reasoning live in
// scripts/lib/json-schema-out-dir.ts.
if (fs.existsSync(OUT_DIR)) {
  console.log(`Cleaning output directory: ${OUT_DIR}`);

  // Retries and back-off unchanged: filesystem races in CI are why they exist.
  const cleaned = clearOwnedOutputs(OUT_DIR, {
    maxAttempts: MAX_RETRIES * 2,
    retryDelayBaseMs: RETRY_DELAY_BASE_MS,
    sleep: sleepSync,
    onUnremovable: (entry, error) => {
      // Continue rather than abort — ensureDir/writeFileWithRetry will regenerate
      // over whatever is left, which is what this block did before #5371 too.
      console.warn(
        `Warning: Failed to fully clean ${entry} after ${MAX_RETRIES * 2} attempts:`,
        error,
      );
    },
  });

  // Say what was spared and who owns it. Silence here would make the exemption
  // indistinguishable from a clean that quietly missed a file.
  for (const entry of cleaned.preserved) {
    console.log(`  ↳ kept ${entry} — owned by ${FOREIGN_JSON_SCHEMA_ARTIFACTS.get(entry)} (#5371)`);
  }

  // Wait a bit to ensure file system has synced
  sleepSync(FS_SYNC_DELAY_MS);
}

// Ensure output directory exists
ensureDir(OUT_DIR);

console.log(`Generating JSON Schemas to ${OUT_DIR}...`);

let count = 0;
let inputModeCount = 0;
let skippedCount = 0;
let errorCount = 0;

// Track all generated schemas in memory so the bundled $defs can be assembled
// without re-reading the just-written JSON files (CI filesystems occasionally
// surface stale/ENOENT entries between write and immediate read).
const generatedSchemas = new Map<string, Record<string, unknown>>();

// The live Zod instance behind each emitted def, so the authorable-surface
// deletion check (#4650) can BFS the REAL schema graph from the metadata-type
// roots instead of approximating reachability from names or imports.
const zodByDefKey = new Map<string, z.ZodType>();

// Every export this run published, in encounter order, so the def-key collision
// guard below can see the writes `generatedSchemas` collapses. That map is
// keyed by def key and `set()` is unconditional, so by the time a duplicate is
// in it the loser is already gone — the record has to be kept alongside (#5832).
const emittedDefs: EmittedDef[] = [];

// Error messages for schema types that inherently cannot be represented in JSON Schema.
// These are expected warnings, not build-breaking errors.
const KNOWN_UNSUPPORTED_PATTERNS = [
  'cannot be represented in JSON Schema',
];

function isKnownUnsupported(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return KNOWN_UNSUPPORTED_PATTERNS.some((p) => msg.includes(p));
}

// Protocol now exports namespaces (Data, UI, System, AI, API)
// We need to iterate through each namespace
for (const [namespaceName, namespaceExports] of Object.entries(Protocol)) {
  if (typeof namespaceExports === 'object' && namespaceExports !== null) {
    // Create category subdirectory (e.g., data, ui, system, ai, api)
    const categoryDir = path.join(OUT_DIR, namespaceName.toLowerCase());
    
    try {
      ensureDir(categoryDir);
    } catch (error) {
      console.error(`Failed to create directory for namespace ${namespaceName}:`, error);
      errorCount++;
      continue;
    }

    console.log(`\n[${namespaceName}]`);
    
    // Iterate over all exports in each namespace
    for (const [key, value] of Object.entries(namespaceExports)) {
      // Check if it looks like a Zod Schema
      if (value instanceof z.ZodType) {
        // Suffix-only strip — shared with build-docs.ts; see lib/schema-name.ts (#4592).
        const schemaName = schemaNameFromExportKey(key);

        try {
          // Convert to JSON Schema using Zod v4's built-in toJSONSchema().
          // Default is the output (post-parse) shape. When that fails because
          // the schema contains a `.transform` (e.g. ExpressionInputSchema's
          // string→envelope shorthand), fall back to the *input* shape: these
          // JSON Schemas describe what authors write, and the input side of a
          // transform pipe is plain data, so it IS representable. Without this
          // fallback, adding a transform anywhere silently unpublishes the
          // schema (that's how PageTabsProps vanished in #2967 — see #2978).
          let jsonSchema: Record<string, unknown>;
          let io: 'output' | 'input' = 'output';
          try {
            jsonSchema = z.toJSONSchema(value, {
              target: 'draft-2020-12',
            }) as Record<string, unknown>;
          } catch (outputError) {
            if (!isKnownUnsupported(outputError)) throw outputError;
            io = 'input';
            // Throws again for types unrepresentable in either direction
            // (functions, Date, BigInt, custom) — caught by the outer skip.
            jsonSchema = z.toJSONSchema(value, {
              target: 'draft-2020-12',
              io: 'input',
            }) as Record<string, unknown>;
          }

          // Add $id URL and version metadata for IDE autocomplete and schema resolution
          const categorySlug = namespaceName.toLowerCase();
          jsonSchema['$id'] = `${SCHEMA_BASE_URL}/${categorySlug}/${schemaName}.json`;
          jsonSchema['x-spec-version'] = SPEC_VERSION;
          if (io === 'input') {
            // Flag that this schema describes the author-time (pre-parse)
            // shape — parse-time transforms/defaults are not applied in it.
            jsonSchema['x-io'] = 'input';
          }

          const fileName = `${schemaName}.json`;
          const filePath = path.join(categoryDir, fileName);

          writeFileWithRetry(filePath, JSON.stringify(jsonSchema, null, 2));
          generatedSchemas.set(`${categorySlug}/${schemaName}`, jsonSchema);
          zodByDefKey.set(`${categorySlug}/${schemaName}`, value);
          emittedDefs.push({ category: categorySlug, exportKey: key, schemaName, schema: value });
          console.log(`  ✓ ${namespaceName.toLowerCase()}/${fileName}${io === 'input' ? ' (input shape)' : ''}`);
          count++;
          if (io === 'input') inputModeCount++;
        } catch (error) {
          if (isKnownUnsupported(error)) {
            // Functions, Date types etc. have no JSON Schema representation in
            // either io direction — skip gracefully. The ratchet below still
            // fails the build if a skip makes a previously-published schema
            // disappear.
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`  ⊘ ${namespaceName}.${key}: ${msg} (skipped)`);
            skippedCount++;
          } else {
            console.error(`  ✗ Failed to generate schema for ${namespaceName}.${key}:`, error);
            errorCount++;
          }
        }
      }
    }
  }
}

console.log(`\n─── Summary ───`);
console.log(`  Generated: ${count}${inputModeCount > 0 ? ` (${inputModeCount} as input shape)` : ''}`);
if (skippedCount > 0) {
  console.log(`  Skipped:   ${skippedCount} (unsupported types: function, date, bigint, custom)`);
}

if (errorCount > 0) {
  console.error(`  Errors:    ${errorCount}`);
  console.error(`\n❌ Build failed with ${errorCount} unexpected error(s).`);
  process.exit(1);
}

// ─── Guard: one def key, one schema (#5832) ──────────────────────────
// `generatedSchemas.set()` above is an unconditional overwrite, so two exports
// of one namespace that strip to the same schema name publish ONE file and the
// loser vanishes without a word — which is how `shared/HttpMethod` shipped the
// five-value view subset while `api/*` routes were declared with the seven-value
// enum of the same name. Runs BEFORE both ratchets: neither can see this (they
// measure def keys, and a collision produces exactly one), and neither should
// adjudicate a build whose output already depends on export iteration order.
// See lib/def-key-collisions.ts for why a self-alias is exempt.
const defKeyCollisions = findDefKeyCollisions(emittedDefs);
if (defKeyCollisions.length > 0) {
  console.error(`\n❌ ${formatDefKeyCollisions(defKeyCollisions)}`);
  process.exit(1);
}

// ─── Report: the writes the guard above exempted (#12588) ─────────────
// Reaching here means every def key written twice is a self-alias, because the
// guard exits on any that is not. Those writes still collapse — `count` is one
// per EMIT while `generatedSchemas` is keyed by def key — so the emit total is
// higher than the number of definitions this build publishes. That difference
// used to be visible only as a subtraction between two summary lines, and it
// leaked into the published bundle as an `x-schema-count` nobody could reconcile
// with the `$defs` beside it. Name the population instead of implying it.
// A report, not a gate: there is no threshold here and no exit path.
const selfAliasedDefKeys = findSelfAliasedDefKeys(emittedDefs);
const collapsedEmits = collapsedEmitCount(selfAliasedDefKeys);
if (collapsedEmits > 0) {
  console.log(
    `\nℹ️  ${collapsedEmits} emit(s) collapsed into ${selfAliasedDefKeys.length} existing def key(s) ` +
      `— all self-aliases (one schema object reached by two export names), so ${count} emits publish ` +
      `${generatedSchemas.size} definitions:`,
  );
  for (const alias of selfAliasedDefKeys) {
    console.log(`     json-schema/${alias.defKey}.json  <-  ${alias.exportKeys.join(', ')}`);
  }
}

// ─── Ratchet: a published schema must never silently disappear ────────
// json-schema/ is a public contract surface (IDE validation, gen:docs input,
// $id URLs under schema.objectstack.io). The manifest is the committed record
// of every schema key ever emitted; a key present there but absent from this
// run means a code change unpublished a schema — fail loudly instead of
// letting gen:docs quietly delete its reference docs (#2978). Deliberate
// removals must delete the key from the manifest in the same PR.
// The manifest's and the authorable surface's shard descriptions used to be
// re-exported through here. #5837 moved both to scripts/lib/sharded-artifacts.ts,
// beside the writer that stamps them into every shard, and nothing in this file
// has read them since — the import and the `MANIFEST_DESCRIPTION` alias were
// residue no checker could see (#5475).

/**
 * Every def key recorded across `json-schema.manifest/`, or null when the whole
 * directory is absent (first run — bootstrap below).
 *
 * The read is of the DIRECTORY, never of "the shards this build would write":
 * a shard nobody regenerates still answers for its keys, so a hand-deleted
 * shard file is exactly as visible to the disappearance ratchet as the
 * hand-deleted lines it replaced.
 */
let manifestSchemas: string[] | null = null;
let manifestTexts: Map<string, string> | null = null;
try {
  const read = aggregateCategoryShards(MANIFEST_DIR, 'schemas');
  if (read) {
    manifestSchemas = read.entries;
    manifestTexts = new Map(read.shards.map((s) => [s.name, s.raw]));
  }
} catch (error) {
  console.error(`\n❌ Failed to read ${SCHEMA_MANIFEST_DIR_NAME}/: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const generatedKeys = new Set(generatedSchemas.keys());

// ─── Declared def renames must describe THIS build ────────────────────
// Both ratchets below consult RENAMED_DEFS, so an entry that no longer matches
// reality (target never emitted, or source still emitted alongside it) would
// weaken them silently. Fail before either one runs. See lib/renamed-defs.ts.
const renameProblems = checkRenameTable(generatedKeys);
if (renameProblems.length > 0) {
  console.error(`\n❌ ${renameProblems.length} problem(s) in RENAMED_DEFS (scripts/lib/renamed-defs.ts):`);
  for (const p of renameProblems) console.error(`     - ${p}`);
  process.exit(1);
}

const missing = (manifestSchemas ?? []).filter(
  // A def listed as renamed is not missing — it is published under the new
  // name, which `checkRenameTable` just proved this build emits. The manifest
  // rewrite below drops the old key, so the entry self-clears on regeneration.
  (key) => !generatedKeys.has(key) && !(key in RENAMED_DEFS),
);
if (missing.length > 0) {
  console.error(`\n❌ ${missing.length} previously published schema(s) disappeared from this build:`);
  for (const key of missing) {
    console.error(`     - json-schema/${key}.json`);
  }
  console.error(
    `\n   A schema listed in ${SCHEMA_MANIFEST_DIR_NAME}/ was not emitted. This usually means a\n` +
    `   Zod change made it unrepresentable (e.g. an added .transform in "output" AND "input"\n` +
    `   io modes) or an export was renamed/removed. Fix the schema, or — if the removal is\n` +
    `   deliberate — delete the key(s) from packages/spec/${SCHEMA_MANIFEST_DIR_NAME}/<category>.json\n` +
    `   in the same PR AND declare each one in RETIRED_DEFS_BY_MAJOR (src/migrations/registry.ts),\n` +
    `   which the manifest deletion gate below requires (#4725). Deleting the line alone\n` +
    `   used to be the whole procedure, and nothing checked it. Silently unpublishing a\n` +
    `   schema deletes its reference docs on the next gen:docs run (see #2978).`,
  );
  process.exit(1);
}

const manifestRecorded = new Set(manifestSchemas ?? []);
const added = [...generatedKeys].filter((key) => !manifestRecorded.has(key));
// A renamed-away source key must be dropped from the manifest even in the (rare)
// case where the new name adds nothing — e.g. a rename onto a def that already
// existed. Without this the stale key would sit in the manifest forever, kept
// alive only by its RENAMED_DEFS entry.
const renamedAway = (manifestSchemas ?? []).filter((key) => key in RENAMED_DEFS);
// The canonical shard bytes this build would write. Comparing BYTES rather than
// key sets is what keeps the shards' own description part of the artifact —
// #4725 changed the deletion procedure from "do it deliberately" to "declare it
// in RETIRED_DEFS_BY_MAJOR", and a generated file that documents a superseded
// procedure is read by exactly the person the gate exists for. Sharding made the
// comparison stricter for free: hand-formatting inside a shard is now caught the
// same way #4662 catches it in the authorable surface.
const canonicalManifestTexts = schemaManifestShardTexts([...generatedKeys].sort());
const staleManifestShards = [...canonicalManifestTexts]
  .filter(([name, text]) => manifestTexts?.get(name) !== text)
  .map(([name]) => name);
const orphanManifestShards = [...(manifestTexts?.keys() ?? [])]
  .filter((name) => !canonicalManifestTexts.has(name));
const manifestChanged =
  manifestTexts === null ||
  added.length > 0 ||
  renamedAway.length > 0 ||
  staleManifestShards.length > 0 ||
  orphanManifestShards.length > 0;
if (manifestChanged && CHECK) {
  // Removals already exited above; reaching here in check mode means the manifest
  // is behind on ADDITIONS (or still lists a def that RENAMED_DEFS moved away).
  // Report it — never write. `--check` is what `check:authorable-surface` (and so
  // `check:generated`) runs, and a check that edits a tracked file is wrong twice
  // over: it makes `git stash` / `git worktree` / merge-conflict work fail for
  // reasons nobody traces back to a gate, and it makes this branch the one
  // generated artifact of eight that can never go red in CI — "stale ⇒ rewrite it
  // for you" instead of "stale ⇒ run the generator" (#4711). Same split as the
  // authorable-surface ratchet below.
  const onlyBytes = manifestTexts && added.length === 0 && renamedAway.length === 0;
  console.error(
    !manifestTexts
      ? `\n❌ ${SCHEMA_MANIFEST_DIR_NAME}/ is missing (${generatedKeys.size} schema(s) unrecorded).`
      : onlyBytes
        ? `\n❌ ${SCHEMA_MANIFEST_DIR_NAME}/ does not match its generated form (the key set is current).`
        : `\n❌ ${SCHEMA_MANIFEST_DIR_NAME}/ is out of date (${added.length} schema(s) not recorded` +
            `${renamedAway.length > 0 ? `, ${renamedAway.length} renamed-away key(s) still listed` : ''}).`,
  );
  for (const key of added.slice(0, 20)) console.error(`     + json-schema/${key}.json`);
  if (added.length > 20) console.error(`     … and ${added.length - 20} more`);
  for (const key of renamedAway) console.error(`     - json-schema/${key}.json  (renamed away)`);
  for (const name of staleManifestShards) {
    console.error(`     ~ ${SCHEMA_MANIFEST_DIR_NAME}/${name}.json  (stale)`);
  }
  for (const name of orphanManifestShards) {
    console.error(`     - ${SCHEMA_MANIFEST_DIR_NAME}/${name}.json  (no schema in this category)`);
  }
  console.error(
    `\n   Run \`pnpm --filter @objectstack/spec gen:schema\` and commit the result. A schema\n` +
    `   absent from the manifest is one this ratchet can never report as disappeared later,\n` +
    `   because it was never in the baseline (#2978).`,
  );
  process.exit(1);
}
if (manifestChanged && !CHECK) {
  const { written, removed } = writeShards(MANIFEST_DIR, canonicalManifestTexts);
  const what = !manifestTexts
    ? `created (${generatedKeys.size} schemas in ${canonicalManifestTexts.size} shard(s))`
    : added.length > 0 || renamedAway.length > 0
      ? `updated (+${added.length} schema(s) across ${written.length} shard(s))`
      : `rewritten (${written.length} shard(s); key set unchanged)`;
  console.log(
    `\n📒 ${SCHEMA_MANIFEST_DIR_NAME}/ ${what} — commit it.` +
      (written.length > 0 ? `\n     touched: ${written.map((n) => `${n}.json`).join(', ')}` : '') +
      (removed.length > 0 ? `\n     removed: ${removed.map((n) => `${n}.json`).join(', ')}` : ''),
  );
}

// ─── Authorable-surface ratchet (#3855 follow-up) ────────────────────
//
// The sibling manifest above ratchets whole SCHEMAS. Nothing ratchets the KEYS
// inside them — and for a metadata-driven platform those keys ARE the
// third-party API: what an author (very often an AI, ADR-0033) may write.
//
// Both existing witnesses look elsewhere. `api-surface/` records exported
// `name (kind)`, and `api-surface-signatures.json` hashes each `defineX`
// factory's type as TypeScript PRINTS it — a reference (`z.input<typeof
// ActionSchema>`), never structurally expanded, so member-level narrowing does
// not reach the hash. `spec-changes.json` inherits the same blind spot: its
// added/removed arrays are a diff of `api-surface/`. So #3883 removed three
// authorable keys with all three witnesses green, and #3733 did the same by
// ACCIDENT — `dataQuality` / `cached` outlived their keys and were silently
// stripped. ADR-0059 §5 deferred this gate "until a narrowing actually slips
// both"; it has, twice.
//
// Three states, distinguishable because a tombstoned key (`retiredKey()`,
// `shared/retired-key.ts`) is `z.never()`, which Zod emits as `{ not: {} }`:
//
//   live     — a normal property. The author may write it.
//   retired  — present but unwritable, carrying its own upgrade prescription.
//   absent   — gone from the contract with nothing left to say. This is the
//              state that must never be reached silently, because none of these
//              schemas is `.strict()`: Zod STRIPS an unknown key, so the setting
//              vanishes and the metadata still parses clean.
const AUTHORABLE_SURFACE_DIR = path.resolve(__dirname, `../${AUTHORABLE_SURFACE_DIR_NAME}`);
// The in-tree anchor the deletion gate falls back to when this build environment
// cannot reach GitHub (#5235). See resolveSurfaceBase() below for the full story.
//
// It stays ONE file while its subject is sharded (#5837), and that is a
// deliberate asymmetry rather than an oversight. The three sharded artifacts are
// rewritten by every spec PR, which is what made them the merge-queue's
// serialization point; this one is written by nothing but a human typing
// `--update-base` (#5358), so it is not on the churn path and sharding it would
// buy no conflict relief. What it WOULD cost is the authenticity criterion:
// `baseRev` is one commit for the whole surface, and a per-shard copy of it
// invites a tree where different shards mirror different revs — a state no
// upstream commit ever had. So the anchor keeps its single `baseRev` + aggregate
// `keys`, and the comparison it feeds reads the baseline commit's shards and
// aggregates them. The criterion is unchanged in both halves: `baseRev` is an
// origin/main ancestor, and its keys ARE that commit's surface.
const AUTHORABLE_SURFACE_BASE_PATH = path.resolve(__dirname, '../authorable-surface.base.json');
/** How the messages below name the sharded surface — a directory, not a file. */
const SURFACE_FILE_NAME = `${AUTHORABLE_SURFACE_DIR_NAME}/`;
const SURFACE_BASE_FILE_NAME = path.basename(AUTHORABLE_SURFACE_BASE_PATH);
// `REANCHOR_COMMAND` — the ONE command that writes this file — is declared near
// the top of this script, next to the `--update-base` flag it names: the merge
// refusal there quotes it, and that refusal runs before anything here (#5370).
const RETIRED_MARK = ' [RETIRED]';

/** The aggregated authorable surface — every shard's keys, as one sorted set. */
interface AuthorableSurface { keys: string[] }

/**
 * The committed mirror of the authorable surface as it stood at an UPSTREAM
 * commit (`baseRev`) — the deletion gate's anchor in a build that cannot reach
 * GitHub (#5235).
 */
interface AuthorableSurfaceBase { description: string; baseRev: string; keys: string[] }

/** `retiredKey()` is `z.never()`, which Zod renders as `{ "not": {} }`. */
function isRetired(prop: unknown): boolean {
  if (!prop || typeof prop !== 'object') return false;
  const not = (prop as Record<string, unknown>).not;
  return !!not && typeof not === 'object' && Object.keys(not).length === 0;
}

/**
 * Every authorable key the ADR-0087 registries declare as tombstoned, by exact
 * `${defKey}:${name}` — carried through declared def renames so an entry
 * written under the old def name still resolves (same discipline as the
 * baseline snapshot below).
 */
function registeredRetiredKeys(): Map<string, number> {
  const out = new Map<string, number>(); // key -> earliest major that registered it
  for (const [major, keys] of Object.entries(RETIRED_KEYS_BY_MAJOR)) {
    for (const key of keys) {
      const carried = carryAuthorableKey(key);
      const prev = out.get(carried);
      if (prev === undefined || Number(major) < prev) out.set(carried, Number(major));
    }
  }
  return out;
}

/** The protocol major this build is: the major any retirement it makes belongs to. */
const CURRENT_MAJOR = Number.parseInt(SPEC_VERSION, 10);

const currentKeys = new Map<string, boolean>(); // key -> isRetired
for (const [defKey, schema] of generatedSchemas) {
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== 'object') continue;
  for (const [name, prop] of Object.entries(props)) {
    currentKeys.set(`${defKey}:${name}`, isRetired(prop));
  }
}
const currentEntries = [...currentKeys.entries()]
  .map(([k, retired]) => (retired ? k + RETIRED_MARK : k))
  .sort();

// The committed surface, aggregated across every shard PRESENT ON DISK — never
// across "the shards this build would write". That distinction is the whole
// reason sharding is semantics-preserving: a deleted shard file drops its keys
// into checks (a)/(c) exactly as deleted lines did (#5837).
let surfaceTexts: Map<string, string> | null = null;
let surfaceDoc: AuthorableSurface | null = null;
try {
  const read = aggregateCategoryShards(AUTHORABLE_SURFACE_DIR, 'keys');
  if (read) {
    surfaceTexts = new Map(read.shards.map((s) => [s.name, s.raw]));
    surfaceDoc = { keys: read.entries };
  }
} catch (error) {
  console.error(`\n❌ Failed to read ${SURFACE_FILE_NAME}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

if (surfaceDoc) {
  const snapshot = new Map<string, boolean>(
    surfaceDoc.keys.map((e) => [e.replace(RETIRED_MARK, ''), e.endsWith(RETIRED_MARK)]),
  );

  // Carry the snapshot through any declared def rename FIRST, so every check
  // below compares like with like. A rename moves keys between defs; it must
  // never be able to drop one, and it must never launder a retirement past
  // check (b) either — which is why the carried key keeps the OLD key's
  // retired state. See scripts/lib/renamed-defs.ts (#4684).
  const prev = new Map<string, boolean>();
  const carriedFrom = new Map<string, string>(); // new key -> old key
  for (const [key, retired] of snapshot) {
    const carried = carryAuthorableKey(key);
    if (carried !== key) carriedFrom.set(carried, key);
    prev.set(carried, retired);
  }

  // (a0) A declared rename that did not carry one of its keys. Reported apart
  //      from (a) because the remedy is the opposite one: the key did not leave
  //      the contract by accident of a deletion, it failed to arrive under the
  //      new def — restore it there, or stop calling this a rename.
  const notCarried = [...carriedFrom.entries()].filter(([to]) => !currentKeys.has(to));
  if (notCarried.length > 0) {
    console.error(
      `\n❌ ${notCarried.length} authorable key(s) were lost by a declared def rename:`,
    );
    for (const [to, from] of notCarried) console.error(`     - ${from}  →  ${to}  (absent)`);
    console.error(
      `\n   RENAMED_DEFS (scripts/lib/renamed-defs.ts) declares that these defs were renamed,\n` +
      `   and a rename must carry EVERY key: the author-facing contract is unchanged, only\n` +
      `   an internal schema name moved. A key missing under the new name is a real removal\n` +
      `   wearing a rename's clothes — and these schemas are NOT .strict(), so Zod would\n` +
      `   silently strip whatever the author kept writing (#3733, ADR-0104).\n\n` +
      `   Either re-add the key under the new def, or — if it is genuinely being retired —\n` +
      `   tombstone it there with \`retiredKey()\` plus its registered D2 conversion, exactly\n` +
      `   as a retirement without a rename would require.`,
    );
    process.exit(1);
  }

  // (a) A key that vanished outright. The silent-strip class — always fatal.
  const vanished = [...prev.keys()].filter((k) => !currentKeys.has(k));
  if (vanished.length > 0) {
    console.error(`\n❌ ${vanished.length} authorable key(s) disappeared from the contract:`);
    for (const k of vanished) console.error(`     - ${k}`);
    console.error(
      `\n   These schemas are NOT .strict(), so Zod silently STRIPS an unknown key: an author\n` +
      `   who keeps writing one gets a clean parse and a setting that never takes effect —\n` +
      `   no error, nothing to grep, nothing pointing at the changelog (#3733, ADR-0104).\n\n` +
      `   To retire a key, tombstone it instead of deleting it:\n` +
      `     1. \`retiredKey('<key> was removed in ... — use <replacement>. ...')\` in the schema\n` +
      `        (or an UNKNOWN_KEY_GUIDANCE entry for an object top-level key), so the\n` +
      `        rejection carries the fix;\n` +
      `     2. a D2 conversion (and D3 chain step) so the rename reaches spec-changes.json\n` +
      `        and \`os migrate meta\` can rewrite consumer sources;\n` +
      `     3. a \`major\` changeset carrying the FROM → TO mapping.\n\n` +
      `   A tombstone that has aged out (~two majors) is the ONE legitimate reason to delete\n` +
      `   a line here — do it in the same PR, deliberately.`,
    );
    process.exit(1);
  }

  // (b) live → retired: a removal. It must be registered, or the change never
  //     reaches the upgrade guide / `spec_changes` / `migrate meta`.
  //
  //     Registration means EXACT set membership in RETIRED_KEYS_BY_MAJOR
  //     (src/migrations/registry.ts) — the literal `${defKey}:${name}`. Until
  //     #4659 this check matched the key's LEAF against every conversion
  //     `surface` in the ADR-0087 registries (`endsWith('.' + name)`, all
  //     majors, def ignored), so any unrelated registration ending in the same
  //     leaf registered a tombstone for free: #4658 measured
  //     `automation/Event:type` passing silently on protocol 11's
  //     `flow.node.type`, and #5509 widened the vocabulary to `.description`.
  //     A conversion `surface` is prose addressed to authors
  //     (`flow.nodes[].outputSchema`) and cannot be mapped back onto a def key,
  //     so the machine fact moved to its own table instead of being encoded
  //     into the prose. The conversion is still the PRESCRIPTION consumers
  //     follow — the message below asks for both.
  const registeredRetired = registeredRetiredKeys();
  const newlyRetired = [...currentKeys.entries()]
    .filter(([k, retired]) => retired && prev.get(k) === false)
    .map(([k]) => k);
  if (newlyRetired.length > 0) {
    const unregistered = newlyRetired.filter((k) => !registeredRetired.has(k));
    if (unregistered.length > 0) {
      console.error(`\n❌ ${unregistered.length} key(s) were tombstoned with no registered retirement:`);
      for (const k of unregistered) console.error(`     - ${k}`);
      console.error(
        `\n   The tombstone makes the removal audible to whoever hits it, but the change\n` +
        `   documentation is the primary channel and it is still empty: spec-changes.json\n` +
        `   (ADR-0087 D4) is a projection of the conversion + migration registries, and the\n` +
        `   generated upgrade guide and the \`spec_changes\` MCP tool are projections of that.\n` +
        `   Without an entry a consumer only learns of this by failing.\n\n` +
        `   1. Declare each retirement by its EXACT key in RETIRED_KEYS_BY_MAJOR\n` +
        `      (packages/spec/src/migrations/registry.ts) — copy these lines in:\n\n` +
        unregistered.map((k) => `        '${k}',\n`).join('') +
        `\n      under \`${CURRENT_MAJOR}: [ … ]\` (create the major's array if it is the first).\n` +
        `      Nothing is inferred here: a leaf name matched against unrelated conversion\n` +
        `      surfaces is what let tombstones register themselves by coincidence (#4659).\n\n` +
        `   2. Add a D2 conversion in src/conversions/registry.ts naming the surface (and a D3\n` +
        `      chain step referencing it) so \`os migrate meta\` rewrites their source.`,
      );
      process.exit(1);
    }
  }

  // (b2) The other direction: an entry that registers a key this build still
  //      emits as LIVE. Nothing consumed that registration — it pre-approves a
  //      retirement that has not happened, and check (b) would then wave the
  //      real one through without anyone writing it down. An entry naming a key
  //      the build no longer emits at all is NOT an error: that is the expected
  //      steady state once a tombstone ages out and check (c) lets its baseline
  //      line go (see RETIRED_KEYS_BY_MAJOR's "Lifecycle").
  const liveButRegistered = [...registeredRetired.entries()].filter(
    ([k]) => currentKeys.get(k) === false,
  );
  if (liveButRegistered.length > 0) {
    console.error(
      `\n❌ ${liveButRegistered.length} RETIRED_KEYS_BY_MAJOR entr(ies) name a key that is still LIVE:`,
    );
    for (const [k, major] of liveButRegistered) console.error(`     - ${k}  (registered at major ${major})`);
    console.error(
      `\n   RETIRED_KEYS_BY_MAJOR records keys that ARE tombstoned — \`retiredKey()\`, which Zod\n` +
      `   emits as \`{ "not": {} }\`. These are still writable, so the entry registers a\n` +
      `   retirement nobody performed, and check (b) above would accept the real tombstone\n` +
      `   later without it ever being declared.\n\n` +
      `   Either tombstone the key in its schema (\`retiredKey('<key> was removed in … — use\n` +
      `   <replacement>. …')\`), or delete the entry from\n` +
      `   packages/spec/src/migrations/registry.ts.`,
    );
    process.exit(1);
  }
}

// ─── (c) A deleted baseline line must prove itself (#4650) ─────────────
//
// Checks (a0)/(a)/(b) read authorable-surface/ from THIS commit — files
// the same commit can freely edit. Deleting a baseline line therefore deleted
// the very evidence check (a) runs on: #4638 and #4643 both removed authorable
// keys with zero registered conversions and a green gate, and #4662 later
// proved the file had been hand-edited. So deletions are ratcheted here
// against a baseline the PR cannot rewrite: the file at the merge base with
// origin/main. (Comparing against `HEAD:` would be vacuous exactly where it
// matters — in CI, HEAD IS the PR's own commit, so both sides always match
// and the check never fires.)
//
// A deletion is legitimate on exactly one of three proofs, each computed
// inside this gate — never argued in a PR description:
//
//   1. aged-out tombstone — the base entry carried `[RETIRED]` AND its EXACT
//      `${defKey}:${name}` is declared in RETIRED_KEYS_BY_MAJOR at a major
//      ≥ TOMBSTONE_AGE_MAJORS behind the current one (the "~two majors" this
//      file's description has always promised, now enforced). Since #5898 this
//      reads the same exact-key table check (b) reads, not a leaf-name match
//      against the conversion registry — see TOMBSTONE_AGE_MAJORS below for the
//      two false positives that matching produced and why the 97 pre-existing
//      tombstones are left undeclared (and therefore undeletable) rather than
//      backfilled from a source that cannot date them;
//   2. the def is not reachable from the metadata-type roots (2026-08-02
//      ruling on #4650): no metadata document is ever parsed by it, so its
//      entry was over-collection and there is no author to tombstone for.
//      This waives ONLY this file's tombstone requirement — it is NOT a
//      license to change the schema (plugin manifests, connector configs and
//      other non-metadata authoring go through their own gates);
//   3. the whole def is no longer emitted — whole-schema removals are
//      adjudicated by the json-schema.manifest/ ratchet (#2978), not by
//      this per-key ratchet. Until #4725 that deferral was to nothing: the
//      ratchet's `missing` set was computed from the same-commit manifest, so
//      deleting the line deleted the evidence, exactly as hand-editing this
//      file did before #4650. The manifest deletion gate below now anchors that
//      comparison on the merge base and demands a declared removal, and it runs
//      BEFORE this check so the deferral resolves to a real verdict.

/** A tombstone may be deleted once its registration is this many majors old. */
const TOMBSTONE_AGE_MAJORS = 2;

// The aging clock reads RETIRED_KEYS_BY_MAJOR — `registeredRetiredKeys()` above,
// the same exact-key map check (b) reads. There is no leaf-name matching left in
// this file (#5898).
//
// Until #5898 check (c) dated a tombstone by matching the key's LEAF against
// every ' / ' clause of every major in CONVERSIONS_BY_MAJOR / MIGRATIONS_BY_MAJOR
// and taking `Math.min` — structurally the matcher #4659 had just removed from
// check (b), and permissive in both of its halves: an unrelated clause ending in
// the same leaf proved "this was registered at all", and `Math.min` then started
// the clock at the EARLIEST such coincidence. Both of the two rows it let through
// on the real baseline were false positives, by two different mechanisms:
//
//   - `data/Index:type` (#5898's specimen) matched protocol 11's
//     `flow.node.type` — a flow node's type, nothing to do with index types — so
//     its clock started at 11 while its own honest clause `object.indexes[].type`
//     is major 17. At major 17 the row was deletable one major after its
//     retirement became visible.
//   - `api/RestApiConfig:requireAuth` matched protocol 12's `api.requireAuth`,
//     which is `rest-requireauth-default-flip`: a secure-DEFAULT flip whose own
//     step says "No metadata shape changed". Its retirement is the protocol 17
//     conversion `stack.api.requireAuth` (#3963). The clock was started from a
//     different KIND of change to the same surface.
//
// Why the historical mapping is not backfilled, and what happens instead: a
// tombstone with no entry in RETIRED_KEYS_BY_MAJOR cannot prove its age, so its
// baseline line stays. That is fail-closed by construction rather than by
// estimate — see the table's "Historical tombstones" section for why neither
// available source could date the 97 pre-existing rows honestly (leaf-matching
// the conversion registry is the very inference #4659 removed; this file's own
// git history begins at 17.0.0-rc.0, so it dates every one of them at major 17
// — an artifact of the baseline's birth, not archaeology). Deleting one of those
// lines is therefore a deliberate, reviewable act: declare its exact key under
// its true major in the table, and check (b2) verifies the entry still names a
// key this build tombstones.

interface SurfaceReachability {
  /** The metadata-type roots the BFS started from. */
  rootTypes: string[];
  /** How a def is reachable, or null when it is not. */
  reachableVia(defKey: string): 'root-graph' | 'derived-clone' | null;
}

/**
 * Reachability of every emitted def from the metadata-type roots —
 * BUILTIN_METADATA_TYPE_SCHEMAS plus the EXTRA_METADATA_TYPE_SCHEMAS overlay
 * (both behind listMetadataTypeSchemaTypes / getMetadataTypeSchema), i.e. the
 * schemas a metadata document is actually parsed against. Computed by BFS over
 * THIS build's in-memory Zod graph, per the 2026-08-02 ruling on #4650 — a
 * static import/regex approximation misses alias imports, runtime
 * registration and casts, so it is deliberately not used here.
 *
 * 'root-graph': the def's own instance is in the BFS closure.
 * 'derived-clone': the closure holds a derived copy of it — `.extend()` /
 * `.strip()` clones share no identity with (and no `_zod.parent` link to) the
 * original, but they DO share its per-property schema instances, so a def
 * whose shape entry (same name, same instance) appears in any visited object
 * node is authorable through that clone. Judged conservatively: one shared
 * entry marks the whole def reachable — a false "reachable" demands a
 * tombstone too many, a false "unreachable" would waive one silently.
 */
function computeSurfaceReachability(): SurfaceReachability {
  const rootTypes: string[] = [];
  const roots: z.ZodType[] = [];
  for (const type of listMetadataTypeSchemaTypes()) {
    const schema = getMetadataTypeSchema(type);
    if (schema) {
      rootTypes.push(type);
      roots.push(schema);
    }
  }
  const visited = new Set<z.ZodType>();
  const queue = [...roots];
  while (queue.length > 0) {
    const node = queue.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const child of zodChildSchemas(node)) queue.push(child);
  }
  // (propName → propSchemaInstance) pairs of every visited object node — the
  // bridge that recognises derived clones of a def the closure never names.
  const bridged = new Map<unknown, Set<string>>();
  for (const node of visited) {
    const shape = zodShapeOf(node);
    if (!shape) continue;
    for (const [name, prop] of Object.entries(shape)) {
      if (!(prop instanceof z.ZodType)) continue;
      let names = bridged.get(prop);
      if (!names) {
        names = new Set<string>();
        bridged.set(prop, names);
      }
      names.add(name);
    }
  }
  return {
    rootTypes,
    reachableVia(defKey: string): 'root-graph' | 'derived-clone' | null {
      const schema = zodByDefKey.get(defKey);
      if (!schema) return null;
      if (visited.has(schema)) return 'root-graph';
      const shape = zodShapeOf(schema);
      if (!shape) {
        // Emitted with authorable keys but no derivable object shape: nothing
        // to bridge on, so fail closed — demand the tombstone route rather
        // than silently widening the exception.
        //
        // #5317 narrowed WHO lands here rather than changing what happens once
        // you do. Until then `zodShapeOf` read a `z.preprocess` node's IN side —
        // the transform — so every preprocess node arrived shapeless and got
        // this answer by accident rather than by measurement. One def actually
        // did: `ui/InlineAction` (a `z.preprocess` with an object OUT) read
        // 'root-graph' here, while its sole holder `ui/ElementButtonProps` — and
        // its eight `ui/Element*Props` siblings — already read null. With the
        // direction corrected it resolves its real 12-key shape, finds no bridge,
        // and answers null like the rest of that family. Fail-closed is still the
        // rule; it is just no longer the walker's default report.
        return 'root-graph';
      }
      for (const [name, prop] of Object.entries(shape)) {
        if (prop instanceof z.ZodType && bridged.get(prop)?.has(name)) return 'derived-clone';
      }
      return null;
    },
  };
}

/**
 * ⚠️ Every byte of this string is part of the anchor file's canonical form —
 * `readCommittedSurfaceBase` compares the committed file against
 * `serializeSurfaceBase()` and treats any difference as a hand-edit, fatally.
 * So changing this text is not a comment edit: it invalidates the committed
 * anchor in every checkout until someone re-anchors, which is itself the
 * deliberate act #5358 made explicit. It is therefore left verbatim here, and
 * "Written only by `gen:schema`" now UNDER-states the rule rather than
 * contradicting it: the writer is still this generator (`scripts/build-schemas.ts`),
 * but only in its `--update-base` mode (`gen:authorable-surface-base`), never on a
 * plain build. Narrowing in the safe direction. Whoever next re-anchors should
 * bring the sentence with them, in that same reviewed diff.
 */
const SURFACE_BASE_DESCRIPTION =
  'In-tree anchor for the authorable-surface deletion gate (#4650, #5235): a verbatim copy of the ' +
  'keys in authorable-surface/ as they stood at `baseRev`, a commit on origin/main. A build that ' +
  'CAN reach origin/main anchors on the merge base instead, and re-verifies this file against ' +
  '`baseRev` — so a PR that edits it to hide a deletion goes red wherever the network exists. A build ' +
  'that CANNOT reach GitHub (image-build stages, air-gapped, fork, historical-tag reproduction) ' +
  'anchors here instead of failing. Written only by `gen:schema`, only from a git-resolved baseline — ' +
  'never from the build that is being checked. See #5235.';

/** Canonical bytes of the in-tree anchor — the one form the generator writes. */
function serializeSurfaceBase(baseRev: string, keys: string[]): string {
  const doc: AuthorableSurfaceBase = { description: SURFACE_BASE_DESCRIPTION, baseRev, keys };
  return serializeShard(doc);
}

/**
 * The authorable surface at an upstream revision, from whichever layout that
 * revision carried (#5837).
 *
 * Every caller below is a gate reading a baseline out of GIT — an already-merged
 * commit, immutable by construction. Revisions from before the sharding
 * migration hold the single `authorable-surface.json`; they always will, and no
 * producer exists that could be fixed instead. The tree's OWN surface is read by
 * `aggregateCategoryShards`, which knows the sharded layout and nothing else, so
 * this is not a tolerant read of anything a PR can write.
 *
 * `context` names the gate in the failure so a baseline problem does not read as
 * a problem with the commit under test.
 */
function readSurfaceKeysAtRev(
  git: GitRun,
  rev: string,
  dirName: string,
  // `ShardArrayField`, not a re-spelled copy of it. This parameter used to read
  // `'keys' | 'schemas'` — a hand-written narrowing of the exported union that
  // `readShardedKeysAtRev` below actually takes. When #4666 added `'defaults'`
  // to `ShardArrayField` and a call site passing it, the copy here was left
  // behind and no type checker existed to say so (#5475). Harmless at runtime,
  // since the value is only forwarded, but it is the drift this program is for.
  field: ShardArrayField,
  context: string,
): { entries: string[] } | null {
  const read = readShardedKeysAtRev(git, rev, dirName, field);
  if (read === null) return null;
  if ('error' in read) {
    console.error(`\n❌ ${context}: ${read.error}`);
    process.exit(1);
  }
  if (read.layout === 'legacy') {
    console.log(
      `ℹ️  ${context}: ${rev.slice(0, 12)} predates the ${dirName}/ split, so its baseline was read\n` +
        `   from the retired single file. Same keys, same verdict (#5837).`,
    );
  }
  return { entries: read.entries };
}

/**
 * The committed in-tree anchor, or null when the file is absent.
 *
 * Malformed or non-canonical bytes are fatal in BOTH modes, deliberately: this
 * file exists to be the baseline a commit cannot rewrite, so a hand-edit here is
 * the #4650 attack itself, not a formatting slip to repair silently (#4662 made
 * the same call for the authorable surface). Regenerating it needs origin/main,
 * which is exactly the environment where that hand-edit is also detectable.
 */
function readCommittedSurfaceBase(): { raw: string; doc: AuthorableSurfaceBase } | null {
  if (!fs.existsSync(AUTHORABLE_SURFACE_BASE_PATH)) return null;
  const raw = fs.readFileSync(AUTHORABLE_SURFACE_BASE_PATH, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`\n❌ ${SURFACE_BASE_FILE_NAME} is not valid JSON (#5235): ${error}`);
    process.exit(1);
  }
  const doc = parsed as AuthorableSurfaceBase;
  if (!/^[0-9a-f]{40}$/.test(doc?.baseRev ?? '') || !Array.isArray(doc?.keys)) {
    console.error(
      `\n❌ ${SURFACE_BASE_FILE_NAME} is malformed (#5235): it must carry a 40-hex \`baseRev\` and a\n` +
        `   \`keys\` array — the ${SURFACE_FILE_NAME} content at that commit.\n\n` +
        `   Restore it (\`git checkout -- packages/spec/${SURFACE_BASE_FILE_NAME}\`), or delete it and\n` +
        `   run \`${REANCHOR_COMMAND}\` in a checkout that can reach origin/main.`,
    );
    process.exit(1);
  }
  if (raw !== serializeSurfaceBase(doc.baseRev, doc.keys)) {
    console.error(
      `\n❌ ${SURFACE_BASE_FILE_NAME} does not match its generated form (#5235).\n\n` +
        `   This file is the deletion gate's anchor — the baseline a commit is not supposed to be\n` +
        `   able to rewrite. Every byte in it must come from the generator, so a hand-edit is fatal\n` +
        `   here rather than repaired (the same call #4662 made for ${SURFACE_FILE_NAME}).\n\n` +
        `   Restore it (\`git checkout -- packages/spec/${SURFACE_BASE_FILE_NAME}\`), or delete it and\n` +
        `   run \`${REANCHOR_COMMAND}\` in a checkout that can reach origin/main.`,
    );
    process.exit(1);
  }
  return { raw, doc };
}

/**
 * Git, run in the package directory — the one runner every check below shares
 * (`resolveSurfaceBase()` used to hold a private copy of it; the anchor's
 * monotonicity guard needs the same one, at a different point in the script).
 */
const gitInPackage: GitRun = (...args: string[]) =>
  // A network-less environment that BLACKHOLES rather than refuses (proxied
  // air gaps do) would otherwise hang the whole build in the self-heal fetch.
  spawnSync('git', args, {
    cwd: PKG_DIR,
    encoding: 'utf-8' as const,
    timeout: 60_000,
  });

/**
 * Make one commit READABLE in this checkout, fetching it when the tree does not
 * hold it yet (#5235, factored out for #6452's second caller).
 *
 * `--depth=1` is the whole point rather than a compromise: the commit is wanted
 * for its TREE — the shards under it — never for a walk, and every consumer here
 * already treats a truncated walk as "no answer" rather than as a verdict. A
 * deeper fetch would be a bounded workaround for the truncation instead of a read
 * of the one commit the gate names, which #6452 rejected in as many words ("把
 * 「永远走不通」换成「偶尔走不通」,更难诊断").
 *
 * False means neither the checkout nor the remote can produce it: an offline
 * container, or a rev nothing upstream advertises. Callers decide what that
 * costs them; none of them may treat it as a pass.
 */
function ensureCommitPresent(git: GitRun, rev: string): boolean {
  if (git('cat-file', '-e', `${rev}^{commit}`).status === 0) return true;
  // Shallow checkout (CI's typecheck job): ask the remote for that one commit.
  git('fetch', '--quiet', '--depth=1', 'origin', rev);
  return git('cat-file', '-e', `${rev}^{commit}`).status === 0;
}

/**
 * The in-tree anchor must be an authentic copy of an UPSTREAM commit's baseline,
 * and this is the environment that can prove it (#5235).
 *
 * Two facts, both checked against origin/main rather than against anything the
 * commit under test controls:
 *
 *   1. `baseRev` is an ancestor of origin/main — a PR cannot point it at one of
 *      its own commits, because its own commits are not upstream. Decidable only
 *      where history is walkable, so a shallow checkout says so and skips it;
 *   2. the recorded keys ARE that commit's authorable-surface keys, aggregated
 *      across its shards. This
 *      one holds everywhere the object can be read, shallow included.
 *
 * Together those make hand-editing the anchor pointless: the only way to shed a
 * line from it is to shed the line from an already-merged upstream commit, which
 * a PR cannot do. A shallow clone may not hold the object at all; the run then
 * says so and continues, because in that environment the merge-base anchor — not
 * this file — is what the deletion check ran on anyway.
 */
function verifyCommittedSurfaceBase(
  git: GitRun,
  tip: string,
  resolved: { rev: string; keys: string[] },
  committed: AuthorableSurfaceBase,
): void {
  const rev = committed.baseRev;
  const short = rev.slice(0, 12);
  const fix =
    `   Run \`${REANCHOR_COMMAND}\` and commit the result — that mode writes\n` +
    `   this file from the git-resolved baseline, which is the only thing it may come from.`;

  // Fast path, and the common one right after a refresh: the anchor names the
  // very rev this run resolved out of git, so the baseline to compare against is
  // already in hand — no object lookup, and no ancestry question either.
  //
  // What makes it sound is a property of `resolved`, not of the equality: those
  // keys were READ OUT OF GIT at that rev, never out of this file. Every producer
  // of a `SurfaceBaseResolution.gitAnchor` goes through `readSurfaceKeysAtRev`,
  // including the shallow re-anchor added by #6452 — which is the one caller that
  // can make `rev === resolved.rev` true by CONSTRUCTION rather than by
  // coincidence, and would therefore be exactly where a file-validating-file
  // comparison could hide. Keeping the keys git-sourced is what stops it; the pin
  // is behavioural (a key shed from this file is still caught under `.git/shallow`
  // — see build-schemas-check-mode.test.ts) rather than a comment asserting it.
  //
  // The ancestry half is not skipped by that caller either: it establishes the
  // rev is upstream BEFORE handing it over — see `resolveBaselineWithoutMergeBase`.
  if (rev === resolved.rev) {
    compareAnchorKeys(resolved.keys, committed, short, fix);
    return;
  }

  if (!ensureCommitPresent(git, rev)) {
    console.log(
      `ℹ️  ${SURFACE_BASE_FILE_NAME}: commit ${short} is not in this checkout and could not be\n` +
        `   fetched, so its authenticity is unverifiable here. This run anchored on the merge base\n` +
        `   regardless (#5235).`,
    );
    return;
  }
  // Ancestry is only decidable where history is WALKABLE. CI checks out shallow
  // (depth 1) and the fetch above grafts `rev` as its own shallow root, so
  // `merge-base --is-ancestor` answers "not an ancestor" for a commit that
  // demonstrably is one — the same truncation the merge-base fallback above
  // already accounts for, and it fails the whole build if trusted (caught on this
  // change's own first CI run). Ask whether the answer can mean anything first —
  // through `probeAncestry`, the ONE reading of those exit codes this file has
  // (#5370/#5847). It used to be open-coded here, which also meant git DECLINING
  // to answer (exit 128, the cloud#1116 trap) was read as a verdict of "not an
  // ancestor" and failed the build; the shared reading tells the two apart.
  const ancestry = probeAncestry(git, rev, tip);
  if (ancestry.answer === 'unknown') {
    console.log(
      ancestry.reason === 'shallow'
        ? `ℹ️  ${SURFACE_BASE_FILE_NAME}: shallow checkout — cannot walk history to confirm ${short} is\n` +
            `   on origin/main, so only its recorded keys are verified here (#5235). A full clone checks both.`
        : `ℹ️  ${SURFACE_BASE_FILE_NAME}: \`git merge-base --is-ancestor\` did not answer about ${short}\n` +
            `   (exit ${ancestry.status}): ${ancestry.stderr} — so only its recorded keys are verified here (#5235).`,
    );
  } else if (ancestry.answer === 'no') {
    console.error(
      `\n❌ ${SURFACE_BASE_FILE_NAME} names a baseRev (${short}) that is NOT an ancestor of\n` +
        `   origin/main (#5235).\n\n` +
        `   The anchor for the #4650 deletion gate has to be a baseline this commit cannot rewrite,\n` +
        `   so it may only mirror an already-merged upstream commit. A rev off origin/main is either\n` +
        `   a local commit (which the PR does control) or a rewritten history.\n\n${fix}`,
    );
    process.exit(1);
  }
  const upstream = readSurfaceKeysAtRev(
    git,
    rev,
    AUTHORABLE_SURFACE_DIR_NAME,
    'keys',
    `${SURFACE_BASE_FILE_NAME} anchor verification (#5235)`,
  );
  if (!upstream) {
    console.error(
      `\n❌ ${SURFACE_BASE_FILE_NAME} names baseRev ${short}, which has no ${SURFACE_FILE_NAME}\n` +
        `   to mirror (#5235).\n${fix}`,
    );
    process.exit(1);
  }
  compareAnchorKeys(upstream.entries, committed, short, fix);
}

/** The anchor's keys must BE the upstream baseline it names — in both directions. */
function compareAnchorKeys(
  upstreamKeys: string[],
  committed: AuthorableSurfaceBase,
  short: string,
  fix: string,
): void {
  const recorded = new Set(committed.keys);
  const upstream = new Set(upstreamKeys);
  const shed = upstreamKeys.filter((k) => !recorded.has(k));
  const invented = committed.keys.filter((k) => !upstream.has(k));
  if (shed.length === 0 && invented.length === 0) return;
  console.error(
    `\n❌ ${SURFACE_BASE_FILE_NAME} is not the baseline it claims to be (#4650, #5235):\n` +
      `   it says it mirrors ${SURFACE_FILE_NAME} at ${short}, but ${shed.length} line(s) are missing\n` +
      `   from it and ${invented.length} line(s) are not in that commit at all.`,
  );
  for (const k of shed.slice(0, 10)) console.error(`     - ${k}  (at ${short}, absent here)`);
  for (const k of invented.slice(0, 10)) console.error(`     + ${k}  (here, absent at ${short})`);
  if (shed.length + invented.length > 20) console.error(`     … and ${shed.length + invented.length - 20} more`);
  console.error(
    `\n   A build that cannot reach GitHub anchors the deletion gate on this file, so shedding a\n` +
      `   line here is the #4650 bypass moved one file over. It is caught in every environment that\n` +
      `   CAN reach origin/main, which is every dev checkout and every CI run.\n\n${fix}`,
  );
  process.exit(1);
}

/**
 * `merge-base --is-ancestor`, read as the THREE answers it gives (#5370).
 *
 * Extracted so the two places that need this direction — the re-anchor guard
 * below and the drift notice further down (#5847) — decide it ONCE, with one
 * reading of the exit codes. Two independent determinations of one direction is
 * how the two answers drift apart later, and this file already paid for the
 * drift: the notice used to infer direction from a key subtraction and printed
 * the opposite of what the guard said about the very same pair of revs.
 *
 * 0 is "ancestor", 1 is "not an ancestor", and anything else (128 with a
 * `fatal:`, or `null` from the timeout) is git declining to answer. Folded into
 * a `&&`/`||` chain the third collapses into the second and an ERROR becomes a
 * verdict — the trap cloud#1116 paid for.
 *
 * Shallow history makes a FOURTH reading necessary, and it is asymmetric. A
 * truncated walk can only ever LOSE reachability, never invent it, so exit 0 is
 * proof wherever it appears — while exit 1 in a shallow checkout means nothing at
 * all (#5358's own first CI run was failed by exactly that answer, about a commit
 * that plainly was an ancestor; the same false 1 is reproducible today in any
 * agent container, where the anchor's `baseRev` sits in `.git/shallow` as its own
 * grafted root). So shallowness is consulted only to decide whether a NEGATIVE
 * counts — never to discard a positive, which would refuse re-anchors that are
 * demonstrably fine.
 *
 * What each caller DOES with `unknown` is the caller's own disposition, and the
 * two differ on purpose: the guard fails closed (refuses the write), the notice
 * simply declines to name a direction. Neither may turn it into a verdict.
 */
type Ancestry =
  | { answer: 'yes' }
  | { answer: 'no' }
  | { answer: 'unknown'; reason: 'git-declined'; status: number | null; stderr: string }
  | { answer: 'unknown'; reason: 'shallow' };

function probeAncestry(git: GitRun, ancestor: string, descendant: string): Ancestry {
  const probe = git('merge-base', '--is-ancestor', ancestor, descendant);
  // Reachability was demonstrated. Truncation cannot fake that, so this is the
  // one answer that stands in every checkout, shallow included.
  if (probe.status === 0) return { answer: 'yes' };
  if (probe.status !== 1) {
    return {
      answer: 'unknown',
      reason: 'git-declined',
      status: probe.status,
      stderr: (probe.stderr || '').trim().split('\n')[0] || '(no output)',
    };
  }
  // A negative, on the other hand, is only meaningful where history is WALKABLE —
  // the same truncation `verifyCommittedSurfaceBase` accounts for. There it SKIPS
  // a verification, which is safe; for the guard below it would BLESS a write,
  // which is not, and for the notice it would print a direction backwards.
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    return { answer: 'unknown', reason: 'shallow' };
  }
  return { answer: 'no' };
}

/**
 * Where the committed anchor sits relative to the baseline THIS build resolved
 * (#5847) — the question the drift notice has to answer before it can word
 * itself, decided on `probeAncestry` above rather than on a key subtraction.
 *
 * `unordered` is not a failure and not a fallback: it is the honest answer in a
 * shallow checkout (CI's own typecheck job is one), when git declines, and in
 * the genuinely unordered case where two authentic origin/main ancestors sit on
 * different branches of a merge. Naming a direction there would be exactly the
 * defect this exists to remove, one state over.
 */
type AnchorRelation = { kind: 'behind' } | { kind: 'ahead' } | { kind: 'unordered'; why: string };

function relateAnchorToBaseline(git: GitRun, committedRev: string, resolvedRev: string): AnchorRelation {
  const forward = probeAncestry(git, committedRev, resolvedRev);
  if (forward.answer === 'yes') return { kind: 'behind' };
  const backward = probeAncestry(git, resolvedRev, committedRev);
  if (backward.answer === 'yes') return { kind: 'ahead' };
  // Only a definitive negative BOTH ways is a real fork; anything else is an
  // answer nobody has, and the two are told apart because their remedies differ.
  const unusable = forward.answer === 'unknown' ? forward : backward.answer === 'unknown' ? backward : null;
  if (!unusable) {
    return {
      kind: 'unordered',
      why: 'neither commit is an ancestor of the other — they sit on different branches of a merge',
    };
  }
  return {
    kind: 'unordered',
    why:
      unusable.reason === 'shallow'
        ? 'shallow checkout — a "not an ancestor" answer is not usable about a truncated history'
        : `\`git merge-base --is-ancestor\` did not answer (exit ${unusable.status}): ${unusable.stderr}`,
  };
}

/**
 * The anchor moves FORWARD, or it does not move (#5370).
 *
 * Called immediately before the only write, so a re-anchor may replace `baseRev`
 * only with a commit the committed `baseRev` is an ancestor of. Everything the
 * gate normally proves is *about a single rev* — that it is on origin/main and
 * that its keys are that commit's surface — and a rev the branch merely forked
 * from earlier passes both. So a backwards move is invisible to every other
 * check: `verifyCommittedSurfaceBase` is green before and after, and so is
 * `check:authorable-surface`. The loss is real anyway. The anchor main advanced
 * is replaced by an older one, so a retirement main had already anchored past
 * comes back, the deletion gate stops seeing it, and the offline consumers of
 * #5235 get a baseline older than the published one.
 *
 * The three-plus-one readings of `merge-base --is-ancestor` live in
 * `probeAncestry` above, shared with the drift notice (#5847). What is decided
 * HERE is the disposition on `unknown`, and it is to fail CLOSED: an ancestry
 * nobody could establish refuses the write rather than defaulting to one of the
 * two answers.
 */
function assertAnchorMovesForward(git: GitRun, committedRev: string, resolvedRev: string): void {
  if (committedRev === resolvedRev) return;
  const from = committedRev.slice(0, 12);
  const to = resolvedRev.slice(0, 12);
  const refuseIndeterminate = (why: string): never => {
    console.error(
      `\n❌ --update-base cannot establish which way ${SURFACE_BASE_FILE_NAME} would move (#5370).\n\n` +
        `   committed baseRev: ${from}\n` +
        `   resolved baseline: ${to}   (merge base of HEAD with origin/main)\n\n` +
        `   ${why}\n\n` +
        `   The anchor may only ever move forward, so an ancestry that could not be established\n` +
        `   refuses the write instead of defaulting to one of the two answers. Re-anchor from a\n` +
        `   checkout with walkable history (\`git fetch --unshallow origin\`, or a full clone) and\n` +
        `   run \`${REANCHOR_COMMAND}\` there.`,
    );
    process.exit(1);
  };

  const probe = probeAncestry(git, committedRev, resolvedRev);
  if (probe.answer === 'yes') return;
  if (probe.answer === 'unknown') {
    return refuseIndeterminate(
      probe.reason === 'git-declined'
        ? `\`git merge-base --is-ancestor ${from} ${to}\` did not answer (exit ${probe.status}):\n` +
            `   ${probe.stderr}`
        : 'This is a shallow checkout: history is truncated, so `merge-base --is-ancestor` reports\n' +
            `   "not an ancestor" about commits that plainly are one — ${from} is very likely one of\n` +
            '   them (a `--depth=1` fetch grafts it in as its own root, unreachable from origin/main).',
    );
  }
  console.error(
    `\n❌ --update-base would move ${SURFACE_BASE_FILE_NAME} BACKWARDS (#5370).\n\n` +
      `   committed baseRev: ${from}\n` +
      `   resolved baseline: ${to}   (merge base of HEAD with origin/main)\n\n` +
      `   ${to} is not a descendant of ${from}, so re-anchoring here would replace an anchor main\n` +
      `   has already advanced with an older one. Both are authentic — ${to} is a real origin/main\n` +
      `   ancestor and its keys are that commit's surface verbatim — which is exactly why no other\n` +
      `   gate objects: this file's authenticity check passes, check:authorable-surface passes, and\n` +
      `   the only trace left is a reverse baseRev move in the diff, indistinguishable at a glance\n` +
      `   from the #4650 attack shape. What it silently drops is whatever main anchored past in\n` +
      `   between, a retirement included.\n\n` +
      `   HEAD's merge base with origin/main is behind the committed anchor. Bring HEAD up to date\n` +
      `   and COMMIT that first — \`git fetch origin main\` then merge or rebase — and re-anchor on\n` +
      `   the result: \`${REANCHOR_COMMAND}\`.`,
  );
  process.exit(1);
}

/**
 * The `baseRev` ORIGIN/MAIN itself records, read out of the anchor file as it is
 * committed at the tip (#6452).
 *
 * This is the one statement about which upstream commit the anchor names that a
 * PR cannot rewrite: the bytes live in main's tree, not in the tree under test.
 * And it is readable in exactly the checkouts where ancestry is NOT — a
 * `--depth=1` fetch of main carries that commit's whole tree, while its history
 * is precisely what got cut.
 *
 * Null when main carries no anchor (a history predating #5235) or carries one
 * this reader cannot make sense of. Deliberately quiet: nothing here is a verdict
 * about the tree under test, only an input the caller may or may not get.
 */
function readUpstreamAnchorRev(git: GitRun, tip: string): string | null {
  const show = git('show', `${tip}:./${SURFACE_BASE_FILE_NAME}`);
  if (show.status !== 0) return null;
  try {
    const doc = JSON.parse(show.stdout) as Partial<AuthorableSurfaceBase>;
    const rev = doc?.baseRev ?? '';
    return /^[0-9a-f]{40}$/.test(rev) ? rev : null;
  } catch {
    return null;
  }
}

/**
 * The baseline anchor for a checkout where `merge-base HEAD origin/main` cannot
 * answer — a shallow one, which is every CI job that does not ask for
 * `fetch-depth: 0` and every agent container (#6452).
 *
 * ── Why the tip is the wrong answer there ───────────────────────────────────
 * Under a TIP anchor, "main added a key after this branch forked" and "this
 * branch deleted a key" are the SAME fact, and the gate reports the first as the
 * second: #6359 measured PR #6356, which touched no packages/spec file at all,
 * being told it had deleted `ui/BulkActionDef:requiredPermissions` — a key main
 * had just ADDED. The correlation is inverted, which is what makes it expensive:
 * it fires on the PRs where "you deleted an authorable key" is most believable.
 *
 * ── Why not simply skip the check ───────────────────────────────────────────
 * Because that is the #4650 bypass with extra steps, in every shallow job at
 * once. So the disposition is to move the ANCHOR, never the verdict: the gate
 * still runs, still adjudicates, and a key that existed at the anchored rev and
 * is gone now is still caught. What it stops seeing is keys main added AFTER the
 * anchored rev — which is the false-positive set, not the deletion set.
 *
 * ── Which rev, and why it has to be earned ──────────────────────────────────
 * The obvious candidate is the in-tree anchor's own `baseRev`: it is upstream, it
 * is normally no NEWER than the branch's fork point, and the offline route
 * already anchors there (#5235). But its authenticity has two parts
 * (`verifyCommittedSurfaceBase`), and a shallow checkout can only prove the
 * second: `merge-base --is-ancestor` reports "not an ancestor" about a commit
 * that plainly is one, so part 1 SKIPS — the gate says so itself. Today that skip
 * is free, because that same doc comment records why: "in that environment the
 * merge-base anchor — not this file — is what the deletion check ran on anyway."
 * Making the file load-bearing there is exactly what removes that sentence's
 * protection, and a PR CAN point `baseRev` at one of its own commits (a
 * `--depth=1` fetch resolves any sha the remote advertises, its own head
 * included) whose shards already lack the key it is deleting. Both halves of the
 * key check then pass, against a baseline the PR authored.
 *
 * So the rev is accepted only when something the PR does not control says it is
 * upstream, in this order:
 *
 *   1. reachability DEMONSTRATED — `probeAncestry` answers "yes", which is proof
 *      in every checkout, truncated included (a cut walk can only lose
 *      reachability, never invent it). Rare in the shallow case by construction;
 *      it is what a non-shallow checkout with unrelated histories gets.
 *   2. ORIGIN/MAIN NAMES THE SAME REV — main's own committed anchor points at it.
 *      The ordinary case: the anchor moves only under an explicit `--update-base`
 *      (#5358), so a branch and main agree on it unless a re-anchor landed in
 *      between.
 *   3. otherwise, the rev MAIN names, never the one this tree names. Still
 *      upstream, still far older than the tip, and unforgeable — the residue is
 *      that it may be NEWER than the branch's fork point, which narrows the false
 *      positive window rather than closing it. Announced, so it is never mistaken
 *      for case 2.
 *
 * With none of those available the caller keeps today's tip anchor and says so:
 * a loud false red beats a silent bypass, and that is the honest degradation for
 * a checkout that can see origin/main's tip and nothing else.
 */
function resolveBaselineWithoutMergeBase(
  git: GitRun,
  tip: string,
  committed: AuthorableSurfaceBase | null,
): { rev: string; why: string } | null {
  if (!committed) return null;
  const own = committed.baseRev;
  const upstreamRev = readUpstreamAnchorRev(git, tip);
  const ownPresent = ensureCommitPresent(git, own);

  if (ownPresent && probeAncestry(git, own, tip).answer === 'yes') {
    return { rev: own, why: `${own.slice(0, 12)} is a demonstrated ancestor of origin/main` };
  }
  if (ownPresent && upstreamRev === own) {
    return {
      rev: own,
      why: `origin/main's own ${SURFACE_BASE_FILE_NAME} names the same commit, so it is upstream`,
    };
  }
  if (upstreamRev && upstreamRev !== own && ensureCommitPresent(git, upstreamRev)) {
    return {
      rev: upstreamRev,
      why:
        `this tree's ${SURFACE_BASE_FILE_NAME} names ${own.slice(0, 12)}, which nothing here can\n` +
        `   show is upstream (truncated history), so this run anchors on ${upstreamRev.slice(0, 12)} —\n` +
        `   the rev origin/main's own copy records`,
    };
  }
  return null;
}

/**
 * What `resolveSurfaceBase()` resolved: the baseline itself, plus — only when
 * the GIT path produced it — the anchor that path is allowed to write.
 *
 * `gitAnchor` is a returned field rather than the module-level assignment it
 * used to be, and that is a type-checking fix, not a style one (#5475). The old
 * shape declared `let gitResolvedAnchor: {...} | null = null` here and assigned
 * it from INSIDE this function. TypeScript's control-flow analysis does not
 * follow an assignment made in a function body, so at every top-level read below
 * the variable was still narrowed to `null` — which made `if (gitResolvedAnchor)`
 * a block whose body is typed `never`, i.e. the entire in-tree anchor writer
 * (#5235/#5358/#5370/#5847, ~100 lines) was invisible to tsc while reading as
 * ordinary checked code. Returning the value puts the assignment in the caller's
 * own flow, where CFA can see it. Runtime behaviour is unchanged: the git path
 * sets it, the in-tree path leaves it null, exactly as before.
 */
type SurfaceBaseResolution = {
  rev: string;
  doc: AuthorableSurface;
  /**
   * Set when THIS run resolved the baseline from git. It is the ONLY input
   * `--update-base` may write the in-tree anchor from: an offline build must
   * never be able to advance the anchor to its own state (#5235). The second
   * half of that discipline is #5358 — no build writes it at all, only the
   * explicit mode.
   */
  gitAnchor: { rev: string; keys: string[] } | null;
};

/**
 * The committed authorable surface this PR started from: its content at
 * the merge base of HEAD and origin/main. Returns null (with a note) only
 * when no baseline existed there at all; failure to ANCHOR the base is fatal —
 * a deletion check that silently skips is the #4650 bypass with extra steps.
 *
 * Three anchors, in strict preference order (#5235, #6452):
 *
 *   `merge-base` — origin/main is reachable (every dev checkout, every CI run).
 *      Unchanged from #4650: the baseline is read out of git at the merge base,
 *      and the in-tree anchor is additionally VERIFIED against it here, which is
 *      what makes that file trustworthy in the environments that cannot check.
 *   `re-anchor`  — origin/main resolves but its history is TRUNCATED, so
 *      `merge-base` has nothing to walk. The rev then comes from an upstream
 *      anchor and the keys are read out of git at it — see
 *      `resolveBaselineWithoutMergeBase` for which rev is eligible and why the
 *      tip is not. Nothing is skipped and nothing is waived; only the anchor
 *      moves (#6452).
 *   `in-tree`  — origin/main is not resolvable and no fetch can make it so. That
 *      is not a developer who forgot to fetch; it is a build environment with no
 *      route to GitHub: cloud's buildx image stages (framework is COPYed into the
 *      Docker stage and built there), air-gapped builds, forks, and historical
 *      tag reproductions. Those trees are immutable and already merged — there is
 *      no "what did this PR delete relative to main" question to ask — so the
 *      gate anchors on the committed baseline and the build proceeds.
 *
 * What is NOT offered is an env-var skip: that is precisely the bypass #4650
 * closes. With no anchor of either kind this still exits 1.
 */
function resolveSurfaceBase(): SurfaceBaseResolution | null {
  const git = gitInPackage;
  const committed = readCommittedSurfaceBase();

  // A checkout with no branch refs (any `fetch-depth: 1` job) cannot name
  // origin/main at all, so fetch the one ref this check needs before giving up.
  //
  // This fetch is GUARDED by the probe above and that is load-bearing (#6359):
  // where the ref already resolves — every full clone, and every CI job that
  // checks out `fetch-depth: 0` — it does not run, so it cannot undo the depth
  // its job asked for. Where it does run, it is `--depth=1` because the only
  // thing it is trying to buy is the ability to NAME origin/main; deepening it
  // here would silently make every shallow build pay for a full history it was
  // configured not to want. The job that needs walkable ancestry declares that
  // in its checkout step, which is where the cost is visible.
  let tipProbe = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}');
  if (tipProbe.status !== 0) {
    git('fetch', '--quiet', '--depth=1', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    tipProbe = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}');
  }

  if (tipProbe.status === 0) {
    const tip = tipProbe.stdout.trim();
    // Merge base, so a branch behind origin/main is compared against what it
    // FORKED from (keys added on main since then are not "deleted" here). In a
    // shallow clone there is no walkable ancestry, and the old fallback used the
    // TIP — which the parenthetical here used to justify as "on a PR's synthetic
    // merge commit that is the merge base anyway". It is not: the merge ref is
    // built when the PR is opened or updated and goes stale as main advances,
    // while the `--depth=1` fetch above always brings back main's CURRENT tip.
    // #6359 measured the two apart and the gate called main's addition this
    // branch's deletion. Re-anchor instead of re-judging (#6452).
    const mergeBase = git('merge-base', 'HEAD', tip);
    let rev = mergeBase.status === 0 ? mergeBase.stdout.trim() : tip;
    if (mergeBase.status !== 0) {
      // `--update-base` is deliberately excluded. Its job is to resolve a NEW
      // baseline out of git and write it down, so anchoring it on the anchor is
      // circular: the run would report "nothing to re-anchor" instead of the
      // #5370 refusal a truncated history owes it (`assertAnchorMovesForward`
      // fails closed there, and that refusal is the correct answer).
      const reanchored = UPDATE_BASE ? null : resolveBaselineWithoutMergeBase(git, tip, committed?.doc ?? null);
      if (reanchored) {
        rev = reanchored.rev;
        console.log(
          `ℹ️  shallow history — \`merge-base HEAD origin/main\` cannot answer here, so the\n` +
            `   authorable-surface deletion check (#4650) anchors on ${rev.slice(0, 12)} rather than on\n` +
            `   origin/main's tip ${tip.slice(0, 12)} (#6452): ${reanchored.why}.\n` +
            `   Under a tip anchor "main added a key after this branch forked" and "this branch deleted\n` +
            `   a key" are the same fact, and the gate reports the first as the second. The baseline's\n` +
            `   keys are read from git at that commit, never from ${SURFACE_BASE_FILE_NAME} itself.`,
        );
      } else {
        // #6359's diagnostic, kept for the one arm it still describes. With no
        // upstream anchor to move to, the tip is all this run has — so the
        // direction it misjudges is exactly what the reader needs spelled out,
        // because the verdict it produces ("deleted without proof") reads like a
        // severe spec violation and costs far more to diagnose than to fix
        // (#6359 was one CI job missing `fetch-depth: 0`, and the PR it reddened,
        // #6356, had not touched packages/spec at all).
        console.log(
          `   (shallow history — no merge base is walkable here, and no upstream anchor was usable\n` +
            `    either (#6452), so this run anchors on the origin/main TIP ${tip.slice(0, 12)} instead.\n` +
            `    ⚠️  Under a tip anchor a key that main ADDED after this branch forked is\n` +
            `    indistinguishable from a key this branch DELETED. If a deletion is reported below for\n` +
            `    a file you did not touch, check that first — and if this is CI, the job's checkout\n` +
            `    step needs \`fetch-depth: 0\` (#6359).)`,
        );
      }
    }
    const baseline = readSurfaceKeysAtRev(
      git,
      rev,
      AUTHORABLE_SURFACE_DIR_NAME,
      'keys',
      `authorable-surface deletion check (#4650)`,
    );
    if (!baseline) {
      console.log(
        `ℹ️  authorable-surface deletion check: no ${SURFACE_FILE_NAME} at base ${rev.slice(0, 12)} — nothing to compare.`,
      );
      return null;
    }
    const doc: AuthorableSurface = { keys: baseline.entries };
    const gitAnchor = { rev, keys: doc.keys };
    // The environment that CAN police the in-tree anchor is the one that must.
    if (committed) verifyCommittedSurfaceBase(git, tip, gitAnchor, committed.doc);
    return { rev, doc, gitAnchor };
  }

  if (committed) {
    console.log(
      `\nℹ️  origin/main is not resolvable in this build environment — anchoring the authorable-surface\n` +
        `   deletion check (#4650) on the committed ${SURFACE_BASE_FILE_NAME}: ${SURFACE_FILE_NAME}\n` +
        `   as of ${committed.doc.baseRev.slice(0, 12)}, verified upstream when it landed (#5235).`,
    );
    return {
      rev: committed.doc.baseRev,
      doc: { keys: committed.doc.keys },
      // Offline: this run did not resolve an anchor from git, so it has nothing
      // it is entitled to write one from (#5235).
      gitAnchor: null,
    };
  }

  console.error(
    `\n❌ No baseline to anchor the authorable-surface deletion check on (#4650, #5235).\n\n` +
      `   Deleted baseline lines are validated against ${SURFACE_FILE_NAME} at the merge base with\n` +
      `   origin/main, and — where origin/main is out of reach — against the committed\n` +
      `   ${SURFACE_BASE_FILE_NAME}. Neither is available here: origin/main does not resolve and\n` +
      `   ${SURFACE_BASE_FILE_NAME} is missing from the tree. Without an anchor the tombstone gate\n` +
      `   can be bypassed by hand-editing the file, so this build fails instead of silently\n` +
      `   skipping the check.\n\n` +
      `   Fix: restore packages/spec/${SURFACE_BASE_FILE_NAME} (it is a committed artifact), or\n` +
      `   \`git fetch origin main\` (or point refs/remotes/origin/main at your upstream main).`,
  );
  process.exit(1);
}

// ─── The manifest deletion gate (#4725) ───────────────────────────────
//
// #4650 closed the hand-edit shortcut one level down, for authorable KEYS. It
// left the whole-def case to the #2978 manifest ratchet, and route 3 of check
// (c) still says so in as many words: "whole-schema removals are adjudicated by
// json-schema.manifest". They were not. That ratchet's `missing` set is
// `manifest − emitted` with the manifest read from THIS commit — the same
// same-commit-evidence defect #4650 exists for — so a PR that deleted the
// export, the manifest line and the baseline lines together produced an empty
// `missing`, a check (c) that waived every key under the now-gone def, and an
// `api-surface` diff that a regeneration turns green. Three gates, nothing said.
//
// Measured on #4725, by deleting ONE barrel re-export (`export * from
// './validation.zod'` in src/data/index.ts, whose defs ObjectSchema imports
// directly and therefore keeps parsing metadata with): 7 defs and 116 authorable
// keys left the published contract with `gen:schema`, `check:authorable-surface`
// and `check:api-surface` all exiting 0.
//
// So the removal is re-anchored the way #4650 re-anchored key deletions: against
// json-schema.manifest/ at the merge base with origin/main, which the commit
// under test cannot rewrite. The proof demanded there is a DECLARATION —
// RETIRED_DEFS_BY_MAJOR — and deliberately not reachability, which #4650 uses
// per key. Reachability is keyed by `zodByDefKey`, populated only for defs this
// build EMITS, so `reachableVia()` answers `null` ("unreachable", i.e. waived)
// for every def that just stopped being emitted — a green light aimed exactly at
// the removals this gate is for. That is not a bug to fix by widening the BFS:
// the def is gone from the source, so there is no schema left to walk.

/** The manifest, by name — what every message here points the reader at. */
const MANIFEST_FILE_NAME = `${SCHEMA_MANIFEST_DIR_NAME}/`;

/**
 * Every def the ADR-0087 registries declare as unpublished, by exact
 * `${category}/${SchemaName}`, mapped to the earliest major that declared it.
 *
 * No rename carry (cf. `carryAuthorableKey` above): a renamed def is not
 * retired, and `RENAMED_DEFS` is consulted separately by the gate. A def cannot
 * be in both tables — `checkRenameTable` rejects a rename whose target this
 * build no longer emits.
 */
function registeredRetiredDefs(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [major, defs] of Object.entries(RETIRED_DEFS_BY_MAJOR)) {
    for (const def of defs) {
      const prev = out.get(def);
      if (prev === undefined || Number(major) < prev) out.set(def, Number(major));
    }
  }
  return out;
}

/**
 * Adjudicate whole-schema removals against the merge-base manifest.
 *
 * `baseRev` is the git-resolved baseline — the same rev the #4650 key gate
 * anchors on — or null when this build could not resolve origin/main at all.
 *
 * Offline posture, following #5235 rather than inventing a third one: the
 * REGISTRATION MIRROR below is git-free and always runs, while the removal
 * comparison is a verification that has no baseline offline and therefore says
 * so and skips — the same call `verifyCommittedSurfaceBase` makes when it cannot
 * fetch the commit it would check. It is not a bypass a PR can reach for: the
 * environments without a route to GitHub are immutable already-merged trees
 * (image-build stages, air-gapped builds, forks, historical tags), where "what
 * did this PR delete relative to main" is not a question that exists. Unlike the
 * key gate, no in-tree anchor is needed to keep them building, because a skipped
 * comparison fails nothing.
 */
function checkManifestRemovals(git: GitRun, baseRev: string | null): void {
  const registered = registeredRetiredDefs();

  // The (b2) mirror, one level up: an entry that pre-approves a removal nobody
  // performed. Left unchecked it would let the real removal land later, in
  // someone else's PR, with this gate already satisfied and nothing written down
  // at the time it happened.
  const stillPublished = [...registered.entries()].filter(([def]) => generatedKeys.has(def));
  if (stillPublished.length > 0) {
    console.error(
      `\n❌ ${stillPublished.length} RETIRED_DEFS_BY_MAJOR entr(ies) name a schema this build still publishes:`,
    );
    for (const [def, major] of stillPublished) {
      console.error(`     - ${def}  (registered at major ${major})`);
    }
    console.error(
      `\n   RETIRED_DEFS_BY_MAJOR records defs that HAVE left the published set — no\n` +
        `   json-schema/<def>.json, no line in ${MANIFEST_FILE_NAME}. These are still emitted,\n` +
        `   so the entry registers a removal nobody performed, and the gate below would accept\n` +
        `   the real one later without it ever being declared.\n\n` +
        `   Either remove the export (and its ${MANIFEST_FILE_NAME} line) in this PR, or delete\n` +
        `   the entry from packages/spec/src/migrations/registry.ts.`,
    );
    process.exit(1);
  }

  if (baseRev === null) {
    console.log(
      `ℹ️  ${MANIFEST_FILE_NAME} removal check: no git-resolved baseline in this build\n` +
        `   environment, so whole-schema removals are not compared here (#4725, offline posture\n` +
        `   of #5235). Every environment that can reach origin/main runs it.`,
    );
    return;
  }

  const short = baseRev.slice(0, 12);
  const baseline = readSurfaceKeysAtRev(
    git,
    baseRev,
    SCHEMA_MANIFEST_DIR_NAME,
    'schemas',
    `${MANIFEST_FILE_NAME} removal check (#4725)`,
  );
  if (!baseline) {
    console.log(
      `ℹ️  ${MANIFEST_FILE_NAME} removal check: no ${MANIFEST_FILE_NAME} at base ${short} — nothing to compare.`,
    );
    return;
  }
  const baseSchemas = baseline.entries;

  // Measured against what this build EMITS, never against the manifest file in
  // the tree: the file is what the PR can rewrite, and rewriting it is the
  // bypass. A base key still listed in the tree's manifest but no longer emitted
  // has already exited above, in the disappearance ratchet.
  const removed = baseSchemas.filter((key) => !generatedKeys.has(key) && !(key in RENAMED_DEFS));
  const unregistered = removed.filter((key) => !registered.has(key));
  const declared = removed.filter((key) => registered.has(key));
  if (declared.length > 0) {
    console.log(`\nℹ️  ${declared.length} schema(s) left the published set since ${short}, each declared (#4725):`);
    for (const def of declared) {
      console.log(`     - json-schema/${def}.json — RETIRED_DEFS_BY_MAJOR, major ${registered.get(def)}.`);
    }
  }
  if (unregistered.length === 0) return;

  console.error(
    `\n❌ ${unregistered.length} schema(s) left the published set with no registered removal (#4725):`,
  );
  for (const def of unregistered) console.error(`     - json-schema/${def}.json`);
  console.error(
    `\n   ${MANIFEST_FILE_NAME} is the committed record of every schema this repo has ever\n` +
      `   published — the \`$id\` URLs under schema.objectstack.io, IDE validation, gen:docs\n` +
      `   input. Its disappearance ratchet reads that file from THIS commit, so deleting the\n` +
      `   export and the manifest line in one PR left nothing to detect, and the #4650 key gate\n` +
      `   waived every baseline line under the vanished def on the grounds that this file would\n` +
      `   adjudicate it. Removals are therefore compared against ${MANIFEST_FILE_NAME} at the\n` +
      `   merge base ${short} with origin/main, which this commit cannot rewrite.\n\n` +
      `   1. Declare each removal by its EXACT def key in RETIRED_DEFS_BY_MAJOR\n` +
      `      (packages/spec/src/migrations/registry.ts) — copy these lines in:\n\n` +
      unregistered.map((def) => `        '${def}',\n`).join('') +
      `\n      under \`${CURRENT_MAJOR}: [ … ]\` (create the major's array if it is the first).\n\n` +
      `   2. Add a D2 conversion in src/conversions/registry.ts naming the surface (and a D3\n` +
      `      chain step referencing it) plus a \`major\` changeset, so the removal reaches\n` +
      `      spec-changes.json, the upgrade guide and \`os migrate meta\` — the table is the\n` +
      `      proof it was declared, the conversion is the prescription a consumer follows.\n\n` +
      `   If the schema was not meant to disappear at all, this is not the fix: an added\n` +
      `   \`.transform\` can make a schema unrepresentable in BOTH io modes and silently\n` +
      `   unpublish it (#2967). And a def published under a NEW name is a rename — declare it\n` +
      `   in RENAMED_DEFS (scripts/lib/renamed-defs.ts), which carries its authorable keys\n` +
      `   across; an entry here would falsely claim the contract shrank.`,
  );
  process.exit(1);
}

/**
 * The baseline this run resolved, kept for the default-value ratchet further
 * down (#4666), which needs the same two facts check (c) needs: which upstream
 * rev the comparison is anchored on, and which keys were AUTHORABLE there. It
 * is one resolution, shared — a second `resolveSurfaceBase()` call would ask git
 * the same question twice and could answer it differently.
 */
let resolvedSurfaceBase: SurfaceBaseResolution | null = null;

/**
 * The git-resolved anchor of this run, hoisted out of the block below because
 * the in-tree anchor writer further down is a separate top-level block.
 * Assigned HERE, in the module's own control flow, which is what keeps it typed
 * as the union it is declared as — see `SurfaceBaseResolution.gitAnchor`.
 */
let gitResolvedAnchor: { rev: string; keys: string[] } | null = null;

{
  const base = resolveSurfaceBase();
  resolvedSurfaceBase = base;
  gitResolvedAnchor = base?.gitAnchor ?? null;
  // Whole defs first: check (c) below waives every baseline line under a def this
  // build stopped emitting, on the grounds that this gate adjudicates it. Running
  // it first is what makes that deferral true rather than circular.
  checkManifestRemovals(gitInPackage, gitResolvedAnchor?.rev ?? null);
  if (base) {
    // Carry base keys through declared def renames first — same discipline as
    // the snapshot carry above — so a rename is never misread as a deletion.
    const baseSnapshot = new Map<string, boolean>();
    for (const entry of base.doc.keys ?? []) {
      const key = entry.replace(RETIRED_MARK, '');
      baseSnapshot.set(carryAuthorableKey(key), entry.endsWith(RETIRED_MARK));
    }
    const deletedKeys = [...baseSnapshot.keys()].filter((k) => !currentKeys.has(k));
    if (deletedKeys.length > 0) {
      const baseRev = base.rev.slice(0, 12);
      const declaredRetired = registeredRetiredKeys();
      const reachability = computeSurfaceReachability();
      const allowed: string[] = [];
      const violations: string[] = [];
      const goneDefs = new Map<string, number>(); // def no longer emitted -> deleted key count
      for (const key of deletedKeys) {
        // Only the def half is read now. The leaf half fed the leaf-NAME match
        // #5898 removed from route 3 (see the RETIRED_KEYS_BY_MAJOR message
        // below); slicing it out survived the rewrite as a dead local (#5475).
        const defKey = key.slice(0, key.indexOf(':'));
        if (!generatedSchemas.has(defKey)) {
          goneDefs.set(defKey, (goneDefs.get(defKey) ?? 0) + 1);
          continue;
        }
        const via = reachability.reachableVia(defKey);
        if (via === null) {
          allowed.push(
            `${key} — def not reachable from the ${reachability.rootTypes.length} metadata-type roots\n` +
              `       (BUILTIN_METADATA_TYPE_SCHEMAS + EXTRA_METADATA_TYPE_SCHEMAS overlay; BFS over this\n` +
              `       build's in-memory Zod graph): an over-collected entry, never parsed against a\n` +
              `       metadata document. This waives ONLY the tombstone requirement of this file — it is\n` +
              `       not a license to change the schema (#4650).`,
          );
          continue;
        }
        const wasRetired = baseSnapshot.get(key) === true;
        const how =
          via === 'root-graph'
            ? 'reachable from the metadata-type roots'
            : 'authorable through a derived clone of a root-reachable schema';
        if (!wasRetired) {
          violations.push(`${key} — def ${how}; the entry at ${baseRev} was LIVE (never tombstoned).`);
          continue;
        }
        const registeredAt = declaredRetired.get(key);
        if (registeredAt === undefined) {
          violations.push(
            `${key} — def ${how}; tombstoned, but no entry in RETIRED_KEYS_BY_MAJOR names this\n` +
              `       EXACT key, so there is nothing that dates the retirement and its aging clock\n` +
              `       has no start. Until #5898 a leaf-name match against unrelated ADR-0087\n` +
              `       clauses supplied one by coincidence (a flow node's '.type' dated an index\n` +
              `       type's tombstone) — always erring early, since it took the Math.min.`,
          );
          continue;
        }
        if (CURRENT_MAJOR - registeredAt < TOMBSTONE_AGE_MAJORS) {
          violations.push(
            `${key} — def ${how}; tombstone registered at major ${registeredAt}, current major is\n` +
              `       ${CURRENT_MAJOR} — a tombstone must age ≥ ${TOMBSTONE_AGE_MAJORS} majors before its line is deleted.`,
          );
          continue;
        }
        allowed.push(
          `${key} — [RETIRED] at ${baseRev} and registered at major ${registeredAt} ` +
            `(current ${CURRENT_MAJOR}): tombstone aged out.`,
        );
      }
      for (const [defKey, keyCount] of goneDefs) {
        allowed.push(
          `${defKey}:* (${keyCount} line(s)) — def no longer emitted by this build; whole-schema\n` +
            `       removals are adjudicated by json-schema.manifest/ (#2978) — since #4725 by the\n` +
            `       manifest deletion gate that ran above, which required a declared removal for it\n` +
            `       (until then this deferral pointed at a ratchet that said nothing).`,
        );
      }
      if (allowed.length > 0) {
        console.log(`\nℹ️  ${allowed.length} baseline deletion(s) since ${baseRev} carry their own proof (#4650):`);
        for (const line of allowed) console.log(`     - ${line}`);
      }
      if (violations.length > 0) {
        console.error(`\n❌ ${violations.length} authorable baseline line(s) were deleted without proof (#4650):`);
        for (const line of violations) console.error(`     - ${line}`);
        console.error(
          `\n   authorable-surface/ is generated evidence, not an editable list: deleting a\n` +
            `   line deletes exactly what check (a) above needs to see — #4638 and #4643 both\n` +
            `   removed authorable keys that way with a green gate. Deletions are therefore\n` +
            `   compared against the baseline at merge base ${baseRev} with origin/main,\n` +
            `   which this commit cannot rewrite.\n\n` +
            `   A line may only leave this file when:\n` +
            `     1. its key was tombstoned (\`retiredKey()\` → "[RETIRED]") AND that key is\n` +
            `        declared — EXACTLY, as '\${defKey}:\${name}' — in RETIRED_KEYS_BY_MAJOR\n` +
            `        (src/migrations/registry.ts) under a major ≥ ${TOMBSTONE_AGE_MAJORS} behind this one\n` +
            `        (≤ v${CURRENT_MAJOR - TOMBSTONE_AGE_MAJORS}). Tombstones that predate that table are deliberately\n` +
            `        undeclared: nothing could date them honestly, so they are NOT deletable\n` +
            `        until someone establishes the true major and writes it down (#5898). The\n` +
            `        D2 conversion (src/conversions/registry.ts) naming the surface stays\n` +
            `        required — it is the prescription consumers follow — but it is no longer\n` +
            `        what dates the clock; or\n` +
            `     2. its def is not reachable from the metadata-type roots — this gate computes\n` +
            `        that itself (it would have said so above); or\n` +
            `     3. its whole def stopped being emitted — adjudicated by the manifest deletion\n` +
            `        gate above (#4725), which demands the removal be declared in\n` +
            `        RETIRED_DEFS_BY_MAJOR (src/migrations/registry.ts).\n\n` +
            `   Restore the line(s) — \`pnpm --filter @objectstack/spec gen:schema\` regenerates\n` +
            `   the file — or complete the retirement route (#4650, ADR-0104, and the\n` +
            `   spec-property-retirement skill in .claude/skills/).`,
        );
        process.exit(1);
      }
    }
  }
}

// ─── The in-tree baseline anchor (#5235, #5358) ──────────────────────
//
// Written here, AFTER the deletion gate above has adjudicated this build — order
// is load-bearing: a run that exits on an unproven deletion never reaches this
// line, so the anchor can never be advanced past a deletion it did not bless. And
// it is written only from `gitResolvedAnchor`, never from `currentEntries`: an
// anchor computed from the tree being checked is an anchor that tree can rewrite,
// which is the whole defect #4650 exists for.
//
// Content therefore lags main by at most the last surface-changing PR — the
// baseline at the merge base, not this branch's own state. That lag is what
// makes the file worth committing: offline, it still holds keys this build would
// have to account for. Staleness is NOT an error (on `main` itself the merge base
// IS HEAD, so the file necessarily trails its own surface by one PR); only
// inauthenticity is, and `verifyCommittedSurfaceBase` above is what proves it.
//
// #5358 adds the third property, the one that makes the other two mean anything
// outside CI: the write happens ONLY under `--update-base`. Until then this block
// ran on every `gen:schema`, so every `pnpm build` in the repo — including builds
// of packages that merely have `@objectstack/spec` in their dependency closure —
// silently advanced the deletion gate's own baseline in the developer's worktree,
// where the next `git add -A` swept it into a PR about something else. Lag is
// harmless (it only ever asks a build to account for MORE keys); an unnoticed
// advance is not (it asks for fewer, and forgets a retirement in the process).
{
  const committed = readCommittedSurfaceBase();
  if (gitResolvedAnchor) {
    const anchor = gitResolvedAnchor;
    const drifted = !committed || JSON.stringify(committed.doc.keys) !== JSON.stringify(anchor.keys);
    if (!committed && CHECK) {
      console.error(
        `\n❌ ${SURFACE_BASE_FILE_NAME} is missing (#5235).\n\n` +
          `   It is a committed artifact: builds that cannot reach GitHub (image-build stages,\n` +
          `   air-gapped, fork, historical tag) anchor the #4650 deletion gate on it, and without it\n` +
          `   they have nothing to anchor on and fail.\n\n` +
          `   Run \`${REANCHOR_COMMAND}\` and commit the result.`,
      );
      process.exit(1);
    }
    if (UPDATE_BASE) {
      if (drifted) {
        // Direction first: the anchor moves forward or not at all (#5370). Asked
        // HERE rather than up front because this is where the rev that would be
        // written is finally known — and because it is the write, not the run,
        // that has to be refused: a `--update-base` with nothing to write is not
        // turned into a failure by a rev comparison. A creating run (no committed
        // anchor) has no direction to check.
        if (committed) assertAnchorMovesForward(gitInPackage, committed.doc.baseRev, anchor.rev);
        fs.writeFileSync(AUTHORABLE_SURFACE_BASE_PATH, serializeSurfaceBase(anchor.rev, anchor.keys));
        console.log(
          `\n⚓ ${SURFACE_BASE_FILE_NAME} ${committed ? 'refreshed to' : 'created at'} ` +
            `${anchor.rev.slice(0, 12)} (${anchor.keys.length} keys) — commit it, on its own.`,
        );
      } else {
        console.log(
          `\n⚓ ${SURFACE_BASE_FILE_NAME} is already the baseline at ${anchor.rev.slice(0, 12)} ` +
            `(${anchor.keys.length} keys) — nothing to re-anchor.`,
        );
      }
    } else if (!committed) {
      // Not fatal outside `--check`: this is a build, and the gate that must go
      // red about a missing committed artifact already does, above. Loud, though —
      // silently recreating it is what #5358 removed.
      console.warn(
        `\n⚠️  ${SURFACE_BASE_FILE_NAME} is missing, and a build no longer creates it (#5358).\n` +
          `   It is a committed artifact the #4650 deletion gate anchors on where origin/main is out\n` +
          `   of reach. Restore it (\`git checkout -- packages/spec/${SURFACE_BASE_FILE_NAME}\`) or\n` +
          `   re-anchor deliberately: \`${REANCHOR_COMMAND}\`.`,
      );
    } else if (drifted) {
      // Reported, never fatal, and never repaired here: see the notes above on
      // `main`'s own merge base and on #5358.
      //
      // The DIRECTION is asked, not assumed (#5847). This used to print one fixed
      // sentence — "trails the baseline at <rev> by <n> key(s)" — with `n` counted
      // as `resolved keys ∖ anchor keys`. In the state where the committed anchor
      // is NEWER than the baseline this build resolved, the resolved keys are a
      // subset of the anchor's, so that count is 0 and the line degrades to
      // "trails the baseline at <rev> by 0 key(s)": the direction backwards, and
      // the one number that could have contradicted it zeroed out. That state is
      // ordinary, not a corner — a build during an uncommitted merge, or a branch
      // that forked before the anchor advanced and then took a newer anchor
      // (#5370 catalogues both) — and since #5370 `--update-base` REFUSES there
      // and explains the direction correctly, so the two were describing one
      // situation in contradictory language.
      //
      // Both key deltas are reported now, because either can be the empty one and
      // the pair is what makes the sentence say something. Only the wording and
      // the counts change here: this arm still writes nothing, exits nothing, and
      // decides nothing.
      const recorded = new Set(committed.doc.keys);
      const resolvedKeys = new Set(anchor.keys);
      const onlyBaseline = anchor.keys.filter((k) => !recorded.has(k)).length;
      const onlyAnchor = committed.doc.keys.filter((k) => !resolvedKeys.has(k)).length;
      const anchorShort = committed.doc.baseRev.slice(0, 12);
      const baseShort = anchor.rev.slice(0, 12);
      const delta =
        onlyBaseline > 0 && onlyAnchor > 0
          ? `${onlyBaseline} key(s) only that baseline has, ${onlyAnchor} only the anchor has`
          : onlyBaseline > 0
            ? `${onlyBaseline} key(s) only that baseline has`
            : onlyAnchor > 0
              ? `${onlyAnchor} key(s) only the anchor has`
              : 'the same keys in a different order';
      const reanchor =
        `   Re-anchoring is a deliberate act with its own reviewed diff — \`${REANCHOR_COMMAND}\`\n` +
        `   — never a side effect of this build (#5358).`;
      const relation = relateAnchorToBaseline(gitInPackage, committed.doc.baseRev, anchor.rev);
      if (relation.kind === 'behind') {
        console.log(
          `ℹ️  ${SURFACE_BASE_FILE_NAME} trails the baseline at ${baseShort}: it mirrors the older\n` +
            `   ${anchorShort}, and they differ by ${delta}\n` +
            `   — expected, and not an error: the anchor is a snapshot of an upstream commit, proved\n` +
            `   AUTHENTIC rather than current.\n${reanchor}`,
        );
      } else if (relation.kind === 'ahead') {
        console.log(
          `ℹ️  ${SURFACE_BASE_FILE_NAME} is AHEAD of the baseline this build resolved: it mirrors\n` +
            `   ${anchorShort}, a DESCENDANT of the merge base ${baseShort} that HEAD resolves to, and\n` +
            `   they differ by ${delta}\n` +
            `   — not an error, and not something to re-anchor: the anchor only ever moves forward, so\n` +
            `   what closes this gap is bringing HEAD up to date with origin/main (and committing it),\n` +
            `   never a re-anchor onto the older baseline.\n${reanchor}`,
        );
      } else {
        console.log(
          `ℹ️  ${SURFACE_BASE_FILE_NAME} differs from the baseline this build resolved: it mirrors\n` +
            `   ${anchorShort}, that baseline is at ${baseShort}, and they differ by ${delta}\n` +
            `   — which of the two is newer could not be established here, so this run names no\n` +
            `   direction: ${relation.why}.\n` +
            `   Not an error either way.\n${reanchor}`,
        );
      }
    }
  }
}

// Every shard is compared against its canonical serialization BYTE FOR BYTE, not
// just on its key array. #4662 caught a hand-normalized description dash the
// keys-only comparison could never see — proof the file's content was not this
// script's output. Any non-generated byte is a hand-edit (or a stale writer), and
// hand-edits are exactly how deletions hid from check (a) (#4650, comment 2).
// Sharding does not soften this: the comparison is now per shard, and a shard
// nobody regenerates is reported as stale rather than skipped.
const canonicalSurfaceTexts = authorableSurfaceShardTexts(currentEntries);
const staleSurfaceShards = [...canonicalSurfaceTexts]
  .filter(([name, text]) => surfaceTexts?.get(name) !== text)
  .map(([name]) => name);
const orphanSurfaceShards = [...(surfaceTexts?.keys() ?? [])]
  .filter((name) => !canonicalSurfaceTexts.has(name));
const surfaceChanged =
  surfaceTexts === null || staleSurfaceShards.length > 0 || orphanSurfaceShards.length > 0;
if (surfaceChanged && CHECK) {
  // Removals already exited above; reaching here in check mode means the snapshot
  // is behind on ADDITIONS, or differs without any key change at all — a hand-edit.
  const before = new Set(surfaceDoc?.keys ?? []);
  const addedKeys = currentEntries.filter((k) => !before.has(k));
  if (addedKeys.length > 0) {
    console.error(
      `\n❌ ${SURFACE_FILE_NAME} is out of date (${addedKeys.length} key(s) not recorded).`,
    );
    for (const k of addedKeys.slice(0, 20)) console.error(`     + ${k}`);
    if (addedKeys.length > 20) console.error(`     … and ${addedKeys.length - 20} more`);
    console.error(
      `\n   Run \`pnpm --filter @objectstack/spec gen:schema\` and commit the result. An\n` +
      `   unrecorded key is invisible to this ratchet forever after — it can only detect\n` +
      `   the disappearance of something it once saw.`,
    );
  } else {
    console.error(
      `\n❌ ${SURFACE_FILE_NAME} does not match its generated form (key set unchanged).`,
    );
    for (const name of staleSurfaceShards) {
      console.error(`     ~ ${AUTHORABLE_SURFACE_DIR_NAME}/${name}.json  (stale)`);
    }
    for (const name of orphanSurfaceShards) {
      console.error(`     - ${AUTHORABLE_SURFACE_DIR_NAME}/${name}.json  (no key in this category)`);
    }
    console.error(
      `\n   The recorded keys are current, but the bytes are not what gen:schema\n` +
      `   writes — a hand-edit or stale formatting (#4662 found a manually normalized\n` +
      `   description dash exactly this way; see #4650). These files are generated evidence:\n` +
      `   every difference must come from the generator.\n\n` +
      `   Run \`pnpm --filter @objectstack/spec gen:schema\` and commit the result.`,
    );
  }
  process.exit(1);
}
if (surfaceChanged && !CHECK) {
  const { written, removed } = writeShards(AUTHORABLE_SURFACE_DIR, canonicalSurfaceTexts);
  console.log(
    `\n🔑 ${SURFACE_FILE_NAME} ${surfaceTexts ? 'updated' : 'created'} (${currentEntries.length} keys) — commit it.` +
      // The locality claim, printed: a PR that touched one category names one
      // shard here, which is the same fact as "two such PRs do not conflict in
      // the merge queue" (#5837).
      (written.length > 0 ? `\n     touched: ${written.map((n) => `${n}.json`).join(', ')}` : '') +
      (removed.length > 0 ? `\n     removed: ${removed.map((n) => `${n}.json`).join(', ')}` : ''),
  );
}

// ─── The default-value ratchet (#4666) ───────────────────────────────
//
// The three ratchets above all measure the SHAPE of the contract: which schemas
// are published, which keys they carry, whether a key is live or tombstoned.
// None of them can see what a key MEANS WHEN THE AUTHOR OMITS IT — and that is
// the one change in this file's whole subject matter that alters the behaviour
// of already-deployed metadata with no error, no warning and no diff on the
// author's side.
//
// Measured, not theorised: on #4661's branch, moving `retryPolicyShape()`'s
// `maxRetries` default from 0 to 3 — one character — left this entire script
// green ("✅ Successfully generated 1703 schemas."). The only thing that caught
// it was a runtime pin an author had remembered to hand-write. Every recording
// channel missed it for a different reason: the authorable-surface comparison
// reads key NAMES, `retiredKey()` tombstones fire on live → retired, and
// spec-changes.json is a projection of the ADR-0087 registries, which a default
// change need not touch at all.
//
// Why defaults specifically, and why now: omitting optional keys is the normal
// mode of AI-authored metadata (ADR-0033), so a default covers far more live
// behaviour than it did in the hand-written era. `maxRetries`, `enabled`,
// `required`, any `allow*` — flipping one of those is a reliability or security
// event, and a silent one.
//
// ⛔ CONSTRAINTS ARE DELIBERATELY NOT RECORDED HERE (maintainer ruling on #4666,
// direction B). The asymmetry that decided it: tightening `.max()` REJECTS an
// existing document — loud, diagnosable, discovered from CI — while a default
// flip rejects nothing and is discovered from a customer incident. Recording
// both (direction A) covers more but makes this ratchet markedly noisier, and
// #4535 §1 is already complaining that the authorable surface over-collects.
// The exclusion is structural rather than a matter of discipline: the
// fingerprint reads exactly one field of the emitted schema, `default`, so a
// bound or a `.describe()` cannot move it even by accident.
const AUTHORABLE_DEFAULTS_DIR = path.resolve(__dirname, `../${AUTHORABLE_DEFAULTS_DIR_NAME}`);
const DEFAULTS_DIR_LABEL = `${AUTHORABLE_DEFAULTS_DIR_NAME}/`;

const currentDefaults = collectAuthorableDefaults(generatedSchemas);

let defaultsTexts: Map<string, string> | null = null;
let committedDefaults: Map<string, string> | null = null;
try {
  const read = aggregateCategoryShards(AUTHORABLE_DEFAULTS_DIR, 'defaults');
  if (read) {
    defaultsTexts = new Map(read.shards.map((s) => [s.name, s.raw]));
    committedDefaults = parseDefaultEntries(read.entries);
  }
} catch (error) {
  console.error(`\n❌ Failed to read ${DEFAULTS_DIR_LABEL}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

// The baseline, in strict preference order. Both halves of a baseline — the
// recorded defaults AND the authorable keys they belong to — always come from
// the SAME anchor, or "this key is new" would be decided against one commit
// while its default was read from another.
//
//   `upstream` — authorable-defaults/ at the merge base with origin/main, the
//      commit under test cannot rewrite it. This is the anchor that matters, and
//      it is the one every run gets once this ratchet exists upstream.
//   `in-tree`  — the committed authorable-defaults/ in THIS tree. Weaker: the
//      commit under test owns these bytes. Used only where the upstream read has
//      nothing to return — a merge base that predates this ratchet (every branch
//      in flight when it lands), and the offline builds #5235 describes, which
//      are immutable already-merged trees with no "what did this PR change
//      relative to main" question to ask. It is strictly additive: it can only
//      ADD findings, never remove one the upstream anchor would have made.
//
// With NEITHER available the comparison is skipped — and that skip is not the
// #4690 hole, because it is not reachable by deleting anything: the artifact's
// staleness check below runs unconditionally, so a tree with no
// authorable-defaults/ fails there in `--check` mode whatever this block
// decided. Which anchor was used is PRINTED, every run.
let defaultsBaseline: { defaults: Map<string, string>; keys: Map<string, boolean>; label: string } | null =
  null;
if (resolvedSurfaceBase) {
  const upstream = readSurfaceKeysAtRev(
    gitInPackage,
    resolvedSurfaceBase.rev,
    AUTHORABLE_DEFAULTS_DIR_NAME,
    'defaults',
    `authorable-defaults change check (#4666)`,
  );
  if (upstream) {
    const keys = new Map<string, boolean>();
    for (const entry of resolvedSurfaceBase.doc.keys ?? []) {
      keys.set(carryAuthorableKey(entry.replace(RETIRED_MARK, '')), entry.endsWith(RETIRED_MARK));
    }
    defaultsBaseline = {
      defaults: parseDefaultEntries(upstream.entries),
      keys,
      label: `upstream ${resolvedSurfaceBase.rev.slice(0, 12)}`,
    };
  }
}
if (!defaultsBaseline && committedDefaults && surfaceDoc) {
  const keys = new Map<string, boolean>();
  for (const entry of surfaceDoc.keys) {
    keys.set(carryAuthorableKey(entry.replace(RETIRED_MARK, '')), entry.endsWith(RETIRED_MARK));
  }
  defaultsBaseline = {
    defaults: committedDefaults,
    keys,
    label: 'in-tree (this commit owns these bytes — no upstream baseline was reachable)',
  };
}

if (!defaultsBaseline) {
  console.log(
    `\nℹ️  ${DEFAULTS_DIR_LABEL} has no baseline to compare against — neither the merge base nor\n` +
      `   this tree carries one, so this run RECORDS the defaults rather than adjudicating them\n` +
      `   (#4666). The artifact check below still runs: a tree missing ${DEFAULTS_DIR_LABEL} fails\n` +
      `   \`check:authorable-surface\` regardless of what this block decided.`,
  );
} else {
  const changes = diffAuthorableDefaults({
    baseline: defaultsBaseline.defaults,
    current: currentDefaults,
    baselineKeys: defaultsBaseline.keys,
    currentKeys,
  });
  const { authorised, unauthorised, stale } = authoriseDefaultChanges(
    changes,
    DEFAULT_CHANGES_BY_MAJOR,
    CURRENT_MAJOR,
    currentDefaults,
    currentKeys,
  );

  // A stale declaration is judged whether or not anything changed today: it is
  // the property that stops this table decaying into an allowlist. Reported
  // FIRST, because a chain that no longer describes reality also explains why a
  // change below looks unauthorised.
  if (stale.length > 0) {
    console.error(
      `\n❌ ${stale.length} DEFAULT_CHANGES_BY_MAJOR declaration(s) at major ${CURRENT_MAJOR} no longer describe reality:`,
    );
    for (const s of stale) {
      console.error(
        s.why === 'chain-tip-mismatch'
          ? `     - ${s.key}: declared to end at ${s.claims}, but this build emits ${s.emits}`
          : `     - ${s.key}: declared hops do not meet (${s.claims})`,
      );
    }
    console.error(
      `\n   A declared default change is a claim about a value this build EMITS, re-checked on\n` +
        `   every run — that is what keeps it from becoming an allowlist nobody re-reads. The\n` +
        `   default moved again (or was reverted) and the declaration was left behind, so it now\n` +
        `   pre-approves a value nobody wrote down.\n\n` +
        `   Append the new hop to the key's chain in scripts/lib/default-changes.ts (the chain\n` +
        `   must be contiguous: each hop's \`from\` is the previous hop's \`to\`), or — if the\n` +
        `   default should not have moved at all — restore it in the schema.`,
    );
    process.exit(1);
  }

  if (authorised.length > 0) {
    // Printed in full, every run. An acknowledged flip that passes in silence is
    // the failure #4690 names; this is the exit announcing itself.
    console.log(`\n📌 ${authorised.length} declared default change(s) accepted (#4666):`);
    for (const { change, declared } of authorised) {
      console.log(`     - ${change.key}: ${change.from} → ${change.to}`);
      for (const hop of declared) console.log(`       ${hop.reason}`);
    }
  }

  if (unauthorised.length > 0) {
    console.error(
      `\n❌ ${unauthorised.length} authorable key(s) changed the DEFAULT they apply when the author omits them:`,
    );
    for (const c of unauthorised) console.error(`     - ${c.key}: ${c.from} → ${c.to}  (${c.kind})`);
    console.error(
      `\n   Baseline: ${defaultsBaseline.label}\n\n` +
        `   A default decides what already-deployed metadata does when it does NOT write the key,\n` +
        `   and omitting optional keys is the normal mode of AI-authored metadata (ADR-0033). So\n` +
        `   this change reaches every document that stayed silent about ${unauthorised.length === 1 ? 'this key' : 'these keys'} — with no\n` +
        `   parse error, no warning, and nothing in the author's diff. Unlike a tightened\n` +
        `   constraint, which rejects the document loudly, there is no moment where anyone finds\n` +
        `   out (#4666, measured on #4661).\n\n` +
        `   If the change is intended, declare it — exactly, by \`\${defKey}:\${name}\` — in\n` +
        `   DEFAULT_CHANGES_BY_MAJOR (scripts/lib/default-changes.ts), under \`${CURRENT_MAJOR}: [ … ]\`:\n\n` +
        unauthorised
          .map(
            (c) =>
              `        {\n` +
              `          key: '${c.key}',\n` +
              `          from: '${c.from}',\n` +
              `          to: '${c.to}',\n` +
              `          reason: '…what changes for a consumer who relied on ${c.from}, and what they should write to keep it…',\n` +
              `        },\n`,
          )
          .join('') +
        `\n   \`reason\` is printed by every build that accepts the change, so write it for the\n` +
        `   consumer who is about to be surprised. Both endpoints are re-checked on every run\n` +
        `   against sources you do not control — \`from\` against the baseline, \`to\` against what\n` +
        `   the build emits — so the declaration dies the moment it stops being true.\n\n` +
        `   If the default was NOT meant to move, restore it in the schema. And if the value\n` +
        `   genuinely has to change for existing documents too, add a \`semantic\` entry to this\n` +
        `   major's step in src/migrations/registry.ts so it reaches spec-changes.json, the\n` +
        `   upgrade guide and \`os migrate meta\`.`,
    );
    process.exit(1);
  }

  if (changes.length === 0) {
    console.log(
      `\n🔒 ${DEFAULTS_DIR_LABEL} verified against ${defaultsBaseline.label} — ` +
        `${currentDefaults.size} default(s) unchanged (#4666).`,
    );
  }
}

// The artifact itself, on the same byte-for-byte terms as its two siblings: a
// generated file whose every difference must come from the generator (#4662).
// Reached only after the adjudication above, so `gen:schema` can never absorb an
// undeclared change into the record it is supposed to be evidence for.
const canonicalDefaultsTexts = authorableDefaultsShardTexts(currentDefaults);
const staleDefaultsShards = [...canonicalDefaultsTexts]
  .filter(([name, text]) => defaultsTexts?.get(name) !== text)
  .map(([name]) => name);
const orphanDefaultsShards = [...(defaultsTexts?.keys() ?? [])].filter(
  (name) => !canonicalDefaultsTexts.has(name),
);
const defaultsChanged =
  defaultsTexts === null || staleDefaultsShards.length > 0 || orphanDefaultsShards.length > 0;
if (defaultsChanged && CHECK) {
  console.error(`\n❌ ${DEFAULTS_DIR_LABEL} is out of date or hand-edited (#4666).`);
  for (const name of staleDefaultsShards) {
    console.error(`     ~ ${AUTHORABLE_DEFAULTS_DIR_NAME}/${name}.json  (stale)`);
  }
  for (const name of orphanDefaultsShards) {
    console.error(`     - ${AUTHORABLE_DEFAULTS_DIR_NAME}/${name}.json  (no default in this category)`);
  }
  console.error(
    `\n   Any CHANGE to an existing key's default already exited above, so reaching here means\n` +
      `   the record is behind on a NEW key's default, or its bytes are not what the generator\n` +
      `   writes. Run \`pnpm --filter @objectstack/spec gen:schema\` and commit the result.`,
  );
  process.exit(1);
}
if (defaultsChanged && !CHECK) {
  const { written, removed } = writeShards(AUTHORABLE_DEFAULTS_DIR, canonicalDefaultsTexts);
  console.log(
    `\n🎚️  ${DEFAULTS_DIR_LABEL} ${defaultsTexts ? 'updated' : 'created'} (${currentDefaults.size} defaults) — commit it.` +
      (written.length > 0 ? `\n     touched: ${written.map((n) => `${n}.json`).join(', ')}` : '') +
      (removed.length > 0 ? `\n     removed: ${removed.map((n) => `${n}.json`).join(', ')}` : ''),
  );
}

// ─── Generate Bundled Schema ─────────────────────────────────────────
// Single-file bundled schema containing all generated schemas for IDE autocomplete

// Assemble bundled $defs from the in-memory map populated during generation.
// (Avoid re-reading the json-schema/ tree to dodge CI filesystem races.)
//
// Assembled BEFORE the envelope, so `x-schema-count` below is taken from what
// this bundle actually carries (#12588). It used to be `count`, the per-EMIT
// counter, while `$defs` is keyed by def key — so every self-aliased key
// reported above widened the gap, and the published artifact declared 1596
// definitions while shipping 1585. A self-describing artifact counts what it
// contains; the emit total is a property of the build, not of the file, and is
// still reported on the summary line at the end of this script.
const defs: Record<string, unknown> = {};
for (const [defKey, schema] of generatedSchemas) {
  defs[defKey] = schema;
}

const bundledSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${SCHEMA_BASE_URL}/objectstack.json`,
  title: 'ObjectStack Protocol',
  description: `ObjectStack Protocol v${SPEC_VERSION} — Complete bundled JSON Schema for IDE autocomplete`,
  'x-spec-version': SPEC_VERSION,
  'x-schema-count': Object.keys(defs).length,
  $defs: defs,
};

const bundledPath = path.join(OUT_DIR, 'objectstack.json');
writeFileWithRetry(bundledPath, JSON.stringify(bundledSchema, null, 2));
console.log(`\n✅ Generated bundled schema: objectstack.json (${Object.keys(defs).length} definitions)`);

console.log(`\n✅ Successfully generated ${count} schemas.`);

