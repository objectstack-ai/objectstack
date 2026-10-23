// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os init` and `os create` (standalone) pin every `@objectstack/*` dependency
 * of the project they emit to the CLI's own version, EXACTLY — no `^`, no `~`.
 * On the v18 line a breaking change may ship in a minor or a patch, and the
 * docs tell a project to pin exact versions; a caret would let the next
 * re-resolve move a fresh project across such a release unasked.
 *
 * `init.test.ts` and `create.test.ts` pin that against the version this
 * checkout carries. This file pins the shape the NEXT version pass produces
 * and no other test sees until it lands: a `cut-rc` pass in pre mode makes
 * the CLI `X.Y.Z-rc.N`, and that whole string — prerelease tail included — is
 * the pin. The CLI reads its version from its own `package.json` once and
 * caches it, so this file first imports the commands under a planted manifest read.
 * The in-repo placement is the control: it keeps `workspace:*`.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_MANIFEST = path.resolve(HERE, '..', 'package.json');
const PRERELEASE = '18.1.0-rc.2';

/** Every `@objectstack/*` entry of a manifest, both dependency sections. */
function objectstackDeps(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): [string, string][] {
  return Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).filter(
    ([name]) => name.startsWith('@objectstack/'),
  );
}

// The first import of the command modules happens HERE, under the planted
// manifest read, at collection time: each test file gets its own module
// registry, so no reset is needed, and module evaluation is not charged to a
// hook's timeout.
const realRead = fs.readFileSync;
const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((file: unknown, ...rest: unknown[]) =>
  typeof file === 'string' && path.resolve(file) === CLI_MANIFEST
    ? JSON.stringify({ name: '@objectstack/cli', version: PRERELEASE })
    : (realRead as (...args: unknown[]) => unknown)(file, ...rest)) as typeof fs.readFileSync);
let init: typeof import('../src/commands/init.js');
let create: typeof import('../src/commands/create.js');
let plantedVersion: string;
try {
  init = await import('../src/commands/init.js');
  create = await import('../src/commands/create.js');
  // Read while the planted manifest is in place; the value is cached after.
  plantedVersion = init.getCliVersion();
} finally {
  spy.mockRestore();
}

describe('a prerelease CLI pins scaffolded @objectstack/* deps exactly', () => {
  // Harness guard: without it, a manifest read that escaped the spy would
  // measure the checkout's own release version and prove nothing about tails.
  it('reads the planted prerelease as the CLI version', () => {
    expect(plantedVersion).toBe(PRERELEASE);
  });

  it('os init: every template, every @objectstack/* dep', () => {
    const keys = Object.keys(init.TEMPLATES);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const deps = objectstackDeps(init.TEMPLATES[key]);
      expect(deps.length, key).toBeGreaterThan(0);
      for (const [name, spec] of deps) expect(spec, `${key}: ${name}`).toBe(PRERELEASE);
    }
  });

  it('os create (standalone): every template, every @objectstack/* dep', () => {
    expect(create.objectstackDependencySpec('standalone')).toBe(PRERELEASE);
    const keys = Object.keys(create.templates);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const pkg = create.templates[key].filesFor('standalone')['package.json']('my-thing') as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = objectstackDeps(pkg);
      expect(deps.length, key).toBeGreaterThan(0);
      for (const [name, spec] of deps) expect(spec, `${key}: ${name}`).toBe(PRERELEASE);
    }
  });

  it('os create --in-repo keeps workspace:* (the control)', () => {
    expect(create.objectstackDependencySpec('in-repo')).toBe('workspace:*');
    for (const key of Object.keys(create.templates)) {
      const pkg = create.templates[key].filesFor('in-repo')['package.json']('my-thing') as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const [name, spec] of objectstackDeps(pkg)) {
        expect(spec, `${key}: ${name}`).toBe('workspace:*');
      }
    }
  });
});
