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
import { RENAMED_DEFS, carryAuthorableKey, checkRenameTable } from './lib/renamed-defs';
import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import {
  MIGRATIONS_BY_MAJOR,
  RETIRED_DEFS_BY_MAJOR,
  RETIRED_KEYS_BY_MAJOR,
} from '../src/migrations/registry';
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

const OUT_DIR = path.resolve(__dirname, '../json-schema');
// Ratchet manifest: the committed record of every schema key this script has
// ever emitted. json-schema/ itself is a gitignored build artifact, so this
// file is the durable "last time" — see the disappearance check below (#2978).
const MANIFEST_PATH = path.resolve(__dirname, '../json-schema.manifest.json');
// Three modes, one code path:
//
//   (default)       `gen:schema` — regenerate json-schema/ and, when they are
//                   behind, the two committed PROJECTIONS of this source:
//                   json-schema.manifest.json and authorable-surface.json.
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
// `json-schema.manifest.json` and `authorable-surface.json` are projections of
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

// Clean output directory ensures no stale files remain
if (fs.existsSync(OUT_DIR)) {
  console.log(`Cleaning output directory: ${OUT_DIR}`);

  // Use a more robust cleanup with multiple retries and longer delays
  // to handle filesystem race conditions in CI environments
  for (let attempt = 0; attempt < MAX_RETRIES * 2; attempt++) {
    try {
      // Try removing with native Node.js rmSync
      if (fs.existsSync(OUT_DIR)) {
        fs.rmSync(OUT_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: RETRY_DELAY_BASE_MS * 2 });
      }

      // Verify the directory is actually gone
      if (!fs.existsSync(OUT_DIR)) {
        break;
      }

      // If still exists, wait before retrying with exponential backoff
      sleepSync(RETRY_DELAY_BASE_MS * (attempt + 1));
    } catch (error) {
      // If this is the last attempt, log but continue (we'll try to work with what's there)
      if (attempt === (MAX_RETRIES * 2 - 1)) {
        console.warn(`Warning: Failed to fully clean directory after ${attempt + 1} attempts:`, error);
        // Try to continue anyway - ensureDir will create missing parts
        break;
      }
      // Wait before retry with exponential backoff
      sleepSync(RETRY_DELAY_BASE_MS * (attempt + 1));
    }
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

// ─── Ratchet: a published schema must never silently disappear ────────
// json-schema/ is a public contract surface (IDE validation, gen:docs input,
// $id URLs under schema.objectstack.io). The manifest is the committed record
// of every schema key ever emitted; a key present there but absent from this
// run means a code change unpublished a schema — fail loudly instead of
// letting gen:docs quietly delete its reference docs (#2978). Deliberate
// removals must delete the key from the manifest in the same PR.
interface SchemaManifest {
  description?: string;
  schemas: string[];
}

/**
 * The manifest's own description — the procedure a reader who opens the file to
 * delete a line follows. Until #4725 it ended "remove a key ONLY for a
 * deliberate retirement", which was the entire requirement and was checked by
 * nothing; it now names the gate and the table that answer for a removal.
 */
const MANIFEST_DESCRIPTION =
  'Ratchet manifest of every JSON Schema emitted by scripts/build-schemas.ts. ' +
  'Auto-appended when new schemas are added (commit the change). A listed schema that a ' +
  'build no longer emits fails gen:schema. DELETING a key is gated too (#4725): the removal ' +
  'is measured against this file at the merge base with origin/main — which the commit under ' +
  'test cannot rewrite — and every def that leaves the published set must be declared in ' +
  'RETIRED_DEFS_BY_MAJOR (src/migrations/registry.ts), or in RENAMED_DEFS ' +
  '(scripts/lib/renamed-defs.ts) when it is a rename rather than a removal. See #2978, #4725.';

let manifest: SchemaManifest | null = null;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as SchemaManifest;
} catch (error) {
  // A missing manifest just means first run (bootstrap below); anything else
  // (unreadable, invalid JSON) must fail rather than silently drop the ratchet.
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.error(`\n❌ Failed to read ${MANIFEST_PATH}: ${error}`);
    process.exit(1);
  }
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

