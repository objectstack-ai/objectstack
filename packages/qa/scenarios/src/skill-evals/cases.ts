// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The published skills' eval cases, read from a skills root: the workspace's
 * `skills/` tree, or the `dist/skills/` of a packed `@objectstack/skills`
 * version. Each bundle is one directory holding a `SKILL.md`; its cases are the
 * `evals/*.json` files beside it, in the shape every one of them already uses:
 *
 *   { "skill_name": BUNDLE, "evals": [ { "id", "prompt", "expected_output",
 *     "files": [], "assertions": { "must_contain": [..], "must_not_contain": [..] } } ] }
 *
 * The reader is strict, never lenient: a file that does not parse, a case
 * whose prompt is not a string, an assertion list that is not a list of
 * strings, or a case with no assertion at all is a located refusal — never a
 * case graded as a pass because nothing was asked of it. The cases themselves
 * are not this runner's to edit.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** One eval case, located. */
export interface SkillEvalCase {
  /** The bundle directory name (`objectstack-query`). */
  bundle: string;
  /** The eval file's name inside `evals/` (`filters-pagination-search.json`). */
  file: string;
  /** The case's own `id` inside its file. */
  id: number | string;
  /** `BUNDLE/FILE_STEM#ID` — unique across a catalog. */
  key: string;
  prompt: string;
  expectedOutput?: string;
  mustContain: string[];
  mustNotContain: string[];
}

/** A file or case the reader refused, with where. */
export interface SkillEvalRefusal {
  path: string;
  message: string;
}

export interface SkillEvalCatalog {
  root: string;
  /** Every bundle directory under the root (a `SKILL.md` beside it), sorted. */
  bundles: string[];
  /**
   * Bundles whose `SKILL.md` frontmatter says `user-invocable: false`. Claude
   * Code leaves such a skill out of the init line's `skills` list while the
   * model can still launch it (measured on 2.1.326: `objectui`, absent from
   * every with-skill init line of a round, launched by 33 of its 34 turns), so
   * the init line cannot show that it was installed.
   */
  unlistedBundles: string[];
  cases: SkillEvalCase[];
  refusals: SkillEvalRefusal[];
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** `BUNDLE/FILE_STEM#ID`. */
export const caseKey = (bundle: string, file: string, id: number | string): string => `${bundle}/${file.replace(/\.json$/, '')}#${id}`;

/**
 * The case as a turn meets it: a hash of the prompt the turn is asked and the
 * two token lists its answer is graded on (`expected_output` is neither sent
 * nor graded, so it is left out). Every run record carries it, so `--regrade`
 * can tell a case reworded since the round from the case that ran. Pure.
 */
export const hashCase = (c: Pick<SkillEvalCase, 'prompt' | 'mustContain' | 'mustNotContain'>): string =>
  `sha256:${createHash('sha256').update(JSON.stringify([c.prompt, c.mustContain, c.mustNotContain])).digest('hex')}`;

/** Read one eval file's text into cases, or refusals. Pure over its inputs. */
export function parseEvalFile(bundle: string, file: string, text: string): { cases: SkillEvalCase[]; refusals: SkillEvalRefusal[] } {
  const path = `${bundle}/evals/${file}`;
  const cases: SkillEvalCase[] = [];
  const refusals: SkillEvalRefusal[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { cases, refusals: [{ path, message: `does not parse: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const evals = typeof doc === 'object' && doc !== null && !Array.isArray(doc) ? (doc as Record<string, unknown>).evals : undefined;
  if (!Array.isArray(evals)) return { cases, refusals: [{ path, message: 'has no `evals` list' }] };
  const seen = new Set<string>();
  evals.forEach((raw, i) => {
    const at = `${path}: evals[${i}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      refusals.push({ path: at, message: 'is not an object' });
      return;
    }
    const e = raw as Record<string, unknown>;
    const id = e.id;
    if (typeof id !== 'number' && typeof id !== 'string') {
      refusals.push({ path: at, message: '`id` is neither a number nor a string' });
      return;
    }
    if (typeof e.prompt !== 'string' || e.prompt.trim() === '') {
      refusals.push({ path: at, message: '`prompt` is not a non-empty string' });
      return;
    }
    const a = e.assertions;
    if (typeof a !== 'object' || a === null || Array.isArray(a)) {
      refusals.push({ path: at, message: '`assertions` is not an object' });
      return;
    }
    const { must_contain: mc = [], must_not_contain: mnc = [] } = a as Record<string, unknown>;
    if (!isStringList(mc) || !isStringList(mnc)) {
      refusals.push({ path: at, message: '`assertions.must_contain` / `must_not_contain` must each be a list of strings' });
      return;
    }
    if (mc.length + mnc.length === 0) {
      refusals.push({ path: at, message: 'asserts nothing: a case with no `must_contain` and no `must_not_contain` would pass every answer' });
      return;
    }
    const key = caseKey(bundle, file, id);
    if (seen.has(key)) {
      refusals.push({ path: at, message: `repeats the id \`${String(id)}\`` });
      return;
    }
    seen.add(key);
    cases.push({
      bundle,
      file,
      id,
      key,
      prompt: e.prompt,
      ...(typeof e.expected_output === 'string' ? { expectedOutput: e.expected_output } : {}),
      mustContain: mc,
      mustNotContain: mnc,
    });
  });
  return { cases, refusals };
}

/** Every bundle under `root` and every case its `evals/*.json` hold. */
export function loadSkillEvalCatalog(root: string): SkillEvalCatalog {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { root, bundles: [], unlistedBundles: [], cases: [], refusals: [{ path: root, message: 'is not a directory of skill bundles' }] };
  }
  const bundles = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
  const cases: SkillEvalCase[] = [];
  const refusals: SkillEvalRefusal[] = [];
  for (const bundle of bundles) {
    const dir = join(root, bundle, 'evals');
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'))
      .map((d) => d.name)
      .sort();
    for (const file of files) {
      const r = parseEvalFile(bundle, file, readFileSync(join(dir, file), 'utf8'));
      cases.push(...r.cases);
      refusals.push(...r.refusals);
    }
  }
  const unlistedBundles = bundles.filter((b) => notUserInvocable(readFileSync(join(root, b, 'SKILL.md'), 'utf8')));
  return { root, bundles, unlistedBundles, cases, refusals };
}

/** The `SKILL.md` frontmatter sets `user-invocable: false`. Pure over its input. */
export function notUserInvocable(skillMd: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  return fm !== null && /^user-invocable:\s*false\s*$/m.test(fm[1]!);
}

/**
 * Narrow a catalog to the named bundles (`--skills a,b`). A name that is not a
 * bundle of the catalog is refused, never dropped: a misspelt touched skill
 * would otherwise run nothing and read as a clean round.
 */
export function selectBundles(catalog: SkillEvalCatalog, names: readonly string[] | undefined): SkillEvalCase[] {
  if (!names || names.length === 0) return catalog.cases;
  const unknown = names.filter((n) => !catalog.bundles.includes(n));
  if (unknown.length) throw new Error(`--skills names ${unknown.map((n) => `\`${n}\``).join(', ')}, not a bundle under ${catalog.root} (bundles: ${catalog.bundles.join(', ')})`);
  const noCases = names.filter((n) => !catalog.cases.some((c) => c.bundle === n));
  if (noCases.length) throw new Error(`--skills names ${noCases.map((n) => `\`${n}\``).join(', ')}, a bundle with no eval case under ${catalog.root}`);
  const set = new Set(names);
  return catalog.cases.filter((c) => set.has(c.bundle));
}
