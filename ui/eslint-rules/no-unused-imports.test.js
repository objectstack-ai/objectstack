/**
 * Pins `no-unused-imports` on the property that makes the #4806 R2 split
 * meaningful: it fires on the IMPORT subclass and on nothing else.
 *
 * The `valid` half is the load-bearing half here. This rule runs the whole of
 * `@typescript-eslint/no-unused-vars` and throws most of its output away, so
 * the way it breaks is not "misses an import" — the upstream rule finds those
 * — but "stops throwing away the rest", which would promote 102 unused
 * locals/parameters/caught-errors to errors across the repo in one commit.
 * Every non-import construct the base rule reports is therefore pinned as
 * valid, including the two the repo's own ignore patterns are configured for.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-unused-imports.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2020, sourceType: 'module' },
});

ruleTester.run('no-unused-imports', rule, {
  valid: [
    // Used imports, in each of the three binding forms.
    `import { a } from 'm'; export const x = a;`,
    `import d from 'm'; export const x = d;`,
    `import * as ns from 'm'; export const x = ns.a;`,
    // Type-only usage counts as usage — the reason this delegates upstream
    // rather than re-deriving "unused" from references.
    `import type { T } from 'm'; export const x: T = null as never;`,
    `import { T } from 'm'; export type U = T;`,
    // A re-export is a use.
    `import { a } from 'm'; export { a };`,
    // Side-effect imports bind nothing, so there is nothing to report.
    `import 'm';`,
    // NOT this rule's population — the warning half of the split keeps every
    // one of these. A regression here is the expensive direction.
    `export function f() { const unusedLocal = 1; }`,
    `export function f(unusedParam) { return 1; }`,
    `export function f() { try { g(); } catch (unusedErr) { return 1; } }`,
    `export function f() { const [, unusedElement] = [1, 2]; }`,
    `export function f(o) { const { a, ...rest } = o; return rest; }`,
    `export class C {} export function f() { class Unused {} }`,
    // The `_` convention this repo writes, honoured through the same options
    // the warning half is configured with.
    {
      code: `import { _KeepMe } from 'm';`,
      options: [{ varsIgnorePattern: '^_' }],
    },
  ],
  // `suggestions: 1` asserts the COUNT, not the text: the suggestion is
  // upstream's ("Remove unused variable"), and pinning its wording here would
  // make a typescript-eslint patch release fail this repo's build over a
  // string this rule does not own.
  invalid: [
    {
      code: `import { a } from 'm';`,
      errors: [{ messageId: 'unusedVar', data: { varName: 'a', action: 'defined', additional: '' }, suggestions: 1 }],
    },
    {
      code: `import d from 'm';`,
      errors: [{ messageId: 'unusedVar', data: { varName: 'd', action: 'defined', additional: '' }, suggestions: 1 }],
    },
    {
      code: `import * as ns from 'm';`,
      errors: [{ messageId: 'unusedVar', data: { varName: 'ns', action: 'defined', additional: '' }, suggestions: 1 }],
    },
    {
      code: `import type { T } from 'm';`,
      errors: [{ messageId: 'unusedVar', data: { varName: 'T', action: 'defined', additional: '' }, suggestions: 1 }],
    },
    // `import { a as b }` binds `b`; the report must name the LOCAL name, not
    // the exported one. This is what `parent.local === node` buys.
    {
      code: `import { a as b } from 'm';`,
      errors: [{ messageId: 'unusedVar', data: { varName: 'b', action: 'defined', additional: '' }, suggestions: 1 }],
    },
    // One declaration, one unused specifier: the used sibling must not be
    // reported, and the unused one must be.
    {
      code: `import { a, b } from 'm'; export const x = a;`,
      errors: [{ messageId: 'unusedVar', data: { varName: 'b', action: 'defined', additional: '' }, suggestions: 1 }],
    },
    // Mixed file: the unused import errors, the unused local next to it does
    // not — the split, in one fixture.
    {
      code: `import { a } from 'm'; export function f() { const unusedLocal = 1; }`,
      errors: [{ messageId: 'unusedVar', data: { varName: 'a', action: 'defined', additional: '' }, suggestions: 1 }],
    },
  ],
});
