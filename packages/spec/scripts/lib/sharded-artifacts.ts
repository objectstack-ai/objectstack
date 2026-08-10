// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sharded-artifacts.ts — the layout of the three generated ratchets that used
 * to be single files (#5837).
 *
 * ## Why they are directories now
 *
 * `authorable-surface.json` (~8k sorted lines), `json-schema.manifest.json` and
 * `api-surface.json` are sorted arrays derived from source. Two PRs that each
 * add a handful of lines produce a set UNION — fully composable — but a
 * three-way text merge reports it as a conflict, and `merge=os-regen` (#4675)
 * only fixes that for a LOCAL git merge: the GitHub merge queue rebuilds the PR
 * server-side, where no custom merge driver runs. So two PRs that both touched
 * any of these three files were a plain textual conflict in the queue and the
 * second one was evicted — the spec lane could only land one PR at a time.
 *
 * The content was always naturally grouped: every key is `"<category>/<Def>"`
 * or `"<category>/<Def>:<prop>"`, and every api-surface row belongs to one
 * published entry point. Splitting on that grouping makes two PRs that touch
 * different categories touch DISJOINT FILES, so the server-side merge has
 * nothing to conflict on. Same pattern this repo already validated twice:
 * `.changeset/*.md` (one file per PR, never conflicts) and #5107 (the
 * strictness ledger's numbers split out of the ledger's prose).
 *
 * Deliberately NOT sharded: `spec-changes.json` (keyed by version, low
 * conflict) and `api-surface-signatures.json` (1.3KB).
 *
 * ## What sharding must not change
 *
 * Every ratchet reads the WHOLE directory as one set, never "the shards this
 * build would write". That is what keeps the semantics identical: deleting a
 * whole shard file deletes keys, and the deletion gates see exactly the same
 * missing keys they saw when the same edit deleted lines from one big file.
 * The integrity checks below (a shard's `category` must match its filename, and
 * every entry in it must belong to that category) exist so a shard cannot
 * quietly answer for someone else's keys.
 */

import fs from 'node:fs';
import path from 'node:path';

/** `packages/spec/authorable-surface/<category>.json` — the #3855 key ratchet. */
export const AUTHORABLE_SURFACE_DIR_NAME = 'authorable-surface';
/** `packages/spec/json-schema.manifest/<category>.json` — the #2978 def ratchet. */
export const SCHEMA_MANIFEST_DIR_NAME = 'json-schema.manifest';
/** `packages/spec/api-surface/<entry>.json` — the ADR-0059 export snapshot. */
export const API_SURFACE_DIR_NAME = 'api-surface';

/**
 * The single-file names these directories replaced. Retired from the tree by
 * #5837 and named here for exactly two live reasons — never as a fallback for
 * the working tree:
 *
 *   1. the deletion gates read their baseline out of GIT, at a commit that may
 *      predate the migration and is immutable (see `readShardedKeysAtRev`);
 *   2. `release-spec-changes.sh` unpacks a PREVIOUSLY PUBLISHED npm tarball,
 *      which for every release before this one carries `api-surface.json`.
 *
 * Both are reads of history, not of a producer we could fix. A build's own tree
 * is always the sharded layout; there is no tolerant read of it anywhere.
 */
export const LEGACY_MONOLITH_NAMES = Object.freeze({
  [AUTHORABLE_SURFACE_DIR_NAME]: 'authorable-surface.json',
  [SCHEMA_MANIFEST_DIR_NAME]: 'json-schema.manifest.json',
  [API_SURFACE_DIR_NAME]: 'api-surface.json',
} as Record<string, string>);

/**
 * The array property a category-sharded ratchet keeps its entries in.
 *
 * `defaults` is the #4666 default-value ratchet
 * (`authorable-defaults/<category>.json`). Its entries are
 * `"<def>:<key> = <canonical JSON>"` rather than a bare key, which the two
 * readers below do not care about: both route on `categoryOfDefKey`, and that
 * reads up to the first slash — the same way it already tolerates the
 * `[RETIRED]` suffix riding on an authorable-surface entry.
 */
export type ShardArrayField = 'keys' | 'schemas' | 'defaults';

/** Shard basename for the root entry point (`"."`), which has no path segment. */
export const ROOT_ENTRY_SHARD = 'root';

/** Canonical bytes of every shard: 2-space JSON, trailing newline. */
export function serializeShard(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * The category segment of a def key — `ai/AIModelConfig:maxTokens` → `ai`, and
 * `ai/AIModelConfig` → `ai`. Throws rather than guessing: a key with no
 * category cannot be routed to a shard, and silently dropping it would erase a
 * ratcheted line.
 */
export function categoryOfDefKey(key: string): string {
  const slash = key.indexOf('/');
  if (slash <= 0) {
    throw new Error(
      `cannot shard "${key}": every ratcheted key is "<category>/<Def>[:<prop>]" and this one ` +
        `has no category segment (#5837)`,
    );
  }
  return key.slice(0, slash);
}

/**
 * Shard basename for a published entry point: `./data` → `data`, `.` → `root`.
 *
 * The root entry is the one that has no segment to name it, so it borrows a
 * literal. A future `./root` subpath would collide with it — that is rejected
 * loudly here rather than letting two entry points share one file, which is the
 * same class of silent overwrite the def-key collision guard catches (#5976).
 */
export function shardNameForEntry(entry: string): string {
  if (entry === '.') return ROOT_ENTRY_SHARD;
  if (!entry.startsWith('./')) {
    throw new Error(`cannot shard entry point "${entry}": expected "." or "./<name>" (#5837)`);
  }
  const name = entry.slice(2);
  if (name === ROOT_ENTRY_SHARD) {
    throw new Error(
      `entry point "./root" collides with the shard name reserved for the root entry "." ` +
        `(${ROOT_ENTRY_SHARD}.json). Rename the entry point or change ROOT_ENTRY_SHARD (#5837)`,
    );
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`cannot shard entry point "${entry}": "${name}" is not a plain shard name (#5837)`);
  }
  return name;
}

/** Inverse of `shardNameForEntry`. */
export function entryForShardName(name: string): string {
  return name === ROOT_ENTRY_SHARD ? '.' : `./${name}`;
}

/**
 * Shard basenames present in `dir`, sorted, without the `.json` suffix.
 *
 * A missing directory reads as "no shards" — the bootstrap case, and the shape
 * every ratchet below already had for a missing single file. Anything in the
 * directory that is not a `<name>.json` file is fatal: it would sit inside a
 * generator-owned directory that write mode prunes, so it is either a stray
 * that would be deleted without a word or a shard this loader would skip while
 * the writer still counts it.
 */
export function listShardNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      throw new Error(
        `${path.basename(dir)}/ holds "${entry.name}", which is not a <name>.json shard. This ` +
          `directory is generator-owned (#5837): every file in it is written by a gen: script ` +
          `and pruned when its shard empties.`,
      );
    }
    names.push(entry.name.slice(0, -'.json'.length));
  }
  return names.sort();
}