const missing = (manifest?.schemas ?? []).filter(
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
    `\n   A schema listed in json-schema.manifest.json was not emitted. This usually means a\n` +
    `   Zod change made it unrepresentable (e.g. an added .transform in "output" AND "input"\n` +
    `   io modes) or an export was renamed/removed. Fix the schema, or — if the removal is\n` +
    `   deliberate — delete the key(s) from packages/spec/json-schema.manifest.json in the\n` +
    `   same PR AND declare each one in RETIRED_DEFS_BY_MAJOR (src/migrations/registry.ts),\n` +
    `   which the manifest deletion gate below requires (#4725). Deleting the line alone\n` +
    `   used to be the whole procedure, and nothing checked it. Silently unpublishing a\n` +
    `   schema deletes its reference docs on the next gen:docs run (see #2978).`,
  );
  process.exit(1);
}

const added = [...generatedKeys].filter((key) => !(manifest?.schemas ?? []).includes(key));
// A renamed-away source key must be dropped from the manifest even in the (rare)
// case where the new name adds nothing — e.g. a rename onto a def that already
// existed. Without this the stale key would sit in the manifest forever, kept
// alive only by its RENAMED_DEFS entry.
const renamedAway = (manifest?.schemas ?? []).filter((key) => key in RENAMED_DEFS);
// The file's own description states the procedure for deleting a key, and #4725
// changed that procedure from "do it deliberately" to "declare it in
// RETIRED_DEFS_BY_MAJOR". A generated file that documents a superseded procedure
// is read by whoever opens it to delete a line — precisely the reader the gate
// exists for — so the text is part of the artifact and drifting from it is
// staleness like any other. Reported separately below: "0 schema(s) not
// recorded" would be a confusing way to say the prose moved.
const descriptionStale = !!manifest && manifest.description !== MANIFEST_DESCRIPTION;
const manifestChanged = !manifest || added.length > 0 || renamedAway.length > 0 || descriptionStale;
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
  const onlyDescription = manifest && added.length === 0 && renamedAway.length === 0;
  console.error(
    !manifest
      ? `\n❌ json-schema.manifest.json is missing (${generatedKeys.size} schema(s) unrecorded).`
      : onlyDescription
        ? `\n❌ json-schema.manifest.json carries a stale description (the key set is current).`
        : `\n❌ json-schema.manifest.json is out of date (${added.length} schema(s) not recorded` +
            `${renamedAway.length > 0 ? `, ${renamedAway.length} renamed-away key(s) still listed` : ''}).`,
  );
  for (const key of added.slice(0, 20)) console.error(`     + json-schema/${key}.json`);
  if (added.length > 20) console.error(`     … and ${added.length - 20} more`);
  for (const key of renamedAway) console.error(`     - json-schema/${key}.json  (renamed away)`);
  console.error(
    `\n   Run \`pnpm --filter @objectstack/spec gen:schema\` and commit the result. A schema\n` +
    `   absent from the manifest is one this ratchet can never report as disappeared later,\n` +
    `   because it was never in the baseline (#2978).`,
  );
  process.exit(1);
}
if (manifestChanged && !CHECK) {
  const updated: SchemaManifest = {
    description: MANIFEST_DESCRIPTION,
    schemas: [...generatedKeys].sort(),
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(updated, null, 2) + '\n');
  const what = !manifest
    ? `created (${generatedKeys.size} schemas)`
    : added.length > 0 || renamedAway.length > 0
      ? `updated (+${added.length} schema(s))`
      : 'description refreshed (key set unchanged)';
  console.log(`\n📒 json-schema.manifest.json ${what} — commit it.`);
}

