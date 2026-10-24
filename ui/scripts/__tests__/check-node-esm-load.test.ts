import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ESM_MODULE_EDGE,
  EXPLICIT_EXTENSION,
  MIN_LOADED,
  MIN_PACKAGES,
  PROVENANCE_OK,
  PROVENANCE_REMEDY,
  SPECIFIER_DEBT,
  TURBO_TASK_LOG,
  UNBUNDLED_NODE_UNSUPPORTED,
  attributeMissingModule,
  buildPreservesSpecifiers,
  buildProvenance,
  effectiveNoEmit,
  emittedSources,
  esmEntryOf,
  importEntry,
  readTsconfig,
  relativeSpecifiers,
  resolvesToModule,
  scanSpecifiers,
} from '../check-node-esm-load.mjs';
import { SKIP_DIRS, discoverPackages } from '../check-phantom-dependencies.mjs';

/**
 * objectui#4538 — a published entry plain Node ESM cannot load.
 *
 * `packages/react/dist/index.js` re-exported through extensionless relative
 * specifiers, so `import('@object-ui/react')` under plain Node died with
 * ERR_MODULE_NOT_FOUND. Every bundler in the repository resolved it happily,
 * which is why the whole suite, every example app and CI were green with the
 * defect in place.
 *
 * What this file pins is mostly the ways the NEW gate could join them in being
 * green about nothing:
 *
 *  1. **A check that stops at RESOLUTION is not enough** — measured on the very
 *     package the card was filed from. So the load leg must EVALUATE, and
 *     `importEntry` is exercised against a module whose body throws.
 *  2. **The vacuous verdict is RED.** "Imported nothing, found nothing" is the
 *     answer this gate must never give; `MIN_LOADED`/`MIN_PACKAGES` exist for it.
 *  3. **The emit question decides the scope**, and it is read from the tsconfig,
 *     not the command line. `@object-ui/console` runs a `tsc` that carries
 *     `"noEmit": true`; grading it on the command alone reported 124 findings
 *     against a package that emits none of them.
 *  4. **The ledger is a ratchet, not a mute button** — an entry that is no
 *     longer true is itself a finding.
 *  5. **Line numbers must address the real file.** Stripping comments outright
 *     moved every finding in `react/src/index.ts` up by six lines, so the gate
 *     pointed at line 3 for what `tsc` reported at line 9.
 *  6. **The gate must not MUTATE the text it grades** (objectui#5382). Leg 1
 *     used to blank comments with two ordered regexes and match specifiers in
 *     the result; the block-comment pass did not know it was already inside a
 *     `//` line, so prose naming a package glob opened a comment that ran to
 *     the next closing delimiter anywhere in the file and blanked the live code
 *     between. The objectui#5382 `describe` below pins both halves of that:
 *     the hidden import is found, and the prose that must stay invisible is.
 *  7. **A build is not a production** (objectui#7276). turbo shares one cache
 *     across every worktree of a checkout, so `pnpm build` here can be a
 *     replay of a sibling worktree's artifacts — and the gate used to print
 *     that it "refuses to grade artifacts it did not produce" straight over
 *     that replay. The last `describe` pins the leg that makes the sentence
 *     true, including the direction that used to be silent: a GREEN over
 *     someone else's artifacts. It is written to FAIL CLOSED, so the pins
 *     cover not knowing as well as knowing the wrong answer.
 */

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'esm-load-gate-'));

