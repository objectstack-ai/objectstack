// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Drift ratchets for the scaffolder's user-facing surfaces. Both of these
// rotted silently once before (#2899 follow-up): the bundled template pinned
// `^6.0.0` while the registry was publishing 14.x, and the README advertised
// a template set (`minimal-api`/`full-stack`/`plugin`) that never shipped.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncObjectStackDeps } from './pkg-utils.js';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
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

describe('blank template manifest engines.protocol (ADR-0087 D1)', () => {
  it('stamps the current protocol major so the handshake covers fresh scaffolds', () => {
    const config = fs.readFileSync(
      path.join(pkgRoot, 'src', 'templates', 'blank', 'objectstack.config.ts'),
      'utf8',
    );
    const match = /engines:\s*\{\s*protocol:\s*'\^(\d+)'\s*\}/.exec(config);
    expect(match, 'template manifest must stamp engines.protocol (ADR-0087 D1)').not.toBeNull();
    expect(
      Number(match![1]),
      `template stamps engines.protocol '^${match![1]}' but create-objectstack is v${ownMajor} — ` +
        'scripts/sync-template-versions.mjs re-stamps this at version time; keep them in lockstep',
    ).toBe(ownMajor);
  });
});

// pnpm 11 turned an unapproved dependency build script from a warning into a
// hard error, so the template declaring nothing meant `npx create-objectstack`
// + `pnpm install` exited 1 for every user on a current pnpm (#3110). Both keys
// are load-bearing and read by different pnpm versions: pnpm 11 honours only
// `allowBuilds`, while pnpm 10.0–10.30 understand only `onlyBuiltDependencies`.
describe('blank template pnpm build approvals (#3110)', () => {
  const wsPath = path.join(pkgRoot, 'src', 'templates', 'blank', 'pnpm-workspace.yaml');
  const APPROVED = ['better-sqlite3', 'esbuild'];
  // Strip comments: the prose below explains these keys and must not satisfy
  // an assertion that the settings themselves are supposed to satisfy.
  const settings = fs.existsSync(wsPath)
    ? fs.readFileSync(wsPath, 'utf8').replace(/^\s*#.*$/gm, '')
    : '';

  it('ships a pnpm-workspace.yaml', () => {
    expect(
      fs.existsSync(wsPath),
      'without it a fresh `pnpm install` exits 1 on pnpm 11 (ERR_PNPM_IGNORED_BUILDS)',
    ).toBe(true);
  });

  it('sets allowBuilds.<pkg> = true, the only key pnpm 11 reads', () => {
    const block = /^allowBuilds:\n((?:[ \t]+.*\n?)*)/m.exec(settings)?.[1] ?? '';
    for (const pkg of APPROVED) {
      expect(
        new RegExp(`^\\s+${pkg}:\\s*true\\s*$`, 'm').test(block),
        `allowBuilds must set "${pkg}: true" — pnpm 11 errors on an unapproved build ` +
          'and ignores onlyBuiltDependencies',
      ).toBe(true);
    }
  });

  it('lists the same packages under onlyBuiltDependencies for pnpm 10.0–10.30', () => {
    const block = /^onlyBuiltDependencies:\n((?:[ \t]*-.*\n?)*)/m.exec(settings)?.[1] ?? '';
    for (const pkg of APPROVED) {
      expect(
        new RegExp(`^\\s*-\\s*${pkg}\\s*$`, 'm').test(block),
        `onlyBuiltDependencies must list "${pkg}" — pnpm < 10.31 does not understand allowBuilds`,
      ).toBe(true);
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

// Skills catalog boundary (15.1 third-party eval): scaffolded projects once
// received the repo-internal `dogfood-verification` skill because the
// scaffolder installed with a repo-wide `skills add … --all`, whose discovery
// also walks `.claude/skills/`. The published catalog is exactly the root
// `skills/` directory; everything else must stay repo-internal.
describe('skills catalog boundary', () => {
  const frontmatterOf = (file: string): string =>
    /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? '';
  const isMarkedInternal = (fm: string): boolean =>
    /^metadata:\s*$/m.test(fm) && /^ +internal:\s*true\s*(#.*)?$/m.test(fm);

  const trackedSkillFiles = execFileSync('git', ['ls-files', '*SKILL.md'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  it('finds the curated skills/ catalog (sanity)', () => {
    expect(
      trackedSkillFiles.filter((f) => f.startsWith('skills/')).length,
    ).toBeGreaterThan(0);
  });

  it('marks every SKILL.md outside skills/ as metadata.internal', () => {
    for (const rel of trackedSkillFiles) {
      if (rel.startsWith('skills/')) continue;
      expect(
        isMarkedInternal(frontmatterOf(path.join(repoRoot, rel))),
        `${rel} is outside the published skills/ catalog but is not hidden from ` +
          'the skills CLI. Add to its frontmatter:\n' +
          'metadata:\n  internal: true\n' +
          'or move it into skills/ if it is meant for customers.',
      ).toBe(true);
    }
  });

  it('never marks a curated skills/ entry internal', () => {
    for (const rel of trackedSkillFiles) {
      if (!rel.startsWith('skills/')) continue;
      expect(
        isMarkedInternal(frontmatterOf(path.join(repoRoot, rel))),
        `${rel} is in the published catalog but marked metadata.internal — ` +
          'customers would silently stop receiving it.',
      ).toBe(false);
    }
  });

  it('scaffolder installs from the curated skills/ subpath, not the repo root', () => {
    expect(REGISTRY_SOURCE).toContain(
      'skills add objectstack-ai/framework/skills --all',
    );
    expect(REGISTRY_SOURCE).not.toMatch(
      /skills add objectstack-ai\/framework(?!\/skills)/,
    );
  });

  // The /skills subpath is the hard boundary: the skills CLI's `--all`
  // implies `--skill '*'`, which INCLUDES metadata.internal skills — so any
  // customer-facing surface advertising a repo-root install would leak
  // internal skills again.
  it('no customer-facing surface advertises a repo-root skills install', () => {
    const surfaces = [
      'content/docs',
      'skills',
      'packages/create-objectstack',
      // this file mentions the bare form on purpose (needle + error message)
      ':(exclude)packages/create-objectstack/src/template-consistency.test.ts',
    ];
    let candidates = '';
    try {
      candidates = execFileSync(
        'git',
        ['grep', '-nF', 'skills add objectstack-ai/framework', '--', ...surfaces],
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch {
      // git grep exits 1 on no matches — nothing to check then.
    }
    const rootInstalls = candidates
      .split('\n')
      .filter((line) => /skills add objectstack-ai\/framework(?!\/skills)/.test(line));
    expect(
      rootInstalls,
      'these lines advertise `skills add objectstack-ai/framework` without ' +
        'the /skills subpath — repo-root + --all installs internal skills',
    ).toEqual([]);
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
