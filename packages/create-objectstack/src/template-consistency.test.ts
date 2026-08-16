// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Drift ratchets for the scaffolder's user-facing surfaces. Both of these
// rotted silently once before (#2899 follow-up): the bundled template pinned
// `^6.0.0` while the registry was publishing 14.x, and the README advertised
// a template set (`minimal-api`/`full-stack`/`plugin`) that never shipped.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncObjectStackDeps } from './pkg-utils.js';
import { copyDir, TEMPLATE_FILE_ALIASES } from './template-copy.js';
import { TEMPLATES } from './template-registry.js';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const ownPkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const ownMajor = Number(ownPkg.version.split('.')[0]);

// The catalog is imported, not text-parsed: it lives in template-registry.ts
// precisely so tests can read it directly (importing index.ts would run the
// CLI — it calls program.parse() at module scope). index.ts is still read as
// text below, for assertions about the scaffolder's *commands*.
const registryTemplates = Object.keys(TEMPLATES);
const REGISTRY_SOURCE = fs.readFileSync(path.join(pkgRoot, 'src', 'index.ts'), 'utf8');

// ── #9109 — the git reads below cannot be redirected off this checkout ───────
//
// The skills-catalog block asks git two questions whose answers ARE its verdict:
// `ls-files *SKILL.md` (which skill files exist) and `git grep` (which surfaces
// advertise a repo-root install). Both were spawned with `cwd: repoRoot` and
// nothing else, so they inherited every `GIT_*` variable in the environment —
// and `GIT_DIR`, `GIT_INDEX_FILE` or `GIT_OBJECT_DIRECTORY` pointing elsewhere
// makes git answer for a DIFFERENT repository while the `cwd` still reads as
// this one. That is the #9068 exposure class: not a flake, a test that silently
// measures another repository. A leaked `GIT_CEILING_DIRECTORIES` covering
// `repoRoot` is the other direction — git then refuses to find this repo at all.
//
// Scrubbing those pointers is the whole fix here, and it is deliberately where
// this file stops. Unlike the fixture harnesses this pattern comes from, these
// two commands read the REAL checkout rather than a repo the test just created:
//
//   * no `[gc]` hardening, because there is no fixture repo to write config
//     into, and this file must not touch the developer's own repository config;
//   * the global/system config is left OPEN on purpose. `GIT_CONFIG_GLOBAL=/dev/null`
//     is right for a fixture the test owns, but here it would also discard
//     `safe.directory` — which is global config, and is exactly what lets git
//     read a checkout owned by another user inside a container. Closing it could
//     turn a passing read into `detected dubious ownership`, which is a
//     regression this file gets no isolation benefit in exchange for.
const LEAKED_GIT_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_TEMPLATE_DIR',
  'GIT_CONFIG',
] as const;

/** The environment the repo-reading git calls below get: this process's, minus
 *  every variable that could aim them at a different repository. */
const REPO_READ_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  for (const key of LEAKED_GIT_ENV) delete env[key];
  return env;
})();

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