describe('objectui#4538 — the defect the gate exists for', () => {
  it('flags an extensionless relative specifier that names a real module', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/SchemaRenderer.tsx'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(dir, 'src/index.ts'), "export * from './SchemaRenderer';\n");

    const findings = scanSpecifiers({ name: 'p', dir: 'p', srcDir: path.join(dir, 'src') });
    expect(findings).toHaveLength(1);
    expect(findings[0].spec).toBe('./SchemaRenderer');
  });

  it('accepts the same specifier once it carries an extension', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/SchemaRenderer.tsx'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(dir, 'src/index.ts'), "export * from './SchemaRenderer.js';\n");

    expect(scanSpecifiers({ name: 'p', dir: 'p', srcDir: path.join(dir, 'src') })).toEqual([]);
  });

  it('reports the line number the compiler reports, not the post-strip one', () => {
    // The regression this pins: a license header is a block comment, and
    // removing it outright shifted every finding six lines up.
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const x = 1;\n');
    fs.writeFileSync(
      path.join(dir, 'src/index.ts'),
      `/**\n * license\n * header\n */\n\nexport * from './a';\n`,
    );

    const [finding] = scanSpecifiers({ name: 'p', dir: 'p', srcDir: path.join(dir, 'src') });
    expect(finding.line).toBe(6);
  });

  it('ignores a specifier that resolves to nothing, and one that is commented out', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/real.ts'), 'export const x = 1;\n');
    fs.writeFileSync(
      path.join(dir, 'src/index.ts'),
      "// export { y } from './real';\nexport * from './deleted-long-ago';\n",
    );

    expect(scanSpecifiers({ name: 'p', dir: 'p', srcDir: path.join(dir, 'src') })).toEqual([]);
  });

  it('catches every specifier form the repo writes', () => {
    const forms = [
      "export * from './a';",
      "import './b';",
      "const m = await import('./c');",
      "import x from './d';",
      "export { y } from './e';",
    ].join('\n');
    const specs = relativeSpecifiers(forms, 'forms.ts').map((use) => use.specifier);
    expect(specs).toEqual(['./a', './b', './c', './d', './e']);
  });

  it('treats a directory import as needing an extension too', () => {
    // Node rejects `./hooks` for a directory as firmly as for a file: there is
    // no index resolution in ESM. TypeScript grades it TS2834 rather than
    // TS2835, but the runtime consequence is identical.
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src/hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/hooks/index.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(dir, 'src/index.ts'), "export * from './hooks';\n");

    expect(scanSpecifiers({ name: 'p', dir: 'p', srcDir: path.join(dir, 'src') })).toHaveLength(1);
  });

  it('does not grade `.css` or `.json`, which fail for a different reason', () => {
    expect(EXPLICIT_EXTENSION.test('./styles.css')).toBe(true);
    expect(EXPLICIT_EXTENSION.test('./data.json')).toBe(true);
  });
});

describe('scope — which builds preserve specifiers', () => {
  function pkg(buildScript: string, noEmit: boolean | undefined) {
    const dir = tmpdir();
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: noEmit === undefined ? {} : { noEmit } }),
    );
    return { dir, buildScript };
  }

  it('counts a bare emitting `tsc`', () => {
    const p = pkg('tsc', false);
    expect(buildPreservesSpecifiers(p.buildScript, p.dir)).toBe(true);
  });

  it('does NOT count a `tsc` whose tsconfig says noEmit — the @object-ui/console case', () => {
    const p = pkg('tsc && vite build && pnpm build:plugin', true);
    expect(buildPreservesSpecifiers(p.buildScript, p.dir)).toBe(false);
  });

  it('does NOT count a bundler, which resolves specifiers while bundling', () => {
    const p = pkg('vite build', undefined);
    expect(buildPreservesSpecifiers(p.buildScript, p.dir)).toBe(false);
    expect(buildPreservesSpecifiers('tsup', p.dir)).toBe(false);
  });

  it('counts a pipeline whose emitting `tsc` is followed by a bundler', () => {
    const p = pkg('tsc && vite build && node scripts/build-css.mjs', false);
    expect(buildPreservesSpecifiers(p.buildScript, p.dir)).toBe(true);
  });

  it('does NOT count `tsc --noEmit`', () => {
    const p = pkg('tsc --noEmit', false);
    expect(buildPreservesSpecifiers(p.buildScript, p.dir)).toBe(false);
  });

  it('follows `extends` for noEmit, because the leaf usually does not set it', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify({ compilerOptions: { noEmit: true } }));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: './base.json' }));
    expect(effectiveNoEmit(path.join(dir, 'tsconfig.json'))).toBe(true);
  });

  it('tolerates the comments this repo writes in tsconfigs', () => {
    const dir = tmpdir();
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{\n // why\n "compilerOptions": { /* inline */ "noEmit": false },\n}\n',
    );
    expect(effectiveNoEmit(path.join(dir, 'tsconfig.json'))).toBe(false);
  });

  it('excludes tooling material, which no build tsconfig emits', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src/__tests__'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/index.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(dir, 'src/a.test.ts'), "import './index';\n");
    fs.writeFileSync(path.join(dir, 'src/__tests__/b.ts'), "import '../index';\n");

    expect(emittedSources(path.join(dir, 'src'))).toEqual([path.join(dir, 'src/index.ts')]);
  });
});

