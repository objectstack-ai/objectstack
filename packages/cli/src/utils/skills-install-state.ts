// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `os skills install` wrote into an agent's skills directory, and how the
 * directory compares with it — the record `update` and `status` read to tell
 * the catalog's skills from the user's own.
 *
 * ## The record
 *
 * {@link SKILLS_MANIFEST_FILE}, beside the skills it describes: the package,
 * the version, and every file of every catalog skill with its SHA-256. A skill
 * directory the record does not name is the user's: ⛔ `update` never writes,
 * replaces or removes one, and `install` replaces a same-named one only when
 * told to (`--force`), naming it.
 *
 * ## The comparison ({@link inspectSkillsDir})
 *
 *  - `missing` — a recorded skill whose directory is gone;
 *  - `modified` — a recorded skill with a file changed, removed or added;
 *  - `extra` — a skill directory the record does not name (the user's own,
 *    reported and left alone).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { SKILLS_PACKAGE, isExactVersion, type SkillsCatalog } from './skills-catalog.js';

/** The record's file name, inside the skills directory. */
export const SKILLS_MANIFEST_FILE = '.objectstack-skills.json';

/** Where a Claude Code project keeps its skills, relative to the working directory. */
export const DEFAULT_SKILLS_DIR = join('.claude', 'skills');

/** The record `install` writes and `update` rewrites. */
export interface SkillsManifest {
  package: typeof SKILLS_PACKAGE;
  version: string;
  /** Skill name → path inside the skill → `sha256` hex of its bytes. */
  skills: Record<string, Record<string, string>>;
}

/** One recorded skill that no longer matches the record. */
export interface ModifiedSkill {
  skill: string;
  /** Recorded files whose bytes differ. */
  changed: string[];
  /** Recorded files that are gone. */
  removed: string[];
  /** Files the record does not name. */
  added: string[];
}

export interface SkillsDirInspection {
  missing: string[];
  modified: ModifiedSkill[];
  extra: string[];
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The record for a catalog, as `install` / `update` write it. */
export function manifestForCatalog(catalog: SkillsCatalog): SkillsManifest {
  const skills: Record<string, Record<string, string>> = {};
  for (const [name, files] of catalog.skills) {
    skills[name] = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, sha256(bytes)]));
  }
  return { package: SKILLS_PACKAGE, version: catalog.version, skills };
}

/**
 * The record in `dir`, or `null` when there is none. Throws a plain `Error`
 * naming the file when it is there but is not a record this command wrote:
 * reading half a record would let `update` touch skills it did not install.
 */
export function readSkillsManifest(dir: string): SkillsManifest | null {
  const file = join(dir, SKILLS_MANIFEST_FILE);
  if (!existsSync(file)) return null;
  const refuse = (problem: string) => new Error(
    `${file} ${problem} It is the record \`os skills install\` writes; remove it and run \`os skills install\` again.`,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw refuse(`is not JSON (${(error as Error).message}).`);
  }
  const record = raw as Partial<SkillsManifest> | null;
  if (!record || typeof record !== 'object' || record.package !== SKILLS_PACKAGE
    || typeof record.version !== 'string' || !isExactVersion(record.version)
    || !record.skills || typeof record.skills !== 'object' || Array.isArray(record.skills)) {
    throw refuse(`does not record ${SKILLS_PACKAGE} at an exact version with its skills.`);
  }
  for (const [name, files] of Object.entries(record.skills)) {
    const bad = !files || typeof files !== 'object' || Array.isArray(files)
      || Object.entries(files).some(([path, hash]) => typeof hash !== 'string' || path.split('/').includes('..'))
      || name.includes('/') || name.includes('\\') || name.startsWith('.');
    if (bad) throw refuse(`records the skill '${name}' in a shape it cannot read.`);
  }
  return record as SkillsManifest;
}

