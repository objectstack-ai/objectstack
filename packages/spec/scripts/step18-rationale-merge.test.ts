// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Step 18's rationale, asked of git the way GitHub asks it (#20535).
//
// WHY THIS TEST SPAWNS GIT. The defect was never in a value: it was in a MERGE.
// Every major-18 retirement PR appended its sentences to `step18.rationale` in
// `src/migrations/registry.ts` — one `+` chain whose closing line each PR
// rewrote — and its id to the end of `step18.conversionIds`, so any two in
// flight conflicted in GitHub's server-side merge, which runs no driver and
// decides `mergeable`. The file is hand-written, so nothing regenerates it.
//
// The cure is a SHAPE, and a shape is only proven by merging it. Git conflicts
// on any two insertions into the same gap between unchanged lines, so a plain
// array appended at its end conflicts exactly as the old tail did; the
// fragments are kept sorted by `id` instead, so two retirements land in
// different gaps, and `order` says where each renders. This file holds both
// halves: the real registry is in that shape, and two retirement-shaped
// insertions into the REAL file merge clean and right, with no driver. The
// same-gap pair, the end-appended pair and the old `+`-chain tail are the lit
// controls — each MUST conflict, or a clean result would be equally explained
// by a harness that cannot see a conflict at all.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { gitFreeEnv } from '../../../scripts/git-env.mjs';

import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { MIGRATIONS_BY_MAJOR } from '../src/migrations/registry';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(HERE, '../src/migrations/registry.ts');
/** Where the file sits in the fixture repo — the real relative path, so a failure names it. */
const REL = 'packages/spec/src/migrations/registry.ts';

const OPEN = 'const STEP18_RATIONALE: readonly RationaleFragment[] = [\n';
const CLOSE = '];\n';
/** One element, exactly as the registry spells it: the key, the render order, then the literal chain. */
const ELEMENT = /  \{\n    id: '([^'\n]*)',\n    order: (\d+),\n    text:\n((?:      [^\n]*\n)+?)  \},\n/y;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

interface Fragment {
  id: string;
  order: number;
  text: string;
  /** Offset of the element's first line in the file. */
  at: number;
}

/** The fragments of `STEP18_RATIONALE`, parsed from source text — every byte of the list accounted for. */
function fragmentsOf(source: string): { fragments: Fragment[]; end: number } {
  const start = source.indexOf(OPEN);
  expect(start, 'the STEP18_RATIONALE declaration').toBeGreaterThan(-1);
  const fragments: Fragment[] = [];
  let at = start + OPEN.length;
  for (;;) {
    ELEMENT.lastIndex = at;
    const m = ELEMENT.exec(source);
    if (!m) break;
    const expr = m[3]!.trim().replace(/,$/, '');
    fragments.push({ id: m[1]!, order: Number(m[2]), text: runInNewContext(`(${expr})`) as string, at });
    at = ELEMENT.lastIndex;
  }
  // No residue: the list ends where the last element does, so a fragment
  // spelled any other way cannot hide from the checks below.
  expect(source.slice(at, at + CLOSE.length), `unparsed text in STEP18_RATIONALE at offset ${at}`).toBe(CLOSE);
  return { fragments, end: at };
}

/** A retirement-shaped edit: one new element, inserted where its key sorts — what the list's doc comment asks for. */
function insertSorted(source: string, id: string, order: number, sentence: string): string {
  const { fragments, end } = fragmentsOf(source);
  const next = fragments.find((f) => f.id > id);
  const at = next ? next.at : end;
  const element = `  {\n    id: '${id}',\n    order: ${order},\n    text:\n      '${sentence}',\n  },\n`;
  return source.slice(0, at) + element + source.slice(at);
}