/** One shard as read from disk: its canonical bytes plus its parsed document. */
export interface ShardOnDisk<T> {
  name: string;
  file: string;
  raw: string;
  doc: T;
}

/** Read every shard in `dir`. Returns an empty array when the directory is absent. */
export function readShards<T>(dir: string): ShardOnDisk<T>[] {
  return listShardNames(dir).map((name) => {
    const file = path.join(dir, `${name}.json`);
    const raw = fs.readFileSync(file, 'utf-8');
    let doc: T;
    try {
      doc = JSON.parse(raw) as T;
    } catch (error) {
      throw new Error(`${path.basename(dir)}/${name}.json is not valid JSON (#5837): ${error}`);
    }
    return { name, file, raw, doc };
  });
}

/**
 * Write `byShard` into `dir`, pruning any shard the caller did not produce.
 *
 * Returns the shards whose bytes changed and the ones removed, so a generator
 * can report exactly which files a PR touches — the locality claim this whole
 * layout is for. A shard whose bytes are unchanged is NOT rewritten: an
 * untouched category must leave the file's mtime alone as well as its content,
 * or `check:generated`'s staleness comparisons would churn on every run.
 */
export function writeShards(
  dir: string,
  byShard: ReadonlyMap<string, string>,
): { written: string[]; removed: string[] } {
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, text] of [...byShard].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const file = path.join(dir, `${name}.json`);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
    if (current === text) continue;
    fs.writeFileSync(file, text);
    written.push(name);
  }
  const removed: string[] = [];
  for (const name of listShardNames(dir)) {
    if (byShard.has(name)) continue;
    fs.rmSync(path.join(dir, `${name}.json`));
    removed.push(name);
  }
  return { written, removed };
}

