// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ConditionalFormattingEditor` must REPORT its CEL verdicts upward, so the
 * inspector above it can aggregate and the host that owns Save can refuse to
 * publish a parse fault — objectui#4527, the same ungated-Save family as #4306.
 *
 * This editor mounts one `CelPredicateField` PER RULE, and passed no
 * `onLintChange` to any of them: a formatting condition that does not parse
 * rendered its inline error and Save stayed writable. `ViewVariantInspector`
 * reaches this file.
 *
 * ## The two cases that decide the implementation
 *
 *  - **Per-rule map, not a running total.** Rules lint independently and
 *    asynchronously, so one shared counter lets whichever reported last
 *    overwrite the others: fixing one of two broken rules would hand back a
 *    writable Save while the other was still malformed. A shared counter
 *    passes every single-rule case and fails only this one.
 *  - **Prune by derivation.** Deleting a rule unmounts its editor, which can
 *    never report `0` afterwards, so a remembered count would hold Save shut
 *    with no editor on screen to fix it. The total counts only rules that
 *    still exist (`i < drafts.length`) rather than being repaired by a reset
 *    effect (#4527 ruling item 2, mirroring #4306).
 *
 * The engine is stubbed deterministically — the live lint is
 * `CelPredicateField.test.tsx`'s job; this suite tests WIRING.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import {
  ConditionalFormattingEditor,
  type ConditionalFormattingRuleDraft,
} from './ConditionalFormattingEditor';
import { __setCelFormulaLoader } from './celAuthoring';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

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
      introspectScope: () => ({ fields: ['status', 'amount'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

const t = (k: string) => k;

/** Controlled harness — the editor is controlled, so edits must round-trip. */
function Harness({
  initial,
  report,
}: {
  initial: ConditionalFormattingRuleDraft[];
  report: (count: number) => void;
}) {
  const [rules, setRules] = React.useState<ConditionalFormattingRuleDraft[]>(initial);
  return (
    <ConditionalFormattingEditor
      rules={rules}
      onChange={setRules}
      objectName="invoice"
      fieldNames={['status', 'amount']}
      t={t}
      onBlockingIssuesChange={report}
    />
  );
}

function renderEditor(initial: ConditionalFormattingRuleDraft[]) {
  const report = vi.fn();
  render(<Harness initial={initial} report={report} />);
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current };
}

/** The rule `i`'s CEL box (`CelPredicateField` renders a combobox TEXTAREA). */
const ruleBox = (i: number) =>
  screen
    .getByTestId(`cf-rule-${i}`)
    .querySelector('[role="combobox"]') as HTMLTextAreaElement;

describe('ConditionalFormattingEditor — blocking CEL issues are reported upward (#4527)', () => {
  it('counts a formatting condition that does not parse', async () => {
    stubEngine();
    const { current } = renderEditor([{ condition: "record.status == 'a'", style: {} }]);
    fireEvent.change(ruleBox(0), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean rule as zero, so a valid condition never blocks Save', async () => {
    stubEngine();
    const { current } = renderEditor([{ condition: '', style: {} }]);
    fireEvent.change(ruleBox(0), { target: { value: "record.status == 'overdue'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  /**
   * DECISIVE — the per-rule map. One shared counter passes both cases above
   * and fails here: clearing ONE of two faulty rules would drop the total to 0
   * and hand back a Save button that still publishes the other fault.
   */
  it('keeps each rule independent — fixing one leaves the other counted', async () => {
    stubEngine();
    const { current } = renderEditor([
      { condition: '', style: {} },
      { condition: '', style: {} },
    ]);

    fireEvent.change(ruleBox(0), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    fireEvent.change(ruleBox(1), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(2), { timeout: 3000 });

    // Fix only the first — the second must still hold Save closed.
    fireEvent.change(ruleBox(0), { target: { value: "record.status == 'overdue'" } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  /**
   * DECISIVE — the prune. Deleting the faulty rule unmounts its editor, so
   * nothing will ever report `0` for it; a remembered count wedges Save shut.
   */
  it('drops the count when the faulty rule is deleted, so Save cannot wedge shut', async () => {
    stubEngine();
    const { current } = renderEditor([
      { condition: "record.status == 'ok'", style: {} },
      { condition: '', style: {} },
    ]);

    fireEvent.change(ruleBox(1), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    fireEvent.click(screen.getByTestId('cf-remove-1'));
    await waitFor(() => expect(screen.queryByTestId('cf-rule-1')).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('stays mountable with no reporter attached — the prop is optional', async () => {
    stubEngine();
    render(
      <ConditionalFormattingEditor
        rules={[{ condition: 'record.status ==', style: {} }]}
        onChange={() => {}}
        objectName="invoice"
        fieldNames={['status']}
        t={t}
      />,
    );
    await waitFor(
      () => expect(screen.getByText(/Parse error: expression ends after an operator/)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });
});
