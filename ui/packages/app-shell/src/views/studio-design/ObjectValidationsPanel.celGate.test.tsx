// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object validations panel must REPORT its blocking CEL verdicts upward,
 * so the Data pillar's "Save draft" can refuse to write a validation rule
 * whose guard does not parse — objectui#4527 phase 2.
 *
 * This is the sixth `ConditionBuilder` consumer, surfaced by PR #4547's census
 * and not named on the original card. It does NOT own a Save: its own header
 * says the panel `onPatch({ validations })`s and "the Data pillar's Save draft
 * owns the write", so what it needs is a reporting channel, not a button.
 *
 * ## Master-detail changes what "multi-instance" means here
 *
 * The panel is a rule LIST plus a detail pane, so only the SELECTED rule's
 * ConditionBuilder is ever mounted. Two consequences the derivation must get
 * right:
 *
 *  - A faulty rule that is no longer selected is still faulty, and saving
 *    would still publish it — so its verdict must SURVIVE deselection. That is
 *    correctness, not a wedge: the rule stays reachable and fixable by
 *    selecting it again.
 *  - A DELETED rule's editor can never retract its verdict, so the count is
 *    derived against the live rule-name set. Deleting the faulty rule must
 *    drop it immediately or Save wedges shut with nothing left to fix.
 *
 * Known limit, pinned deliberately by the "never opened" case below: the panel
 * can only report on rules whose editor has actually rendered, because the
 * lint lives in the editor. A faulty rule the author never opens is not
 * counted. That is a strict improvement on today (no gating at all) and is the
 * mechanical scope the #4527 phase-2 ruling asked for.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

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
      introspectScope: () => ({ fields: ['status'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

const rule = (name: string) => ({
  type: 'script',
  name,
  label: name,
  message: 'nope',
  severity: 'error',
  active: true,
});

/** Controlled harness — the panel is controlled through `onPatch`. */
function Harness({ names, report }: { names: string[]; report: (n: number) => void }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'invoice',
    fields: { status: { type: 'text' } },
    validations: names.map(rule),
  });
  return (
    <ObjectValidationsPanel
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onBlockingIssuesChange={report}
    />
  );
}

function renderPanel(names: string[]) {
  const report = vi.fn();
  render(<Harness names={names} report={report} />);
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current };
}

/** Switch the selected rule's builder into raw CEL mode and return its editor. */
function rawEditor(): HTMLTextAreaElement {
  fireEvent.click(screen.getByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

/** Select a rule in the master list. */
const selectRule = (name: string) => fireEvent.click(screen.getByText(name));

describe('ObjectValidationsPanel — blocking CEL issues reach the Data pillar (#4527)', () => {
  it("counts a rule guard that does not parse", async () => {
    stubEngine();
    const { current } = renderPanel(['rule_a']);
    fireEvent.change(rawEditor(), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean guard as zero, so a valid rule never blocks Save', async () => {
    stubEngine();
    const { current } = renderPanel(['rule_a']);
    fireEvent.change(rawEditor(), { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('re-enables Save when the author fixes the guard', async () => {
    stubEngine();
    const { current } = renderPanel(['rule_a']);
    const box = rawEditor();
    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  /**
   * A faulty rule stays counted once the author moves to another rule — it is
   * still in the document and saving would still publish it.
   */
  it('keeps a faulty rule counted after the author selects a different rule', async () => {
    stubEngine();
    const { current } = renderPanel(['rule_a', 'rule_b']);
    fireEvent.change(rawEditor(), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    selectRule('rule_b');
    fireEvent.change(rawEditor(), { target: { value: "record.status == 'open'" } });
    // rule_b is clean, but rule_a's fault survives its deselection.
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  /**
   * DECISIVE — the prune. A deleted rule's editor is gone and can never report
   * `0`, so a remembered verdict would hold Save shut with nothing to fix.
   */
  it('drops the count when the faulty rule is deleted, so Save cannot wedge shut', async () => {
    stubEngine();
    const { current } = renderPanel(['rule_a']);
    fireEvent.change(rawEditor(), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    // The rule's own delete affordance is the BUTTON: queried by role, so no
    // other text on the page that says Delete can be clicked in its place.
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });
});
