// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13865] The `ai.requiresConfirmation` JSDoc may name only the destructive
 * signals the classifier actually reads.
 *
 * That JSDoc is an authoring surface, not a comment: it is the TSDoc an author
 * (often an AI author, ADR-0033) hovers at the moment they type
 * `requiresConfirmation:`. For a whole major it said the bridge defaults to
 * `true` for actions that look destructive
 *
 *   (`confirmText` set, `mode:'delete'`, or `variant:'danger'`)
 *
 * and the first of those three had already been retired. Maintainer ruling
 * #7828 (Option A) dropped the `confirmText` leg from
 * `actionLooksDestructive` (`packages/runtime/src/action-execution.ts`),
 * because `mode` and `variant` are closed, declared enumerations an author
 * sets on purpose while `confirmText` is UI dialog copy — copy that #7278 /
 * #7309 are actively migrating onto `description`, which is why 6 of 14
 * identity actions flipped classification the moment their `confirmText` was
 * removed.
 *
 * So the stale sentence was a SAFETY-shaped claim: an author reading it
 * believed a `confirmText` action would be routed through the HITL
 * confirmation path, and it is not. Two other carriers already stated the
 * corrected rule: the MCP bridge's tool-annotation block in `@objectstack/mcp`,
 * and the header of `packages/runtime/src/action-execution-destructive.test.ts`.
 * This docblock was the single site still teaching the retired leg.
 *
 * (That MCP file is named by package rather than by path on purpose. It is
 * prose, not an input — this pin never reads it — and
 * `check:cross-package-test-inputs` collects quoted path literals without
 * parsing, so writing the path would force a turbo-input declaration asserting
 * that spec's verdict depends on a file it does not read. The runtime path
 * below IS read, and `packages/runtime/src/**` is already declared for this
 * package.)
 *
 * ## Why this pin reads the RUNTIME too
 *
 * Wording alone rots the same way it rotted here: nothing tied the sentence to
 * the function it describes, so the ruling moved the code and left the prose.
 * The classifier half below is the tie. It fails in BOTH directions — if
 * `actionLooksDestructive` ever reads `confirmText` again, or stops reading
 * `mode`/`variant`, this goes red naming both files, and whoever makes that
 * change is told the docblock is now the thing that has to move.
 *
 * ⛔ Scope: the RELATION, not the wording. Rewording this docblock freely is
 * fine — what it may not do is re-enter `confirmText` as a destructive signal,
 * drop either declared signal, or stop stating that `ai.requiresConfirmation`
 * overrides in both directions.
 *
 * The `confirmText` predicate is deliberately conservative: a sentence may name
 * `confirmText` only while carrying an explicit negation ("not", "never", "no
 * longer"). That admits the useful correction — "`confirmText` is dialog copy,
 * not a destructive signal" — and refuses the shape the drift actually took, a
 * positive enumeration. The self-test below feeds it the historical sentence
 * verbatim, so the predicate cannot pass merely by the prose falling silent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/spec/src/ui → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const ACTION_SOURCE = join(HERE, 'action.zod.ts');
const CLASSIFIER_SOURCE = join(REPO_ROOT, 'packages', 'runtime', 'src', 'action-execution.ts');

/** The JSDoc block attached to the authorable `ai.requiresConfirmation` key. */
function requiresConfirmationDoc(): string {
  const source = readFileSync(ACTION_SOURCE, 'utf8');
  const key = source.indexOf('requiresConfirmation: z.boolean()');
  expect(key, 'the `requiresConfirmation` key declaration moved — re-anchor this pin').toBeGreaterThan(-1);
  const open = source.lastIndexOf('/**', key);
  const close = source.indexOf('*/', open);
  expect(open, 'no JSDoc block precedes `requiresConfirmation`').toBeGreaterThan(-1);
  expect(close, 'unterminated JSDoc block').toBeLessThan(key);
  return source.slice(open, close + 2);
}

/** A JSDoc block as flat prose — decorations dropped, wrapped lines rejoined. */
function flatten(block: string): string {
  return block
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prose split into sentences. A period only ends a sentence when whitespace
 * follows it, which leaves member paths (`ai.requiresConfirmation`) intact.
 */
function sentences(prose: string): string[] {
  return prose
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sentences that name `confirmText` without denying it — the shape the drift
 * took. A sentence carrying an explicit negation is the correction and passes.
 */
function positiveConfirmTextClaims(prose: string): string[] {
  return sentences(prose).filter(
    (s) => /confirmText/.test(s) && !/\b(not|never|no longer|nor|neither)\b/i.test(s),
  );
}

/** The body of `actionLooksDestructive` — the function this JSDoc describes. */
function classifierBody(): string {
  const source = readFileSync(CLASSIFIER_SOURCE, 'utf8');
  const start = source.indexOf('export function actionLooksDestructive');
  expect(start, '`actionLooksDestructive` moved — re-anchor this pin').toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n}', open);
  expect(end, 'unterminated `actionLooksDestructive` body').toBeGreaterThan(open);
  return source.slice(open, end);
}

describe('`ai.requiresConfirmation` docblock states the #7828 signal set (#13865)', () => {
  it('anchors on the live docblock and the live classifier', () => {
    // Anti-vacuity for every assertion below: both extractions must have found
    // real text, or "names no retired signal" passes by reading nothing.
    const doc = flatten(requiresConfirmationDoc());
    expect(doc.length).toBeGreaterThan(80);
    expect(doc).toMatch(/Override confirmation for AI calls/);
    expect(classifierBody()).toMatch(/requiresConfirmation/);
  });

  it('names both declared signals, and the classifier still reads both', () => {
    const doc = flatten(requiresConfirmationDoc());
    const body = classifierBody();
    // Control first: the signal is read at runtime, so the docblock owes it.
    expect(body, "the classifier stopped reading `mode === 'delete'`").toMatch(/mode === 'delete'/);
    expect(body, "the classifier stopped reading `variant === 'danger'`").toMatch(
      /variant === 'danger'/,
    );
    expect(doc, "the docblock must name `mode:'delete'`").toMatch(/`mode:\s*'delete'`/);
    expect(doc, "the docblock must name `variant:'danger'`").toMatch(/`variant:\s*'danger'`/);
  });

  it('would flag the pre-#13865 sentence as a positive `confirmText` claim (self-test)', () => {
    // Verbatim, the sentence this card retired. Without this the assertion
    // below could pass simply because the prose stopped naming `confirmText`.
    const before =
      'When unset, the bridge defaults to `true` for actions that look destructive '
      + "(`confirmText` set, `mode:'delete'`, or `variant:'danger'`). Set explicitly to `false` "
      + 'to assert a destructive-looking action is safe to run without human approval.';
    expect(positiveConfirmTextClaims(before)).toHaveLength(1);
    // And the correction shape is accepted, so the predicate is not "never say
    // `confirmText`" — naming it as a non-signal is the useful thing to write.
    expect(
      positiveConfirmTextClaims('`confirmText` is dialog copy, not a destructive signal.'),
    ).toEqual([]);
  });

  it('presents no positive `confirmText` claim', () => {
    expect(
      positiveConfirmTextClaims(flatten(requiresConfirmationDoc())),
      'a `confirmText` sentence with no negation re-seeds the leg #7828 Option A retired',
    ).toEqual([]);
  });

  it('the classifier still does not read `confirmText` (#7828 Option A)', () => {
    expect(
      classifierBody(),
      '`actionLooksDestructive` reads `confirmText` again — reopen #7828 before the docblock '
        + 'in `packages/spec/src/ui/action.zod.ts` may name it',
    ).not.toMatch(/confirmText/);
  });

  it('states the override in both directions', () => {
    const doc = flatten(requiresConfirmationDoc());
    // The classifier returns the author's value whenever the key is set, so the
    // docblock owes both legs: `false` demotes, `true` promotes.
    expect(classifierBody()).toMatch(/ai\?\.requiresConfirmation !== undefined/);
    expect(doc, 'the docblock must state the `false` override').toMatch(/`false`/);
    expect(doc, 'the docblock must state the `true` override').toMatch(/`true`/);
    expect(doc, 'the docblock must say the override applies when the key is set').toMatch(
      /unset/,
    );
  });
});
