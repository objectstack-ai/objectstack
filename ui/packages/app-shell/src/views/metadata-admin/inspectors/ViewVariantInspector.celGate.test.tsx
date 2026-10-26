// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The View variant inspector must REPORT its blocking CEL verdicts through the
 * `MetadataInspectorProps.onBlockingIssuesChange` channel #4536 shipped, so the
 * host that owns Save can refuse to publish a parse fault — objectui#4527.
 *
 * The variant inspector authors `conditionalFormatting` through
 * {@link ConditionalFormattingEditor}, one `CelPredicateField` per rule. That
 * mount site passed no `onLintChange`, so a condition that does not parse
 * rendered its inline error and Save stayed writable.
 *
 * ## Reachability note (the reason `ViewInspector` is exercised here too)
 *
 * `ViewVariantInspector` is reached two ways: SCOPED, through `ViewInspector`
 * (a `MetadataInspectorProps` component, which therefore carries the channel),
 * and HOME, through `ViewDefaultInspector` (a `MetadataDefaultInspectorProps`
 * component, whose contract has no such channel — see #4527's report). Only the
 * scoped path can report today, so the forwarding through `ViewInspector` is
 * pinned explicitly: without it the channel stops one component short of the
 * editor and the whole wiring is inert.
 *
 * The editor-side per-rule map and prune are pinned in
 * {@link file://../ConditionalFormattingEditor.celGate.test.tsx}.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// objectui#4697 — ViewVariantInspector calls useObjectOptions() (the object
// picker) unconditionally, and useObjectFields(binding.value, override) skips
// its fetch only when an override is supplied — the `viaViewInspector` path
// below reaches ViewInspector, which forwards no override, so that leg still
// fetches for real. Stub the shared client so neither escapes to the real
// network; see PageBlockInspector.i18n.test.tsx for the full mechanism.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ViewVariantInspector } from './ViewVariantInspector';
import { ViewInspector } from './ViewInspector';
import { __setCelFormulaLoader } from '../celAuthoring';

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

const FIELDS = [
  { name: 'status', label: 'Status', type: 'text', hidden: false },
  { name: 'amount', label: 'Amount', type: 'number', hidden: false },
];

/** A `view` draft whose primary (list) variant carries formatting rules. */
function viewDraft(rules: unknown[]): Record<string, unknown> {
  return {
    name: 'invoices',
    label: 'Invoices',
    list: {
      type: 'grid',
      object: 'invoice',
      columns: ['status', 'amount'],
      conditionalFormatting: rules,
    },
  };
}

/** Controlled harness — patches must round-trip or the second edit reverts. */
function Harness({
  initial,
  report,
  viaViewInspector = false,
}: {
  initial: Record<string, unknown>;
  report: (n: number) => void;
  viaViewInspector?: boolean;
}) {
  const [draft, setDraft] = React.useState(initial);
  const onPatch = (patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }));

  if (viaViewInspector) {
    // The SCOPED path exactly as the host mounts it.
    return (
      <ViewInspector
        type="view"
        name="invoices"
        draft={draft}
        selection={{ kind: 'view', id: 'list' }}
        onPatch={onPatch}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        onBlockingIssuesChange={report}
        readOnly={false}
        locale={'en-US'}
      />
    );
  }
  return (
    <ViewVariantInspector
      type="view"
      name="invoices"
      draft={draft}
      onPatch={onPatch}
      onSelectionChange={() => {}}
      onClearSelection={() => {}}
      onBlockingIssuesChange={report}
      readOnly={false}
      locale={'en-US'}
      variantKey="list"
      familyKey="list"
      isHome={false}
      objectFieldsOverride={FIELDS}
    />
  );
}

function renderInspector(rules: unknown[], viaViewInspector = false) {
  const report = vi.fn();
  render(<Harness initial={viewDraft(rules)} report={report} viaViewInspector={viaViewInspector} />);
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current };
}

const ruleBox = (i: number) =>
  screen.getByTestId(`cf-rule-${i}`).querySelector('[role="combobox"]') as HTMLTextAreaElement;

describe('ViewVariantInspector — blocking CEL issues reach the host (#4527)', () => {
  it('counts a formatting condition that does not parse', async () => {
    stubEngine();
    const { current } = renderInspector([{ condition: "record.status == 'a'", style: {} }]);
    fireEvent.change(ruleBox(0), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean rule as zero, so a valid condition never blocks Save', async () => {
    stubEngine();
    const { current } = renderInspector([{ condition: '', style: {} }]);
    fireEvent.change(ruleBox(0), { target: { value: "record.status == 'overdue'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('drops the count when the faulty rule is deleted, so Save cannot wedge shut', async () => {
    stubEngine();
    const { current } = renderInspector([{ condition: '', style: {} }]);
    fireEvent.change(ruleBox(0), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    fireEvent.click(screen.getByTestId('cf-remove-0'));
    await waitFor(() => expect(screen.queryByTestId('cf-rule-0')).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  /** The channel must survive the scoped router, or the wiring is inert. */
  it('is reported through ViewInspector on the scoped path', async () => {
    stubEngine();
    const { current } = renderInspector([{ condition: '', style: {} }], true);
    fireEvent.change(ruleBox(0), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });
});
