/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * filterVisibleParams — action params gated by a `visible` CEL predicate
 * (evaluated against the features/user/app/data scope). Fixes the create-user
 * form offering a `phoneNumber` field the default backend rejects: the param is
 * `visible: 'features.phoneNumber == true'`, so it's hidden unless the opt-in
 * phoneNumber auth plugin is loaded.
 *
 * Since objectui#4640 the gate evaluates on the canonical `evalRowPredicate`
 * entry: one dialect answer, faults fail-OPEN and are reported once with the
 * action and param named. The four blocks below the render tests carry that
 * contract — including the one outcome the change knowingly traded (an ABSENT
 * feature key faults on CEL, so it now shows the param instead of hiding it,
 * and `has()` is the portable spelling that keeps the old outcome).
 *
 * ActionParamDialog render tests — the dialog routes every param through the
 * shared form field-widget renderer (ADR-0059), so these pin the behavior
 * contract across the swap: each type renders its real widget (lazy, behind
 * Suspense), values round-trip through `resolve`, and `required` validation
 * still blocks submit.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';
import { validateActionParams } from '@objectstack/spec/ui';
import { ActionParamDialog, filterVisibleParams, serializeParamValues } from './ActionParamDialog';
import { expectedParamShape, classifyValueShape } from '../utils/paramValueShape';

const p = (name: string, visible?: string): ActionParamDef => ({
  name,
  label: name,
  type: 'text',
  ...(visible ? { visible } : {}),
});

/**
 * Capture the `console.warn` lines one call emits. Every case below uses its
 * OWN predicate text: the fault report is warn-once per (label, predicate) in
 * `evalRowPredicate`, so cases sharing a predicate string would silence each
 * other and the suite would pass or fail by file order.
 */
function withWarnings<T>(run: () => T): { result: T; warnings: string[] } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = run();
    return { result, warnings: spy.mock.calls.map((c) => String(c[0])) };
  } finally {
    spy.mockRestore();
  }
}

describe('filterVisibleParams', () => {
  it('keeps params that have no visible predicate', () => {
    const params = [p('email'), p('name')];
    expect(filterVisibleParams(params, {}).map((x) => x.name)).toEqual(['email', 'name']);
  });

  it('hides the phoneNumber param when features.phoneNumber is false', () => {
    const params = [p('email'), p('phoneNumber', 'features.phoneNumber == true'), p('name')];
    const out = filterVisibleParams(params, { features: { phoneNumber: false } });
    expect(out.map((x) => x.name)).toEqual(['email', 'name']);
  });

  it('shows the phoneNumber param when features.phoneNumber is true', () => {
    const params = [p('email'), p('phoneNumber', 'features.phoneNumber == true'), p('name')];
    const out = filterVisibleParams(params, { features: { phoneNumber: true } });
    expect(out.map((x) => x.name)).toEqual(['email', 'phoneNumber', 'name']);
  });

  it('handles the normalized {dialect, source} form the spec serializes to', () => {
    // The framework's ExpressionInputSchema normalizes the authored string to
    // `{ dialect: 'cel', source: '...' }`, so the served param carries the object
    // form — the evaluator unwraps `.source`, so gating still works.
    const params: ActionParamDef[] = [
      { name: 'phoneNumber', label: 'Phone', type: 'text', visible: { dialect: 'cel', source: 'features.phoneNumber == true' } as any },
    ];
    expect(filterVisibleParams(params, { features: { phoneNumber: false } })).toEqual([]);
    expect(filterVisibleParams(params, { features: { phoneNumber: true } }).map((x) => x.name)).toEqual(['phoneNumber']);
  });
});

/**
 * objectui#4640 — a `visible` that cannot be evaluated resolves FAIL-OPEN and
 * says so, once, naming the action and the param and quoting the predicate.
 *
 * Both halves are ruled, not chosen in this file:
 *  - LOUD is the standing 2026-08-06 ruling (objectui#4051 / objectstack#5149):
 *    fail-open or fail-closed may be chosen, *silent may not*. Three of the four
 *    fault shapes measured on this function were silent.
 *  - OPEN is the direction ruled for this surface (2026-08-15): a silently
 *    dropped param is undiagnosable — the action fails at submit with nothing
 *    pointing at the predicate — while an extra offered field is rejected by the
 *    server with a message.
 *
 * These cases assert SUBSTANCE, not just the verdict: a fail-open that lost its
 * warning would pass a verdict-only assertion while being exactly the bug.
 */