// ─── Authorable-surface ratchet (#3855 follow-up) ────────────────────
//
// The sibling manifest above ratchets whole SCHEMAS. Nothing ratchets the KEYS
// inside them — and for a metadata-driven platform those keys ARE the
// third-party API: what an author (very often an AI, ADR-0033) may write.
//
// Both existing witnesses look elsewhere. `api-surface.json` records exported
// `name (kind)`, and `api-surface-signatures.json` hashes each `defineX`
// factory's type as TypeScript PRINTS it — a reference (`z.input<typeof
// ActionSchema>`), never structurally expanded, so member-level narrowing does
// not reach the hash. `spec-changes.json` inherits the same blind spot: its
// added/removed arrays are a diff of `api-surface.json`. So #3883 removed three
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
const AUTHORABLE_SURFACE_PATH = path.resolve(__dirname, '../authorable-surface.json');
// The in-tree anchor the deletion gate falls back to when this build environment
// cannot reach GitHub (#5235). See resolveSurfaceBase() below for the full story.
const AUTHORABLE_SURFACE_BASE_PATH = path.resolve(__dirname, '../authorable-surface.base.json');
const SURFACE_FILE_NAME = path.basename(AUTHORABLE_SURFACE_PATH);
const SURFACE_BASE_FILE_NAME = path.basename(AUTHORABLE_SURFACE_BASE_PATH);
// `REANCHOR_COMMAND` — the ONE command that writes this file — is declared near
// the top of this script, next to the `--update-base` flag it names: the merge
// refusal there quotes it, and that refusal runs before anything here (#5370).
const RETIRED_MARK = ' [RETIRED]';

interface AuthorableSurface { description: string; keys: string[] }

/**
 * The committed mirror of `authorable-surface.json` as it stood at an UPSTREAM
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

let surfaceRaw: string | null = null;
let surfaceDoc: AuthorableSurface | null = null;
if (fs.existsSync(AUTHORABLE_SURFACE_PATH)) {
  surfaceRaw = fs.readFileSync(AUTHORABLE_SURFACE_PATH, 'utf-8');
  surfaceDoc = JSON.parse(surfaceRaw) as AuthorableSurface;
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
// Checks (a0)/(a)/(b) read authorable-surface.json from THIS commit — a file
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
//   1. aged-out tombstone — the base entry carried `[RETIRED]` AND its surface
//      is registered in CONVERSIONS_BY_MAJOR / MIGRATIONS_BY_MAJOR at a major
//      ≥ TOMBSTONE_AGE_MAJORS behind the current one (the "~two majors" this
//      file's description has always promised, now enforced);
//   2. the def is not reachable from the metadata-type roots (2026-08-02
//      ruling on #4650): no metadata document is ever parsed by it, so its
//      entry was over-collection and there is no author to tombstone for.
//      This waives ONLY this file's tombstone requirement — it is NOT a
//      license to change the schema (plugin manifests, connector configs and
//      other non-metadata authoring go through their own gates);
//   3. the whole def is no longer emitted — whole-schema removals are
//      adjudicated by the json-schema.manifest.json ratchet (#2978), not by
//      this per-key ratchet. Until #4725 that deferral was to nothing: the
//      ratchet's `missing` set was computed from the same-commit manifest, so
//      deleting the line deleted the evidence, exactly as hand-editing this
//      file did before #4650. The manifest deletion gate below now anchors that
//      comparison on the merge base and demands a declared removal, and it runs
//      BEFORE this check so the deferral resolves to a real verdict.

/** A tombstone may be deleted once its registration is this many majors old. */
const TOMBSTONE_AGE_MAJORS = 2;

/**
 * Every ' / '-separated surface clause registered across the ADR-0087
 * registries, mapped to the EARLIEST major that registered it — the moment the
 * retirement became visible to consumers, which is when its aging clock
 * started.
 *
 * This is now the LAST leaf-name matcher in this file: check (b) above moved to
 * exact `${defKey}:${name}` membership in RETIRED_KEYS_BY_MAJOR (#4659). Check
 * (c) cannot follow it there, because it adjudicates tombstones that predate
 * that table and were deliberately not backfilled into it — so the aging proof
 * still reads the conversion clauses, leaf and all, and inherits the same
 * coincidence (an unrelated cluster's `.type` can date a tombstone's clock).
 * Narrowing it needs the historical mapping #4659 would have had to invent —
 * all 97 current tombstones predate that table — so it is tracked in #5898.
 */
