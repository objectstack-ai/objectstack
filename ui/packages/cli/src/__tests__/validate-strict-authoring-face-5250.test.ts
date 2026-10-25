/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5250, slice A — `objectui validate` and `objectui check` judge an
 * authored document through the STRICT authoring face.
 *
 * The ruling (maintainer 2026-09-04, decision batch #25, option 2): "each node
 * schema gets a derived strict variant; `objectui validate` and the
 * doc-snippet gates run **strict**; renderer props keep the tolerant face
 * unchanged". The derived variant is `StrictAnyComponentSchema`
 * (objectui#8345); both commands now reach it through one door,
 * `validateAuthoredDocument` (`../utils/authoring-face.ts`).
 *
 * What the pins below hold:
 *
 *  1. The card's own probe — an `input` node carrying a `validation` object
 *     `InputSchema` does not declare — was `✓ Schema is valid!`. It is refused
 *     now, and the refusal NAMES the key, its path and what to do. Each refusal
 *     pin asserts the tolerant face still accepts the same document, so a red
 *     here can only mean the strict door moved, never that the fixture broke.
 *  2. A nested child's undeclared key is refused too, and named at the
 *     child's path. Where a union has more than one arm the document fits (a
 *     dashboard widget), the refusal sits inside the arms of an `Invalid input`
 *     that names no key, and it is still named. The per-depth half of the
 *     programme (director pointer on objectui#5250) is what makes a nested
 *     child judged at all.
 *  3. A key one viable union arm declares is NOT named, even when another
 *     viable arm refuses it — the `metric-card` widget case.
 *  4. Declared-only documents stay green: the positive control for every
 *     refusal above, so a door that refused everything fails here.
 *  5. `objectui check` reads the same door: a leaf carrying an undeclared key
 *     leaves the "validated" count, is listed by name, and its undeclared key
 *     is named under it. Still advisory — the exit code does not move.
 *  6. The strict refusal does not switch off objectui#4795's: a listed file
 *     whose `${…}` sits on a text key its node never evaluates is refused for
 *     that too, and the run fails.
 *
 * Harness (fixtures under `os.tmpdir()`, `process.exit` recorded rather than
 * taken) follows `validate-root-path-line.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeValidateSchema } from '@object-ui/types/zod';

import { check, closingLine, describeFirstIssue } from '../commands/check.js';
import { validate } from '../commands/validate.js';
import { describeUndeclaredKey, validateAuthoredDocument } from '../utils/authoring-face.js';
import { findUnbindableTextExpressions } from '../utils/unbindable-text-expressions.js';
import { findUndeclaredKeys, type UnionIssueLike } from '../utils/union-arm-diagnostics.js';

/** See `validate-root-path-line.test.ts` — the escape byte is never spelled. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** The card's probe, verbatim from the objectui#5250 body. */
const CARD_PROBE = {
  type: 'input',
  name: 'email',
  validation: { pattern: 12345, message: false, nonsense: [1, 2] },
};
const CARD_PROBE_DECLARED_ONLY = { type: 'input', name: 'email' };

/** The same undeclared key one level down, under a child slot. */
const NESTED_PROBE = { type: 'div', children: [{ type: 'input', name: 'email', nonsense: 1 }] };
const NESTED_DECLARED_ONLY = { type: 'div', children: [{ type: 'input', name: 'email' }] };

/** Two child slots deep: a `text` node inside a `card` inside a `div`. */
const DEPTH_TWO = {
  type: 'div',
  children: [{ type: 'card', title: 'T', children: [{ type: 'text', content: 'x', colour: 'red' }] }],
};

/**
 * A widget viable on TWO arms of the widget union: the `metric-card` arm,
 * which declares `value` as a registered input (objectui#11022), and the
 * generic widget arm, which does not. Only the typo is undeclared on both.
 */
const WIDGET_TYPO = {
  type: 'dashboard',
  widgets: [{ type: 'metric-card', title: 'Total', value: '1', trendValu: '+2%' }],
};

/**
 * A chart widget whose `options` carries a key its arm does not declare. The
 * `metric-card` arm ALSO reports an undeclared key here (`options` itself) —
 * but that arm failed on its `type`, so it is not the arm the widget is for.
 */
const WIDGET_OPTIONS = {
  type: 'dashboard',
  widgets: [{ type: 'bar', title: 'Sales', options: { xField: 'month' } }],
};

/** A `${…}` expression, as objectui#4795's pins spell it. */
const EXPRESSION = '${data.total}';

/** The #3090 mixed-vocabulary entry: a runtime `name` plus the spec `field`. */
const MIXED_FORM = { type: 'form', fields: [{ name: 'subject', field: 'subject_line', type: 'text' }] };

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

function plainLines(): string[] {
  return out.join('\n').replace(ANSI, '').split('\n');
}

/** The undeclared-key lines, in print order, with their indentation removed. */
function undeclaredLines(): string[] {
  return plainLines()
    .filter((l) => l.trimStart().startsWith('Undeclared key "'))
    .map((l) => l.trim());
}

/** The line `describeUndeclaredKey` prints for one finding — the expectation. */
function expectedLine(document: unknown, path: PropertyKey[], key: string): string {
  return describeUndeclaredKey({ path, key }, document);
}

async function runValidate(name: string, document: unknown): Promise<void> {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(document), 'utf-8');
  await validate(file);
}

/** Every `unrecognized_keys` the parse reported, at any arm depth, as `path|key`. */
function everyRefusedKeyInTheTree(document: unknown): string[] {
  const result = validateAuthoredDocument(document);
  if (result.success) return [];
  const all: string[] = [];
  const walk = (issues: readonly UnionIssueLike[], prefix: PropertyKey[]): void => {
    for (const issue of issues) {
      const path = [...prefix, ...(issue.path ?? [])];
      for (const key of issue.keys ?? []) all.push(`${path.join('.')}|${key}`);
      for (const arm of issue.errors ?? []) walk(arm, path);
    }
  };
  walk(result.error.issues as readonly UnionIssueLike[], []);
  return all;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-strict-face-5250-'));
  out = [];
  exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  };
  console.log = capture;
  console.error = capture;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restore = () => {
    console.log = originalLog;
    console.error = originalError;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restore();
  rmSync(dir, { recursive: true, force: true });
});

describe('objectui validate — an undeclared key is refused by name (objectui#5250)', () => {
  it('refuses the card\'s probe at the root, naming `validation`, its path and the prescription', async () => {
    // The precondition: the tolerant face accepts this document, so the
    // refusal below is the strict face's and nothing else's.
    expect(safeValidateSchema(CARD_PROBE).success).toBe(true);

    await runValidate('probe.json', CARD_PROBE);

    expect(exitCodes).toEqual([1]);
    const lines = plainLines();
    expect(lines).toContain('1. Unrecognized key: "validation"');
    expect(lines).toContain('   Path: (root)');
    expect(lines).toContain('   Code: unrecognized_keys');
    expect(undeclaredLines()).toEqual([expectedLine(CARD_PROBE, [], 'validation')]);
    expect(undeclaredLines()[0]).toBe(
      'Undeclared key "validation" at (root) (type "input"): no schema declares it there. ' +
        'Remove it, or check its spelling against the keys declared at that position.',
    );
    expect(lines.some((l) => l.includes('Schema is valid'))).toBe(false);
  });

  it('keeps the declared-only document valid (the positive control)', async () => {
    await runValidate('clean.json', CARD_PROBE_DECLARED_ONLY);
    expect(exitCodes).toEqual([0]);
    expect(plainLines()).toContain('✓ Schema is valid!');
    expect(undeclaredLines()).toEqual([]);
  });

  it('refuses an undeclared key on a nested child and names it at the child\'s path', async () => {
    expect(safeValidateSchema(NESTED_PROBE).success).toBe(true);
    // The child slot is an undiscriminated union (`SchemaNode | SchemaNode[]`),
    // but only one of its arms fits this child, so the parse reports the
    // refusal at the child itself, as `unrecognized_keys`, naming the key.
    // `findUndeclaredKeys` has to name it there too; the union-nested shape it
    // also reads is pinned by the widget cases below.
    const result = validateAuthoredDocument(NESTED_PROBE);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([
      { code: 'unrecognized_keys', path: ['children', 0], keys: ['nonsense'] },
    ]);
    expect(findUndeclaredKeys(result.error!.issues as readonly UnionIssueLike[])).toEqual([
      { path: ['children', 0], key: 'nonsense' },
    ]);

    await runValidate('nested.json', NESTED_PROBE);

    expect(exitCodes).toEqual([1]);
    expect(undeclaredLines()).toEqual([expectedLine(NESTED_PROBE, ['children', 0], 'nonsense')]);
    expect(undeclaredLines()[0]).toContain('"nonsense" at children → 0 (type "input")');
  });

  it('keeps the nested declared-only document valid', async () => {
    await runValidate('nested-clean.json', NESTED_DECLARED_ONLY);
    expect(exitCodes).toEqual([0]);
    expect(undeclaredLines()).toEqual([]);
  });

  it('names a key two child slots deep, at its full path', async () => {
    expect(safeValidateSchema(DEPTH_TWO).success).toBe(true);
    await runValidate('depth-two.json', DEPTH_TWO);
    expect(exitCodes).toEqual([1]);
    expect(undeclaredLines()).toEqual([
      expectedLine(DEPTH_TWO, ['children', 0, 'children', 0], 'colour'),
    ]);
    expect(undeclaredLines()[0]).toContain('at children → 0 → children → 0 (type "text")');
  });

  it('does not name a key that a viable arm declares — only the one every viable arm refuses', async () => {
    // Load-bearing precondition: the generic widget arm DOES refuse `value`
    // somewhere in the issue tree, so a reader that took any arm's word would
    // name it. The `metric-card` arm declares it (a registered input).
    expect(everyRefusedKeyInTheTree(WIDGET_TYPO)).toContain('widgets.0|value');

    await runValidate('widget-typo.json', WIDGET_TYPO);

    expect(exitCodes).toEqual([1]);
    expect(undeclaredLines()).toEqual([expectedLine(WIDGET_TYPO, ['widgets', 0], 'trendValu')]);
  });

  it('does not read an arm whose `type` mismatched', async () => {
    // Load-bearing precondition: the `metric-card` arm refuses `options` on
    // this `bar` widget — but it is not the arm the widget is for.
    expect(everyRefusedKeyInTheTree(WIDGET_OPTIONS)).toContain('widgets.0|options');

    await runValidate('widget-options.json', WIDGET_OPTIONS);

    expect(exitCodes).toEqual([1]);
    expect(undeclaredLines()).toEqual([
      expectedLine(WIDGET_OPTIONS, ['widgets', 0, 'options'], 'xField'),
    ]);
  });

  it('refuses the mixed-vocabulary `field` and keeps the #3090 explanation with the refusal', async () => {
    expect(safeValidateSchema(MIXED_FORM).success).toBe(true);
    await runValidate('mixed.json', MIXED_FORM);
    expect(exitCodes).toEqual([1]);
    expect(undeclaredLines()).toEqual([expectedLine(MIXED_FORM, ['fields', 0], 'field')]);
    expect(plainLines().some((l) => l.includes("'subject' also carries { field: 'subject_line' }"))).toBe(true);
  });
});

describe('findUndeclaredKeys — reads the same issues the printer prints', () => {
  it('names no key for a refusal that is about a VALUE, not a key', () => {
    // Refused by both faces, for `variant` — a declared key with an off-enum
    // value. No key is undeclared, so none may be named.
    const valueOnly = { type: 'text', content: 'Small text', variant: 'small' };
    const result = validateAuthoredDocument(valueOnly);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.code)).not.toContain('unrecognized_keys');
    expect(findUndeclaredKeys(result.error!.issues as readonly UnionIssueLike[])).toEqual([]);
  });

  it('reads each refused key once, with the path of the object carrying it', () => {
    const result = validateAuthoredDocument(CARD_PROBE);
    expect(result.success).toBe(false);
    expect(findUndeclaredKeys(result.error!.issues as readonly UnionIssueLike[])).toEqual([
      { path: [], key: 'validation' },
    ]);
  });
});

describe('objectui check — the validity arm reads the strict door too (objectui#5250)', () => {
  function writeSchema(name: string, body: unknown): void {
    writeFileSync(join(dir, name), JSON.stringify(body));
  }

  /** The line printed under a listed file: its first issue. */
  function linesUnder(file: string): string[] {
    const lines = plainLines();
    const at = lines.findIndex((l) => /^ {3}\S/.test(l) && l.includes(`${file} (type "`));
    if (at < 0) throw new Error(`${file} is not listed as a file that did not validate`);
    const under: string[] = [];
    for (let i = at + 1; i < lines.length && /^ {5}\S/.test(lines[i]); i++) under.push(lines[i].trim());
    return under;
  }

  it('lists a leaf carrying an undeclared key by name and names the key under it', async () => {
    // Before this card the tolerant face validated it, and `check` counted it
    // among the validated files.
    expect(safeValidateSchema(CARD_PROBE).success).toBe(true);
    writeSchema('probe.json', CARD_PROBE);
    writeSchema('clean.json', CARD_PROBE_DECLARED_ONLY);

    await check(dir);

    const issues = validateAuthoredDocument(CARD_PROBE).error!.issues;
    expect(linesUnder('probe.json')).toEqual([
      describeFirstIssue(issues),
      expectedLine(CARD_PROBE, [], 'validation'),
    ]);
    expect(plainLines()).toContain(closingLine({ validated: 1, notValidated: 0, didNotValidate: 1 }));
    // Advisory, as before: listing the file does not fail the run.
    expect(exitCodes).toEqual([]);
  });

  it('names a nested undeclared key the first-issue line cannot', async () => {
    writeSchema('dashboard.json', WIDGET_OPTIONS);
    await check(dir);
    const under = linesUnder('dashboard.json');
    // The first issue sits at the widget and names no key…
    expect(under[0]).toBe(describeFirstIssue(validateAuthoredDocument(WIDGET_OPTIONS).error!.issues));
    expect(under[0]).not.toContain('xField');
    // …so the undeclared-key line is what names it.
    expect(under.slice(1)).toEqual([expectedLine(WIDGET_OPTIONS, ['widgets', 0, 'options'], 'xField')]);
  });

  it('keeps the objectui#4795 expression refusal on a file the strict face refuses: both are reported, and the run fails', async () => {
    // `alert` declares `title` and never evaluates it, so the expression is
    // objectui#4795's refusal; `nonsense` is the undeclared key, the strict
    // face's. Two findings on two different keys of one file.
    const document = { type: 'alert', title: EXPRESSION, nonsense: 1 };
    const strict = validateAuthoredDocument(document);
    expect(strict.success).toBe(false);
    expect(findUndeclaredKeys(strict.error!.issues as readonly UnionIssueLike[])).toEqual([
      { path: [], key: 'nonsense' },
    ]);
    expect(findUnbindableTextExpressions(document)).toMatchObject([
      { severity: 'refusal', type: 'alert', key: 'title', path: ['title'] },
    ]);
    writeSchema('alert.json', document);

    await check(dir);

    // Listed for the strict refusal, with its undeclared key named under it…
    expect(linesUnder('alert.json')).toEqual([
      describeFirstIssue(strict.error!.issues),
      expectedLine(document, [], 'nonsense'),
    ]);
    // …and refused for the expression, which fails the run.
    expect(plainLines().filter((l) => l.startsWith('x Unevaluated expression in alert.json '))).toHaveLength(1);
    expect(plainLines()).toContain('Found 1 errors');
    expect(exitCodes).toEqual([1]);
  });
});
