import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — see
// objectui#3494.
import { analyze } from '../check-action-forward-parity.mjs';

/**
 * objectui#9597 — both stale-entry messages in
 * `scripts/check-action-forward-parity.mjs` spelled a GitHub closing keyword
 * immediately in front of the issue number they interpolate.
 *
 * ## Why a message's WORDING gets a pin at all
 *
 * These messages are written to be QUOTED. The discipline around a `KNOWN_GAPS`
 * or `UNCHECKED_FORWARDS` entry is to take the INTERMEDIATE reading — the gap
 * fixed, the entry not yet deleted — and paste the gate's own output into the
 * pull request as proof the work landed. A closing keyword in front of the
 * number therefore does not stay in the script: it travels into a pull-request
 * body, and on merge it ends the anchor card silently, from a body whose author
 * was being careful. GitHub's parser does no sentence parsing, so no hedging in
 * the surrounding sentence reaches it. The reason is written at the ratchet that
 * emits the messages; this file is what makes the constraint fail loudly instead
 * of being remembered.
 *
 * The landed precedent is the `DEBT` ratchet in `scripts/check-lint-coverage.mjs`,
 * pinned by `scripts/__tests__/check-lint-coverage-closing-keyword.test.ts`, and
 * the rule-2 stale-entry message in `scripts/check-spec-symbol-derivation.mjs` —
 * cited by the names of the things, not by line address (root `AGENTS.md`,
 * commandment #11).
 *
 * ## Why this file RENDERS both messages instead of reading the source text
 *
 * A source-text assertion cannot tell a repaired emitter from a broken one: it
 * matches a template, not the sentence a contributor would paste, and it reads
 * identically whether or not the emitter can ever fire. That is how three
 * earlier repairs of this class left this gate standing. So every leg below
 * drives the REAL `analyze()` over a throwaway tree with a SEEDED ledger that
 * makes the ratchet fire, and asserts on the string it actually produced. The
 * cheap source leg is kept at the end as a supplement, never as the proof.
 *
 * ⚠️ Every rendered leg is paired with a control that MUST fire. A ratchet that
 * emitted nothing, a seed that excused something after all, and a regex that
 * matches nothing all render identically to a clean message — so each is
 * asserted rather than assumed.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-action-forward-parity.mjs');

/**
 * A deliberately meaningless anchor. It must be a REAL number: both messages
 * interpolate `${meta.issue}` unguarded, so a missing value would render the
 * string `undefined` and every assertion below would pass over it.
 */
const FIXTURE_ANCHOR = 424242;

/**
 * GitHub's closing-keyword grammar as root `AGENTS.md` states the mitigation:
 * one of the keywords immediately before an issue reference, in any tense, with
 * no sentence parsing of any kind. Kept byte-identical to the copy in
 * `check-lint-coverage-closing-keyword.test.ts` so the two cannot drift.
 */
const CLOSING_TRIGGER =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9-]+\/[A-Za-z0-9-]+|objectui|objectstack)?#(?:\$\{|\d)/i;

const UI_VIEW = 'packages/types/src/ui-action.ts';
const KEYS_MODULE = 'packages/core/src/actions/actionKeys.ts';
const CONSUMER = 'packages/core/src/actions/ActionRunner.ts';
const RENDERER = 'packages/components/src/renderers/action/action-x.tsx';

/**
 * A synthetic repo whose forward payload carries every owed key, so nothing is
 * dropped — which is precisely the state that makes a ledger entry stale.
 */
const FIXTURE_FILES: Record<string, string> = {
  [UI_VIEW]: 'export interface UIActionSchema {\n  name?: string;\n  description?: string;\n}\n',
  [KEYS_MODULE]: "export const RETIRED_ACTION_KEYS = {\n  execute: 'renamed to target',\n};\n",
  [CONSUMER]: [
    'export function run(action: any, list: any[]) {',
    '  const { target } = action;',
    '  if (action.undoable && action.description) return target;',
    '  return list.filter((a) => a.locations).map((a) => a.icon);',
    '}',
  ].join('\n'),
  [RENDERER]: 'export const R = () => { void execute({ target, undoable, description }); };\n',
};

const BASE_OPTIONS = {
  spec: {
    declared: ['name', 'type', 'target', 'undoable', 'bodyShape', 'objectName'],
    inline: ['name', 'type', 'target'],
  },
  surfaces: [{ id: 'action:x', contract: 'declared', file: RENDERER }],
  consumers: [{ file: CONSUMER, binding: 'action' }],
  justified: {},
  knownGaps: {},
  opaqueSpreads: {},
  uncheckedForwards: {},
  uiActionView: UI_VIEW,
  actionKeysModule: KEYS_MODULE,
};

/**
 * Runs the REAL gate over a throwaway workspace carrying the seeded ledger, and
 * returns the one message it printed.
 *
 * `expectedPhrase` is the control that the ratchet under test is the one that
 * fired: both ledgers are seeded through the same seam, and a seed that landed
 * on the wrong ratchet would otherwise read as a clean pass.
 */
