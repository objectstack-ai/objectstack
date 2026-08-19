// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The declaration surface of `scripts/sync-template-versions.mjs` (#9554).
//
// That script stamps three version surfaces per bundled template and discovers
// the template set by WALKING `src/templates/` — "deliberately not a curated
// list", because a hand-kept list is what let `specVersion` drift eleven majors
// (#9264). But for one release it declared that set where nobody could read it:
// nothing was exported and the sync ran at module scope, so a consumer that
// imported the file to ask "which paths does the version pass write?" rewrote
// every template instead of getting an answer. `cut-rc.yml`'s release-file
// allowlist therefore RESTATED two of the paths, both hard-coding the template
// name `blank`.
//
// ## Why a fixture with a SECOND template, and why that is the whole point
//
// The repo ships exactly one template today, so on the live tree the walk and a
// literal `blank` pair agree and nothing is red — which is precisely why this
// finding could only be found by reading rather than by a failing test. Every
// assertion below that ran only against the live tree would pass just as
// happily against a `stampedPaths()` that returned two hard-coded `blank`
// strings. So the load-bearing cases run against a temp checkout carrying TWO
// templates: `blank` and `second`. An implementation that restated `blank`
// fails there, and that is the assertion that keeps this fixed rather than
// re-found the day a second template ships.
//
// The same fixture is deliberately built STALE (pinning ^17 while its
// scaffolder reads 42.0.0). That makes the import-safety assertion non-vacuous
// in the one way that matters: an unguarded module imported against a stale
// tree REWRITES it, so "the files are byte-identical after import" is evidence
// only when there was something for a rewrite to do. Byte-identity over an
// already-in-lockstep tree would prove nothing at all.
//
// Scope note: this file asserts the DECLARATION surface and the entry-point
// guard. #9348 (the script has no `--self-test` and runs nowhere in CI) is a
// separate change to the same file and is not implemented here.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const SYNC_SCRIPT = path.join(repoRoot, 'scripts', 'sync-template-versions.mjs');

/**
 * The script is loaded the way its real consumer loads it — by URL, at run
 * time — rather than by a static import. `cut-rc.yml` reaches it as
 * `node -e 'import { … } from "./scripts/sync-template-versions.mjs"'`, and a
 * `.mjs` outside this package's `rootDir` is not statically importable from
 * `src/` anyway.
 */
type SyncModule = {
  TEMPLATE_DIR: string;
  TEMPLATE_ROOT: string;
  TEMPLATE_PKG_FILE: string;
  VERSION_SOURCE: string;
  TEXT_STAMPS: { file: string; key: string; pattern: RegExp }[];
  findTemplateDirs: (templateRoot?: string) => string[];
  stampedPaths: (options?: { root?: string }) => string[];
  loadScaffolderVersion: (file?: string) => { version: string; major: string; range: string };
};

const loadSync = async (file = SYNC_SCRIPT): Promise<SyncModule> =>
  (await import(pathToFileURL(file).href)) as SyncModule;

// ── the two-template fixture ────────────────────────────────────────────────

/** A throwaway checkout shaped like this repo: `scripts/` + the template tree. */
let fixture: string;
let fixtureScript: string;

/** Deliberately not the live version, so a stamp that ran is unmistakable. */
const FIXTURE_VERSION = '42.0.0';
/** Deliberately stale: every fixture surface pins this and must move to 42. */
const STALE_MAJOR = '17';

const FIXTURE_TEMPLATES = ['blank', 'second'] as const;

const fixtureTemplateDir = (template: string) =>
  path.join(fixture, 'packages', 'create-objectstack', 'src', 'templates', template);