/**
 * objectui#5367 — the tsconfig reader was the same class as the specifier mask.
 *
 * `readTsconfig` stripped comments with three ordered regexes and handed the
 * result to `JSON.parse`. None of them knew what a JSON string was, so the
 * slash-star inside a `paths` key opened a "block comment" that ran to the next
 * star-slash — typically the test glob in `exclude` at the bottom of the same
 * file — and deleted everything between. Measured before the fix: 61 of this
 * repository's 91 tsconfigs threw, and every throw was swallowed by
 * `effectiveNoEmit`'s catch, which grades an unreadable config as emitting.
 *
 * The gate's verdict happened to be safe. It was also never computed, which is
 * the property this block exists to keep from coming back.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSCONFIG_NAME = /^tsconfig(\..+)?\.json$/;

/**
 * The slice of a parsed tsconfig these assertions read.
 *
 * `readTsconfig` returns arbitrary JSON, so the narrowing is written down here
 * once rather than asserted inline at every call — and it stays `unknown` at the
 * leaves, so a wrong assumption about a value's shape is still a type error.
 */
type ParsedTsconfig = {
  compilerOptions?: Record<string, unknown>;
  extends?: unknown;
  include?: unknown;
  exclude?: unknown;
};

const parseTsconfig = (file: string) => readTsconfig(file) as ParsedTsconfig;

/**
 * Every tsconfig in the repository, walked rather than listed.
 *
 * A hand-maintained list would answer "the files someone remembered", which is
 * exactly the reading that let two poisoned configs sit unnoticed. `SKIP_DIRS`
 * is the sibling gates' own exclusion set, so `node_modules` and build output
 * are out for the same reason they are out everywhere else.
 */
function everyTsconfig(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      everyTsconfig(path.join(dir, entry.name), out);
    } else if (TSCONFIG_NAME.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

describe('readTsconfig reads tsconfigs rather than pattern-matching around them', () => {
  it('round-trips EVERY tsconfig in the repository without throwing', () => {
    const configs = everyTsconfig(REPO_ROOT);

    // The size assertion is the same doctrine the gate applies to itself: a walk
    // that found nothing would throw nothing and report success. 91 exist today;
    // 60 is a floor that a real collapse trips and ordinary churn does not.
    expect(configs.length).toBeGreaterThanOrEqual(60);

    const threw: string[] = [];
    for (const file of configs) {
      try {
        readTsconfig(file);
      } catch (error) {
        threw.push(`${path.relative(REPO_ROOT, file)}: ${(error as Error).message}`);
      }
    }
    expect(threw).toEqual([]);
  });

  it('keeps a `paths` key whose value opens a comment, and the keys after it', () => {
    // The exact two lines that poisoned `packages/auth/tsconfig.json`: the
    // slash-star in the paths key, and the test glob in `exclude` that closed
    // the comment it opened. The old strip returned a config with no `paths`,
    // no `include`, and a truncated `exclude`.
    const dir = tmpdir();
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      [
        '{',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": { "@/*": ["src/*"] },',
        '    "noEmit": false',
        '  },',
        '  "include": ["src"],',
        '  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]',
        '}',
        '',
      ].join('\n'),
    );

    const config = parseTsconfig(path.join(dir, 'tsconfig.json'));
    expect(config.compilerOptions?.paths).toEqual({ '@/*': ['src/*'] });
    expect(config.include).toEqual(['src']);
    expect(config.exclude).toEqual(['node_modules', 'dist', '**/*.test.ts', '**/*.test.tsx']);
    expect(config.compilerOptions?.noEmit).toBe(false);
  });

  it('keeps the config below a line comment whose prose contains a slash-star', () => {
    // `packages/fields/tsconfig.json`'s shape: a `//` comment naming a package
    // glob. The block-comment pass ran first and had no notion of being inside a
    // line comment, so the glob opened a comment that ate the rest of the file —
    // which is how a config that plainly inherits `noEmit: true` was graded as
    // emitting for as long as this gate has existed.
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify({ compilerOptions: { noEmit: true } }));
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      [
        '{',
        '  "extends": "./base.json",',
        '  "compilerOptions": {',
        '    // maps siblings to their packages/*/src trees',
        '    "outDir": "dist"',
        '  },',
        '  "exclude": ["**/*.test.ts"]',
        '}',
        '',
      ].join('\n'),
    );

    expect(parseTsconfig(path.join(dir, 'tsconfig.json')).compilerOptions?.outDir).toBe('dist');
    expect(effectiveNoEmit(path.join(dir, 'tsconfig.json'))).toBe(true);
  });

  it('still THROWS on a config nobody can read, which is what the catch is for', () => {
    // `effectiveNoEmit` is written against this contract: a genuinely unreadable
    // config widens the scan rather than dropping a package out of it. The fix
    // narrows what counts as unreadable; it does not remove the margin.
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ "compilerOptions": }\n');
    expect(() => readTsconfig(path.join(dir, 'tsconfig.json'))).toThrow();
    expect(effectiveNoEmit(path.join(dir, 'tsconfig.json'))).toBe(false);
  });
});

