// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A CLIENT-evaluated `ConditionBuilder` mount advertises what its browser host
 * really binds — objectui#9856, the declared cost of objectui#9645.
 *
 * ## The defect these cases reproduce
 *
 * objectui#9645 made a `scope="record"` mount advertise `RECORD_CONDITION_ROOTS`
 * instead of the engine's whole default list, and that is right for a mount
 * whose host this component cannot see: it is the set EVERY host of a
 * record-scoped condition binds. The two action mounts are not that mount.
 * `CONDITION_HOST_BY_METADATA_TYPE` rules the `action` tier `client` from a
 * reading taken at its evaluator, and an action's `visible` / `disabled` is
 * evaluated in the browser, where `buildExpressionScope` publishes the identity
 * roots and the feature flags. Declaring nothing there cost the author the
 * OFFER of every root beyond `record` — while the section's own hint text goes
 * on promising predicates "over the record / user / ctx".
 *
 * ## The pins are DERIVED, not retyped — both directions
 *
 * ⛔ No case below spells the advertised list. The membership case rebuilds it
 * from the two producers that decide it (`buildExpressionScope`, and the real
 * `usePredicateRecordContext` hook rendered in a probe), so it reddens when
 * either side moves rather than when someone forgets to update a copy. The
 * lint case runs each member through the same path the editor lints with, so a
 * root added here that the `record` scope REFUSES reddens as the objectui#8167
 * defect it would be, rather than reaching an author.
 *
 * ## The narrowing half is pinned too
 *
 * This list DROPS `previous` relative to the record-scoped default, because no
 * browser host binds it. That is the same ruling as the additions and the half
 * a reader is most likely to take for an oversight, so it has its own case at
 * the mount rather than only in a docblock.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule and
// for the reason `ConditionBuilder.mountRoots.test.tsx` states: the lint and
// the scope introspection both run behind a dynamic
// `import('@objectstack/formula')` inside `celAuthoring`, and a cold first load
// has been measured near a `waitFor`'s whole budget. The specifier must match
// `loadFormula`'s exactly — ESM caches by resolved specifier.
import '@objectstack/formula';

// objectui#4697 — this inspector calls `useObjectFields(objectName)` /
// `useObjectOptions()` unconditionally, so a mount-time fetch would escape to
// the real network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { usePredicateRecordContext } from '@object-ui/react';
import { buildExpressionScope } from '../../../providers/ExpressionProvider';
import { CLIENT_CONDITION_ROOTS, RECORD_CONDITION_ROOTS } from './ConditionBuilder';
import { ActionDefaultInspector } from './ActionDefaultInspector';
import { conditionRootsForMetadataType } from '../conditionScope';
import { lintCelPredicate } from '../celAuthoring';

afterEach(cleanup);

/** `CelPredicateField` renders its editor as a combobox TEXTAREA. */
function rawEditorIn(root: HTMLElement): HTMLTextAreaElement {
  fireEvent.click(within(root).getByText('Expression'));
  return within(root)
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

/** A builder's own root, located by its label — this inspector mounts two. */
function builderLabelled(label: string): HTMLElement {
  return screen.getByText(label).parentElement!.parentElement! as HTMLElement;
}

/** The LABEL of each open suggestion — the first span; the second is its kind tag. */
function offeredLabels(): string[] {
  return screen
    .queryAllByRole('option')
    .map((o) => (o.querySelector('span')?.textContent ?? '').trim());
}

/**
 * The shortest prefix that REACHES `root` — derived from the root itself.
 *
 * `filterCandidates` excludes an exact match, so asking for `os` would prove
 * nothing whatever the editor offers. Computing the prefix instead of tabling
 * it is what lets the cases below loop over the advertised list rather than
 * carry a second copy of it keyed by hand.
 */
const prefixFor = (root: string) => root.slice(0, Math.max(1, Math.min(3, root.length - 1)));

/**
 * Prove the suggestion machinery works in THIS render, then hand back the box.
 *
 * ⚠️ Load-bearing, not politeness. The identifier catalog arrives
 * asynchronously and a menu that has not opened YET offers nothing — which
 * would satisfy every "is not offered" assertion below no matter what the
 * editor advertises. `record` is the root every arm of this file keeps, so
 * completing it is the warm-up that cannot beg any question under test.
 */
async function warmedEditor(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<HTMLTextAreaElement> {
  const box = rawEditorIn(builderLabelled(label));
  await user.click(box);
  await user.type(box, 'rec');
  expect(await screen.findByRole('option', { name: /record/ }, { timeout: 4000 })).toBeTruthy();
  return box;
}

/** What a warmed editor offers for `prefix`. */
async function offeredFor(
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLTextAreaElement,
  prefix: string,
): Promise<string[]> {
  await user.clear(box);
  await user.type(box, prefix);
  return offeredLabels();
}

function ActionHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'approve',
    label: 'Approve',
    type: 'script',
    objectName: 'invoice',
  });
  return (
    <ActionDefaultInspector
      type="action"
      name="approve"
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale={'en-US' as never}
    />
  );
}

/** Renders the real hook so its binding is MEASURED rather than quoted. */
function RecordBindingProbe({ onRead }: { onRead: (keys: string[]) => void }) {
  const bag = usePredicateRecordContext({ id: 'inv-1', status: 'open' });
  onRead(Object.keys(bag));
  return null;
}

