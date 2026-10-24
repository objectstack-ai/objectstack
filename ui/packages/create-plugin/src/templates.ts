/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every file `create-plugin` writes, as pure data.
 *
 * These builders live outside `index.ts` on purpose: `index.ts` calls
 * `program.parse()` at import time, so nothing can import it to inspect what
 * the generator produces. Moving the templates here makes the ARTIFACTS
 * testable — `src/__tests__/templates.test.ts` asserts the generated
 * `package.json`, `vite.config.ts`, `vitest.setup.ts` and example test are
 * mutually consistent, instead of grepping this source for strings.
 *
 * objectui#3716 is why that matters: the template shipped a `test` script and
 * an example test importing `@testing-library/react` + `toBeInTheDocument()`
 * while declaring neither library, and with no DOM test environment — so
 * `npm test` in a freshly scaffolded plugin was red on the very first run.
 */

import { PLUGIN_LICENSES, findLicense } from './licenses';

/** Values interpolated into the templates for one generated plugin. */
export interface PluginTemplateVars {
  /** Full package name, e.g. `@object-ui/plugin-heatmap`. */
  packageName: string;
  /** Plugin name without the `plugin-` prefix, e.g. `heatmap`. Also the registry key. */
  pluginName: string;
  /** PascalCase component name, e.g. `Heatmap`. */
  pascalName: string;
  description: string;
  author: string;
  /**
   * SPDX id of the licence the author chose, e.g. `MIT` (objectui#8041).
   *
   * Always one of {@link PLUGIN_LICENSES}' ids — `index.ts` runs the prompt's
   * answer through `resolveLicenseId` first, so a non-TTY run, a cancelled
   * prompt and a junk value all arrive here as `MIT`. It is a REQUIRED field
   * rather than an optional one with a default here, because a default in two
   * places is two answers to one question.
   *
   * ENFORCED, not merely documented: {@link buildLicenseFile} refuses anything
   * else (objectui#8892). Five of the six places this id is emitted interpolate
   * it verbatim, so a value the licence table has no text for would ship a
   * plugin whose LICENSE contradicts its own manifest, README and headers.
   */
  license: string;
  version: string;
  year: number;
}

/**
 * The Vitest setup file the generated `vite.config.ts` points `setupFiles` at.
 * Named as a constant because two templates have to agree on it.
 */
export const VITEST_SETUP_FILE = 'vitest.setup.ts';

/**
 * devDependencies written into the generated plugin.
 *
 * EVERY entry is SOURCED, not invented — each copies this monorepo's own range
 * for the same package verbatim, so the repo has one range per dependency
 * rather than one per file. These literals sit in `.ts` source, outside the
 * objectui#3711 version-claims gate's scan face, so `templates.test.ts` pins
 * the parity instead — and it pins the WHOLE map, not a subset, which is what
 * stops a re-anchored entry from silently rotting again (objectui#3742).
 *
 * Two anchors, because not every build dependency exists in the root manifest.
 * `create-plugin` writes into `<cwd>/packages/plugin-<name>`, so a generated
 * plugin is a literal sibling of `packages/plugin-*` — those manifests are the
 * faithful anchor for anything the root does not declare:
 *
 * | dependency                  | range     | anchor                                     |
 * | --------------------------- | --------- | ------------------------------------------ |
 * | `@testing-library/jest-dom` | `^7.0.1`  | repo root package.json (also apps/console) |
 * | `@testing-library/react`    | `^16.3.2` | repo root package.json (also apps/console) |
 * | `@vitejs/plugin-react`      | `^6.0.5`  | every `packages/plugin-*` (not in root)    |
 * | `jsdom`                     | `^29.1.1` | repo root package.json                     |
 * | `typescript`                | `^6.0.3`  | repo root package.json                     |
 * | `vite`                      | `^8.2.1`  | repo root package.json                     |
 * | `vite-plugin-dts`           | `^5.0.3`  | every `packages/plugin-*` (not in root)    |
 * | `vitest`                    | `^4.1.10` | repo root package.json                     |
 *
 * `@testing-library/dom` is deliberately absent: it is a peer of
 * `@testing-library/react` 16 and is installed by the workspace's
 * `auto-install-peers=true`, which is also why `apps/console` declares the
 * same three and not four.
 *
 * The build entries carried pre-anchoring ranges until objectui#3742 — the
 * scaffold handed authors vite 7 / plugin-react 4 / dts 4 / TypeScript 5 while
 * the repo built and tested every in-tree plugin on vite 8 / plugin-react 6 /
 * dts 5 / TypeScript 6. objectui#3716's artifact end-to-end run only ever
 * exercised the in-repo versions, so the declared ranges were never the ones
 * under test. Not a peer conflict: `^4.2.1` resolved to plugin-react 4.7.0,
 * whose vite peer had widened to `^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0` and
 * accepted vite 7 — the cost was a scaffold one to two majors behind its own
 * monorepo, not a failing install.
 */
