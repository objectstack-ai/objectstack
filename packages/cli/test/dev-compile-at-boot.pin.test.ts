// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#26130) — a bare `os dev` compiles the cwd config into the artifact it
 * serves before the server starts, so the served metadata and the config
 * module the `serve` child evaluates are one environment's answer.
 *
 * A PARSE-AND-DECIDE fact, the same instrument `dev-no-watch.pin.test.ts` uses:
 * oclif's own parser over the command's real declarations, fed into the one
 * decision the boot reads (`devCompilesAtBoot`). What the decision buys at the
 * public door (`/api/v1/meta/connector/NAME` agreeing with the materialized
 * connector on an `OS_PORT` boot) is measured on a real `os dev` boot in
 * `dev-connector-env-parity.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Parser } from '@oclif/core';
import Dev, { devCompilesAtBoot } from '../src/commands/dev.js';

const parseDev = (argv: string[]) =>
  Parser.parse(argv, { flags: Dev.flags, args: Dev.args, strict: true });

/** The decision for a cwd holding a config and an already-built artifact, from parsed argv. */
async function overBuiltArtifact(argv: string[]): Promise<boolean> {
  const { flags } = await parseDev(argv);
  return devCompilesAtBoot({
    compile: flags.compile,
    pinned: Boolean(flags.artifact),
    configExists: true,
    artifactExists: true,
  });
}

describe('`os dev` compiles before it boots (#26130)', () => {
  it('bare `os dev` over an already-built artifact compiles it again', async () => {
    expect(await overBuiltArtifact([])).toBe(true);
  });

  it('`--no-compile` boots the built artifact as it is', async () => {
    expect(await overBuiltArtifact(['--no-compile'])).toBe(false);
  });

  it('a pinned `--artifact` is never rebuilt, whatever `--compile` says', async () => {
    expect(await overBuiltArtifact(['--artifact', 'elsewhere/objectstack.json'])).toBe(false);
    expect(await overBuiltArtifact(['--artifact', 'elsewhere/objectstack.json', '--compile'])).toBe(false);
  });

  it('a missing artifact is compiled even under `--no-compile`', async () => {
    const { flags } = await parseDev(['--no-compile']);
    expect(devCompilesAtBoot({ compile: flags.compile, pinned: false, configExists: true, artifactExists: false })).toBe(true);
  });

  it('with no config, a built artifact boots as it is and a missing one reaches the refusal', async () => {
    const { flags } = await parseDev([]);
    expect(devCompilesAtBoot({ compile: flags.compile, pinned: false, configExists: false, artifactExists: true })).toBe(false);
    // `true` here is what routes the boot to the "nothing to start" refusal.
    expect(devCompilesAtBoot({ compile: flags.compile, pinned: false, configExists: false, artifactExists: false })).toBe(true);
  });
});
