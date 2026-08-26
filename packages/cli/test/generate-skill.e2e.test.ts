// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#11025) — `os g skill` writes a file the loader actually FINDS, and
 * that file parses.
 *
 * ## Why "it writes a file" is the wrong assertion
 *
 * A test asserting only that the command created something passes just as
 * happily when the filename matches no `filePatterns` entry — which IS the
 * defect. `DEFAULT_METADATA_TYPE_REGISTRY` declares `skill`'s file
 * convention as `*.skill.ts` / `*.skill.yml` — the loader mechanism behind
 * that convention, and the precondition that keeps this repo from meeting
 * it today, are stated once in `metadata-file-name.ts` (#12075), not
 * restated here. `skill` is `allowRuntimeCreate: true` — a type the
 * platform expects to discover. The harness's own convention is
 * `NAME.ts`, so a naive skill scaffold lands as `lead_qualification.ts`,
 * matches neither pattern, and then type-checks, validates and publishes with
 * nothing anywhere saying it was skipped. That is the silent-strip shape
 * ADR-0063's retirement of `os g agent` closed (#10359), re-entering through
 * the scaffolder that replaced it.
 *
 * So the two pins below are:
 *
 * 1. **the written path is matched by the `skill` entry's REAL patterns**,
 *    read out of `DEFAULT_METADATA_TYPE_REGISTRY` at test time rather than
 *    restated here — a copy of the patterns would go stale in exactly the
 *    direction that hides the bug; and the file under test is DISCOVERED by
 *    listing the output directory, not assumed, so a generator that wrote the
 *    wrong name fails the pattern assertion instead of the existence one.
 * 2. **the generated file parses**, proven by importing it in a child
 *    process: the template calls `defineSkill(…)` at module scope, so the
 *    import IS `SkillSchema.parse`. This is the pin that fails if anyone
 *    ever copies the template from `SkillSchema`'s or `defineSkill`'s
 *    `@example` blocks — both pass `triggerPhrases`, a `retiredKey()`
 *    tombstone that rejects on parse (#11026).
 *
 * `matchesGlob` comes from `node:path` on purpose. Hand-rolling a glob
 * matcher here would re-introduce the restatement the first pin exists to
 * avoid, one layer down: the whole point is that nothing in this file decides
 * what `**` + `*.skill.ts` mean.
 *
 * ## The control this file also holds (#11071)
 *
 * `os g object` is exercised here as a CONTROL, and what it controls for
 * changed. #11025 scoped the filename fix to `skill` and fenced the repo-wide
 * route, so the control pinned `customer.ts` and a `'./customer'` barrel line.
 * #11071 measured the loader rather than assuming — the mechanism, and the
 * precondition that keeps it from firing in this repo today, are stated once
 * in `metadata-file-name.ts` (#12075), not restated here — and the
 * per-generator override was replaced by a default derived from the
 * registry. The control now pins the OTHER side of
 * that: `os g object` writes a name the `object` entry's own patterns match,
 * proving the derivation is wired into the real command and not just unit-true.
 *
 * The exhaustive form of that property — every generator, plus the kebab-infix
 * case no generator exercises yet — is `generate-file-name-registry-parity.test.ts`.
 * This file keeps the end-to-end half: a real child process, a real write.
 *
 * Assertions run against a REAL CHILD PROCESS and read stdout, for the two
 * reasons `generate-agent-retired.e2e.test.ts` documents: `process.exitCode`
 * inside a vitest worker is not an exit status, and these commands print
 * through `utils/format.ts`, which writes to stdout. Spawned through
 * `bin/run-dev.js` + tsx, so the suite does not depend on `packages/cli/dist`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/**
 * Resolved through node_modules rather than by walking up from this file:
 * `packages/cli` already depends on `@objectstack/spec`, so the dependency is
 * one turbo already knows about, and a package specifier is not a
 * cross-package source read. Same reasoning as `migrate-meta.e2e.test.ts`.
 */
const SPEC_PACKAGE_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/spec/package.json'));

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

/** The contract under test, read from the registry — never restated. */
const SKILL_ENTRY = DEFAULT_METADATA_TYPE_REGISTRY.find(entry => entry.type === 'skill');

/** Same, for the generator this file exercises end-to-end as a control (#11071). */
const OBJECT_ENTRY = DEFAULT_METADATA_TYPE_REGISTRY.find(entry => entry.type === 'object');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; null/undefined means the child
          // was signalled — a different failure, never reported as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** `a/b/c.ts` with forward slashes, the spelling a glob pattern is written in. */
function toPosixRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/');
}

let dir: string;
let specLink: string;

let generated: Run;
let control: Run;
let parseProbe: Run;

/** The file the generator actually wrote — listed, not assumed. */
let writtenName: string;
let writtenSource: string;
let barrelSource: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-g-skill-'));

  // The generated file imports `@objectstack/spec/ai`, and the parse probe has
  // to run it for real. Link the package into the scratch project so ordinary
  // node resolution finds it from `dir/src/skills/…`.
  mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
  specLink = join(dir, 'node_modules', '@objectstack', 'spec');
  symlinkSync(SPEC_PACKAGE_ROOT, specLink, 'dir');

  // Sequential on purpose: cold tsx starts, each loading every command module,
  // in a container several agents share.
  generated = await runTsx([CLI, 'g', 'skill', 'lead-qualification'], dir);
  control = await runTsx([CLI, 'g', 'object', 'customer'], dir);

  const skillDir = join(dir, 'src', 'skills');
  const produced = existsSync(skillDir)
    ? readdirSync(skillDir).filter(f => f !== 'index.ts')
    : [];
  writtenName = produced[0] ?? '';
  writtenSource = writtenName ? readFileSync(join(skillDir, writtenName), 'utf-8') : '';
  barrelSource = existsSync(join(skillDir, 'index.ts'))
    ? readFileSync(join(skillDir, 'index.ts'), 'utf-8')
    : '';

  // Importing the module RUNS `defineSkill(…)`, i.e. `SkillSchema.parse`. A
  // non-zero exit here means the scaffold this command ships does not parse.
  if (writtenName) {
    const probe = join(dir, 'parse-probe.ts');
    writeFileSync(
      probe,
      `import skill from './src/skills/${writtenName}';\n`
      + 'process.stdout.write(JSON.stringify(skill));\n',
    );
    parseProbe = await runTsx([probe], dir);
  }
}, RUN_TIMEOUT_MS);

