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
  // Strip comments first — both files discuss OS_ARTIFACT_PATH at length, and
  // the prose is exactly what this assertion must NOT read.
  const codeOf = (file: string): string => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => (line.trim().startsWith('//') ? '' : line.replace(/\/\/.*$/, '')))
      .join('\n');
  };

  for (const file of ['start.ts', 'dev.ts']) {
    it(`${file} contains no OS_ARTIFACT_PATH assignment`, () => {
      const offenders = codeOf(file)
        .split('\n')
        .filter((line) => /OS_ARTIFACT_PATH\s*[:=]/.test(line));
      expect(
        offenders,
        `${file} must not write OS_ARTIFACT_PATH into a child environment — the CLI's own `
        + `resolved artifact travels on ${INTERNAL_ARTIFACT_PATH_ENV}, so that a downstream `
        + `objectstack.config.ts seeing OS_ARTIFACT_PATH knows an operator set it. `
        + `Reading process.env.OS_ARTIFACT_PATH (the operator's value) stays correct.`,
      ).toEqual([]);
    });
  }
});
