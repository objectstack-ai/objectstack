#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-migration-registry — concatenate `src/migrations/entries/` into the
 * marked regions of `src/migrations/registry.ts` (#7297, the registry half of
 * #6957's ruling).
 *
 * ## The failure this exists for
 *
 * `registry.ts` carried three hand-authored APPEND tables — each protocol
 * step's `semantic` list, `RETIRED_KEYS_BY_MAJOR` and `RETIRED_DEFS_BY_MAJOR`.
 * Every retirement card appended to the SAME tail line of the same two of them,
 * so two cards in one window were a textual conflict by construction: measured
 * on #6957 across 2026-08-06..10, `step17`'s semantic list and
 * `RETIRED_KEYS_BY_MAJOR[17]` conflicted in **6 of 11** contended re-merge laps,
 * for 613 hand-resolved lines of conflict markers in four days.
 *
 * Wall-clock was never the reason to fix it. **Both tables are consumed as
 * SETS** — `registeredRetiredKeys()` (`scripts/build-schemas.ts`) folds them
 * into a `Map`, and the chain walks the semantic list — so a conflict
 * resolution that drops a sibling's entry produces **no error anywhere**. The
 * retirement simply stops being declared: check (b) never sees the tombstone it
 * was meant to answer, and the D3 prescription silently leaves the upgrade
 * guide. Conflict-free-by-construction beats "resolve carefully" precisely when
 * careless is undetectable.
 *
 * Maintainer ruling, 2026-08-10 (#6957), verbatim and untranslated:
 *
 * > **hybrid — batch now, split the append surface as the durable fix.**
 * > Now: the PM landing relay batches same-window retirement cards into one PR …
 * > Queued: implement per-card registry entry files concatenated by a generator,
 * > the `.changeset/*.md` shape that already de-conflicted this repo's other
 * > hottest file; `scripts/adr-anchors.json` is in the same fix space and may
 * > ride the same mechanism. Option B (uncommitted build-time artifacts) is
 * > rejected — the review diff of `spec-changes.json` / the upgrade guide is
 * > worth the laps it costs.
 *
 * `scripts/adr-anchors/` (#7301) is the pilot this mirrors. It differs in one
 * forced way, and the difference is worth naming because it bounds what this
 * generator can promise:
 *
 * ## Why the concatenation is COMMITTED here and was in-memory there
 *
 * `scripts/adr-anchors.mjs` assembles its shards with `readdirSync` at read
 * time, so no aggregate is checked in at all. That option does not exist for
 * this registry: `MIGRATIONS_BY_MAJOR` / `RETIRED_*_BY_MAJOR` are re-exported
 * from `@objectstack/spec`'s ROOT barrel and reach browser bundles through it.
 * A `node:fs` read anywhere in that graph breaks every consumer that bundles
 * the package — spec's `src/` is deliberately free of node builtins today. A
 * bundled library needs a STATIC module graph, and a static graph over N
 * entries needs one file that names all N.
 *
 * So the concatenation lands where it already was: inside `registry.ts`,
 * between markers. That choice is what keeps this change's blast radius at
 * zero for every existing consumer — `check-adr-0087-registration.mjs` still
 * reads every `id:` line out of `LEDGER_SOURCES`, `composeSpecChanges` still
 * folds the same objects, the public API is byte-identical, and the review diff
 * the ruling explicitly paid for is exactly the diff it was before.
 *
 * ⚠️ **What this therefore does NOT claim.** The AUTHORED surface is now
 * conflict-free by construction: two cards retiring different things write
 * different files and merge clean; two cards editing the SAME entry write the
 * same filename and git reports an add/add conflict, which is correct and must
 * stay true. The generated region is a different story — two entries whose ids
 * sort ADJACENTLY insert at the same anchor and still conflict textually. What
 * changed there is the class of the failure, not its existence: the region is
 * generated from files git merged as a set, `--check` fails if it does not
 * match them, and the only correct resolution is `gen:migration-registry`. A
 * resolution that DROPS an entry is now caught by this gate instead of landing
 * silently, which is the defect #6957 measured.
 *
 * ## Two structural properties, both enforced below
 *
 * **1. The filename is a pure function of the entry id** (`shardNameFor`), the
 * pilot's rule verbatim: it is what makes two cards touching different entries
 * merge clean while two cards touching one entry collide in git rather than
 * landing as two entries. {@link loadEntries} verifies the correspondence, so a
 * hand-renamed file cannot quietly opt out of the second half.
 *
 * **2. Order is DERIVED, never declared.** Entries are concatenated sorted by
 * id. There is deliberately **no index file** listing them: an index is itself
 * a single append-only file every card must edit, which reintroduces the exact
 * conflict being removed (PM decision on #6957). The directory listing is the
 * index.
 *
 * Usage:
 *   pnpm --filter @objectstack/spec gen:migration-registry
 *   pnpm --filter @objectstack/spec check:migration-registry     # --self-test && --check
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `src/migrations/registry.ts`, the file whose marked regions this writes. */
export const REGISTRY_PATH = 'src/migrations/registry.ts';

/** The per-entry source root. Repo-relative to the package. */
export const ENTRIES_DIR = 'src/migrations/entries';

/**
 * Non-entry files an entry directory is allowed to carry. Explicit for the same
 * reason the pilot's `NON_ENTRY_FILES` is: the directory IS the registry, so
 * anything in it that is not an entry has to say so once, here, rather than be
 * skipped by a pattern that also skips a typo.
 */
const NON_ENTRY_FILES = new Set(['README.md']);

/** The three append surfaces, each a directory and a marked region per major. */
export const KINDS = [
  { kind: 'semantic', dir: 'semantic' },
  { kind: 'retired-key', dir: 'retired-keys' },
  { kind: 'retired-def', dir: 'retired-defs' },
] as const;

export type Kind = (typeof KINDS)[number]['kind'];

/** One parsed entry file. */
export interface Entry {
  /** The entry's id — the semantic migration's `id`, or the retired key/def string. */
  id: string;
  /** The protocol major whose region it belongs to. */
  major: number;
  /** Leading `//` comment lines, verbatim and un-indented. */
  comment: string[];
  /** The literal the region carries: an object literal, or a quoted string. */
  literal: string[];
  /** Its filename, for error messages. */
  file: string;
}

/**
 * The shard filename for an entry — the whole naming rule, in one place.
 *
 * `17` + `data/AggregationNode:distinct` → `17.data__AggregationNode__distinct.ts`
 *
 * The major leads so a directory listing groups by region and sorts, within a
 * region, exactly as the emitted order does. `/` and `:` both become `__`
 * because neither is portable in a filename; the mapping only has to be a
 * FUNCTION (one id → one name), never reversible — the id is written inside the
 * file, and two ids that collided on a name would collide as an add/add
 * conflict, which is the behaviour duplicates should get anyway.
 */
export function shardNameFor(major: number, id: string): string {
  return `${major}.${id.replaceAll('/', '__').replaceAll(':', '__')}.ts`;
}

/**
 * Parse one entry file — pure, so `--self-test` can drive every red path with
 * synthetic text instead of an imitation of it.
 *
 * @param name the filename, used to derive the major and to report errors
 * @param text the file contents
 */
export function parseEntry(
  kind: Kind,
  name: string,
  text: string,
): { entry?: Entry; error?: string } {
  const where = `${ENTRIES_DIR}/${KINDS.find((k) => k.kind === kind)!.dir}/${name}`;

  const majorMatch = /^(\d+)\./.exec(name);
  if (!majorMatch) {
    return {
      error: `${where}: filename must start with the protocol major it registers under, e.g. \`17.<id>.ts\`.`,
    };
  }
  const major = Number(majorMatch[1]);

  const lines = text.split('\n');
  const declAt = lines.findIndex((l) => l.startsWith('export const entry'));
  if (declAt < 0) {
    return { error: `${where}: no \`export const entry\` — every entry file declares exactly one.` };
  }

  // The leading comment is the unbroken run of `//` lines immediately above the
  // declaration. Anything higher up (the copyright header, the type import) is
  // file scaffolding and is deliberately NOT carried into the registry.
  const comment: string[] = [];
  for (let i = declAt - 1; i >= 0 && lines[i].startsWith('//'); i--) comment.unshift(lines[i]);

  const eq = lines[declAt].indexOf('= ');
  if (eq < 0) return { error: `${where}: \`export const entry\` has no initializer.` };
  const literal = [lines[declAt].slice(eq + 2), ...lines.slice(declAt + 1)];
  while (literal.length && literal[literal.length - 1].trim() === '') literal.pop();
  const last = literal[literal.length - 1];
  if (last === undefined || !last.endsWith(';')) {
    return { error: `${where}: the entry initializer must end with \`;\` on its own last line.` };
  }
  literal[literal.length - 1] = last.slice(0, -1);

  let id: string;
  if (kind === 'semantic') {
    const m = /^ {2}id: '([^']+)',$/m.exec(literal.join('\n'));
    if (!m) return { error: `${where}: no \`id: '…'\` property — the id is the entry's identity.` };
    id = m[1];
  } else {
    const m = /^'([^']+)'$/.exec(literal.join('\n'));
    if (!m) {
      return { error: `${where}: a ${kind} entry is a single quoted string, e.g. \`export const entry = 'ui/PageCardProps:body';\`.` };
    }
    id = m[1];
  }

  // The correspondence is what makes two cards touching the SAME entry collide
  // on one filename while two cards touching different entries never share a
  // file. Unenforced, a rename re-opens the losing half of that.
  const expected = shardNameFor(major, id);
  if (name !== expected) {
    return {
      error:
        `${where}: filename does not match its entry id (${id}) — expected \`${expected}\`.\n` +
        '      The name is derived from the id on purpose: it is what makes two cards editing the same\n' +
        '      entry conflict in git instead of landing as two entries, and two cards editing different\n' +
        '      entries never share a file at all (#7297).',
    };
  }

  return { entry: { id, major, comment, literal, file: where } };
}