function renderStaleEntry(seed: Record<string, unknown>, expectedPhrase: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-forward-parity-anchor-'));
  try {
    for (const [rel, contents] of Object.entries(FIXTURE_FILES)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
    const { errors } = analyze(dir, { ...BASE_OPTIONS, ...seed }) as { errors: string[] };
    expect(errors, 'the seeded ledger did not make the ratchet fire').toHaveLength(1);
    expect(errors[0], 'a different ratchet fired than the one this leg seeds').toContain(expectedPhrase);
    return errors[0];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const renderStaleKnownGap = () =>
  renderStaleEntry(
    { knownGaps: { 'action:x:undoable': { reason: 'stale — the key is forwarded now', issue: FIXTURE_ANCHOR } } },
    'is no longer a gap',
  );

const renderStaleUncheckedForward = () =>
  renderStaleEntry(
    { uncheckedForwards: { 'action:x': { reason: 'stale — the literal is checked now', issue: FIXTURE_ANCHOR } } },
    'excuses nothing',
  );

/**
 * Collapses the message's own hanging indentation, so a leg asserting on a
 * SENTENCE is not really asserting on where the emitter happens to wrap. Both
 * messages break mid-phrase today.
 */
const flatten = (message: string): string => message.replace(/\s+/g, ' ').trim();

/** Both ratchets, from the banner that states the rule to the next ratchet. */
function staleEntryRatchets(): string {
  const text = fs.readFileSync(gateSource, 'utf8');
  const start = text.indexOf('// ⛔ Neither stale-entry message below may put a GitHub closing keyword');
  expect(start, "the banner stating the no-closing-keyword rule is gone").toBeGreaterThan(-1);
  const end = text.indexOf('for (const entry of Object.keys(opaqueSpreads)) {', start);
  expect(end, 'the OPAQUE_SPREADS ratchet after the two under test is gone').toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('neither stale-entry message may carry a card-ending keyword', () => {
  it('the regex fires on the wording this card replaced — the control', () => {
    // ⛔ Without this leg every assertion below is unfalsifiable: a ratchet that
    // printed nothing and a regex that matches nothing render identically to a
    // clean message.
    //
    // The resolved form is BUILT here rather than written as a literal, so this
    // file plants no card-ending trigger of its own in the tree the class-wide
    // sweep will read. The template form is the byte-for-byte pre-repair
    // spelling, which can never resolve to an issue reference in a rendered body.
    expect(CLOSING_TRIGGER.test(`(and close #${FIXTURE_ANCHOR} once its last entry is gone)`)).toBe(true);
    expect(CLOSING_TRIGGER.test('(and close #${meta.issue} once')).toBe(true);
    // …and the repaired spelling is NOT a false positive for that same regex.
    expect(CLOSING_TRIGGER.test(`(and objectui#${FIXTURE_ANCHOR} can be ended once its last entry is gone)`)).toBe(
      false,
    );
  });

  it('…and the KNOWN_GAPS message the gate actually renders carries no trigger', () => {
    expect(
      CLOSING_TRIGGER.test(renderStaleKnownGap()),
      "the KNOWN_GAPS stale-entry message has a GitHub closing keyword in front of an issue "
        + 'reference again. This text is quoted into pull-request bodies by design — quoting the '
        + 'intermediate reading is the standing discipline for burning down a ledger entry — so a '
        + 'keyword here ends the anchor card on merge. KNOWN_GAPS is not empty in this tree, so '
        + 'this message is reachable. The reason is written at the ratchet that emits it.',
    ).toBe(false);
  });

  it('…and the UNCHECKED_FORWARDS message the gate actually renders carries no trigger', () => {
    expect(
      CLOSING_TRIGGER.test(renderStaleUncheckedForward()),
      'the UNCHECKED_FORWARDS stale-entry message has a GitHub closing keyword in front of an '
        + 'issue reference again — same quoting discipline, same merge-path trigger. That this '
        + "ledger is empty today is not a defence: the message is one entry away from rendering, "
        + 'and an empty ledger is exactly why the defect survived three repairs of this class.',
    ).toBe(false);
  });

  it('…while both still tell the reader what to do with the anchor', () => {
    // The positive half, so "no trigger" cannot be satisfied by deleting the
    // instruction outright — losing the guidance to lose the keyword is the
    // wrong trade.
    for (const rendered of [renderStaleKnownGap(), renderStaleUncheckedForward()]) {
      expect(flatten(rendered)).toContain(`objectui#${FIXTURE_ANCHOR}`);
      expect(flatten(rendered)).toContain('can be ended once its last entry is gone');
    }
  });

  it('the ratchet SOURCE carries no trigger either, comment included', () => {
    // The cheap leg, and not a duplicate of the rendered ones: it also covers
    // the prose beside the emitters, which reaches a reader who is deciding how
    // to word the next entry.
    expect(CLOSING_TRIGGER.test(staleEntryRatchets())).toBe(false);
  });
});
