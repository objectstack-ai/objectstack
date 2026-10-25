import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { LEDGER_ANCHORS, ledgerAnchorDiagnostic } from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#9537 — the ratchet detects its own dead anchor.
 *
 * Both ledgers in `check-spec-symbol-derivation.mjs` end their stale-entry
 * message by naming an anchor card ("objectui#<n> can be ended once the ledger
 * is empty"). The instruction is only followable while that card is OPEN, and
 * twice now an anchor has been ended underneath a live block with no signal at
 * all — objectstack#4115 (re-anchored by objectui#6291) and rule 2's anchor,
 * which is the standing exclusion.
 *
 * The ruling on objectui#9537 (letter 3, with letter 1 as its companion) keeps
 * the anchor where it is and buys the DETECTION instead. Its acceptance names
 * both legs, and says in as many words that proving only the green leg does not
 * count — so the fire leg and the two silent legs are asserted here side by
 * side, on the same pure function the gate calls.
 *
 * ⚠️ Why the synthetic anchors below use 999999999: a real issue number written
 * into an assertion becomes a live cross-reference the moment this text is
 * quoted into a pull-request body, and quoting this gate's output into pull
 * requests is standing practice on this family of cards. The sibling pin
 * `spec-symbol-ledger-plugin-detail-7265.test.ts` spells its own sentinel `#0`
 * for the same reason; `0` cannot serve here because a falsy anchor is a
 * distinct case this file also asserts.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-spec-symbol-derivation.mjs');

/** Look one up, or fail by name: a `find` that returns nothing is a table that lost an anchor. */
function anchorFor(ledger: string) {
  const found = LEDGER_ANCHORS.find((a) => a.ledger === ledger);
  if (!found) throw new Error(`the ${ledger} anchor is gone from LEDGER_ANCHORS`);
  return found;
}

/** A number this repository will never issue, so a quoted assertion links to nothing. */
const SENTINEL_ISSUE = 999999999;

function anchor(overrides: Record<string, unknown> = {}) {
  return {
    ledger: 'SYNTHETIC_DEBT',
    constant: 'SYNTHETIC_DEBT_ISSUE',
    issue: SENTINEL_ISSUE,
    entries: { '@object-ui/types': ['SomeMirroredSymbol'] },
    regenerator: '--ledger',
    state: 'closed',
    excludedByName: null,
    ...overrides,
  };
}

describe('acceptance leg 1 — a CLOSED anchor over a NON-EMPTY block fires, and names the anchor', () => {
  it('fires', () => {
    const finding = ledgerAnchorDiagnostic(anchor());
    expect(finding).not.toBeNull();
    expect(finding?.kind).toBe('dead-anchor');
  });

  it('names the anchor — the constant, the card, and how many entries sit under it', () => {
    // "Names the anchor" is the acceptance's own word. A diagnostic that fires
    // without saying WHICH anchor is one the reader cannot act on either.
    const message = ledgerAnchorDiagnostic(anchor())?.message ?? '';
    expect(message).toContain('SYNTHETIC_DEBT_ISSUE');
    expect(message).toContain(`objectui#${SENTINEL_ISSUE}`);
    expect(message).toContain('1 entry');
  });

  it('counts entries across packages, not packages', () => {
    const message =
      ledgerAnchorDiagnostic(
        anchor({ entries: { '@object-ui/types': ['A', 'B'], '@object-ui/core': ['C'] } }),
      )?.message ?? '';
    expect(message).toContain('3 entries');
  });
});

describe('acceptance leg 2 — the silent cases, which are what catch a detector that always fires', () => {
  it('an OPEN anchor over a non-empty block is silent', () => {
    expect(ledgerAnchorDiagnostic(anchor({ state: 'open' }))).toBeNull();
  });

  it('an EMPTY block under a CLOSED anchor is silent — the tree’s state today', () => {
    // The dead instruction is unreachable while the block is empty: the ratchet
    // that renders it iterates the block. This is the leg that keeps the check
    // from reddening `main` on the very condition the card describes as dormant.
    expect(ledgerAnchorDiagnostic(anchor({ entries: {} }))).toBeNull();
  });

  it('…and a block whose package keys are all empty counts as empty', () => {
    expect(ledgerAnchorDiagnostic(anchor({ entries: { '@object-ui/types': [] } }))).toBeNull();
  });

  it('no anchor at all is not a DEAD anchor', () => {
    // The ratchet’s tail is written behind a truthiness guard, so a falsy anchor
    // renders no instruction — there is nothing for a reader to fail to follow.
    expect(ledgerAnchorDiagnostic(anchor({ issue: 0 }))).toBeNull();
    expect(ledgerAnchorDiagnostic(anchor({ issue: null }))).toBeNull();
  });
});

describe('a state that does not parse is LOUD, never silent', () => {
  it('rejects a misspelled state instead of waving it through', () => {
    // The failure this guards is the one objectui#9596 records one layer up: a
    // check whose pass condition is shared with "the guard is quietly off".
    // "Closed" is not "closed", and a silent return here would be exactly that.
    const finding = ledgerAnchorDiagnostic(anchor({ state: 'Closed' }));
    expect(finding?.kind).toBe('bad-declaration');
    expect(finding?.message).toContain('SYNTHETIC_DEBT_ISSUE');
  });

  it('…and judges the declaration before the exclusion, so an excluded anchor cannot hide one', () => {
    const finding = ledgerAnchorDiagnostic(
      anchor({ state: 'unknown', excludedByName: 'excluded for some reason' }),
    );
    expect(finding?.kind).toBe('bad-declaration');
  });
});

describe('the standing exclusion — by name, with the reason on the same line', () => {
  it('an excluded anchor is silent even when it would otherwise fire', () => {
    expect(ledgerAnchorDiagnostic(anchor({ excludedByName: 'excluded, because …' }))).toBeNull();
  });

  it('…and `ignoreExclusion` shows it WOULD have fired, which is what keeps it visible', () => {
    const finding = ledgerAnchorDiagnostic(anchor({ excludedByName: 'excluded, because …' }), {
      ignoreExclusion: true,
    });
    expect(finding?.kind).toBe('dead-anchor');
  });

  it('`CLAIM_DEBT_ISSUE` is excluded BY NAME and its reason sits on that one line', () => {
    // The ruling’s wording: "exclude it by name and say why in the same line."
    const claim = anchorFor('CLAIM_DEBT');
    expect(claim.excludedByName).toBeTruthy();
    expect(claim.excludedByName).toContain('CLAIM_DEBT_ISSUE');
    expect(claim.excludedByName).toContain('objectui#4592');
    expect(claim.excludedByName).not.toContain('\n');
  });

  it('the exclusion is still LOAD-BEARING — it would fire today, so it cannot go quiet', () => {
    // If this ever reds, rule 2’s ledger has been emptied or re-anchored and the
    // exclusion has outlived its reason: delete it rather than keep it.
    expect(ledgerAnchorDiagnostic(anchorFor('CLAIM_DEBT'), { ignoreExclusion: true })?.kind).toBe('dead-anchor');
  });
});

describe("today's tree, so the check is judged against the real ledgers and not only fixtures", () => {
  it('`DEBT` is declared under a closed anchor and is silent, because its block is empty', () => {
    const debt = anchorFor('DEBT');
    expect(debt.state).toBe('closed');
    expect(ledgerAnchorDiagnostic(debt)).toBeNull();
  });

  it('…and re-seeding that block under the same anchor makes it fire — the recurrence path', () => {
    // The card’s own trigger, asserted rather than described: the block’s one
    // sanctioned growth path is a jurisdiction widening, and this is what the
    // gate does on the pull request that takes it without re-anchoring.
    const debt = anchorFor('DEBT');
    const reseeded = { ...debt, entries: { '@object-ui/types': ['SomeMirroredSymbol'] } };
    expect(ledgerAnchorDiagnostic(reseeded)?.kind).toBe('dead-anchor');
  });

  it('every anchor constant the gate declares has an entry in the table', () => {
    // "…or any ledger anchor it reads" (the ruling). A third ledger added later
    // is covered by mechanism rather than by whoever remembers this file.
    const text = fs.readFileSync(gateSource, 'utf8');
    const declared = [...text.matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]*_ISSUE) = (\d+);$/gm)].map(
      (m) => ({ constant: m[1], issue: Number(m[2]) }),
    );
    expect(declared.length, 'no anchor constant found — the scan is broken, not the tree').toBeGreaterThan(0);
    for (const { constant, issue } of declared) {
      const entry = LEDGER_ANCHORS.find((a) => a.constant === constant);
      if (!entry) {
        throw new Error(`${constant} has no LEDGER_ANCHORS entry — the dead-anchor check cannot see it`);
      }
      expect(entry.issue).toBe(issue);
    }
  });

  it('every table entry declares a state this check can judge', () => {
    for (const entry of LEDGER_ANCHORS) {
      expect(['open', 'closed']).toContain(entry.state);
    }
  });
});

