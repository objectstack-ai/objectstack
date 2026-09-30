// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Major 18's conversions, asked of git the way GitHub asks it (#20574).
//
// WHY THIS TEST SPAWNS GIT. The defect was never in a value: it was in a MERGE.
// Every major-18 retirement with a D2 conversion appended its conversion to the
// end of `CONVERSIONS_BY_MAJOR[18]` in `src/conversions/registry.ts`, and most
// defined it at the end of the definitions just above, so any two in flight
// conflicted in GitHub's server-side merge, which runs no driver and decides
// `mergeable`. The file is hand-written, so nothing regenerates it.
//
// The list is APPLICATION order — the loader runs it in sequence and step 18's
// `conversionIds` is read off it — so the cure cannot simply reorder it. Git
// conflicts on any two insertions into the same gap between unchanged lines, so
// the list's entries are kept sorted by identifier (two retirements land in
// different gaps) and carry an explicit `order` (where each applies); a new
// definition goes directly above the definition of the entry that follows it,
// so the definitions spread over the same gaps. This file holds both halves:
// the real registry is in that shape, and two retirement-shaped edits of the
// REAL file merge clean and right, with no driver. The same-gap pair, the
// end-appended list, the tail-appended definitions and the old array's tail are
// the lit controls — each MUST conflict, or a clean result would be equally
// explained by a harness that cannot see a conflict at all.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from '../../../scripts/git-env.mjs';
import { maskComments } from '../../../scripts/js-comment-mask.mjs';

import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { MIGRATIONS_BY_MAJOR } from '../src/migrations/registry';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(HERE, '../src/conversions/registry.ts');
/** Where the file sits in the fixture repo — the real relative path, so a failure names it. */
const REL = 'packages/spec/src/conversions/registry.ts';

const OPEN = 'const MAJOR_18_CONVERSIONS: readonly OrderedConversion[] = [\n';
const CLOSE = '];\n';
/** One entry, exactly as the registry spells it: the conversion's identifier, then its application order. */
const ENTRY = /  \{ conversion: ([A-Za-z_$][\w$]*), order: (\d+(?:\.\d+)?) \},\n/y;
/** A blank line — which is what a comment between entries is once `maskComments` has blanked it; it belongs to the entry below it. */
const BLANK = /[ \t]*\n/y;
/** A conversion definition and its id, which every definition in the file spells on the next line. */
const DEFINITION = /^(?:export )?const ([A-Za-z_$][\w$]*): MetadataConversion = \{\n  id: '([^'\n]+)',$/gm;
/** Where a conversion that sorts last is defined: directly above this declaration's doc comment. */
const TAIL_ANCHOR = '\ninterface OrderedConversion {\n';
/** How `CONVERSIONS_BY_MAJOR` reads the entries. */
const WIRING = '  18: inApplicationOrder(MAJOR_18_CONVERSIONS),\n';

/**
 * The entries that predate the placement rule: their definitions stay where
 * they were written. ⛔ Never add a name — a new conversion is placed by the
 * rule, and exempting it brings the shared tail back.
 */
const PLACED_BEFORE_THE_RULE: ReadonlySet<string> = new Set([
  'actionAriaRemoved', 'apiEndpointCacheTtlToCacheTtlSeconds', 'chartConfigAriaRemoved',
  'connectorConnectionTimeoutMsRemoved', 'connectorErrorMappingRemoved', 'connectorResilienceKeysRemoved',
  'connectorTriggersRemoved', 'cubeJoinSqlAndRelationshipRemoved', 'cubeMemberInnerNameRemoved',
  'cubeSubDayGranularitiesRemoved', 'currencyConfigPrecisionRemoved', 'dashboardRefreshIntervalToRefreshIntervalSeconds',
  'dashboardWidgetChartConfigStructureRemoved', 'elementFilterRemoved', 'elementFormRemoved',
  'elementInputTargetVariableRemoved', 'fieldColumnListsCanonicalized', 'fieldMalformedScalePrecisionRemoved',
  'fieldReferenceToAlias', 'flowDecisionModeInclusiveExplicit', 'formLayoutInlineGridToVertical',
  'formViewOptionDefaultRemoved', 'hookTimeoutToTimeoutMs', 'jobTimeoutToTimeoutMs',
  'listViewSortStringClauseToArray', 'mappingLookupParamsRemoved', 'memoryPersistenceAutoSaveIntervalToMs',
  'metricFiltersRemoved', 'objectGridDefaultSortRemoved', 'objectKanbanQuickAddRemoved',
  'objectTenancyOrganizationFieldRemoved', 'pageAssignedProfilesRemoved', 'pageComponentFilterRecordToRuleArray',
  'pageComponentResponsiveRemoved', 'permissionAllowRestorePurgeRemoved', 'permissionRlsTagsRemoved',
  'recordChatterPositionVocabulary', 'recordHighlightsFieldIconRemoved', 'reportJoinedChartRemoved',
  'translationComponentSubmitLabelRemoved', 'translationPerAppSettingsRemoved', 'tursoConfigTimeoutToTimeoutMs',
  'viewItemOwnerHiddenRemoved', 'viewListTabsRemoved', 'viewOverlayOwnerHiddenRemoved',
  'viewPageMountRemoved',
]);