const writeFixtureFile = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-template-versions-9554-'));

  // The script resolves its repo root from its OWN location
  // (`dirname(dirname(import.meta.url))`), so a copy two levels above the
  // template tree makes the fixture a complete, self-consistent checkout.
  fixtureScript = path.join(fixture, 'scripts', 'sync-template-versions.mjs');
  writeFixtureFile(fixtureScript, fs.readFileSync(SYNC_SCRIPT, 'utf8'));

  writeFixtureFile(
    path.join(fixture, 'packages', 'create-objectstack', 'package.json'),
    JSON.stringify({ name: 'create-objectstack', version: FIXTURE_VERSION }, null, 2) + '\n',
  );

  for (const template of FIXTURE_TEMPLATES) {
    const dir = fixtureTemplateDir(template);
    writeFixtureFile(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          name: `template-${template}`,
          dependencies: { '@objectstack/spec': `^${STALE_MAJOR}.0.0`, chalk: '^6.0.0' },
          devDependencies: { '@objectstack/cli': `^${STALE_MAJOR}.0.0` },
        },
        null,
        2,
      ) + '\n',
    );
    writeFixtureFile(
      path.join(dir, 'objectstack.config.ts'),
      `export default defineStack({ manifest: { engines: { protocol: '^${STALE_MAJOR}' } } });\n`,
    );
    writeFixtureFile(
      path.join(dir, 'objectstack.manifest.json'),
      `{\n  "specVersion": "^${STALE_MAJOR}.0.0",\n  "scaffold": { "variables": [] }\n}\n`,
    );
  }

  // A file, not a directory, beside the templates: the walk must ignore it the
  // way the live tree's `templates/AGENTS.md` is ignored.
  writeFixtureFile(
    path.join(fixture, 'packages', 'create-objectstack', 'src', 'templates', 'AGENTS.md'),
    '# not a template\n',
  );
});

afterAll(() => {
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
});

/** Every fixture surface, as absolute paths. */
const allFixtureSurfaces = () =>
  FIXTURE_TEMPLATES.flatMap((template) =>
    ['package.json', 'objectstack.config.ts', 'objectstack.manifest.json'].map((file) =>
      path.join(fixtureTemplateDir(template), file),
    ),
  );

const snapshotFixture = () =>
  Object.fromEntries(allFixtureSurfaces().map((file) => [file, fs.readFileSync(file, 'utf8')]));

// ── import safety (#9554) ───────────────────────────────────────────────────

describe('sync-template-versions.mjs is import-safe', () => {
  it('importing it against a STALE two-template checkout rewrites nothing', async () => {
    const before = snapshotFixture();

    // Anti-vacuity: the fixture must genuinely need stamping, or byte-identity
    // below is a statement about a tree no correct implementation would touch.
    expect(
      Object.values(before).every((text) => text.includes(`^${STALE_MAJOR}`)),
      'the fixture starts STALE on every surface, so an unguarded import would have work to do',
    ).toBe(true);

    await loadSync(fixtureScript);

    expect(
      snapshotFixture(),
      'importing the module must not run the sync — the entry-point guard is what lets a ' +
        'consumer read the declarations instead of restating them (#9554)',
    ).toEqual(before);
  });

  it('exports the declaration surface a consumer needs', async () => {
    const sync = await loadSync();
    expect(typeof sync.stampedPaths).toBe('function');
    expect(typeof sync.findTemplateDirs).toBe('function');
    expect(typeof sync.loadScaffolderVersion).toBe('function');
    expect(Array.isArray(sync.TEXT_STAMPS)).toBe(true);
    expect(sync.TEXT_STAMPS.length).toBeGreaterThan(0);
    expect(sync.TEMPLATE_DIR).toBe('packages/create-objectstack/src/templates');
  });

  it('reading the version THROWS rather than exiting the host process', async () => {
    const sync = await loadSync();
    const bad = path.join(fixture, 'unparseable.json');
    fs.writeFileSync(bad, JSON.stringify({ version: 'workspace:*' }));
    // A module-scope `process.exit(1)` on an unparseable version is a worse
    // import hazard than the sync, not a smaller one: it kills the consumer.
    expect(() => sync.loadScaffolderVersion(bad)).toThrow(/cannot parse/i);
  });
});

// ── the entry point still stamps (#9554 must not break the release path) ────