// ─── Per-artifact shapes ──────────────────────────────────────────────

/** One category's slice of the authorable-key ratchet. */
export interface AuthorableSurfaceShard {
  description: string;
  category: string;
  keys: string[];
}

/** One category's slice of the published-schema ratchet. */
export interface SchemaManifestShard {
  description: string;
  category: string;
  schemas: string[];
}

/** One entry point's slice of the public export snapshot. */
export interface ApiSurfaceShard {
  description: string;
  entry: string;
  exports: string[];
}

/**
 * The description carried by EVERY authorable-surface shard.
 *
 * Repeated per file on purpose: the reader this text exists for is the one who
 * opens a shard to delete a line, and a pointer to a central index is one hop
 * more than that reader takes. It is compared byte-for-byte by the ratchet, so
 * changing it restates the procedure in every shard, deliberately.
 */
export const AUTHORABLE_SURFACE_DESCRIPTION =
  'Ratchet of every AUTHORABLE key in one category of the spec — what a metadata author may ' +
  'write, which for this platform IS the third-party API. Sharded by category (#5837) so two ' +
  'PRs touching different categories never share a file; the gate reads the whole ' +
  'authorable-surface/ directory as ONE set, so deleting a shard deletes its keys exactly as ' +
  'deleting lines did. Auto-updated on additions (commit the change). A key that disappears ' +
  'without a tombstone fails gen:schema, because these schemas are not .strict() and Zod would ' +
  'silently strip it. "[RETIRED]" marks a tombstoned key that still rejects with an upgrade ' +
  'prescription. See #3855, ADR-0059 §5.';

/**
 * The description carried by EVERY json-schema.manifest shard. Same per-file
 * repetition, same reason: #4725 put the removal PROCEDURE in this text
 * precisely because the person who opens the file is about to delete a line.
 */
export const SCHEMA_MANIFEST_DESCRIPTION =
  'Ratchet manifest of every JSON Schema emitted by scripts/build-schemas.ts for one category. ' +
  'Sharded by category (#5837); the gate reads the whole json-schema.manifest/ directory as ONE ' +
  'set. Auto-appended when new schemas are added (commit the change). A listed schema that a ' +
  'build no longer emits fails gen:schema. DELETING a key is gated too (#4725): the removal ' +
  'is measured against this directory at the merge base with origin/main — which the commit under ' +
  'test cannot rewrite — and every def that leaves the published set must be declared in ' +
  'RETIRED_DEFS_BY_MAJOR (src/migrations/registry.ts), or in RENAMED_DEFS ' +
  '(scripts/lib/renamed-defs.ts) when it is a rename rather than a removal. See #2978, #4725.';

/** The description carried by every api-surface shard. */
export const API_SURFACE_DESCRIPTION =
  'Every exported `name (kind)` of one published entry point of @objectstack/spec — the ' +
  'breadth half of the ADR-0059 backward-compatibility gate. Sharded by entry point (#5837) so ' +
  'two PRs touching different entry points never share a file. Reads the BUILT dist/*.d.ts: ' +
  'regenerate with `pnpm --filter @objectstack/spec gen:api-surface` after a real build.';

/**
 * Split sorted `keys` into `<category> -> canonical shard bytes`.
 *
 * The routing is the whole locality guarantee, so it is one expression: a key's
 * category segment selects its file and nothing else does.
 */
export function authorableSurfaceShardTexts(keys: readonly string[]): Map<string, string> {
  return shardTextsByCategory(keys, (category, members) =>
    serializeShard({
      description: AUTHORABLE_SURFACE_DESCRIPTION,
      category,
      keys: members,
    } satisfies AuthorableSurfaceShard),
  );
}

/** Split sorted def keys into `<category> -> canonical shard bytes`. */
export function schemaManifestShardTexts(schemas: readonly string[]): Map<string, string> {
  return shardTextsByCategory(schemas, (category, members) =>
    serializeShard({
      description: SCHEMA_MANIFEST_DESCRIPTION,
      category,
      schemas: members,
    } satisfies SchemaManifestShard),
  );
}

/** Split an api-surface record into `<entry shard> -> canonical shard bytes`. */
export function apiSurfaceShardTexts(surface: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of Object.keys(surface).sort()) {
    out.set(
      shardNameForEntry(entry),
      serializeShard({
        description: API_SURFACE_DESCRIPTION,
        entry,
        exports: surface[entry],
      } satisfies ApiSurfaceShard),
    );
  }
  return out;
}

