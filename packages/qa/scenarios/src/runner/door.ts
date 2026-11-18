// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Door mode (`--modes door`): the card is built by a client that holds the
 * open MCP draft door's tools and nothing of a project, and a person-equivalent
 * step publishes what it staged (`doorMode` in `orchestrate.ts`).
 *
 * This module holds what the mode's ARMS are made of, so a round can measure
 * what a piece of instruction text is worth by running with and without it:
 *
 *  - the published skills the client is given (`--door-skills DIR`, read by
 *    `readAskSkills`, the same reader and the same closed front-matter set as
 *    `--ask-skills`), less the ones `--door-skill-omit` names: the arm with and
 *    without one skill is the same directory with and without that omission;
 *  - a rules file the maintainer supplies at run time (`--door-rules FILE`, or
 *    the {@link DOOR_RULES_ENV} variable), less the rules `--door-rules-omit`
 *    names: the arm with and without a named set of rule texts.
 *
 * ## The rules file
 *
 * One JSON object, read once when the run starts ({@link readDoorRules}):
 *
 * ```json
 * {
 *   "rules": [
 *     { "id": "rule-a", "text": "The full text of the first rule." },
 *     { "id": "rule-b", "text": "The full text of the second rule." }
 *   ],
 *   "sets": { "set-x": ["rule-a"] }
 * }
 * ```
 *
 * `rules` is a non-empty list of `{ id, text }`, ids unique; `sets` is
 * optional, each a name for a non-empty list of rule ids the file holds. No
 * other key is read, and one present is refused: a key this reader does not
 * know is a key the run would silently ignore. The selector
 * (`--door-rules-omit A,B`) names rule ids or set names, which never collide
 * (a set named like a rule is refused). Whatever is wrong is refused before
 * any card runs, naming what is wrong: a missing file, a file that is no JSON,
 * an unknown key, an empty text, a duplicate id, a set naming no rule of the
 * file, a selector naming nothing in it, a selector that omits every rule
 * (that arm is the run without the file), and a file inside this runner's own
 * checkout (the file is the maintainer's, and lives outside the repository).
 *
 * The active rules reach the client as its working directory's `CLAUDE.md`
 * ({@link renderDoorRules}), the instruction file a Claude Code session reads
 * at start, so the turn's prompt is the same text in every arm. The record
 * states the arm ({@link DoorArm}): the skills given and omitted, the rules
 * file's name and sha256, and the ids active and omitted. Never the texts.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

import { askSkillsText, type AskSkillsBundle, type AskSkillsInfo } from './ask-skills.js';

/** The variable naming the rules file when `--door-rules` is not given. */
export const DOOR_RULES_ENV = 'OS_SCENARIOS_DOOR_RULES';

/**
 * The draft door's write tools (`packages/runtime/src/domains/mcp-authoring.ts`):
 * the calls a replay of a door authoring turn re-sends, in recorded order.
 * The door's reads are never re-sent, and it has no publish tool.
 */
export const DOOR_WRITE_TOOLS = ['save_metadata_draft', 'delete_metadata_draft'] as const;

/**
 * The metadata collections door mode reads back from the environment after
 * the publish, to grade: every collection the scorer and the Run half read
 * (`score/scenario-graph.ts`, `score/scenario-tags.ts`, `rollupSourceCharges`,
 * the guardrail grade), and the item kinds a card's structure names.
 */
export const DOOR_COLLECTIONS = ['objects', 'apps', 'views', 'pages', 'dashboards', 'reports', 'datasets', 'flows', 'actions', 'permissions'] as const;

/**
 * The OAuth scope the door's token is asked for: `metadata:write` is the
 * scope that serves the authoring tools (`grantsAuthoringTools` in
 * `@objectstack/mcp`), and `openid` names the signed-in person it acts for.
 */
export const DOOR_TOKEN_SCOPE = 'openid metadata:write';

/** One rule the file holds. */
export interface DoorRule {
  id: string;
  text: string;
}

/** What the record states about the rules arm: never a rule's text. */
export interface DoorRulesInfo {
  /** The file's name (not its path: the path is the maintainer's machine). */
  file: string;
  /** sha256 of the file's bytes as read. */
  sha256: string;
  /** The rule ids the client was given, in file order. */
  active: string[];
  /** The rule ids the selector left out, in file order; empty when none was. */
  omitted: string[];
  /** The selector as given (`--door-rules-omit`), when one was. */
  omit?: string;
}

/** A rules file read into memory: what the record states, and the text the client is given. */
export interface DoorRulesBundle {
  info: DoorRulesInfo;
  rules: DoorRule[];
}

/**
 * The arm a door mode ran in, as the record states it (`DriverInfo.door`).
 * Absent on the driver info ⇒ no skills and no rules.
 */
export interface DoorArm {
  /** The skills the client was given, after the omissions; absent ⇒ none. */
  skills?: AskSkillsInfo;
  /** The skill names `--door-skill-omit` left out of the directory. */
  skillsOmitted?: string[];
  /** The rules the client was given; absent ⇒ none. */
  rules?: DoorRulesInfo;
}

const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const DoorRulesFileSchema = z.strictObject({
  rules: z
    .array(
      z.strictObject({
        id: z.string().regex(RULE_ID, 'a rule id is letters, digits, `.`, `_` or `-`, starting with a letter or digit'),
        text: z.string().refine((t) => t.trim() !== '', 'a rule text is not empty'),
      }),
    )
    .min(1, 'the file holds no rule'),
  sets: z.record(z.string().regex(RULE_ID, 'a set name is letters, digits, `.`, `_` or `-`'), z.array(z.string()).min(1, 'a set names at least one rule')).optional(),
});

/** Why a rules file is refused; the message names the file and what is wrong with it. */
export class DoorRulesRefusedError extends Error {
  constructor(file: string, why: string) {
    super(`the door rules file \`${file}\` is refused: ${why}`);
    this.name = 'DoorRulesRefusedError';
  }
}

/** Is `file` inside `root` (both resolved through symlinks where they exist)? */
function inside(root: string, file: string): boolean {
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p));
  const rel = relative(real(root), real(file));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

