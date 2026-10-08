// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta --from N --write` rewrites the manifest's declared protocol
 * range when the load would still refuse it (#22219) — pinned at the load's
 * own door.
 *
 * ## The defect
 *
 * The load refuses a manifest whose `engines.protocol` excludes the runtime's
 * major, and the refusal names `objectstack migrate meta --from N` as the
 * command that resolves it (`ProtocolIncompatibleDiagnostic.migrateCommand`,
 * ADR-0087 P2). `--write` wrote the chain's edits and left `'^N'` as it was, so
 * an author who followed the prescription, wrote, and reloaded got the same
 * refusal back. Measured on `main` `7b926f76` through `os serve` with the
 * `--from 16` shape, before and after `--write`: "package 'com.example.h1'
 * targets protocol ^16 (engines.protocol) but this runtime is protocol 17.0.0.
 * This is a major-version break. Run: objectstack migrate meta --from 16".
 *
 * ## What is pinned
 *
 *  1. At the door: the control (the manifest before migrating is refused, and
 *     the refusal names this command), then `--write`, then a reload that is
 *     NOT refused. The door is `AppPlugin.init`, the code-defined-stack load
 *     seam `os serve` boots through, fed by the CLI's own config loader. With
 *     a key the chain converts, the load refuses at the schema first (the
 *     key's tombstone names the command); the range alone is refused at the
 *     handshake (`OS_PROTOCOL_INCOMPATIBLE`, whose `migrateCommand` names it).
 *  2. A manifest with nothing to convert still owes the range: `--write`
 *     writes the range alone, and says so.
 *  3. A range the load already admits is left alone, byte for byte.
 *  4. The legacy homes the handshake still reads (`engines.platform`,
 *     `engine.objectstack`) are rewritten where the handshake read them, in
 *     the spelling each one's schema accepts.
 *  5. Which major: `--to`, capped at the protocol this runtime implements.
 *  6. A range the chain did not migrate past (`--from` above the major the
 *     range declares) is left, and the report names the `--from` that moves it.
 *  7. The range rides the chain's plan, write and re-check: a forced re-check
 *     mismatch restores it with the other edits, and a range edit that does not
 *     land is caught by the re-check and restored; the planner refuses a range
 *     literal it cannot prove, by the same refusal kinds.
 *
 * The 17 → 18 shape is a second row of {@link SHAPES}, once the runtime
 * implements protocol 18.
 *
 * In-process over the real command (`MigrateMeta.run`) and the real load seam
 * (`AppPlugin.init` with a context double), against temp projects that link
 * the real `@objectstack/spec`: no process is spawned and no kernel is booted,
 * so this file sits in the `unit` tier.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { AppPlugin } from '@objectstack/runtime';
import MigrateMeta, { planProtocolRange } from '../src/commands/migrate/meta.js';
import { loadConfig } from '../src/utils/config.js';
import {
  planAuthoredSourceWrite,
  verifyAuthoredSourceWrite,
  type AuthoredSourceWritePlan,
} from '../src/utils/authored-source-codemod.js';

/** A seam between planning and writing: the command runs the real planner, and a test may act on the plan. */
const hooks = vi.hoisted(() => ({ afterPlan: undefined as undefined | ((plan: AuthoredSourceWritePlan) => void) }));
vi.mock('../src/utils/authored-source-codemod.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/utils/authored-source-codemod.js')>();
  return {
    ...actual,
    planAuthoredSourceWrite: async (input: Parameters<typeof actual.planAuthoredSourceWrite>[0]) => {
      const plan = await actual.planAuthoredSourceWrite(input);
      hooks.afterPlan?.(plan);
      return plan;
    },
  };
});

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const RUN_TIMEOUT = 120_000;

/**
 * The shapes the load refuses on this runtime, one row per major migrated
 * FROM: the major, and one authored member the chain converts out of it — a
 * key the current schema tombstones, so the authored-source load hands it to
 * the chain as written. The 17 → 18 row joins once this runtime implements
 * protocol 18, with a member the protocol-18 step converts.
 */
const SHAPES = [
  {
    from: 16,
    member: "views: [{ object: 'rg_item', list: { type: 'grid', columns: ['title'], striped: true } }]",
    converted: ['view-list-passthrough-keys-removed'],
    before: ', striped: true',
    after: '',
  },
];

/** The range `--write` writes on this build: the scaffold's spelling, at this runtime's major. */
const TARGET = `^${PROTOCOL_MAJOR}`;

