// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ConditionBuilder`'s CEL placeholder may not TEACH a root the same mount does
 * not OFFER — objectui#9952, the third door of the trap objectui#9645
 * (autocomplete) and objectui#9855 (subject dropdown) closed at two other
 * controls.
 *
 * ## The defect these cases reproduce
 *
 * The placeholder was a string literal handed to `CelPredicateField` at EVERY
 * mount — `record.status != 'done' && user.isAdmin` — while the very same
 * component had already narrowed a record-scoped mount's autocomplete to
 * `RECORD_CONDITION_ROOTS`, which carries no `user`. At a server-evaluated
 * mount that root is not merely unadvertised: `conditionScope.ts` states in its
 * own words that a hook `condition` and a validation rule's guard are evaluated
 * with `{ record, previous }` and only those, fail-CLOSED at the validation
 * host — and objectstack's `wrapDeclarativeHook` docblock says the condition
 * formula is evaluated against two bindings, `record` and `previous`. So the
 * one line an author reads BEFORE typing anything taught a root the evaluator
 * never binds, and copying it costs the author the write.
 *
 * ## The pin asserts a RELATION, never the string
 *
 * ⛔ No case below asserts what the placeholder SAYS. Each reads whatever the
 * editor shows and requires every root in it to be a member of the set that
 * mount offers. A pin on the literal would go green again the day someone
 * re-hard-codes one, which is the defect itself.
 *
 * `celRootsMentioned` is the instrument, so a case proves it can FAIL before
 * any case trusts it: `control A` feeds it the OLD literal at the record-scoped
 * mount's offered set and requires a rejection.
 *
 * ## Read from the DOM, not from the helper
 *
 * The subject case renders the real component and reads the real `placeholder`
 * attribute. Asking `celExampleForRoots` directly would leave the JSX free to
 * go on passing a literal with every case still green — the wiring is half of
 * what is under test.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule and
// for the reason `ConditionBuilder.mountRoots.test.tsx` states: the scope
// introspection runs behind a dynamic `import('@objectstack/formula')` inside
// `celAuthoring`, and a cold first load has been measured near a whole budget.
// The specifier must match `loadFormula`'s exactly — ESM caches by resolved
// specifier.
import '@objectstack/formula';

// objectui#4697 — these inspectors call `useObjectFields(objectName)`
// unconditionally, so a mount-time fetch would escape to the real network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import {
  ConditionBuilder,
  RECORD_CONDITION_ROOTS,
  celExampleForRoots,
  celRootsMentioned,
} from './ConditionBuilder';
import { introspectCelScope } from '../celAuthoring';

afterEach(cleanup);

/** The literal this card removed — the control input, never an expectation. */
const OLD_LITERAL_PLACEHOLDER = "record.status != 'done' && user.isAdmin";

function BuilderHarness(props: { scope?: 'record' | 'flattened'; roots?: string[] }) {
  const [value, setValue] = React.useState('');
  return (
    <ConditionBuilder
      label="Condition"
      value={value}
      onCommit={setValue}
      objectName="invoice"
      fields={[{ name: 'status' }]}
      {...props}
    />
  );
}

/** `CelPredicateField` renders its editor as a combobox TEXTAREA. */
function rawEditorPlaceholder(): string {
  const root = screen.getByText('Condition').parentElement!.parentElement! as HTMLElement;
  fireEvent.click(within(root).getByText('Expression'));
  const box = within(root)
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  return box.getAttribute('placeholder') ?? '';
}

/** The relation under test, written once so subject and control A share it. */
function rootsTaughtOutsideOffer(example: string, offered: readonly string[]): string[] {
  return celRootsMentioned(example).filter((r) => !offered.includes(r));
}

/* ── control A — the instrument can FAIL ───────────────────────────────── */

describe('the assertion rejects the literal this card removed (objectui#9952)', () => {
  it('reads `user` out of the OLD placeholder as a root the record-scoped offer lacks', () => {
    // Run FIRST and deliberately: every case below is worthless if this one
    // cannot fail. The offered set is derived from the shipped constant, so
    // this stays a rejection only while that constant really lacks `user`.
    expect(rootsTaughtOutsideOffer(OLD_LITERAL_PLACEHOLDER, RECORD_CONDITION_ROOTS)).toEqual(['user']);
  });

  it('accepts an example built only from offered roots — so it is not rejecting everything', () => {
    // The other half of a working instrument: a rejector that rejects every
    // input would satisfy the case above while proving nothing.
    expect(rootsTaughtOutsideOffer("record.status != 'done'", RECORD_CONDITION_ROOTS)).toEqual([]);
  });
});

/* ── subject — a record-scoped mount teaches only what it offers ────────── */

