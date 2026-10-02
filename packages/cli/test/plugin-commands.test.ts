import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The published `os` binary's oclif plugin surface.
 *
 * Command extension is handled by oclif's plugin system: a plugin package
 * carries its own `oclif` config and exports oclif Command classes from
 * `src/commands/`. The host project's `objectstack.config.ts` does not decide
 * which CLI commands exist.
 *
 * This package ships NO plugin manager and loads no plugin of its own. It used
 * to list `@oclif/plugin-help` and `@oclif/plugin-plugins` under
 * `oclif.plugins` while both sat in `devDependencies`. `@oclif/core`'s
 * core-plugin loader (`lib/config/plugin-loader.js`, `loadCorePlugins`)
 * matches `oclif.plugins` names only against `dependencies`, so neither ever
 * loaded: `os plugins …` and `os help` were never commands, and `os --help`
 * read the same with or without the array. The array was dead configuration,
 * and every text that read it as "`os plugins install` works" was false.
 *
 * What these pins hold is the state the published text now describes
 * (`README.md` → "`os plugins` and `os help` (not commands)" and "oclif Plugin
 * System"; `content/docs/plugins/index.mdx` → the Step 3 callout;
 * `bin/run.js` → the `enableAutoTranspile` note on linked plugins). Shipping a
 * plugin manager is a product change, not a manifest tweak: it lists the
 * plugin in BOTH `oclif.plugins` and `dependencies`, and corrects those texts
 * in the same change.
 */

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
] as const;

describe('oclif plugin surface — the published `os` ships no plugin manager', () => {
  it('declares no oclif.plugins (oclif would load an entry only from `dependencies`)', () => {
    expect(pkg.oclif).toBeDefined();
    expect(
      pkg.oclif.plugins,
      'package.json `oclif.plugins` is back. An entry here loads only when the same name is in `dependencies` ' +
        '(oclif loadCorePlugins); otherwise it is dead configuration. Either way README.md, ' +
        'content/docs/plugins/index.mdx and bin/run.js state that this CLI ships no plugin manager — change them with it.',
    ).toBeUndefined();
  });

  it('depends on no @oclif/plugin-* package in any dependency field', () => {
    const found = DEPENDENCY_FIELDS.flatMap((field) =>
      Object.keys(pkg[field] ?? {})
        .filter((name) => name.startsWith('@oclif/plugin-'))
        .map((name) => `${field}: ${name}`),
    );
    expect(
      found,
      'an oclif plugin package is listed. Not named in `oclif.plugins` + `dependencies`, it never loads and is dead ' +
        'weight; loaded, it makes `os plugins` / `os help` real and the published text false.',
    ).toEqual([]);
  });
});

describe('oclif command discovery and entry points', () => {
  it('discovers commands by pattern under dist/commands', () => {
    expect(pkg.oclif.commands).toBeDefined();
    expect(pkg.oclif.commands.strategy).toBe('pattern');
    expect(pkg.oclif.commands.target).toBe('./dist/commands');
  });

  it('points both bin entries at the oclif runner', () => {
    expect(pkg.bin.os).toBe('./bin/run.js');
    expect(pkg.bin.objectstack).toBe('./bin/run.js');
  });
});
