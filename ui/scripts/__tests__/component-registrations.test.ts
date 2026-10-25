import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS shared helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is itself an error (TS2578). See objectui#3494.
import {
  findComponentRegistrations,
  readComponentRegistrations,
} from '../component-registrations.mjs';

/**
 * `scripts/component-registrations.mjs` is the shared reader four pins use to
 * answer "which component keys does `packages/layout/src/index.ts` register?"
 * (objectui#4894). This is its pin.
 *
 * ## Why this file has to exist before the extraction is allowed
 *
 * The four call sites — `guide-layout-sidebar-nav-doc.test.ts`,
 * `app-shell-not-a-component-key.test.tsx`, `readme-registration-keys.test.ts`
 * and `side-effects-declaration-consistency.test.ts` — are deliberately
 * self-contained pins, and that independence is worth something: four guards
 * that fail separately are more robust than four sharing a dependency. The
 * extraction spends some of it, and this file is the exchange.
 *
 * The risk it buys down is specific and asymmetric. Every one of those four
 * assertions is a set difference or an absence check, and ALL of them pass
 * trivially on an empty key list. A shared reader that silently returned `[]`
 * would therefore not break four pins — it would make four pins green for a
 * reason unrelated to what they defend, which is strictly worse than the four
 * copies of one narrow regex that objectui#4894 started from. So the
 * non-vacuity cases below are the load-bearing half of this file, not a
 * completeness gesture.
 *
 * ## The corpus is shapes, not this tree
 *
 * A green run over today's `packages/layout/src/index.ts` proves only that
 * today's source has no double-quoted call in it. The fixtures below are the
 * contract; the one case that reads the real file asserts only that the reader
 * is still pointed at something real.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A register call written with the quote character `quote`. */
const call = (quote: string, key: string) =>
  `ComponentRegistry.register(${quote}${key}${quote}, Thing, { namespace: 'layout' });`;

describe('the reader accepts every quote character the language does (objectui#4894)', () => {
  // The defect this module exists for. The four copies it replaced matched a
  // single-quoted key and nothing else, while this repo enforces no quote style
  // at all — no `.prettierrc`, no `prettier` field in package.json, no `quotes`
  // rule in eslint.config.js. A double-quoted registration was therefore legal,
  // lint-clean, CI-green and invisible to all four pins at once.
  it.each([
    ["single quotes", "'"],
    ["double quotes", '"'],
    ["backticks", '`'],
  ])('reads a key written with %s', (_label, quote) => {
    expect(findComponentRegistrations(call(quote, 'page-header')).keys).toEqual(['page-header']);
  });

  it('reads a file that mixes them, in source order', () => {
    const source = [call("'", 'page-header'), call('"', 'page:card'), call('`', 'responsive-grid')].join(
      '\n',
    );
    expect(findComponentRegistrations(source).keys).toEqual([
      'page-header',
      'page:card',
      'responsive-grid',
    ]);
  });

  it('and reads a call the formatter has wrapped or spaced out', () => {
    const source = 'ComponentRegistry\n  .register(\n    "app-schema-renderer",\n    Thing,\n  );';
    expect(findComponentRegistrations(source).keys).toEqual(['app-schema-renderer']);
  });
});

describe('an empty read is a FAILURE, never an answer (objectui#4894)', () => {
  // The whole reason the extraction needs its own pin: every call site asserts a
  // set difference or an absence, so `[]` is the one return value that makes all
  // four of them pass while defending nothing.
  it('throws when the source registers nothing', () => {
    expect(() => readComponentRegistrations('export const nothing = 1;\n', 'fixture.ts')).toThrow(
      /No `ComponentRegistry\.register` call was found in fixture\.ts/,
    );
  });

  it('throws when the only call is commented out — a ghost is not a registration', () => {
    const source = `// ${call("'", 'app-shell')}\n`;
    expect(() => readComponentRegistrations(source, 'fixture.ts')).toThrow(
      /No `ComponentRegistry\.register` call was found/,
    );
  });

  it('and says what to do about it, rather than only that it happened', () => {
    let message = '';
    try {
      readComponentRegistrations('', 'packages/layout/src/index.ts');
    } catch (error) {
      message = (error as Error).message;
    }
    // The message is read here because a reader that fails at the wrong volume
    // gets "fixed" by re-pointing it at something that answers.
    expect(message).toContain('packages/layout/src/index.ts');
    expect(message).toContain('pass trivially on an empty list');
    expect(message).toContain('scripts/component-registrations.mjs');
  });
});