/** Every file under `root`, as `/`-separated paths relative to it. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    out.push(relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
  }
  return out.sort();
}

/** The skill directories in `dir`: every directory that is not hidden. */
function skillDirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** How one recorded skill on disk differs from its record, or `undefined` when it matches. */
function compareSkill(dir: string, skill: string, recorded: Record<string, string>): ModifiedSkill | undefined {
  const root = join(dir, skill);
  const onDisk = new Set(listFiles(root));
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [path, hash] of Object.entries(recorded)) {
    if (!onDisk.has(path)) { removed.push(path); continue; }
    if (sha256(readFileSync(join(root, path))) !== hash) changed.push(path);
  }
  const added = [...onDisk].filter((path) => !(path in recorded));
  if (changed.length + removed.length + added.length === 0) return undefined;
  return { skill, changed: changed.sort(), removed: removed.sort(), added };
}

/** How `dir` compares with `manifest` (see the module header). With no record, every skill directory is extra. */
export function inspectSkillsDir(dir: string, manifest: SkillsManifest | null): SkillsDirInspection {
  const recorded = manifest?.skills ?? {};
  const missing: string[] = [];
  const modified: ModifiedSkill[] = [];
  for (const [skill, files] of Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b))) {
    const root = join(dir, skill);
    if (!existsSync(root) || !statSync(root).isDirectory()) { missing.push(skill); continue; }
    const drift = compareSkill(dir, skill, files);
    if (drift) modified.push(drift);
  }
  const extra = skillDirectories(dir).filter((name) => !(name in recorded));
  return { missing, modified, extra };
}

/** What writing a catalog over `dir` would do. */
export interface SkillsWritePlan {
  /** Catalog skills written where no directory of that name was. */
  added: string[];
  /** Recorded skills rewritten at the new version. */
  replaced: string[];
  /** Recorded skills the new version no longer ships: removed. */
  dropped: string[];
  /** Directories the record does not name that share a catalog skill's name. */
  conflicts: string[];
}

/** The plan for writing `catalog` into `dir`, whose current record is `manifest`. */
export function planSkillsWrite(dir: string, catalog: SkillsCatalog, manifest: SkillsManifest | null): SkillsWritePlan {
  const recorded = manifest?.skills ?? {};
  const present = new Set(skillDirectories(dir));
  const added: string[] = [];
  const replaced: string[] = [];
  const conflicts: string[] = [];
  for (const name of catalog.skills.keys()) {
    if (name in recorded) replaced.push(name);
    else if (present.has(name) || existsSync(join(dir, name))) conflicts.push(name);
    else added.push(name);
  }
  const dropped = Object.keys(recorded).filter((name) => !catalog.skills.has(name)).sort();
  return { added, replaced, dropped, conflicts };
}

/**
 * Write `catalog` into `dir` along `plan`: remove each dropped skill, replace
 * each recorded one and each conflict (the caller decided those may go), add
 * the rest, then write the record last. Only directories the plan names are
 * touched.
 */
export function applySkillsWrite(dir: string, catalog: SkillsCatalog, plan: SkillsWritePlan): SkillsManifest {
  mkdirSync(dir, { recursive: true });
  for (const name of plan.dropped) rmSync(join(dir, name), { recursive: true, force: true });
  for (const [name, files] of catalog.skills) {
    const root = join(dir, name);
    rmSync(root, { recursive: true, force: true });
    for (const [path, bytes] of files) {
      const target = join(root, ...path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }
  const manifest = manifestForCatalog(catalog);
  writeFileSync(join(dir, SKILLS_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** One line per modified skill, for the text face: what changed, was removed or was added. */
export function describeModifiedSkill(m: ModifiedSkill): string {
  const parts = [
    m.changed.length ? `changed ${m.changed.join(', ')}` : '',
    m.removed.length ? `removed ${m.removed.join(', ')}` : '',
    m.added.length ? `added ${m.added.join(', ')}` : '',
  ].filter(Boolean);
  return `${m.skill}: ${parts.join('; ')}`;
}
