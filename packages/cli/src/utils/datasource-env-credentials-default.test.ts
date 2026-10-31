// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27687 — the CLI host turns the code-datasource env-credential switch on by
 * default; every other composition leaves it off. Two halves: the stamp keeps
 * an operator's explicit value, and `os serve` (which `os start` and `os dev`
 * run) stamps it before the datasource admin plugin is built, whose `init()`
 * reads the switch.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stampDatasourceEnvCredentialsDefault } from './datasource-env-credentials-default.js';

const SWITCH = 'OS_DATASOURCE_ENV_CREDENTIALS';

describe('stampDatasourceEnvCredentialsDefault', () => {
  it('stamps `on` when the switch is unset or empty', () => {
    for (const env of [{}, { [SWITCH]: '' }, { [SWITCH]: '  ' }] as Record<string, string | undefined>[]) {
      expect(stampDatasourceEnvCredentialsDefault(env, SWITCH)).toBe(true);
      expect(env[SWITCH]).toBe('on');
    }
  });

  it("keeps an operator's explicit value — `off`, `on`, and an invalid one the boot then refuses", () => {
    for (const value of ['off', 'OFF', 'on', 'true']) {
      const env: Record<string, string | undefined> = { [SWITCH]: value };
      expect(stampDatasourceEnvCredentialsDefault(env, SWITCH)).toBe(false);
      expect(env[SWITCH]).toBe(value);
    }
  });
});

describe('`os serve` stamps the default before the datasource admin plugin is built', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'serve.ts'), 'utf8');

  it('stamps once, into the process environment, under the name the admin module exports', () => {
    const calls = source.match(/stampDatasourceEnvCredentialsDefault\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(source).toContain(
      'stampDatasourceEnvCredentialsDefault(process.env, adminMod.DATASOURCE_ENV_CREDENTIALS_SWITCH);',
    );
  });

  it('the stamp precedes the plugin construction', () => {
    const stamp = source.indexOf('stampDatasourceEnvCredentialsDefault(process.env');
    const construct = source.indexOf('new DatasourceAdminServicePlugin(');
    expect(stamp).toBeGreaterThan(0);
    expect(construct).toBeGreaterThan(stamp);
  });
});
