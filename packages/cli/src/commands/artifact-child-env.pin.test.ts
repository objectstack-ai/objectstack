// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: **the presence of `OS_ARTIFACT_PATH` in a config's environment means an
 * operator set it.**
 *
 * `os start` and `os dev` spawn `os serve`, and the downstream
 * `objectstack.config.ts` is evaluated inside that child. While the supervisors
 * wrote their own resolved artifact path into the child's `OS_ARTIFACT_PATH`,
 * the variable was set on **every** boot — so a config could not tell an
 * operator's instruction from the CLI's own plumbing, and a consumer wanting to
 * refuse the retired knob could only do so by inspecting its *value*.
 *
 * The plumbing now travels on `OS_INTERNAL_ARTIFACT_PATH`
 * (`utils/internal-artifact-channel.ts`). This file pins both halves of the
 * property, plus the behaviours that had to survive the move: the resolution
 * ladder, and `start`'s deliberate refusal to declare an empty boot acceptable
 * when a reference is driving the boot.
 *
 * #21501 — the ladder is now ONE resolver every door asks
 * (`utils/artifact-precedence.ts`): `start` and `dev` resolve through it, and
 * its last rung (does the cwd `objectstack.config.ts` take part?) is the one
 * predicate both the supervisors' `Config:` row and the `serve` child read.
 * The ladder pins below drive that resolver; the boots that prove the child
 * obeys it live in `test/artifact-flag-precedence.integration.test.ts`.
 *
 * Two kinds of assertion here, and both are needed:
 *
 * - **Behavioural** — over `childEnvWithResolvedArtifact`, which is the whole
 *   of what each command contributes to its child's artifact environment.
 * - **Structural** — a source assertion that neither command writes
 *   `OS_ARTIFACT_PATH` into an env object at all. The behavioural pins describe
 *   the helper; only this one refuses a future edit that re-adds the write
 *   beside it. Both files compose their child env as
 *   `{ ...childEnvWithResolvedArtifact(process.env, …), …other keys }`, so
 *   "the helper is correct" plus "nothing else writes the key" is what makes
 *   the composed env correct.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'path';
import ts from 'typescript';
import {
  INTERNAL_ARTIFACT_PATH_ENV,
  INTERNAL_CONFIG_OUTPUT_PATH_ENV,
  childEnvWithResolvedArtifact,
  readInternalArtifactPath,
  readInternalConfigOutputPath,
} from '../utils/internal-artifact-channel.js';
import {
  cwdConfigJoinsBoot,
  isConfigCompiledArtifact,
  resolveArtifactBootSource,
} from '../utils/artifact-precedence.js';

const ARTIFACT = '/srv/app/objectstack.json';

