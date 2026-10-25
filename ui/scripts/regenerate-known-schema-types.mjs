#!/usr/bin/env node
/**
 * Regenerates `packages/cli/src/utils/known-schema-types.ts` — the set of
 * component `type` values `objectui check` treats as known — from the
 * registration calls in this repository's source.
 *
 * Run:    node scripts/regenerate-known-schema-types.mjs
 * Verify: node scripts/regenerate-known-schema-types.mjs --check
 * Exit:   0 = the committed file matches the derivation, 1 = it has drifted
 *         (under `--check`) or the derivation collapsed.
 *
 * ## Why this script exists (objectui#5115)
 *
 * `objectui check` used to judge `type` against a seventeen-entry array typed
 * by hand into `packages/cli/src/commands/check.ts`. Nothing kept that array
 * and the registry in agreement, and by the time it was measured it had
 * drifted in BOTH directions at once:
 *
 *   PHANTOMS  — in the list, registered by nothing. `crud` and `gallery`.
 *               `objectui check` said nothing about `{ "type": "crud" }` while
 *               `SchemaRenderer` painted the OBJUI-001 "Unknown component
 *               type" panel for it. A gate that blesses a type the runtime
 *               does not have is worse than no gate: the author gets a green
 *               light and finds out in the browser.
 *   MISSING   — registered, absent from the list: 221 bare keys plus every
 *               namespaced spelling. `{ "type": "object-grid" }` and
 *               `{ "type": "view:grid" }` — both real registry keys — were
 *               both reported as unknown. False warnings at that volume train
 *               authors to ignore the check, which costs the phantom direction
 *               its only reader.
 *
 * ## Why a generated snapshot rather than a runtime lookup
 *
 * The obvious fix — ask `ComponentRegistry` at runtime instead of keeping a
 * copy — was measured and does not work here, for two independent reasons:
 *
 *  1. `packages/cli` depends on `@object-ui/components` only. Of the fifteen
 *     entries in the old list that ARE registered, eleven (`kanban`,
 *     `calendar`, `dashboard`, `chart`, `detail`, `timeline`, `gantt`, `map`,
 *     `object-view`, `detail-view`, `object-chart`) are registered by plugin
 *     packages the CLI does not depend on. Reaching them means a CLI that
 *     pulls in React, recharts, maplibre and twenty sibling packages to answer
 *     one question about a string.
 *  2. Even then it would answer the wrong question. The published CLI runs in
 *     a USER's project, whose plugin set this repository cannot know. The
 *     honest claim the check can make is "this names a component the ObjectUI
 *     stack registers", and that claim is about source, not about whatever
 *     happens to be loaded in the CLI's own process.
 *
 * So the copy stays, and what changes is that it is DERIVED and PINNED instead
 * of typed: this script writes it, and
 * `scripts/__tests__/known-schema-types-derivation-5115.test.ts` fails the
 * build when the committed file and the derivation disagree in either
 * direction. Add a registration, run this script; the pin is what makes
 * forgetting impossible.
 *
 * ## One derivation, two consumers
 *
 * The key universe comes from `deriveRegistryKeys` in
 * `scripts/check-doc-component-types.mjs` — deliberately the SAME derivation
 * that judges documentation snippets (objectui#4823), not a second scanner
 * with its own bugs. It handles the forms this repo actually uses (registration
 * keys as literals, loops and declared indirect helpers; registration OPTIONS
 * as an object literal of key-value pairs and plain-identifier spreads, or an
 * identifier resolving to one such literal), and an options ARGUMENT whose
 * shape it does not recognise fails there rather than silently shrinking the
 * universe here.
 *
 * ⚠️ That last clause is a PROPERTY OF THAT MODULE, not of this file, and this
 * header asserted it while it was false — which is why objectui#9641 exists at
 * all. A registration whose options arrive by reference, as
 * `register('app', PageRenderer, { ...pageMeta, label: 'App Page' })` with
 * `pageMeta.namespace` of `'ui'`, has no `namespace:` inside its own call span.
 * The derivation produced the bare half alone and reported NOTHING, so five
 * real runtime keys (`ui:page` `ui:app` `ui:utility` `ui:home` `ui:record`)
 * were missing from a generated list whose entire job is to say which keys are
 * real, and `objectui check` called documents spelling them unknown while the
 * renderer painted them.
 *
 * ⛔ The first repair for that fixed the two shapes this tree uses and left
 * seven siblings — a cast, a member expression, a call, three spread variants
 * and a computed `namespace` — falling through to the same silent reading,
 * while this paragraph re-asserted the clause. Restating a false invariant
 * beside a partial fix is the original defect one layer up, and it is the
 * reason the derivation now works from an ALLOWLIST: two options ARGUMENT
 * shapes are read and every other argument shape is an
 * `unresolved-registration-meta` finding. That is what makes the clause above
 * a description of the code rather than a hope about it; `deriveRegistryKeys`
 * is where to check it, and its own header and fixture pins are what hold it.
 *
 * ⚠️ AND THE CLAUSE IS NARROWER THAN IT READS, which is the third layer of the
 * same mistake and is stated here rather than discovered again. "A form it
 * cannot resolve" means a form it does not RECOGNISE. A form it recognises but
 * reads under a premise that does not hold — an options object reached by a
 * name that some spelling this derivation cannot see rebinds or writes to — is
 * read SILENTLY and shrinks or inflates the universe here with no finding
 * anywhere. Those readings are measured, enumerated in `declaredObjectBody`'s
 * and `optionsMutatedAfterDeclaration`'s headers, and pinned one per shape in
 * `scripts/__tests__/check-doc-component-types.test.ts` as KNOWN GAP readings.
 * ⛔ Closing them is not owed: a regex approximation of JavaScript scope and
 * mutation semantics has no finishing line, and the ruling on objectui#9641
 * (batch #150 item 2, letter B) is that the reachable end state is an accurate
 * declaration of what the instrument cannot see. This paragraph is that
 * declaration for this file; the pins are what re-derive it.
 *
 * The repair belongs there and not here for the reason this section already
 * gives: a second resolver in this file would be the second scanner it exists
 * to refuse.
 *
 * The universe is taken WHOLE, with no filtering — bare keys, namespaced keys
 * and the `protocol-placeholder:` spellings alike. A filter would be a second
 * rule to keep honest, and the check's question ("does this name something
 * registered") has the same answer for all of them.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveRegistryKeys } from './check-doc-component-types.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET = 'packages/cli/src/utils/known-schema-types.ts';

/** Keys the CLI ships, sorted and de-duplicated so the output is stable. */
export function deriveKnownSchemaTypes(root = repoRoot) {
  const { keys, findings } = deriveRegistryKeys(root);
  if (findings.length > 0) {
    const lines = findings.map((f) => `  ${f.reason} at ${f.site}: ${f.detail}`);
    throw new Error(
      `the registry derivation reported ${findings.length} finding(s); the key universe would be ` +
        `incomplete, so nothing was written:\n${lines.join('\n')}`,
    );
  }
  if (keys.size === 0) {
    throw new Error('the registry derivation produced no keys at all — refusing to write an empty list.');
  }
  return [...keys.keys()].sort();
}

