// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-api-surface-declarations.ts — the SHAPE half of the spec's public-API
 * pin: the readable `.d.ts` declaration TEXT of every export, per entry point
 * (`api-surface-declarations/<entry>.txt`), generated.
 *
 * ## Why this artifact exists
 *
 * `api-surface/<entry>.json` pins every export by `name (kind)`. A signature
 * change, a renamed interface field and a dropped union member move NEITHER the
 * name NOR the kind, so for all but a handful of exports that pin cannot fail on
 * a breaking shape change to a ratified public type — measured on this tree at
 * 5336 pinned `name (kind)` rows against 27 exports carrying a shape pin (the
 * retired `api-surface-signatures.json` hashes, 0.5%). This file is the other
 * half: the declaration text itself, so each of those three changes moves a line
 * here and the diff says which export moved.
 *
 * ## Text, deliberately, and NOT a hash
 *
 * A hash snapshot answers "did the shipped bytes move" with one opaque bit, and
 * its known failure mode at scale is that a red one gets ACCEPTED rather than
 * investigated. Text is reviewable: the diff names the export and shows the
 * change, so the existing contract-review discipline — not a reviewer's patience
 * with an opaque hash — is what guards against blind acceptance. That choice is
 * the whole point of the artifact; ⛔ do not "compress" it back into a digest.
 *
 * ## The input is the PACKED `.d.ts`, reached through the `exports` map
 *
 * Same input as `build-api-surface.ts`: `exports[<sub>].require.types`, i.e. the
 * declarations a consumer actually installs, never `src/`. Two of the manifest's
 * 19 `exports` entries are asset subpaths with no declaration at all
 * (`./openapi.json`, `./package.json`); they are not type entry points and are
 * filtered out by the same `.d.ts` test, which is why this artifact and
 * `api-surface/` both hold 17 shards and not 19.
 *
 * Consequence worth knowing before reading a diff: the packed `.d.ts` is a
 * tsup dts ROLLUP, so a Zod schema's declaration is its fully EXPANDED
 * structural type. That is what makes an inner field rename visible here — and
 * it is also why four declarations on this tree exceed 20,000 lines each. The
 * per-export byte cost is recorded in the PR that landed this file; the skew is
 * extreme (median declaration 81 bytes, the top 20 hold ~65% of the bytes).
 *
 * ## What it deliberately does NOT record
 *
 * A declaration's leading TSDoc. `getText()` starts at the declaration, not at
 * its leading trivia, so a re-worded `.describe()` or doc comment does not churn
 * this artifact — documentation drift is `check:docs`'s axis. The SHAPE is this
 * one's.
 *
 * ## Sharded, for the reason the merge queue forces
 *
 * One file per entry point (#5837's reason, unchanged): the GitHub merge queue
 * rebuilds server-side where no custom merge driver runs, so two PRs that share
 * a generated file conflict there and the second is evicted. Two PRs touching
 * different entry points touch disjoint files. The gate reads the WHOLE
 * directory as one set, so deleting a shard reads as deleting its declarations.
 *
 *   pnpm --filter @objectstack/spec gen:api-surface-declarations     # write
 *   pnpm --filter @objectstack/spec check:api-surface-declarations   # CI: fail on drift
 *
 * ## Why there is no `--self-test`
 *
 * This is a regenerate-and-compare gate, like `check:api-surface`: it derives
 * its expectation from the built tree on every run rather than from a fixture,
 * so it has no offline path that could pass over nothing. Its discrimination is
 * proven by ablation — hand-edit a shard, watch it red, regenerate, watch it
 * green — and that run belongs in the PR that changes it, not in a battery here.
 *
 * Reads the built dist, so it refuses a missing or stale one in BOTH modes
 * (lib/dist-freshness.ts is the authority on why): against a stale dist a
 * generator writes a plausible snapshot describing a build nobody made, and
 * `--check` then agrees with it.
 */
import ts from 'typescript';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDistFreshness } from './lib/dist-freshness';
import { shardNameForEntry } from './lib/sharded-artifacts';

/** `packages/spec/api-surface-declarations/<entry>.txt`. */
export const DECLARATIONS_DIR_NAME = 'api-surface-declarations';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DECL_DIR = resolve(PKG_DIR, DECLARATIONS_DIR_NAME);
const CHECK = process.argv.includes('--check');
const GEN_CMD = 'pnpm --filter @objectstack/spec gen:api-surface-declarations';