describe('the child `serve` env — OS_ARTIFACT_PATH means an operator set it', () => {
  it('carries NO OS_ARTIFACT_PATH when the operator did not set one', () => {
    const parentEnv = { PATH: '/usr/bin', NODE_ENV: 'production' };

    for (const decision of [
      { kind: 'resolved', path: ARTIFACT },
      { kind: 'reference' },
      { kind: 'empty' },
    ] as const) {
      const childEnv = childEnvWithResolvedArtifact(parentEnv, decision);
      expect(
        Object.prototype.hasOwnProperty.call(childEnv, 'OS_ARTIFACT_PATH'),
        `decision ${decision.kind} must not introduce OS_ARTIFACT_PATH`,
      ).toBe(false);
      expect(childEnv.OS_ARTIFACT_PATH).toBeUndefined();
    }
  });

  it('still carries OS_ARTIFACT_PATH — verbatim — when the operator DID set one', () => {
    const parentEnv = { OS_ARTIFACT_PATH: './dist/from-operator.json' };

    for (const decision of [
      { kind: 'resolved', path: '/abs/dist/from-operator.json' },
      { kind: 'reference' },
      { kind: 'empty' },
    ] as const) {
      const childEnv = childEnvWithResolvedArtifact(parentEnv, decision);
      // Inherited untouched: the child sees exactly what the operator wrote,
      // not an absolutised rewrite of it.
      expect(childEnv.OS_ARTIFACT_PATH).toBe('./dist/from-operator.json');
    }
  });

  it('hands the resolved artifact down on the internal channel instead', () => {
    const childEnv = childEnvWithResolvedArtifact({}, { kind: 'resolved', path: ARTIFACT });
    expect(childEnv[INTERNAL_ARTIFACT_PATH_ENV]).toBe(ARTIFACT);
    expect(readInternalArtifactPath(childEnv)).toBe(ARTIFACT);
  });

  it('lets the parent OWN the internal channel — an inherited value never speaks for it', () => {
    const parentEnv = { [INTERNAL_ARTIFACT_PATH_ENV]: '/stale/inherited.json' };

    expect(childEnvWithResolvedArtifact(parentEnv, { kind: 'resolved', path: ARTIFACT }))
      .toMatchObject({ [INTERNAL_ARTIFACT_PATH_ENV]: ARTIFACT });

    for (const decision of [{ kind: 'reference' }, { kind: 'empty' }] as const) {
      const childEnv = childEnvWithResolvedArtifact(parentEnv, decision);
      expect(
        readInternalArtifactPath(childEnv),
        `decision ${decision.kind} resolved nothing, so the channel must be empty`,
      ).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(childEnv, INTERNAL_ARTIFACT_PATH_ENV)).toBe(false);
    }
  });

  it('a `resolved` answer REMOVES an outranked OS_ARTIFACT_URL; a reference keeps it (#21501)', () => {
    // Through the one ladder a supervisor resolves an artifact while the
    // reference is set only on the rung above it — `--artifact`. Leaving the
    // reference in the child env let `serve` read it first: measured,
    // `OS_ARTIFACT_URL=file://…/BRAVO.json os dev -a ALPHA.json` served BRAVO.
    const parentEnv = { OS_ARTIFACT_URL: 'https://cdn.example.com/ref.json' };
    expect(childEnvWithResolvedArtifact(parentEnv, { kind: 'resolved', path: ARTIFACT }).OS_ARTIFACT_URL)
      .toBeUndefined();
    for (const decision of [{ kind: 'reference' }, { kind: 'empty' }] as const) {
      expect(childEnvWithResolvedArtifact(parentEnv, decision).OS_ARTIFACT_URL)
        .toBe('https://cdn.example.com/ref.json');
    }
  });

  it('carries where the parent compiles the cwd config only when the decision says so — and owns that variable too', () => {
    const named = '/srv/app/build/named.json';
    const withTarget = childEnvWithResolvedArtifact({}, { kind: 'resolved', path: named, configCompiledTo: named });
    expect(withTarget[INTERNAL_CONFIG_OUTPUT_PATH_ENV]).toBe(named);
    expect(readInternalConfigOutputPath(withTarget)).toBe(named);

    // An inherited copy never speaks for a decision the parent did not make.
    const parentEnv = { [INTERNAL_CONFIG_OUTPUT_PATH_ENV]: '/stale/inherited.json' };
    for (const decision of [
      { kind: 'resolved', path: ARTIFACT },
      { kind: 'reference' },
      { kind: 'empty' },
    ] as const) {
      const childEnv = childEnvWithResolvedArtifact(parentEnv, decision);
      expect(
        Object.prototype.hasOwnProperty.call(childEnv, INTERNAL_CONFIG_OUTPUT_PATH_ENV),
        `decision ${decision.kind} declared no compile path, so the variable must be absent`,
      ).toBe(false);
    }
    expect(readInternalConfigOutputPath({ [INTERNAL_CONFIG_OUTPUT_PATH_ENV]: '  ' })).toBeUndefined();
  });

  it('reads a blank channel value as no decision at all', () => {
    expect(readInternalArtifactPath({})).toBeUndefined();
    expect(readInternalArtifactPath({ [INTERNAL_ARTIFACT_PATH_ENV]: '' })).toBeUndefined();
    expect(readInternalArtifactPath({ [INTERNAL_ARTIFACT_PATH_ENV]: '   ' })).toBeUndefined();
  });
});