describe('the scope this gate ratchets, now that the emit question is answered', () => {
  // Fixing the parse moves the specifier leg's membership exactly once, and the
  // two packages below are both halves of that move. Pinned here so the change
  // is a decision on the record rather than a side effect nobody measured — the
  // failure objectui#5367 was filed to end.

  it('reads `@object-ui/fields` as NOT specifier-preserving, so it leaves the leg', () => {
    // Its `tsc` step inherits the root's `noEmit: true` and only type-checks;
    // `dist` is written by vite-plugin-dts, which resolves relative specifiers
    // while bundling. Measured at the time this landed: 0 extensionless of 155
    // relative specifiers in its built `dist`, and 0 extensionless in its
    // sources — so nothing live left the leg with it. The sources keep a
    // STRICTER guard than this heuristic: that config pins `nodenext`, under
    // which a missing relative extension is TS2835 in the package's own build.
    const dir = path.join(REPO_ROOT, 'packages/fields');
    const build = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.build;

    expect(effectiveNoEmit(path.join(dir, 'tsconfig.json'))).toBe(true);
    expect(buildPreservesSpecifiers(build, dir)).toBe(false);
    expect(parseTsconfig(path.join(dir, 'tsconfig.json')).compilerOptions?.noEmit).toBeUndefined();
  });

  it('keeps `@object-ui/auth` in the leg on its DECLARED noEmit, not on a catch', () => {
    // Its config throws under the old reader too, so it was in the leg by
    // accident. It declares `"noEmit": false` outright, so the verdict is
    // unchanged — what changes is that it is now a reading.
    const dir = path.join(REPO_ROOT, 'packages/auth');
    const build = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.build;

    expect(parseTsconfig(path.join(dir, 'tsconfig.json')).compilerOptions?.noEmit).toBe(false);
    expect(effectiveNoEmit(path.join(dir, 'tsconfig.json'))).toBe(false);
    expect(buildPreservesSpecifiers(build, dir)).toBe(true);
  });
});

describe('the load leg evaluates rather than resolves', () => {
  it('fails a module that RESOLVES but throws on evaluation', () => {
    // The card's sharpest measured point: plugin-charts' entry resolved fine and
    // the tree was still broken. A resolution-only check passes this case.
    const dir = tmpdir();
    const entry = path.join(dir, 'boom.mjs');
    fs.writeFileSync(entry, 'throw new Error("evaluated and failed");\n');
    expect(fs.existsSync(entry)).toBe(true);

    const outcome = importEntry(entry);
    expect(outcome.ok).toBe(false);
  });

  it('passes a module that loads', () => {
    const dir = tmpdir();
    const entry = path.join(dir, 'fine.mjs');
    fs.writeFileSync(entry, 'export const ok = 1;\n');
    expect(importEntry(entry).ok).toBe(true);
  });

  it('reports ERR_MODULE_NOT_FOUND for the defect itself, and names the missing path', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'dep.mjs'), 'export const x = 1;\n');
    const entry = path.join(dir, 'index.mjs');
    fs.writeFileSync(entry, "export * from './dep';\n");

    const outcome = importEntry(entry);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ERR_MODULE_NOT_FOUND');
    expect(outcome.missing).toContain('dep');
  });

  it('attributes a missing module to the package that owns it, not the importer', () => {
    // plugin-grid, plugin-list, plugin-timeline and plugin-view all failed on
    // packages/mobile/dist/useBreakpoint. One cause, one owner.
    const packages = [
      { name: '@object-ui/mobile', dir: 'packages/mobile' },
      { name: '@object-ui/plugin-grid', dir: 'packages/plugin-grid' },
    ];
    const owner = attributeMissingModule('/repo/packages/mobile/dist/useBreakpoint', packages, '/repo');
    expect(owner).toBe('@object-ui/mobile');
  });

  it('attributes nothing for a path outside the workspace', () => {
    expect(attributeMissingModule('/elsewhere/x.js', [{ name: 'a', dir: 'packages/a' }], '/repo')).toBeNull();
  });

  it('reads the entry a consumer reaches through `exports`, in Node order', () => {
    expect(esmEntryOf({ exports: { '.': { import: './dist/index.js' } } })).toBe('./dist/index.js');
    expect(esmEntryOf({ exports: { '.': './x.js' } })).toBe('./x.js');
    expect(esmEntryOf({ module: './m.js', main: './c.js' })).toBe('./m.js');
    // A bin-only CLI and a built web app declare none — not a defect.
    expect(esmEntryOf({ bin: { x: './dist/cli.js' } })).toBeNull();
  });
});