function shardTextsByCategory(
  keys: readonly string[],
  render: (category: string, members: string[]) => string,
): Map<string, string> {
  const grouped = new Map<string, string[]>();
  for (const key of keys) {
    // `[RETIRED]` rides on the authorable entries; the category is still the
    // prefix, so strip nothing — `categoryOfDefKey` reads up to the first slash.
    const category = categoryOfDefKey(key);
    const bucket = grouped.get(category);
    if (bucket) bucket.push(key);
    else grouped.set(category, [key]);
  }
  const out = new Map<string, string>();
  for (const category of [...grouped.keys()].sort()) {
    out.set(category, render(category, grouped.get(category)!.sort()));
  }
  return out;
}

/**
 * The JSON type of a parsed value, article included, for a message that has to
 * tell an author what they actually wrote. `typeof` alone answers `"object"` for
 * both `null` and `[]` — the two hand-edit accidents most worth telling apart.
 */
function jsonTypeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  return `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`;
}

/**
 * The middle of the "this entry is not a string" message — field, entry index,
 * what was found instead, and the offending value — or null when every entry in
 * `list` is a string (#7076).
 *
 * It is the SKELETON only, deliberately: each reader prefixes its own source
 * locator (a shard file in the working tree, a path at a revision) and appends
 * its own remedy, because those two differ per site while the diagnosis does
 * not. `aggregateCategoryShards` above spells the same middle inline — the fix
 * that established this shape (#6751) landed before there was a second caller,
 * and rewriting a landed message to route it through here would churn a pinned
 * contract for no reader's benefit. The pin tests assert the shared substring on
 * all three sites, so a divergence is caught rather than trusted.
 */
function nonStringEntryDetail(
  field: string,
  list: readonly unknown[],
): { index: number; detail: string } | null {
  const index = list.findIndex((entry) => typeof entry !== 'string');
  if (index === -1) return null;
  return {
    index,
    detail:
      `${field}[${index}] is ${jsonTypeLabel(list[index])}, not a string (#5837): ` +
      `${JSON.stringify(list[index])}`,
  };
}

/**
 * Aggregate a category-sharded directory into one sorted array, validating that
 * each shard answers only for its own category.
 *
 * `field` is the shard's array property (`keys` / `schemas`). The two integrity
 * checks are not decoration: without them a shard could carry another
 * category's key, and the writer — which routes by category — would drop it on
 * the next run as a deletion nobody made.
 */
export function aggregateCategoryShards(
  dir: string,
  field: ShardArrayField,
): { entries: string[]; shards: ShardOnDisk<Record<string, unknown>>[] } | null {
  const shards = readShards<Record<string, unknown>>(dir);
  if (shards.length === 0 && !fs.existsSync(dir)) return null;
  const entries: string[] = [];
  const dirName = path.basename(dir);
  for (const shard of shards) {
    const declared = shard.doc.category;
    if (declared !== shard.name) {
      throw new Error(
        `${dirName}/${shard.name}.json declares category ${JSON.stringify(declared)} but its ` +
          `filename says "${shard.name}" (#5837). A shard answers for exactly the category it is ` +
          `named for — regenerate rather than reconcile by hand.`,
      );
    }
    const list = shard.doc[field];
    if (!Array.isArray(list)) {
      throw new Error(`${dirName}/${shard.name}.json has no "${field}" array (#5837).`);
    }
    // `Array.isArray` says the field IS an array and nothing about what is in
    // it, so this is where untyped JSON stops being untyped. A hand-edited
    // non-string entry used to reach `categoryOfDefKey`, whose parameter is
    // declared `string`, and die there on `key.indexOf is not a function` —
    // right exit code, but all three call sites print `error.message` alone, so
    // the author was told neither the shard file nor the entry (#6751). Every
    // other defect class this reader rejects names both; so does this one now.
    // The check belongs here rather than in `categoryOfDefKey`: the helper's
    // contract already says `string`, and only its caller knows the file name.
    for (const [index, raw] of (list as readonly unknown[]).entries()) {
      if (typeof raw !== 'string') {
        throw new Error(
          `${dirName}/${shard.name}.json ${field}[${index}] is ${jsonTypeLabel(raw)}, not a string ` +
            `(#5837): ${JSON.stringify(raw)}. Every entry is a "<category>/<Def>[:<prop>]" key — ` +
            `regenerate rather than reconcile by hand.`,
        );
      }
      if (categoryOfDefKey(raw) !== shard.name) {
        throw new Error(
          `${dirName}/${shard.name}.json carries "${raw}", which belongs to category ` +
            `"${categoryOfDefKey(raw)}" (#5837).`,
        );
      }
      entries.push(raw);
    }
  }
  return { entries: entries.sort(), shards };
}

