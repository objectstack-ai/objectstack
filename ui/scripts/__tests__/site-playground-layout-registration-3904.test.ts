import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3904 — two faces of the same defect class: a capability the docs site
 * *declares* but does not actually wire into the graph.
 *
 * Face 1 — the fourth `SchemaRenderer` host. `ComponentRegistry` only knows a
 * type once the package owning it has been loaded, so #3787 added
 * `apps/site/app/components/registerLayoutBlocks.ts` and imported it for effect
 * from the three hosts that render CATALOG examples (`InteractiveDemo`,
 * `SchemaThumbnail`, `LiveSplitDemo`). The Playground renders HAND-TYPED schemas
 * and was outside that acceptance surface, so it kept resolving `page-header` to
 * nothing and painting the red OBJUI-001 "Unknown component type" panel — for a
 * component the rest of the site rendered fine. The placeholder net did not catch
 * it either: `page-header` then lived in the opt-in `PROTOCOL_COMPONENTS` of
 * `packages/components/src/renderers/placeholders.tsx`, not in the eagerly
 * registered `PALETTE_PLACEHOLDER_BLOCKS`, and `registerPlaceholders()` is only
 * called by `apps/console`. (objectui#10859 batch 8 later retired `page-header`
 * itself; the registrar still carries `@object-ui/layout`'s other blocks, so the
 * defect class this file pins is unchanged.)
 *
 * This is pinned by DISCOVERY, not by a hardcoded list of four: the bug was a host
 * that nobody remembered to add. A fifth host added tomorrow is caught the same
 * way the Playground should have been.
 *
 * Face 2 — `transpilePackages` entries that are not dependencies. Next resolves
 * each name as `<pkg>/package.json` **from the app directory** to decide what to
 * bundle rather than externalize (`makeExternalHandler` in
 * `next/dist/build/handle-externals.js`), and matches resolved module paths
 * against a `node_modules/(<names>)/` regex (`webpack-config.js`). Under pnpm's
 * strict linker an UNDECLARED package is unresolvable from `apps/site`, so both
 * consumers miss it and the entry does exactly nothing. `@object-ui/i18n` and
 * `@object-ui/plugin-aggrid` sat there in that state (`plugin-aggrid` does not
 * even exist in the workspace any more).
 *
 * Why that is worth a test rather than a one-off deletion: `@object-ui/layout`
 * had the identical shape before #3787 — listed in `transpilePackages`, neither
 * declared nor imported — and it read to every reader as "already supported"
 * while the browser showed a red panel. A dead entry here is worse than a missing
 * one, and only browser testing found it. This check is the cheap mechanical
 * version of that browser lap.
 *
 * Reverse verification (direction predicted before running, both plain RED):
 *  - drop the `registerLayoutBlocks` import from `app/playground/page.tsx` and the
 *    first suite fails naming that file;
 *  - put `@object-ui/i18n` back into `transpilePackages` and the second suite
 *    fails naming it as undeclared.
 *
 * Deliberately NOT in scope (severable, see the issue): how far the Playground's
 * component coverage should go at all — it also lacks `plugin-detail`, so every
 * `record:*` type is still unregistered there. That is a product call about the
 * Playground's palette, not this registration gap.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE_APP_DIR = path.join(repoRoot, 'apps/site/app');
const SITE_PKG_DIR = path.join(repoRoot, 'apps/site');

/** The module every `SchemaRenderer` host must pull in for its side effect. */
const REGISTRAR = 'registerLayoutBlocks';

/** JSX usage — a file that actually RENDERS through the renderer. */
const RENDERS_SCHEMA = /<SchemaRenderer[\s/>]/;

const SOURCE_FILE = /\.tsx?$/;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(abs));
    else if (SOURCE_FILE.test(entry.name)) out.push(abs);
  }
  return out;
}

/** Repo-relative paths of the site files that render through `SchemaRenderer`. */
function schemaRendererHosts(): string[] {
  return collectSourceFiles(SITE_APP_DIR)
    .filter((abs) => RENDERS_SCHEMA.test(fs.readFileSync(abs, 'utf8')))
    .map((abs) => path.relative(repoRoot, abs))
    .sort();
}

