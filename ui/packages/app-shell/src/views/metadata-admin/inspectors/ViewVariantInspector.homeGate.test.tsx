// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The View "home" panel must report its blocking CEL verdicts too —
 * objectui#4527 phase 2.
 *
 * Phase 1 (PR #4547) wired `ViewVariantInspector`'s aggregation and forwarded
 * the channel through `ViewInspector`, the SCOPED router. The HOME path goes
 * through `ViewDefaultInspector` instead, a `MetadataDefaultInspectorProps`
 * component whose contract had no blocking-issues member — so the very same
 * inspector, reached with no selection, reported nothing and Save stayed
 * writable on a formatting rule that does not parse.
 *
 * That asymmetry is the whole point of this suite: the aggregation is already
 * proven by
 * {@link file://./ViewVariantInspector.celGate.test.tsx}; what is pinned here
 * is that the HOME route carries the channel, so the fix cannot be "wired on
 * one of the two paths a user can reach the same editor by".
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry';

// objectui#4697 — ViewDefaultInspector renders ViewVariantInspector with no
// `objectFieldsOverride`, so useObjectFields(binding.value) and
// useObjectOptions() both fetch for real. Stub the shared client so neither
// escapes to the real network; see PageBlockInspector.i18n.test.tsx for the
// full mechanism.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ViewDefaultInspector } from './ViewInspector';
import { __setCelFormulaLoader } from '../celAuthoring';

/**
 * TYPE-LEVEL pin, and the only thing on this path that was actually broken.
 *
 * `ViewDefaultInspector` spreads `{...props}` into `ViewVariantInspector`, so
 * once phase 1 taught the variant inspector to aggregate, the callback ALREADY
 * reached it at runtime — the two render cases below pass before phase 2 as
 * well as after, and are pins rather than red signals (reported as such).
 *
 * What was missing is the CONTRACT: `MetadataDefaultInspectorProps` did not
 * declare the member, so no host could pass it without a type error and none
 * did. This assertion is the red one — it fails to compile in the
 * `tsconfig.test.json` pass until the contract carries the channel.
 */
export const _contractCarriesBlockingChannel: Required<
  Pick<MetadataDefaultInspectorProps, 'onBlockingIssuesChange'>
> = { onBlockingIssuesChange: () => {} };

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
function Harness({ report }: { report: (n: number) => void }) {
  const [draft, setDraft] = React.useState(viewDraft([{ condition: '', style: {} }]));
  return (
    <ViewDefaultInspector
      type="view"
      name="invoices"
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US' as never}
      onBlockingIssuesChange={report}
    />
  );
}

const ruleBox = (i: number) =>
  screen.getByTestId(`cf-rule-${i}`).querySelector('[role="combobox"]') as HTMLTextAreaElement;

describe('ViewDefaultInspector — the home panel reports blocking CEL issues too (#4527)', () => {
  it('counts a formatting condition that does not parse on the HOME path', async () => {
    stubEngine();
    const report = vi.fn();
    render(<Harness report={report} />);
    const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;

    fireEvent.change(ruleBox(0), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean rule as zero on the HOME path', async () => {
    stubEngine();
    const report = vi.fn();
    render(<Harness report={report} />);
    const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;

    fireEvent.change(ruleBox(0), { target: { value: "record.status == 'overdue'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });
});