describe('OS_BOOT_EMPTY — the artifact-reference refusal survives the move', () => {
  it('is NOT set when a reference (OS_ARTIFACT_URL) is driving the boot', () => {
    // Load-bearing: setting it here would tell `serve` that booting an app-less
    // kernel is an acceptable outcome, turning an unreachable artifact host
    // into a silently empty platform instead of a loud refusal.
    const childEnv = childEnvWithResolvedArtifact({}, { kind: 'reference' });
    expect(childEnv.OS_BOOT_EMPTY).toBeUndefined();
    expect(readInternalArtifactPath(childEnv)).toBeUndefined();
  });

  it('is NOT set when an artifact was resolved', () => {
    expect(childEnvWithResolvedArtifact({}, { kind: 'resolved', path: ARTIFACT }).OS_BOOT_EMPTY)
      .toBeUndefined();
  });

  it('is set only when nothing resolved and an empty boot IS the intent', () => {
    expect(childEnvWithResolvedArtifact({}, { kind: 'empty' }).OS_BOOT_EMPTY).toBe('1');
  });

  it('never CLEARS an operator-exported OS_BOOT_EMPTY (add-only, as before)', () => {
    const parentEnv = { OS_BOOT_EMPTY: '1' };
    for (const decision of [
      { kind: 'resolved', path: ARTIFACT },
      { kind: 'reference' },
      { kind: 'empty' },
    ] as const) {
      expect(
        childEnvWithResolvedArtifact(parentEnv, decision).OS_BOOT_EMPTY,
        `decision ${decision.kind} must not start clearing an inherited OS_BOOT_EMPTY`,
      ).toBe('1');
    }
  });
});

