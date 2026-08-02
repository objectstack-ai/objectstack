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
import { MIGRATIONS_BY_MAJOR } from '../src/migrations/registry';
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
// `--check` verifies the two committed snapshots — the schema manifest and the
// authorable surface — without rewriting either, so CI fails on an uncommitted
// ADDITION too (the write and check paths share the same code — same discipline
// as build-docs.ts). "Without rewriting" is load-bearing on both: a check that
// repairs what it detects can never report it, and it silently edits the tree of
// whoever ran it (#4711).
const CHECK = process.argv.includes('--check');
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
    `   same PR. Silently unpublishing a schema deletes its reference docs on the next\n` +
    `   gen:docs run (see #2978).`,
  );
  process.exit(1);
}

const added = [...generatedKeys].filter((key) => !(manifest?.schemas ?? []).includes(key));
// A renamed-away source key must be dropped from the manifest even in the (rare)
// case where the new name adds nothing — e.g. a rename onto a def that already
// existed. Without this the stale key would sit in the manifest forever, kept
// alive only by its RENAMED_DEFS entry.
const renamedAway = (manifest?.schemas ?? []).filter((key) => key in RENAMED_DEFS);
const manifestChanged = !manifest || added.length > 0 || renamedAway.length > 0;
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
  console.error(
    manifest
      ? `\n❌ json-schema.manifest.json is out of date (${added.length} schema(s) not recorded` +
          `${renamedAway.length > 0 ? `, ${renamedAway.length} renamed-away key(s) still listed` : ''}).`
      : `\n❌ json-schema.manifest.json is missing (${generatedKeys.size} schema(s) unrecorded).`,
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
    description:
      'Ratchet manifest of every JSON Schema emitted by scripts/build-schemas.ts. ' +
      'Auto-appended when new schemas are added (commit the change). A listed schema that a ' +
      'build no longer emits fails gen:schema — remove a key ONLY for a deliberate retirement. See #2978.',
    schemas: [...generatedKeys].sort(),
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(updated, null, 2) + '\n');
  console.log(
    `\n📒 json-schema.manifest.json ${manifest ? `updated (+${added.length} schema(s))` : `created (${generatedKeys.size} schemas)`} — commit it.`,
  );
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
const RETIRED_MARK = ' [RETIRED]';

interface AuthorableSurface { description: string; keys: string[] }

/** `retiredKey()` is `z.never()`, which Zod renders as `{ "not": {} }`. */
function isRetired(prop: unknown): boolean {
  if (!prop || typeof prop !== 'object') return false;
  const not = (prop as Record<string, unknown>).not;
  return !!not && typeof not === 'object' && Object.keys(not).length === 0;
}