/** `packages/cli` depends on `@objectstack/spec`; resolved as a package, not a source path. */
const requireFromCli = createRequire(import.meta.url);
const SPEC_PACKAGE_ROOT = dirname(requireFromCli.resolve('@objectstack/spec/package.json'));

let root: string;
let specLink: string;
let caseSeq = 0;

function writeProject(files: Record<string, string>): string {
  const dir = join(root, `case-${++caseSeq}`);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules') continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** `text` with `from` replaced by `to` — `from` must occur exactly once, so an edit is never a no-op. */
function edit(text: string, from: string, to: string): string {
  const parts = text.split(from);
  expect(parts.length, `expected exactly one occurrence of ${JSON.stringify(from)}`).toBe(2);
  return parts.join(to);
}

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

/** Run the real command in-process, capturing both streams and any exit. */
async function runMeta(dir: string, from: number, flags: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const priorExitCode = process.exitCode;
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    out.push(String(chunk));
    const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    done?.();
    return true;
  }) as never);
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  let exitCode: number | undefined;
  try {
    await MigrateMeta.run([join(dir, 'objectstack.config.ts'), '--from', String(from), ...flags], { root: CLI_ROOT });
  } catch (e: any) {
    if (typeof e?.oclif?.exit !== 'number') throw e;
    exitCode = e.oclif.exit;
  } finally {
    write.mockRestore();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    if (exitCode === undefined && typeof process.exitCode === 'number' && process.exitCode !== 0) {
      exitCode = process.exitCode;
    }
    process.exitCode = priorExitCode;
  }
  return {
    stdout: stripVTControlCharacters(out.join('\n')),
    stderr: stripVTControlCharacters(err.join('\n')),
    exitCode,
  };
}

/** What the load did: `refused` with the thrown value, or `loaded` with the manifest it registered. */
type LoadVerdict = { refused: any } | { loaded: unknown };

/**
 * Load a project through the door `os serve` boots through: the CLI's config
 * loader (whose `define*` calls run the schema), then `AppPlugin.init`, whose
 * protocol handshake runs before the manifest is registered. Either one may
 * refuse. The context double carries the one service registration needs.
 */
async function load(dir: string): Promise<LoadVerdict> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    let config: Awaited<ReturnType<typeof loadConfig>>['config'];
    try {
      ({ config } = await loadConfig(join(dir, 'objectstack.config.ts')));
    } catch (refused) {
      return { refused };
    }
    const registered: unknown[] = [];
    const ctx = {
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: (m: unknown) => registered.push(m) };
        throw new Error(`service '${name}' not found`);
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn(),
      trigger: vi.fn(),
    };
    try {
      await new AppPlugin(config).init(ctx as never);
    } catch (refused) {
      return { refused };
    }
    expect(registered, 'a load that is not refused registers the manifest').toHaveLength(1);
    return { loaded: registered[0] };
  } finally {
    warn.mockRestore();
    log.mockRestore();
  }
}

/** The refusal the load answers a manifest declaring `range` at `source`, from major `from`. */
function refusal(from: number, range: string, source = 'engines.protocol') {
  return {
    code: 'OS_PROTOCOL_INCOMPATIBLE',
    status: 422,
    diagnostic: expect.objectContaining({
      rangeSource: source,
      requiredRange: range,
      migrateCommand: `objectstack migrate meta --from ${from}`,
    }),
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-migrate-meta-range-'));
  mkdirSync(join(root, 'node_modules', '@objectstack'), { recursive: true });
  specLink = join(root, 'node_modules', '@objectstack', 'spec');
  symlinkSync(SPEC_PACKAGE_ROOT, specLink, 'dir');
});

