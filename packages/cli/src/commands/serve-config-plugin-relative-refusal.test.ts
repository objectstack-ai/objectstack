// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A RELATIVE `plugins: [...]` entry is refused at load, naming the two
 * spellings that work (#10944).
 *
 * ## The defect, measured before the fix
 *
 * `plugins: [...]` in the served app's own `objectstack.config.ts` is THE
 * documented way to extend a deployment. A string entry that is not a bare
 * package name was handed straight to `import()` — and ESM resolves a relative
 * specifier against the file CONTAINING the call, which is
 * `@objectstack/cli/dist/commands/serve.js`. The served app's root never
 * entered the resolution at all.
 *
 * Measured on `origin/main` from a fixture app that really did carry
 * `local-plugin.js` next to its `package.json`:
 *
 *     './local-plugin.js'  -> Cannot find module '<cli>/src/commands/local-plugin.js'
 *                             imported from '<cli>/src/commands/serve.ts'
 *     '../local-plugin.js' -> Cannot find module '<cli>/src/local-plugin.js'
 *     '..'                 -> LOADED — this package's own command barrel
 *                             (CompileCommand, ValidateCommand, ServeCommand, …)
 *
 * The app's own file was never seen in any of them, and the last row is the
 * whole point stated as a positive: a relative entry CAN load a module — it can
 * only ever load one belonging to the CLI. The boot loop then catches the
 * failure, prints one red line naming a path inside the CLI's install
 * directory, and serves the app WITHOUT the plugin, so the deployment looks
 * healthy while quietly missing the extension its config declared.
 *
 * ## Why refusal and not app-root resolution
 *
 * Ruled at triage on #10944. Refusing expands no accepted set — the spelling
 * has never loaded an app's file — and converts a diagnostic about the CLI's
 * internals into an answer the author can act on. Resolving relative entries
 * against the served app's root is a capability addition with no measured pull
 * (nothing in `content/docs`, `examples/` or the test suite writes the
 * spelling); it stays a maintainer decision, and this refusal is where such a
 * request would come from.
 *
 * ## What the tests below are shaped to catch
 *
 * ⚠️ A suite that only asserts "the relative entry is refused" passes just as
 * green on an implementation that refuses `plugins: [...]` ENTIRELY. So the
 * headline test asserts the refusal and BOTH working spellings in one body —
 * remove the narrowing from `Serve.isRelativePluginSpecifier` and that test
 * reddens on the loads, not on the refusal.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import Serve from './serve.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A name no workspace package can satisfy, so nothing passes by accident. */
const APP_ONLY = '@os-fixture/relative-refusal-probe';

/**
 * An app root that carries `local-plugin.js` NEXT TO its `package.json` — the
 * exact layout an author writing `plugins: ['./local-plugin.js']` has in mind —
 * and, when asked, declares and installs `APP_ONLY` as well.
 */
function makeApp(opts: { declare: boolean } = { declare: false }): string {
  const root = mkdtempSync(join(tmpdir(), 'os-10944-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      version: '1.0.0',
      type: 'module',
      ...(opts.declare ? { dependencies: { [APP_ONLY]: '1.0.0' } } : {}),
    }),
  );
  writeFileSync(join(root, 'local-plugin.js'), 'export default { name: "app-local-plugin" };\n');
  if (opts.declare) {
    const dir = join(root, 'node_modules', ...APP_ONLY.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: APP_ONLY, version: '1.0.0', type: 'module', main: 'index.js' }),
    );
    writeFileSync(join(dir, 'index.js'), 'export default { name: "declared-package" };\n');
  }
  return root;
}

