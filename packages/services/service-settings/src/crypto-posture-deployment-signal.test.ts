// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11352 — crypto posture is selected from the DEPLOYMENT signal, never from a
 * test-RUNNER variable.
 *
 * ## What this pins, and why it is not the same as "which key was picked"
 *
 * `detectMode()` decides whether `LocalCryptoProvider`'s fail-loud guarantee is
 * ARMED. `'test'` is not a softer flavour of `'production'` — it is the branch
 * that takes an ephemeral key, never touches disk, and **never refuses to
 * boot**. The refusal IS the gate, so this file is graded on whether the
 * refusal is present, not on which key material a boot ended up with.
 *
 * Before this card, `detectMode` read:
 *
 *   if (env.VITEST || env.NODE_ENV === 'test') return 'test';
 *
 * `VITEST` describes the RUNNER, and a runner variable is inherited by every
 * process the runner spawns. A real `os serve` spawned from a vitest worker
 * with `{ ...process.env }` therefore booted with its crypto layer in `test`
 * mode — no stable key, no disk, no refusal — however production-shaped the
 * rest of that boot was.
 *
 * ## Why the environment here is a COPY of the real worker env
 *
 * A spawned child does not receive a hand-written fixture; it receives a copy
 * of its parent's `process.env`. So the map every case below starts from is
 * exactly that — `{ ...process.env }`, this vitest worker's own environment,
 * runner variables and all — with a single deliberate mutation per case. A
 * hand-written `{ VITEST: 'true' }` would pin the variable this file happens to
 * know about today; a copy pins whatever the runner actually exports.
 *
 * `carriesRunnerVariables` below is the anti-vacuity control: if the worker
 * stopped exporting runner variables altogether, every "a leaked runner
 * variable does not move posture" case would pass while measuring nothing, so
 * the file says so out loud instead.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { LocalCryptoProvider } from './local-crypto-provider.js';

/**
 * The runner-variable class, spelled the same way
 * `packages/cli/test/helpers/serve-process.ts` spells it: `TEST` exactly, plus
 * `VITEST` and anything `VITEST_`-prefixed. `JEST_WORKER_ID` rides along
 * because the class is "a variable that says a RUNNER is present", not "the
 * runner this repo uses today".
 */
const RUNNER_ENV_KEYS = [
  'TEST',
  'VITEST',
  'VITEST_WORKER_ID',
  'VITEST_POOL_ID',
  'VITEST_MODE',
  'JEST_WORKER_ID',
] as const;

type EnvMap = Record<string, string | undefined>;

/** This worker's REAL environment — what any child it spawned would inherit. */
const workerEnv = (): EnvMap => ({ ...process.env } as EnvMap);

/** Strip every key-bearing variable, so each case exercises the no-stable-key path. */
const withoutKeySources = (env: EnvMap): EnvMap => ({
  ...env,
  OS_SECRET_KEY: undefined,
  OS_DEV_CRYPTO_KEY: undefined,
  OBJECTSTACK_DEV_CRYPTO_KEY: undefined,
  OS_CRYPTO_AUTOKEY: undefined,
});

describe('#11352 — crypto posture reads the deployment signal, not the runner', () => {
  let home: string;
  let base: EnvMap;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-crypto-posture-'));
    // `OS_HOME` and `HOME` both pinned at an empty dir: no operator-provisioned
    // key file exists for any case, which is the state the refusal is about.
    base = withoutKeySources({ ...workerEnv(), HOME: home, OS_HOME: home });
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const keyFile = () => join(home, 'dev-crypto-key');

  it('is measuring something: this worker really does export runner variables', () => {
    const carriesRunnerVariables = RUNNER_ENV_KEYS.filter((k) => process.env[k] !== undefined);
    expect(
      carriesRunnerVariables.length,
      'no runner variable is present in this worker, so every leak case below would pass vacuously',
    ).toBeGreaterThan(0);
    // The specific one this card is about, and the one a spawned child inherits.
    expect(process.env.VITEST).toBeDefined();
  });

  it('in-process unit tests still get test posture — carried by NODE_ENV, not by VITEST', () => {
    // The half that must NOT move. vitest sets `NODE_ENV ??= 'test'` on the
    // same worker it sets `VITEST=true` on, so the documented in-process
    // intent survives the runner variable losing its vote.
    expect(process.env.NODE_ENV).toBe('test');

    const p = new LocalCryptoProvider({ env: base });
    expect(p.keySource).toBe('ephemeral');
    expect(existsSync(keyFile()), 'test posture must never touch disk').toBe(false);
  });

  it('a deployment in production posture REFUSES to boot without a stable key', () => {
    // THE CARD. Identical map to the case above — this worker's own env,
    // runner variables included — with the deployment signal set to what a real
    // `os serve` deployment carries. Before #11352 the inherited `VITEST=true`
    // won this decision and the boot SUCCEEDED on an ephemeral key.
    const env: EnvMap = { ...base, NODE_ENV: 'production' };
    expect(env.VITEST, 'the leak is still in the map — that is the point').toBeDefined();

    expect(() => new LocalCryptoProvider({ env })).toThrow(/Refusing to start in production/);
    expect(existsSync(keyFile()), 'a refused boot must not have minted a key').toBe(false);
  });

  it('still resolves a real production key when one IS provisioned', () => {
    // The refusal is a gate, not a wall: production posture with a stable key
    // boots, runner variables present or not.
    const hex = randomBytes(32).toString('hex');
    const p = new LocalCryptoProvider({ env: { ...base, NODE_ENV: 'production', OS_SECRET_KEY: hex } });
    expect(p.keySource).toBe('env:OS_SECRET_KEY');
  });

  describe('no runner variable moves the answer, in any deployment posture', () => {
    // A table rather than one case per variable: the defect class is "a runner
    // variable votes", so the pin has to be that NONE of them does, in EVERY
    // posture — including the postures where the wrong answer would look benign.
    const postures = [
      ['production', 'production'],
      ['development', 'development'],
      ['test', 'test'],
    ] as const;

    for (const [nodeEnv] of postures) {
      for (const runnerKey of RUNNER_ENV_KEYS) {
        it(`NODE_ENV=${nodeEnv} is unchanged by ${runnerKey}`, () => {
          const clean: EnvMap = { ...base, NODE_ENV: nodeEnv };
          for (const k of RUNNER_ENV_KEYS) clean[k] = undefined;
          const leaked: EnvMap = { ...clean, [runnerKey]: 'true' };

          expect(outcomeOf(leaked)).toBe(outcomeOf(clean));
        });
      }
    }

    /**
     * Collapse a construction to the only two things this gate is about:
     * did it REFUSE, and if it booted, from where did the key come.
     * A fresh temp home per call so one case's minted dev key is never the
     * next case's `source: 'file'`.
     */
    function outcomeOf(env: EnvMap): string {
      const scratch = mkdtempSync(join(tmpdir(), 'os-crypto-outcome-'));
      try {
        const p = new LocalCryptoProvider({ env: { ...env, HOME: scratch, OS_HOME: scratch } });
        return `booted:${p.keySource}`;
      } catch (err) {
        return `refused:${String((err as Error).message).split('\n')[0]}`;
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  });
});