describe('resolveArtifactBootSource — THE ladder, written once (#21501)', () => {
  let cwd: string;
  let home: string;

  const write = (dir: string, rel: string) => {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '{}');
    return abs;
  };
  const resolvedPath = (r: ReturnType<typeof resolveArtifactBootSource>) =>
    (r.kind === 'resolved' ? r.path : undefined);

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'os-artifact-cwd-'));
    home = mkdtempSync(path.join(tmpdir(), 'os-artifact-home-'));
  });
  afterEach(() => {
    for (const d of [cwd, home]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('rung 1: --artifact wins over everything, an operator OS_ARTIFACT_PATH and OS_ARTIFACT_URL included', () => {
    const flagFile = write(cwd, 'build/pinned.json');
    write(cwd, 'dist/objectstack.json');
    write(home, 'dist/objectstack.json');

    const r = resolveArtifactBootSource({
      flag: 'build/pinned.json',
      cwd,
      homeDir: home,
      env: { OS_ARTIFACT_PATH: '/from/env.json', OS_ARTIFACT_URL: 'https://cdn.example.com/ref.json' },
    });
    expect(r).toMatchObject({ kind: 'resolved', rung: 'flag', path: flagFile });
  });

  it('rung 1: --artifact passes an http(s) URL through untouched', () => {
    const url = 'https://cdn.example.com/app.json';
    expect(resolvedPath(resolveArtifactBootSource({ flag: url, cwd, homeDir: home, env: {} }))).toBe(url);
  });

  it('rung 1: a named --artifact is not existence-checked — a missing one is the child\'s loud refusal', () => {
    expect(resolveArtifactBootSource({ flag: 'nope.json', cwd, env: {} }))
      .toMatchObject({ kind: 'resolved', rung: 'flag', path: path.join(cwd, 'nope.json') });
  });

  it('rung 2a: OS_ARTIFACT_URL is a reference — resolved by the child, never here — and outranks OS_ARTIFACT_PATH', () => {
    write(cwd, 'dist/objectstack.json');
    const r = resolveArtifactBootSource({
      cwd,
      homeDir: home,
      env: { OS_ARTIFACT_URL: '  https://cdn.example.com/ref.json  ', OS_ARTIFACT_PATH: 'custom/app.json' },
    });
    expect(r).toEqual({ kind: 'reference', url: 'https://cdn.example.com/ref.json' });
  });

  it('rung 2a: a blank OS_ARTIFACT_URL reads as unset', () => {
    const cwdArtifact = write(cwd, 'dist/objectstack.json');
    expect(resolvedPath(resolveArtifactBootSource({ cwd, env: { OS_ARTIFACT_URL: '   ' } }))).toBe(cwdArtifact);
  });

  it('rung 2b: $OS_ARTIFACT_PATH wins over both auto-detected locations', () => {
    write(cwd, 'dist/objectstack.json');
    write(home, 'dist/objectstack.json');

    const r = resolveArtifactBootSource({ cwd, homeDir: home, env: { OS_ARTIFACT_PATH: 'custom/app.json' } });
    // Anchored on the cwd — the ladder resolves it; the variable itself is
    // inherited by the child untouched.
    expect(r).toMatchObject({ kind: 'resolved', rung: 'env-path', path: path.join(cwd, 'custom/app.json') });
  });

  it('rung 2b: $OS_ARTIFACT_PATH may itself be an http(s) URL', () => {
    const url = 'https://cdn.example.com/env.json';
    expect(resolvedPath(resolveArtifactBootSource({ cwd, homeDir: home, env: { OS_ARTIFACT_PATH: url } })))
      .toBe(url);
  });

  it('rung 3: <cwd>/dist/objectstack.json wins over <home>/dist', () => {
    const cwdArtifact = write(cwd, 'dist/objectstack.json');
    write(home, 'dist/objectstack.json');
    expect(resolveArtifactBootSource({ cwd, homeDir: home, env: {} }))
      .toMatchObject({ kind: 'resolved', rung: 'cwd-dist', path: cwdArtifact });
  });

  it('rung 4: <home>/dist/objectstack.json is the last artifact rung — and only for a door that passes a home', () => {
    const homeArtifact = write(home, 'dist/objectstack.json');
    expect(resolveArtifactBootSource({ cwd, homeDir: home, env: {} }))
      .toMatchObject({ kind: 'resolved', rung: 'home-dist', path: homeArtifact });
    // `os dev` passes no home: its home is per-run state, never an artifact source.
    expect(resolveArtifactBootSource({ cwd, env: {} })).toEqual({ kind: 'unresolved' });
  });

  it('rung 5: nothing reachable is `unresolved` — what is left is the cwd config', () => {
    expect(resolveArtifactBootSource({ cwd, homeDir: home, env: {} })).toEqual({ kind: 'unresolved' });
  });
});

describe('cwdConfigJoinsBoot — the last rung, one predicate for both ends (#21501)', () => {
  const projectDir = path.join(tmpdir(), 'os-project');
  const configPath = path.join(projectDir, 'objectstack.config.ts');
  const ownArtifact = path.join(projectDir, 'dist', 'objectstack.json');

  it('a config takes part when nothing above it answered', () => {
    expect(cwdConfigJoinsBoot({ configExists: true, configPath, artifact: { kind: 'none' } })).toBe(true);
  });

  it('a config takes part when the artifact IS its own compiled output — however the path is spelled', () => {
    expect(cwdConfigJoinsBoot({ configExists: true, configPath, artifact: { kind: 'path', path: ownArtifact } }))
      .toBe(true);
    expect(isConfigCompiledArtifact(path.join(projectDir, 'dist', '.', 'objectstack.json'), configPath)).toBe(true);
  });

  it('a config does NOT take part beside any other named artifact — leg 1 and leg 2 of the card', () => {
    for (const other of [
      path.join(projectDir, 'build', 'pinned.json'),
      path.join(tmpdir(), 'elsewhere', 'objectstack.json'),
      path.join(projectDir, '.objectstack', 'dist', 'objectstack.json'),
      'https://cdn.example.com/objectstack.json',
    ]) {
      expect(
        cwdConfigJoinsBoot({ configExists: true, configPath, artifact: { kind: 'path', path: other } }),
        `${other} must boot alone, not under the cwd config`,
      ).toBe(false);
    }
  });

  it('a config takes part when the artifact is where THIS command compiled it — a named path (os dev under OS_ARTIFACT_PATH)', () => {
    const named = path.join(projectDir, 'build', 'named.json');
    expect(cwdConfigJoinsBoot({
      configExists: true,
      configPath,
      artifact: { kind: 'path', path: named, configCompiledTo: named },
    })).toBe(true);
    expect(isConfigCompiledArtifact(named, configPath, path.join(projectDir, 'build', '.', 'named.json'))).toBe(true);
    // Declaring a compile path does not make a DIFFERENT artifact the config's own,
    expect(cwdConfigJoinsBoot({
      configExists: true,
      configPath,
      artifact: { kind: 'path', path: path.join(tmpdir(), 'elsewhere.json'), configCompiledTo: named },
    })).toBe(false);
    // and a URL is never a place a config was compiled to.
    expect(isConfigCompiledArtifact('https://cdn.example.com/a.json', configPath, 'https://cdn.example.com/a.json'))
      .toBe(false);
    // The conventional path stays the config's own output beside a declared one.
    expect(isConfigCompiledArtifact(ownArtifact, configPath, named)).toBe(true);
  });

  it('a config does NOT take part under a reference (OS_ARTIFACT_URL)', () => {
    expect(cwdConfigJoinsBoot({ configExists: true, configPath, artifact: { kind: 'reference' } })).toBe(false);
  });

  it('no config never takes part', () => {
    for (const artifact of [
      { kind: 'none' },
      { kind: 'reference' },
      { kind: 'path', path: ownArtifact },
    ] as const) {
      expect(cwdConfigJoinsBoot({ configExists: false, configPath, artifact })).toBe(false);
    }
  });
});

describe('structural: the supervisors never write the operator knob', () => {
  /**
   * Read WRITES of `OS_ARTIFACT_PATH` off the TypeScript AST.
   *
   * Deliberately not a text scan. The first version of this pin stripped
   * comments with a regex and reported `start.ts` clean while the file really
   * did carry the write: the `--auth-secret` flag description contains the
   * literal `/api/v1/auth/*`, whose `/*` opened a phantom block comment that
   * swallowed 250 lines of real code, the injection among them. A detector that
   * under-reports silently is worse than none — so the parser decides what is
   * code and what is prose, and strings and comments cannot lie to it.
   *
   * Only writes are collected. Reading `process.env.OS_ARTIFACT_PATH` — the
   * operator's own value, which both commands' ladders still honour — is
   * correct and must stay possible.
   */
  const artifactPathWrites = (file: string): string[] => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const hits: string[] = [];

    const at = (node: ts.Node) =>
      `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
    const staticName = (node: ts.Node): string | undefined =>
      ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;

    const visit = (node: ts.Node): void => {
      // `{ OS_ARTIFACT_PATH: value }` and `{ OS_ARTIFACT_PATH }`
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
        && staticName(node.name) === 'OS_ARTIFACT_PATH'
      ) {
        hits.push(`${at(node)} object property`);
      }
      // `env.OS_ARTIFACT_PATH = value` / `env['OS_ARTIFACT_PATH'] = value`
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = node.left;
        if (ts.isPropertyAccessExpression(lhs) && lhs.name.text === 'OS_ARTIFACT_PATH') {
          hits.push(`${at(node)} property assignment`);
        }
        if (
          ts.isElementAccessExpression(lhs)
          && staticName(lhs.argumentExpression) === 'OS_ARTIFACT_PATH'
        ) {
          hits.push(`${at(node)} indexed assignment`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return hits;
  };

  for (const file of ['start.ts', 'dev.ts']) {
    it(`${file} writes OS_ARTIFACT_PATH nowhere`, () => {
      expect(
        artifactPathWrites(file),
        `${file} must not write OS_ARTIFACT_PATH into a child environment — the CLI's own `
        + `resolved artifact travels on ${INTERNAL_ARTIFACT_PATH_ENV}, so that a downstream `
        + `objectstack.config.ts seeing OS_ARTIFACT_PATH knows an operator set it. `
        + `Reading process.env.OS_ARTIFACT_PATH (the operator's value) stays correct.`,
      ).toEqual([]);
    });
  }

  it('the detector itself sees a write that a comment-stripping text scan missed', () => {
    // The specimen is `start.ts`'s own shape, with the `/*`-bearing string that
    // defeated the text scan sitting above it. Without this, the pin above
    // could go permanently green by failing to look.
    // The trailing docblock matters: the `/*` inside the string only swallows
    // code up to the next `*/`, and in the real file that closer is an ordinary
    // docblock a few hundred lines further down.
    const specimen = [
      "const flag = { description: 'mount /api/v1/auth/* (overrides $AUTH_SECRET)' };",
      'const childEnv = {',
      '  ...process.env,',
      '  OS_ARTIFACT_PATH: resolved.path,',
      '};',
      '/** An ordinary docblock, whose closer ends the phantom comment. */',
      'export const done = true;',
    ].join('\n');

    const sourceFile = ts.createSourceFile('specimen.ts', specimen, ts.ScriptTarget.Latest, true);
    let found = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)
        && node.name.text === 'OS_ARTIFACT_PATH') found += 1;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(found).toBe(1);

    // ...and the text scan this replaced reports the same specimen clean.
    const textScanned = specimen.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/OS_ARTIFACT_PATH\s*:/.test(textScanned)).toBe(false);
  });
});