describe('filterVisibleParams — faults are fail-open and LOUD (objectui#4640)', () => {
  it('shows a param whose predicate cannot be PARSED, and names it in one warning', () => {
    // Previously: shown, in total silence (the bare `catch { return true }`).
    const params = [p('nickname', 'this is ((( not parseable')];
    const { result, warnings } = withWarnings(() =>
      filterVisibleParams(params, {}, 'Create user'),
    );
    expect(result.map((x) => x.name)).toEqual(['nickname']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('param "nickname" of action "Create user"');
    expect(warnings[0]).toContain('this is ((( not parseable');
  });

  it('shows a param whose predicate names an UNBOUND identifier, loudly', () => {
    // Previously: shown, silently — indistinguishable from having no gate.
    const params = [p('quota', 'nope_undeclared_4640 == 1')];
    const { result, warnings } = withWarnings(() =>
      filterVisibleParams(params, { os: { user: { id: 'u1' } } }, 'Create user'),
    );
    expect(result.map((x) => x.name)).toEqual(['quota']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('param "quota"');
    expect(warnings[0]).toContain('nope_undeclared_4640');
  });

  it('quotes the predicate of a faulting ENVELOPE too, and warns per predicate', () => {
    // The envelope is the shape `@objectstack/spec` normalizes every authored
    // predicate into, so it is the likeliest real spelling — and it was the
    // least diagnosable: `evalRowPredicate` reported it as the literal
    // "(expression)" and keyed its warn-once on that, so the FIRST faulting
    // envelope under a label silenced every other one.
    const a: ActionParamDef = { name: 'alpha', label: 'Alpha', type: 'text', visible: { dialect: 'cel', source: 'alpha_4640 ] (' } as any };
    const b: ActionParamDef = { name: 'beta', label: 'Beta', type: 'text', visible: { dialect: 'cel', source: 'beta_4640 ] (' } as any };
    const { result, warnings } = withWarnings(() => filterVisibleParams([a, b], {}, 'Create user'));
    expect(result.map((x) => x.name)).toEqual(['alpha', 'beta']);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('alpha_4640 ] (');
    expect(warnings[1]).toContain('beta_4640 ] (');
    expect(warnings.some((w) => w.includes('(expression)'))).toBe(false);
  });

  it('warns ONCE for the same param + predicate, however often it is filtered', () => {
    const params = [p('repeat', 'once_only_4640 == 1')];
    const { warnings } = withWarnings(() => {
      filterVisibleParams(params, {}, 'Create user');
      filterVisibleParams(params, {}, 'Create user');
      filterVisibleParams(params, {}, 'Create user');
    });
    expect(warnings).toHaveLength(1);
  });

  it('a declared `visible` with no evaluable source IS a fault — kept (this surface fails open), and named (objectui#11358)', () => {
    // An `ast`-only envelope, `0`, `{}`, an array: until objectui#11358 these
    // read as "no gate" and were kept in silence. They are declared gates that
    // cannot be evaluated now, so they take this surface's fault path — the
    // param is still shown (the direction a faulting param `visible` has
    // always had here), and the fault is reported once, naming the param.
    const shapes: Array<[string, unknown]> = [
      ['ast_11358', { dialect: 'cel', ast: { kind: 'call', fn: '==' } }],
      ['zero_11358', 0],
      ['object_11358', {}],
      ['array_11358', ['record.id']],
    ];
    for (const [name, visible] of shapes) {
      const param = { name, label: name, type: 'text', visible } as unknown as ActionParamDef;
      const { result, warnings } = withWarnings(() => filterVisibleParams([param], {}, 'Create user'));
      expect(result.map((x) => x.name)).toEqual([name]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`param "${name}" of action "Create user"`);
      expect(warnings[0]).toContain('[unevaluable]');
    }
  });

  it('a blank predicate is NOT a fault — kept, never evaluated, and diagnosed as blank (objectui#8069)', () => {
    // `''`, whitespace, and the empty `{ dialect, source: '' }` envelope a
    // spec-normalized empty predicate compiles to all mean "no gate declared"
    // (objectui#3850 / #3960) — they must never reach the evaluator to be
    // reported as broken. Since ADR-0137 D4 the "no gate" fold is no longer
    // SILENT: `hasDeclaredPredicate` reports each blank spelling once through
    // core's `[blank]` channel, and nothing else speaks.
    const params: ActionParamDef[] = [
      p('a', ''),
      p('b', '   '),
      { name: 'c', label: 'C', type: 'text', visible: { dialect: 'cel', source: '' } as any },
      { name: 'd', label: 'D', type: 'text', visible: { dialect: 'cel', source: '  ' } as any },
    ];
    const { result, warnings } = withWarnings(() => filterVisibleParams(params, {}, 'Create user'));
    expect(result.map((x) => x.name)).toEqual(['a', 'b', 'c', 'd']);
    // `p('a', '')` authors no key at all (the helper drops a falsy predicate);
    // `'   '`, `{ source: '' }` and `{ source: '  ' }` are three blank
    // spellings, one line each.
    expect(warnings).toHaveLength(3);
    expect(warnings.every((w) => w.includes('[blank]'))).toBe(true);
  });

  it('control — an ABSENT predicate is kept and silent: there is nothing declared to report', () => {
    const params: ActionParamDef[] = [p('a'), { name: 'n', label: 'N', type: 'text', visible: null as never }];
    const { result, warnings } = withWarnings(() => filterVisibleParams(params, {}, 'Create user'));
    expect(result.map((x) => x.name)).toEqual(['a', 'n']);
    expect(warnings).toEqual([]);
  });

  it('a BOOLEAN visible is a verdict, not an expression (objectui#3492)', () => {
    // Short-circuited before the evaluator: handing a boolean to the engine
    // yields `{ dialect: 'cel', source: undefined }`, which faults — and on
    // this surface's fail-open that would turn `visible: false`, the most
    // explicit "never offer this" an author can write, into a shown param.
    const params: ActionParamDef[] = [
      { name: 'never', label: 'Never', type: 'text', visible: false as any },
      { name: 'always', label: 'Always', type: 'text', visible: true as any },
    ];
    const { result, warnings } = withWarnings(() => filterVisibleParams(params, {}, 'Create user'));
    expect(result.map((x) => x.name)).toEqual(['always']);
    expect(warnings).toEqual([]);
  });
});

/**
 * objectui#4640 — the fail direction no longer depends on the predicate's
 * DIALECT. Before this change a bare string ran the legacy JS evaluator (lenient
 * → falsy → param silently DROPPED) while a `{ dialect, source }` envelope ran
 * CEL (fault → param silently KEPT): one `visible` key, two opposite outcomes,
 * decided by whether the authored text happened to contain `${…}` / `===`
 * (the objectui#3314 shape). Both spellings now reach one entry, one direction
 * and one warning.
 */
describe('filterVisibleParams — one value, one answer (objectui#3314)', () => {
  it('a broken bare string and a broken envelope resolve the SAME way, both loudly', () => {
    const bare = p('bare', 'dialect_fork_4640 ] (');
    const env: ActionParamDef = {
      name: 'envelope',
      label: 'Envelope',
      type: 'text',
      visible: { dialect: 'cel', source: 'dialect_fork_env_4640 ] (' } as any,
    };
    const { result, warnings } = withWarnings(() => filterVisibleParams([bare, env], {}, 'Create user'));
    // Same verdict for both spellings — fail-open.
    expect(result.map((x) => x.name)).toEqual(['bare', 'envelope']);
    // …and neither is silent.
    expect(warnings).toHaveLength(2);
  });

  it('a legacy-dialect string that faults fails OPEN as well, and is reported', () => {
    // `${…}` routes to the legacy engine for back-compat, but its faults now
    // land on the same fallback as the CEL path instead of the opposite one.
    const params = [p('legacy', '${legacy_fault_4640(((}')];
    const { result, warnings } = withWarnings(() => filterVisibleParams(params, {}, 'Create user'));
    expect(result.map((x) => x.name)).toEqual(['legacy']);
    // The deprecation notice plus the fault report — the predicate is named by
    // both, and by neither was it named before.
    expect(warnings.some((w) => w.includes('legacy expression dialect'))).toBe(true);
    expect(warnings.some((w) => w.includes('failed to evaluate'))).toBe(true);
  });
});

/**
 * objectui#4640 — this surface has NO ROW, so the host predicate scope keeps its
 * own `record` / `data`.
 *
 * `evalRowPredicate`'s subject is a row and it pins `record` / `data` over the
 * scope (objectui#3796). Routing this function through it without saying "no row
 * here" would write an EMPTY record over the host's real one, and every
 * `record.*` / `data.*` param predicate would fault ("No such key") and — under
 * fail-open — silently start showing params it was written to hide. The
 * `rowless` option is what keeps that from happening; these cases are its proof
 * at this surface.
 */
describe('filterVisibleParams — the host scope keeps its own data/record', () => {
  it('resolves a data.* predicate against the host scope, with no fault', () => {
    const params = [p('advanced', 'data.mode == "advanced"')];
    const { result, warnings } = withWarnings(() =>
      filterVisibleParams(params, { data: { mode: 'advanced' } }, 'Create user'),
    );
    expect(result.map((x) => x.name)).toEqual(['advanced']);
    expect(warnings).toEqual([]);
    // …and reaches the opposite verdict when the host data says otherwise —
    // proving it read the value, not a fail-open default.
    const { result: hidden, warnings: quiet } = withWarnings(() =>
      filterVisibleParams(params, { data: { mode: 'basic' } }, 'Create user'),
    );
    expect(hidden).toEqual([]);
    expect(quiet).toEqual([]);
  });

  it('resolves a record.* predicate against the host scope, with no fault', () => {
    const params = [p('reassign', 'record.manager == os.user.id')];
    const scope = { os: { user: { id: 'u1' } }, record: { manager: 'u1' } };
    const { result, warnings } = withWarnings(() => filterVisibleParams(params, scope, 'Reassign'));
    expect(result.map((x) => x.name)).toEqual(['reassign']);
    expect(warnings).toEqual([]);
    const { result: hidden } = withWarnings(() =>
      filterVisibleParams(params, { os: { user: { id: 'u2' } }, record: { manager: 'u1' } }, 'Reassign'),
    );
    expect(hidden).toEqual([]);
  });
});

/**
 * objectui#4640 — the honest counter-pull, recorded rather than lost.
 *
 * The pin this block replaces was *"hides a feature-gated param when the flag is
 * absent (conservative)"*: `features.phoneNumber == true` against `features: {}`
 * returned false on the legacy evaluator, so the param stayed hidden. On the
 * canonical CEL engine an absent key is NOT a falsy read — it is a runtime fault
 * (`[runtime] No such key: phoneNumber`), so it takes the ruled fail-open branch
 * and the param is now SHOWN, with a warning naming it.
 *
 * That was measured, not assumed, and it is the one outcome this card's ruling
 * knowingly traded: the delegated ruling of 2026-08-15 requires the fault to be
 * fail-open and loud, and requires this case to be documented in code rather
 * than quietly re-spelled. The degradation is bounded and self-announcing — the
 * server rejects the unsupported param with a message, and the console names the
 * predicate — whereas the fail-closed alternative hides a REQUIRED param with
 * nothing pointing at the predicate.
 *
 * The conservative outcome remains available, and in the spelling that is
 * portable to the server's own CEL engine: guard the key with `has()`. That is
 * the migration this file documents for anyone who was relying on the old
 * behavior.
 */
describe('filterVisibleParams — the feature-flag case, after the flip (objectui#4640)', () => {
  const gated = (source: string): ActionParamDef[] => [
    { name: 'phoneNumber', label: 'Phone', type: 'text', visible: source } as ActionParamDef,
  ];

  it('an ABSENT feature key now SHOWS the param and says why (was: silently hidden)', () => {
    const { result, warnings } = withWarnings(() =>
      filterVisibleParams(gated('features.phoneNumber == true'), { features: {} }, 'Create user'),
    );
    expect(result.map((x) => x.name)).toEqual(['phoneNumber']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('param "phoneNumber" of action "Create user"');
    expect(warnings[0]).toContain('features.phoneNumber == true');
    // The engine's own reason is the line that sends the author to the fix.
    expect(warnings[0]).toContain('No such key');
  });

  it('has() keeps the conservative outcome — hidden, and with no fault at all', () => {
    const { result, warnings } = withWarnings(() =>
      filterVisibleParams(
        gated('has(features.phoneNumber) && features.phoneNumber == true'),
        { features: {} },
        'Create user',
      ),
    );
    expect(result).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('a DECLARED flag is unaffected by the flip, either way', () => {
    // The common deployment shape — the scope carries the key — reaches a
    // genuine verdict on both engines and did not move.
    expect(
      filterVisibleParams(gated('features.phoneNumber == true'), { features: { phoneNumber: false } }),
    ).toEqual([]);
    expect(
      filterVisibleParams(gated('features.phoneNumber == true'), { features: { phoneNumber: true } })
        .map((x) => x.name),
    ).toEqual(['phoneNumber']);
  });
});

/** Mount the dialog open with the given params; returns the resolve spy. */
function openDialog(params: ActionParamDef[]) {
  const resolve = vi.fn();
  render(
    <ActionParamDialog
      state={{ open: true, params, resolve }}
      onOpenChange={() => {}}
    />,
  );
  return resolve;
}

const confirm = () => fireEvent.click(screen.getByText('actionDialog.confirm'));

const def = (over: Partial<ActionParamDef>): ActionParamDef => ({
  name: 'p1',
  label: 'Param One',
  type: 'text',
  ...over,
});

describe('ActionParamDialog — shared field-widget rendering (ADR-0059)', () => {
  it('renders a text param and round-trips the typed value on confirm', async () => {
    const resolve = openDialog([def({ name: 'note', type: 'text' })]);
    const input = await screen.findByLabelText('Param One');
    fireEvent.change(input, { target: { value: 'hello' } });
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ note: 'hello' }));
  });

  it('renders a textarea param through the shared TextAreaField', async () => {
    const resolve = openDialog([def({ name: 'reason', type: 'textarea' })]);
    const box = await screen.findByLabelText('Param One');
    expect(box.tagName).toBe('TEXTAREA');
    fireEvent.change(box, { target: { value: 'because' } });
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ reason: 'because' }));
  });

  it('renders a number param and emits a numeric value (not a string)', async () => {
    const resolve = openDialog([def({ name: 'count', type: 'number' })]);
    const input = await screen.findByLabelText('Param One');
    expect(input.getAttribute('type')).toBe('number');
    fireEvent.change(input, { target: { value: '42' } });
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ count: 42 }));
  });

  it('renders a boolean param as a checkbox row that toggles to true', async () => {
    const resolve = openDialog([def({ name: 'force', type: 'boolean' })]);
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ force: true }));
  });

  it('toggles the boolean param by clicking its visible label (objectui#3962)', async () => {
    // The boolean branch renders `<Label htmlFor={param.name}>` beside the
    // control and now hands the widget that same id explicitly, so the row's
    // normal affordance — click the text — has to work off the host's own
    // output rather than off `BooleanField`'s id fallback chain. Pinned as
    // BEHAVIOR here; the naming half (one label, un-doubled accessible name)
    // is pinned in ActionParamDialog.ariaRequired.test.tsx.
    const resolve = openDialog([def({ name: 'force', label: 'Force It', type: 'boolean' })]);
    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    const label = document.querySelector('label[for="force"]') as HTMLLabelElement;
    expect(label).not.toBeNull();
    fireEvent.click(label);

    await waitFor(() => expect(checkbox).toHaveAttribute('aria-checked', 'true'));
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ force: true }));
  });

  it('renders a select param through the shared SelectField (combobox trigger)', async () => {
    openDialog([
      def({
        name: 'env',
        type: 'select',
        options: [
          { label: 'Production', value: 'prod' },
          { label: 'Staging', value: 'stage' },
        ],
      }),
    ]);
    expect(await screen.findByRole('combobox')).toBeTruthy();
  });

  // objectui#12642: the dialog draws the platform date picker the record form
  // draws (one face per field type), not the browser's native input, whose
  // placeholder and digit order are the machine's. The value is unchanged.
  it('renders a date param through the platform date picker and resolves the YYYY-MM-DD day', async () => {
    const resolve = openDialog([def({ name: 'due', type: 'date' })]);
    const input = (await screen.findByLabelText('Param One')) as HTMLInputElement;
    expect(input.closest('[data-slot="date-picker"]'), 'date picker not rendered').not.toBeNull();
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('MM/DD/YYYY');
    expect(document.querySelector('input[type="date"]')).toBeNull();
    fireEvent.change(input, { target: { value: '07/19/2026' } });
    fireEvent.blur(input);
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ due: '2026-07-19' }));
  });

  it('renders a file param as a real upload control, not a text box (#2698)', async () => {
    openDialog([def({ name: 'attachments', type: 'file', multiple: true })]);
    await waitFor(() => {
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeTruthy();
      expect((fileInput as HTMLInputElement).multiple).toBe(true);
    });
  });

  it('renders a color param through the shared ColorField (color input)', async () => {
    openDialog([def({ name: 'tint', type: 'color' })]);
    await waitFor(() => {
      expect(document.querySelector('input[type="color"]')).toBeTruthy();
    });
  });

  it('required + empty blocks submit and shows the error message', async () => {
    const resolve = openDialog([def({ name: 'note', type: 'text', required: true })]);
    await screen.findByLabelText(/Param One/);
    confirm();
    expect(await screen.findByText('actionDialog.requiredError')).toBeTruthy();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('an unknown param type falls back to a plain text input', async () => {
    const resolve = openDialog([def({ name: 'x', type: 'no-such-type' })]);
    const input = await screen.findByLabelText('Param One');
    expect(input.getAttribute('type')).toBe('text');
    fireEvent.change(input, { target: { value: 'v' } });
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ x: 'v' }));
  });

  it('a lookup param WITH a reference target renders the picker without the degraded-lookup helpText (#3094)', async () => {
    openDialog([def({ name: 'manager', type: 'lookup', referenceTo: 'sys_user' })]);
    // The real picker widget mounts (its trigger button, behind Suspense)…
    expect(await screen.findByTestId('lookup-trigger-manager')).toBeTruthy();
    // …and the "no reference object configured" warning must NOT appear.
    expect(screen.queryByText('actionDialog.lookupHelpText')).toBeNull();
  });

  it('a lookup param WITHOUT a reference target degrades to text and shows the degraded-lookup helpText', async () => {
    openDialog([def({ name: 'manager', type: 'lookup' })]);
    const input = await screen.findByLabelText('Param One');
    expect(input.getAttribute('type')).toBe('text');
    expect(await screen.findByText('actionDialog.lookupHelpText')).toBeTruthy();
  });

  it('a degraded lookup param with a custom helpText shows that text instead of the built-in warning', async () => {
    openDialog([def({ name: 'manager', type: 'lookup', helpText: 'Paste the user id from the admin list' })]);
    await screen.findByLabelText('Param One');
    expect(await screen.findByText('Paste the user id from the admin list')).toBeTruthy();
    expect(screen.queryByText('actionDialog.lookupHelpText')).toBeNull();
  });

  /**
   * objectui#5654 — the hint condition reads the ADAPTER's degradation
   * predicate, not a second literal over raw param spellings.
   *
   * The old line was `param.type === 'lookup' || param.type === 'reference'`,
   * a set that overlapped the degrading one without containing it. The four
   * cases below are the card's table plus its controls: the row that gained
   * behaviour, the alias row that must not lose it, and two rows that must stay
   * hint-free (one that renders a real picker, one that renders text for a
   * reason that is not degradation).
   *
   * `master_detail` is reachable here because `ActionParamDef['type']` is a
   * plain `string` (core's `ActionRunner`), and it degrades exactly as `lookup`
   * does — it just used to arrive at the user as an unexplained empty box.
   */
  it('a targetless master_detail param degrades to text AND now carries both #3405 hints (objectui#5654)', async () => {
    openDialog([def({ name: 'parent', type: 'master_detail' })]);
    const input = await screen.findByLabelText('Param One');
    // Unchanged half: the adapter always degraded this param.
    expect(input.getAttribute('type')).toBe('text');
    // Changed half — the deliberate behaviour change this card ships.
    expect(input.getAttribute('placeholder')).toBe('actionDialog.lookupPlaceholder');
    expect(await screen.findByText('actionDialog.lookupHelpText')).toBeTruthy();
  });

  it('the `reference` alias spelling keeps its hints (it folds to lookup before the test)', async () => {
    // The spelling the retired literal hand-copied out of `PARAM_TYPE_ALIASES`.
    // Reading resolved widget keys must not cost it the hints it already had.
    openDialog([def({ name: 'account', type: 'reference' })]);
    const input = await screen.findByLabelText('Param One');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('placeholder')).toBe('actionDialog.lookupPlaceholder');
    expect(await screen.findByText('actionDialog.lookupHelpText')).toBeTruthy();
  });

  it('a master_detail param WITH a target renders the picker and gets no hints', async () => {
    openDialog([def({ name: 'parent', type: 'master_detail', referenceTo: 'accounts' })]);
    expect(await screen.findByTestId('lookup-trigger-parent')).toBeTruthy();
    expect(screen.queryByText('actionDialog.lookupHelpText')).toBeNull();
  });

  it('a param that renders as text WITHOUT degrading gets no picker hints', async () => {
    // The control that a reader keyed on the rendered type alone would fail:
    // an unknown type also lands on the text widget, but it was never a picker,
    // so telling its user to "paste a record id" would be nonsense.
    openDialog([def({ name: 'x', type: 'no-such-type' })]);
    const input = await screen.findByLabelText('Param One');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('placeholder')).toBeNull();
    expect(screen.queryByText('actionDialog.lookupHelpText')).toBeNull();
  });

  it('seeds defaultValue and returns it untouched on confirm', async () => {
    const resolve = openDialog([def({ name: 'note', type: 'text', defaultValue: 'seed' })]);
    const input = await screen.findByLabelText('Param One');
    expect((input as HTMLInputElement).value).toBe('seed');
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ note: 'seed' }));
  });
});