export interface ReadDoorRulesOptions {
  /** The selector (`--door-rules-omit`): rule ids and set names, comma-separated. */
  omit?: string;
  /** This runner's own checkout, when it runs from one: a rules file inside it is refused. */
  repoRoot?: string;
}

/**
 * Read and judge a rules file (the module header states the format and every
 * refusal). Pure over the file's bytes and `opts`; throws
 * {@link DoorRulesRefusedError}.
 */
export function readDoorRules(path: string, opts: ReadDoorRulesOptions = {}): DoorRulesBundle {
  const shown = path;
  const refuse = (why: string) => new DoorRulesRefusedError(shown, why);
  const file = resolve(path);
  if (!existsSync(file) || !statSync(file).isFile()) throw refuse('no such file');
  if (opts.repoRoot !== undefined && inside(opts.repoRoot, file)) {
    throw refuse('it lies inside this runner’s own checkout; the rules file is the maintainer’s and is read from outside the repository');
  }
  const bytes = readFileSync(file);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    throw refuse(`it is no JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const parsed = DoorRulesFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw refuse(parsed.error.issues.map((i) => `${i.path.length ? `\`${i.path.join('.')}\`: ` : ''}${i.message}`).join('; '));
  }
  const { rules, sets = {} } = parsed.data;
  const ids = new Set<string>();
  for (const r of rules) {
    if (ids.has(r.id)) throw refuse(`the rule id \`${r.id}\` appears twice`);
    ids.add(r.id);
  }
  for (const [name, members] of Object.entries(sets)) {
    if (ids.has(name)) throw refuse(`the set \`${name}\` is named like a rule, so a selector naming it would be ambiguous`);
    const unknown = members.filter((m) => !ids.has(m));
    if (unknown.length) throw refuse(`the set \`${name}\` names ${unknown.map((u) => `\`${u}\``).join(', ')}, which the file holds no rule of`);
  }
  const omitted = new Set<string>();
  if (opts.omit !== undefined) {
    const picks = opts.omit.split(',').map((s) => s.trim());
    if (picks.some((p) => p === '')) throw refuse(`the selector \`${opts.omit}\` has an empty entry`);
    for (const p of picks) {
      if (ids.has(p)) omitted.add(p);
      else if (sets[p]) for (const m of sets[p]) omitted.add(m);
      else throw refuse(`the selector names \`${p}\`, which is neither a rule id nor a set of the file`);
    }
    if (omitted.size === ids.size) throw refuse('the selector omits every rule; the arm without any rule is the run without a rules file');
  }
  return {
    rules: rules.filter((r) => !omitted.has(r.id)),
    info: {
      file: basename(file),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      active: rules.filter((r) => !omitted.has(r.id)).map((r) => r.id),
      omitted: rules.filter((r) => omitted.has(r.id)).map((r) => r.id),
      ...(opts.omit !== undefined ? { omit: opts.omit } : {}),
    },
  };
}

