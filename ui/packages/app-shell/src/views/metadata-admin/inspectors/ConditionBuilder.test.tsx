// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConditionBuilder raw-expression mode = CEL editor (#1582).
 *
 * The bare <textarea> escape hatch is replaced by CelPredicateField, so the
 * surfaces that route conditions through this builder — field-level
 * `visibleWhen`/`readonlyWhen`/`requiredWhen` (via SchemaForm's condition
 * widget) and action `visible`/`disabled` (ActionDefaultInspector) — get
 * inline lint + field autocomplete on the canonical engine.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// objectui#4697 — ConditionBuilder calls useObjectFields(objectName)
// unconditionally even when a `fields` prop is supplied (the prop only
// overrides the VALUE used, not whether the hook's own effect fetches). Stub
// the shared client so that mount-time fetch doesn't escape to the real
// network; see PageBlockInspector.i18n.test.tsx for the full mechanism.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder } from './ConditionBuilder';
import { __setCelFormulaLoader } from '../celAuthoring';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

const FIELDS = [
  { name: 'status', label: 'Status' },
  { name: 'amount', label: 'Amount' },
];

/** Controlled harness: `record.status in [...]` can't round-trip through the
 * no-code builder, so the component opens in RAW mode. */
function Harness({ initial }: { initial: string }) {
  const [v, setV] = React.useState(initial);
  return (
    <div>
      <ConditionBuilder label="Visible when" value={v} onCommit={setV} objectName="invoice" fields={FIELDS} />
      <pre data-testid="committed">{v}</pre>
    </div>
  );
}

const RAW_INIT = "record.status in ['sent', 'paid']";

describe('ConditionBuilder raw mode — CEL editor (#1582)', () => {
  it('renders the CEL editor (not a bare textarea) and commits edits', () => {
    render(<Harness initial={RAW_INIT} />);
    // CelPredicateField's textarea is a combobox (autocomplete host).
    const ta = screen.getByRole('combobox') as HTMLTextAreaElement;
    expect(ta.value).toBe(RAW_INIT);

    fireEvent.change(ta, { target: { value: "record.amount > 100" } });
    expect(screen.getByTestId('committed').textContent).toBe('record.amount > 100');
  });

  it('surfaces a lint error inline for an invalid predicate', async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({
          ok: false,
          errors: [{ message: 'Unknown variable: statuss' }],
          warnings: [],
        }),
      }),
    );
    // `in [...]` can't round-trip the no-code builder → opens in raw mode.
    render(<Harness initial={"statuss in ['open']"} />);
    await waitFor(
      () => expect(screen.getByText(/Unknown variable: statuss/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("autocompletes the object's field names as you type", async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        introspectScope: () => ({
          fields: ['status', 'amount'],
          roots: ['record', 'current_user'],
          functions: ['has'],
        }),
      }),
    );
    const user = userEvent.setup();
    render(<Harness initial={RAW_INIT} />);
    const ta = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, 'sta');
    const option = await screen.findByRole('option', { name: /status/i }, { timeout: 3000 });
    expect(option).toBeTruthy();
  });

  it('keeps the no-code builder path for simple conditions (unchanged)', () => {
    const { container } = render(<Harness initial={"record.status == 'open'"} />);
    // Round-trippable → builder mode: no CEL textarea, the compiled CEL chip is
    // shown instead. (Builder-mode Selects are also role=combobox, so assert on
    // the textarea element specifically.)
    expect(container.querySelector('textarea')).toBeNull();
    // Compiled-CEL chip + the harness <pre> both echo the value.
    expect(screen.getAllByText("record.status == 'open'").length).toBeGreaterThanOrEqual(1);
  });
});
