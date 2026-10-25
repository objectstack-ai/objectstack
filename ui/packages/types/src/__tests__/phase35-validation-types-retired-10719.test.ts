/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10719 — the eight "Phase 3.5" field-validation types are RETIRED from
 * `@object-ui/types`.
 *
 * `AdvancedValidationSchema`, `AdvancedValidationRule`, `ValidationRuleType`,
 * `ValidationFunction`, `AsyncValidationFunction`, `ValidationContext`,
 * `AdvancedValidationResult` and `AdvancedValidationError` were the type half of
 * `@object-ui/core`'s `ValidationEngine` vocabulary. Maintainer ruling A on
 * objectui#7659 (decision batch #40, item 4, ADR-0049 enforce-or-remove) retired
 * the engine because nothing consumed it; triage carried that ruling to its type
 * half on objectui#10719. The zero-reader measurement is recorded on the card and
 * is not re-derived here.
 *
 * ⛔ Not this retirement: `FieldValidationRules` (the type of the live field
 * `validation` key), `FieldValidationFunction` and `ObjectValidationRule`. Two of
 * them are firing controls below, so this file also fails if the retirement ever
 * takes one of them along. (`DesignerValidationRule` was not this retirement
 * either; objectui#11434 retired it later, with `DesignerFieldDefinition
 * .validationRules`, and pins that itself.)
 *
 * What this pins, both halves of the objectui#7659 shape:
 *
 *   - compile time: none of the eight resolves through the root barrel (the face
 *     an external consumer imports) or through the declaring module. Compiled by
 *     this package's `tsconfig.test.json`, chained off `type-check`; a name that
 *     comes back fails there with "Unused '@ts-expect-error' directive". The
 *     controls resolve live neighbours through the identical `import('…')`
 *     spellings with no directive, so a broken specifier cannot satisfy the
 *     directives for the wrong reason.
 *   - runtime: the barrel and the declaring module are read as TEXT, so a
 *     re-introduced declaration or re-export reddens even in a run that never
 *     type-checks.
 *
 * ⚠️ Why the runtime half is a source read and not objectui#7659's
 * `Object.keys(entry)` probe: all eight were `export type`, so none of them was
 * ever an own key of the runtime namespace. Measured at this change on the tree
 * before the retirement: the built entry's namespace carried none of the eight
 * while its `.d.ts` still exported all of them. That probe reads the same in both
 * worlds, so it cannot fail, and writing it would make this file look better
 * covered than it is. objectui#8800's retirement pin in this directory records
 * the same reason.
 *
 * Deleting this file is deleting the ruling. Bringing any of the eight back is a
 * new published-contract decision, not an edit here.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments as strip } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped -- the call site stays checked. */
const stripComments: (source: string) => string = strip;

/* ── Compile time: the eight are gone from the barrel and from the module ── */

// @ts-expect-error retired (objectui#10719): no longer exported from the `@object-ui/types` root barrel.
type _SchemaViaBarrel = import('../index.js').AdvancedValidationSchema;
// @ts-expect-error retired (objectui#10719), as above.
type _RuleViaBarrel = import('../index.js').AdvancedValidationRule;
// @ts-expect-error retired (objectui#10719), as above.
type _RuleTypeViaBarrel = import('../index.js').ValidationRuleType;
// @ts-expect-error retired (objectui#10719), as above.
type _FunctionViaBarrel = import('../index.js').ValidationFunction;
// @ts-expect-error retired (objectui#10719), as above.
type _AsyncFunctionViaBarrel = import('../index.js').AsyncValidationFunction;
// @ts-expect-error retired (objectui#10719), as above.
type _ContextViaBarrel = import('../index.js').ValidationContext;
// @ts-expect-error retired (objectui#10719), as above.
type _ResultViaBarrel = import('../index.js').AdvancedValidationResult;
// @ts-expect-error retired (objectui#10719), as above.
type _ErrorViaBarrel = import('../index.js').AdvancedValidationError;

// @ts-expect-error retired (objectui#10719): `../data-protocol` no longer declares it.
type _SchemaViaModule = import('../data-protocol.js').AdvancedValidationSchema;
// @ts-expect-error retired (objectui#10719), as above.
type _RuleViaModule = import('../data-protocol.js').AdvancedValidationRule;
// @ts-expect-error retired (objectui#10719), as above.
type _RuleTypeViaModule = import('../data-protocol.js').ValidationRuleType;
// @ts-expect-error retired (objectui#10719), as above.
type _FunctionViaModule = import('../data-protocol.js').ValidationFunction;
// @ts-expect-error retired (objectui#10719), as above.
type _AsyncFunctionViaModule = import('../data-protocol.js').AsyncValidationFunction;
// @ts-expect-error retired (objectui#10719), as above.
type _ContextViaModule = import('../data-protocol.js').ValidationContext;
// @ts-expect-error retired (objectui#10719), as above.
type _ResultViaModule = import('../data-protocol.js').AdvancedValidationResult;
// @ts-expect-error retired (objectui#10719), as above.
type _ErrorViaModule = import('../data-protocol.js').AdvancedValidationError;

// Controls, no directive: the same two query shapes resolve live neighbours, so
// the sixteen errors above are readings of the two modules and not of a bad path.
type _ObjectRuleViaBarrel = import('../index.js').ObjectValidationRule;
type _ObjectRuleViaModule = import('../data-protocol.js').ObjectValidationRule;
type _FieldRulesViaBarrel = import('../index.js').FieldValidationRules;

/* ── Runtime: the same two files, read as text ── */

/** Rooted at THIS file, never at `process.cwd()`: the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, '..', file), 'utf8');

/** The eight names the retirement removed, and nothing else. */
const RETIRED = [
  'AdvancedValidationSchema',
  'AdvancedValidationRule',
  'ValidationRuleType',
  'ValidationFunction',
  'AsyncValidationFunction',
  'ValidationContext',
  'AdvancedValidationResult',
  'AdvancedValidationError',
] as const;

/** A top-level declaration of exactly `name`. */
const declares = (source: string, name: string): boolean =>
  new RegExp(`^export (?:interface|type) ${name}\\b`, 'm').test(source);

/**
 * Every name `source` publishes through an `export { … }` / `export type { … }`
 * list, whether the list spans many lines or one. Comments go FIRST, through
 * `scripts/js-comment-mask.mjs`: the barrel annotates its lists with `//` lines
 * that carry commas and braces, and splitting before stripping would fuse a real
 * name into comment text and hide it. The shared reader rather than a private
 * regex pair, because a regex cannot see a string literal and would open a
 * phantom comment at a glob or URL inside one, reading clean over the names
 * after it. `stripComments`, not `maskComments`: this reports a set of names,
 * never a line or an offset. Specifiers are then split rather than matched
 * inside the braces, so `ObjectValidationRule` cannot match `ValidationRule…`,
 * and `X as Y` counts as publishing `Y`.
 */
const reexported = (source: string): Set<string> => {
  const code = stripComments(source);
  const names = new Set<string>();
  for (const m of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const specifier of m[1].split(',')) {
      const published = specifier.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (published) names.add(published);
    }
  }
  return names;
};