/** Every conversion/migration surface registered across the ADR-0087 registries. */
function registeredRetirementSurfaces(): string[] {
  const out: string[] = [];
  for (const list of Object.values(CONVERSIONS_BY_MAJOR)) {
    for (const c of list) out.push(c.surface);
  }
  for (const step of Object.values(MIGRATIONS_BY_MAJOR)) {
    for (const sem of step.semantic ?? []) out.push(sem.surface);
  }
  return out;
}

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
  const newlyRetired = [...currentKeys.entries()]
    .filter(([k, retired]) => retired && prev.get(k) === false)
    .map(([k]) => k);
  if (newlyRetired.length > 0) {
    // A multi-key conversion names its keys as ' / '-separated clauses
    // (`'flow.active / flow.template / …'` — the house style since the tool
    // sweep), so split before matching: every clause must still END with the
    // key, which keeps the check exactly as strict per key as before.
    const surfaces = registeredRetirementSurfaces().flatMap((s) => s.split(' / '));
    const unregistered = newlyRetired.filter(
      (k) => !surfaces.some((s) => s.endsWith('.' + k.split(':')[1])),
    );
    if (unregistered.length > 0) {
      console.error(`\n❌ ${unregistered.length} key(s) were tombstoned with no registered migration:`);
      for (const k of unregistered) console.error(`     - ${k}`);
      console.error(
        `\n   The tombstone makes the removal audible to whoever hits it, but the change\n` +
        `   documentation is the primary channel and it is still empty: spec-changes.json\n` +
        `   (ADR-0087 D4) is a projection of the conversion + migration registries, and the\n` +
        `   generated upgrade guide and the \`spec_changes\` MCP tool are projections of that.\n` +
        `   Without an entry a consumer only learns of this by failing.\n\n` +
        `   Add a D2 conversion in src/conversions/registry.ts naming the surface (and a D3\n` +
        `   chain step referencing it) so \`os migrate meta\` rewrites their source.`,
      );
      process.exit(1);
    }
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
//      adjudicated by the json-schema.manifest.json ratchet (#2978) and
//      check:api-surface, not by this per-key ratchet.

/** A tombstone may be deleted once its registration is this many majors old. */
const TOMBSTONE_AGE_MAJORS = 2;
const CURRENT_MAJOR = Number.parseInt(SPEC_VERSION, 10);

/**
 * Every ' / '-separated surface clause registered across the ADR-0087
 * registries, mapped to the EARLIEST major that registered it — the moment the
 * retirement became visible to consumers, which is when its aging clock
 * started. Same clause vocabulary as check (b) above (#4659 tracks the shared
 * leaf-name matching).
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
 * The committed authorable-surface.json this PR started from: its content at
 * the merge base of HEAD and origin/main. Returns null (with a note) only
 * when no baseline existed there at all; failure to ANCHOR the base is fatal —
 * a deletion check that silently skips is the #4650 bypass with extra steps.
 */
function resolveSurfaceBase(): { rev: string; doc: AuthorableSurface } | null {
  const cwd = path.dirname(AUTHORABLE_SURFACE_PATH);
  const git = (...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf-8' as const });

  // CI's typecheck job checks out shallow with no branch refs, so fetch the
  // one ref this check needs (depth 1 — a single snapshot) before giving up.
  let tipProbe = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}');
  if (tipProbe.status !== 0) {
    git('fetch', '--quiet', '--depth=1', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    tipProbe = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}');
  }
  if (tipProbe.status !== 0) {
    console.error(
      `\n❌ Cannot resolve origin/main to anchor the authorable-surface deletion check (#4650).\n\n` +
        `   Deleted baseline lines are validated against authorable-surface.json at the\n` +
        `   merge base with origin/main — a baseline this commit cannot rewrite. Without\n` +
        `   that anchor the tombstone gate can be bypassed by hand-editing the file, so\n` +
        `   this build fails instead of silently skipping the check.\n\n` +
        `   Fix: \`git fetch origin main\` (or point refs/remotes/origin/main at your\n` +
        `   upstream main) and re-run.`,
    );
    process.exit(1);
  }
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
  const fileName = path.basename(AUTHORABLE_SURFACE_PATH);
  const show = git('show', `${rev}:./${fileName}`);
  if (show.status !== 0) {
    if (/does not exist in|exists on disk, but not in/.test(show.stderr)) {
      console.log(
        `ℹ️  authorable-surface deletion check: no ${fileName} at base ${rev.slice(0, 12)} — nothing to compare.`,
      );
      return null;
    }
    console.error(
      `\n❌ Failed to read ${fileName} at base ${rev.slice(0, 12)} (#4650):\n${show.stderr}`,
    );
    process.exit(1);
  }
  try {
    return { rev, doc: JSON.parse(show.stdout) as AuthorableSurface };
  } catch (error) {
    console.error(`\n❌ ${fileName} at base ${rev.slice(0, 12)} is not valid JSON (#4650): ${error}`);
    process.exit(1);
  }
}

{
  const base = resolveSurfaceBase();
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
            `       removals are adjudicated by json-schema.manifest.json (#2978) and check:api-surface.`,
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
            `     3. its whole def stopped being emitted (adjudicated by the manifest ratchet).\n\n` +
            `   Restore the line(s) — \`pnpm --filter @objectstack/spec gen:schema\` regenerates\n` +
            `   the file — or complete the retirement route (#4650, ADR-0104, and the\n` +
            `   spec-property-retirement skill in .claude/skills/).`,
        );
        process.exit(1);
      }
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
