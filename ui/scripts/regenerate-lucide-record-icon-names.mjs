#!/usr/bin/env node
/**
 * Regenerates `packages/components/src/lib/lucide-record-icon-names.ts` — the
 * BUILD-GENERATED static list of the icon names the seam accepts, and the
 * kebab-case spelling each one loads.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * `renderers/action/resolve-icon.ts` used to answer "is this a legal icon
 * name?" by INDEXING lucide's runtime `icons` record. A namespace object has no
 * dead members, so that one index pulled EVERY icon module into the eager
 * closure: measured on the console build at `ac05d4f4dd`, 1,781 icon module
 * definitions inside `assets/ui-components-*.js` — 1,499 KB raw of a 1,535,917
 * byte chunk. The record was the payload, and the name list was free only
 * because the payload was already there.
 *
 * ⛔ So the membership set may NOT be derived from `Object.keys(icons)`: that
 * derivation IS the eager record, written a second way. Deriving it would pin
 * the record eager for as long as anything asked a name question — which is
 * what objectui#9204's rescue option A proposed and what the ruling on
 * objectui#9251 refused, verbatim: 「合法图标名集合由构建期生成的静态名单提供
 * (⛔ 不从 `Object.keys(icons)` 推导)」.
 *
 * ── What it reads instead ──────────────────────────────────────────────────
 *
 * lucide's OWN export manifest, `lucide-react/dist/esm/icons/index.mjs`, which
 * is the file the `icons` record is built from:
 *
 *     export { default as ArrowDown01 } from './arrow-down-0-1.mjs';
 *
 * Each line carries BOTH spellings this repo needs — the PascalCase key the
 * seam looks names up by, and the kebab-case module name `DynamicIcon` loads.
 * Reading the manifest as TEXT is what keeps the generation off the record: no
 * icon module is ever imported here, so nothing about this script can bring one
 * into anybody's bundle.
 *
 * ⚠️ The second spelling is not decoration and ⛔ must not be replaced by a
 * conversion rule at the call site. The keys that do not survive one —
 * however many the `carries the kebab spelling lucide ships` pin re-derives on
 * the installed release — include `ArrowDown01`, which is `arrow-down-0-1`,
 * and `Axis3d`, which is `axis-3d`. A PascalCase-to-kebab regex silently
 * produces `arrow-down01` and `axis3d`, neither of which `dynamicIconImports`
 * can load — and the failure surfaces as an icon that renders nothing, with no
 * error.
 *
 * ── The three preconditions it refuses to write without ────────────────────
 *
 * Each one is a way this generator could produce a plausible-looking file that
 * is wrong, so each is checked rather than assumed:
 *
 *   1. The parse found icons at all, and a known pair is among them. A regex
 *      that stops matching after a lucide release upgrade would otherwise write
 *      an empty or truncated list and every icon in the product would stop
 *      resolving, quietly, with the gate green.
 *   2. Every kebab spelling is a key of `dynamicIconImports`. That map is what
 *      the seam loads through; a name that is in the record but not in the map
 *      resolves to a component that throws on mount instead of to `null`.
 *   3. The PascalCase keys are unique and the kebab targets are unique. The
 *      table is a bijection today; an aliasing release would make the decoded
 *      map lossy in a way no consumer could detect.
 *
 * The equality between this derivation and lucide's runtime record is asserted
 * SEPARATELY, in `scripts/check-lucide-icon-record-names.mjs`, which already
 * loads the record for its own judgement. Keeping the record out of this script
 * is the point; keeping the comparison is what proves the manifest is the same
 * vocabulary.
 *
 * Run:    node scripts/regenerate-lucide-record-icon-names.mjs
 * Verify: node scripts/regenerate-lucide-record-icon-names.mjs --check
 * Gated:  `pnpm check:icon-record-names` runs the same comparison as part 4 of
 *         the census gate, so a drifted file fails CI without a second step.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TARGET = 'packages/components/src/lib/lucide-record-icon-names.ts';

/**
 * `lucide-react` is not resolvable from the repo root — only the packages that
 * declare it have it. Resolve it from the package that owns the seam, so this
 * generator reads the very copy `resolve-icon.ts` will load at runtime.
 */