describe('a record-scoped mount teaches no root it does not offer (objectui#9952)', () => {
  it('mentions no root outside `RECORD_CONDITION_ROOTS`', () => {
    render(<BuilderHarness scope="record" />);
    const shown = rawEditorPlaceholder();
    expect(rootsTaughtOutsideOffer(shown, RECORD_CONDITION_ROOTS)).toEqual([]);
  });

  it('still teaches SOMETHING — an empty placeholder would satisfy the case above', () => {
    // The trivial pass this pin has to exclude. The example must survive the
    // narrowing, not be emptied by it: `record` is offered at this mount, so
    // the clause built on it is still on screen.
    render(<BuilderHarness scope="record" />);
    const shown = rawEditorPlaceholder();
    expect(shown.trim()).not.toEqual('');
    expect(celRootsMentioned(shown)).toContain('record');
  });

  it('shows something the OLD literal was not — the defect is really gone', () => {
    // Stated as a difference rather than as a string, so this case says
    // "no longer the unparameterised literal" without pinning what replaced it.
    render(<BuilderHarness scope="record" />);
    expect(rawEditorPlaceholder()).not.toEqual(OLD_LITERAL_PLACEHOLDER);
  });
});

/* ── control B — the client-evaluated mounts lose nothing ───────────────── */

describe('mounts that declare no narrowing are unchanged (objectui#9952)', () => {
  it('a mount with no `scope` still teaches `user`, which its host really binds', () => {
    // ⛔ This card removes no capability. A mount that declares nothing
    // inherits the engine's own advertisement — `buildExpressionScope` binds
    // `user` for every predicate evaluated in the browser — so the example it
    // teaches is what it always taught, and BOTH clauses are still on screen.
    render(<BuilderHarness />);
    const shown = rawEditorPlaceholder();
    expect(celRootsMentioned(shown)).toEqual(expect.arrayContaining(['record', 'user']));
  });

  it('every root such a mount teaches is one the engine advertises', async () => {
    // Both sides derived: the left from the rendered placeholder, the right
    // from `introspectCelScope` — the same call the editor makes. An engine
    // that stops advertising a root this example teaches reddens here instead
    // of leaving the example to rot.
    render(<BuilderHarness />);
    const shown = rawEditorPlaceholder();
    const advertised = (await introspectCelScope({})).roots;
    expect(advertised.length, 'the engine advertised nothing — the reading is void').toBeGreaterThan(0);
    expect(rootsTaughtOutsideOffer(shown, advertised)).toEqual([]);
  });

  it('a mount that DECLARES more roots gets them taught again', () => {
    // The restoration path, proven rather than promised: the client-evaluated
    // `scope="record"` mounts that really do bind `user` say so in one line,
    // and the example follows the declaration — no second list to edit.
    render(<BuilderHarness scope="record" roots={['record', 'previous', 'user']} />);
    expect(celRootsMentioned(rawEditorPlaceholder())).toContain('user');
  });
});

/* ── the derivation, read at its own seam ──────────────────────────────── */

describe('celExampleForRoots derives, and never widens (objectui#9952)', () => {
  it('teaches nothing at all rather than teaching a root nobody offers', () => {
    // No example beats a false one. The empty string reaches `placeholder`,
    // which is optional on `CelPredicateField`, so the box simply shows none.
    expect(celExampleForRoots([])).toEqual('');
    expect(celExampleForRoots(['org'])).toEqual('');
  });

  it('holds for EVERY offered set, not just the ones a mount uses today', () => {
    // The property, quantified over the power set of the roots the shipped
    // clauses mention plus one the component never offers. This is what makes
    // a future clause safe: it cannot pass here while teaching an unoffered
    // root, whatever it spells.
    const universe = ['record', 'previous', 'user', 'os'];
    for (let mask = 0; mask < 1 << universe.length; mask += 1) {
      const offered = universe.filter((_, i) => mask & (1 << i));
      expect(
        rootsTaughtOutsideOffer(celExampleForRoots(offered), offered),
        `offered=[${offered.join(',')}]`,
      ).toEqual([]);
    }
  });
});

/* ── the instrument's own edges ────────────────────────────────────────── */

describe('celRootsMentioned reads roots, not text (objectui#9952)', () => {
  it('does not read a quoted literal as a root', () => {
    // The `fmtValue` hazard one control over (objectui#6293): a quoted
    // `'user.id'` is TEXT. Reading it as a root would let a clause be filtered
    // out for a root it never teaches.
    expect(celRootsMentioned("record.status != 'user.id'")).toEqual(['record']);
    expect(celRootsMentioned('record.name != "os.tenant"')).toEqual(['record']);
  });

  it('reads the head of a dotted path, never a member', () => {
    expect(celRootsMentioned('record.owner.department')).toEqual(['record']);
  });

  it('does not read CEL word literals as roots', () => {
    expect(celRootsMentioned('record.done == true')).toEqual(['record']);
    expect(celRootsMentioned('previous == null')).toEqual(['previous']);
  });
});