/**
 * The client's instruction file (`CLAUDE.md` in its working directory): each
 * active rule under its id, in file order, texts verbatim.
 */
export function renderDoorRules(rules: readonly DoorRule[]): string {
  return [
    '# Authoring rules',
    '',
    'Follow these rules for every metadata item you save as a draft.',
    ...rules.flatMap((r) => ['', `## ${r.id}`, '', r.text.trim()]),
    '',
  ].join('\n');
}

/**
 * The skills bundle less the skills `omit` names, and the names it left out.
 * A name the bundle does not hold is refused: an omission that removes
 * nothing would run the "without" arm as the "with" arm.
 */
export function omitSkills(bundle: AskSkillsBundle, omit: readonly string[]): { bundle: AskSkillsBundle; omitted: string[] } {
  const held = new Set(bundle.info.skills.map((s) => s.name));
  const unknown = omit.filter((n) => !held.has(n));
  if (unknown.length) {
    throw new Error(`--door-skill-omit names ${unknown.map((u) => `\`${u}\``).join(', ')}, which \`${bundle.info.dir}\` holds no skill of (it holds ${[...held].map((h) => `\`${h}\``).join(', ')})`);
  }
  const drop = new Set(omit);
  const files = new Map([...bundle.files].filter(([name]) => !drop.has(name)));
  const skills = bundle.info.skills.filter((s) => !drop.has(s.name));
  return { bundle: { info: { dir: bundle.info.dir, skills }, files }, omitted: bundle.info.skills.filter((s) => drop.has(s.name)).map((s) => s.name) };
}

/** `skills: objectstack-data (sha256 …), less skill-b · rules: rules.json (sha256 …) 2 active, 1 omitted (set-x)`. */
export function doorArmText(arm: DoorArm | undefined): string {
  const skills = arm?.skills
    ? `skills: ${arm.skills.skills.length ? askSkillsText(arm.skills) : 'none'}${arm.skillsOmitted?.length ? `, less ${arm.skillsOmitted.join(', ')}` : ''}`
    : 'skills: none';
  const r = arm?.rules;
  const rules = r
    ? `rules: ${r.file} (sha256 ${r.sha256.slice(0, 12)}) ${r.active.length} active${r.omitted.length ? `, ${r.omitted.length} omitted (${r.omit ?? r.omitted.join(',')})` : ''}`
    : 'rules: none';
  return `${skills} · ${rules}`;
}

/** Why `driver` cannot run a door turn: door mode is driven by the live `claude` driver, or replayed. */
export function doorModeRefusal(driver: string): string {
  return `door mode is driven by the live \`claude\` driver (or a replay of one): it hands the client the app's MCP draft door and no project, and ${driver} is not given a door`;
}
