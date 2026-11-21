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
 * A TRIGGER case asks the other question about a skill: was it loaded when
 * it should be, and left alone when it should not. It is the same entry with
 * `"should_trigger": true | false` in place of `assertions`, and it is graded
 * on whether the with-skill turn loaded the bundle, never on its answer:
 *
 *   { "id", "prompt", "should_trigger": false, "files": [] }
 *
 * `files` names what a case needs on disk: each entry is a path under the
 * bundle's `evals/files/` (`"evals/files/src/objects/task.object.ts"`), a file
 * or a directory, placed in the turn's working directory at the path below
 * `evals/files/` on both arms. `evals/` itself is never copied into a turn, so
 * a case's files reach it only this way.
 *
 * The reader is strict, never lenient: a file that does not parse, a case
 * whose prompt is not a string, an assertion list that is not a list of
 * strings, a case with no assertion at all, a trigger case that also carries
 * assertions, a `files` entry outside `evals/files/` or missing from it, and a
 * bundle whose trigger cases are all of one kind (all positive cannot show a
 * false load; all negative cannot show a missed one) are located refusals —
 * never a case graded as a pass because nothing was asked of it. The cases
 * themselves are not this runner's to edit.
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
  /**
   * Set ⇒ a trigger case: graded on whether the with-skill turn loaded the
   * bundle (`true`: it should; `false`: it should not), on that arm only. Its
   * token lists are empty.
   */
  shouldTrigger?: boolean;
  /** Paths under the bundle's `evals/files/` placed in the turn's project; absent ⇒ none. */
  files?: string[];
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
 * nor graded, so it is left out), and, only when the case has them, its
 * trigger kind and its `files` list (names, not contents) — so a behaviour
 * case with no files hashes as it did before either existed. Every run record
 * carries it, so `--regrade` can tell a case reworded since the round from the
 * case that ran. Pure.
 */