/**
 * The per-declaration marker line.
 *
 * It only has to be DETERMINISTIC for the verdict — the gate compares bytes, so
 * a marker that collided with declaration text would still go red correctly.
 * What a collision would corrupt is the ATTRIBUTION (which export moved), so the
 * writer refuses to emit a declaration whose text carries this shape rather than
 * letting the failure text mis-name an export.
 */
const MARKER_RE = /^\/\/ ── (.+) \((\w+)\) ──$/;
const marker = (name: string, kind: string): string => `// ── ${name} (${kind}) ──`;

// BEFORE a single `.d.ts` is read. Order is the point: once `ts.createProgram`
// has run over a stale dist every answer below it is confidently wrong, and both
// writing the snapshot and checking against it are worse than stopping here.
const freshness = inspectDistFreshness(
  PKG_DIR,
  CHECK ? 'check' : 'generate',
  `pnpm --filter @objectstack/spec ${CHECK ? 'check' : 'gen'}:api-surface-declarations`,
);
if (!freshness.fresh) {
  console.error(freshness.message);
  process.exit(1);
}

/** Public entry points → their built CJS `.d.ts`, read from the exports map. */
function collectEntries(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const entries: Record<string, string> = {};
  for (const [sub, val] of Object.entries<any>(pkg.exports ?? {})) {
    if (!sub.startsWith('.')) continue;
    const dts = val?.require?.types ?? val?.import?.types;
    if (typeof dts === 'string' && dts.endsWith('.d.ts')) entries[sub] = resolve(PKG_DIR, dts);
  }
  return entries;
}

/**
 * The kind of ONE declaration node, in `build-api-surface.ts`'s vocabulary.
 *
 * That gate asks the merged SYMBOL for every kind its flags carry, because a
 * name declared as both a const and a type must be two independently removable
 * rows. Here the unit is the declaration NODE — a dual-declared name has two
 * nodes with two texts — so the kind comes from the node's own syntax and the
 * two artifacts stay readable against each other.
 */
function kindOfDeclaration(node: ts.Node): string {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
      return 'function';
    case ts.SyntaxKind.ClassDeclaration:
      return 'class';
    case ts.SyntaxKind.EnumDeclaration:
      return 'enum';
    case ts.SyntaxKind.InterfaceDeclaration:
      return 'interface';
    case ts.SyntaxKind.TypeAliasDeclaration:
      return 'type';
    case ts.SyntaxKind.VariableDeclaration:
      return 'const';
    case ts.SyntaxKind.ModuleDeclaration:
      return 'namespace';
    default:
      return 'other';
  }
}

/**
 * The text to record for one declaration.
 *
 * A `VariableDeclaration`'s own text is `Name: Type` — the `declare const`
 * belongs to the enclosing statement, and without it the recorded line is not a
 * readable declaration. So a variable is recorded as its STATEMENT, but only
 * when that statement declares exactly one name; a multi-declarator statement
 * would otherwise record one shared text under several exports, which is the
 * silent-overwrite shape this whole artifact exists to make loud.
 */
function declarationText(node: ts.Declaration): string {
  if (ts.isVariableDeclaration(node)) {
    const list = node.parent;
    if (ts.isVariableDeclarationList(list) && list.declarations.length === 1 && ts.isVariableStatement(list.parent)) {
      return list.parent.getText();
    }
  }
  return node.getText();
}

interface Recorded {
  name: string;
  kind: string;
  text: string;
}

