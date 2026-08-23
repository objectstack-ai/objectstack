// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { printHeader, printSuccess, printError, printStep, printKV, printInfo, formatZodErrors } from '../utils/format.js';
import { validateScaffold } from '../utils/scaffold-validate.js';
import { summarizeTree, describeEntry } from 'create-objectstack/created-summary';

// ─── Version resolution ──────────────────────────────────────────────
//
// The CLI is published to npm together with every other `@objectstack/*`
// package in this monorepo, so they all share the same release version.
// We pin scaffolded dependencies to whatever version of the CLI is
// running, which guarantees the generated `package.json` resolves
// outside the workspace (and pins a tested, compatible matrix).

let cachedCliVersion: string | null = null;

export function getCliVersion(): string {
  if (cachedCliVersion) return cachedCliVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/commands/init.js → ../../package.json   (built layout)
    // src/commands/init.ts  → ../../package.json   (source layout, used by tests)
    const pkgPath = path.resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    cachedCliVersion = String(pkg.version || '0.0.0');
  } catch {
    cachedCliVersion = '0.0.0';
  }
  return cachedCliVersion;
}

/** Caret-pinned to the CLI's own version (e.g. `^6.5.0`). */
function pkgVersion(): string {
  return `^${getCliVersion()}`;
}

/**
 * Convert an npm package name into a valid ObjectStack namespace identifier.
 *
 * Namespace rules (from `ManifestSchema` in `@objectstack/spec`):
 *   - 2-20 chars, `^[a-z][a-z0-9_]{1,19}$`
 *   - Reserved: `base`, `system`, `sys`
 *
 * npm names allow hyphens/dots/scopes (e.g. `@acme/my-app`); identifiers don't.
 * We strip the scope, replace separators with `_`, lowercase, prefix a leading
 * digit, truncate to 20, and pad short names so the result always satisfies
 * the regex. Reserved names get a `_app` suffix.
 */