describe('the gate cannot be green about nothing', () => {
  it('keeps a floor under both legs', () => {
    expect(MIN_PACKAGES).toBeGreaterThanOrEqual(30);
    expect(MIN_LOADED).toBeGreaterThan(0);
  });

  it('finds no specifier in an empty tree, which is why the floors exist', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src'));
    expect(scanSpecifiers({ name: 'p', dir: 'p', srcDir: path.join(dir, 'src') })).toEqual([]);
  });

  it('resolvesToModule answers for files and for directory indexes', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'file.ts'), '');
    fs.writeFileSync(path.join(dir, 'sub/index.tsx'), '');
    const from = path.join(dir, 'index.ts');
    expect(resolvesToModule(from, './file')).toBe(true);
    expect(resolvesToModule(from, './sub')).toBe(true);
    expect(resolvesToModule(from, './nope')).toBe(false);
  });
});

describe('objectui#5382 — the comment mask that hid live code', () => {
  /**
   * The measured shape, kept as close to the real file as a fixture can be.
   *
   * `packages/app-shell/src/preview/DraftChangesPanel.tsx` carries a line
   * comment naming the `@objectstack` chunk group by glob. Under the retired
   * mask the slash-star inside that prose opened a block comment, and the mask
   * ran to the closing delimiter of the next doc comment — blanking the live
   * `import` in between. Re-measured on `main` at 478ec54ce over the 805 files
   * of the 13 specifier-preserving packages: the mask found 2132 relative
   * specifiers, the TypeScript parser 2133, and the single difference was that
   * import.
   *
   * Verified to be a real repro rather than a fixture that happens to pass:
   * handed to the retired implementation this source yields ZERO specifiers.
   */
  const GLOB_PROSE_FIXTURE = [
    '// The `vendor-objectstack` chunk group claims every `@objectstack/*` module',
    '// except `@objectstack/lint`, and that group is a static import of the entry.',
    "import { diffFields } from './object-fields-io';",
    '',
    'export interface DraftChangeEntry {',
    '  /** The canonical singular metadata type. */',
    '  type: string;',
    '}',
    '',
  ].join('\n');

  it('finds an import that a package glob in line-comment prose used to hide', () => {
    expect(relativeSpecifiers(GLOB_PROSE_FIXTURE, 'DraftChangesPanel.tsx')).toEqual([
      { specifier: './object-fields-io', kind: 'import', line: 3 },
    ]);
  });

  it('flags it as a FINDING when it is extensionless, which is the point', () => {
    // The mask did not merely mislabel this import, it removed it from the leg
    // entirely — and since SPECIFIER_DEBT emptied, that leg is a hard
    // requirement. A blind spot in a hard requirement is where a regression
    // sits permanently, so the pin goes all the way to the verdict.
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/object-fields-io.ts'), 'export const diffFields = 1;\n');
    fs.writeFileSync(path.join(dir, 'src/DraftChangesPanel.tsx'), GLOB_PROSE_FIXTURE);

    const findings = scanSpecifiers({ name: 'p', dir: 'p', srcDir: path.join(dir, 'src') });
    expect(findings).toHaveLength(1);
    expect(findings[0].spec).toBe('./object-fields-io');
    expect(findings[0].line).toBe(3);
  });

  it('is not fooled by the same glob inside an ordinary string literal', () => {
    // The other half of the class the parser removes. The retired mask had no
    // notion of a string either, so a const holding the glob opened exactly the
    // same fake comment. Also a zero-specifier source under the old code.
    const source = [
      "export const CHUNK_GLOB = '@objectstack/*';",
      "import { diffFields } from './object-fields-io';",
      '/** Doc. */',
      'export const used = diffFields;',
      '',
    ].join('\n');

    expect(relativeSpecifiers(source, 'chunks.ts')).toEqual([
      { specifier: './object-fields-io', kind: 'import', line: 2 },
    ]);
  });

  it('reads JSX, so a `.tsx` file is not silently half-parsed', () => {
    const source = [
      "import { Panel } from './Panel';",
      '',
      'export const View = () => <Panel title="a > b" />;',
      '',
    ].join('\n');

    expect(relativeSpecifiers(source, 'View.tsx').map((use) => use.specifier)).toEqual(['./Panel']);
  });

  it('reports the SPECIFIER line, not the line the statement opens on', () => {
    // `tsc` reports this class at the specifier. Measured, for a fixture whose
    // statement opens on line 1 and whose specifier sits on line 4:
    //
    //   src/index.ts(8,8): error TS2835: Relative import paths need explicit
    //     file extensions ... Did you mean './a.js'?
    //
    // The two disagree for 255 of this repository's 2066 relative specifiers,
    // by up to 7 lines, so this is not a hypothetical distinction. The retired
    // regex matched at `from`, which shares the specifier's line; that accuracy
    // is preserved rather than traded away for the parser's statement position.
    const source = ['import {', '  a,', '  b,', "} from './wide';", ''].join('\n');
    expect(relativeSpecifiers(source, 'wide.ts')).toEqual([
      { specifier: './wide', kind: 'import', line: 4 },
    ]);
  });

  describe('the counter-probe — a zero is only worth what the same method still finds', () => {
    // "No hidden specifiers" means nothing unless the method that reports it is
    // still capable of seeing the real ones AND of ignoring the prose. Both
    // buckets are asserted, because a scanner that returned nothing at all
    // would satisfy the first half of this file's promise and none of the
    // second. Measured over the repository at 478ec54ce: 2139 textual
    // occurrences of the specifier grammar, 2133 real module edges reported, 6
    // prose-only occurrences correctly not reported.
    const PROSE_ONLY = [
      '/**',
      ' * Usage:',
      " *   import { translateMetadataType } from './i18n';",
      ' */',
      "// export { ObjectStackAdapter } from './objectstack-adapter';",
      "import { real } from './real-module';",
      "export * from './another-real-module';",
      '',
    ].join('\n');

    it('still reports every specifier that is genuinely present', () => {
      expect(relativeSpecifiers(PROSE_ONLY, 'probe.ts').map((use) => use.specifier)).toEqual([
        './real-module',
        './another-real-module',
      ]);
    });

    it('still reports none of the ones that are only prose', () => {
      const reported = relativeSpecifiers(PROSE_ONLY, 'probe.ts').map((use) => use.specifier);
      expect(reported).not.toContain('./i18n');
      expect(reported).not.toContain('./objectstack-adapter');
    });
  });

  it('grades the ESM forms only, and says which those are', () => {
    // The shared scanner reads all five forms that make a module edge. The two
    // CommonJS ones are not resolved by Node's ESM resolver at all, so grading
    // them here would answer a different question with this gate's message.
    // Measured before excluding them: ZERO relative `require()` or
    // `import =` edges exist in any specifier-preserving package, so the
    // exclusion narrows nothing today — it is pinned so that stays deliberate.
    expect([...ESM_MODULE_EDGE].sort()).toEqual(['dynamic import()', 'export', 'import', 'import()-type']);

    const commonjs = ["const a = require('./cjs-dep');", "import b = require('./cjs-equals');", ''].join('\n');
    expect(relativeSpecifiers(commonjs, 'cjs.ts')).toEqual([]);
  });

  it('never reports a bare package name, however relative it looks', () => {
    const source = ["import { canonicalMetaUrlType } from '@objectstack/spec/shared';", ''].join('\n');
    expect(relativeSpecifiers(source, 'a.ts')).toEqual([]);
  });
});

