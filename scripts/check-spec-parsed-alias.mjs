#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0122 convention guard — the bare name is the AUTHOR state, `XParsed` is
 * the parsed state, and neither gets a synonym.
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
 * the parsed state**. Flipping 1384 aliases is a major-window change, so it
 * landed in two phases:
 *
 * - **Phase 1** (#5551 / PR #6072, a minor) declared `XParsed` wherever the
 *   parsed state is a distinct type, giving every consumer a name that survives
 *   the flip. This script's first shape guarded that coverage.
 * - **Phase 2** (#6083, protocol 17) flipped all 1384 bare aliases to `z.input`
 *   and retired the 102 `XInput` aliases that the flip turned into literal
 *   synonyms of a bare name.
 *
 * ## Why this guard was INVERTED rather than extended at phase 2
 *
 * Phase 1's guard was written over the population "bare aliases that read
 * `z.infer`". The flip empties that population, and a guard over an empty set is
 * not a weaker guard — it is no guard at all. Worse, its two arms fail in
 * opposite directions once the flip lands: the coverage arm goes silently green
 * (0 findings over 0 aliases) while the stale-pin arm, which asks "does any bare
 * `z.infer` alias still rely on this pin?", answers "no" for **all 719** pins and
 * reports every one of them as stale. Both readings are wrong, and the second is
 * the loud one: measured on the phase-2 tree, the phase-1 script reports 0
 * missing-parsed-alias and 719 stale-pin.
 *
 * So the population is re-pointed at the post-flip convention, and the flip
 * itself becomes the thing that is checked. What the guard now says, for every
 * `export type` in `packages/spec/src/**\/*.zod.ts`:
 *
 *   1. **A bare name may not read `z.infer`.** The bare name is the author state;
 *      an alias that reads `z.infer` is either an un-flipped survivor or a new
 *      declaration written in the retired dialect. This is the arm that replaces
 *      phase 1's, and it is the one that goes red if a phase-2 flip is reverted.
 *   2. **A bare alias's schema must have its parsed state named, or be pinned.**
 *      Unchanged from phase 1 in substance, re-pointed at the flipped form: a
 *      bare `X = z.input<typeof XSchema>` needs a sibling
 *      `XParsed = z.infer<typeof XSchema>` unless `XSchema` is pinned isomorphic
 *      in `packages/spec/src/type-alias-convention.pin.test.ts`.
 *   3. **A pin nobody relies on is stale** — same arm as phase 1, now keyed on
 *      the bare `z.input` aliases.
 *   4. **`XInput` may not be a synonym of a bare name.** After the flip
 *      `export type XInput = z.input<typeof XSchema>` denotes exactly what `X`
 *      denotes, and ADR-0122 D3 forbids a permanent synonym: it is a name an
 *      author can only pick wrongly. This arm is what stops the 102 retired
 *      `XInput` aliases from flowing back one file at a time. An `Input` name
 *      that is NOT such a synonym is untouched — `ExpressionInput` (the bare
 *      alias of `ExpressionInputSchema`), and the five composed types
 *      (`FormFieldInput`, `QueryInput`, `FieldInput`,
 *      `ObjectStackDefinitionInput`, `NavigationItemInput`) that build something
 *      no bare alias denotes.
 *
 * ## Why the pin file is the registry, and not a list in here
 *
 * Rule 2's exemption is a claim about types, and a claim about types that only a
 * comment asserts is the "declared but unenforced" shape this repo keeps paying
 * to fix. Isomorphism also ROTS: add a `.default()` three levels down and an
 * alias joins the shape-diff set with no signal at all.
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
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SPEC_SRC = join(ROOT, 'packages/spec/src');
const PIN_FILE = join(SPEC_SRC, 'type-alias-convention.pin.test.ts');

/**
 * `export type Name = z.input<typeof Schema>;` / `= z.infer<typeof Schema>;` —
 * the two declarations this guard is about, matched in one pass so the arms can
 * disagree about which side a name belongs on. Whitespace and line breaks are
 * tolerated because prettier wraps the long ones. The trailing `;` is what keeps
 * a composed type (`z.input<typeof S> & { ... }`) out of the corpus: those are
 * not aliases of a schema's state, they are new types, and no arm here has
 * anything to say about them.
 */
const STATE_ALIAS =
  /export type ([A-Za-z0-9_]+)\s*=\s*z\.(input|infer)<\s*typeof ([A-Za-z0-9_]+)\s*>\s*;/g;

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
    const decls = [...source.matchAll(STATE_ALIAS)].map((m) => ({
      name: m[1],
      state: m[2],
      schema: m[3],
    }));

    /** `XParsed = z.infer<typeof XSchema>` siblings, keyed `XParsed::XSchema`. */
    const parsedAliases = new Set(
      decls
        .filter((d) => d.name.endsWith('Parsed') && d.state === 'infer')
        .map((d) => `${d.name}::${d.schema}`),
    );
    /** Which schemas already have a bare alias in this file — rule 4's input. */
    const bareBySchema = new Map(
      decls.filter((d) => isBareName(d.name)).map((d) => [d.schema, d.name]),
    );

    for (const { name, state, schema } of decls) {
      // Rule 4 — an `XInput` that denotes exactly what a bare name denotes.
      if (!isBareName(name)) {
        if (name.endsWith('Input') && state === 'input' && bareBySchema.has(schema)) {
          violations.push({
            kind: 'input-synonym',
            file,
            name,
            schema,
            message:
              `\`${name}\` is a literal synonym of \`${bareBySchema.get(schema)}\` — since ` +
              `ADR-0122 phase 2 the bare name IS \`z.input<typeof ${schema}>\`. D3 forbids a ` +
              `permanent synonym: it is a name an author can only pick wrongly. Delete it and ` +
              `use \`${bareBySchema.get(schema)}\`.`,
          });
        }
        continue;
      }

      // Rule 1 — the flip itself. A bare name may not denote the parsed state.
      if (state === 'infer') {
        violations.push({
          kind: 'bare-name-is-parsed-state',
          file,
          name,
          schema,
          message:
            `\`${name}\` names the PARSED state of \`${schema}\`, but ADR-0122 reserves the ` +
            `bare name for the AUTHOR state. Write \`export type ${name} = z.input<typeof ` +
            `${schema}>;\` and, if the two shapes differ, put the parsed state on ` +
            `\`export type ${name}Parsed = z.infer<typeof ${schema}>;\` beside it.`,
        });
        continue;
      }

      // Rule 2 — the parsed state is named, or the schema is pinned isomorphic.
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
          `\`${name}\` is the AUTHOR state of \`${schema}\` and nothing names its PARSED ` +
          `state. Declare \`export type ${name}Parsed = z.infer<typeof ${schema}>;\` next to ` +
          `it so a consumer holding a parse result has a name — or, if \`z.input\` and ` +
          `\`z.infer\` of \`${schema}\` are the same type, pin it in ` +
          `packages/spec/src/type-alias-convention.pin.test.ts instead.`,
      });
    }
  }

  // Rule 3 — a pin that no longer describes a bare uncovered alias is stale: it
  // either names a schema that gained an `XParsed` (so the pin is now dead
  // weight) or a schema/alias that no longer exists. Left alone, a stale pin
  // silently exempts a name that comes back later.
  for (const pin of pins) {
    if (!reliedOnPins.has(pin)) {
      const [file, schema] = pin.split('::');
      violations.push({
        kind: 'stale-pin',
        file,
        schema,
        message:
          `\`${schema}\` is pinned as isomorphic in the ADR-0122 pin file, but no bare alias ` +
          `in ${file} relies on that exemption any more. Delete the pin line; the assertion is ` +
          `no longer load-bearing.`,
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
  const kinds = (vs, kind) => vs.filter((v) => v.kind === kind).length;

  const pinSample = `
import type * as M0 from './demo/enum.zod.js';
export type Iso0 = Assert<Eq< z.input< typeof M0.ColourSchema >, z.infer< typeof M0.ColourSchema > >>;
`;
  const pins = readIsomorphicPins(pinSample);
  check('pin parser reads one entry', pins.size, 1);
  check('pin parser keys by path::Schema', pins.has('demo/enum.zod.ts::ColourSchema'), true);

  // GOOD: the post-flip shape — bare name is the author state, paired with XParsed.
  check(
    'flipped alias paired with its XParsed passes',
    findViolations(
      new Map([
        [
          'demo/a.zod.ts',
          'export type Widget = z.input<typeof WidgetSchema>;\n' +
            'export type WidgetParsed = z.infer<typeof WidgetSchema>;\n',
        ],
      ]),
      new Set(),
    ).length,
    0,
  );

  // GOOD: bare alias exempted by a pin.
  check(
    'pinned flipped alias passes',
    findViolations(
      new Map([['demo/enum.zod.ts', 'export type Colour = z.input<typeof ColourSchema>;\n']]),
      new Set(['demo/enum.zod.ts::ColourSchema']),
    ).length,
    0,
  );

  // BAD (rule 1) — THE reversal arm. An un-flipped alias, or a phase-2 flip
  // reverted, reads `z.infer` on a bare name and must be named.
  const unflipped = findViolations(
    new Map([
      [
        'demo/a.zod.ts',
        'export type Widget = z.infer<typeof WidgetSchema>;\n' +
          'export type WidgetParsed = z.infer<typeof WidgetSchema>;\n',
      ],
    ]),
    new Set(),
  );
  check('a bare z.infer alias is reported even when paired', kinds(unflipped, 'bare-name-is-parsed-state'), 1);
  check('...naming the alias', unflipped[0]?.name, 'Widget');
  check(
    'a bare z.infer alias is reported even when pinned',
    kinds(
      findViolations(
        new Map([['demo/enum.zod.ts', 'export type Colour = z.infer<typeof ColourSchema>;\n']]),
        new Set(['demo/enum.zod.ts::ColourSchema']),
      ),
      'bare-name-is-parsed-state',
    ),
    1,
  );

  // BAD (rule 2) — flipped, but the parsed state has no name and no pin.
  const uncovered = findViolations(
    new Map([['demo/a.zod.ts', 'export type Widget = z.input<typeof WidgetSchema>;\n']]),
    new Set(),
  );
  check('unpaired, unpinned alias is reported', kinds(uncovered, 'missing-parsed-alias'), 1);
  check('...naming the alias', uncovered[0]?.name, 'Widget');

  // BAD: the pin must be schema-accurate, not merely same-file.
  check(
    'a pin on a different schema does not exempt',
    kinds(
      findViolations(
        new Map([['demo/a.zod.ts', 'export type Widget = z.input<typeof WidgetSchema>;\n']]),
        new Set(['demo/a.zod.ts::OtherSchema']),
      ),
      'missing-parsed-alias',
    ),
    1,
  );

  // BAD: an XParsed on a DIFFERENT schema does not cover this alias — the #4984
  // shape, where a companion that names the wrong thing reads as coverage.
  check(
    'an XParsed bound to another schema does not cover',
    kinds(
      findViolations(
        new Map([
          [
            'demo/a.zod.ts',
            'export type Widget = z.input<typeof WidgetSchema>;\n' +
              'export type WidgetParsed = z.infer<typeof GadgetSchema>;\n',
          ],
        ]),
        new Set(),
      ),
      'missing-parsed-alias',
    ),
    1,
  );

  // BAD (rule 4) — the retired `XInput`, flowing back.
  const synonym = findViolations(
    new Map([
      [
        'demo/a.zod.ts',
        'export type Widget = z.input<typeof WidgetSchema>;\n' +
          'export type WidgetParsed = z.infer<typeof WidgetSchema>;\n' +
          'export type WidgetInput = z.input<typeof WidgetSchema>;\n',
      ],
    ]),
    new Set(),
  );
  check('an XInput synonym of a bare name is reported', kinds(synonym, 'input-synonym'), 1);
  check('...naming the synonym', synonym.find((v) => v.kind === 'input-synonym')?.name, 'WidgetInput');

  // GOOD: an `Input` name that is the bare alias of an `...InputSchema` is not a
  // synonym of anything — `shared/expression.zod.ts` is the live case.
  check(
    'the bare alias of an InputSchema is not a synonym',
    findViolations(
      new Map([
        [
          'demo/expr.zod.ts',
          'export type ExpressionInput = z.input<typeof ExpressionInputSchema>;\n',
        ],
      ]),
      new Set(),
    ).length,
    0,
  );

  // GOOD: a composed type built ON z.input is not a state alias at all — no
  // trailing `;` after the `>`, so it never enters the corpus.
  check(
    'a composed Input type is not matched',
    findViolations(
      new Map([
        [
          'demo/form.zod.ts',
          'export type FormField = z.input<typeof FormFieldBaseSchema>;\n' +
            'export type FormFieldParsed = z.infer<typeof FormFieldBaseSchema>;\n' +
            'export type FormFieldInput = z.input<typeof FormFieldBaseSchema> & {\n' +
            '  fields?: FormFieldInput[];\n' +
            '};\n',
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
        'export type Widget = z.input<typeof WidgetSchema>;\n' +
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
          'export type VeryLongWidgetName =\n  z.input<\n    typeof VeryLongWidgetNameSchema\n  >;\n',
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
  console.log('check-spec-parsed-alias --self-test: 18 assertions passed');
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
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
    for (const m of src.matchAll(STATE_ALIAS)) if (isBareName(m[1])) c++;
    return n + c;
  }, 0);
  console.log(
    `ADR-0122 type-alias convention: ${bareCount} bare z.input aliases, ` +
      `${pins.size} pinned isomorphic, ${bareCount - pins.size} paired with an XParsed. OK`,
  );
}