const entries = collectEntries();
const program = ts.createProgram(Object.values(entries), {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

const unalias = (s: ts.Symbol): ts.Symbol =>
  s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

function moduleExports(file: string, sub: string): ts.Symbol[] {
  const sf = program.getSourceFile(file);
  const sym = sf && checker.getSymbolAtLocation(sf);
  if (!sym) throw new Error(`Could not resolve module symbol for ${sub} (${file}). Is the package built?`);
  return checker.getExportsOfModule(sym);
}

/** Every export of one entry point, as recorded declarations, deterministically ordered. */
function recordEntry(sub: string, file: string): Recorded[] {
  const out: Recorded[] = [];
  for (const exported of moduleExports(file, sub)) {
    const name = exported.getName();
    const resolved = unalias(exported);
    const decls = resolved.declarations ?? [];
    if (decls.length === 0) {
      // Never a silent drop: an export with no declaration means the program
      // resolved a name to nothing, which is a broken build, not an empty row.
      throw new Error(
        `${sub}: export \`${name}\` resolves to no declaration. The built dist is incomplete — ` +
          `run \`pnpm --filter @objectstack/spec build\` and regenerate.`,
      );
    }
    for (const decl of decls) {
      const text = declarationText(decl);
      for (const line of text.split('\n')) {
        if (MARKER_RE.test(line)) {
          throw new Error(
            `${sub}: the declaration text of \`${name}\` carries a line shaped like this ` +
              `artifact's own per-declaration marker, which would mis-attribute a future diff. ` +
              `Change the marker in scripts/build-api-surface-declarations.ts — ⛔ never the declaration.`,
          );
        }
      }
      out.push({ name, kind: kindOfDeclaration(decl), text });
    }
  }
  // Code-unit sort (NOT localeCompare): deterministic across CI platforms. Name,
  // then kind, then text — so a dual-declared name's two blocks land adjacent
  // and two same-kind declarations of one name still have a total order.
  return out.sort((a, b) =>
    a.name < b.name ? -1
    : a.name > b.name ? 1
    : a.kind < b.kind ? -1
    : a.kind > b.kind ? 1
    : a.text < b.text ? -1
    : a.text > b.text ? 1
    : 0,
  );
}

/**
 * The header every shard carries.
 *
 * Repeated per file on purpose, the same way the authorable-surface shards
 * repeat theirs: the reader this text exists for is the one who opened a shard
 * because a diff landed in it, and a pointer to a central index is one hop more
 * than that reader takes. It is compared byte-for-byte, so editing it restates
 * the procedure in every shard, deliberately.
 */
function header(sub: string, records: Recorded[]): string {
  const names = new Set(records.map((r) => r.name));
  return [
    `# @objectstack/spec — the .d.ts DECLARATION TEXT of every export of \`${sub}\`.`,
    '#',
    '# The SHAPE half of the ADR-0059 public-API pin, and the readable counterpart of',
    `# api-surface/${shardNameForEntry(sub)}.json's breadth half. That file pins each export by`,
    '# `name (kind)`, which a signature change, a renamed interface field and a dropped',
    '# union member all leave untouched. This file pins the declaration text, so each of',
    '# those moves a line here. Text and NOT a hash, deliberately: a diff a reviewer can',
    '# read is what makes contract review a guard rather than a rubber stamp.',
    '#',
    '# Verbatim from the PACKED `.d.ts` reached through this package\'s `exports` map — the',
    '# declarations a consumer installs, never `src/`. A declaration\'s leading TSDoc is',
    '# excluded: documentation drift is `check:docs`\'s axis, not this one.',
    '#',
    `# entry: ${sub}`,
    `# exported names: ${names.size}`,
    `# declarations: ${records.length}`,
    '#',
    `# GENERATED — ⛔ never hand-edited. Regenerate after a real build:`,
    `#   pnpm --filter @objectstack/spec build && ${GEN_CMD}`,
    '# Gated by `check:api-surface-declarations`; a hand edit is a red gate, not a change.',
    '',
  ].join('\n');
}

/** Canonical bytes of one shard. */
function shardText(sub: string, records: Recorded[]): string {
  const blocks = records.map((r) => `${marker(r.name, r.kind)}\n${r.text}\n`);
  return `${header(sub, records)}\n${blocks.join('\n')}`;
}

/**
 * Attribute a shard's bytes back to per-declaration blocks.
 *
 * Only the failure TEXT depends on this; the verdict is the byte comparison
 * above. A shard whose bytes do not parse on the marker grammar (the shape a
 * hand edit that mangles a marker produces) reports as unattributable rather
 * than as clean — never as fewer declarations than it holds.
 */
function parseShard(raw: string): Map<string, string> | null {
  const blocks = new Map<string, string>();
  const lines = raw.split('\n');
  let key: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const m = MARKER_RE.exec(line);
    if (m) {
      if (key !== null) blocks.set(key, buf.join('\n').trim());
      key = `${m[1]} (${m[2]})`;
      buf = [];
      continue;
    }
    if (key !== null) buf.push(line);
  }
  if (key !== null) blocks.set(key, buf.join('\n').trim());
  return blocks.size > 0 ? blocks : null;
}

/** Shard basenames present in `dir`, sorted, without the `.txt` suffix. */
function listShards(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.txt')) {
      throw new Error(
        `${basename(dir)}/ holds "${entry.name}", which is not a <entry>.txt shard. This directory ` +
          `is generator-owned: every file in it is written by \`${GEN_CMD}\` and pruned when its ` +
          `entry point disappears.`,
      );
    }
    names.push(entry.name.slice(0, -'.txt'.length));
  }
  return names.sort();
}