const DEV_DEPENDENCIES: Record<string, string> = {
  '@testing-library/jest-dom': '^7.0.1',
  '@testing-library/react': '^16.3.2',
  '@vitejs/plugin-react': '^6.0.5',
  jsdom: '^29.1.1',
  typescript: '^6.0.3',
  vite: '^8.2.1',
  'vite-plugin-dts': '^5.0.3',
  vitest: '^4.1.10'
};

/**
 * Runtime `dependencies` written into the generated plugin.
 *
 * EVERY entry is a `workspace:*` platform package — the four `@object-ui/*` the
 * scaffold's own sources build against. That is not an accident of the list, it
 * is the rule: a generated plugin is written into `<cwd>/packages/plugin-<name>`
 * and shares this workspace, so `workspace:*` always resolves to the version the
 * repo currently builds and tests with, and can never drift.
 *
 * A VERSIONED runtime range here can drift, and one did. Until objectui#3755 the
 * map also carried `'lucide-react': '^0.563.0'` — a declaration no generated
 * source file imported, nailed two majors behind the 23 in-repo declarations
 * (all `^1.28.0`) and unable to float off it, because a `0.x` caret does not
 * cross minors: `^0.563.0` is `>=0.563.0 <0.564.0`. Every scaffolded plugin
 * really installed lucide 0.563.x for code that never referenced it.
 *
 * It is gone rather than re-anchored because this repo declares an icon library
 * where it imports one: of the 24 manifests that mention `lucide-react`, 23
 * import it, and no package pre-declares it for code not yet written. An author
 * who wants icons runs `pnpm add lucide-react` and lands the current version by
 * construction — no anchor table has to be maintained to keep an unused
 * declaration honest. `templates.test.ts` pins both halves: this map is exactly
 * the four `workspace:*` entries, and no versioned runtime range may be
 * declared without a generated source importing it (the reverse of the one-way
 * import gate objectui#3733 added, which only ever caught the other direction).
 */
const DEPENDENCIES: Record<string, string> = {
  '@object-ui/components': 'workspace:*',
  '@object-ui/core': 'workspace:*',
  '@object-ui/react': 'workspace:*',
  '@object-ui/types': 'workspace:*'
};

/** The generated plugin's `package.json`, as an object (not yet serialised). */
export function buildPackageJson(vars: PluginTemplateVars): Record<string, unknown> {
  return {
    name: vars.packageName,
    version: vars.version,
    type: 'module',
    license: vars.license,
    description: vars.description,
    main: 'dist/index.umd.cjs',
    module: 'dist/index.js',
    types: 'dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        require: './dist/index.umd.cjs'
      }
    },
    scripts: {
      build: 'vite build',
      test: 'vitest run',
      lint: 'eslint .'
    },
    dependencies: { ...DEPENDENCIES },
    peerDependencies: {
      react: '^18.0.0 || ^19.0.0',
      'react-dom': '^18.0.0 || ^19.0.0'
    },
    devDependencies: { ...DEV_DEPENDENCIES }
  };
}

