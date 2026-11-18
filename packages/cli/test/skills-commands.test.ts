// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os skills install | update | status` against a stubbed registry and a
 * stubbed target environment — no network.
 *
 * The commands run for real, in an empty temporary directory with no
 * `package.json`. Two seams are replaced: `skillsRegistry.fetchTarball` is the
 * npm registry (it answers tarballs this file builds, or "not published"), and
 * `fetch` is the target environment's published restriction profile, read by
 * the same reader `os validate --target` uses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Config } from '@oclif/core';

const { default: SkillsInstall } = await import('../src/commands/skills/install.js');
const { default: SkillsUpdate } = await import('../src/commands/skills/update.js');
const { default: SkillsStatus } = await import('../src/commands/skills/status.js');
const { skillsRegistry, catalogFromTarball, resolveSkillsVersion } = await import('../src/utils/skills-catalog.js');
const { SKILLS_MANIFEST_FILE } = await import('../src/utils/skills-install-state.js');

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
// The oclif config is loaded once, here: a clocked test window measures the commands, never this load.
const CONFIG = await Config.load(PKG);
const CLI_VERSION = (JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as { version: string }).version;
const SERVER = 'https://acme.example.test';
const PROFILE_URL = `${SERVER}/api/v1/discovery/restriction-profile`;

// ─── a tarball, as `npm pack` writes one ─────────────────────────────

type TarMember = { path: string; data?: string; type?: string };

function tarHeader(path: string, size: number, type: string): Buffer {
  const header = Buffer.alloc(512);
  let name = path;
  let prefix = '';
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf('/', 155);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}

function tarGz(members: TarMember[]): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    const data = Buffer.from(member.data ?? '', 'utf8');
    blocks.push(tarHeader(member.path, data.length, member.type ?? '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A catalog: skill name → path → content. */
type Catalog = Record<string, Record<string, string>>;

function skillsTarball(version: string, catalog: Catalog, extra: TarMember[] = []): Buffer {
  return tarGz([
    { path: 'package/package.json', data: JSON.stringify({ name: '@objectstack/skills', version }) },
    { path: 'package/README.md', data: 'readme' },
    { path: 'package/dist/skills/README.md', data: 'catalog readme, not a skill' },
    ...Object.entries(catalog).flatMap(([skill, files]) =>
      Object.entries(files).map(([path, data]) => ({ path: `package/dist/skills/${skill}/${path}`, data }))),
    ...extra,
  ]);
}

const V1 = '18.5.0';
const V2 = '18.6.0';
const CATALOG_V1: Catalog = {
  'objectstack-data': { 'SKILL.md': 'data v1', 'rules/naming.md': 'snake_case v1' },
  'objectstack-query': { 'SKILL.md': 'query v1' },
  'objectstack-legacy': { 'SKILL.md': 'legacy v1' },
};
const CATALOG_V2: Catalog = {
  'objectstack-data': { 'SKILL.md': 'data v2', 'rules/naming.md': 'snake_case v2' },
  'objectstack-query': { 'SKILL.md': 'query v2' },
  'objectstack-ask': { 'SKILL.md': 'ask v2' },
};

/** The registry: these versions are published, every other one is not. */
function stubRegistry(published: Record<string, Catalog>): string[] {
  const asked: string[] = [];
  vi.spyOn(skillsRegistry, 'fetchTarball').mockImplementation(async (version: string) => {
    asked.push(version);
    const catalog = published[version];
    if (!catalog) {
      return { ok: false, notFound: true, reason: `npm pack @objectstack/skills@${version}: No matching version found for @objectstack/skills@${version}.` };
    }
    return { ok: true, tarball: skillsTarball(version, catalog) };
  });
  return asked;
}

/** The target environment: its published restriction profile names this skills version. */
const server = { skills: V1 };
function stubServer(): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input);
    asked.push(url);
    if (url !== PROFILE_URL) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    const data = {
      allowCode: false,
      allowSandboxedJs: true,
      allowScheduledAutomation: false,
      allowedFlowNodeTypes: ['start', 'end'],
      versions: { spec: server.skills, skills: server.skills },
    };
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return asked;
}