export function sanitizeNamespace(name: string): string {
  let s = name.replace(/^@[^/]+\//, '');           // drop npm scope
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_'); // separators → _
  s = s.replace(/^_+|_+$/g, '');                   // trim underscores
  if (!s) s = 'app';
  if (/^[0-9]/.test(s)) s = 'a' + s;               // must start with a letter
  if (s.length < 2) s = (s + '_app').slice(0, 20);
  if (s.length > 20) s = s.slice(0, 20).replace(/_+$/, '');
  if (['base', 'system', 'sys'].includes(s)) s = (s + '_app').slice(0, 20);
  return s;
}

/**
 * Native dependencies the scaffold pulls in (transitively) that need their
 * build scripts to run at install time. pnpm 10+ blocks dependency build
 * scripts by default; without this allowlist `better-sqlite3` (used by the
 * default standalone SQLite store, via knex) ships uncompiled and `serve`
 * fails with "Could not locate the bindings file".
 *
 * Current pnpm reads this from `pnpm-workspace.yaml`, NOT the `pnpm` field in
 * package.json (that field is now ignored and emits a deprecation warning).
 * npm/yarn/bun build native modules by default and ignore this file.
 */
export const SCAFFOLD_BUILT_DEPENDENCIES = ['better-sqlite3', 'esbuild'];

/**
 * Third-party peer ranges that resolve outside what their declaring package
 * states, keyed `<declaring package>><peer>` — pnpm's scoped `allowedVersions`
 * spelling, so each entry widens exactly one declaration and nothing else.
 *
 * Every one of them is reported by `pnpm install` on a brand-new scaffold, and
 * none is a real incompatibility. They are declared here because that report is
 * the first thing a newcomer sees, on the one screen where they are deciding
 * whether this project is solid, and there is nothing they did to cause it.
 *
 *  - `better-auth>better-sqlite3` — better-auth 1.7.1 peers `^12.0.0` while the
 *    tree resolves 13.x (`@objectstack/driver-sql`'s optional dependency). The
 *    peer is OPTIONAL and governs one configuration only: a raw better-sqlite3
 *    `Database` handed to better-auth's `database` option. ObjectStack never
 *    does that — `AuthManager.createDatabaseConfig()` passes an ObjectQL
 *    adapter factory. Measured on the configuration the range *does* govern
 *    (better-auth's own Kysely dialect: migrations, sign-up, sign-in, adapter
 *    find/update/delete), 1.7.1 behaves identically on better-sqlite3 13.0.3
 *    and on 12.11.1. So the upstream range is stale and 13 is right — widening
 *    is the correct remedy, not pinning our own declaration back to 12.
 *
 *  - `@better-auth/scim>better-call` — scim is held at `1.7.0-rc.1`
 *    deliberately (stable 1.7.x ships a whole-model rewrite that is its own
 *    migration), and the rc peers an exact `better-call@1.3.7` while
 *    better-auth itself depends on 1.4.0. A better-auth plugin must share the
 *    HOST's better-call instance, so the single 1.4.0 copy every install
 *    already resolves is the correct tree, not a skew to repair.
 *    ⚠️ This entry retires together with the SCIM rc pin — delete both at once.
 *    Stable `@better-auth/scim@1.7.1` peers `better-call@1.4.0`, so the skew
 *    this line covers is genuinely gone the moment the pin moves.
 *
 *  - `<four>@better-auth/utils` — `@better-auth/core`, `/oauth-provider`,
 *    `/scim` and `/sso` each peer an EXACT `@better-auth/utils@0.4.2`, while a
 *    scaffolded tree hands them 0.5.0. The 0.5.0 comes from `better-call@1.4.0`
 *    (better-auth's own HTTP layer), which DEPENDS on `^0.5.0`;
 *    `@objectstack/plugin-auth` names the four packages as direct dependencies
 *    without naming utils, so pnpm satisfies their peer from better-call's copy
 *    rather than from better-auth's own exact 0.4.2 dependency.
 *
 *    Measured compatible rather than assumed. Those four import exactly three
 *    symbols across two subpaths — `base64`/`base64Url` (`/base64`),
 *    `createHash` (`/hash`) and, in core only, `createRandomStringGenerator`
 *    (`/random`). 0.5.0 exports all three with identical signatures; `/random`
 *    is unchanged apart from formatting, `/base64` swaps `new Uint8Array(data)`
 *    for a helper that IS `new Uint8Array(data)` on non-strings, and `/hash`
 *    only widens its input coercion for views not backed by a plain
 *    ArrayBuffer. Run against the input shapes those call sites actually pass,
 *    0.4.2 and 0.5.0 agree on every value; run end to end (better-auth with the
 *    sso, oauth-provider and scim plugins), a tree where the four resolve 0.5.0
 *    and one where they resolve 0.4.2 produce the same transcript — sign-up,
 *    sign-in, session, both OAuth metadata documents, the RFC 7636 PKCE
 *    challenge, and the SCIM and SSO endpoint outcomes.
 *
 *    ⛔ A resolution change is the WRONG remedy here, and was measured too:
 *    pinning utils back to 0.4.2 clears the four lines only by dragging
 *    `better-call@1.4.0` off its own declared `^0.5.0` — manufacturing one real
 *    range violation to silence four benign ones.
 *
 *    Spelled `0.5.0` exactly, not `0.5`: 0.5.0 is the version that was
 *    measured, and a future 0.6.0 SHOULD report again rather than inherit this
 *    finding.
 *
 *    ⚠️ These four do NOT retire with the SCIM rc pin, even though one of them
 *    names scim. Stable `@better-auth/scim@1.7.1` still peers
 *    `@better-auth/utils@0.4.2`, so this skew outlives that pin. They retire
 *    when the four packages accept 0.5.0 upstream, or when
 *    `SCAFFOLD_PNPM_RANGE` reaches `>=10.31` — pnpm 10.31 changed peer
 *    resolution so that all four land on 0.4.2 by themselves. Measured on the
 *    rendered scaffold, one clean resolve per pnpm version:
 *
 *      pnpm 10.15.0 – 10.30.0   all four reported as unmet peers.
 *      pnpm >= 10.31.0          resolved to 0.4.2; nothing to report.
 *
 * `allowedVersions` suppresses the report ONLY; it moves no resolution — the
 * lockfile a scaffold resolves is byte-identical with and without this block
 * (verified by digest on pnpm 10.15.0 and 10.30.0).
 */
export const SCAFFOLD_ALLOWED_PEER_VERSIONS: Record<string, string> = {
  'better-auth>better-sqlite3': '13',
  '@better-auth/scim>better-call': '1.4.0',
  '@better-auth/core>@better-auth/utils': '0.5.0',
  '@better-auth/oauth-provider>@better-auth/utils': '0.5.0',
  '@better-auth/scim>@better-auth/utils': '0.5.0',
  '@better-auth/sso>@better-auth/utils': '0.5.0',
};

/**
 * Lowest pnpm that can actually install this scaffold, declared as
 * `engines.pnpm` in the generated `package.json`.
 *
 * The rendered `pnpm-workspace.yaml` declares an explicit empty `packages: []`
 * (see `renderPnpmWorkspaceYaml` below). It did not always, and that history is
 * why this floor is reachable at all: while the key was omitted, pnpm 10.0–10.4
 * refused the file outright — `pnpm install` exited 1 with "ERROR packages
 * field missing or empty" before resolving a single dependency — and those
 * versions parse `pnpm-workspace.yaml` BEFORE they read `engines`, so no floor
 * value could ever be consulted on that band.
 *
 * Declaring the floor does not repair the versions below it — it makes them
 * report a cause the user can act on instead of a workspace error about a file
 * they did not write. Measured on the rendered shape, one clean install per
 * pnpm version, each with its own store:
 *
 *   pnpm 9.15.9, 10.0.0,    refused as ERR_PNPM_UNSUPPORTED_ENGINE — "Your
 *   10.4.0, 10.5.0–10.14.0  pnpm version is incompatible with PROJECT.
 *                           Expected version: >=10.15". With the key omitted,
 *                           9.x and 10.0–10.4 printed the raw workspace error
 *                           here instead, naming a file the user never wrote.
 *   pnpm >= 10.15.0         installs; unchanged by this declaration.
 *
 * ⚠️ So this floor, not the workspace file, is now what stops pnpm 10.0–10.4:
 * with the floor lowered they install (measured, exit 0). Admitting them is a
 * support decision rather than an edit — measured on 10.0.0 and 10.4.0, they
 * read neither the build allowlist nor the peer rules out of
 * `pnpm-workspace.yaml` ("The following dependencies have build scripts that
 * were ignored: better-sqlite3, esbuild"), so a scaffold installed there is
 * quietly missing its native builds. Do not move this floor as a side effect;
 * whether to admit that band at all is #11048.
 *
 * `engines.pnpm` rather than a `packageManager` stamp, on purpose. npm, yarn
 * and bun ignore `engines.pnpm` entirely, so the scaffold keeps working for all
 * four package managers `objectstack init` can hand off to (see
 * `detectPackageManager`). `packageManager: "pnpm@x.y.z"` would instead declare
 * the project pnpm-only — corepack-driven yarn refuses to run in such a project
 * — and pin one exact version that goes stale on every pnpm release. Those two
 * reasons carry the choice on their own: the third one recorded when the stamp
 * was rejected ("it buys nothing on 10.0–10.4") was measured against the
 * keyless file, and the explicit `packages:` key retires it.
 */
export const SCAFFOLD_PNPM_RANGE = '>=10.15';

/**
 * Render the `package.json` written into a freshly scaffolded project.
 *
 * Exported so the shape is asserted directly rather than re-declared by a test
 * that only claims to mirror it — a hand-copied mirror silently stops tracking
 * this function the moment a field is added here.
 */
export function renderScaffoldPackageJson(
  projectName: string,
  template: { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> },
): Record<string, unknown> {
  return {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    // Not a build-script allowlist (that lives in pnpm-workspace.yaml, which
    // current pnpm reads instead of the package.json `pnpm` field) — this is
    // the minimum pnpm that accepts that file at all.
    engines: { pnpm: SCAFFOLD_PNPM_RANGE },
    scripts: template.scripts,
    dependencies: template.dependencies,
    devDependencies: template.devDependencies,
  };
}

/**
 * Render the `pnpm-workspace.yaml` that allowlists native build scripts and
 * declares the known-benign peer skews.
 * Declares an explicit empty `packages: []`: a workspace root with no member
 * packages, which is what a single-package scaffold is — the file stays purely
 * a settings file. Spelling the key out is what lets pnpm 10.0–10.4 (and 9.x)
 * parse the file at all; they read it before `engines` and refuse a file
 * without the key outright. ⛔ Never `packages: ['.']`: that declares the
 * project root a workspace MEMBER, i.e. a monorepo root, which this is not —
 * and it is the shape an AI reader would take as licence to add member packages
 * to a scaffolded app.
 *
 * The allowlist is emitted TWICE, under two keys that no single pnpm version
 * range reads both of. Measured against a scaffold of this exact shape, one
 * clean install per pnpm version, each with its own store:
 *
 *   pnpm 10.0.0 – 10.25.0   honour `onlyBuiltDependencies`; `allowBuilds`
 *                           alone leaves the builds unrun (a warning, exit 0).
 *   pnpm 10.26.0 – 10.34.x  honour either key.
 *   pnpm 11.x               honour `allowBuilds` ONLY. With
 *                           `onlyBuiltDependencies` alone, `pnpm install`
 *                           exits 1 with ERR_PNPM_IGNORED_BUILDS — byte for
 *                           byte the same failure as approving nothing at
 *                           all, because pnpm 11 turned an unapproved build
 *                           script from a warning into a hard error.
 *
 * Emitting only the older key is what made a freshly scaffolded project fail
 * its very first `pnpm install` for every user on pnpm 11. Both lists come
 * from the same `builtDeps` argument, so the two populations can never be
 * granted different build permission. This is the shape
 * `packages/create-objectstack/src/templates/blank/pnpm-workspace.yaml`
 * already ships for the other scaffold path.
 */
export function renderPnpmWorkspaceYaml(
  builtDeps: string[] = SCAFFOLD_BUILT_DEPENDENCIES,
  allowedPeerVersions: Record<string, string> = SCAFFOLD_ALLOWED_PEER_VERSIONS,
): string {
  const peerEntries = Object.entries(allowedPeerVersions);

  return [
    '# An explicit EMPTY workspace: this project has no member packages, so',
    '# this file is settings-only. The key is not decoration — pnpm 9.x and',
    '# 10.0–10.4 parse this file BEFORE they read `engines`, and refuse a file',
    '# without a `packages:` key outright ("ERROR packages field missing or',
    '# empty") before resolving a single dependency.',
    '# Not `packages: [\'.\']`: that would declare this project a workspace',
    '# MEMBER — a monorepo root, which it is not.',
    'packages: []',
    '',
    '# pnpm does not run dependency build scripts unless they are approved',
    '# here. Without this file a fresh `pnpm install` exits 1 on pnpm 11 with',
    '# ERR_PNPM_IGNORED_BUILDS — pnpm 10 only warned, pnpm 11 made it a hard',
    '# error. Without the build, better-sqlite3 can ship without a usable',
    '# binding and `objectstack serve` fails with "Could not locate the',
    '# bindings file".',
    '#',
    '# Both keys are needed; no single pnpm version range reads both:',
    '#   allowBuilds             pnpm >= 10.26, and the ONLY key pnpm 11 reads',
    '#                           — with onlyBuiltDependencies alone pnpm 11',
    '#                           exits 1 exactly as if nothing were approved.',
    '#   onlyBuiltDependencies   pnpm 10.0–10.25, which ignore allowBuilds.',
    '#                           pnpm 11 ignores this key.',
    '#',
    '# npm, yarn and bun ignore this file and build native modules anyway.',
    'onlyBuiltDependencies:',
    ...builtDeps.map((d) => `  - ${d}`),
    '',
    'allowBuilds:',
    ...builtDeps.map((d) => `  ${d}: true`),
    // No rules, no header: a bare `peerDependencyRules:` would advertise a
    // declaration that is not there.
    ...(peerEntries.length === 0 ? [] : [
      '',
      '# Third-party peer ranges that resolve outside what their declaring',
      '# package states, and that pnpm reports on a first install. None is a',
      '# real incompatibility:',
      '#',
      '#   better-auth peers better-sqlite3 ^12.0.0 while the tree resolves 13.x.',
      '#   That peer is optional and covers handing better-auth a raw',
      '#   better-sqlite3 `Database`; ObjectStack hands it an ObjectQL adapter',
      '#   instead. Measured on the configuration the range does cover,',
      '#   better-auth 1.7.1 behaves identically on 13.0.3 and on 12.11.1.',
      '#',
      '#   @better-auth/scim (held at a release candidate deliberately) peers an',
      '#   exact better-call 1.3.7, while better-auth itself depends on 1.4.0. A',
      '#   better-auth plugin has to share the host\'s better-call instance, so',
      '#   the single 1.4.0 copy is the correct resolution.',
      '#',
      '#   @better-auth/core, /oauth-provider, /scim and /sso each peer an exact',
      '#   @better-auth/utils 0.4.2, while better-call (better-auth\'s own HTTP',
      '#   layer) depends on ^0.5.0 and is what the tree resolves them against.',
      '#   0.5.0 keeps every symbol those four import — base64/base64Url,',
      '#   createHash, createRandomStringGenerator — with the same signatures',
      '#   and the same values on the inputs they pass, so the report is the',
      '#   only difference. Pinning utils back instead would drag better-call',
      '#   off its own declared range, which is a real violation rather than a',
      '#   reported one.',
      '#',
      '# These suppress the report only — no resolution moves, and the lockfile',
      '# is byte-identical with and without this block.',
      'peerDependencyRules:',
      '  allowedVersions:',
      ...peerEntries.map(([k, v]) => `    '${k}': '${v}'`),
    ]),
    '',
  ].join('\n');
}

export const TEMPLATES: Record<string, {
  description: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  configContent: (name: string, namespace: string) => string;
  srcFiles: Record<string, (name: string, namespace: string) => string>;
}> = {
  app: {
    description: 'Full application with objects',
    get dependencies() {
      const v = pkgVersion();
      // No driver is listed on purpose. `@objectstack/runtime` already depends
      // on driver-sql / driver-sqlite-wasm / driver-memory, and every script
      // here runs through the CLI, which carries them too — so naming one was
      // redundant. Naming `driver-memory` specifically also read as an
      // endorsement: it is the LAST-RESORT rung of the dev step-down (native
      // better-sqlite3 → wasm SQLite → mingo), not the driver a new app should
      // start on. `objectstack dev` resolves sqlite by default.
      return {
        '@objectstack/spec': v,
        '@objectstack/runtime': v,
        '@objectstack/objectql': v,
      };
    },
    get devDependencies() {
      return {
        '@objectstack/cli': pkgVersion(),
        'typescript': '^5.3.0',
      };
    },
    scripts: {
      dev: 'objectstack dev',
      // `serve` is production mode and boots from the compiled artifact
      // (dist/objectstack.json). Compile first so `pnpm start` works straight
      // after `pnpm install` without a separate build step.
      start: 'objectstack compile && objectstack serve',
      build: 'objectstack compile',
      validate: 'objectstack validate',
      typecheck: 'tsc --noEmit',
    },
    configContent: (name: string, namespace: string) => `import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.example.${namespace}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'app',
    name: '${toTitleCase(name)}',
    description: '${toTitleCase(name)} application built with ObjectStack',
    // Protocol compatibility range: the metadata-protocol major this app is
    // authored against. The runtime checks it before it loads anything, so a
    // runtime outside the range refuses this app at the boundary with the
    // exact migration command instead of crashing later. Scaffolding stamped
    // it to match the ObjectStack version you installed — change it when you
    // deliberately move to a new protocol major, not to silence a mismatch.
    // Guide: https://objectstack.ai/docs/upgrading
    engines: { protocol: '^${PROTOCOL_MAJOR}' },
  },

  objects: Object.values(objects),
});
`,
    srcFiles: {
      'src/objects/index.ts': (_name, namespace) => `export { default as ${toCamelCase(namespace)}Item } from './${namespace}_item';
`,
      'src/objects/__name___item.ts': (_name, namespace) => `import * as Data from '@objectstack/spec/data';

const ${toCamelCase(namespace)}Item: Data.Object = {
  name: '${namespace}_item',
  label: '${toTitleCase(namespace)} Item',
  fields: {
    name: {
      type: 'text',
      label: 'Name',
      required: true,
    },
    description: {
      type: 'textarea',
      label: 'Description',
    },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
      ],
      defaultValue: 'draft',
    },
  },
  // Org-wide default (OWD): who can see records they don't own. 'private' is
  // owner-only until access is widened by a permission grant or a sharing
  // rule. Declaring it is required, deliberately: \`objectstack build\`
  // refuses an object that declares no OWD, so the baseline is always an
  // authored decision rather than an accident. The other values, and how to
  // widen access safely: https://objectstack.ai/docs/permissions/sharing-rules
  sharingModel: 'private',
};

export default ${toCamelCase(namespace)}Item;
`,
    },
  },

  plugin: {
    description: 'Reusable plugin with objects',
    get dependencies() {
      return {
        '@objectstack/spec': pkgVersion(),
      };
    },
    get devDependencies() {
      return {
        '@objectstack/cli': pkgVersion(),
        'typescript': '^5.3.0',
        'vitest': '^4.0.18',
      };
    },
    scripts: {
      build: 'objectstack compile',
      validate: 'objectstack validate',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
    configContent: (name: string, namespace: string) => `import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.objectstack.plugin-${name}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'plugin',
    name: '${toTitleCase(name)} Plugin',
    description: 'ObjectStack Plugin: ${toTitleCase(name)}',
    // Protocol compatibility range: the metadata-protocol major this plugin
    // is authored against. The runtime checks it before it loads anything, so
    // a runtime outside the range refuses this plugin at the boundary with
    // the exact migration command instead of crashing later. Scaffolding
    // stamped it to match the ObjectStack version you installed — change it
    // when you deliberately move to a new protocol major, not to silence a
    // mismatch.
    // Guide: https://objectstack.ai/docs/upgrading
    engines: { protocol: '^${PROTOCOL_MAJOR}' },
  },

  objects: Object.values(objects),
});
`,
    srcFiles: {
      'src/objects/index.ts': (_name, namespace) => `export { default as ${toCamelCase(namespace)}Item } from './${namespace}_item';
`,
      'src/objects/__name___item.ts': (_name, namespace) => `import * as Data from '@objectstack/spec/data';

const ${toCamelCase(namespace)}Item: Data.Object = {
  name: '${namespace}_item',
  label: '${toTitleCase(namespace)} Item',
  fields: {
    name: {
      type: 'text',
      label: 'Name',
      required: true,
    },
  },
  // Org-wide default (OWD): who can see records they don't own. 'private' is
  // owner-only until access is widened by a permission grant or a sharing
  // rule. Declaring it is required, deliberately: \`objectstack build\`
  // refuses an object that declares no OWD, so the baseline is always an
  // authored decision rather than an accident. The other values, and how to
  // widen access safely: https://objectstack.ai/docs/permissions/sharing-rules
  sharingModel: 'private',
};

export default ${toCamelCase(namespace)}Item;
`,
    },
  },

  empty: {
    description: 'Minimal project with just a config file',
    get dependencies() {
      return {
        '@objectstack/spec': pkgVersion(),
      };
    },
    get devDependencies() {
      return {
        '@objectstack/cli': pkgVersion(),
        'typescript': '^5.3.0',
      };
    },
    scripts: {
      build: 'objectstack compile',
      validate: 'objectstack validate',
      typecheck: 'tsc --noEmit',
    },
    configContent: (name: string, namespace: string) => `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: {
    id: 'com.example.${namespace}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'app',
    name: '${toTitleCase(name)}',
    description: '',
    // Protocol compatibility range: the metadata-protocol major this app is
    // authored against. The runtime checks it before it loads anything, so a
    // runtime outside the range refuses this app at the boundary with the
    // exact migration command instead of crashing later. Scaffolding stamped
    // it to match the ObjectStack version you installed — change it when you
    // deliberately move to a new protocol major, not to silence a mismatch.
    // Guide: https://objectstack.ai/docs/upgrading
    engines: { protocol: '^${PROTOCOL_MAJOR}' },
  },
});
`,
    srcFiles: {},
  },
};

function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function printWarning(msg: string) {
  console.log(chalk.yellow(`  ⚠ ${msg}`));
}

/**
 * Print the closing "Created files" summary from a walk of the FINISHED
 * project directory, not from a list accumulated while writing the
 * template. A list built during the copy phase is printed before `<pm>
 * install` runs and so can never name `pnpm-lock.yaml`, `package-lock.json`,
 * `node_modules/`, or anything else the package manager writes — the exact
 * gap this replaces (measured: a fresh `init` omitted a 138 KB
 * `pnpm-lock.yaml` and a 575 MB `node_modules/` from its own "Created
 * files" list). Reuses `create-objectstack`'s `created-summary.ts` (see its
 * header for the reachability measurement that made a hand-accumulated
 * list untenable for that scaffolder) instead of a second copy of the same
 * renderer — the two scaffold paths already drifted once (#10499) from
 * carrying separate implementations of the same list.
 *
 * Called once, after the install attempt (success OR failure) has run its
 * course, so it always reports the real state of disk at that point rather
 * than a promise: on a failed install it shows whatever partial state the
 * failure left behind instead of silently disappearing.
 */
function printCreatedFilesSummary(targetDir: string, wasEmpty: boolean) {
  const entries = summarizeTree(targetDir);
  if (entries.length === 0) return;

  console.log(chalk.bold(wasEmpty ? '  Created files:' : '  Project contents:'));
  if (!wasEmpty) {
    console.log(chalk.dim('    (the directory already had contents; this lists all of it)'));
  }

  const width = Math.min(44, Math.max(...entries.map((e) => e.path.length)) + 2);
  for (const entry of entries) {
    const note = describeEntry(entry);
    const pad = note ? entry.path.padEnd(width) : entry.path;
    console.log(chalk.green(`    + ${pad}${note ? chalk.dim(note) : ''}`));
  }
  console.log('');
}

/**
 * Write a template's `srcFiles` into `targetDir` and return the relative paths
 * written, in creation order.
 *
 * File paths use `__name__` as a placeholder for the NAMESPACE (not the npm
 * name) so generated identifiers stay snake_case even when the project name
 * contains hyphens (`my-app` → namespace `my_app` → `src/objects/my_app_item.ts`).
 *
 * Exported so the scaffold pin test generates projects through the real
 * emitter instead of a copy of it. A test that re-implemented this loop could
 * drift from it silently, and the drift would land in exactly the class the
 * pin exists to catch: a shipped template the CLI's own rules refuse.
 */
export function writeTemplateSrcFiles(
  srcFiles: Record<string, (name: string, namespace: string) => string>,
  targetDir: string,
  projectName: string,
  namespace: string,
): string[] {
  const written: string[] = [];
  for (const [filePath, contentFn] of Object.entries(srcFiles)) {
    const resolvedPath = filePath.replace(/__name__/g, namespace);
    const fullPath = path.join(targetDir, resolvedPath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, contentFn(projectName, namespace));
    written.push(resolvedPath);
  }
  return written;
}

/**
 * Detect the package manager that invoked this CLI by inspecting
 * `npm_config_user_agent` (set by every modern PM). Falls back to `npm`,
 * which is universally available and the safest default for `npx`-style
 * invocations.
 */
export function detectPackageManager(env: NodeJS.ProcessEnv = process.env): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  const ua = env.npm_config_user_agent || '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

/**
 * Validate that `name` is a usable npm package name AND a safe directory
 * segment. Mirrors the subset of rules used by `npm init`/`create-vite`.
 */
function validateProjectName(name: string): string | null {
  if (!name) return 'Project name is required';
  if (name.length > 214) return 'Project name must be ≤ 214 characters';
  if (/[A-Z]/.test(name)) return 'Project name must be lowercase';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return 'Project name must start with a lowercase letter or digit and contain only [a-z0-9._-]';
  }
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return 'Project name must not contain path separators';
  }
  return null;
}

