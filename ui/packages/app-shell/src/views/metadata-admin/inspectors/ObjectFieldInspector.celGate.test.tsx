// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The field inspector must REPORT its blocking CEL verdicts upward, so the host
 * that owns Save can refuse to publish a parse fault — objectui#4306.
 *
 * The card: `record.est_hours *` in the formula box shows its inline error and
 * still saves (PUT 200 + toast), and publishing makes the malformed expression
 * the live field definition. The RLS editor one directory over already gates
 * correctly; the inspector simply reported nothing.
 *
 * What is pinned here is the INSPECTOR half of that channel — the per-site
 * aggregation. The count is keyed by SITE (`formula` + the three conditional
 * rules) rather than summed into one number at the mount, because four editors
 * report independently and a shared counter would let whichever linted last
 * overwrite the others: the classic multi-source aggregation bug. So the
 * decisive case here is not "an error is counted" but
 * {@link https://github.com/objectstack-ai/objectui/issues/4306 two sites at
 * once, one of them clearing} — a shared counter passes every single-site case
 * and fails that one.
 *
 * The host half (Save actually going disabled, and the host resetting its own
 * count on selection change) is pinned in
 * {@link file://../../studio-design/DataPillar.celGate.test.tsx}.
 *
 * The engine is stubbed deterministically — the live lint against the REAL
 * engine is CelPredicateField.test.tsx's job; here we test wiring, so the
 * stub treats "ends in a dangling binary operator" as the parse fault.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { __setCelFormulaLoader } from '../celAuthoring';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

/** The card's repro shape: a source left hanging on a binary operator. */
const DANGLING = /[*+\-/&|=<>]\s*$/;

function stubEngine() {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: (_role: string, input: unknown) => {
        const src = typeof input === 'string' ? input : String((input as { source?: string })?.source ?? '');
        return DANGLING.test(src)
          ? { ok: false, errors: [{ message: 'Parse error: expression ends after an operator' }], warnings: [] }
          : { ok: true, errors: [], warnings: [] };
      },
      introspectScope: () => ({
        fields: ['est_hours', 'status'],
        roots: ['record', 'previous', 'parent'],
        functions: ['has'],
      }),
      inferExpressionType: () => 'number' as const,
    }),
  );
}

function controlFor(label: string): HTMLElement {
  const lab = screen.getByText(label);
  return lab.parentElement!.querySelector('input, textarea, select, [role="combobox"]') as HTMLElement;
}

/**
 * Stateful harness — the editors are controlled, so edits must round-trip
 * through the draft or the second keystroke reverts the first.
 */
function Harness({
  initialFields,
  selected,
  onBlockingIssuesChange,
}: {
  initialFields: Record<string, Record<string, unknown>>;
  selected: string;
  onBlockingIssuesChange: (count: number) => void;
}) {
  const [fields, setFields] = React.useState(initialFields);
  return (
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{ name: 'account', fields }}
      selection={{ kind: 'field', id: selected }}
      onPatch={(patch: Record<string, unknown>) => setFields(patch.fields as typeof fields)}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
      onBlockingIssuesChange={onBlockingIssuesChange}
    />
  );
}

function renderHarness(
  initialFields: Record<string, Record<string, unknown>>,
  selected: string,
) {
  const report = vi.fn();
  render(
    <Harness initialFields={initialFields} selected={selected} onBlockingIssuesChange={report} />,
  );
  /** The count the host would currently be holding. */
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current };
}

describe('ObjectFieldInspector — blocking CEL issues are reported to the host (#4306)', () => {
  it("counts the card's own repro: a dangling operator in the formula box", async () => {
    stubEngine();
    const { current } = renderHarness(
      { est_hours: { type: 'number' }, total: { type: 'formula' } },
      'total',
    );
    fireEvent.change(controlFor('Formula (CEL)'), { target: { value: 'record.est_hours *' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean formula as zero, so a valid expression never blocks Save', async () => {
    stubEngine();
    const { current } = renderHarness(
      { est_hours: { type: 'number' }, total: { type: 'formula' } },
      'total',
    );
    fireEvent.change(controlFor('Formula (CEL)'), { target: { value: 'record.est_hours * 2' } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('re-enables Save when the author fixes the formula', async () => {
    stubEngine();
    const { current } = renderHarness({ total: { type: 'formula' } }, 'total');
    const box = controlFor('Formula (CEL)');
    fireEvent.change(box, { target: { value: 'record.est_hours *' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
    fireEvent.change(box, { target: { value: 'record.est_hours * 2' } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it.each([
    ['Visible when', 'visibleWhen'],
    ['Read-only when', 'readonlyWhen'],
    ['Required when', 'requiredWhen'],
  ])('gates on a fault in the %s rule editor', async (label) => {
    stubEngine();
    const { current } = renderHarness({ note: { type: 'text' } }, 'note');
    fireEvent.change(controlFor(label), { target: { value: "record.status ==" } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  /**
   * The decisive case for the per-site map. With one shared counter the last
   * reporter wins: clearing ONE of two faulty editors would drop the total to
   * 0 and hand back a Save button that still publishes the other fault.
   */
  it('keeps each site independent — clearing one fault leaves the other counted', async () => {
    stubEngine();
    const { current } = renderHarness({ note: { type: 'text' } }, 'note');
    fireEvent.change(controlFor('Visible when'), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    fireEvent.change(controlFor('Read-only when'), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(2), { timeout: 3000 });

    // Fix only the first — the second must still hold Save closed.
    fireEvent.change(controlFor('Visible when'), { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  /**
   * Prune on field-type change (ruling item 2): the formula editor UNMOUNTS
   * when the field stops being a formula, so its last verdict must not
   * survive — otherwise Save wedges closed with no editor on screen to fix.
   */
  it('prunes the formula verdict when the field stops being a formula', async () => {
    stubEngine();
    const report = vi.fn();
    const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;

    // The Type control is a Radix combobox, not a native select, so the type
    // change is driven at the draft level — which is what the prune actually
    // keys on. The malformed `expression` deliberately STAYS on the field: the
    // wedge this guards against is the stored fault outliving its editor.
    function TypeSwitchHarness() {
      const [fields, setFields] = React.useState<Record<string, Record<string, unknown>>>({
        total: { type: 'formula' },
      });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setFields((f) => ({ total: { ...f.total, type: 'text' } }))
            }
          >
            retype as text
          </button>
          <ObjectFieldInspector
            type="object"
            name="account"
            draft={{ name: 'account', fields }}
            selection={{ kind: 'field', id: 'total' }}
            onPatch={(patch: Record<string, unknown>) => setFields(patch.fields as typeof fields)}
            onClearSelection={() => {}}
            onSelectionChange={() => {}}
            readOnly={false}
            locale={'en-US'}
            onBlockingIssuesChange={report}
          />
        </>
      );
    }
    render(<TypeSwitchHarness />);

    fireEvent.change(controlFor('Formula (CEL)'), { target: { value: 'record.est_hours *' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'retype as text' }));
    await waitFor(() => expect(screen.queryByText('Formula (CEL)')).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });
});