/** Aggregate the api-surface shards back into the `{ entry: [...] }` record. */
export function aggregateApiSurfaceShards(
  dir: string,
): { surface: Record<string, string[]>; shards: ShardOnDisk<ApiSurfaceShard>[] } | null {
  const shards = readShards<ApiSurfaceShard>(dir);
  if (shards.length === 0 && !fs.existsSync(dir)) return null;
  const surface: Record<string, string[]> = {};
  for (const shard of shards) {
    const expected = entryForShardName(shard.name);
    if (shard.doc.entry !== expected) {
      throw new Error(
        `${API_SURFACE_DIR_NAME}/${shard.name}.json declares entry ${JSON.stringify(shard.doc.entry)} ` +
          `but its filename says "${expected}" (#5837).`,
      );
    }
    if (!Array.isArray(shard.doc.exports)) {
      throw new Error(`${API_SURFACE_DIR_NAME}/${shard.name}.json has no "exports" array (#5837).`);
    }
    // `ApiSurfaceShard.exports` is DECLARED `string[]`, and `readShards` gets
    // there by a `JSON.parse` cast — so the declaration is a claim about the
    // file, not a fact the type checker verified. `Array.isArray` above answers
    // for the container and says nothing about the entries, exactly the gap
    // #6751 closed one function up; this is the fourth sharded artifact, which
    // that fix could not reach because it is not routed by `categoryOfDefKey`.
    // Unchecked, a hand-edited non-string row travels into `surface` as a
    // `string` and lands in the breadth diff in `build-api-surface.ts`: it is in
    // the snapshot and not in the built surface, so it is counted as a REMOVED
    // export and the run ends on "a REMOVED export … is a BREAKING change for
    // third parties — bump @objectstack/spec to a new major (or restore it)".
    // Red either way, but that sentence sends the author after an export that
    // never existed instead of the shard row they broke (#7076).
    const rows = shard.doc.exports as readonly unknown[];
    const bad = nonStringEntryDetail('exports', rows);
    if (bad) {
      throw new Error(
        `${API_SURFACE_DIR_NAME}/${shard.name}.json ${bad.detail}. Every entry is an ` +
          `"<Name> (<kind>)" export row — regenerate rather than reconcile by hand.`,
      );
    }
    surface[shard.doc.entry] = shard.doc.exports;
  }
  return { surface, shards };
}

/** Parse the `{ entry: [...] }` record out of a published or historical location. */
export function readApiSurfaceFrom(target: string): Record<string, string[]> {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const read = aggregateApiSurfaceShards(target);
    if (!read) throw new Error(`${target} holds no api-surface shards (#5837)`);
    return read.surface;
  }
  // A single file here is a PUBLISHED tarball from before #5837 — immutable
  // history, not a producer this repo can fix. See LEGACY_MONOLITH_NAMES.
  return JSON.parse(fs.readFileSync(target, 'utf-8')) as Record<string, string[]>;
}

// ─── Reading a baseline out of git ────────────────────────────────────

/** The git runner shape the deletion gates already share (`spawnSync` result). */
export type GitRun = (...args: string[]) => { status: number | null; stdout: string; stderr: string };

/** Which layout a historical revision turned out to carry. */
export type BaselineLayout = 'sharded' | 'legacy';

/**
 * The aggregated ratchet content at an arbitrary revision, from whichever
 * layout that revision actually used.
 *
 * ⚠️ This is the ONE place that reads the retired single-file layout, and it is
 * not a lenient consumer fallback: `rev` is an already-merged upstream commit,
 * so for any commit older than #5837 the sharded directory genuinely does not
 * exist and never will. The working tree is read by `aggregateCategoryShards`
 * above, which knows only the sharded layout. The legacy branch reports which
 * layout it read so a confused baseline is visible rather than silent, and it
 * retires by itself once no branch in flight forks from before the migration.
 *
 * Returns null when the revision carries neither layout (`nothing to compare`),
 * which is the same verdict the single-file gates drew from a missing file.
 */
