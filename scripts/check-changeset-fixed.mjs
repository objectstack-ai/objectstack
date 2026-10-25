#!/usr/bin/env node
/**
 * Validates that every publishable workspace package is enumerated in the
 * Changesets `fixed` group, so a new public package can never silently be
 * released out of lockstep with the rest of the monorepo.
 *
 * Run:  node scripts/check-changeset-fixed.mjs
 *
 * Exits with code 1 (and a clear diff) if:
 *   - A public (non-private) workspace package is missing from the
 *     `fixed` group in .changeset/config.json
 *   - A name listed in the `fixed` group no longer exists in the workspace,
 *     or names a private package that `PRIVATE_FIXED_MEMBERS` does not declare
 *   - A declared private member is missing from the group, is not a private
 *     workspace package, or sits there while `privatePackages.version` is not
 *     true (Changesets would then leave it unversioned inside a lockstep group)
 *
 * The script intentionally has zero third-party dependencies so it can run
 * in minimal CI environments before `pnpm install`. The workspace walk comes
 * from scripts/workspace-enumerator.mjs, which has none either, for the same
 * reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * Private workspace packages that belong in the `fixed` group anyway, each with
 * the reason it is there. Every other name in the group must be public.
 *
 * `object-ui` is the VS Code extension (`ui/packages/vscode-extension`). It is
 * never published to npm, but it ships at the release's version: Tesla's ruling
 * of 2026-10-25 (decision 17b, ruling B, objectstack#25711) keeps it in the one
 * version group 「同一个版本号组」 the objectui merge created, as objectui's own
 * group had. A private package outside this list is still refused in the group,
 * so a package marked private by mistake cannot hide in it.
 *
 * Readers that count "published packages" (`check-lockstep-package-count.mjs`)
 * subtract these names.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PRIVATE_FIXED_MEMBERS = Object.freeze({
  'object-ui': 'the VS Code extension: never on npm, versioned with the release (decision 17b, objectstack#25711)',
});

/**
 * Names of all non-private workspace packages.
 *
 * Membership comes from `scripts/workspace-enumerator.mjs` (#11510) — this
 * repo's one parse of `pnpm-workspace.yaml`, and one of nine private copies
 * before it. Two behaviours of the copy that used to live here changed, both
 * toward refusing rather than under-reporting, and neither observable on this
 * repo's workspace file:
 *
 *   - a missing or empty `packages:` block used to yield `[]`, which made this
 *     gate report the `fixed` group in sync with a workspace of zero packages —
 *     green, and vacuous. It now throws.
 *   - a `#` was stripped unconditionally, so a member path legitimately
 *     containing one was silently truncated to a directory that does not exist.
 *     Only a whitespace-led `#` is a comment now.
 *
 * @returns {string[]}
 */
function listPackageNames() {
  const publicNames = new Set();
  const privateNames = new Set();
  for (const { manifest } of workspacePackages(repoRoot)) {
    if (!manifest.name) continue;
    (manifest.private === true ? privateNames : publicNames).add(manifest.name);
  }
  return { publicNames: [...publicNames].sort(), privateNames };
}

function readConfig() {
  const configPath = resolve(repoRoot, '.changeset/config.json');
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

/**
 * Judges a config against the workspace. Pure, so the declared-private rules
 * can be read without a tree.
 *
 * @param {{ fixed?: string[][]; privatePackages?: { version?: boolean } }} config
 * @param {{ publicNames: string[]; privateNames: Set<string> }} packages
 * @param {Readonly<Record<string, string>>} [declared]
 */
export function judge(config, { publicNames, privateNames }, declared = PRIVATE_FIXED_MEMBERS) {
  const fixed = new Set(Array.isArray(config.fixed) ? config.fixed.flat() : []);
  const isDeclaredPrivate = (name) => Object.hasOwn(declared, name) && privateNames.has(name);

  const missing = publicNames.filter((name) => !fixed.has(name));
  const stale = [...fixed].filter((name) => !publicNames.includes(name) && !isDeclaredPrivate(name)).sort();
  const declaredProblems = [];
  for (const name of Object.keys(declared).sort()) {
    if (publicNames.includes(name)) {
      declaredProblems.push(`${name} is declared a private member but its manifest is public; drop it from PRIVATE_FIXED_MEMBERS`);
    } else if (!privateNames.has(name)) {
      // No such package in this tree: `stale` already names it when the group does.
      continue;
    } else if (!fixed.has(name)) {
      declaredProblems.push(`${name} (${declared[name]}) is missing from "fixed"`);
    } else if (config.privatePackages?.version !== true) {
      declaredProblems.push(`${name} sits in "fixed" while privatePackages.version is not true, so Changesets would not version it`);
    }
  }
  return { missing, stale, declaredProblems };
}

function main() {
  const packages = listPackageNames();
  const { missing, stale, declaredProblems } = judge(readConfig(), packages);

  if (missing.length === 0 && stale.length === 0 && declaredProblems.length === 0) {
    const privateCount = Object.keys(PRIVATE_FIXED_MEMBERS).filter((name) => packages.privateNames.has(name)).length;
    console.log(
      `✓ .changeset/config.json "fixed" group is in sync with ${packages.publicNames.length} public workspace packages` +
        (privateCount > 0 ? ` and ${privateCount} declared private member(s).` : '.'),
    );
    return;
  }

  console.error('✗ .changeset/config.json "fixed" group is out of sync.');
  if (missing.length > 0) {
    console.error(
      '\nPublic packages missing from "fixed" (add them to keep versions in lockstep):',
    );
    for (const name of missing) console.error(`  - ${name}`);
  }
  if (stale.length > 0) {
    console.error(
      '\nNames in "fixed" that are no public workspace package and no declared private member (remove them, or declare a private one in PRIVATE_FIXED_MEMBERS):',
    );
    for (const name of stale) console.error(`  - ${name}`);
  }
  if (declaredProblems.length > 0) {
    console.error('\nDeclared private members (PRIVATE_FIXED_MEMBERS):');
    for (const problem of declaredProblems) console.error(`  - ${problem}`);
  }
  console.error(
    '\nEdit .changeset/config.json so the "fixed" group matches the public workspace, then re-run this script.',
  );
  process.exit(1);
}

if (isEntrypoint(import.meta.url)) main();
