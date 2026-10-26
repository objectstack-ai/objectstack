// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The hosted product reads "ObjectOS Cloud" wherever the CLI names it.
 *
 * ObjectOS is the product, in three editions (Community, Cloud, Enterprise);
 * ObjectStack is the protocol, SDK, CLI and framework. The strings a user
 * reads from the cloud commands — the command descriptions `--help` prints,
 * the flag descriptions, the "not logged in" prescriptions — name the hosted
 * product by its product name. Internal identifiers keep theirs:
 * `~/.objectstack/cloud.json`, `OS_CLOUD_API_KEY`, `os cloud login`.
 *
 * Pinned on the command classes' own statics rather than on a spawned
 * `--help`: it is the same text oclif prints, read without a process.
 */

import { describe, it, expect } from 'vitest';
import CloudLogin from '../src/commands/cloud/login.js';
import CloudLogout from '../src/commands/cloud/logout.js';
import CloudWhoami from '../src/commands/cloud/whoami.js';
import PackagePublish from '../src/commands/package/publish.js';
import PluginPublish from '../src/commands/plugin/publish.js';

const COMMANDS = [CloudLogin, CloudLogout, CloudWhoami, PackagePublish, PluginPublish] as const;

/** Every user-readable string a command's help carries: its description and its flags'. */
function helpStrings(command: (typeof COMMANDS)[number]): string[] {
  const flags = Object.values(command.flags ?? {}) as Array<{ description?: string }>;
  return [command.description ?? '', ...flags.map((flag) => flag.description ?? '')];
}

describe('cloud commands name the hosted product "ObjectOS Cloud"', () => {
  it('names it in the login, logout and whoami descriptions', () => {
    expect(CloudLogin.description).toContain('ObjectOS Cloud');
    expect(CloudLogout.description).toContain('ObjectOS Cloud');
    expect(CloudWhoami.description).toContain('ObjectOS Cloud');
  });

  it('names it in the control-plane URL and API-key flag descriptions', () => {
    expect(CloudLogin.flags.url.description).toContain('ObjectOS Cloud');
    expect(PackagePublish.flags.server.description).toContain('ObjectOS Cloud');
    expect(PackagePublish.flags.token.description).toContain('ObjectOS Cloud');
    expect(PackagePublish.flags.visibility.description).toContain('ObjectOS Cloud');
    expect(PluginPublish.description).toContain('ObjectOS Cloud');
    expect(PluginPublish.flags.visibility.description).toContain('ObjectOS Cloud');
  });

  it('carries no "ObjectStack Cloud" in any help string of those commands', () => {
    const stale = COMMANDS.flatMap((command) =>
      helpStrings(command)
        .filter((text) => text.includes('ObjectStack Cloud'))
        .map((text) => `${command.id ?? command.name}: ${text}`),
    );
    expect(stale).toEqual([]);
  });

  it('keeps the internal identifiers as they are', () => {
    expect(CloudLogin.description).toContain('~/.objectstack/cloud.json');
    expect(PackagePublish.flags.token.description).toContain('OS_CLOUD_API_KEY');
  });
});
