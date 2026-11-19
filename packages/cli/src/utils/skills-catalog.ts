// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The published skills catalog, read for `os skills install | update | status`:
 * which version to read ({@link resolveSkillsVersion}) and the catalog at that
 * version ({@link fetchSkillsCatalog}).
 *
 * ## Which version
 *
 * In this order, and the answer always says which one it took:
 *
 *  1. `--version V`, an exact version;
 *  2. `--target T`, the target environment's restriction profile — the same
 *     reader, with the same file-or-URL forms and the same refusals, as
 *     `os validate --target` (`loadRestrictionProfile`); its
 *     `versions.skills` is the version that environment runs;
 *  3. this CLI's own version. `@objectstack/skills` and `@objectstack/cli` sit
 *     in one `fixed` group of `.changeset/config.json`, so every release
 *     publishes both at one version and the CLI's version names the catalog
 *     written for it.
 *
 * Only an exact version is read: a range or a dist-tag would install whatever
 * the registry resolves it to today, which may be another major's catalog.
 *
 * ## Where the catalog comes from
 *
 * The `@objectstack/skills` tarball at exactly that version, from the npm
 * registry this environment configures. It is fetched with `npm pack`, run in
 * the current directory, so the registry, scope mapping, credentials and proxy
 * the user's `.npmrc` files and `npm_config_*` variables name are the ones
 * used — no registry URL or auth is re-derived here. ⛔ No third-party
 * installer: the tarball is unpacked in process and only
 * `package/dist/skills/<name>/**` is kept, for each `<name>` that holds a
 * `SKILL.md` (the layout `packages/skills/scripts/sync-catalog.mjs` publishes).
 * A version the registry does not have is refused, naming it; a tarball that
 * is not that package at that version, that carries a link or a path outside
 * its own tree, or that holds no skill, is refused too.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { loadRestrictionProfile } from './restriction-profile.js';

/** The package the catalog ships in. */
export const SKILLS_PACKAGE = '@objectstack/skills';

/** Where a skill directory sits inside the package tarball. */
const TARBALL_SKILLS_PREFIX = 'package/dist/skills/';

/** How long `npm pack` may take before the read is refused. */
const NPM_PACK_TIMEOUT_MS = 120_000;

/** An exact semver version: `MAJOR.MINOR.PATCH`, with an optional pre-release and build. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A skill directory name: one path segment, no leading dot. */
export const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Whether one `/`-separated path segment stays inside its directory on every
 * platform: not empty, not `.` or `..`, and no `\` (a separator on Windows)
 * and no `:` (a drive letter or an alternate data stream there).
 */
export function isSafePathSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\') && !segment.includes(':');
}

/** Whether `value` names one release exactly (no range, no dist-tag). */
export function isExactVersion(value: string): boolean {
  return EXACT_VERSION.test(value);
}

/** Where the version to install came from. */
export type SkillsVersionSource = 'flag' | 'target' | 'cli';

export interface ResolvedSkillsVersion {
  version: string;
  source: SkillsVersionSource;
  /** One phrase for the output: where the version was read. */
  from: string;
}

/**
 * The version to read, in the order the module header gives. Throws a plain
 * `Error` whose message is the refusal: a `--version` that is not exact, a
 * target whose profile cannot be read (the validate reader's own sentence),
 * or a profile naming a skills version that is not exact.
 */
export async function resolveSkillsVersion(args: {
  version?: string;
  target?: string;
  cliVersion: string;
  cwd?: string;
}): Promise<ResolvedSkillsVersion> {
  if (args.version !== undefined) {
    const version = args.version.trim();
    if (!isExactVersion(version)) {
      throw new Error(
        `\`--version ${args.version}\` is not an exact version. Name one release, such as ${args.cliVersion}: `
        + 'a range or a tag would install whatever the registry resolves it to today.',
      );
    }
    return { version, source: 'flag', from: '--version' };
  }
  if (args.target !== undefined) {
    const { profile, source } = await loadRestrictionProfile(args.target, args.cwd);
    const version = profile.versions.skills;
    if (!isExactVersion(version)) {
      throw new Error(
        `--target ${args.target}: the restriction profile at ${source} names skills version '${version}', `
        + 'which is not an exact version, so no catalog can be chosen from it.',
      );
    }
    return { version, source: 'target', from: `the target's restriction profile (${source})` };
  }
  return { version: args.cliVersion, source: 'cli', from: `this CLI's own version (@objectstack/cli ${args.cliVersion})` };
}

