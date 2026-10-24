/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one place a generated manifest's version ranges come from.
 *
 * This CLI writes a `package.json` from THREE generators, not two:
 * `utils/app-generator.ts` builds the plain and routed temp apps that
 * `objectui dev` runs, and `commands/init.ts` builds the project scaffold
 * `objectui init` hands to an external user. objectui#3742 / objectui#3754 /
 * objectui#3827 established the discipline for the first two — one range per
 * dependency, quoted from this repo rather than invented, derived from this
 * CLI's own version where the package ships in lockstep with it — and
 * `app-generator.test.ts`'s `DEPENDENCY_ANCHORS` gates it.
 *
 * The init scaffold sat outside all of it (objectui#3892). It asked for
 * `@object-ui/components`/`@object-ui/react` at `^2.0.0` while those packages
 * publish at 17.x, so the first command an external user runs produced a
 * project whose `npm install` resolved a major with nothing to do with the CLI
 * that wrote it — the same defect objectui#3827 fixed one generator over, where
 * the literal was `^0.1.0`. Its toolchain ranges had fossilised a major behind
 * the repo besides (vite `^7.3.1` vs `^8.2.0`, typescript `^5.9.3` vs `^6.0.3`).
 *
 * Both halves are cured by not having a literal to fossilise: this module owns
 * the values, all three generators read them, and the anchor table judges the
 * union. Copying a range into a fourth generator is still possible, but it now
 * fails the completeness gate instead of shipping.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** This package's own name, used to locate its manifest for the platform range. */
const CLI_PACKAGE_NAME = '@object-ui/cli';

/** Memoised so the manifest walk happens at most once per process. */
let cachedCliVersion: string | undefined;

/**
 * This CLI's own version, read from its own `package.json`.
 *
 * Walks up from this module rather than joining a fixed `../package.json`,
 * because the same source sits at `src/utils/` in the repo and is bundled into
 * `dist/` when published — a relative depth that is correct in one is wrong in
 * the other.
 */
export function cliVersion(): string {
  if (cachedCliVersion !== undefined) return cachedCliVersion;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf-8')) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === CLI_PACKAGE_NAME && typeof manifest.version === 'string') {
        cachedCliVersion = manifest.version;
        return cachedCliVersion;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Could not locate the ${CLI_PACKAGE_NAME} manifest to version the generated app's ` +
      `platform dependencies against. Refusing to write a package.json with a guessed range.`
  );
}

/**
 * The range every generated manifest declares for every `@object-ui/*` package.
 *
 * Derived from this CLI's own version instead of being written out as a
 * literal, because `.changeset/config.json` puts `@object-ui/cli` in the SAME
 * `fixed` group as every platform package a generated app declares: they are
 * released together and always carry the identical version. So `^<own
 * version>` is both current and guaranteed to exist on the registry — whatever
 * CLI version a user is running was published alongside its siblings.
 *
 * The literals it replaces were `^0.1.0` in the app generators (objectui#3827)
 * and `^2.0.0` in the init scaffold (objectui#3892), for packages published at
 * 17.x. Neither resolved to anything the CLI had been tested against; `^0.1.0`
 * resolved to nothing published at all. A literal here is not merely a fossil
 * risk, it is a fossil generator: the fixed group re-versions on every release,
 * so any hard-coded range is stale the next day. Deriving it removes the class.
 */
export function platformPackageRange(): string {
  return `^${cliVersion()}`;
}

/**
 * React's range in every generated manifest.
 *
 * Quotes the repo root verbatim (an exact pin there) rather than the wider
 * `^18.0.0 || ^19.0.0` the platform packages accept as a peer. The peer range
 * says what CAN work; this says what is actually exercised — inside this
 * workspace the temp app resolves React by hoisting to the root, so the root's
 * version is the only one the generated code has ever run against. Declaring
 * `^18.3.1`, as the app generators did until objectui#3827, or `^19.2.0`, as
 * the init scaffold did until objectui#3892, names a version nothing here
 * tests: the second is not even wrong about the major, which is exactly how it
 * survived unnoticed.
 */
export const REACT_RANGE = '19.3.0';

/**
 * `devDependencies` shared by every generated manifest (identical in all three).
 *
 * Every range is anchored to an in-repo manifest, and
 * `app-generator.test.ts`'s `DEPENDENCY_ANCHORS` names the anchor for each one
 * and fails on an unanchored addition. The Tailwind-side entries were held at
 * v3 as an explicit `TAILWIND_V3_DEFERRED` ledger by objectui#3827, because
 * bumping the range without rewriting the CSS pipeline beside it would produce
 * an app that installs and renders unstyled. objectui#3852 rewrote that
 * pipeline, so they are anchored to this repo's Tailwind 4 like everything
 * else — `tailwindcss` to the root, `@tailwindcss/postcss` (v4's PostCSS
 * plugin, a separate package) to the in-repo range every `postcss.config.*`
 * here already names.
 *
 * The init scaffold declared this exact key set at its own, older literals
 * until objectui#3892 — same nine packages, every range behind, two of them by
 * a major. Sharing the map rather than re-anchoring a second copy is what makes
 * a repo-side bump reach all three generators in one edit; a generator that
 * ever needs to differ can spread this and override the one key, which stays
 * visible to the anchor table.
 */
export const SCAFFOLD_DEV_DEPENDENCIES: Record<string, string> = {
  '@tailwindcss/postcss': '^4.3.3',
  '@types/react': '19.3.0',
  '@types/react-dom': '19.3.0',
  '@vitejs/plugin-react': '^6.0.5',
  autoprefixer: '^10.5.4',
  postcss: '^8.5.26',
  tailwindcss: '^4.3.3',
  typescript: '^6.0.3',
  vite: '^8.2.1'
};