interface Entry {
  ident: string;
  order: number;
  /** Offset of the entry's first line in the file — its leading comment's, when it has one. */
  at: number;
}

/**
 * The entries of `MAJOR_18_CONVERSIONS`, parsed from source text — every byte of the list accounted for.
 * Read through the shared comment mask, which keeps offsets, so a comment between entries is a blank line here.
 */
function entriesOf(source: string): { entries: Entry[]; end: number } {
  const text = maskComments(source);
  const start = text.indexOf(OPEN);
  expect(start, 'the MAJOR_18_CONVERSIONS declaration').toBeGreaterThan(-1);
  const entries: Entry[] = [];
  let at = start + OPEN.length;
  let lead = at;
  for (;;) {
    BLANK.lastIndex = at;
    if (BLANK.exec(text)) {
      at = BLANK.lastIndex;
      continue;
    }
    ENTRY.lastIndex = at;
    const m = ENTRY.exec(text);
    if (!m) break;
    entries.push({ ident: m[1]!, order: Number(m[2]), at: lead });
    at = lead = ENTRY.lastIndex;
  }
  // No residue: the list ends where the last entry does, so an entry spelled
  // any other way cannot hide from the checks below.
  expect(text.slice(at, at + CLOSE.length), `unparsed text in MAJOR_18_CONVERSIONS at offset ${at}`).toBe(CLOSE);
  return { entries, end: at };
}

/** Every conversion definition in the file, in file order — a commented-out one is not a definition. */
function definitionsOf(source: string): { ident: string; id: string; at: number }[] {
  return [...maskComments(source).matchAll(DEFINITION)].map((m) => ({ ident: m[1]!, id: m[2]!, at: m.index! }));
}

/** Rule 1, as findings: the entries are sorted strictly by identifier. */
function sortFindings(source: string): string[] {
  const idents = entriesOf(source).entries.map((e) => e.ident);
  return idents.flatMap((id, i) => (i > 0 && !(idents[i - 1]! < id) ? [`${idents[i - 1]} → ${id}`] : []));
}

/** Rule 2, as findings: an entry added after the rule is defined directly above the entry that follows it. */
function placementFindings(source: string): string[] {
  const { entries } = entriesOf(source);
  const defs = definitionsOf(source);
  const index = new Map(defs.map((d, i) => [d.ident, i]));
  return entries.flatMap((e, i) => {
    if (PLACED_BEFORE_THE_RULE.has(e.ident)) return [];
    const at = index.get(e.ident);
    if (at === undefined) return [`${e.ident}: no \`const ${e.ident}: MetadataConversion\` definition in the file`];
    const want = entries[i + 1]?.ident;
    const next = defs[at + 1]?.ident;
    if (next === want) return [];
    return [
      `${e.ident} is defined above ${next ?? 'nothing (it is the last conversion defined)'}; define it directly above `
        + (want ? `${want}'s definition, the entry that follows it` : 'OrderedConversion, after every other conversion'),
    ];
  });
}

/** The start of the doc comment directly above `offset`'s line, or the line itself when there is none. */
function docStart(source: string, offset: number): number {
  const before = source.slice(0, offset);
  return before.endsWith('*/\n') ? before.lastIndexOf('/**') : offset;
}