const shards = new Map<string, string>();
const recordsByShard = new Map<string, Recorded[]>();
for (const [sub, file] of Object.entries(entries)) {
  const records = recordEntry(sub, file);
  const name = shardNameForEntry(sub);
  if (shards.has(name)) throw new Error(`two entry points both shard to ${name}.txt: ${sub}`);
  recordsByShard.set(name, records);
  shards.set(name, shardText(sub, records));
}

const totalDeclarations = [...recordsByShard.values()].reduce((n, r) => n + r.length, 0);
const totalBytes = [...shards.values()].reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0);

if (!CHECK) {
  mkdirSync(DECL_DIR, { recursive: true });
  const written: string[] = [];
  for (const [name, text] of [...shards].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const file = join(DECL_DIR, `${name}.txt`);
    // An untouched shard is NOT rewritten: its mtime is as load-bearing as its
    // bytes for every staleness comparison downstream.
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
    writeFileSync(file, text);
    written.push(name);
  }
  const removed: string[] = [];
  for (const name of listShards(DECL_DIR)) {
    if (shards.has(name)) continue;
    rmSync(join(DECL_DIR, `${name}.txt`));
    removed.push(name);
  }
  console.log(
    `Wrote ${DECLARATIONS_DIR_NAME}/ (${shards.size} entry points, ${totalDeclarations} declarations, ` +
      `${(totalBytes / 1048576).toFixed(2)} MiB).`,
  );
  if (written.length > 0) console.log(`  touched: ${written.map((n) => `${n}.txt`).join(', ')}`);
  if (removed.length > 0) console.log(`  removed: ${removed.map((n) => `${n}.txt`).join(', ')}`);
  process.exit(0);
}

// --check. Reads the whole shard DIRECTORY, never "the shards this run would
// write": a deleted shard drops its entry point's declarations and must read as
// a removal, exactly as deleting those lines from one big file did.
const onDisk = new Map<string, string>();
for (const name of listShards(DECL_DIR)) {
  onDisk.set(name, readFileSync(join(DECL_DIR, `${name}.txt`), 'utf8'));
}
if (onDisk.size === 0) {
  console.error(
    `No snapshot at ${DECL_DIR}.\nRun \`${GEN_CMD}\` and commit it.`,
  );
  process.exit(1);
}

let changed = 0;
let removedDecls = 0;
let addedDecls = 0;
const staleShards: string[] = [];
const orphanShards = [...onDisk.keys()].filter((name) => !shards.has(name));

for (const [name, text] of shards) {
  const prev = onDisk.get(name);
  if (prev === text) continue;
  staleShards.push(name);
  if (prev === undefined) {
    console.error(`\n  ${name}.txt  (missing — this entry point has no snapshot)`);
    addedDecls += recordsByShard.get(name)?.length ?? 0;
    continue;
  }
  const before = parseShard(prev);
  const after = parseShard(text);
  if (!before || !after) {
    console.error(`\n  ${name}.txt  (bytes differ; could not attribute — the on-disk markers do not parse)`);
    changed++;
    continue;
  }
  console.error(`\n  ${name}.txt`);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    if (b === a) continue;
    if (b === undefined) { console.error(`    + ${key}`); addedDecls++; }
    else if (a === undefined) { console.error(`    - ${key}`); removedDecls++; }
    else { console.error(`    ~ ${key}  (declaration text changed)`); changed++; }
  }
  if ([...new Set([...before.keys(), ...after.keys()])].every((k) => before.get(k) === after.get(k))) {
    console.error('    ~ header or layout only');
    changed++;
  }
}
for (const name of orphanShards) {
  console.error(`\n  - ${name}.txt  (no such entry point)`);
  removedDecls += parseShard(onDisk.get(name) ?? '')?.size ?? 0;
}

if (staleShards.length === 0 && orphanShards.length === 0) {
  console.log(
    `@objectstack/spec declaration text unchanged ✓ ` +
      `(${shards.size} entry points, ${totalDeclarations} declarations)`,
  );
  process.exit(0);
}

console.error(
  `\n@objectstack/spec declaration text changed: ${removedDecls} removed, ${addedDecls} added, ` +
    `${changed} reshaped.`,
);
if (removedDecls > 0 || changed > 0) {
  console.error(
    'A REMOVED or RESHAPED declaration is a breaking change for third parties: the export kept its\n' +
      'name and kind, so `check:api-surface` cannot see it. Read the diff and rule minor/major.',
  );
}
console.error(`\nIf intentional, run \`${GEN_CMD}\` and commit the updated shards.`);
process.exit(1);
