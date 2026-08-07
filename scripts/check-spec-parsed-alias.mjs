#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0122 backflow guard — every schema with two shapes names both of them.
 *
 * ## The failure this exists for
 *
 * `packages/spec` spelled the same idea two ways for as long as it has existed,
 * and nobody knew which one was the house convention until #5551 measured it.
 * 1384 bare aliases read `z.infer` (the PARSED state) while 86 read `z.input`
 * (the AUTHOR state), and three separate first-hand sources described the
 * second, 8-file group as "the house convention" while it was in fact the
 * minority. An author — human or agent — reading one file could not tell which
 * dialect they were in, so `const c: Connector = { ... }` compiled in one domain
 * and failed in the next.
 *
 * ADR-0122 settles it: the **bare name is the author state** and **`XParsed` is
 * the parsed state**. Flipping 1384 aliases is a major-window change, so phase 1
 * moves in the one direction that breaks nothing — it declares `XParsed`
 * wherever the parsed state is a distinct type, giving every consumer a name
 * that survives the flip. This guard is what stops phase 1 from decaying between
 * now and then.
 *
 * ## What it checks
 *
 * For every `export type X = z.infer<typeof XSchema>` in
 * `packages/spec/src/**\/*.zod.ts` whose name is BARE (does not already end in
 * `Parsed` or `Input`), exactly one of these must hold:
 *
 *   1. the same file also declares `export type XParsed = z.infer<typeof XSchema>`
 *      — the schema's parsed state has its own name, so the phase-2 flip has a
 *      migration target; or
 *   2. `XSchema` is pinned in `packages/spec/src/type-alias-convention.pin.test.ts`
 *      as isomorphic — `z.input` and `z.infer` are the same type, so the flip
 *      changes nothing observable and a second name would be a synonym an
 *      author can only pick wrongly.
 *
 * A new alias that is neither is exactly the backflow: it lands looking like
 * every other alias and silently owes a migration target nobody will remember.
 *
 * ## Why the pin file is the registry, and not a list in here
 *
 * Option 2 is a claim about types, and a claim about types that only a comment
 * asserts is the "declared but unenforced" shape this repo keeps paying to fix.
 * Isomorphism also ROTS: add a `.default()` three levels down and an alias joins
 * the shape-diff set with no signal at all.
 *
 * So the exemption list is not kept here — it is kept as compile-time assertions
 * in the pin file, where tsc proves every entry true on the same run that
 * type-checks the package, and goes red the day one stops being true. This
 * script only reads which schemas are pinned. One artifact, two jobs: a
 * machine-readable exemption list that cannot be stated falsely.
 *
 * ## Why here and not in `packages/lint`
 *
 * `@objectstack/lint` validates an in-memory, schema-parsed **metadata graph** —
 * its module header states the contract: "no I/O, no runtime, no filesystem".
 * A rule about the shape of our own TypeScript source cannot live there without
 * breaking that contract, and it would be the only rule in the package that
 * reads a file. This is a source-shape guard, so it joins the source-shape guard
 * family (`check:error-code-casing`, `check:route-envelope`,
 * `check:engine-double-contract`, ...) which runs in lint.yml's `lint` job.
 *
 * Run `--self-test` to prove the matcher against known-good and known-bad
 * samples before trusting a green run.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SPEC_SRC = join(ROOT, 'packages/spec/src');
const PIN_FILE = join(SPEC_SRC, 'type-alias-convention.pin.test.ts');

/**
 * `export type Name = z.infer<typeof Schema>;` — the declaration this guard is
 * about. Whitespace and line breaks are tolerated because prettier wraps the
 * long ones.
 */
const INFER_ALIAS = /export type ([A-Za-z0-9_]+)\s*=\s*z\.infer<\s*typeof ([A-Za-z0-9_]+)\s*>\s*;/g;

/** A name is BARE when it claims neither state explicitly. */
function isBareName(name) {
  return !name.endsWith('Parsed') && !name.endsWith('Input');
}

function walkZodFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkZodFiles(p, out);
    else if (entry.endsWith('.zod.ts')) out.push(p);
  }
  return out;
}

/**
 * Reads the pin file's isomorphic registry: the `import type * as Mn from
 * './path.js'` lines give the module map, and each `z.input< typeof Mn.Schema >`
 * occurrence names one pinned schema.
 *
 * @returns {Set<string>} entries of the form `relative/path.ts::SchemaName`
 */
