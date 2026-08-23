// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { TEMPLATES, getCliVersion, detectPackageManager, sanitizeNamespace, SCAFFOLD_BUILT_DEPENDENCIES, SCAFFOLD_ALLOWED_PEER_VERSIONS, renderPnpmWorkspaceYaml, renderScaffoldPackageJson, SCAFFOLD_PNPM_RANGE } from '../src/commands/init';

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

describe('template description accuracy — matches what srcFiles emits (#9737)', () => {
  // A template's `description` is what `printKV('Template', …)` and
  // `content/docs/deployment/cli.mdx` show a user at the moment they pick
  // `-t <template>` — so a description claiming a metadata kind the template
  // never writes (the `app`/`plugin` "views"/"actions"/"extensions" claims
  // this pin exists for) is a load-bearing lie, not cosmetic copy. Each kind
  // maps to the `src/` subdirectory its files would live under; a claim with
  // no matching `srcFiles` entry, in either direction, is the drift #9737
  // found.
  const KIND_CLAIMS: Array<{ kind: string; claimPattern: RegExp; dirPrefix: string }> = [
    { kind: 'objects', claimPattern: /\bobjects?\b/i, dirPrefix: 'src/objects/' },
    { kind: 'views', claimPattern: /\bviews?\b/i, dirPrefix: 'src/views/' },
    { kind: 'actions', claimPattern: /\bactions?\b/i, dirPrefix: 'src/actions/' },
    { kind: 'extensions', claimPattern: /\bextensions?\b/i, dirPrefix: 'src/extensions/' },
  ];

  it.each(Object.keys(TEMPLATES))('template "%s" only claims metadata kinds it actually writes', (key) => {
    const t = TEMPLATES[key];
    const emittedPaths = Object.keys(t.srcFiles);
    for (const { kind, claimPattern, dirPrefix } of KIND_CLAIMS) {
      const claims = claimPattern.test(t.description);
      const emits = emittedPaths.some((p) => p.startsWith(dirPrefix));
      if (claims) {
        expect(
          emits,
          `template "${key}" description claims "${kind}" but srcFiles has no ${dirPrefix}* entry (description: "${t.description}")`,
        ).toBe(true);
      }
    }
  });
});

describe('native build allowlist (pnpm-workspace.yaml)', () => {
  // pnpm 10+ blocks dependency build scripts by default. Without an allowlist,
  // the scaffold installs but `serve` crashes with "Could not locate the
  // bindings file" because `better-sqlite3` shipped uncompiled. Current pnpm
  // reads the allowlist from pnpm-workspace.yaml, not the package.json `pnpm`
  // field (which it now ignores).
  it('includes the native deps the standalone store needs', () => {
    expect(SCAFFOLD_BUILT_DEPENDENCIES).toContain('better-sqlite3');
  });

  it('does NOT put the allowlist in package.json (current pnpm ignores it)', () => {
    // Read the real renderer rather than a hand-copied mirror of it: the
    // previous version of this test re-declared the object literal inline, so
    // it asserted against its own copy and would have kept passing however far
    // init.ts drifted from it.
    const pkgJson = renderScaffoldPackageJson('my-app', TEMPLATES.app);
    expect(pkgJson.pnpm).toBeUndefined();
    expect((pkgJson.engines as Record<string, string>).pnpm).toBeDefined();
  });

  it('renders a pnpm-workspace.yaml that allowlists better-sqlite3', () => {
    const yaml = renderPnpmWorkspaceYaml();
    expect(yaml).toMatch(/^onlyBuiltDependencies:/m);
    expect(yaml).toMatch(/^ {2}- better-sqlite3$/m);
  });
});

