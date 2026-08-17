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
 * property, plus the two behaviours that had to survive the move: the
 * resolution ladder, and `start`'s deliberate refusal to declare an empty boot
 * acceptable when a reference is driving the boot.
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
  childEnvWithResolvedArtifact,
  readInternalArtifactPath,
} from '../utils/internal-artifact-channel.js';
import { resolveArtifactSource } from './start.js';

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

describe('resolveArtifactSource — the resolution ladder is unchanged', () => {
  let cwd: string;
  let home: string;

  const write = (dir: string, rel: string) => {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '{}');
    return abs;
  };

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'os-artifact-cwd-'));
    home = mkdtempSync(path.join(tmpdir(), 'os-artifact-home-'));
  });
  afterEach(() => {
    for (const d of [cwd, home]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('rung 1: --artifact wins over everything, including an operator OS_ARTIFACT_PATH', () => {
    const flagFile = write(cwd, 'build/pinned.json');
    write(cwd, 'dist/objectstack.json');
    write(home, 'dist/objectstack.json');

    const r = resolveArtifactSource('build/pinned.json', home, {
      cwd,
      env: { OS_ARTIFACT_PATH: '/from/env.json' },
    });
    expect(r?.path).toBe(flagFile);
  });

  it('rung 1: --artifact passes an http(s) URL through untouched', () => {
    const url = 'https://cdn.example.com/app.json';
    expect(resolveArtifactSource(url, home, { cwd, env: {} })?.path).toBe(url);
  });

  it('rung 2: $OS_ARTIFACT_PATH wins over both auto-detected locations', () => {
    write(cwd, 'dist/objectstack.json');
    write(home, 'dist/objectstack.json');

    const r = resolveArtifactSource(undefined, home, {
      cwd,
      env: { OS_ARTIFACT_PATH: 'custom/app.json' },
    });
    // Anchored on the cwd, exactly as before — the ladder resolves it; the
    // variable itself is inherited by the child untouched.
    expect(r?.path).toBe(path.join(cwd, 'custom/app.json'));
  });

  it('rung 2: $OS_ARTIFACT_PATH may itself be an http(s) URL', () => {
    const url = 'https://cdn.example.com/env.json';
    expect(resolveArtifactSource(undefined, home, { cwd, env: { OS_ARTIFACT_PATH: url } })?.path)
      .toBe(url);
  });

  it('rung 3: <cwd>/dist/objectstack.json wins over <home>/dist', () => {
    const cwdArtifact = write(cwd, 'dist/objectstack.json');
    write(home, 'dist/objectstack.json');
    expect(resolveArtifactSource(undefined, home, { cwd, env: {} })?.path).toBe(cwdArtifact);
  });

  it('rung 4: <home>/dist/objectstack.json is the last resort', () => {
    const homeArtifact = write(home, 'dist/objectstack.json');
    expect(resolveArtifactSource(undefined, home, { cwd, env: {} })?.path).toBe(homeArtifact);
  });

  it('rung 5: nothing reachable resolves to undefined', () => {
    expect(resolveArtifactSource(undefined, home, { cwd, env: {} })).toBeUndefined();
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
