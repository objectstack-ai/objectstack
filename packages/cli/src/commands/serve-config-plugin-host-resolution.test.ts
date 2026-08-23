import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import Serve from './serve.js';

/**
 * `plugins: [...]` in the served app's own `objectstack.config.ts` is THE
 * documented way to extend a deployment, and its string entries are the most
 * app-owned specifiers in `serve.ts`. They were loaded with a bare `import()`,
 * which Node ESM resolves against the CLI's realpath — so a plugin the APP
 * declares could only be served where it happened to be hoisted somewhere the
 * CLI could see. Green in a dev checkout, absent on a real distribution layout
 * (#10908; the same mechanism as cloud#1013 and #10645).
 *
 * The repair moves ONLY the declared case. These tests pin every branch the
 * method has, including the ones that exist to keep behaviour a naive
 * `await importFromHost(specifier)` would have taken away — see
 * `Serve.importConfigPlugin` for the measurements.
 *
 * ⚠️ #11157 collapsed the shape from three branches to two: once `importFromHost`
 * hands `createHostImporter` this file's own resolver (`fallbackImport`), the
 * helper's undeclared leg IS the local `import()` the undeclared branch used to
 * make, so that branch and the re-entry branch became one call. Every assertion
 * below is unchanged and still describes real behaviour — that is what made the
 * collapse safe to take. The one that had to move is the structural one at the
 * bottom: the declaration read now has a single owner inside the helper.
 */

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/**
 * An app root with its own `package.json`, optionally DECLARING `pkgName` and
 * optionally carrying it in its own `node_modules`. Nothing is installed or
 * built: the package is two files in a temp dir, and its marker export is how a
 * test proves WHICH copy loaded.
 */
function makeApp(
  pkgName: string,
  opts: { declare: boolean; install: boolean; marker?: string },
): string {
  const root = mkdtempSync(join(tmpdir(), 'os-cfg-plugin-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      version: '1.0.0',
      type: 'module',
      ...(opts.declare ? { dependencies: { [pkgName]: '1.0.0' } } : {}),
    }),
  );
  if (opts.install) {
    const dir = join(root, 'node_modules', ...pkgName.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: pkgName, version: '1.0.0', type: 'module', main: 'index.js' }),
    );
    writeFileSync(
      join(dir, 'index.js'),
      `export default { name: ${JSON.stringify(opts.marker ?? 'app-copy')} };\n`,
    );
  }
  return root;
}

// A name no workspace package can satisfy, so a pass can never come from the
// CLI's own node_modules by accident.
const APP_ONLY = '@os-fixture/config-plugin-probe';

describe('os serve → an app-declared `plugins: [...]` package resolves from the APP (#10908)', () => {
  it('loads the copy the served app declares and carries — the defect, repaired', async () => {
    const root = makeApp(APP_ONLY, { declare: true, install: true, marker: 'app-copy' });

    // The failing hop, reproduced first: this file resolves from `packages/cli`
    // exactly as `dist/commands/serve.js` does, and cannot see the app's package.
    const bare: string = APP_ONLY;
    await expect(import(bare)).rejects.toMatchObject({
      code: expect.stringMatching(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/),
    });

    const mod = await Serve.importConfigPlugin(APP_ONLY, root);
    expect(mod.default).toEqual({ name: 'app-copy' });
  });

  it("prefers the APP's copy over the CLI's own when BOTH can resolve the name", async () => {
    // The resolution-policy question the card names: which copy wins when the
    // CLI also ships the package. `chalk` is declared by packages/cli and
    // resolves from this file, so a fixture app that declares its OWN `chalk`
    // is the only way to tell the two apart — and the app's declaration is the
    // contract (#4719), so the app's copy must win.
    const root = makeApp('chalk', { declare: true, install: true, marker: 'app-owned-chalk' });

    const mod = await Serve.importConfigPlugin('chalk', root);

    expect(mod.default).toEqual({ name: 'app-owned-chalk' });
    // Not a tautology: the CLI's own resolution of the same name finds the real
    // package, which is what this line would have loaded before the fix.
    const cliCopy: any = await import('chalk');
    expect(cliCopy.default).not.toEqual({ name: 'app-owned-chalk' });
  });

  it('a package the app DECLARES but never installed reports the INSTALL remedy, not an absence', async () => {
    const root = makeApp(APP_ONLY, { declare: true, install: false });

    const err = await Serve.importConfigPlugin(APP_ONLY, root).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain(`Failed to import plugin '${APP_ONLY}':`);
    // The app asked for it, so re-reading the manifest is not the remedy.
    expect(err.message).toContain('DECLARES it');
    expect(err.message).toMatch(/INSTALL problem, not a declaration problem/);
  });
});

/**
 * Triage ② on #10908: host-anchoring changes the user-facing text a missing
 * plugin produces — the wrapper now nests `createHostImporter`'s #4719 remedy.
 * That is a better diagnostic, but it is VISIBLE, so it is pinned here as a
 * chosen behaviour rather than left to drift.
 */