export const hashCase = (c: Pick<SkillEvalCase, 'prompt' | 'mustContain' | 'mustNotContain' | 'shouldTrigger' | 'files'>): string => {
  const extra = {
    ...(c.shouldTrigger !== undefined ? { shouldTrigger: c.shouldTrigger } : {}),
    ...(c.files?.length ? { files: c.files } : {}),
  };
  const parts: unknown[] = [c.prompt, c.mustContain, c.mustNotContain];
  if (Object.keys(extra).length) parts.push(extra);
  return `sha256:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
};

/** The directory under a bundle that holds the files cases place in a turn's project. */
export const CASE_FILES_DIR = 'evals/files';

/** Why a `files` entry is refused; `undefined` ⇒ it names a path under `evals/files/` that lands outside any `.claude/`. Pure. */
export function caseFileProblem(entry: string): string | undefined {
  const parts = entry.split('/');
  if (entry.includes('\\') || parts.length < 3 || `${parts[0]}/${parts[1]}` !== CASE_FILES_DIR || parts.slice(2).some((p) => p === '' || p === '.' || p === '..')) {
    return `\`files\` entry \`${entry}\` is not a path under \`${CASE_FILES_DIR}/\` (forward slashes, no \`.\` or \`..\` segment)`;
  }
  // Both arms receive every case file, and `.claude/` is where Claude Code finds
  // skills: a case file there would hand the no-skill arm a skill without
  // `verdictOf` ever calling the turn invalid. Any depth, any letter case (a
  // case-insensitive disk resolves `.Claude` to the same directory).
  if (parts.slice(2).some((p) => p.toLowerCase() === '.claude')) {
    return `\`files\` entry \`${entry}\` would land under a \`.claude/\` directory in the turn's project, which only the runner fills: a case file there reaches the no-skill arm too`;
  }
  return undefined;
}

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
    const files = e.files ?? [];
    if (!isStringList(files)) {
      refusals.push({ path: at, message: '`files` must be a list of strings' });
      return;
    }
    const badFile = files.map(caseFileProblem).find((m) => m !== undefined);
    if (badFile) {
      refusals.push({ path: at, message: badFile });
      return;
    }
    let mc: string[] = [];
    let mnc: string[] = [];
    const trigger = e.should_trigger;
    if (trigger !== undefined) {
      if (typeof trigger !== 'boolean') {
        refusals.push({ path: at, message: '`should_trigger` is neither `true` nor `false`' });
        return;
      }
      if (e.assertions !== undefined) {
        refusals.push({ path: at, message: 'is a trigger case (`should_trigger`) and carries `assertions`: a trigger case is graded on whether the skill was loaded, never on its answer' });
        return;
      }
    } else {
      const a = e.assertions;
      if (typeof a !== 'object' || a === null || Array.isArray(a)) {
        refusals.push({ path: at, message: '`assertions` is not an object' });
        return;
      }
      const { must_contain: rawMc = [], must_not_contain: rawMnc = [] } = a as Record<string, unknown>;
      if (!isStringList(rawMc) || !isStringList(rawMnc)) {
        refusals.push({ path: at, message: '`assertions.must_contain` / `must_not_contain` must each be a list of strings' });
        return;
      }
      if (rawMc.length + rawMnc.length === 0) {
        refusals.push({ path: at, message: 'asserts nothing: a case with no `must_contain` and no `must_not_contain` would pass every answer' });
        return;
      }
      mc = rawMc;
      mnc = rawMnc;
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
      ...(typeof trigger === 'boolean' ? { shouldTrigger: trigger } : {}),
      ...(files.length ? { files } : {}),
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
    const mine: SkillEvalCase[] = [];
    for (const file of files) {
      const r = parseEvalFile(bundle, file, readFileSync(join(dir, file), 'utf8'));
      for (const c of r.cases) {
        const missingFile = (c.files ?? []).find((f) => !existsSync(join(root, bundle, f)));
        if (missingFile) refusals.push({ path: `${bundle}/evals/${file}: ${c.key}`, message: `\`files\` names \`${missingFile}\`, which is not in the bundle` });
        else mine.push(c);
      }
      refusals.push(...r.refusals);
    }
    const kinds = new Set(mine.filter((c) => c.shouldTrigger !== undefined).map((c) => c.shouldTrigger));
    if (kinds.size === 1) {
      const only = kinds.has(true) ? 'positive' : 'negative';
      refusals.push({ path: `${bundle}/evals`, message: `every trigger case is ${only}: a trigger set needs at least one \`should_trigger: true\` and one \`false\`, or it cannot show a ${only === 'positive' ? 'false load' : 'missed load'}` });
    }
    cases.push(...mine);
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
 * Narrow a catalog to the named bundles (`--skills a,b`) and, with
 * `triggersOnly` (`--triggers-only`), to their trigger cases. A name that is
 * not a bundle of the catalog, or names one with no case left to run, is
 * refused, never dropped: a misspelt touched skill would otherwise run nothing
 * and read as a clean round. So is a trigger-only selection with no case. With
 * `competing` (trigger turns install the selection), a named bundle with no
 * case is kept while a trigger case is selected: it is installed as a competitor.
 */
export function selectBundles(catalog: SkillEvalCatalog, names: readonly string[] | undefined, triggersOnly = false, competing = false): SkillEvalCase[] {
  const pool = triggersOnly ? catalog.cases.filter((c) => c.shouldTrigger !== undefined) : catalog.cases;
  const kind = triggersOnly ? 'trigger case (`should_trigger`)' : 'eval case';
  if (!names || names.length === 0) {
    if (triggersOnly && pool.length === 0) throw new Error(`--triggers-only: no bundle under ${catalog.root} has a ${kind}`);
    return pool;
  }
  const unknown = names.filter((n) => !catalog.bundles.includes(n));
  if (unknown.length) throw new Error(`--skills names ${unknown.map((n) => `\`${n}\``).join(', ')}, not a bundle under ${catalog.root} (bundles: ${catalog.bundles.join(', ')})`);
  const noCases = names.filter((n) => !pool.some((c) => c.bundle === n));
  const picked = pool.filter((c) => names.includes(c.bundle));
  if (noCases.length && !(competing && picked.some((c) => c.shouldTrigger !== undefined))) throw new Error(`--skills names ${noCases.map((n) => `\`${n}\``).join(', ')}, a bundle with no ${kind} under ${catalog.root}`);
  return picked;
}
