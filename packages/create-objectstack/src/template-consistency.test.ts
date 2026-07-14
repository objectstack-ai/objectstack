// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Drift ratchets for the scaffolder's user-facing surfaces. Both of these
// rotted silently once before (#2899 follow-up): the bundled template pinned
// `^6.0.0` while the registry was publishing 14.x, and the README advertised
// a template set (`minimal-api`/`full-stack`/`plugin`) that never shipped.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncObjectStackDeps } from './pkg-utils.js';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownPkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const ownMajor = Number(ownPkg.version.split('.')[0]);

// The TEMPLATES registry, read from src/index.ts as text — importing the
// module would run the CLI (it calls program.parse() on import). Parse only
// the lines between the TEMPLATES declaration and its closing brace.
const REGISTRY_SOURCE = fs.readFileSync(path.join(pkgRoot, 'src', 'index.ts'), 'utf8');
const registryBlock =
  /const TEMPLATES: Record<string, TemplateInfo> = \{([\s\S]*?)\n\};/.exec(
    REGISTRY_SOURCE,
  )?.[1] ?? '';
const registryTemplates = [...registryBlock.matchAll(/^  ([a-z][a-z0-9_]*): \{$/gm)].map(
  (m) => m[1],
);

describe('blank template package.json', () => {
  const templatePkg = JSON.parse(
    fs.readFileSync(
      path.join(pkgRoot, 'src', 'templates', 'blank', 'package.json'),
      'utf8',
    ),
  );

  it('pins every @objectstack/* dep to the current major', () => {
    const allDeps = { ...templatePkg.dependencies, ...templatePkg.devDependencies };
    const stackDeps = Object.entries(allDeps).filter(([name]) =>
      name.startsWith('@objectstack/'),
    );
    expect(stackDeps.length).toBeGreaterThan(0);
    for (const [name, range] of stackDeps) {
      const match = /^\^(\d+)\./.exec(String(range));
      expect(match, `${name} range "${range}" must be ^<major>.x`).not.toBeNull();
      expect(
        Number(match![1]),
        `${name} pins ^${match![1]}.x but create-objectstack is v${ownMajor} — ` +
          'bump the template with the release (scaffold-time sync only fixes ' +
          'generated projects, not this committed baseline)',
      ).toBe(ownMajor);
    }
  });
});

describe('README template table', () => {
  it('lists exactly the templates in the TEMPLATES registry', () => {
    const readme = fs.readFileSync(path.join(pkgRoot, 'README.md'), 'utf8');
    // Table rows under "## Templates": | `name` ... | source | description |
    const section = readme.split(/^## Templates$/m)[1]?.split(/^## /m)[0] ?? '';
    const documented = [...section.matchAll(/^\| `([a-z][a-z0-9_-]*)`/gm)].map(
      (m) => m[1],
    );
    expect(documented.sort()).toEqual([...registryTemplates].sort());
  });
});

describe('syncObjectStackDeps', () => {
  it('rewrites @objectstack/* ranges in deps and devDeps', () => {
    const pkg = {
      dependencies: { '@objectstack/spec': '^6.0.0', chalk: '^5.0.0' },
      devDependencies: { '@objectstack/cli': '^6.0.0', typescript: '^6.0.0' },
    };
    syncObjectStackDeps(pkg, '14.7.0');
    expect(pkg.dependencies['@objectstack/spec']).toBe('^14.7.0');
    expect(pkg.devDependencies['@objectstack/cli']).toBe('^14.7.0');
    expect(pkg.dependencies.chalk).toBe('^5.0.0');
    expect(pkg.devDependencies.typescript).toBe('^6.0.0');
  });

  it('is a no-op on the 0.0.0 fallback version', () => {
    const pkg = { dependencies: { '@objectstack/spec': '^6.0.0' } };
    syncObjectStackDeps(pkg, '0.0.0');
    expect(pkg.dependencies['@objectstack/spec']).toBe('^6.0.0');
  });
});