describe('os skills', () => {
  let work = '';
  const prevCwd = process.cwd();
  let output: string[] = [];

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'os-skills-34773-'));
    process.chdir(work);
    server.skills = V1;
    output = [];
    const record = (...args: unknown[]) => { output.push(args.map(String).join(' ').replace(/\u001b\[[0-9;]*m/g, '')); };
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(work, { recursive: true, force: true });
  });

  async function run(command: { run(argv: string[], opts?: Config): Promise<unknown> }, argv: string[]): Promise<number> {
    try {
      await command.run(argv, CONFIG);
      return 0;
    } catch (err: any) {
      const exit = err?.oclif?.exit ?? err?.exitCode;
      if (exit === undefined) throw err;
      return exit;
    }
  }

  const skillsDir = () => join(work, '.claude', 'skills');
  const read = (...parts: string[]) => readFileSync(join(skillsDir(), ...parts), 'utf8');
  const manifest = () => JSON.parse(read(SKILLS_MANIFEST_FILE));
  const json = () => JSON.parse(output.join('\n'));
  const text = () => output.join('\n');

  it('Done when: in an empty directory, installs the catalog a running server runs, and status reports a mismatch after the server is upgraded', async () => {
    stubRegistry({ [V1]: CATALOG_V1, [V2]: CATALOG_V2 });
    stubServer();
    expect(existsSync(join(work, 'package.json'))).toBe(false);

    expect(await run(SkillsInstall, ['--target', SERVER])).toBe(0);
    expect(read('objectstack-data', 'SKILL.md')).toBe('data v1');
    expect(manifest().version).toBe(V1);
    expect(text()).toContain(`Version   ${V1}, from the target's restriction profile (${PROFILE_URL})`);

    output = [];
    expect(await run(SkillsStatus, ['--target', SERVER, '--check'])).toBe(0);

    server.skills = V2;
    output = [];
    expect(await run(SkillsStatus, ['--target', SERVER, '--check', '--json'])).toBe(1);
    expect(json()).toMatchObject({ installedVersion: V1, expectedVersion: V2, expectedSource: 'target', versionMatches: false, mismatch: true });
    expect(existsSync(join(work, 'package.json'))).toBe(false);
  });

  it('install into an empty directory: the catalog\'s skills land, the README beside them does not, and the record names the version and every file', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', V1, '--json'])).toBe(0);
    expect(read('objectstack-data', 'rules', 'naming.md')).toBe('snake_case v1');
    expect(read('objectstack-query', 'SKILL.md')).toBe('query v1');
    expect(existsSync(join(skillsDir(), 'README.md'))).toBe(false);
    const record = manifest();
    expect(record.package).toBe('@objectstack/skills');
    expect(record.version).toBe(V1);
    expect(Object.keys(record.skills).sort()).toEqual(['objectstack-data', 'objectstack-legacy', 'objectstack-query']);
    expect(Object.keys(record.skills['objectstack-data']).sort()).toEqual(['SKILL.md', 'rules/naming.md']);
    expect(json()).toMatchObject({ ok: true, command: 'install', version: V1, versionSource: 'flag', added: ['objectstack-data', 'objectstack-legacy', 'objectstack-query'] });
  });

  it('--dir installs into another directory', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', V1, '--dir', 'agents/skills'])).toBe(0);
    expect(readFileSync(join(work, 'agents', 'skills', 'objectstack-query', 'SKILL.md'), 'utf8')).toBe('query v1');
    expect(existsSync(skillsDir())).toBe(false);
  });

  it('version order: --version, then the target, then this CLI\'s own version, and the output says which', async () => {
    stubServer();
    expect(await resolveSkillsVersion({ version: V2, cliVersion: CLI_VERSION })).toMatchObject({ version: V2, source: 'flag' });
    expect(await resolveSkillsVersion({ target: SERVER, cliVersion: CLI_VERSION })).toMatchObject({ version: V1, source: 'target' });
    expect(await resolveSkillsVersion({ cliVersion: CLI_VERSION })).toMatchObject({ version: CLI_VERSION, source: 'cli' });

    const asked = stubRegistry({ [CLI_VERSION]: CATALOG_V1 });
    expect(await run(SkillsInstall, [])).toBe(0);
    expect(asked).toEqual([CLI_VERSION]);
    expect(text()).toContain(`from this CLI's own version (@objectstack/cli ${CLI_VERSION})`);
  });

  it('a target profile file is read the way `os validate --target` reads it', async () => {
    const file = join(work, 'profile.json');
    writeFileSync(file, JSON.stringify({ allowCode: true, allowSandboxedJs: true, allowScheduledAutomation: true, allowedFlowNodeTypes: [], versions: { spec: V2, skills: V2 } }));
    expect(await resolveSkillsVersion({ target: 'profile.json', cliVersion: CLI_VERSION, cwd: work })).toMatchObject({ version: V2, source: 'target' });
  });

  it('--version and --target together are refused', async () => {
    const asked = stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', V1, '--target', SERVER])).not.toBe(0);
    expect(asked).toEqual([]);
  });

  it('a version the registry does not have is refused, naming it, and nothing is written', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', '99.0.0'])).toBe(1);
    expect(text()).toContain('@objectstack/skills 99.0.0 is not published on the npm registry this environment uses');
    expect(existsSync(skillsDir())).toBe(false);
  });

  it('a version that is not exact is refused before the registry is asked', async () => {
    const asked = stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', '^18.5.0'])).toBe(1);
    expect(text()).toContain('is not an exact version');
    expect(asked).toEqual([]);
  });

  it('install over a recorded catalog is refused, naming update', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', V1])).toBe(0);
    output = [];
    expect(await run(SkillsInstall, ['--version', V1])).toBe(1);
    expect(text()).toContain('Run `os skills update`');
  });

  it('install refuses a same-named directory it did not install, and --force adopts it', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    mkdirSync(join(skillsDir(), 'objectstack-data'), { recursive: true });
    writeFileSync(join(skillsDir(), 'objectstack-data', 'SKILL.md'), 'an earlier sync');
    expect(await run(SkillsInstall, ['--version', V1])).toBe(1);
    expect(text()).toContain('objectstack-data');
    expect(read('objectstack-data', 'SKILL.md')).toBe('an earlier sync');
    expect(existsSync(join(skillsDir(), SKILLS_MANIFEST_FILE))).toBe(false);

    output = [];
    expect(await run(SkillsInstall, ['--version', V1, '--force', '--json'])).toBe(0);
    expect(read('objectstack-data', 'SKILL.md')).toBe('data v1');
    expect(json().adopted).toEqual(['objectstack-data']);
  });

  it('update replaces the catalog\'s skills, removes the ones the new version dropped, and leaves the user\'s own skill untouched', async () => {
    stubRegistry({ [V1]: CATALOG_V1, [V2]: CATALOG_V2 });
    mkdirSync(join(skillsDir(), 'my-own'), { recursive: true });
    writeFileSync(join(skillsDir(), 'my-own', 'SKILL.md'), 'mine');
    expect(await run(SkillsInstall, ['--version', V1])).toBe(0);

    output = [];
    expect(await run(SkillsUpdate, ['--version', V2, '--json'])).toBe(0);
    expect(read('objectstack-data', 'SKILL.md')).toBe('data v2');
    expect(read('objectstack-ask', 'SKILL.md')).toBe('ask v2');
    expect(existsSync(join(skillsDir(), 'objectstack-legacy'))).toBe(false);
    expect(read('my-own', 'SKILL.md')).toBe('mine');
    expect(manifest().version).toBe(V2);
    expect(Object.keys(manifest().skills)).not.toContain('my-own');
    expect(json()).toMatchObject({
      previousVersion: V1, version: V2, added: ['objectstack-ask'], replaced: ['objectstack-data', 'objectstack-query'],
      removed: ['objectstack-legacy'], untouched: ['my-own'],
    });
  });

  it('update never touches a directory it did not install: a new catalog skill that collides with one is refused', async () => {
    stubRegistry({ [V1]: CATALOG_V1, [V2]: CATALOG_V2 });
    expect(await run(SkillsInstall, ['--version', V1])).toBe(0);
    mkdirSync(join(skillsDir(), 'objectstack-ask'), { recursive: true });
    writeFileSync(join(skillsDir(), 'objectstack-ask', 'SKILL.md'), 'mine, same name');
    output = [];
    expect(await run(SkillsUpdate, ['--version', V2, '--force'])).toBe(1);
    expect(text()).toContain('never touches a skill it did not install');
    expect(read('objectstack-ask', 'SKILL.md')).toBe('mine, same name');
    expect(read('objectstack-data', 'SKILL.md')).toBe('data v1');
  });

  it('update refuses to discard a local change to a catalog skill unless --force', async () => {
    stubRegistry({ [V1]: CATALOG_V1, [V2]: CATALOG_V2 });
    expect(await run(SkillsInstall, ['--version', V1])).toBe(0);
    writeFileSync(join(skillsDir(), 'objectstack-data', 'SKILL.md'), 'edited');
    output = [];
    expect(await run(SkillsUpdate, ['--version', V2])).toBe(1);
    expect(text()).toContain('objectstack-data: changed SKILL.md');
    expect(read('objectstack-data', 'SKILL.md')).toBe('edited');
    expect(await run(SkillsUpdate, ['--version', V2, '--force'])).toBe(0);
    expect(read('objectstack-data', 'SKILL.md')).toBe('data v2');
  });

  it('update with no recorded catalog is refused, naming install', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsUpdate, ['--version', V1])).toBe(1);
    expect(text()).toContain('Run `os skills install` first');
  });

  it('status: a match exits 0 with and without --check', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', V1])).toBe(0);
    output = [];
    expect(await run(SkillsStatus, ['--version', V1, '--check', '--json'])).toBe(0);
    expect(json()).toMatchObject({ installedVersion: V1, expectedVersion: V1, versionMatches: true, missing: [], modified: [], extra: [], mismatch: false });
  });

  it('status: a version mismatch exits 0 by default and 1 with --check', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', V1])).toBe(0);
    output = [];
    expect(await run(SkillsStatus, ['--version', V2])).toBe(0);
    expect(text()).toContain(`The catalog is ${V1}, not ${V2}`);
    expect(await run(SkillsStatus, ['--version', V2, '--check'])).toBe(1);
  });

  it('status: missing, modified and extra skills; only missing and modified are a mismatch', async () => {
    stubRegistry({ [V1]: CATALOG_V1 });
    expect(await run(SkillsInstall, ['--version', V1])).toBe(0);
    mkdirSync(join(skillsDir(), 'my-own'));
    writeFileSync(join(skillsDir(), 'my-own', 'SKILL.md'), 'mine');
    output = [];
    expect(await run(SkillsStatus, ['--version', V1, '--check', '--json'])).toBe(0);
    expect(json()).toMatchObject({ extra: ['my-own'], mismatch: false });

    rmSync(join(skillsDir(), 'objectstack-legacy'), { recursive: true });
    writeFileSync(join(skillsDir(), 'objectstack-data', 'SKILL.md'), 'edited');
    rmSync(join(skillsDir(), 'objectstack-data', 'rules', 'naming.md'));
    writeFileSync(join(skillsDir(), 'objectstack-query', 'notes.md'), 'added');
    output = [];
    expect(await run(SkillsStatus, ['--version', V1, '--check', '--json'])).toBe(1);
    expect(json()).toMatchObject({
      versionMatches: true,
      missing: ['objectstack-legacy'],
      modified: [
        { skill: 'objectstack-data', changed: ['SKILL.md'], removed: ['rules/naming.md'], added: [] },
        { skill: 'objectstack-query', changed: [], removed: [], added: ['notes.md'] },
      ],
      extra: ['my-own'],
      mismatch: true,
    });
  });

  it('status with nothing installed is a mismatch under --check', async () => {
    expect(await run(SkillsStatus, ['--version', V1, '--check', '--json'])).toBe(1);
    expect(json()).toMatchObject({ installedVersion: null, mismatch: true });
  });
});