export const LUCIDE_OWNER_PKG = 'packages/components/package.json';

/** The manifest line shape, and the only thing this script parses. */
const EXPORT_LINE = /^export \{ default as ([A-Za-z0-9]+) \} from '\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\.mjs';$/;

/**
 * A pair this repo authors today and that lucide has carried for years. It is
 * the FIRING CONTROL on precondition 1: a parse that returns rows but not this
 * one has matched something other than the manifest.
 */
const CONTROL_PAIR = ['House', 'house'];

/**
 * One of the keys a PascalCase-to-kebab conversion gets wrong, used as the
 * second FIRING CONTROL on precondition 1.
 *
 * ⛔ It must be a name lucide still carries in the manifest. This control was
 * `Trash2 -> trash-2`, and that is a spelling lucide RETIRED — so the control
 * began failing on an upgrade that had broken nothing, reporting a refusal to
 * write where the derivation was in fact intact. A control that fires on the
 * library's own vocabulary moving is measuring the wrong thing; it has to fire
 * only on the PARSE breaking.
 */
const DIGIT_CONTROL_PAIR = ['ArrowDown01', 'arrow-down-0-1'];

/**
 * Every `Pascal -> kebab` pair lucide's own export manifest declares, sorted by
 * the PascalCase key so the emitted file is stable across runs.
 *
 * @param {string} [root] repository root
 * @returns {[string, string][]}
 */
export function deriveRecordIconNamePairs(root = repoRoot) {
  const lucideRequire = createRequire(join(root, LUCIDE_OWNER_PKG));
  // The ESM manifest, deliberately: `dist/esm/lucide-react.mjs` builds the
  // `icons` record out of exactly this file (`import * as index from
  // './icons/index.mjs'`), and the ESM tree is the one the console's bundler
  // reads. ⛔ Not `require.resolve('lucide-react')`, which answers with the CJS
  // `main` and would put this on a build nothing ships.
  const lucideRoot = dirname(lucideRequire.resolve('lucide-react/package.json'));
  const manifestPath = join(lucideRoot, 'dist/esm/icons/index.mjs');
  const manifest = readFileSync(manifestPath, 'utf8');

  /** @type {[string, string][]} */
  const pairs = [];
  for (const line of manifest.split('\n')) {
    const match = EXPORT_LINE.exec(line.trim());
    if (match) pairs.push([match[1], match[2]]);
  }

  // Precondition 1 — the parse found the manifest, not merely some lines.
  if (pairs.length === 0) {
    throw new Error(
      `no icon exports parsed out of ${manifestPath}. The manifest's line shape has changed; ` +
        'refusing to write an empty legal-name list.',
    );
  }
  for (const [pascal, kebab] of [CONTROL_PAIR, DIGIT_CONTROL_PAIR]) {
    if (!pairs.some(([p, k]) => p === pascal && k === kebab)) {
      throw new Error(
        `the control pair ${pascal} -> ${kebab} is absent from the parse of ${manifestPath}. ` +
          'A parse that misses a name lucide still ships is not a reading; refusing to write.',
      );
    }
  }

  // Precondition 3 — the table must stay a bijection.
  const seenPascal = new Set();
  const seenKebab = new Set();
  for (const [pascal, kebab] of pairs) {
    if (seenPascal.has(pascal)) throw new Error(`duplicate PascalCase key in the manifest: ${pascal}`);
    if (seenKebab.has(kebab)) throw new Error(`two PascalCase keys share the kebab target ${kebab}`);
    seenPascal.add(pascal);
    seenKebab.add(kebab);
  }

  return pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Precondition 2 — every kebab spelling must be loadable through the dynamic
 * import map. Separated from the parse because it is the only step that imports
 * anything out of lucide, and it imports the MAP (a table of thunks), never an
 * icon module.
 *
 * @param {[string, string][]} pairs
 * @param {string} [root]
 */
export async function assertLoadableThroughDynamicMap(pairs, root = repoRoot) {
  const lucideRequire = createRequire(join(root, LUCIDE_OWNER_PKG));
  const dynamic = await import(pathToFileURL(lucideRequire.resolve('lucide-react/dynamic.mjs')).href);
  const loadable = new Set(Object.keys(dynamic.dynamicIconImports));
  if (loadable.size === 0) {
    throw new Error('lucide\'s dynamic import map is empty — the probe is blind, so its silence proves nothing.');
  }
  const missing = pairs.filter(([, kebab]) => !loadable.has(kebab));
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} record icon name(s) are not keys of lucide's dynamic import map and could ` +
        `not be loaded at runtime: ${missing.slice(0, 5).map(([p, k]) => `${p} -> ${k}`).join(', ')}`,
    );
  }
}