/** The shape the triage's first sketch named: the same element appended at the list's END. */
function appendAtEnd(source: string, id: string, order: number, sentence: string): string {
  const { end } = fragmentsOf(source);
  const element = `  {\n    id: '${id}',\n    order: ${order},\n    text:\n      '${sentence}',\n  },\n`;
  return source.slice(0, end) + element + source.slice(end);
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
  readonly root = mkdtempSync(path.join(tmpdir(), 'os-step18-rationale-merge-'));

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
const { fragments: REAL } = fragmentsOf(SOURCE);
const IDS = REAL.map((f) => f.id);
const NEXT_ORDER = Math.max(...REAL.map((f) => f.order)) + 1;

/** How many existing keys sort before `id` — the gap an insertion lands in. */
const gapOf = (id: string): number => IDS.filter((x) => x < id).length;

describe('step 18 in the registry — the shape the merge needs (#20535)', () => {
  it('the rationale is a list of fragments, not one string', () => {
    expect(REAL.length).toBeGreaterThan(2);
  });

  it('the fragments are kept SORTED by key, one key each, all kebab-case — so insertions spread over the list', () => {
    const outOfPlace = IDS.flatMap((id, i) => (i > 0 && !(IDS[i - 1]! < id) ? [`${IDS[i - 1]} → ${id}`] : []));
    expect(
      outOfPlace,
      'STEP18_RATIONALE must stay sorted by `id` (strictly: keys are unique). A fragment added at the END puts '
        + 'every retirement in one gap, and two in flight conflict again. Move it to where its id sorts.',
    ).toEqual([]);
    expect(IDS.filter((id) => !KEBAB.test(id))).toEqual([]);
  });

  it('`order` places each fragment, and the step renders them in that order, joined with one space', () => {
    for (const f of REAL) {
      expect(Number.isInteger(f.order) && f.order > 0, `${f.id}: order ${f.order}`).toBe(true);
      expect(f.text.length, `${f.id}: empty text`).toBeGreaterThan(0);
      expect(f.text, `${f.id}: a leading or trailing space doubles at the join`).toBe(f.text.trim());
    }
    const byOrder = [...REAL].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    // Anti-vacuity: render order differs from key order, so this compares the join, not the list.
    expect(byOrder.map((f) => f.id)).not.toEqual(IDS);
    expect(MIGRATIONS_BY_MAJOR[18]!.rationale).toBe(byOrder.map((f) => f.text).join(' '));
  });

  it('`conversionIds` is read off the conversions registry — no second list for a retirement to append to', () => {
    const step18 = SOURCE.slice(SOURCE.indexOf('const step18: MigrationStep = {'));
    const head = step18.slice(0, step18.indexOf('  semantic: ['));
    expect(head).toContain('  conversionIds: CONVERSIONS_BY_MAJOR[18]!.map((c) => c.id),\n');
    expect(head).not.toMatch(/conversionIds: \[/);
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toEqual(CONVERSIONS_BY_MAJOR[18]!.map((c) => c.id));
  });
});

describe('step 18 in the registry — two retirements, no merge driver (#20535)', () => {
  // Two keys one existing fragment apart — the closest two DIFFERENT gaps get —
  // and a third key in the first one's gap. Derived from the real list (the
  // first `k` from the middle where the suffixed keys land where intended), so
  // the pair keeps meaning what it says as retirements land.
  const keysAt = (i: number) => [`${IDS[i - 1]}-synthetic-a`, `${IDS[i]}-synthetic-b`, `${IDS[i - 1]}-synthetic-c`] as const;
  const k = [...IDS.keys()]
    .filter((i) => i > 0)
    .sort((x, y) => Math.abs(x - IDS.length / 2) - Math.abs(y - IDS.length / 2))
    .find((i) => {
      const [a, b, c] = keysAt(i);
      return gapOf(a) === i && gapOf(b) === i + 1 && gapOf(c) === i;
    }) ?? -1;
  const [ID_A, ID_B, ID_SAME_GAP] = keysAt(Math.max(k, 1));
  const SENTENCE_A = 'It also retires the synthetic key a (ADR-0049 enforce-or-remove).';
  const SENTENCE_B = 'It also retires the synthetic key b (ADR-0049 enforce-or-remove).';
  const SENTENCE_C = 'It also retires the synthetic key c (ADR-0049 enforce-or-remove).';
  let repo: FileRepo;

  beforeAll(() => {
    repo = new FileRepo(SOURCE);
    // Both in flight take the same next `order`, as two PRs cut from one base do.
    repo.branch('sorted-a', insertSorted(SOURCE, ID_A, NEXT_ORDER, SENTENCE_A));
    repo.branch('sorted-b', insertSorted(SOURCE, ID_B, NEXT_ORDER, SENTENCE_B));
    repo.branch('sorted-same-gap', insertSorted(SOURCE, ID_SAME_GAP, NEXT_ORDER, SENTENCE_C));
    repo.branch('end-a', appendAtEnd(SOURCE, ID_A, NEXT_ORDER, SENTENCE_A));
    repo.branch('end-b', appendAtEnd(SOURCE, ID_B, NEXT_ORDER, SENTENCE_B));
  });
  afterAll(() => repo.dispose());

  it('the pair is what it claims: adjacent gaps, one existing fragment between them, a third key sharing the first gap', () => {
    expect(k, 'no position in the list yields such a pair').toBeGreaterThan(0);
    expect(gapOf(ID_A)).toBe(k);
    expect(gapOf(ID_B)).toBe(k + 1);
    expect(gapOf(ID_SAME_GAP)).toBe(k);
    expect(repo.git('config', '--get', 'merge.os-regen.driver').status).toBe(1);
  });

  // THE CARD'S REPRODUCTION, now clean.
  it('two retirements inserted where their keys sort: merge clean, and the result is both insertions', () => {
    const m = repo.merge('sorted-a', 'sorted-b');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    const expected = insertSorted(insertSorted(SOURCE, ID_A, NEXT_ORDER, SENTENCE_A), ID_B, NEXT_ORDER, SENTENCE_B);
    expect(repo.merged(m.tree) === expected, 'the merged file is not the two insertions applied together').toBe(true);
    // Equal `order` from a shared base renders in key order, after everything already there.
    const merged = fragmentsOf(repo.merged(m.tree)).fragments;
    const rendered = [...merged].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)).map((f) => f.id);
    expect(rendered.slice(-2)).toEqual([ID_A, ID_B]);
  });

  // THE LIT CONTROLS: the same harness, three pairs that must still conflict.
  it('two retirements in the SAME gap still conflict — the residue a key sort cannot remove', () => {
    const m = repo.merge('sorted-a', 'sorted-same-gap');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([REL]);
  });

  it('the same two fragments appended at the list\'s END conflict — an array alone is not the cure', () => {
    const m = repo.merge('end-a', 'end-b');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([REL]);
  });

  it('the old shape — a `+` chain whose closing line each retirement rewrote — conflicts', () => {
    const tail = "    + 'refused at parse rather than rewritten.',\n  conversionIds: [\n";
    const old = `const step18 = {\n  rationale:\n    'It also retires the list view\\'s own \`tabs\`. '\n${tail}    'view-list-tabs-removed',\n  ],\n};\n`;
    const append = (sentence: string, id: string) => old
      .replace(tail, `    + 'refused at parse rather than rewritten. '\n    + '${sentence}',\n  conversionIds: [\n`)
      .replace("    'view-list-tabs-removed',\n", `    'view-list-tabs-removed',\n    '${id}',\n`);
    const legacy = new FileRepo(old);
    try {
      legacy.branch('old-a', append(SENTENCE_A, 'synthetic-a-removed'));
      legacy.branch('old-b', append(SENTENCE_B, 'synthetic-b-removed'));
      const m = legacy.merge('old-a', 'old-b');
      expect(m.status).toBe(1);
      expect(m.conflicted).toEqual([REL]);
    } finally {
      legacy.dispose();
    }
  });
});