describe('the entry-point guard leaves the CLI path working', () => {
  it('running the script stamps EVERY template, including the second one', () => {
    const stdout = execFileSync(process.execPath, [fixtureScript], { encoding: 'utf8' });

    for (const template of FIXTURE_TEMPLATES) {
      const dir = fixtureTemplateDir(template);
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      expect(
        pkg.dependencies['@objectstack/spec'],
        `${template}/package.json @objectstack/* ranges move to the scaffolder's major`,
      ).toBe('^42.0.0');
      expect(pkg.devDependencies['@objectstack/cli']).toBe('^42.0.0');
      expect(
        pkg.dependencies.chalk,
        'a non-@objectstack dependency is never touched',
      ).toBe('^6.0.0');

      expect(fs.readFileSync(path.join(dir, 'objectstack.config.ts'), 'utf8')).toContain(
        "engines: { protocol: '^42' }",
      );

      const manifest = fs.readFileSync(path.join(dir, 'objectstack.manifest.json'), 'utf8');
      expect(manifest).toContain('"specVersion": "^42.0.0"');
      expect(
        manifest,
        'the manifest is rewritten as TEXT, so unrelated compact structure survives',
      ).toContain('"scaffold": { "variables": [] }');
    }

    // A guard that made the version pass silently stop stamping would be far
    // worse than the finding it fixes, so the run is observed to REPORT both.
    expect(stdout).toContain('2 template(s) in lockstep with create-objectstack@42.0.0');
    expect(stdout).toContain('second/objectstack.manifest.json');
  });
});

// ── stampedPaths() is derived from the walk, never a restated list ──────────

describe('stampedPaths()', () => {
  it('covers every discovered template — the case a literal list fails', async () => {
    const sync = await loadSync(fixtureScript);
    const paths = sync.stampedPaths({ root: fixture });
    const prefix = 'packages/create-objectstack/src/templates';

    expect(paths).toEqual([
      `${prefix}/blank/objectstack.config.ts`,
      `${prefix}/blank/objectstack.manifest.json`,
      `${prefix}/blank/package.json`,
      `${prefix}/second/objectstack.config.ts`,
      `${prefix}/second/objectstack.manifest.json`,
      `${prefix}/second/package.json`,
    ]);

    // The finding, stated as an assertion: the pair `cut-rc.yml` spells
    // literally is a STRICT SUBSET of what the version pass actually writes as
    // soon as a second template exists. An implementation that restated
    // `blank` would satisfy every other assertion in this file.
    const literals = [
      `${prefix}/blank/objectstack.config.ts`,
      `${prefix}/blank/objectstack.manifest.json`,
    ];
    const uncovered = paths.filter((p) => !literals.includes(p));
    expect(
      uncovered.some((p) => p.includes('/second/')),
      'the second template is covered by the declaration and by no literal `blank` pair',
    ).toBe(true);
  });

  it('names only paths that exist — consumers build git pathspecs out of them', async () => {
    const sync = await loadSync();
    const paths = sync.stampedPaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p, 'repo-relative, never absolute').not.toMatch(/^([/]|[A-Za-z]:)/);
      expect(p, 'POSIX separators — these are git pathspecs downstream').not.toContain('\\');
      expect(fs.existsSync(path.join(repoRoot, p)), `${p} exists in this checkout`).toBe(true);
    }
    expect(new Set(paths).size, 'no duplicates').toBe(paths.length);
    expect([...paths].sort(), 'stable order').toEqual(paths);
  });

  it('agrees with the live walk rather than with a remembered template set', async () => {
    const sync = await loadSync();
    const templates = sync.findTemplateDirs();
    expect(templates.length).toBeGreaterThan(0);

    const files = [sync.TEMPLATE_PKG_FILE, ...sync.TEXT_STAMPS.map((s) => s.file)];
    const expected = templates
      .flatMap((t) => files.map((f) => `${sync.TEMPLATE_DIR}/${t}/${f}`))
      .sort();
    expect(sync.stampedPaths()).toEqual(expected);
  });

  it('REFUSES an empty template set instead of returning an empty allowlist', async () => {
    const sync = await loadSync();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-template-versions-empty-'));
    fs.mkdirSync(path.join(empty, 'packages', 'create-objectstack', 'src', 'templates'), {
      recursive: true,
    });
    try {
      // An empty list reads exactly like "no template paths need staging" and
      // means "the directory moved" — the vacuous-green shape the script's own
      // run refuses, and the one `cut-rc.yml` already guards for the doc half.
      expect(() => sync.stampedPaths({ root: empty })).toThrow(/no template directories/i);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