export function readShardedKeysAtRev(
  git: GitRun,
  rev: string,
  dirName: string,
  field: ShardArrayField,
): { entries: string[]; layout: BaselineLayout } | { error: string } | null {
  // `ls-tree` run inside the package prints paths relative to the CWD, which is
  // the same spelling `git show <rev>:./<path>` wants — so the two compose
  // without a repo-root round trip (#4868's absolute-path trap, avoided).
  const listed = git('ls-tree', '-r', '--name-only', rev, '--', `./${dirName}/`);
  const files = listed.status === 0
    ? listed.stdout.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.json'))
    : [];
  if (files.length > 0) {
    const entries: string[] = [];
    for (const file of files.sort()) {
      const show = git('show', `${rev}:./${file}`);
      if (show.status !== 0) return { error: `cannot read ${file} at ${rev.slice(0, 12)}: ${show.stderr}` };
      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(show.stdout) as Record<string, unknown>;
      } catch (error) {
        return { error: `${file} at ${rev.slice(0, 12)} is not valid JSON: ${error}` };
      }
      const list = doc[field];
      if (!Array.isArray(list)) return { error: `${file} at ${rev.slice(0, 12)} has no "${field}" array` };
      // The entry check the container check cannot do (#7076). Carried as
      // `{ error }` rather than thrown because that is this reader's contract —
      // `readSurfaceKeysAtRev` in `build-schemas.ts` prints the string under the
      // gate's own name and exits, and a throw from here would escape that
      // framing and print a baseline problem as a problem with the commit under
      // test. See the same check below for the legacy layout, and the note there
      // on why a bad entry costs more here than a bad container.
      const bad = nonStringEntryDetail(field, list as readonly unknown[]);
      if (bad) return { error: `${file} at ${rev.slice(0, 12)} ${bad.detail}` };
      entries.push(...(list as string[]));
    }
    return { entries: entries.sort(), layout: 'sharded' };
  }

  const legacyName = LEGACY_MONOLITH_NAMES[dirName];
  // A ratchet born AFTER the #5837 split (authorable-defaults/, #4666) never had
  // a single-file layout, so there is nothing to fall back to and "absent" is the
  // honest answer. Said explicitly rather than left to `git show <rev>:./undefined`
  // failing its way to the same result — an accident that reads as a decision.
  if (legacyName === undefined) return null;
  const show = git('show', `${rev}:./${legacyName}`);
  if (show.status !== 0) {
    if (/does not exist in|exists on disk, but not in/.test(show.stderr)) return null;
    return { error: `cannot read ${legacyName} at ${rev.slice(0, 12)}: ${show.stderr}` };
  }
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(show.stdout) as Record<string, unknown>;
  } catch (error) {
    return { error: `${legacyName} at ${rev.slice(0, 12)} is not valid JSON: ${error}` };
  }
  const list = doc[field];
  if (!Array.isArray(list)) return { error: `${legacyName} at ${rev.slice(0, 12)} has no "${field}" array` };
  // Why a non-string entry is worth its own verdict here, when the container
  // check already exists: a missing array stops the read, but a bad ENTRY used
  // to be forwarded into the baseline SET, and the three gates that consume it
  // fail three different ways, none of them naming this file (#7076):
  //
  //   - the authorable-surface deletion gate maps every base entry through
  //     `entry.replace(RETIRED_MARK, '')` and dies on `replace is not a
  //     function` — the bare-JS-error shape #6751 removed one function up;
  //   - the json-schema.manifest removal check keeps the entry (it is in
  //     neither `generatedKeys` nor `RENAMED_DEFS`), reports it as a schema
  //     that left the published set, and demands a `RETIRED_DEFS_BY_MAJOR`
  //     registration for a def that never existed;
  //   - `compareAnchorKeys` reports it as a line the committed
  //     `authorable-surface.base.json` is missing, i.e. blames the anchor for
  //     not mirroring a baseline it mirrors correctly.
  //
  // All three are loud, so this is diagnostic quality and not a bypass — but a
  // baseline read from an already-merged commit is exactly where "the artifact
  // is corrupt" must be said by the reader, since no downstream gate can see
  // which file the value came from.
  const bad = nonStringEntryDetail(field, list as readonly unknown[]);
  if (bad) return { error: `${legacyName} at ${rev.slice(0, 12)} ${bad.detail}` };
  return { entries: [...(list as string[])].sort(), layout: 'legacy' };
}