describe('the ledger is a ratchet', () => {
  it('records a reason for every entry, so no name is unexplained', () => {
    for (const [name, reason] of SPECIFIER_DEBT) {
      expect(name).toMatch(/^@object-ui\//);
      expect(reason.length).toBeGreaterThan(10);
    }
    for (const [name, reason] of UNBUNDLED_NODE_UNSUPPORTED) {
      expect(name).toMatch(/^@object-ui\//);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it('cites a ruling on every boundary entry, so no exemption is a bare name', () => {
    // objectui#5384 turned these three from debt into a permanent statement:
    // unbundled Node consumption is not supported for style-carrying plugin
    // packages. A permanent exemption a reader cannot trace is how it becomes a
    // mystery three months later — the reason and the ruling have to come from
    // the ENTRY, not from the fact that a name sits in a map. This is the pin
    // that makes adding a bare name fail.
    for (const reason of UNBUNDLED_NODE_UNSUPPORTED.values()) {
      expect(reason).toMatch(/objectui#\d+/);
      expect(reason).toMatch(/unbundled Node is not supported/);
    }
  });

  it('holds exactly the group the ruling covered, so it cannot widen quietly', () => {
    // The ruling was taken over the style-carrying packages as a GROUP rather
    // than one at a time, which is also what keeps the boundary describable in
    // one sentence. A fourth name is a new product decision, not a spelling
    // change, so it has to come here and say so.
    expect([...UNBUNDLED_NODE_UNSUPPORTED.keys()].sort()).toEqual([
      '@object-ui/app-shell',
      '@object-ui/plugin-dashboard',
      '@object-ui/plugin-map',
    ]);
  });

  it('keeps the two ledgers disjoint — they answer different questions', () => {
    // SPECIFIER_DEBT is this defect class. UNBUNDLED_NODE_UNSUPPORTED is "can an
    // unbundled consumer load this at all", which is a product question that has
    // been answered and closed. Merging them would let the defect stop being
    // visible inside a grab-bag.
    for (const name of UNBUNDLED_NODE_UNSUPPORTED.keys()) expect(SPECIFIER_DEBT.has(name)).toBe(false);
  });

  it('does not ledger the packages objectui#4538 fixed', () => {
    for (const fixed of [
      '@object-ui/react',
      '@object-ui/types',
      '@object-ui/core',
      '@object-ui/i18n',
    ]) {
      expect(SPECIFIER_DEBT.has(fixed)).toBe(false);
      expect(UNBUNDLED_NODE_UNSUPPORTED.has(fixed)).toBe(false);
    }
  });
});

/**
 * objectui#7276 — the gate said it refuses artifacts it did not produce, over
 * a build that could not keep the promise.
 *
 * Measured on turbo 2.10.9, which announces it on every run as `using shared
 * worktree cache`: the cache is keyed by input hash and stored in the MAIN
 * checkout's `.turbo/cache`, so a `pnpm build` in one worktree is routinely
 * satisfied by an entry a sibling worktree wrote, and turbo restores that
 * worktree's artifacts and its log here. Reproduced in this repository at
 * 52cac38 — a second worktree of the same commit replayed all 43 build tasks
 * in 272ms, every task log naming the producing worktree.
 *
 * The direction these pins exist for is the SILENT one. A red over someone
 * else's artifacts is at least loud, however misattributed; a GREEN over
 * someone else's artifacts is a verdict about a tree the caller is not
 * standing in, and no exit code told the two apart.
 *
 * So the shape under test is: `own` is the ONLY verdict that lets the load leg
 * speak, and every other outcome — including both ways of not knowing — is a
 * refusal that names itself. A provenance check that answered "sure" when it
 * could not read its marker would be this card's own subject matter one level
 * up, which is why the not-knowing cases are pinned as hard as the wrong-tree
 * one.
 */
describe('objectui#7276 — the load leg grades only what this tree produced', () => {
  /** A package directory with a turbo task log in it, as turbo leaves one. */
  const withTaskLog = (log: string) => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, path.dirname(TURBO_TASK_LOG)), { recursive: true });
    fs.writeFileSync(path.join(dir, TURBO_TASK_LOG), log);
    return dir;
  };

  /** pnpm's banner, in the shape every one of this repo's 43 build logs has. */
  const taskLog = (name: string, version: string, dir: string, script = 'tsc') =>
    ['', `> ${name}@${version} build ${dir}`, `> ${script}`, '', '✓ done', ''].join('\n');

  it('accepts a log whose banner names the directory it is sitting in', () => {
    const dir = withTaskLog('');
    fs.writeFileSync(path.join(dir, TURBO_TASK_LOG), taskLog('@object-ui/types', '17.6.0', dir));
    expect(buildProvenance(dir)).toEqual({ code: PROVENANCE_OK, producedIn: dir });
  });

  it('NAMES the foreign directory, which is the only thing that tells two greens apart', () => {
    // The line as it was actually observed, from the card: a run in
    // objectui-issue-6291 whose replayed log named objectui-issue-6606.
    const dir = withTaskLog('');
    const foreign = '/home/user/objectui-issue-6606/examples/byo-backend-console';
    fs.writeFileSync(
      path.join(dir, TURBO_TASK_LOG),
      taskLog('@object-ui/example-byo-backend-console', '0.1.0', foreign, 'tsc && vite build'),
    );
    expect(buildProvenance(dir)).toEqual({ code: 'foreign', producedIn: foreign });
  });

  it('refuses a package with no task log at all, rather than grading it', () => {
    // `--no-build` on a tree nobody built, and the state a new worktree is in.
    // Artifacts can still be lying there from anything; nothing says who.
    expect(buildProvenance(tmpdir())).toEqual({ code: 'no-build-log', producedIn: null });
  });

  it('refuses a log whose first `> ` line is not the banner, rather than guessing', () => {
    // The failure mode of the day turbo or pnpm changes that line: every
    // package in the repository refuses at once and the message says which two
    // identifiers to update. Loud and wrong beats quiet and green.
    const dir = withTaskLog(['', '> tsc && vite build', '', 'built'].join('\n'));
    expect(buildProvenance(dir)).toEqual({ code: 'unreadable-build-log', producedIn: null });
  });

  it('reads the FIRST `> ` line only, so a later look-alike cannot answer for it', () => {
    // A build's own stdout is not a provenance record. If the parser scanned on
    // until something matched, any tool that echoes a pnpm-shaped line would be
    // able to vouch for the tree.
    const dir = withTaskLog(
      ['', '> tsc && node ./tool.mjs', '> @evil/pkg@1.0.0 build /somewhere/else', ''].join('\n'),
    );
    expect(buildProvenance(dir)).toEqual({ code: 'unreadable-build-log', producedIn: null });
  });

  it('compares resolved paths, so a non-normalized banner is not a false foreign', () => {
    const dir = withTaskLog('');
    const same = path.join(dir, 'sub', '..');
    fs.writeFileSync(path.join(dir, TURBO_TASK_LOG), taskLog('@object-ui/core', '17.6.0', same));
    expect(buildProvenance(dir).code).toBe(PROVENANCE_OK);
  });

  it('pins the marker PATH, because every fixture here moves with the constant', () => {
    // Measured, and the reason this assertion is a literal: ablating
    // TURBO_TASK_LOG to a different filename left all 52 tests in this file
    // green. Every test above WRITES the log at TURBO_TASK_LOG, so they follow
    // the constant wherever it goes and vouch for nothing — a sweep that is
    // self-consistent with the thing it is checking is this card's own subject
    // matter. The literal makes moving it a decision somebody takes on purpose.
    //
    // The real-world signal is elsewhere, and it is loud by construction: if
    // turbo stops writing its task log here, EVERY package refuses at once as
    // `no-build-log`, and PROVENANCE_REMEDY names the two identifiers to fix.
    expect(TURBO_TASK_LOG).toBe(path.join('.turbo', 'turbo-build.log'));
  });

  it('keeps exactly ONE accepting verdict, so the check cannot widen quietly', () => {
    // The way this degrades into a no-op is a second "close enough" verdict.
    // Every code that is not PROVENANCE_OK carries a remedy, and the accepting
    // one carries none — that asymmetry is the pin.
    expect(PROVENANCE_OK).toBe('own');
    expect(Object.keys(PROVENANCE_REMEDY)).not.toContain(PROVENANCE_OK);
    expect(Object.keys(PROVENANCE_REMEDY).sort()).toEqual([
      'foreign',
      'no-build-log',
      'unreadable-build-log',
    ]);
    for (const remedy of Object.values(PROVENANCE_REMEDY)) expect(remedy.length).toBeGreaterThan(40);
  });

  /**
   * The anti-vacuous leg: the check must still be reading REAL banners.
   *
   * Every assertion above is a fixture, and a fixture keeps passing after the
   * thing it models has moved. So this one is built from the repository's own
   * manifests — real names (scoped and not), real versions, real build scripts
   * — and asserts both directions on each: the banner line pnpm writes for that
   * package is recognised, and the second line of that package's own build
   * script is NOT. A floor under the sweep keeps it from becoming a loop over
   * nothing, which is the same failure this whole file exists to refuse.
   */
  it('recognises the banner, and only the banner, for EVERY published package', () => {
    // The slice of `discoverPackages`' result these assertions read, narrowed
    // once here rather than at each use, in the same spirit as
    // `ParsedTsconfig` above: the walk returns JSON, and a wrong assumption
    // about a field should still be a type error.
    type DiscoveredPackage = {
      manifest: { name: string; version: string; private?: boolean; scripts?: Record<string, string> };
    };
    const discovered = discoverPackages(REPO_ROOT) as DiscoveredPackage[];
    const published = discovered.filter((pkg) => !pkg.manifest.private);
    expect(published.length).toBeGreaterThanOrEqual(MIN_PACKAGES);

    for (const pkg of published) {
      const { name, version, scripts } = pkg.manifest;
      const buildScript = scripts?.build;
      if (!buildScript) continue;

      const dir = withTaskLog('');
      fs.writeFileSync(path.join(dir, TURBO_TASK_LOG), taskLog(name, version, dir, buildScript));
      expect(buildProvenance(dir), `banner for ${name}`).toEqual({ code: PROVENANCE_OK, producedIn: dir });

      // The same package's build-script line, alone: never mistakable for a
      // banner, or a multi-command build could vouch for the wrong tree.
      fs.writeFileSync(path.join(dir, TURBO_TASK_LOG), ['', `> ${buildScript}`, ''].join('\n'));
      expect(buildProvenance(dir).code, `build script line for ${name}`).toBe('unreadable-build-log');
    }
  });
});