describe('@object-ui/types — the Phase 3.5 validation types stay retired (objectui#10719)', () => {
  it('the declaring module declares none of the eight, and keeps its retirement note', () => {
    const source = read('data-protocol.ts');

    // Firing controls on the same matcher: a truncated read or a matcher that
    // can never match would otherwise pass the absence assertion below.
    expect(declares(source, 'ObjectValidationRule'), 'the object-level rule union is missing').toBe(true);
    expect(declares(source, 'FilterFieldConfig'), 'the neighbouring filter type is missing').toBe(true);

    expect(
      RETIRED.filter((name) => declares(source, name)),
      [
        'data-protocol.ts declares a retired Phase 3.5 validation type again.',
        'objectui#10719 removed them with ValidationEngine (maintainer ruling A on objectui#7659):',
        'nothing read them. Client-side field validation is FieldValidationRules (form.ts).',
      ].join('\n'),
    ).toEqual([]);

    // The note is where the retirement and its replacement are recorded in the
    // file itself. It is a `//` comment, so declaration emit leaves it out of the
    // published `.d.ts`.
    expect(source).toContain('// RETIRED (objectui#10719)');
  });

  it('the root barrel re-exports none of the eight, while its neighbours still ship', () => {
    const published = reexported(read('index.ts'));

    expect(published.has('ObjectValidationRule'), 'the barrel read found no ObjectValidationRule').toBe(true);
    expect(published.has('FieldValidationRules'), 'the barrel read found no FieldValidationRules').toBe(true);

    expect(
      RETIRED.filter((name) => published.has(name)),
      '@object-ui/types re-exports a retired Phase 3.5 validation type again (objectui#10719).',
    ).toEqual([]);
  });
});