describe('structural: the supervisors carry no private copy of the ladder (#21501)', () => {
  /**
   * `start` and `dev` each used to read the operator's artifact variables
   * themselves, in their own order — and `dev`'s order had no
   * `OS_ARTIFACT_URL` rung, which is how `--artifact` came to lose to the
   * reference. Every rung is now read in `utils/artifact-precedence.ts` alone.
   * A READ of either variable reappearing in a supervisor is a second copy of
   * the order starting to grow, so it is refused here by the AST (strings and
   * comments that merely NAME the variables stay free).
   */
  const ARTIFACT_VARS = new Set(['OS_ARTIFACT_PATH', 'OS_ARTIFACT_URL']);

  const artifactVarReadsIn = (file: string, src: string): string[] => {
    const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const hits: string[] = [];
    const at = (node: ts.Node) =>
      `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && ARTIFACT_VARS.has(node.name.text)) {
        hits.push(`${at(node)} ${node.getText(sourceFile)}`);
      }
      if (
        ts.isElementAccessExpression(node)
        && ts.isStringLiteral(node.argumentExpression)
        && ARTIFACT_VARS.has(node.argumentExpression.text)
      ) {
        hits.push(`${at(node)} ${node.getText(sourceFile)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return hits;
  };
  const artifactVarReads = (file: string): string[] =>
    artifactVarReadsIn(file, readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));

  for (const file of ['start.ts', 'dev.ts']) {
    it(`${file} reads neither artifact variable itself — it asks resolveArtifactBootSource`, () => {
      expect(
        artifactVarReads(file),
        `${file} must resolve the artifact through utils/artifact-precedence.ts, never by reading `
        + 'OS_ARTIFACT_PATH / OS_ARTIFACT_URL itself: a second reading is a second copy of the order.',
      ).toEqual([]);
    });
  }

  it('the detector sees both spellings of a read — and not a name inside a string', () => {
    const specimen = [
      'const a = process.env.OS_ARTIFACT_URL;',
      "const b = env['OS_ARTIFACT_PATH'];",
      "printKV('Artifact', `${x} (OS_ARTIFACT_URL)`); // OS_ARTIFACT_PATH in a comment",
    ].join('\n');
    expect(artifactVarReadsIn('specimen.ts', specimen)).toEqual([
      'specimen.ts:1 process.env.OS_ARTIFACT_URL',
      "specimen.ts:2 env['OS_ARTIFACT_PATH']",
    ]);
  });
});
