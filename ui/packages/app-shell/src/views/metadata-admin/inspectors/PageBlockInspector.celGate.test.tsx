// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Page block inspector must REPORT its blocking CEL verdict through the
 * `MetadataInspectorProps.onBlockingIssuesChange` channel #4536 shipped, so the
 * host that owns Save can refuse to publish a parse fault — objectui#4527.
 *
 * The block inspector authors `visibleWhen` through {@link ConditionBuilder}
 * (#3229), whose raw-expression editor is a `CelPredicateField`. That mount
 * site passed no `onLintChange`, so `record.amount >` rendered its inline parse
 * error and Save stayed writable — the #4306 defect, one inspector over.
 *
 * What is pinned here is the INSPECTOR half: the count reaching the contract.
 * The engine is stubbed deterministically; the live lint is
 * `CelPredicateField.test.tsx`'s job, and the editor-side derivation is pinned
 * in {@link file://./ConditionBuilder.celGate.test.tsx}.
 *
 * FIXTURE DISCIPLINE (the sibling suite's method): no envelope is hand-written
 * — the fixture is authored input fed through `PageSchema.parse`, so it cannot
 * drift from the spec.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';

import { PageBlockInspector } from './PageBlockInspector';
import { __setCelFormulaLoader } from '../celAuthoring';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

const BLOCK_PATH = 'regions[0].components[0]';
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
      introspectScope: () => ({ fields: ['amount'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

function pageDraft(block: Record<string, unknown>): Record<string, unknown> {
  return PageSchema.parse({
    name: 'home',
    label: 'Home',
    type: 'home',
    template: 'default',
    regions: [{ name: 'main', components: [{ type: 'text', id: 'b1', ...block }] }],
  }) as unknown as Record<string, unknown>;
}

/** Stateful harness — the inspector is controlled, so patches must round-trip. */
function Harness({ initial, report }: { initial: Record<string, unknown>; report: (n: number) => void }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <PageBlockInspector
      type="page"
      name="home"
      draft={draft}
      selection={{ kind: 'block', id: BLOCK_PATH }}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      onBlockingIssuesChange={report}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

/** Render and switch the visibility builder into its raw CEL editor. */
function renderRaw(block: Record<string, unknown> = { visibleWhen: 'record.amount > 10' }) {
  const report = vi.fn();
  render(<Harness initial={pageDraft(block)} report={report} />);
  fireEvent.click(screen.getByText('Expression'));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current, box };
}

describe('PageBlockInspector — blocking CEL issues reach the host (#4527)', () => {
  it("counts the card's repro: a dangling operator in `visibleWhen`", async () => {
    stubEngine();
    const { current, box } = renderRaw();
    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean predicate as zero, so a valid condition never blocks Save', async () => {
    stubEngine();
    const { current, box } = renderRaw();
    fireEvent.change(box, { target: { value: 'record.amount > 20' } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('re-enables Save when the author fixes the predicate', async () => {
    stubEngine();
    const { current, box } = renderRaw();
    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
    fireEvent.change(box, { target: { value: 'record.amount > 20' } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });
});