describe('emitted value-shape parity (contract-tied render proofs, #2714)', () => {
  // Each proof drives the REAL widget and asserts the value the dialog resolves
  // on confirm matches the shape declared in `paramValueShape.ts`. This ties the
  // declarative contract table to what the widgets actually emit — a silent
  // widget-onChange swap that changed a param's POST shape fails here, not just
  // in the pure table. Covers the endpoint-relied contracts drivable without a
  // dataSource; the lookup/user id contract is pinned in `paramValueShape.test.ts`.

  it('number param emits a number matching its declared contract', async () => {
    const param = def({ name: 'count', type: 'number' });
    const resolve = openDialog([param]);
    const input = await screen.findByLabelText('Param One');
    fireEvent.change(input, { target: { value: '42' } });
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    const emitted = resolve.mock.calls[0][0].count;
    expect(emitted).toBe(42);
    expect(classifyValueShape(emitted)).toBe(expectedParamShape(param)); // 'number'
  });

  // objectstack#5061: this proof used to assert the emitted value was the
  // control's own `2026-07-20T14:30` — the one shape `validateActionParams`
  // rejects, so it was pinning a value that earned a 400 on every submission.
  // It now drives the same real widget and asks the REAL platform validator
  // whether the bag would be accepted, which is the fact the user cares about.
  // Written to hold in EVERY timezone (the repo's rule for zone-shaped tests,
  // see nativeDateValue.test.ts): never hardcode the expected instant — assert
  // the shape the contract demands, and that it denotes the same instant as the
  // local wall clock the user typed into the control.
  it('datetime param emits a zoned ISO instant the platform validator accepts', async () => {
    const param = def({ name: 'when', type: 'datetime' });
    const resolve = openDialog([param]);
    const input = (await screen.findByLabelText('Param One')) as HTMLInputElement;
    // objectui#12642: the platform picker, typed in the display locale's format.
    expect(input.closest('[data-slot="date-picker"]'), 'date picker not rendered').not.toBeNull();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    fireEvent.change(input, { target: { value: '07/20/2026 14:30' } });
    fireEvent.blur(input);
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    const emitted = resolve.mock.calls[0][0].when;

    // 1. The declared table shape is still `string` — the contract change is in
    //    the string's FORM, which the shape tag can't see (so this line alone
    //    would have stayed green through the bug; it is not the guard).
    expect(classifyValueShape(emitted)).toBe(expectedParamShape(param)); // 'string'
    // 2. The guard: the exact validator that produced the 400 in the issue now
    //    reports no issues for the bag the dialog resolved.
    expect(validateActionParams([{ name: 'when', type: 'datetime' }], { when: emitted })).toEqual([]);
    // 3. …and it is still the minute the user picked, read on the local basis
    //    the control writes on.
    expect(new Date(emitted as string).getTime()).toBe(new Date('2026-07-20T14:30').getTime());
  });

  it('time param emits a string matching its declared contract', async () => {
    const param = def({ name: 'at', type: 'time' });
    const resolve = openDialog([param]);
    const input = await screen.findByLabelText('Param One');
    expect(input.getAttribute('type')).toBe('time');
    fireEvent.change(input, { target: { value: '09:15' } });
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    const emitted = resolve.mock.calls[0][0].at;
    expect(emitted).toBe('09:15');
    expect(classifyValueShape(emitted)).toBe(expectedParamShape(param)); // 'string'
  });

  it('select+multiple param emits a string[] matching its declared contract (#2709)', async () => {
    const param = def({
      name: 'envs',
      type: 'select',
      multiple: true,
      options: [
        { label: 'Production', value: 'prod' },
        { label: 'Staging', value: 'stage' },
      ],
    });
    const resolve = openDialog([param]);
    // A `multiple` select renders the chip picker (MultiSelectField) — plain
    // toggle buttons, not a Radix combobox — so it is drivable in JSDOM.
    fireEvent.click(await screen.findByRole('button', { name: 'Production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Staging' }));
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    const emitted = resolve.mock.calls[0][0].envs;
    expect(emitted).toEqual(['prod', 'stage']);
    expect(classifyValueShape(emitted)).toBe(expectedParamShape(param)); // 'string[]'
  });

  it('a file param emits a fileId string after serialize (#2698/#2710), matching its contract', () => {
    // The FileField upload widget can't complete a presigned upload in JSDOM, so
    // the emitted-shape proof for file/image lives at the serialize boundary:
    // a resolved { file_id } descriptor serializes to the fileId string the
    // contract declares. (End-to-end upload UX is covered by #2710's suite.)
    const param = def({ name: 'attachment', type: 'file' });
    const out = serializeParamValues([param], {
      attachment: { file_id: 'file_abc', name: 'x.pdf', url: 'https://…' },
    });
    expect(out.attachment).toBe('file_abc');
    expect(classifyValueShape(out.attachment)).toBe(expectedParamShape(param)); // 'string'
  });
});

