// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ask client's skills directory (`--ask-skills DIR`): an opt-in set of
 * Claude Code skills the question and operation turns are given.
 *
 * A question or operation turn runs in an empty temporary directory with the
 * app's MCP server and nothing else (`ClaudeCodeDriver.ask`). With this option
 * the runner also writes each skill into that directory's `.claude/skills/<name>/`
 * and allows the `Skill` tool, so the session discovers the skills the way a
 * customer project's own `.claude/skills/` is discovered. Off by default: a run
 * without the option sends exactly the turns it sent before, and its record
 * carries no key for it, so the records made before it stay comparable.
 *
 * The directory is read ONCE, when the run starts: every turn is given those
 * bytes, and the record states each skill's name and the sha256 of its files
 * (with the `version` its SKILL.md front matter declares, when it declares one),
 * so the version a turn had is the version on the record, whatever happens to
 * the directory during the run.
 *
 * A skill cannot widen the turn: a SKILL.md whose front matter carries a key
 * that grants tools, swaps the model or effort, runs hooks or forks a subagent
 * (`allowed-tools`, `model`, `hooks`, …) is refused when the directory is read,
 * before any process starts. The set of keys a skill may carry is closed.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

/** One skill the ask client was given, as the record states it. */
export interface AskSkill {
  /** The skill's directory name, which is the name the session lists it under. */
  name: string;
  /** sha256 over the skill's files: each relative path, its byte length and its bytes, in path order. */
  sha256: string;
  /** The `version` the skill's SKILL.md front matter declares (top level, or under `metadata`); absent when it declares none. */
  version?: string;
}

/** What the record states about the ask client's skills (`DriverInfo.askSkills`). */
export interface AskSkillsInfo {
  /** The directory the run was given, resolved. */
  dir: string;
  skills: AskSkill[];
}

/** A skills directory read into memory: what the record states, and the bytes each turn is given. */
export interface AskSkillsBundle {
  info: AskSkillsInfo;
  /** Skill name → relative path (forward slashes) → bytes. */
  files: ReadonlyMap<string, ReadonlyMap<string, Buffer>>;
}

/** The tool a session needs to load a skill; added to the ask turn's `--allowedTools` when skills are given. */
export const SKILL_TOOL = 'Skill';

const SKILL_FILE = 'SKILL.md';

/**
 * The top-level SKILL.md front-matter keys a skill given to an ask turn may
 * carry; any other key is refused when the directory is read. A skill's front
 * matter can change what the session that loads it may do: `allowed-tools`
 * grants tools beyond `mcp__app` and `Skill`, `model` and `effort` swap what
 * answers, `hooks` runs commands outside the tool system, `context` / `agent`
 * hand the turn to a subagent with its own tools. The turn's argument list
 * cannot pin all of those (`--tools` limits the built-in tools only), so the
 * runner closes the set where it reads the bytes: what is not named here never
 * reaches a turn. Every key here describes the skill or narrows who may call it.
 */
const ASK_SKILL_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'version',
  'license',
  'compatibility',
  'metadata',
  'when_to_use',
  'argument-hint',
  'user-invocable',
  'disable-model-invocation',
]);

/**
 * Why a SKILL.md's front matter is refused for an ask turn, or `undefined`
 * when it may be given: a key outside {@link ASK_SKILL_KEYS}, or a block this
 * reader cannot be sure it reads as the session would (front matter not on the
 * first line, never closed, or a top-level line that is no plain `key:`), since
 * an uncertain read is one that could hide a key. A file with no front matter
 * declares nothing and is given. Pure over its input.
 */
function frontMatterRefusal(skillMd: string): string | undefined {
  const lines = skillMd.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first === -1) return undefined;
  if (!lines[first]!.trimStart().startsWith('---')) return undefined;
  if (first !== 0 || lines[0] !== '---') return `its front matter does not open on the first line with a bare \`---\` (it opens with \`${lines[first]!.trim().slice(0, 40)}\`${first !== 0 ? ` on line ${first + 1}` : ''})`;
  const close = lines.indexOf('---', 1);
  if (close === -1) return 'its front matter opens with `---` and is never closed';
  let inKey = false;
  for (let i = 1; i < close; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (/^[ \t]/.test(line)) {
      if (!inKey) return `line ${i + 1} of its front matter is indented under no key`;
      continue;
    }
    const key = /^([A-Za-z0-9_-]+)[ \t]*:(?:[ \t]|$)/.exec(line)?.[1];
    if (key === undefined) return `line ${i + 1} of its front matter (\`${line.slice(0, 40)}\`) is no plain \`key:\` line`;
    if (!ASK_SKILL_KEYS.has(key)) return `its front matter declares \`${key}\``;
    inKey = true;
  }
  return undefined;
}