/** Every entry of one kind, sorted by id within each major. */
export function loadEntries(kind: Kind, root = pkgRoot): { entries: Entry[]; errors: string[] } {
  const dir = join(root, ENTRIES_DIR, KINDS.find((k) => k.kind === kind)!.dir);
  const errors: string[] = [];
  const entries: Entry[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    return { entries: [], errors: [`cannot read ${ENTRIES_DIR}/${kind} — ${(e as Error).message}`] };
  }
  for (const name of [...names].sort()) {
    if (NON_ENTRY_FILES.has(name)) continue;
    if (!name.endsWith('.ts')) {
      errors.push(
        `${ENTRIES_DIR}/${kind}/${name}: not an entry. Entries are one TypeScript file per entry, named ` +
          '`<major>.<id with / and : replaced by __>.ts`. Documentation must be named in NON_ENTRY_FILES ' +
          'in scripts/build-migration-registry.ts — the directory is the registry, so a non-entry says so once.',
      );
      continue;
    }
    const { entry, error } = parseEntry(kind, name, readFileSync(join(dir, name), 'utf8'));
    if (error) errors.push(error);
    else entries.push(entry!);
  }
  // Sorted by id. Duplicates cannot occur — the name is a function of the id and
  // a directory cannot hold two files with one name — which is why nothing here
  // checks for them.
  entries.sort((a, b) => (a.major - b.major) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries, errors };
}