/** The catalog at one version: skill name → path inside the skill → bytes. */
export interface SkillsCatalog {
  version: string;
  skills: Map<string, Map<string, Buffer>>;
}

/** One `npm pack` outcome: the tarball's bytes, or why there are none. */
export type SkillsTarballFetch =
  | { ok: true; tarball: Buffer }
  | { ok: false; notFound: boolean; reason: string };

/** `npm pack`'s `--json` answer: an array of packed tarballs, or `{ error }`. */
function npmPackError(stdout: string): { code?: string; summary?: string } | undefined {
  try {
    const parsed = JSON.parse(stdout) as { error?: { code?: unknown; summary?: unknown } };
    const error = parsed?.error;
    if (!error) return undefined;
    return {
      code: typeof error.code === 'string' ? error.code : undefined,
      summary: typeof error.summary === 'string' ? error.summary : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Reads the package tarball from the configured registry. A seam: tests stand
 * in for the registry here, so no test touches the network.
 */
/**
 * The `npm pack` invocation for one spec into `destination`. On Windows `npm`
 * is a `.cmd` shim, which only a shell resolves, and under `shell: true` Node
 * joins the arguments unquoted, so a path argument is quoted there.
 */
export function npmPackInvocation(spec: string, destination: string, cwd: string, platform: NodeJS.Platform = process.platform): {
  command: string;
  args: string[];
  options: { cwd: string; timeout: number; maxBuffer: number; shell: boolean };
} {
  const shell = platform === 'win32';
  return {
    command: 'npm',
    args: ['pack', spec, '--pack-destination', shell ? `"${destination}"` : destination, '--json'],
    options: { cwd, timeout: NPM_PACK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, shell },
  };
}

export const skillsRegistry = {
  fetchTarball(version: string, cwd: string = process.cwd()): Promise<SkillsTarballFetch> {
    const spec = `${SKILLS_PACKAGE}@${version}`;
    const destination = mkdtempSync(join(tmpdir(), 'os-skills-pack-'));
    const invocation = npmPackInvocation(spec, destination, cwd);
    return new Promise<SkillsTarballFetch>((resolvePromise) => {
      execFile(
        invocation.command,
        invocation.args,
        invocation.options,
        (error, stdout, stderr) => {
          try {
            if (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (code === 'ENOENT') {
                resolvePromise({
                  ok: false,
                  notFound: false,
                  reason: '`npm` was not found on your PATH. The catalog is read with npm, which ships with Node.js.',
                });
                return;
              }
              const npm = npmPackError(String(stdout));
              const notFound = npm?.code === 'ETARGET' || npm?.code === 'E404';
              const detail = npm?.summary
                ?? String(stderr).split('\n').find((line) => line.trim().length > 0)
                ?? error.message;
              resolvePromise({ ok: false, notFound, reason: `npm pack ${spec}: ${detail}` });
              return;
            }
            const tarball = readdirSync(destination).find((name) => name.endsWith('.tgz'));
            if (!tarball) {
              resolvePromise({ ok: false, notFound: false, reason: `npm pack ${spec} wrote no tarball.` });
              return;
            }
            resolvePromise({ ok: true, tarball: readFileSync(join(destination, tarball)) });
          } finally {
            rmSync(destination, { recursive: true, force: true });
          }
        },
      );
    });
  },
};

/** One member of a tar archive. */
export interface TarEntry {
  path: string;
  /** The ustar type flag: `0` a file, `5` a directory, `2` a symlink, … */
  type: string;
  data: Buffer;
}

/** A NUL-terminated string field of a tar header. */
function tarString(block: Buffer, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

/** An octal number field of a tar header. */
function tarOctal(block: Buffer, offset: number, length: number): number {
  const text = tarString(block, offset, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`a tar header field reads '${text}', not an octal number`);
  return Number.parseInt(text, 8);
}

/** The `path` record of a pax extended header (`<len> <key>=<value>\n` records). */
function paxPath(data: Buffer): string | undefined {
  let offset = 0;
  let path: string | undefined;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(offset, space).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals !== -1 && record.slice(0, equals) === 'path') path = record.slice(equals + 1);
    offset += length;
  }
  return path;
}

/**
 * The members of a gzipped tar archive, as `npm pack` writes it: ustar headers,
 * with long paths in the ustar prefix, a pax `path` record or a GNU long name.
 * Throws on a header whose checksum does not match or an archive cut short.
 */
export function readTarGz(tgz: Buffer): TarEntry[] {
  const tar = gunzipSync(tgz);
  const entries: TarEntry[] = [];
  let offset = 0;
  let longPath: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const stored = tarOctal(header, 148, 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
    if (sum !== stored) throw new Error(`the tar header at byte ${offset} fails its checksum`);
    const size = tarOctal(header, 124, 12);
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const start = offset + 512;
    if (start + size > tar.length) throw new Error('the archive ends inside a member');
    const data = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === 'x') { longPath = paxPath(data) ?? longPath; continue; }
    if (type === 'L') { longPath = tarString(data, 0, data.length); continue; }
    if (type === 'g') continue;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 257, 6).startsWith('ustar') ? tarString(header, 345, 155) : '';
    entries.push({ path: longPath ?? (prefix ? `${prefix}/${name}` : name), type, data: Buffer.from(data) });
    longPath = undefined;
  }
  return entries;
}