function filesUnder(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) out.set(relative(dir, p).split(sep).join('/'), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

/** sha256 over `files` in path order, each framed by its path and byte length so no two layouts hash alike. */
export function skillHash(files: ReadonlyMap<string, Buffer>): string {
  const h = createHash('sha256');
  for (const rel of [...files.keys()].sort()) {
    const bytes = files.get(rel)!;
    h.update(`${rel}\n${bytes.length}\n`);
    h.update(bytes);
  }
  return h.digest('hex');
}

/**
 * The `version` a SKILL.md front matter declares, at the top level or one
 * level down (`metadata.version`); `undefined` when the file opens with no
 * front matter or the block names no version. Pure over its input.
 */
export function skillVersionOf(skillMd: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  if (!block) return undefined;
  const m = /^(?:[ \t]*)version:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m.exec(block[1]!);
  return m ? m[1]!.trim() : undefined;
}

/**
 * The skill file `dir` holds, read off its listing by exact spelling:
 * `SKILL.md` when it holds that file; else the name of a file spelled
 * otherwise (`skill.md`, `Skill.md`); else `undefined`. Never `existsSync`: a
 * case-insensitive filesystem answers it true for `skill.md`, while the listing
 * names each file as it is spelled on every filesystem.
 */
function skillFileOf(dir: string): string | undefined {
  const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  if (names.includes(SKILL_FILE)) return SKILL_FILE;
  return names.find((n) => n.toLowerCase() === SKILL_FILE.toLowerCase());
}

/**
 * Read a skills directory: either one skill (a directory holding `SKILL.md`,
 * named after the directory) or a directory of skills (each subdirectory that
 * holds `SKILL.md`, the layout of a `.claude/skills/` directory). Refused, with
 * the reason, when the path is no directory or holds no skill: an option that
 * gave the client nothing must not run as if it had. Refused when a skill file
 * is spelled otherwise than `SKILL.md` ({@link skillFileOf}), naming it: a
 * session reads such a file on one filesystem and misses it on another, so the
 * turn would be given a skill on one machine and none on the next. Refused too
 * when any SKILL.md of a skill carries a front-matter key outside the ask
 * turn's closed set ({@link frontMatterRefusal}): a skill must not widen the
 * turn beyond the app's tools and `Skill`.
 */
export function readAskSkills(dirArg: string): AskSkillsBundle {
  const dir = resolve(dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`--ask-skills names \`${dirArg}\`, which is no directory`);
  const misspelt = (shown: string) =>
    new Error(
      `--ask-skills names \`${dirArg}\`, which holds \`${shown}\`: a skill file is spelled \`${SKILL_FILE}\` exactly, ` +
        `or a session reads it on one filesystem and misses it on another; rename it to \`${SKILL_FILE}\``,
    );
  const skillDirs: Array<[string, string]> = [];
  const top = skillFileOf(dir);
  if (top !== undefined) {
    if (top !== SKILL_FILE) throw misspelt(top);
    skillDirs.push([basename(dir), dir]);
  } else {
    const subdirs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of subdirs) {
      const found = skillFileOf(join(dir, name));
      if (found === undefined) continue;
      if (found !== SKILL_FILE) throw misspelt(`${name}/${found}`);
      skillDirs.push([name, join(dir, name)]);
    }
  }
  if (skillDirs.length === 0) {
    throw new Error(`--ask-skills names \`${dirArg}\`, which holds no skill: give a directory holding ${SKILL_FILE}, or a directory of skill directories that each hold one`);
  }
  const files = new Map<string, Map<string, Buffer>>();
  const skills: AskSkill[] = [];
  for (const [name, at] of skillDirs) {
    const f = filesUnder(at);
    // Every SKILL.md the skill carries, nested ones too: a turn is given all of its files.
    for (const [rel, bytes] of f) {
      if (rel !== SKILL_FILE && !rel.endsWith(`/${SKILL_FILE}`)) continue;
      const why = frontMatterRefusal(bytes.toString('utf8'));
      if (why !== undefined) {
        throw new Error(
          `--ask-skills: skill \`${name}\` is refused: ${why} (${join(at, rel)}). An ask turn may use the app's tools and \`${SKILL_TOOL}\` alone, ` +
            `and a skill's front matter can grant tools, another model or effort, hooks or a subagent beyond them; ` +
            `a skill given to an ask turn carries only ${[...ASK_SKILL_KEYS].map((k) => `\`${k}\``).join(', ')}`,
        );
      }
    }
    files.set(name, f);
    const version = skillVersionOf(f.get(SKILL_FILE)!.toString('utf8'));
    skills.push({ name, sha256: skillHash(f), ...(version !== undefined ? { version } : {}) });
  }
  return { info: { dir, skills }, files };
}

/** Write every skill of `bundle` into `cwd/.claude/skills/<name>/`, the project skills directory a session discovers. */
export function placeAskSkills(bundle: AskSkillsBundle, cwd: string): void {
  for (const [name, files] of bundle.files) {
    const root = join(cwd, '.claude', 'skills', name);
    for (const [rel, bytes] of files) {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, bytes);
    }
  }
}

/** `ask-data@1.2.0 (sha256 3f2a…)`, one per skill, as the run's first line and the scorecard state them. */
export function askSkillsText(info: AskSkillsInfo): string {
  return info.skills.map((s) => `${s.name}${s.version !== undefined ? `@${s.version}` : ''} (sha256 ${s.sha256.slice(0, 12)})`).join(', ');
}