describe('a key the reader cannot READ is a refusal, not an omission (objectui#4894)', () => {
  // Widening one quote character to three does not close the class the card is
  // about; it closes one member of it. Any call whose key this reader cannot see
  // drops out of all four pins in silence — the doc-parity pins then red saying
  // the DOC names an unregistered key (pointing the reader at a correct page),
  // and the side-effect pin goes green without asserting that key at all.
  it.each([
    ['a computed key', 'ComponentRegistry.register(KEY, Thing);'],
    ['an interpolated template', 'ComponentRegistry.register(`page:${kind}`, Thing);'],
    ['an unterminated literal', "ComponentRegistry.register('page-header, Thing);"],
  ])('refuses to answer around %s', (_label, source) => {
    const scan = findComponentRegistrations(source);
    expect(scan.calls).toBe(1);
    expect(scan.keys).toEqual([]);
    expect(scan.unreadable).toHaveLength(1);
    expect(() => readComponentRegistrations(source, 'fixture.ts')).toThrow(
      /cannot read/,
    );
  });

  it('names the line, so the refusal is actionable', () => {
    const source = [call("'", 'page-header'), 'ComponentRegistry.register(KEY, Thing);'].join('\n');
    let message = '';
    try {
      readComponentRegistrations(source, 'packages/layout/src/index.ts');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('line 2');
    expect(message).toContain('ComponentRegistry.register(KEY, Thing);');
  });
});

describe('prose is not code (objectui#4894)', () => {
  // `packages/layout/src/index.ts` carries a note saying its retired `app-shell`
  // call is DESCRIBED rather than quoted, because a verbatim copy inside a
  // comment read to the old regexes as a live registration. A reader that widens
  // its quote set while keeping that blind spot trades one silent miss for one
  // silent fabrication — and a fabricated key reds every doc-parity pin with a
  // demand to document a component that does not exist.
  it.each([
    ['a line comment', `// ${call("'", 'line-ghost')}`],
    ['a block comment', `/* ${call('"', 'block-ghost')} */`],
    ['a docblock', `/**\n * ${call("'", 'doc-ghost')}\n */`],
    ['a string literal', `const note = "see ${call("'", 'string-ghost')}";`],
    ['a template literal', 'const note = `see ' + call('"', 'tpl-ghost') + '`;'],
  ])('does not collect a registration mentioned in %s', (_label, ghost) => {
    const source = [ghost, call("'", 'real-key')].join('\n');
    const scan = findComponentRegistrations(source);
    expect(scan.keys).toEqual(['real-key']);
    expect(scan.calls).toBe(1);
  });
});

describe('the reader is still pointed at the real barrel (objectui#4894)', () => {
  // One case that touches this tree. It deliberately asserts no key NAMES — the
  // four call sites own those, and a fifth opinion here would be the coupling
  // the extraction was allowed on the condition of avoiding.
  it('reads packages/layout/src/index.ts and finds every call it contains', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'packages', 'layout', 'src', 'index.ts'),
      'utf8',
    );
    const scan = readComponentRegistrations(source, 'packages/layout/src/index.ts');
    expect(scan.keys.length).toBeGreaterThan(1);
    // Exact, and derived: every call the reader saw yielded a key it could read.
    expect(scan.keys).toHaveLength(scan.calls);
    expect(scan.unreadable).toEqual([]);
  });
});