afterAll(() => {
  // Unlinked BEFORE the recursive remove: this symlink points at the real
  // `packages/spec`, and a cleanup must never follow it.
  try { unlinkSync(specLink); } catch { /* already gone */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** A config declaring `engines` as given, with one more stack member (`member`), or none. */
function config(engines: string, member?: string): string {
  return `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: {
    id: 'com.example.range',
    name: 'Range fixture',
    version: '1.0.0',
    type: 'app',
    ${engines},
  },
  objects: [{ name: 'rg_item', label: 'Item', fields: { title: { type: 'text', label: 'Title' } } }],
${member ? `  ${member},\n` : ''}});
`;
}

/** The first row's convertible member, for the cases that need one and are not about the major. */
const MEMBER = SHAPES[0]!;

/** The line the `engines` member sits on in {@link config}'s output. */
const ENGINES_LINE = 9;

// ── 1: the door, before and after ──────────────────────────────────────────

describe.each(SHAPES)('--from $from: the load refuses the manifest, and --write leaves one it admits', (shape) => {
  const { from } = shape;
  const RANGE = `^${from}`;
  const SOURCE = config(`engines: { protocol: '${RANGE}' }`, shape.member);
  let dir: string;
  let before: LoadVerdict;
  let dry: Run;
  let dryBytes: Record<string, string>;
  let written: Run;
  let after: LoadVerdict;

  beforeAll(async () => {
    dir = writeProject({ 'objectstack.config.ts': SOURCE });
    before = await load(dir);
    dry = await runMeta(dir, from, []);
    dryBytes = snapshot(dir);
    written = await runMeta(dir, from, ['--write', '--json']);
    after = await load(dir);
  }, RUN_TIMEOUT * 4);

  it('control: before migrating, the load refuses it, and the refusal names this command', () => {
    // The tombstoned key is refused at the schema, before the handshake runs.
    expect(before).toEqual({
      refused: expect.objectContaining({
        code: 'STACK_SCHEMA_INVALID',
        message: expect.stringContaining(`migrate meta --from ${from}`),
      }),
    });
  });

  it('a dry run names the range edit --write would make, and writes nothing', () => {
    expect(dry.exitCode, dry.stderr).toBeUndefined();
    expect(dry.stdout).toContain(
      `manifest.engines.protocol '${RANGE}' does not admit protocol ${PROTOCOL_MAJOR}, so the load refuses this `
      + `stack even after migrating; --write rewrites it to '${TARGET}'.`,
    );
    expect(dryBytes).toEqual({ 'objectstack.config.ts': SOURCE });
  });

  it('--write rewrites the range in place beside the chain\'s edit, and only those bytes change', () => {
    expect(written.exitCode, written.stderr).toBeUndefined();
    const payload = JSON.parse(written.stdout);
    expect(payload.write.status).toBe('written');
    expect(payload.write.range).toEqual({
      status: 'written',
      path: 'manifest.engines.protocol',
      from: RANGE,
      to: TARGET,
      file: 'objectstack.config.ts',
      line: ENGINES_LINE,
    });
    // The range is not one of the chain's entries: `written` lists exactly `applied`.
    expect(payload.write.written.map((w: any) => w.conversionId)).toEqual(shape.converted);
    expect(payload.applied.map((a: any) => a.conversionId)).toEqual(shape.converted);
    expect(payload.write.verification).toEqual({ ok: true, stillApplied: [], vanished: [] });
    expect(snapshot(dir)).toEqual({
      'objectstack.config.ts': edit(
        edit(SOURCE, `protocol: '${RANGE}'`, `protocol: '${TARGET}'`),
        shape.before,
        shape.after,
      ),
    });
  });

  it('the reload is not refused', () => {
    expect(after).toEqual({ loaded: expect.anything() });
  });
});

// ── 2: nothing to convert, still the range ─────────────────────────────────

describe.each(SHAPES)('--from $from: a manifest with nothing to convert still owes the range', ({ from }) => {
  it('control: the load refuses it at the handshake, naming this command; --write writes the range alone, says so, and the reload is not refused', async () => {
    const source = config(`engines: { protocol: '^${from}' }`);
    const dir = writeProject({ 'objectstack.config.ts': source });
    expect(await load(dir)).toEqual({ refused: expect.objectContaining(refusal(from, `^${from}`)) });

    const run = await runMeta(dir, from, ['--write']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    expect(run.stdout).toContain(
      '--write: the chain made no mechanical change here; the declared protocol range is the one edit it owes.',
    );
    expect(run.stdout).toContain(`Rewrote the declared protocol range, so the load admits protocol ${PROTOCOL_MAJOR}:`);
    expect(run.stdout).toContain(`objectstack.config.ts:${ENGINES_LINE} manifest.engines.protocol: '^${from}' → '${TARGET}'`);
    expect(run.stdout).toContain(
      'Re-ran the chain over the written sources: no mechanical change remains. '
      + `The declared protocol range now admits protocol ${PROTOCOL_MAJOR}.`,
    );
    expect(run.stdout).not.toContain('no file was written');
    expect(snapshot(dir)).toEqual({ 'objectstack.config.ts': edit(source, `protocol: '^${from}'`, `protocol: '${TARGET}'`) });
    expect(await load(dir)).toEqual({ loaded: expect.anything() });
  }, RUN_TIMEOUT * 2);
});

// ── 3: a range the load admits ─────────────────────────────────────────────

describe('a range the load already admits is left alone', () => {
  it('--write writes the chain\'s edit only, reports no range, and the reload is not refused', async () => {
    const source = config("engines: { protocol: '>=16' }", MEMBER.member);
    const dir = writeProject({ 'objectstack.config.ts': source });
    const dry = await runMeta(dir, MEMBER.from, []);
    expect(dry.stdout).not.toContain('--write rewrites it');
    const run = await runMeta(dir, MEMBER.from, ['--write', '--json']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    const payload = JSON.parse(run.stdout);
    expect(payload.write.written.map((w: any) => w.conversionId)).toEqual(MEMBER.converted);
    expect(payload.write).not.toHaveProperty('range');
    expect(snapshot(dir)).toEqual({ 'objectstack.config.ts': edit(source, MEMBER.before, MEMBER.after) });
    expect(await load(dir)).toEqual({ loaded: expect.anything() });
  }, RUN_TIMEOUT * 2);
});

// ── 4: the legacy homes, where the handshake read them ─────────────────────

describe('a range in a legacy home is rewritten where the handshake read it', () => {
  it.each([
    ['engines.platform', "engines: { platform: '^16' }", '^16', `engines: { platform: '${TARGET}' }`],
    // Its schema refuses a range short of a full version, so the full version is written.
    ['engine.objectstack', "engine: { objectstack: '^16.0.0' }", '^16.0.0', `engine: { objectstack: '^${PROTOCOL_MAJOR}.0.0' }`],
  ])('%s', async (source, engines, range, rewritten) => {
    const text = config(engines);
    const dir = writeProject({ 'objectstack.config.ts': text });
    expect(await load(dir)).toEqual({ refused: expect.objectContaining(refusal(16, range, source)) });

    const run = await runMeta(dir, 16, ['--write', '--json']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    expect(JSON.parse(run.stdout).write.range).toMatchObject({ status: 'written', path: `manifest.${source}`, from: range });
    expect(snapshot(dir)).toEqual({ 'objectstack.config.ts': edit(text, engines, rewritten) });
    expect(await load(dir)).toEqual({ loaded: expect.anything() });
  }, RUN_TIMEOUT * 2);
});

// ── 5 and 6: which major, and when the range is left ───────────────────────

describe('which range is written', () => {
  it('the major is --to, capped at the protocol this runtime implements', async () => {
    const dir = writeProject({ 'objectstack.config.ts': config("engines: { protocol: '^16' }", MEMBER.member) });
    const payload = JSON.parse((await runMeta(dir, MEMBER.from, ['--write', '--json'])).stdout);
    // `--to` defaults to the chain's terminus, which may run ahead of this runtime.
    expect(payload.write.range.to).toBe(`^${Math.min(payload.to, PROTOCOL_MAJOR)}`);
    expect(payload.write.range.to).toBe(TARGET);
  }, RUN_TIMEOUT);

  it('a range the chain did not migrate past is left, and the report names the --from that moves it', async () => {
    const source = config("engines: { protocol: '^16' }");
    const dir = writeProject({ 'objectstack.config.ts': source });
    const run = await runMeta(dir, PROTOCOL_MAJOR, ['--write']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    expect(run.stdout).toContain(
      `manifest.engines.protocol '^16' declares protocol 16, below --from ${PROTOCOL_MAJOR}: this run did not `
      + `replay protocol 16 → ${PROTOCOL_MAJOR}, so the range is left as written and the load still refuses it. `
      + 'Run with --from 16.',
    );
    expect(snapshot(dir)).toEqual({ 'objectstack.config.ts': source });
  }, RUN_TIMEOUT);

  it('never lowers a range, nor touches one the handshake admits, cannot parse, or that is absent', () => {
    const at = (engines: Record<string, unknown>) => planProtocolRange({ manifest: { engines } }, 16, PROTOCOL_MAJOR);
    expect(at({ protocol: `^${PROTOCOL_MAJOR + 1}` })).toBeUndefined();
    expect(at({ protocol: TARGET })).toBeUndefined();
    expect(at({ protocol: 'banana' })).toBeUndefined();
    expect(at({ protocol: 17 as unknown as string })).toBeUndefined();
    expect(planProtocolRange({ manifest: { id: 'x' } }, 16, PROTOCOL_MAJOR)).toBeUndefined();
    expect(at({ protocol: '^16' })).toEqual({
      kind: 'rewrite',
      rewrite: { path: 'manifest.engines.protocol', from: '^16', to: TARGET, major: PROTOCOL_MAJOR },
    });
  });
});

// ── 7: one plan, one write, one re-check ───────────────────────────────────

describe('the range rides the plan, the write and the re-check', () => {
  const SOURCE = config("engines: { protocol: '^16' }", MEMBER.member);

  it('a re-check that disagrees restores the range with every other edit', async () => {
    const dir = writeProject({ 'objectstack.config.ts': SOURCE });
    let planned: AuthoredSourceWritePlan['range'];
    hooks.afterPlan = (plan) => {
      planned = plan.range;
      // A report claiming one more site left by hand than the chain will find.
      plan.manual.push({
        application: { toMajor: 18, conversionId: 'probe-phantom', surface: 'probe', from: 'a', to: 'b', path: 'nowhere.at.all' },
        refusal: { kind: 'computed', reason: 'r' },
      });
    };
    let run: Run;
    try {
      run = await runMeta(dir, MEMBER.from, ['--write']);
    } finally {
      hooks.afterPlan = undefined;
    }
    // The plan wrote the range beside the chain's edit, and the restore took both back.
    expect(planned).toMatchObject({ status: 'written', rewrite: { from: '^16', to: TARGET } });
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('every one was restored to its previous bytes');
    expect(snapshot(dir)).toEqual({ 'objectstack.config.ts': SOURCE });
  }, RUN_TIMEOUT);

  it('a range edit that does not land is caught by the re-check, and everything is restored', async () => {
    const dir = writeProject({ 'objectstack.config.ts': SOURCE });
    hooks.afterPlan = (plan) => {
      // The file the plan writes, with the range put back as it was — and only the range.
      const rewrite = plan.rewrites[0]!;
      rewrite.after = edit(rewrite.after, `protocol: '${TARGET}'`, "protocol: '^16'");
    };
    let run: Run;
    try {
      run = await runMeta(dir, MEMBER.from, ['--write']);
    } finally {
      hooks.afterPlan = undefined;
    }
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('still converted: manifest.engines.protocol (declared protocol range)');
    expect(snapshot(dir)).toEqual({ 'objectstack.config.ts': SOURCE });
  }, RUN_TIMEOUT);

  it('the planner refuses a range literal it cannot prove, and writes the chain\'s edits beside it', async () => {
    const source = "const ENGINES = { protocol: '^16' };\n"
      + 'export const other = ENGINES;\n'
      + "export default { manifest: { id: 'x', engines: ENGINES }, datasources: [{ name: 'd', driver: 'mongo' }] };\n";
    const configPath = join(writeProject({ 'objectstack.config.ts': source }), 'objectstack.config.ts');
    const loaded = { manifest: { id: 'x', engines: { protocol: '^16' } }, datasources: [{ name: 'd', driver: 'mongo' }] };
    const plan = await planAuthoredSourceWrite({
      configPath,
      config: loaded,
      namedExports: [],
      normalized: loaded,
      migrated: { ...loaded, datasources: [{ name: 'd', driver: 'mongodb' }] },
      applied: [{ toMajor: 17, conversionId: 'probe-driver', surface: 'probe', from: 'mongo', to: 'mongodb', path: 'datasources[0].driver' }],
      range: { path: 'manifest.engines.protocol', from: '^16', to: '^17', major: 17 },
    });
    expect(plan.range).toMatchObject({ status: 'manual', refusal: { kind: 'shared' } });
    expect(plan.written.map((w) => w.application.conversionId)).toEqual(['probe-driver']);
    expect(plan.manual).toEqual([]);
    expect(plan.rewrites[0]!.after).toBe(edit(source, "driver: 'mongo'", "driver: 'mongodb'"));

    // The re-check expects a range left by hand to still be owed, and nothing else.
    const owed = { path: 'manifest.engines.protocol', from: '^16', to: '^17', major: 17 };
    expect(verifyAuthoredSourceWrite(plan, [], owed).ok).toBe(true);
    expect(verifyAuthoredSourceWrite(plan, [])).toEqual({
      ok: false,
      stillApplied: [],
      vanished: ['manifest.engines.protocol (declared protocol range)'],
    });
  });
});