/**
 * The exact contents the committed module must have.
 *
 * ## Why one delimited string and not an object literal
 *
 * The table is eager — the seam has to answer "is this name legal?" while it
 * renders, so the answer cannot be awaited. Two shapes were measured at the
 * commit this landed on, gzipped standalone: an object literal of 1,781
 * properties is 45,307 raw / 14,106 gzipped; this string is 41,745 / 13,857.
 * The string also costs nothing at module-evaluation time — it is parsed into a
 * `Map` on the first lookup and never at all on a page that draws no icon,
 * where the object literal would allocate 1,781 properties regardless.
 *
 * ⛔ The figures above are anchored to that measurement and are NOT a live
 * claim; `pnpm check:eager-closure` weighs what the chunk costs today.
 *
 * @param {[string, string][]} pairs
 */
export function renderModule(pairs) {
  const table = pairs.map(([pascal, kebab]) => `${pascal}:${kebab}`).join(',');
  return `/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate:  node scripts/regenerate-lucide-record-icon-names.mjs
 * Verified by: scripts/check-lucide-icon-record-names.mjs (part 4), which also
 *              proves this list is the same vocabulary as lucide's runtime
 *              \`icons\` record.
 *
 * The legal icon-name set for \`renderers/action/resolve-icon.ts\`, as read out
 * of lucide's own export manifest at generation time.
 *
 * Each entry is \`PascalCaseKey:kebab-module-name\`. The first is what the seam
 * looks a tokenised author-supplied name up by; the second is what
 * \`DynamicIcon\` loads. ⛔ The second is NOT derivable from the first by a
 * regex — many of these keys carry digits or leading initials that lucide
 * splits and a conversion does not (\`ArrowDown01\` is \`arrow-down-0-1\`,
 * \`Axis3d\` is \`axis-3d\`).
 *
 * ⛔ This list is deliberately NOT \`Object.keys(icons)\`. That derivation is the
 * eager record written a second way: indexing the record pulls every icon
 * module into the eager closure, which is the payload objectui#9251 removed.
 */

export const LUCIDE_RECORD_ICON_NAME_TABLE =
  '${table}';
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const target = join(repoRoot, TARGET);

  let expected;
  try {
    const pairs = deriveRecordIconNamePairs();
    await assertLoadableThroughDynamicMap(pairs);
    expected = renderModule(pairs);
  } catch (e) {
    console.error(`x ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }

  let actual = null;
  try {
    actual = readFileSync(target, 'utf8');
  } catch {
    actual = null;
  }

  if (actual === expected) {
    console.log(`OK ${TARGET} matches lucide's export manifest.`);
    return;
  }

  if (check) {
    console.error(
      `x ${TARGET} has drifted from lucide's export manifest.\n` +
        '  Run `node scripts/regenerate-lucide-record-icon-names.mjs` and commit the result.',
    );
    process.exit(1);
    return;
  }

  writeFileSync(target, expected);
  console.log(`wrote ${TARGET}`);
}

if (isEntrypoint(import.meta.url)) {
  await main();
}
