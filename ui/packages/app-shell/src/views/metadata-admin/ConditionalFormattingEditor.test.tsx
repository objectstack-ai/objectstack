// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { evalRowPredicate } from '@object-ui/core';
import {
  ConditionalFormattingEditor,
  normalizeRule,
  ROW_PREDICATE_ROOTS,
  type ConditionalFormattingRuleDraft,
} from './ConditionalFormattingEditor';
import { __setCelFormulaLoader } from './celAuthoring';
import { buildExpressionScope } from '../../providers/ExpressionProvider.js';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

const t = (k: string) => k;

/** Controlled harness — holds the rule list so edits round-trip. */
function Harness({ initial = [] as any[] }: { initial?: any[] }) {
  const [rules, setRules] = React.useState<any[]>(initial);
  return (
    <div>
      <ConditionalFormattingEditor
        rules={rules}
        onChange={setRules as (r: ConditionalFormattingRuleDraft[]) => void}
        objectName="invoice"
        fieldNames={['status', 'amount']}
        t={t}
      />
      <pre data-testid="state">{JSON.stringify(rules)}</pre>
    </div>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent || '[]');

describe('normalizeRule', () => {
  it('passes a spec { condition, style } rule through', () => {
    expect(normalizeRule({ condition: "record.status == 'x'", style: { backgroundColor: '#fee' } })).toEqual({
      condition: "record.status == 'x'",
      style: { backgroundColor: '#fee' },
    });
  });

  it('unwraps a { dialect, source } condition envelope', () => {
    expect(
      normalizeRule({ condition: { dialect: 'cel', source: 'record.amount > 100' } as any, style: {} }),
    ).toEqual({ condition: 'record.amount > 100', style: {} });
  });

  it('translates a legacy { field, operator, value } rule to CEL + folds color props', () => {
    expect(
      normalizeRule({ field: 'status', operator: 'equals', value: 'overdue', backgroundColor: '#f00', textColor: '#fff' }),
    ).toEqual({
      condition: `record["status"] == "overdue"`,
      style: { backgroundColor: '#f00', color: '#fff' },
    });
  });

  it('translates the `in` operator', () => {
    expect(normalizeRule({ field: 'tier', operator: 'in', value: ['a', 'b'] }).condition).toBe(
      `record["tier"] in ["a", "b"]`,
    );
  });

  it('reads the ObjectUI `expression` shape', () => {
    expect(normalizeRule({ expression: 'record.x == 1', backgroundColor: 'red' })).toEqual({
      condition: 'record.x == 1',
      style: { backgroundColor: 'red' },
    });
  });
});

describe('ConditionalFormattingEditor', () => {
  it('shows the empty state and adds a rule', () => {
    render(<Harness />);
    expect(screen.getByText('engine.inspector.view.cf.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cf-add'));
    expect(screen.getByTestId('cf-rule-0')).toBeInTheDocument();
    expect(state()).toEqual([{ condition: '', style: {} }]);
  });

  it('edits the CEL condition', () => {
    render(<Harness initial={[{ condition: '', style: {} }]} />);
    const ta = document.getElementById('cf-condition-0') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "record.status == 'overdue'" } });
    expect(state()[0].condition).toBe("record.status == 'overdue'");
  });

  it('sets a background color into style', () => {
    render(<Harness initial={[{ condition: 'record.x == 1', style: {} }]} />);
    const rule = screen.getByTestId('cf-rule-0');
    const bg = rule.querySelectorAll('input[placeholder="#RRGGBB"]')[0] as HTMLInputElement;
    fireEvent.change(bg, { target: { value: '#fee2e2' } });
    expect(state()[0].style).toEqual({ backgroundColor: '#fee2e2' });
  });

  it('clearing a color removes the style key', () => {
    render(<Harness initial={[{ condition: 'record.x == 1', style: { backgroundColor: '#fee2e2' } }]} />);
    const rule = screen.getByTestId('cf-rule-0');
    const bg = rule.querySelectorAll('input[placeholder="#RRGGBB"]')[0] as HTMLInputElement;
    fireEvent.change(bg, { target: { value: '' } });
    expect(state()[0].style).toEqual({});
  });

  it('removes a rule', () => {
    render(<Harness initial={[{ condition: 'a', style: {} }, { condition: 'b', style: {} }]} />);
    fireEvent.click(screen.getByTestId('cf-remove-0'));
    expect(state().map((r: any) => r.condition)).toEqual(['b']);
  });

  it('reorders rules (first-match-wins order matters)', () => {
    render(<Harness initial={[{ condition: 'a', style: {} }, { condition: 'b', style: {} }]} />);
    fireEvent.click(screen.getByTestId('cf-down-0'));
    expect(state().map((r: any) => r.condition)).toEqual(['b', 'a']);
    fireEvent.click(screen.getByTestId('cf-up-1'));
    expect(state().map((r: any) => r.condition)).toEqual(['a', 'b']);
  });

  it('normalizes a legacy native rule when rendered (upgrades in place on edit)', () => {
    render(<Harness initial={[{ field: 'status', operator: 'equals', value: 'x', backgroundColor: '#f00' }]} />);
    const ta = document.getElementById('cf-condition-0') as HTMLTextAreaElement;
    expect(ta.value).toBe(`record["status"] == "x"`);
    // an edit commits the normalized { condition, style } shape
    fireEvent.change(ta, { target: { value: "record.status == 'x'" } });
    expect(state()[0]).toEqual({ condition: "record.status == 'x'", style: { backgroundColor: '#f00' } });
  });
});

