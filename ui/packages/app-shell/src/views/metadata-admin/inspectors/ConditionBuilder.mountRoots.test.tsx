// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ConditionBuilder`'s raw CEL editor must ADVERTISE the roots its mount site
 * binds — objectui#9645, the sibling half of objectui#8167.
 *
 * ## The defect these cases reproduce
 *
 * objectui#8167 made the editor LINT in the mount's scope. It did not make the
 * autocomplete agree: the mount forwarded no `roots` override, so it offered
 * whatever `introspectScope` advertises for that scope — every root ANY
 * predicate site may see. A hook `condition` is evaluated by objectstack's
 * hook wrapper against `{ record: record ?? {}, previous }`, and an
 * unevaluable condition throws `HookConditionError` rather than resolving
 * false (objectstack#4775, fail-LOUD on purpose). So the editor offered
 * `os.user.id`, the lint endorsed it — the accept set is the engine's
 * `SCOPE_ROOTS`, which carries `os` / `current_user` / `vars` at this scope —
 * and the author's write paid for it at runtime.
 *
 * ## Real engine, on purpose
 *
 * Like `ConditionBuilder.mountScope.test.tsx`, and for the same reason: the
 * question under test is what the ENGINE was asked and what the editor did
 * with the answer. A stub would let the suite stay green while the production
 * path asked for the whole default list.
 *
 * ## The pins are DERIVED, not retyped
 *
 * The advertised list is compared against `introspectCelScope`'s own answer
 * rather than against a copy of it, so the reading fails when either side
 * moves: a root added to {@link RECORD_CONDITION_ROOTS} that the engine does
 * not accept, or an engine that grows a root at this scope which nobody has
 * yet decided is bound here.
 *
 * ## The conflation this file also fences
 *
 * `ConditionBuilder` carries a SECOND roots concept, {@link REFERENCE_ROOTS} —
 * the roots a value typed into the VALUE BOX may plainly reference instead of
 * being quoted as literal text. The two populations overlap and do not
 * coincide: the value-box list carries roots the engine's record scope does
 * not advertise at all. A case below states that in the engine's own terms, so
 * merging the two lists reddens here rather than quietly re-advertising roots
 * nothing binds.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule: the
// lint and the scope introspection both run behind a dynamic
// `import('@objectstack/formula')` inside `celAuthoring`, and a cold first load
// has been measured near a `waitFor`'s whole budget. The specifier must match
// `loadFormula`'s exactly — ESM caches by resolved specifier.
import '@objectstack/formula';

// objectui#4697 — these inspectors call `useObjectFields(objectName)`
// unconditionally, so a mount-time fetch would escape to the real network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder, RECORD_CONDITION_ROOTS, REFERENCE_ROOTS } from './ConditionBuilder';
import { HookDefaultInspector } from './HookDefaultInspector';
import { introspectCelScope, lintCelPredicate } from '../celAuthoring';

afterEach(cleanup);

/** `CelPredicateField` renders its editor as a combobox TEXTAREA. */
function rawEditorIn(root: HTMLElement): HTMLTextAreaElement {
  fireEvent.click(within(root).getByText('Expression'));
  return within(root)
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

/** A builder's own root, located by its label — inspectors mount several. */
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
 * Type `prefix` into a warmed editor and read what it offers.
 *
 * ⚠️ The warm-up is load-bearing, not politeness. The identifier catalog
 * arrives asynchronously, and a menu that has not opened YET offers nothing —
 * which would satisfy every "is not offered" assertion below no matter what
 * the editor advertises. So each reading first proves the machinery works in
 * THIS render by completing a root that must survive, and only then asks the
 * question the case is about.
 */
async function offeredAfterTyping(
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLTextAreaElement,
  prefix: string,
): Promise<string[]> {
  await user.clear(box);
  await user.click(box);
  await user.type(box, 'rec');
  expect(await screen.findByRole('option', { name: /record/ }, { timeout: 4000 })).toBeTruthy();
  await user.clear(box);
  await user.type(box, prefix);
  return offeredLabels();
}

/* ── The advertised list, read against its producers ───────────────────── */

describe('RECORD_CONDITION_ROOTS ↔ the engine (objectui#9645)', () => {
  it('advertises only roots the record scope ACCEPTS — every one lints clean', async () => {
    // Derived from the list rather than retyped: a root added to it that the
    // engine refuses reddens here, which is the `app` failure objectui#8155
    // was filed for, one component over.
    for (const root of RECORD_CONDITION_ROOTS) {
      const issues = await lintCelPredicate(`${root}.status == 'done'`, { scope: 'record' });
      expect(
        issues.filter((i) => i.severity === 'error'),
        `advertised root "${root}" must be accepted at scope record`,
      ).toEqual([]);
    }
  });

  it('drops exactly the engine extras no host of a record-scoped condition binds', async () => {
    // Both sides derived: the left from `introspectCelScope` (the same call the
    // editor makes), the right from the advertised list. The named set is the
    // FINDING, not a snapshot — `os` / `current_user` / `user` are bound only
    // by app-shell's client evaluator (`buildExpressionScope`), `input` and
    // `vars` by neither side, and the hook wrapper binds `record` and
    // `previous` alone. An engine that grows a root at this scope reddens here
    // so that it is triaged before it reaches an author.
    const engineAdvertised = (await introspectCelScope({ scope: 'record' })).roots;
    expect(engineAdvertised, 'the engine still advertises the roots this list narrows').toEqual(
      expect.arrayContaining([...RECORD_CONDITION_ROOTS]),
    );
    const dropped = engineAdvertised.filter((r) => !RECORD_CONDITION_ROOTS.includes(r));
    expect([...dropped].sort()).toEqual(['current_user', 'input', 'os', 'user', 'vars']);
  });

  it('is NOT the value-box population — merging the two would advertise the unadvertisable', async () => {
    // The conflation hazard, stated in the engine's own terms. `REFERENCE_ROOTS`
    // decides whether a typed VALUE is a reference or literal text, and carries
    // roots this scope does not advertise at all (`org`, `parent`). Both sides
    // derived, so this holds without naming which roots those are today.
    const engineAdvertised = (await introspectCelScope({ scope: 'record' })).roots;
    const unadvertisable = REFERENCE_ROOTS.filter((r) => !engineAdvertised.includes(r));
    expect(unadvertisable.length, 'the two lists would coincide — re-read both docblocks').toBeGreaterThan(0);
    for (const root of unadvertisable) {
      expect(RECORD_CONDITION_ROOTS, `"${root}" is a value-box root, not an advertisable one`).not.toContain(root);
    }
  });
});

/* ── Mount — a hook's `condition`, the surface the card was filed on ───── */

function HookHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'stamp',
    label: 'Stamp',
    object: 'invoice',
    events: ['beforeInsert'],
  });
  return (
    <HookDefaultInspector
      type="hook"
      name="stamp"
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale={'en-US' as never}
    />
  );
}

