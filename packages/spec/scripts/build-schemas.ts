// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Force eager Zod construction so lazySchema() Proxies resolve immediately —
// JSON Schema generation walks `_def` recursively and needs real schemas, not
// lazy stubs. See packages/spec/src/shared/lazy-schema.ts.
process.env.OS_EAGER_SCHEMAS = '1';

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { MIGRATIONS_BY_MAJOR } from '../src/migrations/registry';
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
// `--check` verifies the committed authorable-surface snapshot without rewriting
// it, so CI fails on an uncommitted ADDITION too (the write and check paths share
// the same code — same discipline as build-docs.ts).
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
        const schemaName = key.endsWith('Schema') ? key.replace('Schema', '') : key;

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
const missing = (manifest?.schemas ?? []).filter((key) => !generatedKeys.has(key));
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
if (!manifest || added.length > 0) {
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

let surfaceDoc: AuthorableSurface | null = null;
if (fs.existsSync(AUTHORABLE_SURFACE_PATH)) {
  surfaceDoc = JSON.parse(fs.readFileSync(AUTHORABLE_SURFACE_PATH, 'utf-8')) as AuthorableSurface;
}

if (surfaceDoc) {
  const prev = new Map<string, boolean>(
    surfaceDoc.keys.map((e) => [e.replace(RETIRED_MARK, ''), e.endsWith(RETIRED_MARK)]),
  );

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
    const surfaces = registeredRetirementSurfaces();
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

const surfaceChanged =
  !surfaceDoc || JSON.stringify(surfaceDoc.keys) !== JSON.stringify(currentEntries);
if (surfaceChanged && CHECK) {
  // Removals already exited above; reaching here in check mode means the snapshot
  // is behind on ADDITIONS. Left unnoticed that is not cosmetic: an unrecorded key
  // is one this ratchet can never miss later, because it was never in the baseline.
  const before = new Set(surfaceDoc?.keys ?? []);
  const addedKeys = currentEntries.filter((k) => !before.has(k));
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
  process.exit(1);
}
if (surfaceChanged && !CHECK) {
  const updated: AuthorableSurface = {
    description:
      'Ratchet of every AUTHORABLE key in the spec — what a metadata author may write, which ' +
      'for this platform IS the third-party API. Auto-updated on additions (commit the change). ' +
      'A key that disappears without a tombstone fails gen:schema, because these schemas are ' +
      'not .strict() and Zod would silently strip it. "[RETIRED]" marks a tombstoned key that ' +
      'still rejects with an upgrade prescription. See #3855, ADR-0059 §5.',
    keys: currentEntries,
  };
  fs.writeFileSync(AUTHORABLE_SURFACE_PATH, JSON.stringify(updated, null, 2) + '\n');
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