/**
 * The catalog in a package tarball. Throws a plain `Error` naming what is
 * wrong when the tarball is not `@objectstack/skills` at `version`, carries a
 * link or a path that leaves its own tree under `dist/skills/`, or holds no
 * skill. Files directly under `dist/skills/` (its README) are not a skill and
 * are not kept.
 */
export function catalogFromTarball(tgz: Buffer, version: string): SkillsCatalog {
  const refuse = (problem: string) => new Error(`The ${SKILLS_PACKAGE}@${version} tarball ${problem} Nothing was written.`);
  let entries: TarEntry[];
  try {
    entries = readTarGz(tgz);
  } catch (error) {
    throw refuse(`could not be read: ${(error as Error).message}.`);
  }
  const manifest = entries.find((entry) => entry.path === 'package/package.json');
  let declared: { name?: unknown; version?: unknown } = {};
  try {
    declared = manifest ? JSON.parse(manifest.data.toString('utf8')) : {};
  } catch { /* reported below as not this package */ }
  if (declared.name !== SKILLS_PACKAGE || declared.version !== version) {
    throw refuse(
      `declares ${typeof declared.name === 'string' ? declared.name : 'no name'}@`
      + `${typeof declared.version === 'string' ? declared.version : 'no version'}, not ${SKILLS_PACKAGE}@${version}.`,
    );
  }
  const files = new Map<string, Map<string, Buffer>>();
  for (const entry of entries) {
    if (!entry.path.startsWith(TARBALL_SKILLS_PREFIX)) continue;
    const parts = entry.path.slice(TARBALL_SKILLS_PREFIX.length).split('/').filter((part, i, all) => !(part === '' && i === all.length - 1));
    if (!parts.every(isSafePathSegment)) {
      throw refuse(`carries the path '${entry.path}', which leaves its own tree.`);
    }
    if (entry.type === '5') continue;
    if (entry.type !== '0' && entry.type !== '7') {
      throw refuse(`carries '${entry.path}' as tar type '${entry.type}'; the catalog holds regular files only.`);
    }
    if (parts.length < 2) continue;
    const [skill, ...rest] = parts;
    if (!SKILL_NAME.test(skill)) throw refuse(`carries a skill directory named '${skill}', which is not a directory name.`);
    if (!files.has(skill)) files.set(skill, new Map());
    files.get(skill)!.set(rest.join('/'), entry.data);
  }
  const skills = new Map([...files].filter(([, skillFiles]) => skillFiles.has('SKILL.md')).sort(([a], [b]) => a.localeCompare(b)));
  if (skills.size === 0) throw refuse('holds no skill (no dist/skills/<name>/SKILL.md).');
  return { version, skills };
}

/**
 * The catalog at `version`, read from the configured registry. Throws a plain
 * `Error` whose message is the refusal; a version the registry does not have
 * is named.
 */
export async function fetchSkillsCatalog(version: string, cwd: string = process.cwd()): Promise<SkillsCatalog> {
  const fetched = await skillsRegistry.fetchTarball(version, cwd);
  if (!fetched.ok) {
    throw new Error(
      fetched.notFound
        ? `${SKILLS_PACKAGE} ${version} is not published on the npm registry this environment uses (${fetched.reason}). `
          + 'Nothing was written.'
        : `${SKILLS_PACKAGE} ${version} could not be read from the npm registry: ${fetched.reason} Nothing was written.`,
    );
  }
  return catalogFromTarball(fetched.tarball, version);
}
