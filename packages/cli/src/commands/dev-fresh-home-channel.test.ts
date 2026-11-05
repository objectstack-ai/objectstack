// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FRESH_HOME_CHANNEL_ENV as CONSUMER_SPELLING } from '@objectstack/cloud-connection';
import { applyFreshHomeChannel, FRESH_HOME_CHANNEL_ENV } from './dev.js';

/**
 * #30217 — `os dev --fresh` tells its `serve` child which `OS_HOME` is the
 * run's ephemeral one, so the install ledger there adopts nothing from the
 * project's working-directory ledger and the run starts without an earlier
 * run's installs. The parent owns the variable: without `--fresh` it is
 * removed, so an inherited copy never speaks for this run.
 */
describe('#30217 `os dev` owns the fresh-home channel on its serve child', () => {
  it('is spelled exactly as @objectstack/cloud-connection reads it', () => {
    expect(FRESH_HOME_CHANNEL_ENV).toBe(CONSUMER_SPELLING);
  });

  it('names the ephemeral home under --fresh', () => {
    const env: NodeJS.ProcessEnv = { OS_HOME: '/tmp/objectstack-dev-abc' };
    applyFreshHomeChannel(env, '/tmp/objectstack-dev-abc');
    expect(env[FRESH_HOME_CHANNEL_ENV]).toBe('/tmp/objectstack-dev-abc');
  });

  it('removes an inherited copy when the run is not --fresh', () => {
    const env: NodeJS.ProcessEnv = { [FRESH_HOME_CHANNEL_ENV]: '/tmp/objectstack-dev-old' };
    applyFreshHomeChannel(env, undefined);
    expect(FRESH_HOME_CHANNEL_ENV in env).toBe(false);
  });
});