describe('serializeParamValues', () => {
  const fileParam = (name: string, multiple = false): ActionParamDef =>
    ({ name, label: name, type: 'file', ...(multiple ? { multiple: true } : {}) } as ActionParamDef);

  it('is a no-op when there are no upload params', () => {
    const values = { comment: 'hi', to: 'u1' };
    expect(serializeParamValues([p('comment'), p('to')], values)).toBe(values);
  });

  it('maps a single file param object to its file_id', () => {
    const out = serializeParamValues([fileParam('attachments')], {
      comment: 'ok',
      attachments: { file_id: 'f_123', name: 'x.pdf', url: 'https://…' },
    });
    expect(out).toEqual({ comment: 'ok', attachments: 'f_123' });
  });

  it('maps a multiple file param array to file_id[]', () => {
    const out = serializeParamValues([fileParam('attachments', true)], {
      attachments: [
        { file_id: 'f_1', name: 'a' },
        { file_id: 'f_2', name: 'b' },
      ],
    });
    expect(out).toEqual({ attachments: ['f_1', 'f_2'] });
  });

  it('passes a bare string id through unchanged', () => {
    expect(serializeParamValues([fileParam('attachments')], { attachments: 'f_9' }))
      .toEqual({ attachments: 'f_9' });
  });

  it('leaves an absent / null upload value alone', () => {
    expect(serializeParamValues([fileParam('attachments', true)], { comment: 'c' }))
      .toEqual({ comment: 'c' });
    expect(serializeParamValues([fileParam('attachments')], { attachments: null }))
      .toEqual({ attachments: null });
  });

  it('does not touch non-upload params', () => {
    const out = serializeParamValues([fileParam('attachments'), p('comment')], {
      attachments: { file_id: 'f_1' },
      comment: 'keep me',
    });
    expect(out).toEqual({ attachments: 'f_1', comment: 'keep me' });
  });

  /**
   * objectstack#5061 — the whole point of this block INVERTED.
   *
   * The previous version pinned the opposite behavior: it asserted the widget's
   * ISO instant was converted BACK to `2026-07-20T14:30` on the way out. That
   * assertion was green and the feature was still 100% broken, because the shape
   * it pinned is the one shape the platform's `datetime` value contract rejects
   * — so those cases were replaced rather than re-spelled. The oracle here is
   * `validateActionParams` from `@objectstack/spec/ui`, i.e. the exact function
   * the dispatcher runs before the handler (ADR-0104 D2) and the source of the
   * 400 quoted in the issue. Pinning against the real validator instead of a
   * re-spelled literal is what keeps this from re-pinning a shape nobody accepts.
   *
   * Zone-agnostic by construction: no expected instant is hardcoded (see
   * `nativeDateValue.test.ts`'s note — a zone-shaped test that only holds in UTC
   * goes green on CI while the defect is live for every user east or west of it).
   */
  describe('datetime params (objectstack#5061)', () => {
    const dtParam = (name: string): ActionParamDef =>
      ({ name, label: name, type: 'datetime' } as ActionParamDef);
    /** The resolved declaration the dispatcher validates the bag against. */
    const dtDecl = (name: string) => [{ name, type: 'datetime' }];

    it('passes the widget ISO instant straight through, so the platform accepts it', () => {
      // What DateTimeField hands the dialog: `fromDateTimeInputValue` → an ISO
      // instant with an explicit zone, seconds and milliseconds included.
      const iso = new Date(2026, 6, 20, 14, 30).toISOString();
      const out = serializeParamValues([dtParam('when')], { when: iso });
      expect(out).toEqual({ when: iso });
      expect(validateActionParams(dtDecl('when'), out)).toEqual([]);
    });

    it('is idempotent for a value that already carries a zone — no second conversion', () => {
      // A `+HH:MM` offset is as valid an instant as `Z` for the contract, and
      // must survive byte-for-byte: re-deriving it would re-cut the seconds.
      const offset = '2026-07-20T14:30:45.123+08:00';
      expect(serializeParamValues([dtParam('when')], { when: offset })).toEqual({ when: offset });
      expect(validateActionParams(dtDecl('when'), { when: offset })).toEqual([]);
      // Applying the boundary twice changes nothing (the property, not a sample).
      const once = serializeParamValues([dtParam('when')], { when: offset });
      expect(serializeParamValues([dtParam('when')], once)).toEqual(once);
    });

    it('leaves an empty / unfilled datetime alone — no Invalid Date, no required error', () => {
      expect(serializeParamValues([dtParam('when')], { when: '' })).toEqual({ when: '' });
      expect(serializeParamValues([dtParam('when')], { when: null })).toEqual({ when: null });
      expect(serializeParamValues([dtParam('when')], { other: 1 })).toEqual({ other: 1 });
      // An optional param left blank is ABSENT to the validator, not invalid.
      expect(validateActionParams(dtDecl('when'), { when: '' })).toEqual([]);
    });

    it('does not touch a plain date param (its contract is the calendar day)', () => {
      const dateParam = { name: 'day', label: 'day', type: 'date' } as ActionParamDef;
      const out = serializeParamValues([dateParam], { day: '2026-07-20' });
      expect(out).toEqual({ day: '2026-07-20' });
      // A `date` param must NOT become an instant — the calendar day is the
      // value, and zoning it would move the day west of Greenwich.
      expect(validateActionParams([{ name: 'day', type: 'date' }], out)).toEqual([]);
    });

    it('documents the shape that is still rejected: a zone-less authored default', () => {
      // Deliberately NOT laundered here (see serializeParamValues' note): an
      // authored `defaultValue: '2026-07-20T14:30'` is ambiguous metadata, and
      // coercing it would make it pass in the UI while the same literal keeps
      // 400ing from REST/MCP. This pins that the renderer does not hide it.
      // The authoring-time rejection that SHOULD catch it is objectstack#6970.
      const naive = '2026-07-20T14:30';
      expect(serializeParamValues([dtParam('when')], { when: naive })).toEqual({ when: naive });
      // Asserted structurally, plus the one phrase that identifies the rule.
      // Pinning the validator's full sentence would couple this suite to a
      // message owned by `@objectstack/spec`, so a reword there would red this
      // repo's CI for a reason that has nothing to do with the renderer.
      const issues = validateActionParams(dtDecl('when'), { when: naive });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ param: 'when', code: 'invalid_shape' });
      expect(issues[0].message).toMatch(/explicit zone/);
    });
  });
});