// A scaffolded project is a workspace root with NO member packages, and the
// rendered file says so in one line rather than leaving it to be inferred from
// the absence of a key. That is not cosmetic: pnpm 9.x and 10.0–10.4 parse
// `pnpm-workspace.yaml` BEFORE they read `engines`, and a file without the key
// is refused outright — `pnpm install` exits 1 with "ERROR packages field
// missing or empty" before it resolves a single dependency, naming a file the
// user never wrote. Measured on the rendered shape, one clean install per pnpm
// version, each with its own store:
//
//   9.15.9 / 10.0.0 / 10.4.0   raw workspace error BEFORE → the floor's own
//                              ERR_PNPM_UNSUPPORTED_ENGINE AFTER.
//   10.15.0 / 10.34.5 / 11.22.0  install succeeds either way, and the two
//                              renders are equivalent: byte-identical
//                              `pnpm-lock.yaml`, `.modules.yaml` identical once
//                              run-local `prunedAt`/`storeDir` are dropped, and
//                              `pnpm ls -r --depth -1` reporting one project.
//
// ⛔ NOT `packages: ['.']`, which satisfies the same parsers but declares the
// project root a workspace MEMBER — a monorepo root. The scaffold's output is
// the start of every AI-written app on this platform, so a line that reads as
// "add member packages here" is the expensive half of that choice.
describe('explicit empty workspace declaration in the rendered file', () => {
  // Comments are stripped first: the prose above the key names it, and must
  // not be what satisfies an assertion about the declaration itself.
  const settings = renderPnpmWorkspaceYaml().replace(/^\s*#.*$/gm, '');

  it('declares `packages:` — the key early pnpm refuses the file without', () => {
    expect(
      /^packages:/m.test(settings),
      'the rendered pnpm-workspace.yaml must declare `packages:` — without it pnpm 9.x ' +
        'and 10.0–10.4 exit 1 with "packages field missing or empty" before reading engines',
    ).toBe(true);
  });

  it('declares it EMPTY — a workspace root with no member packages', () => {
    const inline = /^packages:[ \t]*(.*)$/m.exec(settings);
    expect(inline, '`packages:` must be declared inline').not.toBeNull();
    expect(
      inline![1].trim(),
      "`packages:` must be an empty list; `['.']` would declare the project root a " +
        'workspace MEMBER (a monorepo root), which a single-package scaffold is not',
    ).toBe('[]');
  });

  it('declares no member in any spelling', () => {
    // Covers the inline form (`['.']`, `["packages/*"]`) and the block form
    // (`packages:` followed by `  - …`), so neither can arrive unnoticed.
    expect(settings).not.toMatch(/^packages:[ \t]*\[[ \t]*[^\]\s]/m);
    expect(settings).not.toMatch(/^packages:[ \t]*\n[ \t]*-/m);
  });

  it('adds no other top-level setting to the rendered file', () => {
    // The rest of the file is what it was: the same four keys, same order. A
    // "restore the packages key" edit that also drags a setting in fails here.
    const keys = [...settings.matchAll(/^([A-Za-z][\w-]*):/gm)].map((m) => m[1]);
    expect(keys).toEqual(['packages', 'onlyBuiltDependencies', 'allowBuilds', 'peerDependencyRules']);
  });
});

// The explicit `packages:` key above is what makes this floor reachable at all.
// While the key was omitted, pnpm 9.x and 10.0–10.4 never got as far as
// `engines` — they parse the workspace file first and refused it outright — so
// no floor value could reach them. With the key present the entire band below
// the floor reports the same actionable cause instead. Measured on the rendered
// shape, one clean install per pnpm version, each with its own store:
//
//   9.15.9, 10.0.0, 10.4.0,   ERR_PNPM_UNSUPPORTED_ENGINE naming ">=10.15".
//   10.5.0–10.14.0            (9.x and 10.0–10.4 printed the raw workspace
//                             error here before the key existed.)
//   >=10.15.0                 install succeeds, byte-identical lockfile.
//
// ⚠️ So the floor, not the workspace file, is now what stops 10.0–10.4: with the
// floor lowered they install (exit 0, measured) — but they read neither the
// build allowlist nor the peer rules out of `pnpm-workspace.yaml`, so a scaffold
// there is quietly missing its native builds. Admitting that band is a support
// decision (#11048), not a value this suite should drift. These assertions pin
// the declared range, not pnpm's wording.
describe('pnpm floor in the rendered package.json', () => {
  /**
   * Lowest pnpm measured to install the rendered shape AND honour the workspace
   * file's settings — its build allowlist actually runs there (`node-gyp
   * rebuild` for better-sqlite3). 10.0.0 and 10.4.0 install too, now that
   * `packages:` is explicit, but skip those builds with only a warning.
   */
  const FIRST_GOOD: [number, number, number] = [10, 15, 0];

  function parseFloor(range: string): [number, number, number] {
    const m = /^>=\s*(\d+)\.(\d+)(?:\.(\d+))?$/.exec(range.trim());
    if (!m) throw new Error(`expected a plain ">=" floor, got "${range}"`);
    return [Number(m[1]), Number(m[2]), Number(m[3] ?? '0')];
  }

  const rank = ([maj, min, pat]: [number, number, number]) => maj * 1e6 + min * 1e3 + pat;

  it('declares engines.pnpm in every template', () => {
    for (const key of Object.keys(TEMPLATES)) {
      const pkgJson = renderScaffoldPackageJson('my-app', TEMPLATES[key]);
      const engines = pkgJson.engines as Record<string, string> | undefined;
      expect(engines?.pnpm, `template "${key}"`).toBe(SCAFFOLD_PNPM_RANGE);
    }
  });

  it('sets the floor at or above the first pnpm measured to honour the rendered workspace file', () => {
    expect(rank(parseFloor(SCAFFOLD_PNPM_RANGE))).toBeGreaterThanOrEqual(rank(FIRST_GOOD));
  });

  it('excludes every pnpm version this scaffold is not supported on', () => {
    const declared = rank(parseFloor(SCAFFOLD_PNPM_RANGE));
    // 10.0.0 and 10.4.0 were measured to install and then IGNORE the workspace
    // file's build allowlist ("The following dependencies have build scripts
    // that were ignored: better-sqlite3, esbuild"). 10.5.0 and 10.14.0 are
    // refused by the floor itself and were never measured past it — they stay
    // listed because nothing has shown them to honour the file, and dropping
    // them would silently widen what the scaffold claims to support.
    const unsupported: [number, number, number][] = [[10, 0, 0], [10, 4, 0], [10, 5, 0], [10, 14, 0]];
    for (const v of unsupported) {
      expect(rank(v), `pnpm ${v.join('.')} must fall below the declared floor`).toBeLessThan(declared);
    }
  });

  it('does NOT pin a packageManager — the scaffold also supports npm, yarn and bun', () => {
    // `packageManager: "pnpm@x.y.z"` would declare the project pnpm-only
    // (corepack-driven yarn refuses to run in such a project) and pin one exact
    // version that goes stale on every pnpm release. `detectPackageManager`
    // hands off to whichever of the four invoked the CLI, and all three others
    // ignore `engines.pnpm` — so the floor costs them nothing.
    const pkgJson = renderScaffoldPackageJson('my-app', TEMPLATES.app);
    expect(pkgJson.packageManager).toBeUndefined();
  });
});

// pnpm 11 honours ONLY `allowBuilds`. Rendering `onlyBuiltDependencies` alone
// — which is what this scaffolder shipped — makes a brand-new project's very
// first `pnpm install` exit 1 with ERR_PNPM_IGNORED_BUILDS, byte for byte the
// same failure as approving nothing at all. Measured one clean install per
// pnpm version, each with its own store, on a project scaffolded by
// `objectstack init -t app`:
//
//   10.0.0–10.25.0   read onlyBuiltDependencies; allowBuilds alone leaves the
//                    builds unrun (warning, exit 0)
//   10.26.0–10.34.x  read either key
//   11.x             read allowBuilds only; onlyBuiltDependencies alone exits 1
//
// So both keys are load-bearing and neither is redundant. The blank template
// (`packages/create-objectstack/src/templates/blank/pnpm-workspace.yaml`)
// already ships this shape and ratchets it in `template-consistency.test.ts`;
// these are the mirrored ratchets for the second scaffold path.
describe('pnpm 11 build approvals in the rendered workspace file', () => {
  // Strip comments first: the prose above these keys names them, and must not
  // be what satisfies an assertion about the settings themselves.
  const settings = renderPnpmWorkspaceYaml().replace(/^\s*#.*$/gm, '');

  const blockOf = (key: string, re: RegExp) =>
    re.exec(settings)?.[1] ?? `__no ${key} block__`;

  it('sets allowBuilds.<pkg> = true, the only key pnpm 11 reads', () => {
    const block = blockOf('allowBuilds', /^allowBuilds:\n((?:[ \t]+.*\n?)*)/m);
    for (const pkg of SCAFFOLD_BUILT_DEPENDENCIES) {
      expect(
        new RegExp(`^\\s+${pkg}:\\s*true\\s*$`, 'm').test(block),
        `allowBuilds must set "${pkg}: true" — pnpm 11 ignores onlyBuiltDependencies ` +
          'and exits 1 on an unapproved build script',
      ).toBe(true);
    }
  });

  it('keeps listing the same packages under onlyBuiltDependencies for pnpm < 10.26', () => {
    const block = blockOf('onlyBuiltDependencies', /^onlyBuiltDependencies:\n((?:[ \t]*-.*\n?)*)/m);
    for (const pkg of SCAFFOLD_BUILT_DEPENDENCIES) {
      expect(
        new RegExp(`^\\s*-\\s*${pkg}\\s*$`, 'm').test(block),
        `onlyBuiltDependencies must list "${pkg}" — pnpm 10.0–10.25 ignore allowBuilds`,
      ).toBe(true);
    }
  });

  it('grants exactly the same set under both keys', () => {
    // Two hand-maintained lists would drift, and the drift is invisible: each
    // key is read by a different pnpm population, so a package dropped from one
    // of them still builds fine on whichever pnpm the author happened to run.
    const only = [...blockOf('onlyBuiltDependencies', /^onlyBuiltDependencies:\n((?:[ \t]*-.*\n?)*)/m)
      .matchAll(/^\s*-\s*(\S+)\s*$/gm)].map((m) => m[1]);
    const allow = [...blockOf('allowBuilds', /^allowBuilds:\n((?:[ \t]+.*\n?)*)/m)
      .matchAll(/^\s+(\S+):\s*true\s*$/gm)].map((m) => m[1]);
    expect(allow.sort()).toEqual([...SCAFFOLD_BUILT_DEPENDENCIES].sort());
    expect(only.sort()).toEqual(allow.sort());
  });

  it('approves named packages only — never a wildcard', () => {
    // `allowBuilds` is not a blank cheque: whatever this scaffolder writes
    // becomes the standing build permission of every project created from it.
    // A glob would hand arbitrary install-time code execution to any future
    // transitive dependency, in every new project, silently.
    for (const pkg of SCAFFOLD_BUILT_DEPENDENCIES) {
      expect(pkg, 'build approvals must name one package each').not.toMatch(/[*?]/);
    }
    expect(settings).not.toMatch(/^\s*['"]?\*/m);
  });
});

// A brand-new scaffold's first `pnpm install` reported two unmet peers, on the
// one screen where a newcomer decides whether this project is solid, with
// nothing they did to cause it (#10326). Both ranges belong to third-party
// packages we cannot edit, so the remedy is pnpm's scoped `allowedVersions` —
// and it must travel INSIDE the scaffold, because a `peerDependencyRules` block
// in this repo's own pnpm-workspace.yaml does not ship with published packages.
describe('benign peer-skew declarations (#10326)', () => {
  // Comments in the rendered YAML explain these keys; they must not be what
  // satisfies an assertion about the keys themselves.
  const settings = renderPnpmWorkspaceYaml().replace(/^\s*#.*$/gm, '');

  it('widens better-auth\'s stale better-sqlite3 peer rather than pinning ours back', () => {
    // better-auth 1.7.1 peers `^12.0.0` while the tree resolves 13.x. The peer
    // is OPTIONAL and governs one configuration only — a raw better-sqlite3
    // `Database` passed to better-auth's `database` option — which ObjectStack
    // never does (AuthManager passes an ObjectQL adapter factory). Measured on
    // the configuration it does govern, 1.7.1 behaves identically on 13.0.3 and
    // 12.11.1, so 13 is right and the upstream range is stale.
    expect(SCAFFOLD_ALLOWED_PEER_VERSIONS['better-auth>better-sqlite3']).toBe('13');
    expect(settings).toMatch(/^ {4}'better-auth>better-sqlite3': '13'$/m);
  });

  it('accepts the single better-call copy @better-auth/scim resolves to', () => {
    // scim is held at 1.7.0-rc.1 on purpose; the rc peers an EXACT
    // `better-call@1.3.7` while better-auth depends on 1.4.0. A better-auth
    // plugin must share the HOST's better-call instance, so one 1.4.0 copy is
    // the correct tree. Retires with the scim rc pin.
    expect(SCAFFOLD_ALLOWED_PEER_VERSIONS['@better-auth/scim>better-call']).toBe('1.4.0');
    expect(settings).toMatch(/^ {4}'@better-auth\/scim>better-call': '1\.4\.0'$/m);
  });

  it.each([
    ['@better-auth/core'],
    ['@better-auth/oauth-provider'],
    ['@better-auth/scim'],
    ['@better-auth/sso'],
  ])('widens %s\'s exact @better-auth/utils peer to the version the tree resolves', (declaring) => {
    // Each of the four peers an EXACT `@better-auth/utils@0.4.2`, while the
    // tree hands them 0.5.0 — better-call (better-auth's own HTTP layer)
    // depends on `^0.5.0`, and that is the copy plugin-auth's direct
    // dependencies resolve their peer against. Measured on the surface the
    // range governs: the four import three symbols in total (base64/base64Url,
    // createHash, and createRandomStringGenerator in core), 0.5.0 declares all
    // three unchanged, and both versions return identical values on the inputs
    // those call sites pass — confirmed end to end through better-auth with the
    // sso, oauth-provider and scim plugins. Pinning utils back instead would
    // drag better-call off its own `^0.5.0`, trading four reported skews for a
    // real one.
    const key = `${declaring}>@better-auth/utils`;
    expect(SCAFFOLD_ALLOWED_PEER_VERSIONS[key]).toBe('0.5.0');
    expect(settings).toMatch(
      new RegExp(`^ {4}'${key.replace(/[/*+?^${}()|[\]\\]/g, '\\$&')}': '0\\.5\\.0'$`, 'm'),
    );
  });

  it('covers every declaring package that peers @better-auth/utils, not some of them', () => {
    // The defect this replaces was PARTIAL coverage: two skews were declared
    // and four more were not, so the first screen was clean for a third of the
    // report. A set assertion is what fails when a fifth declaration appears
    // and nobody measures it, or when one of these four is dropped while the
    // others stay.
    const declaring = Object.keys(SCAFFOLD_ALLOWED_PEER_VERSIONS)
      .filter((k) => k.endsWith('>@better-auth/utils'))
      .map((k) => k.slice(0, -'>@better-auth/utils'.length))
      .sort();
    expect(declaring).toEqual([
      '@better-auth/core',
      '@better-auth/oauth-provider',
      '@better-auth/scim',
      '@better-auth/sso',
    ]);
  });

  it('keeps the @better-auth/utils widening separate from the retiring better-call pin', () => {
    // @better-auth/scim appears in TWO entries for two unrelated reasons, and
    // they retire on different days: the better-call one goes when scim leaves
    // the rc (stable 1.7.1 peers better-call 1.4.0), while the utils one
    // outlives it (stable 1.7.1 still peers @better-auth/utils 0.4.2). Deleting
    // both together — the obvious move when the rc pin lifts — would silently
    // put the utils report back on a newcomer's first screen.
    expect(SCAFFOLD_ALLOWED_PEER_VERSIONS['@better-auth/scim>better-call']).toBe('1.4.0');
    expect(SCAFFOLD_ALLOWED_PEER_VERSIONS['@better-auth/scim>@better-auth/utils']).toBe('0.5.0');
  });

  it('renders the rules under peerDependencyRules.allowedVersions', () => {
    expect(settings).toMatch(/^peerDependencyRules:$/m);
    expect(settings).toMatch(/^ {2}allowedVersions:$/m);
  });

  it('scopes every rule to one declaring package, never a bare peer name', () => {
    // A bare `better-sqlite3: '13'` would silence that peer for every package
    // declaring it — including one whose complaint would be real.
    const keys = Object.keys(SCAFFOLD_ALLOWED_PEER_VERSIONS);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key, `"${key}" must be spelled <declaring package>><peer>`).toContain('>');
    }
  });

  it('emits nothing at all when the caller supplies no rules', () => {
    // The block is data-driven, so an empty map must not leave a dangling
    // `allowedVersions:` header claiming a declaration that is not there.
    const bare = renderPnpmWorkspaceYaml(SCAFFOLD_BUILT_DEPENDENCIES, {});
    expect(bare).not.toMatch(/^peerDependencyRules:$/m);
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

  // #4097 — every scaffold stamps an `engines.protocol` range admitting the
  // protocol major it was generated under, so new projects never boot with
  // the ADR-0087 handshake silently skipped ("no-range" grandfathering).
  it('stamps engines.protocol with the current protocol major in every template', () => {
    for (const key of Object.keys(TEMPLATES)) {
      const { tmpRoot } = renderTemplate(key as keyof typeof TEMPLATES, 'my-app');
      const cfg = fs.readFileSync(path.join(tmpRoot, 'objectstack.config.ts'), 'utf8');
      expect(cfg, `template "${key}" must declare engines.protocol`).toContain(
        `engines: { protocol: '^${PROTOCOL_MAJOR}' }`,
      );
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
