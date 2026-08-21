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

// ── Declared version surfaces, per bundled template (#9264) ─────────────────
//
// Every bundled template declares the platform it targets in THREE places, and
// each one is committed to git, shipped in the tarball and copied into every
// scaffolded project. `scripts/sync-template-versions.mjs` re-stamps all three
// at version time; these ratchets are the CI half, because that script runs on
// a changesets/action release PR that gets no CI at all.
//
// The template list is DISCOVERED, not written down — the same directory walk
// the sync script and `check-template-manifests.ts` both use. A hand-kept list
// is precisely what failed here: coverage of one key in one file is how
// `specVersion` sat at `^6.0.0` while `engines.protocol` tracked every major up
// to `^17`, eleven majors of drift behind a green sync run.
const TEMPLATES_DIR = path.join(pkgRoot, 'src', 'templates');
const bundledTemplates = fs
  .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist')
  .map((e) => e.name)
  .sort();

describe('bundled template declared version surfaces', () => {
  // Vacuous-green guard: describe.each over an empty list is a silent pass, and
  // "the templates directory moved" must not read as "every template is clean".
  it('discovers at least one bundled template', () => {
    expect(
      bundledTemplates.length,
      `no template directories under ${path.relative(pkgRoot, TEMPLATES_DIR)} — ` +
        'the per-template ratchets below would all pass vacuously',
    ).toBeGreaterThan(0);
  });

  describe.each(bundledTemplates)('%s', (template) => {
    const templateDir = path.join(TEMPLATES_DIR, template);
    const readTemplateFile = (name: string) =>
      fs.readFileSync(path.join(templateDir, name), 'utf8');

    it('package.json pins every @objectstack/* dep to the current major', () => {
      const templatePkg = JSON.parse(readTemplateFile('package.json'));
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

    // NOTE the file: this stamp lives in `objectstack.config.ts`, inside the
    // `defineStack({ manifest: … })` literal. It is NOT in
    // `objectstack.manifest.json` — the two were conflated in this suite's own
    // naming and in the sync script's log strings, and that conflation is part
    // of how the sibling key below went unwatched for eleven majors.
    it("objectstack.config.ts stamps engines.protocol at the scaffolder's major (ADR-0087 D1)", () => {
      const config = readTemplateFile('objectstack.config.ts');
      const match = /engines:\s*\{\s*protocol:\s*'\^(\d+)'\s*\}/.exec(config);
      expect(
        match,
        `${template}/objectstack.config.ts must stamp engines.protocol (ADR-0087 D1)`,
      ).not.toBeNull();
      expect(
        Number(match![1]),
        `${template} stamps engines.protocol '^${match![1]}' but create-objectstack is v${ownMajor} — ` +
          'scripts/sync-template-versions.mjs re-stamps this at version time; keep them in lockstep',
      ).toBe(ownMajor);
    });

    // The key #9264 is about. Required by TemplateManifestSchema, read by the
    // template registry, and copied verbatim into every scaffolded project —
    // `create-objectstack` rewrites name/displayName/namespace and drops
    // description, and has never touched this one.
    it('objectstack.manifest.json declares specVersion at the current @objectstack/spec range', () => {
      const manifest = JSON.parse(readTemplateFile('objectstack.manifest.json'));
      expect(
        typeof manifest.specVersion,
        `${template}/objectstack.manifest.json must declare specVersion — it is REQUIRED by ` +
          'TemplateManifestSchema (packages/spec/src/cloud/template-manifest.zod.ts)',
      ).toBe('string');

      const match = /^\^(\d+)\.\d+\.\d+$/.exec(manifest.specVersion);
      expect(
        match,
        `specVersion "${manifest.specVersion}" must be a ^<major>.0.0 package range — it is the ` +
          'compatible @objectstack/spec range, not the protocol major that engines.protocol carries',
      ).not.toBeNull();
      expect(
        Number(match![1]),
        `${template} declares specVersion "${manifest.specVersion}" but create-objectstack is ` +
          `v${ownMajor} — scripts/sync-template-versions.mjs re-stamps this at version time`,
      ).toBe(ownMajor);
    });

    // The invariant that makes the two files one fact rather than two: the
    // manifest's declared spec range and the dependency a scaffolded project
    // actually installs must agree. Either alone can be self-consistently
    // stale; only comparing them catches a stamp that covered one and not the
    // other, which is the exact failure this card is about.
    it('specVersion agrees with the @objectstack/spec dependency the template installs', () => {
      const manifest = JSON.parse(readTemplateFile('objectstack.manifest.json'));
      const templatePkg = JSON.parse(readTemplateFile('package.json'));
      const specDep =
        templatePkg.dependencies?.['@objectstack/spec'] ??
        templatePkg.devDependencies?.['@objectstack/spec'];

      expect(
        specDep,
        `${template}/package.json must depend on @objectstack/spec for its manifest's ` +
          'specVersion to be checkable against something',
      ).toBeDefined();
      expect(
        manifest.specVersion,
        `${template} declares specVersion "${manifest.specVersion}" but installs ` +
          `@objectstack/spec "${specDep}" — one fact written twice, and they disagree`,
      ).toBe(specDep);
    });
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
    // `copyDir`'s collected array must match what the copy actually wrote.
    // It is NOT the "Created files:" summary and has not been since that
    // summary became a walk of the finished project directory: the copy runs
    // before `<pm> install` and the skills installer, so a list built here
    // could never name what they write (created-summary.ts carries the
    // measurement). This still pins the copy — `loadBundled` returns it, and
    // the run reports its length as the template-file count.
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

// A brand-new scaffold's very first `pnpm install` reported two unmet peers —
// on the one screen where a newcomer is deciding whether this project is solid,
// with nothing they did to cause it and nothing they can do about it (#10326).
// Both are third-party ranges we cannot edit, so the declaration is pnpm's
// scoped `allowedVersions`, and it has to travel INSIDE the scaffold: a
// `peerDependencyRules` block in this repo's own pnpm-workspace.yaml would not
// ship with the published packages, exactly as the overrides note there says.
describe('blank template peer-skew declarations (#10326)', () => {
  const wsPath = path.join(pkgRoot, 'src', 'templates', 'blank', 'pnpm-workspace.yaml');
  // Same comment-stripping as the block above: the prose explaining these keys
  // must not be what satisfies an assertion about the keys.
  const settings = fs.existsSync(wsPath)
    ? fs.readFileSync(wsPath, 'utf8').replace(/^\s*#.*$/gm, '')
    : '';
  const allowed = /^ {2}allowedVersions:\n((?:[ \t]+.*\n?)*)/m.exec(settings)?.[1] ?? '';

  it('declares the stale better-auth > better-sqlite3 peer', () => {
    // better-auth 1.7.1 peers `^12.0.0`; @objectstack/driver-sql resolves 13.x.
    // The peer is optional and governs only a raw better-sqlite3 `Database`
    // handed to better-auth's `database` option — a path ObjectStack never
    // takes (AuthManager passes an ObjectQL adapter factory). Measured on the
    // path it does govern, 1.7.1 behaves identically on 13.0.3 and 12.11.1.
    expect(
      /^\s*'better-auth>better-sqlite3':\s*'13'\s*$/m.test(allowed),
      "allowedVersions must widen better-auth's stale better-sqlite3 peer to 13",
    ).toBe(true);
  });

  it('declares the frozen @better-auth/scim > better-call peer', () => {
    // scim is held at 1.7.0-rc.1 deliberately; the rc peers an EXACT 1.3.7
    // while better-auth depends on 1.4.0. A better-auth plugin must share the
    // host's better-call instance, so the single 1.4.0 copy is correct.
    expect(
      /^\s*'@better-auth\/scim>better-call':\s*'1\.4\.0'\s*$/m.test(allowed),
      'allowedVersions must accept the single better-call 1.4.0 copy scim resolves to',
    ).toBe(true);
  });

  it('scopes every rule to one declaring package, never a bare peer name', () => {
    // A bare `better-sqlite3: '13'` would silence that peer for EVERY package
    // that declares it, including ones whose complaint would be real.
    const entries = [...allowed.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(0);
    for (const key of entries) {
      expect(key, `"${key}" must be spelled <declaring package>><peer>`).toContain('>');
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