/** The emitted body of one marked region, indented for its site (4 spaces). */
export function renderRegion(entries: Entry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    for (const c of e.comment) out.push(`    ${c}`);
    const lit = e.literal.map((l) => (l === '' ? '' : `    ${l}`));
    lit[lit.length - 1] += ',';
    out.push(...lit);
  }
  return out;
}

const closeMarker = (kind: Kind, major: number) => `    // </os-generated ${kind}:${major}>`;

/**
 * Splice every marked region of `registry.ts`. Pure over the file text, so the
 * self-test drives it without touching the tree.
 *
 * A region present in the file with no entries on disk is emitted EMPTY rather
 * than removed — a major whose semantic residue is genuinely nil (protocol 14)
 * is a real state, and the marker is where its first entry will land.
 */
export function renderRegistry(source: string, byKind: Record<Kind, Entry[]>): { text: string; errors: string[] } {
  const errors: string[] = [];
  const lines = source.split('\n');
  const out: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}\/\/ <os-generated ([a-z-]+):(\d+)>$/.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const kind = m[1] as Kind;
    const major = Number(m[2]);
    if (!KINDS.some((k) => k.kind === kind)) {
      errors.push(`${REGISTRY_PATH}:${i + 1}: unknown generated region kind \`${kind}\`.`);
      out.push(lines[i]);
      continue;
    }
    const close = lines.indexOf(closeMarker(kind, major), i + 1);
    if (close < 0) {
      errors.push(`${REGISTRY_PATH}:${i + 1}: region \`${kind}:${major}\` is never closed.`);
      out.push(lines[i]);
      continue;
    }
    seen.add(`${kind}:${major}`);
    out.push(lines[i], ...renderRegion(byKind[kind].filter((e) => e.major === major)), lines[close]);
    i = close;
  }

  // An entry whose major has no region would be silently dropped — the exact
  // class of failure this whole change exists to end, so it is a hard error.
  for (const { kind } of KINDS) {
    for (const e of byKind[kind]) {
      if (!seen.has(`${kind}:${e.major}`)) {
        errors.push(
          `${e.file}: registers under protocol major ${e.major}, but ${REGISTRY_PATH} has no ` +
            `\`<os-generated ${kind}:${e.major}>\` region. Add the region (and, for a semantic entry, ` +
            'the migration step that owns it) before the entry can be concatenated.',
        );
      }
    }
  }

  return { text: out.join('\n'), errors };
}

