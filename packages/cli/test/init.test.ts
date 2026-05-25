// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { TEMPLATES, getCliVersion, detectPackageManager, sanitizeNamespace } from '../src/commands/init';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
);

describe('init command — published scaffold', () => {
  it('resolves the CLI version from its own package.json', () => {
    expect(getCliVersion()).toBe(pkg.version);
  });

  describe.each(Object.keys(TEMPLATES))('template "%s"', (key) => {
    const t = TEMPLATES[key];
    const allDeps = { ...t.dependencies, ...t.devDependencies };

    it('does not emit `workspace:` specifiers (would break outside the monorepo)', () => {
      for (const [name, range] of Object.entries(allDeps)) {
        expect(range, `${name} must not use workspace protocol`).not.toMatch(/^workspace:/);
      }
    });

    it('pins every @objectstack/* dep to the CLI version', () => {
      const expected = `^${pkg.version}`;
      for (const [name, range] of Object.entries(allDeps)) {
        if (name.startsWith('@objectstack/')) {
          expect(range, name).toBe(expected);
        }
      }
    });

    it('includes @objectstack/cli so package.json scripts can run', () => {
      // Every template's scripts invoke the `objectstack` binary, which is
      // provided by @objectstack/cli — the bug report showed `pnpm dev`
      // failing with `objectstack: command not found` because cli was
      // missing from devDependencies.
      const callsObjectstack = Object.values(t.scripts).some((s) =>
        s.split(/\s+/).includes('objectstack'),
      );
      if (callsObjectstack) {
        expect(allDeps['@objectstack/cli']).toBeDefined();
      }
    });
  });
});

describe('sanitizeNamespace', () => {
  const NS_RE = /^[a-z][a-z0-9_]{1,19}$/;

  it.each([
    ['my-app', 'my_app'],
    ['@acme/my-app', 'my_app'],
    ['MyApp', 'myapp'],
    ['hello.world', 'hello_world'],
    ['a', 'a_app'],
  ])('sanitizes %s → %s', (input, expected) => {
    expect(sanitizeNamespace(input)).toBe(expected);
  });

  it('prefixes a leading digit so identifier starts with a letter', () => {
    const out = sanitizeNamespace('123app');
    expect(out).toMatch(NS_RE);
    expect(out.startsWith('a')).toBe(true);
  });

  it('avoids reserved namespaces', () => {
    expect(sanitizeNamespace('sys')).toBe('sys_app');
    expect(sanitizeNamespace('base')).toBe('base_app');
    expect(sanitizeNamespace('system')).toBe('system_app');
  });

  it('always produces a value matching the manifest namespace regex', () => {
    for (const input of ['my-app', '@acme/my-app', '123app', 'sys', 'a', 'A__B', 'really-long-name-truncated-here']) {
      expect(sanitizeNamespace(input)).toMatch(NS_RE);
    }
  });
});

describe('scaffold rendering — round-trip', () => {
  // Re-implement the file-resolution logic from init.ts so we can verify
  // rendered output without spawning a child CLI process.
  function renderTemplate(templateKey: keyof typeof TEMPLATES, projectName: string) {
    const t = TEMPLATES[templateKey];
    const namespace = sanitizeNamespace(projectName);
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'os-init-'));
    fs.writeFileSync(
      path.join(tmpRoot, 'objectstack.config.ts'),
      t.configContent(projectName, namespace),
    );
    const written: string[] = ['objectstack.config.ts'];
    for (const [filePath, contentFn] of Object.entries(t.srcFiles)) {
      const resolvedPath = filePath.replace(/__name__/g, namespace);
      const fullPath = path.join(tmpRoot, resolvedPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, contentFn(projectName, namespace));
      written.push(resolvedPath);
    }
    return { tmpRoot, namespace, written };
  }

  it('renders kebab project name into snake_case file paths and identifiers (app template)', () => {
    const { tmpRoot, namespace, written } = renderTemplate('app', 'my-app');
    expect(namespace).toBe('my_app');
    // No file should contain a hyphen in its path segments.
    for (const rel of written) {
      expect(rel).not.toMatch(/-/);
    }
    // Object file is namespace-prefixed.
    const objFile = path.join(tmpRoot, 'src', 'objects', 'my_app_item.ts');
    expect(fs.existsSync(objFile)).toBe(true);
    const objSrc = fs.readFileSync(objFile, 'utf8');
    // Rendered object name must satisfy `${namespace}_${shortName}`.
    expect(objSrc).toMatch(/name: 'my_app_item'/);
    // Index re-exports the canonical identifier.
    const indexSrc = fs.readFileSync(path.join(tmpRoot, 'src', 'objects', 'index.ts'), 'utf8');
    expect(indexSrc).toMatch(/from '\.\/my_app_item'/);
    expect(indexSrc).toMatch(/myAppItem/);
    // Rendered config embeds the sanitized namespace.
    const cfg = fs.readFileSync(path.join(tmpRoot, 'objectstack.config.ts'), 'utf8');
    expect(cfg).toMatch(/namespace: 'my_app'/);
    expect(namespace).toMatch(/^[a-z][a-z0-9_]{1,19}$/);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('renders namespace identifiers identically for plugin and empty templates', () => {
    for (const key of ['plugin', 'empty'] as const) {
      const { tmpRoot, namespace } = renderTemplate(key, 'my-app');
      expect(namespace).toBe('my_app');
      const cfg = fs.readFileSync(path.join(tmpRoot, 'objectstack.config.ts'), 'utf8');
      expect(cfg).toMatch(/namespace: 'my_app'/);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('detectPackageManager', () => {
  it('detects pnpm from npm_config_user_agent', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'pnpm/10.31.0 npm/? node/v22.0.0 linux x64' })).toBe('pnpm');
  });
  it('detects yarn', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'yarn/4.0.0 npm/? node/v22.0.0 linux x64' })).toBe('yarn');
  });
  it('detects bun', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'bun/1.1.0 node/v22.0.0 linux x64' })).toBe('bun');
  });
  it('defaults to npm when user agent is missing (e.g. npx)', () => {
    expect(detectPackageManager({})).toBe('npm');
  });
  it('defaults to npm for npm itself', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'npm/10.0.0 node/v22.0.0 linux x64' })).toBe('npm');
  });
});