describe('ConditionalFormattingEditor · CEL authoring scope (#2571 follow-up)', () => {
  it('flags a BARE field condition with the record.<field> fix — the row binds only record.*', async () => {
    render(<Harness initial={[{ condition: "status == 'overdue'", style: {} }]} />);
    // TURNED, deliberately (objectui#7727). This pin used to assert the
    // opposite — "the real engine must accept the bare form (evalRowPredicate
    // spreads the row)" — and its own comment predicted this edit: "flipping
    // this editor to scope=\"record\" would break this test". objectui#5741
    // (Phase 2 of the objectui#5330 canon) retired the bare shorthand on
    // runtime record surfaces, so `evalRowPredicate` no longer spreads the row
    // and `status == 'overdue'` faults with `Unknown variable: status`. The
    // editor must say so at authoring time rather than lint it clean; the
    // runtime half of this claim is pinned in the contract suite below.
    expect(await screen.findByText(/record\.status/, {}, { timeout: 3000 })).toBeTruthy();
    const ta = document.getElementById('cf-condition-0') as HTMLTextAreaElement;
    await waitFor(() => expect(ta.getAttribute('aria-invalid')).toBe('true'), { timeout: 3000 });
  });

  it('still lints a canonical record.<field> condition clean', async () => {
    render(<Harness initial={[{ condition: "record.status == 'overdue'", style: {} }]} />);
    // The other half of the narrowing: the scope flip must reject the retired
    // spelling WITHOUT rejecting the canonical one.
    expect(await screen.findByText('perm.cel.valid', {}, { timeout: 3000 })).toBeTruthy();
    const ta = document.getElementById('cf-condition-0') as HTMLTextAreaElement;
    expect(ta.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('lints EVERY advertised root clean in the record scope — the aligned state', async () => {
    // Before objectui#8155 this could only claim FOUR of five advertised roots:
    // `app` was advertised and REFUSED, so a comment saying "every advertised
    // root" would have contradicted its own neighbour. The ruling removed `app`
    // and added `os`, so what this editor advertises is now a subset of what
    // `@objectstack/formula`'s SCOPE_ROOTS accepts, and the honest assertion is
    // the total one.
    //
    // DERIVED from the advertised list rather than retyped: a root added here
    // without the engine knowing it reddens on this line, which is the whole
    // failure mode objectui#8155 was filed for.
    const condition = ROW_PREDICATE_ROOTS.map((r) =>
      r === 'record' ? "record.status != ''" : `size(${r}) >= 0`,
    ).join(' && ');
    render(<Harness initial={[{ condition, style: {} }]} />);
    expect(await screen.findByText('perm.cel.valid', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('a `data.*` condition is ACCEPTED but no longer SILENT — the author gets a warning (objectui#8972)', async () => {
    // This pin used to assert an unbroken silence, and said it would redden
    // "when the acceptance is fixed". Read that literally: the acceptance is
    // NOT fixed here. `@objectstack/formula`'s `SCOPE_ROOTS` still lists
    // `data`, so the engine still waves this through with zero findings, and
    // narrowing that set remains the producer-side half (objectui#8166's
    // ruling). What objectui#8972 changed is the other half of the defect —
    // the ABSENCE of any diagnostic — by wiring `@object-ui/core`'s
    // `detectNonCanonicalRowSpelling` into `celAuthoring` as a WARNING.
    //
    // So the two halves are now asserted separately, and the split is the
    // point: the accept set is untouched (no error, `aria-invalid` unset, the
    // editor's own error count unchanged, save open), while the author is told
    // at typing time instead of at misbehaviour time. The runtime half is
    // pinned in the contract suite below, where the same predicate against the
    // same host bag evaluates to FALSE.
    render(<Harness initial={[{ condition: "data.status == 'overdue'", style: {} }]} />);
    // The advisory is objectui's own sentence ("… Re-root the reference on
    // `record`."), read through the editor's `t` (objectui#10862); this
    // harness's `t` echoes the key, as it does for `perm.cel.valid`.
    expect(
      await screen.findByText('engine.celLint.notTheRow', {}, { timeout: 3000 }),
    ).toBeTruthy();
    // ACCEPT SET UNCHANGED — the falsifiable half. Promoting the advisory to
    // an error reddens both of these.
    const ta = document.getElementById('cf-condition-0') as HTMLTextAreaElement;
    expect(ta.getAttribute('aria-invalid')).not.toBe('true');
    // `border-destructive` is applied from the same `errors.length > 0` the
    // Save gate counts, so its absence is the editor's own "no blocking issue".
    expect(ta.className).not.toMatch(/border-destructive/);
  });

  it('ALIGNED (objectui#8155) — `app` is neither advertised nor bound, and the lint refuses it', async () => {
    // This pin used to assert a CONTRADICTION on purpose: the editor advertised
    // `app` while its own linter refused it, offering the nonsense remedy
    // `record.app` and no spelling an author could use instead. The 2026-09-07
    // ruling took option B — objectui aligns to the engine's root vocabulary,
    // rather than the engine growing a root to match this consumer — so the
    // contradiction no longer exists and this pin asserts the ALIGNED state.
    //
    // ⭐ Deliberately THREE-sided, because the defect was a DISAGREEMENT
    // between two producers and a one-sided pin would be half a pin. Each
    // producer drifting back ON ITS OWN must redden here:
    //   - `app` back in ROW_PREDICATE_ROOTS   -> the first expect fails
    //   - `app` back in buildExpressionScope  -> the second expect fails
    //   - the engine growing an `app` root    -> the DOM assertion fails
    // The closure assertion in the contract suite below catches the pair
    // moving TOGETHER; it cannot see either half moving alone, which is
    // exactly the state objectui#8155 was filed about.
    expect(ROW_PREDICATE_ROOTS).not.toContain('app');
    expect(Object.keys(buildExpressionScope({ user: { id: 'u1' } }))).not.toContain('app');

    // The third side. The refusal itself is unchanged — what changed is that it
    // is now CORRECT: nothing advertises `app`, nothing binds it, and the
    // engine does not know it, so an author is never lured into writing it.
    render(<Harness initial={[{ condition: "app.name == 'crm'", style: {} }]} />);
    const ta = document.getElementById('cf-condition-0') as HTMLTextAreaElement;
    await waitFor(() => expect(ta.getAttribute('aria-invalid')).toBe('true'), { timeout: 3000 });
    expect(screen.getByText(/bare reference/)).toBeTruthy();
  });

  it('still flags an unknown record.<field> with did-you-mean', async () => {
    render(<Harness initial={[{ condition: "record.statu == 'x'", style: {} }]} />);
    expect(await screen.findByText(/did you mean/i, {}, { timeout: 3000 })).toBeTruthy();
  });

  it('advertises runtime-bound roots and withholds unbound engine roots', async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        // The engine's default advertisement — the editor's roots override
        // must win over it (introspectCelScope: hint.roots ?? engine roots).
        introspectScope: () => ({
          fields: ['status', 'amount'],
          roots: ['record', 'previous', 'input', 'os', 'current_user', 'user', 'vars'],
          functions: [],
        }),
      }),
    );
    const user = userEvent.setup();
    render(<Harness initial={[{ condition: '', style: {} }]} />);
    const ta = document.getElementById('cf-condition-0') as HTMLTextAreaElement;
    await user.click(ta);
    // `features` is bound at runtime (host predicate scope) — advertised.
    await user.type(ta, 'fea');
    expect(await screen.findByRole('option', { name: /features/ }, { timeout: 3000 })).toBeTruthy();
    // `vars` is an engine-default root NOT bound for row predicates — withheld.
    await user.clear(ta);
    await user.type(ta, 'va');
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByRole('option')).toBeNull();
  });
});

describe('ROW_PREDICATE_ROOTS ↔ evalRowPredicate runtime contract', () => {
  const u = { id: 'u1' };
  /**
   * The app-shell global predicate scope that hosts hand to the shared
   * row-predicate evaluator — READ FROM ITS PRODUCER, not modelled here.
   *
   * Why it is read rather than written out (objectui#7727). This block used to
   * carry a hand-written literal including `data: {}`, and probed every
   * advertised root with `size(<root>) >= 0`. For `data` that probe hit the
   * HOST's own empty object and never the row, so it was green whether or not
   * `data` named the row: a reading that could not fail, and therefore
   * indistinguishable from one that passed — the exact trap
   * `rowPredicateCanon.ts` documents for `data.*` on a record surface.
   *
   * Writing the bag out by hand is the same defect one level up: a literal
   * cannot disagree with the producer, so it silently absorbs any drift. It had
   * already drifted — the literal omitted `os`, which
   * `buildExpressionScope` really does bind, and an assertion below therefore
   * "proved" `os` unbound. Calling the producer is what makes these readings
   * able to fail: if `buildExpressionScope` gains or loses a root, the closure
   * assertion says so instead of quietly agreeing with itself.
   *
   * ⭐ There is no `app` here, and it could not be put back even by accident:
   * objectui#8155 removed `app` from `ExpressionScopeInput` as well as from the
   * returned bag, so passing one is a COMPILE error (TS2353, "'app' does not
   * exist in type 'ExpressionScopeInput'"). That is a third fence on the same
   * fact, and the only one that holds without the suite being run.
   *
   * ⭐ And no `data`, on the same terms, since objectui#8166 — this block
   * passed `data: {}` until that card, and the argument is now the same
   * compile error. See {@link CURATED_EXCLUSIONS} for what that closed.
   */
  const fullHostScope = buildExpressionScope({
    user: u,
    features: { beta: true },
  });
  /**
   * Roots the host binds that this editor deliberately does not advertise —
   * **empty since objectui#8166**, and that emptiness is the finding rather
   * than a tidy-up.
   *
   * It held exactly one member, `data`: retired on row surfaces by
   * objectui#5741 and therefore unadvertised here, yet still BOUND by
   * `buildExpressionScope`, so an authored `data.*` resolved against the host's
   * object instead of the row. objectui#8166 unbound it, so there is no longer
   * a root that this editor withholds while the host still answers it — the
   * advertised list and the host bag now describe the same set, which is what
   * the closing assertion of the next test measures.
   *
   * `os` used to sit here too. objectui#8155 ruled it back onto the advertised
   * list in the same patch that removed `app`: it is bound here, ACCEPTED by
   * the engine, and the measured in-tree identity spelling
   * (`record.owner == os.user.id`), so withholding it was curation with
   * nothing behind it.
   *
   * ⛔ Kept as a (now empty) list rather than deleted, deliberately: the
   * derivation below is the fence that catches a NEW host root arriving
   * unadvertised, and collapsing it to `hostScope = fullHostScope` would
   * quietly retire that fence along with its last entry.
   */
  const CURATED_EXCLUSIONS: string[] = [];
  /**
   * The same bag with those removed. Probes for the ADVERTISED roots run
   * against this one, so no probe can pass off a host binding as a row binding.
   */
  const hostScope = Object.fromEntries(
    Object.entries(fullHostScope).filter(([k]) => !CURATED_EXCLUSIONS.includes(k)),
  );
  const row = { id: 'r1', status: 'overdue' };

  /** Advertised roots the HOST binds — derived, never typed out. */
  const HOST_BOUND_ROOTS = Object.keys(fullHostScope).filter((k) => !CURATED_EXCLUSIONS.includes(k));

  it('binds the row as `record`, and it is the ROW rather than a host `record`', () => {
    // No host scope at all: only the row can be supplying `record`.
    expect(evalRowPredicate("record.status == 'overdue'", row, { fallback: false })).toBe(true);
    // And the row still wins over a host scope carrying its own `record`
    // (listConditional.ts pins `record` AFTER the spread).
    expect(
      evalRowPredicate("record.status == 'overdue'", row, {
        fallback: false,
        scope: { ...hostScope, record: { status: 'paid' } },
      }),
    ).toBe(true);
  });

  it('every OTHER advertised root is bound by the HOST — and unbound without it', () => {
    for (const root of ROW_PREDICATE_ROOTS) {
      if (root === 'record') continue;
      expect(HOST_BOUND_ROOTS, `advertised root "${root}" is unaccounted for`).toContain(root);
      expect(
        evalRowPredicate(`size(${root}) >= 0`, row, { fallback: false, scope: hostScope }),
        `root "${root}" should be bound by the host scope`,
      ).toBe(true);
      // The half that makes the line above a reading: drop the host scope and
      // the root must go unbound. Without this, a root bound by nothing in
      // particular would still pass.
      expect(
        evalRowPredicate(`size(${root}) >= 0`, row, { fallback: false }),
        `root "${root}" must come from the HOST scope, not from thin air`,
      ).toBe(false);
    }
    // ...and no member escapes the two assertions above by not being checked.
    // Both sides are derived: the left from the editor, the right from
    // `buildExpressionScope` minus the curated exclusions. Drift on either
    // side — a root added to the host bag, a root added to or dropped from the
    // advertised list — reddens here.
    expect([...ROW_PREDICATE_ROOTS].sort()).toEqual([...HOST_BOUND_ROOTS, 'record'].sort());
  });

  it('a BARE field ref no longer names the row — the editor ERROR matches the runtime', () => {
    // The runtime half of the flipped authoring pin above (objectui#5741).
    expect(evalRowPredicate("record.status == 'overdue'", row, { fallback: false, scope: hostScope })).toBe(true);
    expect(evalRowPredicate("status == 'overdue'", row, { fallback: false, scope: hostScope })).toBe(false);
  });

  it('`data` is RETIRED: unadvertised HERE and no longer bound by the host either', () => {
    expect(ROW_PREDICATE_ROOTS).not.toContain('data');
    // ⭐ objectui#8166 flipped this reading, and the flip is the point.
    //
    // Until that card the host DID carry an ambient `data`, so this probe
    // answered TRUE: the root resolved, against the host's own object, while
    // the row was not reachable through it at all. An author got a green lint,
    // a resolving predicate, and an answer from the wrong layer.
    //
    // This is `buildExpressionScope`'s own output rather than a model of it, so
    // the assertion tracks the producer: `data` restored to that bag reddens
    // here.
    const ambient = fullHostScope;
    expect(evalRowPredicate('size(data) >= 0', row, { fallback: false, scope: ambient })).toBe(false);
    // The canonical spelling against the SAME scope, so the two differ only in
    // the spelling — and it is the one that reaches the row.
    expect(evalRowPredicate("record.status == 'overdue'", row, { fallback: false, scope: ambient })).toBe(true);
    expect(evalRowPredicate("data.status == 'overdue'", row, { fallback: false, scope: ambient })).toBe(false);
    // ⚠️ What objectui#8166 did NOT close: the authoring pin above (a `data.*`
    // condition still lints CLEAN at `scope: 'record'`) is still green, because
    // the accept set is `@objectstack/formula`'s `SCOPE_ROOTS` and splitting it
    // per scope is the producer-side half, in another repo. The consumer half
    // is what changed: the predicate no longer RESOLVES, it faults with the
    // engine's own `Unknown variable: data`.
  });

  it('the engine-default extras stay unadvertised because they are NOT bound', () => {
    // `os` is NOT in this list: it is genuinely bound, and since objectui#8155
    // it is advertised too, so asserting it here would be the same hand-model
    // artefact as the old `data` probe, in the opposite direction.
    for (const root of ['previous', 'input', 'vars']) {
      expect(ROW_PREDICATE_ROOTS).not.toContain(root);
      expect(
        evalRowPredicate(`size(${root}) >= 0`, row, { fallback: false, scope: hostScope }),
        `root "${root}" should NOT be bound at runtime`,
      ).toBe(false);
    }
  });

  it('`os` is ADVERTISED — bound here, and known to the engine (objectui#8155)', () => {
    // The mirror image of the `app` case, settled the other way by the same
    // ruling: `app` was advertised-but-refused, `os` was accepted-and-bound but
    // never offered — the one root an author could legitimately write and would
    // never be shown.
    //
    // The bag here is `buildExpressionScope`'s own output, NOT a scope with
    // `os` handed in by this test: injecting it would only have proved that
    // `evalRowPredicate` forwards `scope`, which `size(zzz) >= 0` with `zzz`
    // injected proves just as well. Reading the producer is what makes this a
    // statement about app-shell.
    expect(Object.keys(fullHostScope)).toContain('os');
    expect(ROW_PREDICATE_ROOTS).toContain('os');
    expect(CURATED_EXCLUSIONS).not.toContain('os');
    expect(evalRowPredicate('size(os) >= 0', row, { fallback: false, scope: hostScope })).toBe(true);
    // The control that makes the line above a reading: a root the host bag does
    // NOT carry is unbound against the very same scope.
    expect(evalRowPredicate('size(zzz) >= 0', row, { fallback: false, scope: hostScope })).toBe(false);
  });
});