// ---------------------------------------------------------------------------
// self-test — every red path above, driven with synthetic input
// ---------------------------------------------------------------------------

function selfTest(): string[] {
  const failures: string[] = [];
  const eq = (what: string, actual: unknown, expected: unknown) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) failures.push(`${what}: got ${a}, expected ${b}`);
  };
  const red = (what: string, r: { error?: string }, needle: string) => {
    if (!r.error) failures.push(`${what}: expected an error, got none`);
    else if (!r.error.includes(needle)) failures.push(`${what}: error did not mention "${needle}" — ${r.error}`);
  };

  eq('shardNameFor slashes+colons', shardNameFor(17, 'data/AggregationNode:distinct'), '17.data__AggregationNode__distinct.ts');
  eq('shardNameFor plain id', shardNameFor(11, 'rls-sql-predicate-to-cel'), '11.rls-sql-predicate-to-cel.ts');

  const key = "export const entry = 'ui/PageCardProps:body';\n";
  const okKey = parseEntry('retired-key', '17.ui__PageCardProps__body.ts', `// note\n${key}`);
  eq('retired-key id', okKey.entry?.id, 'ui/PageCardProps:body');
  eq('retired-key comment', okKey.entry?.comment, ['// note']);
  eq('retired-key literal', okKey.entry?.literal, ["'ui/PageCardProps:body'"]);

  // The correspondence rule, in both directions.
  red('renamed file', parseEntry('retired-key', '17.wrong-name.ts', key), 'filename does not match');
  red('no major prefix', parseEntry('retired-key', 'ui__PageCardProps__body.ts', key), 'must start with the protocol major');
  red('no declaration', parseEntry('retired-key', '17.x.ts', '// just a comment\n'), 'no `export const entry`');
  red('unterminated', parseEntry('retired-key', '17.x.ts', "export const entry = 'x'\n"), 'must end with `;`');
  red('not a string', parseEntry('retired-key', '17.x.ts', 'export const entry = { id: 1 };\n'), 'a single quoted string');
  red('semantic without id', parseEntry('semantic', '17.x.ts', 'export const entry = {\n  surface: 1,\n};\n'), "no `id: '…'`");

  const sem = parseEntry(
    'semantic',
    '17.a-b.ts',
    "// lead\nexport const entry: SemanticMigration = {\n  id: 'a-b',\n  surface: 'x',\n};\n",
  );
  eq('semantic id', sem.entry?.id, 'a-b');
  eq('semantic render', renderRegion([sem.entry!]), [
    '    // lead',
    '    {',
    "      id: 'a-b',",
    "      surface: 'x',",
    '    },',
  ]);

  // Region splicing replaces only what is between the markers, and leaves a
  // region with no entries empty rather than dropping the markers.
  const doc = [
    'before',
    '    // <os-generated retired-key:17>',
    '    // stale content that must be replaced',
    '    // </os-generated retired-key:17>',
    '    // <os-generated retired-key:16>',
    '    // </os-generated retired-key:16>',
    'after',
  ].join('\n');
  const rendered = renderRegistry(doc, {
    semantic: [],
    'retired-key': [okKey.entry!],
    'retired-def': [],
  });
  eq('spliced', rendered.text.split('\n'), [
    'before',
    '    // <os-generated retired-key:17>',
    '    // note',
    "    'ui/PageCardProps:body',",
    '    // </os-generated retired-key:17>',
    '    // <os-generated retired-key:16>',
    '    // </os-generated retired-key:16>',
    'after',
  ]);
  eq('splice errors', rendered.errors, []);

  // An entry with no region is a hard error, never a silent drop.
  const orphan = renderRegistry('    // <os-generated retired-key:16>\n    // </os-generated retired-key:16>', {
    semantic: [],
    'retired-key': [okKey.entry!],
    'retired-def': [],
  });
  if (!orphan.errors.some((e) => e.includes('has no'))) {
    failures.push('orphan entry: expected a "no region" error, got ' + JSON.stringify(orphan.errors));
  }

  const unclosed = renderRegistry('    // <os-generated retired-key:17>', {
    semantic: [],
    'retired-key': [],
    'retired-def': [],
  });
  if (!unclosed.errors.some((e) => e.includes('never closed'))) {
    failures.push('unclosed region: expected an error, got ' + JSON.stringify(unclosed.errors));
  }

  return failures;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  const failures = selfTest();
  if (failures.length) {
    console.error('build-migration-registry --self-test FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('build-migration-registry --self-test: ok');
  if (argv.length === 1) process.exit(0);
}

const check = argv.includes('--check');
const registryPath = join(pkgRoot, REGISTRY_PATH);
const source = readFileSync(registryPath, 'utf8');

const byKind = {} as Record<Kind, Entry[]>;
const errors: string[] = [];
for (const { kind } of KINDS) {
  const loaded = loadEntries(kind);
  byKind[kind] = loaded.entries;
  errors.push(...loaded.errors);
}

const { text, errors: spliceErrors } = renderRegistry(source, byKind);
errors.push(...spliceErrors);

if (errors.length) {
  console.error('build-migration-registry: the entry directories are not readable as a registry.\n');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const counts = KINDS.map(({ kind }) => `${byKind[kind].length} ${kind}`).join(', ');

if (check) {
  if (text !== source) {
    console.error(
      `✗ ${REGISTRY_PATH} is stale — its generated regions do not match ${ENTRIES_DIR}/.\n\n` +
        '  Run:  pnpm --filter @objectstack/spec gen:migration-registry\n\n' +
        '  If you reached this after resolving a merge conflict INSIDE a marked region: do not\n' +
        '  hand-merge it. The entry files are the source and git merged them as a set; the only\n' +
        '  correct resolution is to regenerate. This gate exists because a resolution that drops\n' +
        "  one side's entry produces no other error anywhere (#6957).",
    );
    process.exit(1);
  }
  console.log(`✓ ${REGISTRY_PATH} is current (${counts})`);
} else {
  if (text !== source) writeFileSync(registryPath, text);
  console.log(`✓ wrote ${REGISTRY_PATH} (${counts})`);
}