const kebab = (ident: string): string => `synthetic-${ident.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const definition = (ident: string): string => `/** A synthetic major-18 retirement. */\nconst ${ident}: MetadataConversion = {\n`
  + `  id: '${kebab(ident)}',\n  toMajor: 18,\n  surface: 'synthetic.key',\n  summary: 'synthetic',\n`
  + '  apply: (stack) => stack,\n  fixture: { before: {}, after: {}, expectedNotices: 0 },\n};\n\n';
const entry = (ident: string, order: number): string => `  { conversion: ${ident}, order: ${order} },\n`;

/** Offset of the definition the doc comment asks for: above the next entry's, or above `OrderedConversion`. */
function definitionSite(source: string, ident: string): number {
  const next = entriesOf(source).entries.find((e) => e.ident > ident);
  if (!next) return docStart(source, source.indexOf(TAIL_ANCHOR) + 1);
  const def = definitionsOf(source).find((d) => d.ident === next.ident);
  expect(def, `${next.ident}'s definition`).toBeDefined();
  return docStart(source, def!.at);
}

const insert = (source: string, at: number, text: string): string => source.slice(0, at) + text + source.slice(at);

/** The entry, inserted where its identifier sorts. */
function sortedEntry(source: string, ident: string, order: number): string {
  const { entries, end } = entriesOf(source);
  return insert(source, entries.find((e) => e.ident > ident)?.at ?? end, entry(ident, order));
}

/** A retirement-shaped edit, as the doc comment asks: the definition above its successor's, the entry where it sorts. */
function retire(source: string, ident: string, order: number): string {
  return sortedEntry(insert(source, definitionSite(source, ident), definition(ident)), ident, order);
}

/** The list half done the old way: the entry appended at the list's END (the definition still placed by the rule). */
function retireAtListEnd(source: string, ident: string, order: number): string {
  const withDefinition = insert(source, definitionSite(source, ident), definition(ident));
  return insert(withDefinition, entriesOf(withDefinition).end, entry(ident, order));
}

/** The definition half done the old way: defined after every other conversion (the entry still sorted). */
function retireAtDefinitionsEnd(source: string, ident: string, order: number): string {
  const tail = docStart(source, source.indexOf(TAIL_ANCHOR) + 1);
  return sortedEntry(insert(source, tail, definition(ident)), ident, order);
}