describe('objectui#3904 — every apps/site SchemaRenderer host registers the layout blocks', () => {
  const hosts = schemaRendererHosts();

  it('finds the hosts at all (a zero-hit discovery would make the next case vacuously green)', () => {
    // The failure mode this guards: `SchemaRenderer` gets renamed or the hosts
    // move out of `app/`, discovery returns [], and the assertion below passes
    // while checking nothing — the empty-fixture trap.
    expect(hosts.length).toBeGreaterThanOrEqual(4);
    expect(hosts).toContain('apps/site/app/playground/page.tsx');
  });

  it.each(hosts)('%s imports the layout-block registrar', (host) => {
    const source = fs.readFileSync(path.join(repoRoot, host), 'utf8');

    // Any import form is fine — the three catalog hosts use the relative
    // `./registerLayoutBlocks`, the Playground the `@/app/components/...` alias it
    // already uses for its provider. What matters is that the module is in the
    // host's import graph, at module scope, so registration has happened before
    // the server render.
    const imports = new RegExp(`^\\s*import\\s+['"][^'"]*${REGISTRAR}['"];?\\s*$`, 'm');

    expect(
      imports.test(source),
      `${host} renders <SchemaRenderer> but never imports ${REGISTRAR}, so types owned by ` +
        '@object-ui/layout (app-schema-renderer, layout:page:card) resolve to nothing and render ' +
        'the red OBJUI-001 panel. Add: import ' +
        "'@/app/components/registerLayoutBlocks';"
    ).toBe(true);
  });
});

describe('objectui#3904 — the registrar the hosts import actually registers the blocks', () => {
  /**
   * The middle link of the chain. Without it the suite above is satisfied by an
   * import of a module that registers nothing.
   *
   * The far end — `registerLayout()` really putting its blocks into the
   * `ComponentRegistry` — is already pinned next to the implementation, in
   * `packages/layout/src/__tests__/page-header-authorable-keys.test.tsx`, whose
   * lit control is `app-schema-renderer` under both spellings (the `page-header`
   * key this file first cited was retired by objectui#10859 batch 8, and the
   * `responsive-grid` control after it by objectui#11441), so it is
   * deliberately not restated here: that file owns it.
   */
  const registrar = fs.readFileSync(
    path.join(SITE_APP_DIR, 'components/registerLayoutBlocks.ts'),
    'utf8'
  );

  it('imports registerLayout from @object-ui/layout', () => {
    expect(registrar).toMatch(/import\s*\{[^}]*\bregisterLayout\b[^}]*\}\s*from\s*['"]@object-ui\/layout['"]/);
  });

  it('CALLS it at module scope rather than relying on the package side effect', () => {
    // `@object-ui/layout` declares `"sideEffects": false`, which permits a bundler
    // to drop a module imported only for effect. An invoked named import cannot be
    // dropped. Module scope (not an effect) also means registration has happened
    // before the server render.
    expect(registrar).toMatch(/^registerLayout\(\);?\s*$/m);
  });
});

describe('objectui#3904 — every apps/site transpilePackages entry is a real dependency', () => {
  const nextConfig = fs.readFileSync(path.join(SITE_PKG_DIR, 'next.config.mjs'), 'utf8');

  /**
   * Parsed out of the source text rather than by importing the config: the module
   * pulls in `fumadocs-mdx/next`, which is not something a node-env unit test
   * should have to boot to read a list of strings.
   */
  function transpilePackages(): string[] {
    const block = /transpilePackages:\s*\[([^\]]*)\]/.exec(nextConfig);
    if (!block) throw new Error('apps/site/next.config.mjs has no transpilePackages array');
    return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  const declared = (() => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SITE_PKG_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  })();

  const entries = transpilePackages();

  it('reads a non-empty list (the array being non-empty is also what enables external-dir compilation)', () => {
    // `shouldIncludeExternalDirs = experimental.externalDir || !!transpilePackages`
    // in Next's webpack config: emptying this array would stop the workspace
    // `packages/*` sources compiling at all. Removing dead NAMES from a still
    // non-empty array does not touch that.
    expect(entries.length).toBeGreaterThan(0);
  });

  it('lists no package that apps/site does not depend on', () => {
    const undeclared = entries.filter((name) => !declared.has(name));

    expect(
      undeclared,
      'These transpilePackages entries are not dependencies of apps/site, so Next cannot resolve ' +
        'them from the app directory and the entries do nothing — while reading as if the site ' +
        'already supported those packages (objectui#3904). Either add the dependency or drop the ' +
        'entry.'
    ).toEqual([]);
  });

  it('no longer lists the two dead entries', () => {
    // Named explicitly: the generic check above would also go green if someone
    // "fixed" it by declaring dependencies the site does not use.
    expect(entries).not.toContain('@object-ui/i18n');
    expect(entries).not.toContain('@object-ui/plugin-aggrid');
  });

  it('every entry is actually resolvable from apps/site, which is what Next requires', () => {
    // The declared-dependency check above is the authoring rule; this is the
    // measured consequence of it under pnpm's strict linker, and the exact
    // property the two dead entries failed. Skipped when the app has not been
    // installed (nothing to measure), never weakened.
    const linked = path.join(SITE_PKG_DIR, 'node_modules');
    if (!fs.existsSync(linked)) return;

    const missing = entries.filter((name) => !fs.existsSync(path.join(linked, name)));

    expect(
      missing,
      `Not linked into apps/site/node_modules: ${missing.join(', ')}. Next resolves each ` +
        'transpilePackages name from the app directory, so an unlinked entry is inert.'
    ).toEqual([]);
  });
});