afterAll(() => {
  // Unlinked BEFORE the recursive remove, and named explicitly: this symlink
  // points at the real `packages/spec` in the checkout, and the one thing that
  // must never be ambiguous in a cleanup is whether it can follow it.
  try { unlinkSync(specLink); } catch { /* already gone */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('[#11025] `os g skill` exists and succeeds', () => {
  it('is a real generator, not an unknown type', () => {
    expect(generated.code).toBe(0);
    expect(generated.stdout).not.toContain('Unknown type:');
    expect(generated.stdout).not.toContain('was retired');
  });

  it('writes exactly one skill file into `src/skills/`', () => {
    expect(writtenName).not.toBe('');
  });
});

describe('[#11025] the written path is one the loader can find', () => {
  it('the registry still describes `skill` as filesystem-discovered', () => {
    // If either of these ever stops holding, the pin below is measuring
    // something other than what it claims — so it says so out loud rather
    // than passing quietly.
    expect(SKILL_ENTRY).toBeDefined();
    expect(SKILL_ENTRY!.allowRuntimeCreate).toBe(true);
    expect(SKILL_ENTRY!.filePatterns.length).toBeGreaterThan(0);
  });

  it('matches a `filePatterns` entry read out of DEFAULT_METADATA_TYPE_REGISTRY', () => {
    const relPath = toPosixRelative(dir, join(dir, 'src', 'skills', writtenName));
    const matched = SKILL_ENTRY!.filePatterns.filter(pattern => matchesGlob(relPath, pattern));

    // The failure message is the point of this assertion: it names the path
    // that was written and the patterns it had to satisfy.
    expect(
      matched.length,
      `generated "${relPath}" matches none of ${JSON.stringify(SKILL_ENTRY!.filePatterns)} — `
      + 'it would validate, publish and never load',
    ).toBeGreaterThan(0);
  });

  it('is announced to the author by the path it actually took', () => {
    expect(generated.stdout).toContain(`src/skills/${writtenName}`);
  });

  it('exports itself from a barrel that names the real module', () => {
    // A barrel rebuilt from the metadata name rather than the filename would
    // read `'./lead_qualification'` and resolve to nothing.
    expect(barrelSource).toContain(`from './${writtenName.replace(/\.ts$/, '')}'`);
  });
});

describe('[#11025] the generated skill parses', () => {
  it('imports cleanly — `defineSkill` runs at module scope, so this IS the parse', () => {
    // The child's whole stderr is deliberately NOT the assertion message. It
    // carries a full ZodError with absolute paths, and vitest's stack
    // formatter crashes trying to source-map its way through one: measured
    // while reverse-verifying this pin, the run still failed but reported an
    // unhandled "Test Run Error" with blank counts instead of naming the
    // assertion that caught the defect. One line says what happened, and a
    // red that names itself is worth more here than a full dump.
    const headline = parseProbe.stderr.split('\n').find(line => line.includes('Error')) ?? '';
    expect(parseProbe.code, headline.slice(0, 200)).toBe(0);
  });

  it('produces a skill whose machine name and surface survive the parse', () => {
    const parsed = JSON.parse(parseProbe.stdout) as Record<string, unknown>;
    expect(parsed.name).toBe('lead_qualification');
    expect(parsed.surface).toBe('ask');
    expect(parsed.tools).toEqual([]);
  });

  it('carries no `triggerPhrases` — the retired key both spec `@example` blocks still pass', () => {
    // Textual, deliberately: the parse above already refuses the tombstone, so
    // this assertion exists to name the specific copy-source hazard (#11026)
    // for whoever edits the template next.
    expect(writtenSource).not.toContain('triggerPhrases');
  });

  it('writes `surface` and `tools` out rather than leaning on the schema defaults', () => {
    // `surface` defaults to 'ask' and would parse identically if omitted, so
    // the parsed value above cannot tell whether the template emits the key.
    // This can.
    expect(writtenSource).toMatch(/^\s*surface: 'ask',$/m);
    expect(writtenSource).toMatch(/^\s*tools: \[\],$/m);
  });
});

describe('[#11071] the same rule reaches the other generators, end to end', () => {
  it('the registry still describes `object` as filesystem-discovered', () => {
    // Same self-check as the `skill` block above: if this stops holding, the
    // pin below is measuring something other than what it claims.
    expect(OBJECT_ENTRY).toBeDefined();
    expect(OBJECT_ENTRY!.allowRuntimeCreate).toBe(true);
    expect(OBJECT_ENTRY!.filePatterns.length).toBeGreaterThan(0);
  });

  it('`os g object` writes a path matched by the `object` entry\'s own patterns', () => {
    expect(control.code).toBe(0);

    const objectDir = join(dir, 'src', 'objects');
    const produced = existsSync(objectDir)
      ? readdirSync(objectDir).filter(f => f !== 'index.ts')
      : [];
    // Listed, not assumed — a generator that wrote the wrong name has to fail
    // the pattern assertion, not an existence one.
    expect(produced).toHaveLength(1);

    const relPath = toPosixRelative(dir, join(objectDir, produced[0]));
    const matched = OBJECT_ENTRY!.filePatterns.filter(pattern => matchesGlob(relPath, pattern));

    expect(
      matched.length,
      `generated "${relPath}" matches none of ${JSON.stringify(OBJECT_ENTRY!.filePatterns)} — `
      + 'it would validate, publish and never load',
    ).toBeGreaterThan(0);
  });

  it('and its barrel line names the module that was really written', () => {
    const objectDir = join(dir, 'src', 'objects');
    const written = readdirSync(objectDir).filter(f => f !== 'index.ts')[0];
    const objectBarrel = readFileSync(join(objectDir, 'index.ts'), 'utf-8');
    // Rebuilt from the metadata name rather than the filename, this would read
    // `'./customer'` and resolve to nothing.
    expect(objectBarrel).toContain(
      `export { default as customer } from './${written.replace(/\.ts$/, '')}';`,
    );
  });
});