export default class Init extends Command {
  static override id = 'init';

  static override description = 'Initialize a new ObjectStack project';

  static override args = {
    name: Args.string({
      description: 'Project name. When provided, a new directory with this name is created; otherwise the current directory is used.',
      required: false,
    }),
  };

  static override flags = {
    template: Flags.string({ char: 't', description: 'Template: app, plugin, empty', default: 'app' }),
    install: Flags.boolean({ description: 'Install dependencies', default: true, allowNo: true }),
    'package-manager': Flags.string({
      char: 'p',
      description: 'Package manager to use for install (auto-detected from npm_config_user_agent)',
      options: ['npm', 'pnpm', 'yarn', 'bun'],
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);

    printHeader('Init');

    const startCwd = process.cwd();
    const template = TEMPLATES[flags.template];

    if (!template) {
      printError(`Unknown template: ${flags.template}`);
      console.log(chalk.dim(`  Available: ${Object.keys(TEMPLATES).join(', ')}`));
      this.error(`Unknown template: ${flags.template}`);
    }

    // Resolve target directory + project name.
    //
    // If a name is supplied, scaffold into ./<name>/ (created if missing).
    // This matches `npm create`, `pnpm create`, `vite`, etc. — the user's
    // confusion in the bug report came from `init my-app` overwriting the
    // current directory while the printed summary said "Project: my-app".
    //
    // If no name is supplied, scaffold into the current directory and use
    // its basename as the project name.
    let targetDir: string;
    let projectName: string;
    if (args.name) {
      const nameError = validateProjectName(args.name);
      if (nameError) {
        printError(nameError);
        this.error(nameError);
      }
      projectName = args.name;
      targetDir = path.resolve(startCwd, args.name);
      if (fs.existsSync(targetDir)) {
        const entries = fs.readdirSync(targetDir).filter((e) => e !== '.git');
        if (entries.length > 0) {
          const msg = `Target directory ${targetDir} is not empty`;
          printError(msg);
          console.log(chalk.dim('  Choose a different name or remove the existing directory first.'));
          this.error(msg);
        }
      } else {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    } else {
      targetDir = startCwd;
      projectName = path.basename(startCwd);
      const nameError = validateProjectName(projectName);
      if (nameError) {
        printError(`Current directory name "${projectName}" is not a valid project name. ${nameError}`);
        console.log(chalk.dim('  Re-run with an explicit name: `objectstack init my-app`'));
        this.error(nameError);
      }
    }

    // Check for existing config
    if (fs.existsSync(path.join(targetDir, 'objectstack.config.ts'))) {
      printError(`objectstack.config.ts already exists in ${targetDir}`);
      console.log(chalk.dim('  Use `objectstack generate` to add metadata to an existing project'));
      this.error('objectstack.config.ts already exists');
    }

    // Convert the npm-name (which allows hyphens, dots, scopes) into a
    // valid ObjectStack namespace identifier. Threaded into every template
    // function so object names use `${namespace}_${shortName}` form and
    // satisfy `defineStack()` validation.
    const namespace = sanitizeNamespace(projectName);

    printKV('Project', projectName);
    printKV('Namespace', namespace);
    printKV('Template', `${flags.template} — ${template.description}`);
    printKV('Directory', targetDir);
    console.log('');

    // Read BEFORE the first write. The named-arg branch above refuses a
    // non-empty target, but the no-name branch scaffolds into whatever the
    // current directory already is — the closing summary is a walk of that
    // directory, so it must know whether it is entitled to call what it
    // finds "Created files" (mirrors create-objectstack's own `targetWasEmpty`).
    let targetWasEmpty = true;
    try {
      targetWasEmpty = fs.readdirSync(targetDir).filter((e) => e !== '.git').length === 0;
    } catch {
      // targetDir does not exist — treated as empty (defensive; both
      // branches above already create or verify it before this point).
    }

    let installSucceeded = false;
    let installAttempted = false;
    let chosenPm: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm';

    try {
      // 1. Create package.json if missing
      const pkgPath = path.join(targetDir, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        const pkg = renderScaffoldPackageJson(projectName, template);
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      } else {
        printInfo('package.json already exists, skipping');
      }

      // 1b. Create pnpm-workspace.yaml so pnpm compiles the native deps the
      // standalone store needs (see SCAFFOLD_BUILT_DEPENDENCIES). Harmless for
      // npm/yarn/bun, which ignore this file and build native modules anyway.
      // Use an exclusive write ('wx') rather than exists()-then-write so the
      // "don't clobber an existing file" check is atomic (no TOCTOU race).
      const pnpmWorkspacePath = path.join(targetDir, 'pnpm-workspace.yaml');
      try {
        fs.writeFileSync(pnpmWorkspacePath, renderPnpmWorkspaceYaml(), { flag: 'wx' });
      } catch (err: any) {
        if (err?.code !== 'EEXIST') throw err;
      }

      // 2. Create objectstack.config.ts
      const configContent = template.configContent(projectName, namespace);
      fs.writeFileSync(path.join(targetDir, 'objectstack.config.ts'), configContent);

      // 3. Create tsconfig.json if missing
      const tsconfigPath = path.join(targetDir, 'tsconfig.json');
      if (!fs.existsSync(tsconfigPath)) {
        const tsconfig = {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            outDir: 'dist',
            rootDir: '.',
            declaration: true,
          },
          include: ['*.ts', 'src/**/*'],
          exclude: ['dist', 'node_modules'],
        };
        fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
      }

      // 4. Create src files (see `writeTemplateSrcFiles` for the `__name__`
      //    placeholder rule and why the loop is exported).
      writeTemplateSrcFiles(template.srcFiles, targetDir, projectName, namespace);

      // 5. Create .gitignore if missing
      const gitignorePath = path.join(targetDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, `node_modules/\ndist/\n*.tsbuildinfo\n`);
      }

      // Install dependencies
      if (flags.install) {
        chosenPm = (flags['package-manager'] as typeof chosenPm | undefined) ?? detectPackageManager();
        printStep(`Installing dependencies with ${chosenPm}...`);
        installAttempted = true;
        const { execSync } = await import('child_process');
        try {
          execSync(`${chosenPm} install`, { stdio: 'inherit', cwd: targetDir });
          installSucceeded = true;
        } catch {
          printWarning(`Dependency installation with ${chosenPm} failed. Run \`${chosenPm} install\` manually in ${targetDir}.`);
        }
      }

      // Created-files summary — printed HERE, after the install attempt has
      // run its course (whether it succeeded or failed), so it can name what
      // `<pm> install` wrote. See `printCreatedFilesSummary` for why.
      printCreatedFilesSummary(targetDir, targetWasEmpty);

      // Self-test the scaffold so we catch template regressions before the
      // user discovers them by running `objectstack dev`. Only runs when deps
      // are present — `defineStack()` validation lives in `@objectstack/spec`.
      //
      // This used to check only that the rendered config LOADED and carried a
      // `manifest.namespace`, which is how the CLI shipped a `-t app` template
      // its own author-time rules refused: `init` printed `✓ Scaffold
      // validated`, and the documented next command — `npm run dev` — died on
      // `security-owd-unset` before the dev server ever started. The self-test
      // now runs the same rule set `dev` reaches through `os compile`
      // (`SCAFFOLD_RULE_COMMAND`), so a template that cannot compile fails
      // HERE, at generation time, in CI, instead of at a user's first `dev`.
      // It is a shift-left, not a new bar: same registry, same command tier.
      if (installSucceeded) {
        printStep('Validating scaffold...');
        let scaffoldRejected = false;
        try {
          const report = await validateScaffold(targetDir);

          for (const f of report.advisories.slice(0, 50)) {
            printWarning(`${f.where}: ${f.message}`);
            if (f.hint) console.log(chalk.dim(`    ${f.hint}`));
            console.log(chalk.dim(`    rule: ${f.rule}  at ${f.path}`));
          }

          if (report.schemaError) {
            printError('Scaffold validation failed: rendered config does not satisfy the protocol schema');
            formatZodErrors(report.schemaError);
            scaffoldRejected = true;
          } else if (report.errors.length > 0) {
            // Report every failing rule at once, like `os validate` / `os build`.
            printError(
              `Scaffold validation failed: author-time rules rejected the generated project (${report.errors.length} issue${report.errors.length > 1 ? 's' : ''})`,
            );
            for (const f of report.errors.slice(0, 50)) {
              console.log(`  • ${f.where}: ${f.message}`);
              if (f.hint) console.log(chalk.dim(`      ${f.hint}`));
              console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
            }
            scaffoldRejected = true;
          } else {
            printSuccess(
              `Scaffold validated (namespace: ${report.namespace}; ${report.ruleCount} author-time rules passed)`,
            );
          }
        } catch (err: any) {
          printError(`Scaffold validation failed: ${err.message || err}`);
          scaffoldRejected = true;
        }

        if (scaffoldRejected) {
          console.log(chalk.dim('  This is a CLI bug — please report it at https://github.com/objectstack-ai/objectstack/issues'));
          this.error('Scaffold validation failed');
        }
      }

      if (!installAttempted || installSucceeded) {
        printSuccess('Project initialized!');
        console.log('');
        console.log(chalk.bold('  Next steps:'));
        if (targetDir !== startCwd) {
          console.log(chalk.dim(`    cd ${path.relative(startCwd, targetDir) || '.'}`));
        }
        const runCmd = chosenPm === 'npm' ? 'npx objectstack' : `${chosenPm} exec objectstack`;
        if (!installAttempted) {
          console.log(chalk.dim(`    ${chosenPm} install            # Install dependencies`));
        }
        console.log(chalk.dim(`    ${runCmd} validate   # Check configuration`));
        console.log(chalk.dim(`    ${runCmd} dev        # Start development server`));
        console.log(chalk.dim(`    ${runCmd} generate   # Add objects, views, etc.`));
        console.log('');
      } else {
        // Install failed — surface clear remediation instead of pretending success.
        printError('Project scaffolded, but dependency installation failed.');
        console.log('');
        console.log(chalk.bold('  To finish setup:'));
        if (targetDir !== startCwd) {
          console.log(chalk.dim(`    cd ${path.relative(startCwd, targetDir) || '.'}`));
        }
        console.log(chalk.dim(`    ${chosenPm} install`));
        console.log('');
        this.error('Dependency installation failed');
      }

    } catch (error: any) {
      printError(error.message || String(error));
      this.error(error.message || String(error));
    }
  }
}