function recordContextKeys(): string[] {
  let keys: string[] = [];
  render(<RecordBindingProbe onRead={(k) => { keys = k; }} />);
  cleanup();
  return keys;
}

/* ── The advertised list, read against its producers ───────────────────── */

describe('CLIENT_CONDITION_ROOTS ↔ what a browser host binds (objectui#9856)', () => {
  it('is exactly the two producers’ union — rebuilt here, never retyped', () => {
    // The whole list, derived: the row binding comes from the real hook (a
    // probe render, so the measurement is of the code and not of a sentence
    // about it) and the ambient roots are the keys the shell's own scope
    // builder returns. A binding added or removed on either side reddens here,
    // which is the failure mode a hand-copied list cannot have.
    const bound = [...recordContextKeys(), ...Object.keys(buildExpressionScope())];
    expect([...CLIENT_CONDITION_ROOTS].sort()).toEqual([...bound].sort());
  });

  it('advertises no root the record scope REFUSES — every member lints clean', async () => {
    // The objectui#8167 direction, and the reason this list is not simply "what
    // the host binds": a root this editor offers that its own linter rejects
    // costs the author the write, which is strictly worse than the offer this
    // card restores. Derived from the list, so a member added tomorrow is
    // linted tomorrow.
    for (const root of CLIENT_CONDITION_ROOTS) {
      const issues = await lintCelPredicate(`${root}.status == 'done'`, { scope: 'record' });
      expect(
        issues.filter((i) => i.severity === 'error'),
        `advertised root "${root}" must be accepted at scope record`,
      ).toEqual([]);
    }
  });

  it('really is wider than the default it replaces — otherwise the mounts below prove nothing', () => {
    // Non-vacuity. Both cases above would pass against a list that said exactly
    // what `RECORD_CONDITION_ROOTS` says, and so would every "offers X" case at
    // the mount if X happened to be `record`.
    expect(CLIENT_CONDITION_ROOTS.filter((r) => !RECORD_CONDITION_ROOTS.includes(r)).length)
      .toBeGreaterThan(0);
  });

  it('drops `previous`, and neither producer binds it', () => {
    // The narrowing half, derived from the same two producers rather than
    // asserted. `previous` is bound by the SERVER hosts of a record-scoped
    // condition, which is why the default carries it; offering it where nothing
    // answers it is the `app` shape objectui#8155 ruled on.
    const bound = [...recordContextKeys(), ...Object.keys(buildExpressionScope())];
    expect(bound).not.toContain('previous');
    expect(CLIENT_CONDITION_ROOTS).not.toContain('previous');
    // …and it IS in the default, so this is a real difference and not a shared
    // absence that would hold however the two lists were written.
    expect(RECORD_CONDITION_ROOTS).toContain('previous');
  });
});

/* ── The mounts — an action's `visible` / `disabled` ───────────────────── */

describe('ActionDefaultInspector — the browser-evaluated mounts offer what they bind (objectui#9856)', () => {
  for (const label of ['Visible when', 'Disabled when'] as const) {
    it(`offers every advertised root in "${label}"`, async () => {
      // THE CASE THIS CARD IS FOR. Before the declaration these two mounts
      // forwarded no `roots`, so `scope="record"` narrowed them to the set
      // every host binds and an author lost `user.*` / `os.*` from the dropdown
      // while the host that runs the predicate really does bind them. The loop
      // is over the advertised list itself, so a root added to it has to be
      // reachable at the mount before this stays green.
      const user = userEvent.setup();
      render(<ActionHarness />);
      const box = await warmedEditor(user, label);
      for (const root of CLIENT_CONDITION_ROOTS) {
        expect(await offeredFor(user, box, prefixFor(root)), `"${root}" at "${label}"`)
          .toContain(root);
      }
    });
  }

  it('still withholds `previous`, which no browser host answers', async () => {
    // The narrowing, at the mount. A root the editor offers and the evaluator
    // leaves unbound builds a predicate that can only fault, and this is the
    // one root this declaration takes away — so it is pinned where an author
    // would meet it, not only where it is declared.
    const user = userEvent.setup();
    render(<ActionHarness />);
    const box = await warmedEditor(user, 'Visible when');
    expect(await offeredFor(user, box, prefixFor('previous'))).not.toContain('previous');
  });
});

/* ── The table's third derivation, at its own seam ─────────────────────── */

describe('conditionRootsForMetadataType — the per-type derivation (objectui#9856)', () => {
  it('hands back the advertised list ITSELF for a client-evaluated type', () => {
    // Identity, not equality: a second list that merely looks the same is the
    // drift this codebase has already paid for at three other controls.
    expect(conditionRootsForMetadataType('action')).toBe(CLIENT_CONDITION_ROOTS);
  });

  it('declares nothing for a server-evaluated type, and nothing for an unmeasured one', () => {
    // The must-not-widen half. `undefined` leaves the builder's record-scoped
    // default exactly where objectui#9645 put it, so the narrowing this card
    // does not touch cannot leak away through the new member.
    expect(conditionRootsForMetadataType('hook')).toBeUndefined();
    expect(conditionRootsForMetadataType('validation')).toBeUndefined();
    expect(conditionRootsForMetadataType('page')).toBeUndefined();
    expect(conditionRootsForMetadataType('a-type-this-build-never-heard-of')).toBeUndefined();
  });
});