/** The generated plugin's `tsconfig.json`, as an object (not yet serialised). */
export function buildTsconfig(): Record<string, unknown> {
  return {
    extends: '../../tsconfig.json',
    compilerOptions: {
      outDir: './dist',
      rootDir: './src',
      declaration: true,
      declarationMap: true
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.test.tsx']
  };
}

/**
 * The generated plugin's `vite.config.ts`.
 *
 * The `test` block is load-bearing, not decoration:
 * - `environment: 'jsdom'` — the example test calls `render()`; the Vitest
 *   default (`node`) has no `document` for React to mount into.
 * - `globals: true` — `@testing-library/react` only registers its automatic
 *   `cleanup()` when `afterEach` exists as a GLOBAL (`dist/index.js`:
 *   `if (typeof afterEach === 'function')`). Without it the DOM leaks between
 *   tests, silently, as soon as the author writes a second one.
 * - `setupFiles` — where the jest-dom matchers get registered; see
 *   {@link buildVitestSetup}.
 *
 * The `/// <reference types="vitest/config" />` above the imports is what makes
 * that block TYPE-check, and it is load-bearing too (objectui#8139). `vite`'s
 * own `UserConfig` declares no `test` key, so `defineConfig` imported from
 * `vite` refuses the block with TS2769 ("Object literal may only specify known
 * properties, and 'test' does not exist in type 'UserConfigExport'") — measured
 * by the emitted-code census (objectui#7864 / PR #8138) on this very template.
 * Nothing in the scaffolded repo RUNS that check today (`buildPackageJson`
 * scaffolds `build`/`test`/`lint` and no `tsc`, and `vite build` loads the
 * config through esbuild, which does not type-check), so the symptom is an
 * editor-only red squiggle — but it is red on day one, in every plugin this
 * generator writes. The reference pulls in `vitest/dist/config.d.ts`, whose
 * `declare module "vite" { interface UserConfig { test?: … } }` augmentation is
 * exactly the missing declaration; it is a type-only comment, so it changes
 * nothing at run time and `vite build` never sees it.
 *
 * ⚠️ Do NOT "simplify" this to `import { defineConfig } from 'vitest/config'`,
 * the other shape vitest documents. It type-checks identically in the scaffolded
 * repo — `vitest ^4.1.10` is a declared devDependency there, see
 * {@link DEV_DEPENDENCIES} — but it makes THIS repo stop measuring the template:
 * `vitest` is declared by this repository's root manifest and by no package the
 * census maps, so an emitted `import … from 'vitest/config'` trips the census's
 * root bound and the whole block is REFUSED instead of judged. Measured both
 * ways on b38014e82: with the reference, `Judged 12 … 7 refused by the root
 * bound` and the TS2769 is gone; with the import, `Judged 11 … 8 refused` and
 * the census reports zero diagnostics here because it no longer compiles this
 * template at all — including the TS2307 below, which it would also stop
 * seeing. A clean number bought by not looking is the one outcome that census
 * was built to avoid.
 *
 * The `import dts from 'vite-plugin-dts'` line still draws a TS2307 from that
 * census. It is an artefact of the instrument, NOT a defect: the scaffolded
 * `package.json` declares `vite-plugin-dts` (see {@link DEV_DEPENDENCIES}), and
 * the census resolves against this monorepo's root manifest, where it is not
 * declared. ⛔ Do not "fix" it here.
 *
 * The entry path is resolved from `import.meta.dirname`, not `__dirname`. Vite
 * still defines `__dirname` under its default `configLoader: 'bundle'`, but
 * vite 8 warns on it ("Your Vite config uses features that are unsupported by
 * `configLoader: 'native'`, which is planned to become the default in a future
 * major version of Vite ... Use `import.meta.dirname` instead"), and under
 * `native` — which imports the config with Node's own ESM loader, where no
 * `__dirname` exists — it would fail outright. `apps/console/vite.config.ts`
 * was converted for the same reason (objectui#3384); the generated config now
 * ships already-correct rather than warning on an author's first `pnpm build`.
 * Safe unconditionally here: the repo requires Node >= 22 and vite defines
 * `import.meta.dirname` under the bundle loader too.
 *
 * Scaffolding INTO this monorepo is a case this output deliberately does NOT
 * serve, and it needs no change here because THIS repo already refuses it
 * loudly (objectui#7524, measured on a9e6f04b4). Running the generator into
 * `packages/` and re-running `pnpm exec vitest run scripts/__tests__/` turns
 * 11 assertions red across 7 files, every one naming the generated package;
 * four are about this shape specifically:
 *
 * - `scripts/__tests__/vitest-invocation-guard.test.ts` — "calls the guard
 *   from every one of them", "declares no `test` block - a build config must
 *   not carry test semantics", and "derives the repo root instead of counting
 *   `..`" (objectui#3240 / objectui#5406);
 * - `scripts/__tests__/runner-package-test-entry-3746.test.ts` — "admits no
 *   package beyond the recorded baseline" (objectui#3746), which reads the
 *   generated `"test": "vitest run"` from {@link buildPackageJson}.
 *
 * Those pins exist because inside this repo a package-cwd `vitest run` picks
 * up a package-local `test` block instead of `vitest.config.mts` and goes
 * green under a config CI never uses. Measured for the scaffold too: the
 * generated `pnpm test` passes with `RUN v4.1.10 .../packages/plugin-NAME` as
 * its root and no guard output at all - which is exactly why the pins, not
 * the reviewer, are what catches it. In this repo a package needing different
 * test semantics declares a PROJECT in `vitest.config.mts`.
 *
 * None of that is true of the audience this generator serves - a plugin in
 * its OWN repo, where the emitted config is the only config and the block
 * below is the only thing giving the example test a DOM. Do not teach these
 * templates to detect an in-repo target: the two answers differ because the
 * questions differ, and the in-repo answer is already enforced above.
 */
export function buildViteConfig(vars: PluginTemplateVars): string {
  return `/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import * as path from 'path';

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/index.tsx'),
      name: '${vars.pascalName}',
      formats: ['es', 'umd'],
      fileName: (format) => \`index.\${format === 'es' ? 'js' : 'umd.cjs'}\`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./${VITEST_SETUP_FILE}'],
  },
});
`;
}

/**
 * The generated plugin's Vitest setup file.
 *
 * Uses the `/vitest` entry point rather than the bare package: that one takes
 * `expect` from `vitest` explicitly, while the bare entry extends a GLOBAL
 * `expect` and therefore breaks the moment an author turns `globals` off.
 */
export function buildVitestSetup(): string {
  return `// Registers @testing-library/jest-dom's matchers (\`toBeInTheDocument\` and
// friends) on Vitest's \`expect\`, which the example test in src/ relies on.
import '@testing-library/jest-dom/vitest';
`;
}

/** The generated plugin's `README.md`. */
export function buildReadme(vars: PluginTemplateVars): string {
  return `# ${vars.packageName}

${vars.description}

## Installation

\`\`\`bash
pnpm add ${vars.packageName}
\`\`\`

## Usage

\`\`\`tsx
import { ${vars.pascalName} } from '${vars.packageName}';

// Use the component
<${vars.pascalName} />
\`\`\`

## Development

\`\`\`bash
# Build the plugin
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
\`\`\`

## License

${vars.license} © ${vars.author}
`;
}

/**
 * ⛔ The four emitted `src/*` files carry NO copyright header (objectui#8778).
 *
 * `buildIndexFile`, `buildImplFile`, `buildTypesFile` and `buildTestFile` — the
 * four builders below, and the only four that write source into the author's
 * package — each used to open the file they emit with
 * `Copyright (c) <year>-present ObjectStack Inc.` under an `ObjectUI` title
 * line. That is this project asserting ownership of code a third party has not
 * written yet, in a package they publish under their own name: a false
 * statement the tool emitted, not a style preference, which is why it is gone
 * rather than reworded.
 *
 * ⛔ Do not put anything back in its place. Every candidate — a placeholder, an
 * SPDX line, `vars.author`, this project's name — is a fresh legal assertion
 * about somebody else's code, and none has been ruled on. Emitting nothing is
 * the only option that asserts nothing. If a specific string ever does belong
 * here it arrives as a maintainer decision, never as a template edit.
 *
 * What REMAINS is the licence pointer, and it stays because it is TRUE.
 * `vars.license` is the licence the author chose at the prompt (objectui#8041),
 * the LICENSE file the sentence points at really is emitted beside these four
 * (see {@link buildPluginFiles}), and {@link buildLicenseFile} refuses an id it
 * has no text for (objectui#8892) — so it cannot name a licence the package
 * does not carry. It is also one of the six agreeing licence statements those
 * two cards built: for any one of these files the other five are the manifest,
 * the README and its three sibling headers. Deleting the whole block, rather
 * than the ownership lines alone, would silently drop four of the six.
 */

/**
 * The generated plugin's `src/index.tsx` (entry point + registry registration).
 *
 * The `./types` re-export is load-bearing, not tidiness (objectui#3759). The
 * generated `package.json` exposes exactly one `exports` key — `.` → `dist/*` —
 * so the entry is the ONLY door a consumer has. Until this line existed,
 * `buildTypesFile`'s schema interface was written to disk and reachable from
 * nowhere: no generated source imported it, and the deep paths that would have
 * reached it (`<pkg>/types`, `<pkg>/dist/types`) are closed by that same
 * `exports` map. The author's schema contract — the one thing a metadata
 * producer needs from a renderer package — was a dead file.
 *
 * Named type-only re-export rather than `export * from './types'`, matching all
 * four in-repo plugins that ship a `src/types.ts` (`plugin-charts`,
 * `plugin-editor`, `plugin-kanban`, `plugin-markdown` — each
 * `export type { XSchema } from './types';` behind the same `.`-only exports
 * map) and the worked example in `content/docs/guide/plugin-development.md`.
 * A star export would make every future local type public by accident; the
 * named form keeps the published surface a deliberate act.
 */
export function buildIndexFile(vars: PluginTemplateVars): string {
  return `/**
 * This source code is licensed under the ${vars.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ${vars.pascalName} } from './${vars.pascalName}Impl';

export { ${vars.pascalName} };
export type { ${vars.pascalName}Props } from './${vars.pascalName}Impl';
export type { ${vars.pascalName}Schema } from './types';

// Register component with ComponentRegistry
const ${vars.pascalName}Renderer: React.FC<{ schema: any }> = ({ schema }) => {
  return <${vars.pascalName} {...schema} />;
};

ComponentRegistry.register('${vars.pluginName}', ${vars.pascalName}Renderer, {
  label: '${vars.pascalName}',
  category: 'plugin',
  inputs: [
    // Define your component inputs here
  ],
  defaultProps: {
    // Define default props here
  }
});
`;
}

/** The generated plugin's `src/<Pascal>Impl.tsx`. */
export function buildImplFile(vars: PluginTemplateVars): string {
  return `/**
 * This source code is licensed under the ${vars.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

export interface ${vars.pascalName}Props {
  // Define your props here
  className?: string;
}

/**
 * ${vars.pascalName} component
 */
export const ${vars.pascalName}: React.FC<${vars.pascalName}Props> = ({ className }) => {
  return (
    <div className={className}>
      <h2>${vars.pascalName} Plugin</h2>
      <p>Implement your plugin logic here.</p>
    </div>
  );
};
`;
}

/**
 * The generated plugin's `src/types.ts`.
 *
 * Extends `BaseSchema` from `@object-ui/types` instead of re-declaring the base
 * node's fields. This became mandatory the moment objectui#3759 made the file
 * reachable from the entry: an unreachable interface is only dead weight, but a
 * PUBLISHED one is the plugin's schema contract, and shipping a hand-rolled
 * `{ type; id?; className? }` as that contract would hand every scaffolded
 * plugin a second dialect of a base node the protocol already defines —
 * precisely the "one strict contract beats N dialects" failure in AGENTS.md
 * commandment #0.1. `BaseSchema` already carries `id?` and `className?` (plus
 * `name`, `label`, `visible`, … which a copied subset silently omits), so only
 * the `type` literal is narrowed here. Same shape as every in-repo plugin that
 * ships one — `packages/plugin-markdown/src/types.ts` is the closest model —
 * and as the anatomy table in `content/docs/guide/plugin-development.md`.
 *
 * This is also what makes the generated `@object-ui/types` dependency a used
 * declaration rather than a third unused one beside objectui#3755's.
 */
export function buildTypesFile(vars: PluginTemplateVars): string {
  return `/**
 * This source code is licensed under the ${vars.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { BaseSchema } from '@object-ui/types';

/**
 * Schema definition for ${vars.pascalName}.
 *
 * This is the contract between a metadata author and the renderer: it is
 * re-exported from \`src/index.tsx\`, which is the package's only entry point.
 */
export interface ${vars.pascalName}Schema extends BaseSchema {
  type: '${vars.pluginName}';
  // Add schema properties here
}
`;
}

/** The generated plugin's example test, `src/<Pascal>Impl.test.tsx`. */
export function buildTestFile(vars: PluginTemplateVars): string {
  return `/**
 * This source code is licensed under the ${vars.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ${vars.pascalName} } from './${vars.pascalName}Impl';

describe('${vars.pascalName}', () => {
  it('should render', () => {
    render(<${vars.pascalName} />);
    expect(screen.getByText('${vars.pascalName} Plugin')).toBeInTheDocument();
  });
});
`;
}

/**
 * Who the emitted LICENSE names as the copyright holder.
 *
 * The author prompt's `initial` is the empty string and nothing makes it
 * required, so a scaffold really can arrive here with `author: ''` — and
 * objectui#8041 moves the licence question and no other prompt, so making it
 * required is not this change's to make. A licence with a blank holder grants
 * nothing to nobody, which would leave the emitted text as untrue as the
 * missing one it replaces, so the blank case names the package's authors
 * instead of emitting a copyright line that trails off after the year.
 */
export function licenseCopyrightHolder(vars: PluginTemplateVars): string {
  return vars.author.trim() || `the ${vars.packageName} authors`;
}

/**
 * The generated plugin's `LICENSE` — the full text of whatever
 * {@link buildPackageJson} declares (objectui#8041).
 *
 * The two are ONE decision read twice, which is why this reads `vars.license`
 * rather than taking a licence of its own: the defect this file used to carry
 * was precisely a manifest field and an emitted file set that could disagree.
 *
 * REFUSES an id nothing offers instead of substituting the default licence's
 * text for it (objectui#8892). The substitution used to be defended here as
 * making one state unreachable — a manifest claiming a licence with no text
 * beside it — and it did, by making a worse one reachable in its place.
 * `vars.license` reaches a scaffolded plugin through SIX statements and this is
 * the only one that resolves it: {@link buildPackageJson}, {@link buildReadme}
 * and the four source headers interpolate it verbatim. So an unoffered id used
 * to emit a package whose manifest, README and four file headers all named that
 * id while the LICENSE beside them carried MIT — the author then carries the
 * disagreement into their own distribution. Agreement cannot be restored at
 * this end for the other five, so the id is refused for all six.
 *
 * Refusing costs nothing that the fallback bought. `resolveLicenseId` is total
 * onto the offered ids and `index.ts` is the only caller, so the CLI cannot
 * produce this throw; nothing outside this package can call it at all
 * (`package.json` declares `bin` only — no `exports`, `main` or `types` — and
 * the build emits one bundled `dist/index.js`); and {@link buildPluginFiles}
 * runs before `index.ts` creates anything on disk (objectui#8786), so the throw
 * lands on a run that has written nothing rather than half a plugin.
 */
export function buildLicenseFile(vars: PluginTemplateVars): string {
  const license = findLicense(vars.license);
  if (!license) {
    throw new Error(
      `create-plugin has no text for licence "${vars.license}", so it will not scaffold a ` +
        'plugin whose manifest, README and source headers name a licence its LICENSE file ' +
        `does not carry. Offered ids: ${PLUGIN_LICENSES.map((offered) => offered.id).join(', ')}. ` +
        'Resolve the answer with resolveLicenseId() before building PluginTemplateVars.'
    );
  }
  return license.text({ year: vars.year, holder: licenseCopyrightHolder(vars) });
}

/**
 * The whole generated plugin as `relative path -> file contents`.
 *
 * Single source of truth for what a scaffolded plugin contains, so the writer
 * in `index.ts` stays a loop and the pin test can assert over the same map the
 * CLI writes.
 */
export function buildPluginFiles(vars: PluginTemplateVars): Record<string, string> {
  return {
    'package.json': `${JSON.stringify(buildPackageJson(vars), null, 2)}`,
    'tsconfig.json': `${JSON.stringify(buildTsconfig(), null, 2)}`,
    'vite.config.ts': buildViteConfig(vars),
    [VITEST_SETUP_FILE]: buildVitestSetup(),
    LICENSE: buildLicenseFile(vars),
    'README.md': buildReadme(vars),
    'src/index.tsx': buildIndexFile(vars),
    [`src/${vars.pascalName}Impl.tsx`]: buildImplFile(vars),
    'src/types.ts': buildTypesFile(vars),
    [`src/${vars.pascalName}Impl.test.tsx`]: buildTestFile(vars)
  };
}