function registeredClauseMajors(): Map<string, number> {
  const out = new Map<string, number>();
  const add = (clause: string, major: number): void => {
    const prev = out.get(clause);
    if (prev === undefined || major < prev) out.set(clause, major);
  };
  for (const [major, list] of Object.entries(CONVERSIONS_BY_MAJOR)) {
    for (const c of list) for (const clause of c.surface.split(' / ')) add(clause, Number(major));
  }
  for (const [major, step] of Object.entries(MIGRATIONS_BY_MAJOR)) {
    for (const sem of step.semantic ?? []) {
      for (const clause of sem.surface.split(' / ')) add(clause, Number(major));
    }
  }
  return out;
}

function zodDefOf(schema: z.ZodType): Record<string, unknown> | null {
  const def = (schema as unknown as { _zod?: { def?: unknown } })._zod?.def;
  return def && typeof def === 'object' ? (def as Record<string, unknown>) : null;
}

/**
 * Every Zod schema instance a node's def references directly: shape values,
 * union options, pipe in/out, record key/value, array element, wrapper inner
 * types — found by walking the def's plain objects/arrays generically instead
 * of enumerating node kinds (which would silently miss the next kind Zod
 * adds). Two edges a generic def walk cannot see are added explicitly:
 * `z.lazy` hides its target behind `getter()`, and check-clones (`.refine()`,
 * `.describe()`, …) point back at the schema they cloned via `_zod.parent` —
 * the clone is what a parent schema embeds (`ViewSchema.refine(…)` inside
 * ViewMetadataSchema), while the BASELINE def is the original.
 */