/** The application order the entries spell: ascending `order`, ties by the conversion's `id`. */
function applicationOrder(source: string): string[] {
  const ids = new Map(definitionsOf(source).map((d) => [d.ident, d.id]));
  return entriesOf(source)
    .entries.map((e) => ({ order: e.order, id: ids.get(e.ident)! }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => e.id);
}

/** Every fixture git is LOCAL-ONLY and hermetic: no inherited `GIT_*`, no global or system config. */
const HERMETIC_ENV: NodeJS.ProcessEnv = (() => {
  const env = gitFreeEnv();
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
})();

const GIT_ARGS = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false'];

/** A throwaway repository holding one file at `REL` — no attributes and no driver, which is what GitHub's merge sees. */
class FileRepo {
  readonly root = mkdtempSync(path.join(tmpdir(), 'os-conversions-major18-merge-'));

  constructor(readonly base: string) {
    this.must('init', '-q', '-b', 'base');
    this.write(base);
    this.must('add', '-A');
    this.must('commit', '-q', '-m', 'base');
  }

  private write(text: string): void {
    mkdirSync(path.dirname(path.join(this.root, REL)), { recursive: true });
    writeFileSync(path.join(this.root, REL), text);
  }

  git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('git', [...GIT_ARGS, ...args], { cwd: this.root, encoding: 'utf8', env: HERMETIC_ENV, maxBuffer: 1 << 28 });
    if (r.error) throw r.error;
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  must(...args: string[]): string {
    const r = this.git(...args);
    expect(r.status, `git ${args.join(' ')}\n${r.stderr}`).toBe(0);
    return r.stdout;
  }

  /** Commit `text` on a new branch cut from `base`. */
  branch(name: string, text: string): void {
    expect(text, `branch ${name} must change the file`).not.toBe(this.base);
    this.must('checkout', '-q', '-b', name, 'base');
    this.write(text);
    this.must('commit', '-q', '-am', name);
  }

  /** `git merge-tree --write-tree` of two branches: exit code, tree, and the paths it names on a conflict. */
  merge(a: string, b: string): { status: number | null; tree: string; conflicted: string[] } {
    const r = this.git('merge-tree', '--write-tree', '--name-only', '--no-messages', a, b);
    const [tree = '', ...rest] = r.stdout.trim().split('\n');
    return { status: r.status, tree, conflicted: rest.filter(Boolean) };
  }

  /** The merged file's bytes. */
  merged(tree: string): string {
    return this.must('show', `${tree}:${REL}`);
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

const SOURCE = readFileSync(REGISTRY_PATH, 'utf8');
const { entries: REAL } = entriesOf(SOURCE);
const IDENTS = REAL.map((e) => e.ident);
const NEXT_ORDER = Math.max(...REAL.map((e) => e.order)) + 1;
const APPLIED = CONVERSIONS_BY_MAJOR[18]!.map((c) => c.id);

/** How many existing identifiers sort before `ident` — the gap an insertion lands in. */
const gapOf = (ident: string): number => IDENTS.filter((x) => x < ident).length;

describe('major 18 in the conversions registry — the shape the merge needs (#20574)', () => {
  it('`CONVERSIONS_BY_MAJOR[18]` is read off the entries, not written as an array to append to', () => {
    const table = SOURCE.slice(SOURCE.indexOf('export const CONVERSIONS_BY_MAJOR'));
    expect(table.slice(0, table.indexOf('\n};\n') + 1)).toContain(WIRING);
    expect(table).not.toMatch(/^ {2}18: \[/m);
    expect(REAL.length).toBeGreaterThan(2);
  });

  it('the entries are kept SORTED by identifier, one entry each — so insertions spread over the list', () => {
    expect(
      sortFindings(SOURCE),
      'MAJOR_18_CONVERSIONS must stay sorted by identifier (strictly: one entry per conversion). An entry added at '
        + 'the END puts every retirement in one gap, and two in flight conflict again. Move it to where it sorts.',
    ).toEqual([]);
  });

  it('each entry is a major-18 conversion defined in this file, and the list is all of them', () => {
    const ids = new Map(definitionsOf(SOURCE).map((d) => [d.ident, d.id]));
    expect(IDENTS.filter((i) => !ids.has(i))).toEqual([]);
    expect(new Set(IDENTS.map((i) => ids.get(i)))).toEqual(new Set(APPLIED));
    expect(APPLIED).toHaveLength(IDENTS.length);
    expect(CONVERSIONS_BY_MAJOR[18]!.every((c) => c.toMajor === 18)).toBe(true);
  });

  it('`order` places each conversion, and the loader and step 18 apply them in that order', () => {
    for (const e of REAL) expect(Number.isFinite(e.order) && e.order > 0, `${e.ident}: order ${e.order}`).toBe(true);
    const order = applicationOrder(SOURCE);
    // Anti-vacuity: application order differs from key order, so this compares the replay, not the list.
    const ids = new Map(definitionsOf(SOURCE).map((d) => [d.ident, d.id]));
    expect(order).not.toEqual(IDENTS.map((i) => ids.get(i)));
    expect(APPLIED).toEqual(order);
    expect(ALL_CONVERSIONS.slice(-order.length).map((c) => c.id)).toEqual(order);
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toEqual(order);
  });

  it('a conversion added after the rule is defined directly above the entry that follows it', () => {
    expect(PLACED_BEFORE_THE_RULE.size, '⛔ the exemption is closed: place a new conversion by the rule').toBe(46);
    expect(placementFindings(SOURCE)).toEqual([]);
  });
});

describe('major 18 in the conversions registry — two retirements, no merge driver (#20574)', () => {
  // Two identifiers one existing entry apart — the closest two DIFFERENT gaps
  // get — and a third in the first one's gap. Derived from the real list (the
  // first `k` from the middle where the suffixed names land where intended),
  // so the pair keeps meaning what it says as retirements land.
  const identsAt = (i: number) => [`${IDENTS[i - 1]}SyntheticA`, `${IDENTS[i]}SyntheticB`, `${IDENTS[i - 1]}SyntheticC`] as const;
  const k = [...IDENTS.keys()]
    .filter((i) => i > 0)
    .sort((x, y) => Math.abs(x - IDENTS.length / 2) - Math.abs(y - IDENTS.length / 2))
    .find((i) => {
      const [a, b, c] = identsAt(i);
      return gapOf(a) === i && gapOf(b) === i + 1 && gapOf(c) === i;
    }) ?? -1;
  const [A, B, SAME_GAP] = identsAt(Math.max(k, 1));
  let repo: FileRepo;

  beforeAll(() => {
    repo = new FileRepo(SOURCE);
    // Both in flight take the same next `order`, as two PRs cut from one base do.
    repo.branch('sorted-a', retire(SOURCE, A, NEXT_ORDER));
    repo.branch('sorted-b', retire(SOURCE, B, NEXT_ORDER));
    repo.branch('sorted-same-gap', retire(SOURCE, SAME_GAP, NEXT_ORDER));
    repo.branch('list-end-a', retireAtListEnd(SOURCE, A, NEXT_ORDER));
    repo.branch('list-end-b', retireAtListEnd(SOURCE, B, NEXT_ORDER));
    repo.branch('definitions-end-a', retireAtDefinitionsEnd(SOURCE, A, NEXT_ORDER));
    repo.branch('definitions-end-b', retireAtDefinitionsEnd(SOURCE, B, NEXT_ORDER));
  });
  afterAll(() => repo.dispose());

  it('the pair is what it claims: adjacent gaps, one existing entry between them, a third name sharing the first gap', () => {
    expect(k, 'no position in the list yields such a pair').toBeGreaterThan(0);
    expect(gapOf(A)).toBe(k);
    expect(gapOf(B)).toBe(k + 1);
    expect(gapOf(SAME_GAP)).toBe(k);
    expect(repo.git('config', '--get', 'merge.os-regen.driver').status).toBe(1);
  });

  it('each side obeys the registry\'s own rules, and each old-way side breaks the rule the pin holds', () => {
    for (const side of [retire(SOURCE, A, NEXT_ORDER), retire(SOURCE, B, NEXT_ORDER)]) {
      expect(sortFindings(side)).toEqual([]);
      expect(placementFindings(side)).toEqual([]);
    }
    expect(sortFindings(retireAtListEnd(SOURCE, A, NEXT_ORDER))).not.toEqual([]);
    // A's entry follows its neighbour's, so a neighbour placed by the rule is
    // found too: its entry is now followed by A's, and A is defined elsewhere.
    const neighbour = IDENTS[k - 1]!;
    expect(placementFindings(retireAtDefinitionsEnd(SOURCE, A, NEXT_ORDER))).toEqual([
      ...(PLACED_BEFORE_THE_RULE.has(neighbour)
        ? []
        : [`${neighbour} is defined above ${IDENTS[k]}; define it directly above ${A}'s definition, the entry that follows it`]),
      `${A} is defined above nothing (it is the last conversion defined); define it directly above ${IDENTS[k]}'s `
        + 'definition, the entry that follows it',
    ]);
  });

  // THE CARD'S REPRODUCTION, now clean.
  it('two retirements placed as the registry asks: merge clean, the result is both edits, and the order is deterministic', () => {
    const m = repo.merge('sorted-a', 'sorted-b');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    const expected = retire(retire(SOURCE, A, NEXT_ORDER), B, NEXT_ORDER);
    const merged = repo.merged(m.tree);
    expect(merged === expected, 'the merged file is not the two edits applied together').toBe(true);
    expect(sortFindings(merged)).toEqual([]);
    expect(placementFindings(merged)).toEqual([]);
    // Equal `order` from a shared base applies in `id` order, after everything already there.
    expect(applicationOrder(merged)).toEqual([...APPLIED, ...[kebab(A), kebab(B)].sort()]);
  });

  // THE LIT CONTROLS: the same harness, four pairs that must still conflict.
  it('two retirements in the SAME gap still conflict — the residue a key sort cannot remove', () => {
    const m = repo.merge('sorted-a', 'sorted-same-gap');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([REL]);
  });

  it('the same two entries appended at the list\'s END conflict — the order key alone is not the cure', () => {
    const m = repo.merge('list-end-a', 'list-end-b');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([REL]);
  });

  it('the same two conversions defined after every other conversion conflict — the definitions have a tail too', () => {
    const m = repo.merge('definitions-end-a', 'definitions-end-b');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([REL]);
  });

  it('the old shape — an array each retirement appended to, below definitions each appended to — conflicts', () => {
    const old = '/** The last conversion defined. */\nconst viewListTabsRemoved: MetadataConversion = {\n'
      + "  id: 'view-list-tabs-removed',\n};\n\n"
      + 'export const CONVERSIONS_BY_MAJOR = {\n  18: [\n    viewListTabsRemoved,\n  ],\n};\n';
    const append = (ident: string) => old
      .replace('export const CONVERSIONS_BY_MAJOR', `${definition(ident)}export const CONVERSIONS_BY_MAJOR`)
      .replace('    viewListTabsRemoved,\n', `    viewListTabsRemoved,\n    ${ident},\n`);
    const legacy = new FileRepo(old);
    try {
      legacy.branch('old-a', append(A));
      legacy.branch('old-b', append(B));
      const m = legacy.merge('old-a', 'old-b');
      expect(m.status).toBe(1);
      expect(m.conflicted).toEqual([REL]);
    } finally {
      legacy.dispose();
    }
  });
});