describe('os serve → the missing-plugin diagnostic is a chosen text (#10908 / #4719)', () => {
  it('names the plugin, then tells the author to DECLARE it in that app', async () => {
    const root = makeApp(APP_ONLY, { declare: false, install: false });

    const err = await Serve.importConfigPlugin(APP_ONLY, root).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    // The wrapper `serve` has always put around a failed plugin load.
    expect(err.message).toContain(`Failed to import plugin '${APP_ONLY}':`);
    // …now carrying the #4719 remedy instead of a bare "Cannot find package".
    expect(err.message).toMatch(/Declare it in that app's package\.json/);
    expect(err.message).toContain(root);
    // The gate's own reasoning survives into what the user reads: being merely
    // reachable is refused ON PURPOSE, so nobody "fixes" this with NODE_PATH.
    expect(err.message).toMatch(/merely REACHABLE is not enough/);
  });
});

/**
 * The two branches that exist so this card could not take working deployments
 * away. Both were MEASURED against `createHostImporter` before being written:
 * its pass-through and its undeclared fallback both re-enter `import()` from
 * inside `@objectstack/types`, which moves the resolution base.
 */
describe('os serve → the branches that must NOT move (#10908 supersedes nothing)', () => {
  it('keeps this CLI as the resolver for a package the app does not declare', async () => {
    // `chalk` is declared by packages/cli and by no fixture app. An app that
    // writes `plugins: ['@objectstack/plugin-auth']` without declaring it boots
    // today, and this is the assertion that says it still does.
    //
    // ⚠️ This assertion is why #11157 had to land BEFORE the branch collapse and
    // not after. It used to be kept true by a local `import()` here; it is now
    // kept true by `importFromHost` carrying this file's base. Take the base
    // away and this line goes red — measured, and pinned again from the other
    // side (with the no-base control beside it) in
    // `serve-host-fallback-base.test.ts`.
    const root = makeApp(APP_ONLY, { declare: false, install: false });

    const mod = await Serve.importConfigPlugin('chalk', root);
    expect(mod.default ?? mod).toBeTruthy();
  });

  // ⚠️ REPLACED, not reworded (#10944). This slot used to pin that a RELATIVE
  // specifier stayed anchored to serve.ts rather than being re-based under
  // `@objectstack/types/dist/` — i.e. it pinned the exact branch #10944 has
  // since removed. #10944 ruled that neither base is the served app's root, so
  // the spelling is now refused at load instead of resolved anywhere; keeping
  // the old assertion would have pinned a resolution that no longer runs.
  // The refusal, the two spellings that do work, and the full shape matrix live
  // in `serve-config-plugin-relative-refusal.test.ts`. What remains here is the
  // half that is still this file's business: the refusal must not have widened
  // to the base-independent spellings this branch exists to protect.
  it('refuses a RELATIVE specifier without touching the base-independent ones (#10944)', async () => {
    const root = makeApp(APP_ONLY, { declare: false, install: false });
    const missing = './__no_such_config_plugin_10908__.js';

    const err = await Serve.importConfigPlugin(missing, root).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(Serve.relativePluginSpecifierRefusal(missing));
    // The refusal replaces a resolution attempt, so no base is reported at all.
    expect(err.message).not.toContain('types/dist');
    // …and an absolute path — the spelling the refusal points at — is
    // untouched, which is what makes the line above a narrowing and not a ban.
    const file = join(root, 'still-loads.js');
    writeFileSync(file, 'export default { name: "still-loads" };\n');
    const mod: any = await Serve.importConfigPlugin(file, root);
    expect(mod.default).toEqual({ name: 'still-loads' });
  });

  it('loads an absolute path and a file:// URL unchanged (base-independent spellings)', async () => {
    const root = makeApp(APP_ONLY, { declare: false, install: false });
    const file = join(root, 'local-plugin.js');
    writeFileSync(file, 'export default { name: "app-local-plugin" };\n');

    for (const spelling of [file, pathToFileURL(file).href]) {
      const mod = await Serve.importConfigPlugin(spelling, root);
      expect(mod.default).toEqual({ name: 'app-local-plugin' });
    }
  });
});

describe('os serve → the config-plugin load stays wired to the helper', () => {
  const SERVE_SOURCE = readFileSync(new URL('./serve.ts', import.meta.url), 'utf8');

  it('the boot loop calls the helper and no longer bare-imports the entry', () => {
    expect(SERVE_SOURCE).toContain('await Serve.importConfigPlugin(plugin, hostRoot)');
    // The exact shape the card was filed against — it must not come back.
    expect(SERVE_SOURCE).not.toMatch(/const imported = await import\(plugin\)/);
  });

  it('the declaration decides the resolver, so the gate keeps its say (#4719)', () => {
    // A helper that reached the app's copy by some route OTHER than the host
    // importer would still pass the behavioural tests above, so pin the wiring.
    //
    // ⚠️ This used to also require `isDeclaredByHost(pluginSpecifier, root)` in
    // this method. #11157 removed that call — not the check. `importFromHost`
    // now carries this file's resolution base, which made the local undeclared
    // branch identical to the helper's own fallback, so the declaration is read
    // exactly once, by `readHostDeclaration` inside `createHostImporter`. Asking
    // the same question twice in two places is the fork Prime Directive #12
    // exists to prevent; requiring the second copy HERE would have pinned it.
    // The single owner is pinned in `packages/types/src/node.test.ts`.
    const helper = SERVE_SOURCE.slice(SERVE_SOURCE.indexOf('static async importConfigPlugin'));
    const body = helper.slice(0, helper.indexOf('\n  }\n'));
    expect(body).toContain('importFromHost(pluginSpecifier, root)');
    // The resolver is never chosen by a second, local reading of the manifest.
    expect(body).not.toContain('isDeclaredByHost');
    // …and the entry is never handed to a bare `import()` once it names a
    // package: that is the #10908 defect itself.
    expect(body).not.toMatch(/if \(isDeclaredByHost/);
  });
});