describe('the catalog in a tarball', () => {
  it('keeps only dist/skills/<name>/** of the skills that carry a SKILL.md, including a long path', () => {
    const long = `references/${'d'.repeat(60)}/${'e'.repeat(40)}.md`;
    const catalog = catalogFromTarball(skillsTarball(V1, { a: { 'SKILL.md': 'a', [long]: 'deep' } }, [
      { path: 'package/dist/skills/not-a-skill/notes.md', data: 'no SKILL.md' },
    ]), V1);
    expect([...catalog.skills.keys()]).toEqual(['a']);
    expect(catalog.skills.get('a')!.get(long)!.toString()).toBe('deep');
  });

  it('refuses a tarball that is another version', () => {
    expect(() => catalogFromTarball(skillsTarball(V2, CATALOG_V2), V1)).toThrow(/declares @objectstack\/skills@18\.6\.0, not @objectstack\/skills@18\.5\.0/);
  });

  it('refuses a link and a path that leaves its tree', () => {
    expect(() => catalogFromTarball(skillsTarball(V1, CATALOG_V1, [{ path: 'package/dist/skills/a/link', type: '2' }]), V1)).toThrow(/regular files only/);
    expect(() => catalogFromTarball(skillsTarball(V1, CATALOG_V1, [{ path: 'package/dist/skills/a/../../x', data: 'x' }]), V1)).toThrow(/leaves its own tree/);
  });

  it('refuses a catalog with no skill', () => {
    expect(() => catalogFromTarball(skillsTarball(V1, {}), V1)).toThrow(/holds no skill/);
  });
});