// Packing ratchet (#3120): every template file must survive a real `npm pack`
// and land in a scaffold under its intended name. `.gitignore` did not — npm
// strips it from the tarball at every depth, so the file the build had
// faithfully copied to dist/templates/blank/ was dropped at publish and every
// scaffolded project came out with no `.gitignore`, leaving node_modules/ and
// the secret-bearing .env from the template README un-ignored for every user.
//
// This bug is invisible to source-level assertions: the file is present in
// src/templates/, present in a local build, and only vanishes at publish. So
// pack for real and scaffold from the extracted tarball with the real copyDir.
// Reading the repo's own dist/ instead would be doubly false green — turbo's
// `test` task only dependsOn `^build` (not its own build) and excludes dist/**
// from its inputs, so dist/ here is routinely absent or stale, and a pass on it
// would be cached.
describe('templates survive npm packing', () => {
  const templatesSrc = path.join(pkgRoot, 'src', 'templates');
  const blankSrc = path.join(templatesSrc, 'blank');

  const walkRel = (dir: string, rel = ''): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walkRel(path.join(dir, entry.name), relPath);
      return entry.isFile() ? [relPath] : [];
    });

  // The name a template file is expected to land under, i.e. its alias applied
  // to the basename.
  const scaffoldedAs = (rel: string): string => {
    const parts = rel.split('/');
    const base = parts[parts.length - 1];
    parts[parts.length - 1] = TEMPLATE_FILE_ALIASES.get(base) ?? base;
    return parts.join('/');
  };

  let tmp: string;
  let packed: string[];
  let scaffolded: string[];
  let collected: string[];

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-pack-'));

    // Stage exactly what a publish would: the *real* package.json (so the real
    // `files` allowlist decides what ships) plus src/templates copied to
    // dist/templates, which is what tsup.config.ts's onSuccess hook does. The
    // test asserts that mirror below rather than assuming it.
    fs.cpSync(path.join(pkgRoot, 'package.json'), path.join(tmp, 'package.json'));
    fs.cpSync(templatesSrc, path.join(tmp, 'dist', 'templates'), { recursive: true });

    execFileSync('npm', ['pack', '--ignore-scripts'], { cwd: tmp, stdio: 'pipe' });
    const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error(`npm pack produced no tarball in ${tmp}`);
    execFileSync('tar', ['xzf', tgz], { cwd: tmp });
    packed = walkRel(path.join(tmp, 'package', 'dist', 'templates'));

    // Scaffold from the *packed* template with the real copy logic.
    const out = path.join(tmp, 'scaffold');
    collected = [];
    copyDir(path.join(tmp, 'package', 'dist', 'templates', 'blank'), out, collected);
    scaffolded = walkRel(out);
  }, 120_000);

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('stages dist/templates the way this suite mirrors it', () => {
    const tsupConfig = fs.readFileSync(path.join(pkgRoot, 'tsup.config.ts'), 'utf8');
    expect(
      tsupConfig.replace(/\s+/g, ' '),
      'the packing ratchet stages dist/templates by hand because dist/ is not ' +
        'built here; if the build stopped copying src/templates → dist/templates ' +
        'that mirror is now a fiction — update both together',
    ).toContain("cpSync('src/templates', 'dist/templates', { recursive: true })");
  });

  // Covers every bundled template, not just blank: the tarball must carry
  // src/templates/** verbatim (aliases are a scaffold-time concern).
  it('carries every src/templates file into the tarball', () => {
    expect(
      packed.sort(),
      'a file under src/templates/ did not survive `npm pack`. npm strips ' +
        '.gitignore and .npmrc from tarballs at every depth — commit it under a ' +
        'placeholder name and map it back in TEMPLATE_FILE_ALIASES, the way ' +
        '_gitignore → .gitignore works.',
    ).toEqual(walkRel(templatesSrc).sort());
  });

  it('restores the aliased names when scaffolding', () => {
    const expected = walkRel(blankSrc).map(scaffoldedAs).sort();
    expect(scaffolded.sort()).toEqual(expected);
    // What the CLI prints as "Created files:" must match what it actually wrote.
    expect(collected.sort()).toEqual(expected);
  });

  // Not redundant with the file-set check above: that one applies the alias map
  // to both sides, so emptying TEMPLATE_FILE_ALIASES makes it agree with itself
  // on `_gitignore` and pass. Naming the destination literally is what pins the
  // mapping down.
  it('ships a .gitignore that ignores node_modules and the README secrets', () => {
    const gitignore = path.join(tmp, 'scaffold', '.gitignore');
    expect(fs.existsSync(gitignore), 'scaffold has no .gitignore').toBe(true);

    const rules = fs.readFileSync(gitignore, 'utf8').split('\n').map((l) => l.trim());
    expect(rules).toContain('node_modules');
    // The template README has users write OS_AUTH_SECRET / OS_SECRET_KEY into a
    // .env, and docker-compose.yml calls it "never committed" — so the ignore
    // file, not just the prose, has to enforce that.
    expect(rules).toContain('.env');
  });

  it('leaves a literal template dotfile that packs fine alone', () => {
    // .dockerignore is NOT stripped — verified against the published 15.1.1
    // tarball, which ships it while .gitignore is absent. It stays literal, so
    // the alias map covers only what is genuinely broken.
    expect(fs.existsSync(path.join(blankSrc, '.dockerignore'))).toBe(true);
    expect(TEMPLATE_FILE_ALIASES.has('.dockerignore')).toBe(false);
    expect(scaffolded).toContain('.dockerignore');
  });
});

// pnpm 11 turned an unapproved dependency build script from a warning into a
// hard error, so the template declaring nothing meant `npx create-objectstack`
// + `pnpm install` exited 1 for every user on a current pnpm (#3119). Both keys
// are load-bearing and read by different pnpm versions: pnpm 11 honours only
// `allowBuilds`, while pnpm 10.0–10.30 understand only `onlyBuiltDependencies`.
describe('blank template pnpm build approvals (#3119)', () => {
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
    env: REPO_READ_ENV,
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
      'skills add objectstack-ai/objectstack/skills --all',
    );
    expect(REGISTRY_SOURCE).not.toMatch(
      /skills add objectstack-ai\/objectstack(?!\/skills)/,
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
      // CHANGELOGs are auto-generated from changeset prose and legitimately
      // quote a removed command in past tense while documenting its removal
      // (#3101: "…advertised `skills add objectstack-ai/objectstack --all` … now
      // scoped to the /skills subpath"). Documenting a fix is not advertising
      // the anti-pattern — only real customer-facing surfaces count.
      ':(exclude)**/CHANGELOG.md',
    ];
    let candidates = '';
    try {
      candidates = execFileSync(
        'git',
        ['grep', '-nF', 'skills add objectstack-ai/objectstack', '--', ...surfaces],
        { cwd: repoRoot, encoding: 'utf8', env: REPO_READ_ENV },
      );
    } catch {
      // git grep exits 1 on no matches — nothing to check then.
    }
    const rootInstalls = candidates
      .split('\n')
      .filter((line) => /skills add objectstack-ai\/objectstack(?!\/skills)/.test(line));
    expect(
      rootInstalls,
      'these lines advertise `skills add objectstack-ai/objectstack` without ' +
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