function zodChildSchemas(schema: z.ZodType): z.ZodType[] {
  const out: z.ZodType[] = [];
  const def = zodDefOf(schema);
  if (!def) return out;
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (v instanceof z.ZodType) {
      out.push(v);
      return;
    }
    if (typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v instanceof Map) {
      for (const x of v.values()) walk(x);
      return;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(def);
  if (def.type === 'lazy' && typeof def.getter === 'function') {
    try {
      const inner = (def.getter as () => unknown)();
      if (inner instanceof z.ZodType) out.push(inner);
    } catch {
      // An unresolvable lazy getter has no graph to traverse; the schema it
      // would have produced cannot be parsed against either.
    }
  }
  const parent = (schema as unknown as { _zod?: { parent?: unknown } })._zod?.parent;
  if (parent instanceof z.ZodType) out.push(parent);
  return out;
}

/** Unwrap pipes/wrappers/lazies down to a plain object def's shape, if any. */
function zodShapeOf(schema: z.ZodType, depth = 0): Record<string, unknown> | null {
  if (depth > 12) return null;
  const def = zodDefOf(schema);
  if (!def) return null;
  if (def.type === 'object') {
    const shape = def.shape;
    return shape && typeof shape === 'object' ? (shape as Record<string, unknown>) : null;
  }
  if (def.type === 'pipe' && def.in instanceof z.ZodType) return zodShapeOf(def.in, depth + 1);
  if (def.type === 'lazy' && typeof def.getter === 'function') {
    try {
      const inner = (def.getter as () => unknown)();
      if (inner instanceof z.ZodType) return zodShapeOf(inner, depth + 1);
    } catch {
      return null;
    }
  }
  const wrappers = new Set(['optional', 'nullable', 'default', 'catch', 'readonly', 'nonoptional']);
  if (typeof def.type === 'string' && wrappers.has(def.type) && def.innerType instanceof z.ZodType) {
    return zodShapeOf(def.innerType, depth + 1);
  }
  return null;
}

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
  'keys in authorable-surface.json as they stood at `baseRev`, a commit on origin/main. A build that ' +
  'CAN reach origin/main anchors on the merge base instead, and re-verifies this file against ' +
  '`baseRev` — so a PR that edits it to hide a deletion goes red wherever the network exists. A build ' +
  'that CANNOT reach GitHub (image-build stages, air-gapped, fork, historical-tag reproduction) ' +
  'anchors here instead of failing. Written only by `gen:schema`, only from a git-resolved baseline — ' +
  'never from the build that is being checked. See #5235.';

/** Canonical bytes of the in-tree anchor — the one form the generator writes. */
function serializeSurfaceBase(baseRev: string, keys: string[]): string {
  const doc: AuthorableSurfaceBase = { description: SURFACE_BASE_DESCRIPTION, baseRev, keys };
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * The committed in-tree anchor, or null when the file is absent.
 *
 * Malformed or non-canonical bytes are fatal in BOTH modes, deliberately: this
 * file exists to be the baseline a commit cannot rewrite, so a hand-edit here is
 * the #4650 attack itself, not a formatting slip to repair silently (#4662 made
 * the same call for authorable-surface.json). Regenerating it needs origin/main,
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

type GitRun = (...args: string[]) => { status: number | null; stdout: string; stderr: string };

/**
 * Git, run in the package directory — the one runner every check below shares
 * (`resolveSurfaceBase()` used to hold a private copy of it; the anchor's
 * monotonicity guard needs the same one, at a different point in the script).
 */
const gitInPackage: GitRun = (...args: string[]) =>
  // A network-less environment that BLACKHOLES rather than refuses (proxied
  // air gaps do) would otherwise hang the whole build in the self-heal fetch.
  spawnSync('git', args, {
    cwd: path.dirname(AUTHORABLE_SURFACE_PATH),
    encoding: 'utf-8' as const,
    timeout: 60_000,
  });

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
 *   2. the recorded keys ARE that commit's `authorable-surface.json` keys. This
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
  // already in hand — no object lookup, and no ancestry question either (that
  // rev IS origin/main's merge base or tip).
  if (rev === resolved.rev) {
    compareAnchorKeys(resolved.keys, committed, short, fix);
    return;
  }

  let present = git('cat-file', '-e', `${rev}^{commit}`).status === 0;
  if (!present) {
    // Shallow checkout (CI's typecheck job): ask the remote for that one commit.
    git('fetch', '--quiet', '--depth=1', 'origin', rev);
    present = git('cat-file', '-e', `${rev}^{commit}`).status === 0;
  }
  if (!present) {
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
  // change's own first CI run). Ask whether the answer can mean anything first.
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    console.log(
      `ℹ️  ${SURFACE_BASE_FILE_NAME}: shallow checkout — cannot walk history to confirm ${short} is\n` +
        `   on origin/main, so only its recorded keys are verified here (#5235). A full clone checks both.`,
    );
  } else if (git('merge-base', '--is-ancestor', rev, tip).status !== 0) {
    console.error(
      `\n❌ ${SURFACE_BASE_FILE_NAME} names a baseRev (${short}) that is NOT an ancestor of\n` +
        `   origin/main (#5235).\n\n` +
        `   The anchor for the #4650 deletion gate has to be a baseline this commit cannot rewrite,\n` +
        `   so it may only mirror an already-merged upstream commit. A rev off origin/main is either\n` +
        `   a local commit (which the PR does control) or a rewritten history.\n\n${fix}`,
    );
    process.exit(1);
  }
  const show = git('show', `${rev}:./${SURFACE_FILE_NAME}`);
  if (show.status !== 0) {
    console.error(
      `\n❌ ${SURFACE_BASE_FILE_NAME} names baseRev ${short}, which has no ${SURFACE_FILE_NAME}\n` +
        `   to mirror (#5235):\n${show.stderr}\n${fix}`,
    );
    process.exit(1);
  }
  let upstreamKeys: string[];
  try {
    upstreamKeys = (JSON.parse(show.stdout) as AuthorableSurface).keys ?? [];
  } catch (error) {
    console.error(`\n❌ ${SURFACE_FILE_NAME} at ${short} is not valid JSON (#5235): ${error}`);
    process.exit(1);
  }
  compareAnchorKeys(upstreamKeys, committed, short, fix);
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
 * Three exit codes from `merge-base --is-ancestor`, and they must be read as
 * three answers, not two: 0 is "ancestor", 1 is "not an ancestor", and anything
 * else (128 with a `fatal:`, or `null` from the timeout) is git declining to
 * answer. Folded into a `&&`/`||` chain the third collapses into the second and
 * an ERROR becomes a verdict — the trap cloud#1116 paid for. Here it fails
 * CLOSED: an ancestry nobody could establish refuses the write.
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

  const probe = git('merge-base', '--is-ancestor', committedRev, resolvedRev);
  // Reachability was demonstrated. Truncation cannot fake that, so this is the
  // one answer that stands in every checkout, shallow included.
  if (probe.status === 0) return;
  if (probe.status !== 1) {
    return refuseIndeterminate(
      `\`git merge-base --is-ancestor ${from} ${to}\` did not answer (exit ${probe.status}):\n` +
        `   ${(probe.stderr || '').trim().split('\n')[0] || '(no output)'}`,
    );
  }
  // A negative, on the other hand, is only meaningful where history is WALKABLE —
  // the same truncation `verifyCommittedSurfaceBase` accounts for. There it SKIPS
  // a verification, which is safe; here it would BLESS a write, which is not.
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    return refuseIndeterminate(
      'This is a shallow checkout: history is truncated, so `merge-base --is-ancestor` reports\n' +
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
 * Set when THIS run resolved the baseline from git. It is the ONLY input
 * `--update-base` may write the in-tree anchor from: an offline build must never
 * be able to advance the anchor to its own state (#5235). The second half of that
 * discipline is #5358 — no build writes it at all, only the explicit mode.
 */
let gitResolvedAnchor: { rev: string; keys: string[] } | null = null;

/**
 * The committed authorable-surface.json this PR started from: its content at
 * the merge base of HEAD and origin/main. Returns null (with a note) only
 * when no baseline existed there at all; failure to ANCHOR the base is fatal —
 * a deletion check that silently skips is the #4650 bypass with extra steps.
 *
 * Two anchors, in strict preference order (#5235):
 *
 *   `merge-base` — origin/main is reachable (every dev checkout, every CI run).
 *      Unchanged from #4650: the baseline is read out of git at the merge base,
 *      and the in-tree anchor is additionally VERIFIED against it here, which is
 *      what makes that file trustworthy in the environments that cannot check.
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
function resolveSurfaceBase(): { rev: string; doc: AuthorableSurface } | null {
  const git = gitInPackage;
  const committed = readCommittedSurfaceBase();

  // CI's typecheck job checks out shallow with no branch refs, so fetch the
  // one ref this check needs (depth 1 — a single snapshot) before giving up.
  let tipProbe = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}');
  if (tipProbe.status !== 0) {
    git('fetch', '--quiet', '--depth=1', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    tipProbe = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}');
  }

  if (tipProbe.status === 0) {
    const tip = tipProbe.stdout.trim();
    // Merge base, so a branch behind origin/main is compared against what it
    // FORKED from (keys added on main since then are not "deleted" here). In a
    // shallow clone there is no walkable ancestry — fall back to the tip, which
    // on a PR's synthetic merge commit is the merge base anyway.
    const mergeBase = git('merge-base', 'HEAD', tip);
    const rev = mergeBase.status === 0 ? mergeBase.stdout.trim() : tip;
    if (mergeBase.status !== 0) {
      console.log(`   (shallow history — using origin/main tip ${tip.slice(0, 12)} as the baseline anchor)`);
    }
    const show = git('show', `${rev}:./${SURFACE_FILE_NAME}`);
    if (show.status !== 0) {
      if (/does not exist in|exists on disk, but not in/.test(show.stderr)) {
        console.log(
          `ℹ️  authorable-surface deletion check: no ${SURFACE_FILE_NAME} at base ${rev.slice(0, 12)} — nothing to compare.`,
        );
        return null;
      }
      console.error(
        `\n❌ Failed to read ${SURFACE_FILE_NAME} at base ${rev.slice(0, 12)} (#4650):\n${show.stderr}`,
      );
      process.exit(1);
    }
    let doc: AuthorableSurface;
    try {
      doc = JSON.parse(show.stdout) as AuthorableSurface;
    } catch (error) {
      console.error(`\n❌ ${SURFACE_FILE_NAME} at base ${rev.slice(0, 12)} is not valid JSON (#4650): ${error}`);
      process.exit(1);
    }
    gitResolvedAnchor = { rev, keys: doc.keys ?? [] };
    // The environment that CAN police the in-tree anchor is the one that must.
    if (committed) verifyCommittedSurfaceBase(git, tip, gitResolvedAnchor, committed.doc);
    return { rev, doc };
  }

  if (committed) {
    console.log(
      `\nℹ️  origin/main is not resolvable in this build environment — anchoring the authorable-surface\n` +
        `   deletion check (#4650) on the committed ${SURFACE_BASE_FILE_NAME}: ${SURFACE_FILE_NAME}\n` +
        `   as of ${committed.doc.baseRev.slice(0, 12)}, verified upstream when it landed (#5235).`,
    );
    return {
      rev: committed.doc.baseRev,
      doc: { description: committed.doc.description, keys: committed.doc.keys },
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
// json-schema.manifest.json". They were not. That ratchet's `missing` set is
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
// json-schema.manifest.json at the merge base with origin/main, which the commit
// under test cannot rewrite. The proof demanded there is a DECLARATION —
// RETIRED_DEFS_BY_MAJOR — and deliberately not reachability, which #4650 uses
// per key. Reachability is keyed by `zodByDefKey`, populated only for defs this
// build EMITS, so `reachableVia()` answers `null` ("unreachable", i.e. waived)
// for every def that just stopped being emitted — a green light aimed exactly at
// the removals this gate is for. That is not a bug to fix by widening the BFS:
// the def is gone from the source, so there is no schema left to walk.

/** The manifest file, by name — what every message here points the reader at. */
const MANIFEST_FILE_NAME = path.basename(MANIFEST_PATH);

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
  const show = git('show', `${baseRev}:./${MANIFEST_FILE_NAME}`);
  if (show.status !== 0) {
    if (/does not exist in|exists on disk, but not in/.test(show.stderr)) {
      console.log(
        `ℹ️  ${MANIFEST_FILE_NAME} removal check: no ${MANIFEST_FILE_NAME} at base ${short} — nothing to compare.`,
      );
      return;
    }
    console.error(`\n❌ Failed to read ${MANIFEST_FILE_NAME} at base ${short} (#4725):\n${show.stderr}`);
    process.exit(1);
  }
  let baseSchemas: string[];
  try {
    baseSchemas = (JSON.parse(show.stdout) as SchemaManifest).schemas ?? [];
  } catch (error) {
    console.error(`\n❌ ${MANIFEST_FILE_NAME} at base ${short} is not valid JSON (#4725): ${error}`);
    process.exit(1);
  }

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

{
  const base = resolveSurfaceBase();
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
      const clauseMajors = registeredClauseMajors();
      const reachability = computeSurfaceReachability();
      const allowed: string[] = [];
      const violations: string[] = [];
      const goneDefs = new Map<string, number>(); // def no longer emitted -> deleted key count
      for (const key of deletedKeys) {
        const sep = key.indexOf(':');
        const defKey = key.slice(0, sep);
        const prop = key.slice(sep + 1);
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
        const matches = [...clauseMajors.entries()].filter(([clause]) => clause.endsWith('.' + prop));
        if (matches.length === 0) {
          violations.push(
            `${key} — def ${how}; tombstoned, but no conversion/migration clause matching '.${prop}'\n` +
              `       is registered in the ADR-0087 registries, so the retirement never reached\n` +
              `       spec-changes.json or \`os migrate meta\`.`,
          );
          continue;
        }
        const registeredAt = Math.min(...matches.map(([, major]) => major));
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
            `       removals are adjudicated by json-schema.manifest.json (#2978) — since #4725 by the\n` +
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
          `\n   authorable-surface.json is generated evidence, not an editable list: deleting a\n` +
            `   line deletes exactly what check (a) above needs to see — #4638 and #4643 both\n` +
            `   removed authorable keys that way with a green gate. Deletions are therefore\n` +
            `   compared against the baseline at merge base ${baseRev} with origin/main,\n` +
            `   which this commit cannot rewrite.\n\n` +
            `   A line may only leave this file when:\n` +
            `     1. its key was tombstoned (\`retiredKey()\` → "[RETIRED]") with a D2 conversion\n` +
            `        (src/conversions/registry.ts) or migration step registered for its surface,\n` +
            `        AND that registration is ≥ ${TOMBSTONE_AGE_MAJORS} majors old (≤ v${CURRENT_MAJOR - TOMBSTONE_AGE_MAJORS}); or\n` +
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
      const recorded = new Set(committed.doc.keys);
      const behind = anchor.keys.filter((k) => !recorded.has(k)).length;
      console.log(
        `ℹ️  ${SURFACE_BASE_FILE_NAME} trails the baseline at ${anchor.rev.slice(0, 12)} by ${behind} key(s)\n` +
          `   — expected, and not an error: the anchor is a snapshot of an upstream commit, proved\n` +
          `   AUTHENTIC rather than current. Re-anchoring is a deliberate act with its own reviewed\n` +
          `   diff — \`${REANCHOR_COMMAND}\` — never a side effect of this build (#5358).`,
      );
    }
  }
}

// The whole FILE is compared against its canonical serialization, not just the
// key array. #4662 caught a hand-normalized description dash the keys-only
// comparison could never see — proof the file's content was not this script's
// output. Any non-generated byte is a hand-edit (or a stale writer), and
// hand-edits are exactly how deletions hid from check (a) (#4650, comment 2).
const canonicalSurface: AuthorableSurface = {
  description:
    'Ratchet of every AUTHORABLE key in the spec — what a metadata author may write, which ' +
    'for this platform IS the third-party API. Auto-updated on additions (commit the change). ' +
    'A key that disappears without a tombstone fails gen:schema, because these schemas are ' +
    'not .strict() and Zod would silently strip it. "[RETIRED]" marks a tombstoned key that ' +
    'still rejects with an upgrade prescription. See #3855, ADR-0059 §5.',
  keys: currentEntries,
};
const canonicalSurfaceText = JSON.stringify(canonicalSurface, null, 2) + '\n';
const surfaceChanged = surfaceRaw !== canonicalSurfaceText;
if (surfaceChanged && CHECK) {
  // Removals already exited above; reaching here in check mode means the snapshot
  // is behind on ADDITIONS, or differs without any key change at all — a hand-edit.
  const before = new Set(surfaceDoc?.keys ?? []);
  const addedKeys = currentEntries.filter((k) => !before.has(k));
  if (addedKeys.length > 0) {
    console.error(
      `\n❌ authorable-surface.json is out of date (${addedKeys.length} key(s) not recorded).`,
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
      `\n❌ authorable-surface.json does not match its generated form (key set unchanged).`,
    );
    console.error(
      `\n   The recorded keys are current, but the file's bytes are not what gen:schema\n` +
      `   writes — a hand-edit or stale formatting (#4662 found a manually normalized\n` +
      `   description dash exactly this way; see #4650). This file is generated evidence:\n` +
      `   every difference must come from the generator.\n\n` +
      `   Run \`pnpm --filter @objectstack/spec gen:schema\` and commit the result.`,
    );
  }
  process.exit(1);
}
if (surfaceChanged && !CHECK) {
  fs.writeFileSync(AUTHORABLE_SURFACE_PATH, canonicalSurfaceText);
  console.log(
    `\n🔑 authorable-surface.json ${surfaceDoc ? 'updated' : 'created'} (${currentEntries.length} keys) — commit it.`,
  );
}

// ─── Generate Bundled Schema ─────────────────────────────────────────
// Single-file bundled schema containing all generated schemas for IDE autocomplete

const bundledSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${SCHEMA_BASE_URL}/objectstack.json`,
  title: 'ObjectStack Protocol',
  description: `ObjectStack Protocol v${SPEC_VERSION} — Complete bundled JSON Schema for IDE autocomplete`,
  'x-spec-version': SPEC_VERSION,
  'x-schema-count': count,
  $defs: {} as Record<string, unknown>,
};

const defs = bundledSchema.$defs as Record<string, unknown>;

// Assemble bundled $defs from the in-memory map populated during generation.
// (Avoid re-reading the json-schema/ tree to dodge CI filesystem races.)
for (const [defKey, schema] of generatedSchemas) {
  defs[defKey] = schema;
}

const bundledPath = path.join(OUT_DIR, 'objectstack.json');
writeFileWithRetry(bundledPath, JSON.stringify(bundledSchema, null, 2));
console.log(`\n✅ Generated bundled schema: objectstack.json (${Object.keys(defs).length} definitions)`);

console.log(`\n✅ Successfully generated ${count} schemas.`);