describe('os serve → a relative `plugins: [...]` entry is refused (#10944)', () => {
  it('refuses the relative entry AND keeps both working spellings loading — one body, on purpose', async () => {
    const root = makeApp({ declare: true });
    const absolute = join(root, 'local-plugin.js');

    // (1) The shape the card was filed against. The file really is there, in
    // the app root, and it is still refused — because the app root was never
    // the base and this spelling cannot be made to mean it.
    const err = await Serve.importConfigPlugin('./local-plugin.js', root).catch(
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(Serve.relativePluginSpecifierRefusal('./local-plugin.js'));

    // (2) A DECLARED bare package name — spelling (a) the refusal names.
    const declared: any = await Serve.importConfigPlugin(APP_ONLY, root);
    expect(declared.default).toEqual({ name: 'declared-package' });

    // (3) An absolute path and a `file://` URL — spelling (b) the refusal
    // names. Both are base-independent, and both load the app's OWN file: the
    // very module (1) refused to reach by the relative spelling.
    for (const spelling of [absolute, pathToFileURL(absolute).href]) {
      const mod: any = await Serve.importConfigPlugin(spelling, root);
      expect(mod.default, spelling).toEqual({ name: 'app-local-plugin' });
    }
  });

  it('names spelling (a) — a bare package name the app DECLARES — in the message', () => {
    const message = Serve.relativePluginSpecifierRefusal('./local-plugin.js');
    expect(message).toContain('DECLARES in its own package.json');
    expect(message).toContain("plugins: ['@mycompany/crm']");
  });

  it('names spelling (b) — an absolute path or `file://` URL — in the message', () => {
    const message = Serve.relativePluginSpecifierRefusal('./local-plugin.js');
    expect(message).toContain('absolute path');
    expect(message).toContain('file://');
    // The form an author writing an app-local plugin file actually wants: the
    // CONFIG computes the absolute URL from its own location. Echoing the
    // author's own specifier makes the line copy-pasteable.
    expect(message).toContain("new URL('./local-plugin.js', import.meta.url).href");
  });

  it('says WHY, and does not promise app-root resolution is coming', () => {
    const message = Serve.relativePluginSpecifierRefusal('./local-plugin.js');
    // The consequence, concretely — this is the half that lets an author stop
    // hunting for a missing file.
    expect(message).toMatch(/CLI's own installation directory/);
    expect(message).toMatch(/never against your app/);
    // …and it does not claim an import was attempted, because none was.
    expect(message).not.toContain('Failed to import plugin');
    // Option A stays a maintainer decision; the message must not pre-announce
    // it (triage on #10944 is explicit about this).
    expect(message).not.toMatch(/coming soon|will be supported|in a future release/i);
  });

  it('classifies every specifier shape that reaches this line — measured, not assumed', async () => {
    // ⚠️ REFUSED and ALLOWED below are the boundary of this card. Each entry
    // was run through `Serve.importConfigPlugin` on `origin/main` first; the
    // ALLOWED ones all resolve to the SAME module regardless of which file
    // imports them, which is exactly why they are none of this rule's business.
    const REFUSED = [
      './local-plugin.js',   // the filed shape
      '../local-plugin.js',  // climbing out of the CLI's commands dir
      './nested/plugin.js',
      '.',                   // resolves to the CLI's own commands directory
      '..',                  // MEASURED: loaded the CLI's own command barrel
      '.\\local-plugin.js',  // Node's URL resolution normalises `\` to `/`
      '..\\local-plugin.js',
      './',
    ];
    const ALLOWED = [
      '/abs/local-plugin.js',                   // absolute POSIX path
      'file:///abs/local-plugin.js',            // file:// URL
      'C:\\app\\local-plugin.js',               // Windows drive path — absolute
      'C:/app/local-plugin.js',
      'node:path',                              // builtin; MEASURED: loads
      'data:text/javascript,export default 1',  // MEASURED: loads
      '@mycompany/crm',                         // scoped bare package name
      'chalk',                                  // unscoped bare package name
      // NOT relative under ESM: a bare specifier, even one that looks like a
      // filename. It keeps the #4719 "declare it in that app's package.json"
      // answer, which is the right one for a bare name — deliberately left
      // alone rather than folded into this refusal.
      'local-plugin.js',
      '.hidden-not-relative',                   // `.` not followed by a separator
    ];

    for (const s of REFUSED) {
      expect(Serve.isRelativePluginSpecifier(s), `REFUSED: ${JSON.stringify(s)}`).toBe(true);
    }
    for (const s of ALLOWED) {
      expect(Serve.isRelativePluginSpecifier(s), `ALLOWED: ${JSON.stringify(s)}`).toBe(false);
    }

    // The predicate is what the loader consults, so prove the two agree rather
    // than trusting the wiring: every REFUSED shape throws the refusal text,
    // and no ALLOWED shape ever does.
    const root = makeApp();
    for (const s of REFUSED) {
      const err = await Serve.importConfigPlugin(s, root).catch((e: unknown) => e as Error);
      expect(err, s).toBeInstanceOf(Error);
      expect(err.message, s).toBe(Serve.relativePluginSpecifierRefusal(s));
    }
    for (const s of ALLOWED) {
      // Most of these cannot resolve from a temp fixture, and that is fine —
      // what must never happen is the REFUSAL text.
      const outcome = await Serve.importConfigPlugin(s, root).catch((e: unknown) => e as Error);
      const message = outcome instanceof Error ? outcome.message : '';
      expect(message, s).not.toContain('Refused the plugin entry');
    }
  });
});

describe('os serve → the refusal is wired into the load, not just exported (#10944)', () => {
  it('the boot loop still routes every string entry through the refusing helper', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./serve.ts', import.meta.url), 'utf8');
    // Without this the behavioural tests above could all pass while the boot
    // loop bare-imported the entry and never reached the helper.
    expect(source).toContain('await Serve.importConfigPlugin(plugin, hostRoot)');
    const helper = source.slice(source.indexOf('static async importConfigPlugin'));
    expect(helper).toContain('Serve.isRelativePluginSpecifier(pluginSpecifier)');
    expect(helper).toContain('Serve.relativePluginSpecifierRefusal(pluginSpecifier)');
  });
});