export function readIsomorphicPins(pinSource) {
  const modules = new Map();
  for (const m of pinSource.matchAll(
    /import type \* as ([A-Za-z0-9_]+) from '\.\/(.+?)\.js';/g,
  )) {
    modules.set(m[1], `${m[2]}.ts`);
  }
  const pins = new Set();
  for (const m of pinSource.matchAll(
    /z\.input<\s*typeof ([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*>/g,
  )) {
    const file = modules.get(m[1]);
    if (file) pins.add(`${file}::${m[2]}`);
  }
  return pins;
}

/**
 * The whole verdict, over a virtual corpus so `--self-test` can drive it.
 *
 * @param {Map<string,string>} files  relative path -> source text
 * @param {Set<string>} pins          `path::Schema` entries proved isomorphic
 */
export function findViolations(files, pins) {
  const violations = [];
  /** Schemas whose bare alias is exempt BECAUSE of a pin — the pins still earning their keep. */
  const reliedOnPins = new Set();

  for (const [file, source] of files) {
    const parsedAliases = new Set();
    INFER_ALIAS.lastIndex = 0;
    for (const m of source.matchAll(INFER_ALIAS)) {
      if (m[1].endsWith('Parsed')) parsedAliases.add(`${m[1]}::${m[2]}`);
    }
    INFER_ALIAS.lastIndex = 0;
    for (const m of source.matchAll(INFER_ALIAS)) {
      const [, name, schema] = m;
      if (!isBareName(name)) continue;
      const key = `${file}::${schema}`;
      if (parsedAliases.has(`${name}Parsed::${schema}`)) continue;
      if (pins.has(key)) {
        reliedOnPins.add(key);
        continue;
      }
      violations.push({
        kind: 'missing-parsed-alias',
        file,
        name,
        schema,
        message:
          `\`${name}\` names the PARSED state of \`${schema}\`, but ADR-0122 reserves the ` +
          `bare name for the AUTHOR state. Declare \`export type ${name}Parsed = ` +
          `z.infer<typeof ${schema}>;\` next to it so the phase-2 flip has a migration ` +
          `target — or, if \`z.input\` and \`z.infer\` of \`${schema}\` are the same type, ` +
          `pin it in packages/spec/src/type-alias-convention.pin.test.ts instead.`,
      });
    }
  }

  // A pin that no longer describes a bare uncovered alias is stale: it either
  // names a schema that gained an `XParsed` (so the pin is now dead weight) or a
  // schema/alias that no longer exists. Left alone, a stale pin silently
  // exempts a name that comes back later.
  for (const pin of pins) {
    if (!reliedOnPins.has(pin)) {
      const [file, schema] = pin.split('::');
      violations.push({
        kind: 'stale-pin',
        file,
        schema,
        message:
          `\`${schema}\` is pinned as isomorphic in the ADR-0122 pin file, but no bare ` +
          `\`z.infer\` alias in ${file} relies on that exemption any more. Delete the pin ` +
          `line; the assertion is no longer load-bearing.`,
      });
    }
  }

  return violations;
}

function loadCorpus() {
  const files = new Map();
  for (const abs of walkZodFiles(SPEC_SRC)) {
    files.set(relative(SPEC_SRC, abs), readFileSync(abs, 'utf8'));
  }
  return files;
}

function selfTest() {
  const failures = [];
  const check = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  const pinSample = `
import type * as M0 from './demo/enum.zod.js';
export type Iso0 = Assert<Eq< z.input< typeof M0.ColourSchema >, z.infer< typeof M0.ColourSchema > >>;
`;
  const pins = readIsomorphicPins(pinSample);
  check('pin parser reads one entry', pins.size, 1);
  check('pin parser keys by path::Schema', pins.has('demo/enum.zod.ts::ColourSchema'), true);

  // GOOD: bare alias paired with its XParsed.
  check(
    'paired alias passes',
    findViolations(
      new Map([
        [
          'demo/a.zod.ts',
          'export type Widget = z.infer<typeof WidgetSchema>;\n' +
            'export type WidgetParsed = z.infer<typeof WidgetSchema>;\n',
        ],
      ]),
      new Set(),
    ).length,
    0,
  );

  // GOOD: bare alias exempted by a pin.
  check(
    'pinned alias passes',
    findViolations(
      new Map([['demo/enum.zod.ts', 'export type Colour = z.infer<typeof ColourSchema>;\n']]),
      new Set(['demo/enum.zod.ts::ColourSchema']),
    ).length,
    0,
  );

  // BAD: bare alias with neither.
  const bare = findViolations(
    new Map([['demo/a.zod.ts', 'export type Widget = z.infer<typeof WidgetSchema>;\n']]),
    new Set(),
  );
  check('unpaired, unpinned alias is reported', bare.length, 1);
  check('...with the right kind', bare[0]?.kind, 'missing-parsed-alias');
  check('...naming the alias', bare[0]?.name, 'Widget');

  // BAD: the pin must be schema-accurate, not merely same-file.
  check(
    'a pin on a different schema does not exempt',
    findViolations(
      new Map([['demo/a.zod.ts', 'export type Widget = z.infer<typeof WidgetSchema>;\n']]),
      new Set(['demo/a.zod.ts::OtherSchema']),
    ).filter((v) => v.kind === 'missing-parsed-alias').length,
    1,
  );

  // BAD: an XParsed on a DIFFERENT schema does not cover this alias — the #4984
  // shape, where a companion that names the wrong thing reads as coverage.
  check(
    'an XParsed bound to another schema does not cover',
    findViolations(
      new Map([
        [
          'demo/a.zod.ts',
          'export type Widget = z.infer<typeof WidgetSchema>;\n' +
            'export type WidgetParsed = z.infer<typeof GadgetSchema>;\n',
        ],
      ]),
      new Set(),
    ).filter((v) => v.kind === 'missing-parsed-alias').length,
    1,
  );

  // Names that already declare their state are not this guard's business.
  check(
    'XInput and XParsed declarations are not themselves bare aliases',
    findViolations(
      new Map([
        [
          'demo/a.zod.ts',
          'export type WidgetInput = z.input<typeof WidgetSchema>;\n' +
            'export type WidgetParsed = z.infer<typeof WidgetSchema>;\n',
        ],
      ]),
      new Set(),
    ).length,
    0,
  );

  // Stale pin detection.
  const stale = findViolations(
    new Map([
      [
        'demo/a.zod.ts',
        'export type Widget = z.infer<typeof WidgetSchema>;\n' +
          'export type WidgetParsed = z.infer<typeof WidgetSchema>;\n',
      ],
    ]),
    new Set(['demo/a.zod.ts::WidgetSchema']),
  );
  check('a pin made redundant by an XParsed is reported', stale.length, 1);
  check('...as stale-pin', stale[0]?.kind, 'stale-pin');

  // A prettier-wrapped declaration must still match.
  check(
    'line-wrapped declaration is matched',
    findViolations(
      new Map([
        [
          'demo/a.zod.ts',
          'export type VeryLongWidgetName =\n  z.infer<\n    typeof VeryLongWidgetNameSchema\n  >;\n',
        ],
      ]),
      new Set(),
    ).length,
    1,
  );

  if (failures.length > 0) {
    console.error('check-spec-parsed-alias --self-test FAILED:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('check-spec-parsed-alias --self-test: 11 assertions passed');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const pins = readIsomorphicPins(readFileSync(PIN_FILE, 'utf8'));
  const files = loadCorpus();
  const violations = findViolations(files, pins);

  if (violations.length > 0) {
    console.error(
      `\nADR-0122: ${violations.length} type-alias convention violation(s) in packages/spec.\n`,
    );
    for (const v of violations) {
      console.error(`  ${v.file}${v.name ? ` — ${v.name}` : ''}`);
      console.error(`    ${v.message}\n`);
    }
    console.error('  Decision: docs/adr/0122-schema-type-alias-naming-convention.md\n');
    process.exit(1);
  }

  const bareCount = [...files.values()].reduce((n, src) => {
    let c = 0;
    for (const m of src.matchAll(INFER_ALIAS)) if (isBareName(m[1])) c++;
    return n + c;
  }, 0);
  console.log(
    `ADR-0122 type-alias convention: ${bareCount} bare z.infer aliases, ` +
      `${pins.size} pinned isomorphic, ${bareCount - pins.size} paired with an XParsed. OK`,
  );
}