describe('the diagnostic may not carry a card-closing keyword', () => {
  /**
   * GitHub's closing-keyword grammar as root `AGENTS.md` states it: a keyword
   * immediately before an issue reference, any tense, no sentence parsing. This
   * message names an anchor card and will be quoted into pull-request bodies by
   * the same practice that constrains the stale-entry message beside it.
   */
  const CLOSING_TRIGGER =
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9-]+\/[A-Za-z0-9-]+|objectui|objectstack)?#(?:\$\{|\d)/i;

  it('the regex can fire — the control, without planting a live trigger', () => {
    // ⛔ Without this leg the assertion below is unfalsifiable: a regex that
    // matches nothing renders exactly like a message that carries nothing.
    expect(CLOSING_TRIGGER.test('and close #${anchor.issue} once the ledger is empty')).toBe(true);
    expect(CLOSING_TRIGGER.test('resolved objectui#0 once the ledger is empty')).toBe(true);
  });

  it('…and the rendered diagnostic carries none', () => {
    const message = ledgerAnchorDiagnostic(anchor())?.message ?? '';
    expect(message.length, 'the diagnostic is empty — nothing was scanned').toBeGreaterThan(0);
    expect(
      CLOSING_TRIGGER.test(message),
      'the dead-anchor diagnostic has a GitHub closing keyword in front of an issue reference. '
        + 'This text names an anchor card and reaches pull-request bodies by design, so a keyword '
        + 'here ends that card on merge.',
    ).toBe(false);
  });

  it('…nor does the standing exclusion, which prints on every green run', () => {
    for (const entry of LEDGER_ANCHORS) {
      if (!entry.excludedByName) continue;
      expect(CLOSING_TRIGGER.test(entry.excludedByName)).toBe(false);
    }
  });
});
