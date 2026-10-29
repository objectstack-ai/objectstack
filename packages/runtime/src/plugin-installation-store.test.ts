// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `plugin-installation-store` (ADR-0025 §3.5 steps 5–6, M1): where a plugin
 * version is materialized, and the record of what was installed.
 *
 * Pinned: an id or version that is not one safe path segment never names a
 * directory; the record round-trips and an update swaps the version for its
 * id; the file is keyed by project as well as environment, the sibling
 * disable-state store's rule; and a record file that cannot be read is
 * refused, never rewritten from empty.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  loadPluginInstallations,
  pluginInstallDir,
  pluginInstallationsFile,
  pluginsHome,
  recordPluginInstallation,
  type PluginInstallationRecord,
} from './plugin-installation-store.js';
import { packageStateFileName } from './package-state-store.js';

let home: string;
const saved = { OS_HOME: process.env.OS_HOME };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'os-plugin-installs-'));
  process.env.OS_HOME = home;
});

afterEach(() => {
  if (saved.OS_HOME === undefined) delete process.env.OS_HOME;
  else process.env.OS_HOME = saved.OS_HOME;
  rmSync(home, { recursive: true, force: true });
});

function record(id: string, version: string): PluginInstallationRecord {
  return {
    id,
    version,
    versionId: `${id}@${version}`,
    runtime: 'node',
    status: 'installed',
    grantedPermissions: null,
    dir: pluginInstallDir('env_local', id, version),
    artifact: { file: 'artifact.osplugin', sha256: '0'.repeat(64) },
    signatureFile: 'artifact.osplugin.sig',
    signature: { keyId: 'acme', fingerprint: `sha256:${'a'.repeat(64)}` },
    trustUnsigned: false,
    installedAt: '2026-10-28T00:00:00.000Z',
  };
}

describe('pluginInstallDir', () => {
  it('is <OS_HOME>/plugins/<env>/<id>/<version>', () => {
    expect(pluginInstallDir('env_local', 'com.acme.stripe', '1.2.0'))
      .toBe(join(home, 'plugins', 'env_local', 'com.acme.stripe', '1.2.0'));
    expect(pluginsHome(undefined)).toBe(join(home, 'plugins', 'env_local'));
  });

  it.each([
    ['id', '../escape', '1.0.0'],
    ['id', 'com/acme', '1.0.0'],
    ['id', '', '1.0.0'],
    ['version', 'com.acme', '..'],
    ['version', 'com.acme', '1.0.0/../../x'],
    ['version', 'com.acme', '.hidden'],
  ])('refuses a %s that is not one safe path segment (%s @ %s)', (_what, id, version) => {
    expect(() => pluginInstallDir('env_local', id, version)).toThrow(/cannot name an install directory/);
  });
});

describe('the installation record', () => {
  it('round-trips, and a second version of one id replaces the first', () => {
    expect(loadPluginInstallations('env_local')).toEqual([]);
    recordPluginInstallation('env_local', record('com.acme.a', '1.0.0'));
    recordPluginInstallation('env_local', record('com.acme.b', '1.0.0'));
    recordPluginInstallation('env_local', record('com.acme.a', '1.1.0'));
    const installs = loadPluginInstallations('env_local');
    expect(installs.map((r) => r.versionId)).toEqual(['com.acme.a@1.1.0', 'com.acme.b@1.0.0']);
    expect(installs[0].signature).toEqual({ keyId: 'acme', fingerprint: `sha256:${'a'.repeat(64)}` });
  });

  it('is keyed by environment AND project, by the disable-state store\'s own file-name rule', () => {
    const file = pluginInstallationsFile('env_local');
    expect(basename(file)).toBe(packageStateFileName('env_local', process.cwd()));
    expect(dirname(file)).toBe(join(home, 'plugin-installations'));
    recordPluginInstallation('env_local', record('com.acme.a', '1.0.0'));
    // Another environment on the same host and project sees nothing.
    expect(loadPluginInstallations('env_staging')).toEqual([]);
  });

  it('refuses a file it cannot read, and never rewrites it from empty', () => {
    const file = pluginInstallationsFile('env_local');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ not json', 'utf8');
    expect(() => loadPluginInstallations('env_local')).toThrow(/not valid JSON/);
    expect(() => recordPluginInstallation('env_local', record('com.acme.a', '1.0.0'))).toThrow(/not valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
    writeFileSync(file, '{"other": []}', 'utf8');
    expect(() => loadPluginInstallations('env_local')).toThrow(/no "installations" array/);
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});