/** The exact contents the committed module must have. */
export function renderModule(types) {
  const entries = types.map((t) => `  '${t}',`).join('\n');
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
 * Regenerate:  node scripts/regenerate-known-schema-types.mjs
 * Pinned by:   scripts/__tests__/known-schema-types-derivation-5115.test.ts
 *
 * Every component \`type\` this repository registers, as read out of the
 * registration calls themselves. \`objectui check\` uses it to decide whether a
 * schema's \`type\` names a component that exists.
 *
 * This list replaces a seventeen-entry array that was typed by hand into
 * \`check.ts\` and had drifted from the registry in both directions at once
 * (objectui#5115): it blessed \`crud\` and \`gallery\`, which nothing registers
 * and which render the OBJUI-001 "Unknown component type" panel, while
 * reporting 221 real bare keys — and every namespaced spelling, \`view:grid\`
 * included — as unknown. The header of the regeneration script carries the
 * measurements and explains why the CLI cannot simply ask \`ComponentRegistry\`.
 *
 * Both bare and namespaced spellings are present because both are real
 * registry keys: \`register('grid', C, { namespace: 'view' })\` stores
 * \`view:grid\` AND, unless \`skipFallback\` is set, bare \`grid\`.
 */

export const KNOWN_SCHEMA_TYPES: readonly string[] = [
${entries}
];

const KNOWN_SCHEMA_TYPE_SET: ReadonlySet<string> = new Set(KNOWN_SCHEMA_TYPES);

/**
 * Does \`type\` name a component the ObjectUI stack registers?
 *
 * Answers about THIS repository's registrations only. A user project that
 * registers its own components will have keys this cannot know about, which is
 * why \`objectui check\` reports an unrecognised type as a warning and never
 * fails the run on it.
 */
export function isKnownSchemaType(type: string): boolean {
  return KNOWN_SCHEMA_TYPE_SET.has(type);
}
`;
}

function main() {
  const check = process.argv.includes('--check');
  const target = join(repoRoot, TARGET);
  let expected;
  try {
    expected = renderModule(deriveKnownSchemaTypes());
  } catch (e) {
    console.error(`x ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  let actual = null;
  try {
    actual = readFileSync(target, 'utf8');
  } catch {
    actual = null;
  }

  if (actual === expected) {
    console.log(`OK ${TARGET} matches the registry derivation.`);
    return;
  }

  if (check) {
    console.error(
      `x ${TARGET} has drifted from the registry derivation.\n` +
        '  Run `node scripts/regenerate-known-schema-types.mjs` and commit the result.',
    );
    process.exit(1);
  }

  writeFileSync(target, expected);
  console.log(`wrote ${TARGET}`);
}

if (isEntrypoint(import.meta.url)) {
  main();
}