describe('HookDefaultInspector — the autocomplete stops offering what the server never binds', () => {
  // Typed as PREFIXES: `filterCandidates` excludes an exact match, so asking
  // for `os` would prove nothing. Each prefix below is the shortest one that
  // reaches its root.
  for (const [prefix, root] of [
    ['o', 'os'],
    ['cur', 'current_user'],
    ['us', 'user'],
    ['var', 'vars'],
    ['in', 'input'],
  ] as const) {
    it(`does not offer \`${root}\` in a hook condition`, async () => {
      const user = userEvent.setup();
      render(<HookHarness />);
      const box = rawEditorIn(builderLabelled('Run only when (optional CEL)'));
      expect(await offeredAfterTyping(user, box, prefix)).not.toContain(root);
    });
  }

  it('still offers `record` and `previous` — the two the hook wrapper binds', async () => {
    // The must-not-break half of any narrowing. `previous` is the transition
    // idiom objectui#8167 kept reachable in this scope; withdrawing it here
    // would take it away in the one place the server really binds it.
    const user = userEvent.setup();
    render(<HookHarness />);
    const box = rawEditorIn(builderLabelled('Run only when (optional CEL)'));
    expect(await offeredAfterTyping(user, box, 'prev')).toContain('previous');
    expect(await offeredAfterTyping(user, box, 'rec')).toContain('record');
  });
});

/* ── Control & escape hatch ────────────────────────────────────────────── */

function BareBuilderHarness(props: { scope?: 'record' | 'flattened'; roots?: string[] }) {
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

describe('mounts that declare no `scope` are unchanged (objectui#9645)', () => {
  it('still offers the engine’s own advertisement, `os` included', async () => {
    // "Unchanged" is the load-bearing half here as it was on objectui#8167: a
    // mount that makes no scope claim makes no roots claim either, and must
    // forward `undefined` so `celAuthoring` answers exactly what it answered
    // before this prop existed. A default applied to every mount reddens here.
    const user = userEvent.setup();
    render(<BareBuilderHarness />);
    const box = rawEditorIn(builderLabelled('Condition'));
    expect(await offeredAfterTyping(user, box, 'o')).toContain('os');
  });
});

describe('a mount that binds more DECLARES it (objectui#9645)', () => {
  it('a caller-supplied `roots` list wins over the record-scope default', async () => {
    // The restoration path for the client-evaluated mounts, proven rather than
    // promised: `buildExpressionScope` really does bind `os` for predicates
    // evaluated in the browser, and this is the one line such a mount needs.
    const user = userEvent.setup();
    render(<BareBuilderHarness scope="record" roots={['record', 'os']} />);
    const box = rawEditorIn(builderLabelled('Condition'));
    expect(await offeredAfterTyping(user, box, 'o')).toContain('os');
  });
});
