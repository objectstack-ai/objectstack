// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ConditionBuilder` must REPORT its raw-editor CEL verdict upward, so the
 * inspector above it can aggregate and the host that owns Save can refuse to
 * publish a parse fault — objectui#4527, the same ungated-Save family as #4306.
 *
 * `CelPredicateField` has always reported through `onLintChange`; this mount
 * site passed no listener at all, so a predicate that does not parse rendered
 * its inline error and Save stayed writable. Four inspectors reach this file.
 *
 * ## Why the PRUNE case is the decisive one
 *
 * The raw CEL editor is mounted ONLY in raw mode — the row builder has no
 * `CelPredicateField` at all. So the editor can vanish while its last verdict
 * was "1 error": the adopt effect (an externally-changed `value` that round
 * trips as a simple predicate) flips `raw` false in the same commit, which
 * unmounts the editor and cancels its pending debounced lint. Nothing will
 * ever report `0` for it again. A naive implementation that just remembers the
 * last count therefore WEDGES Save shut with no editor left on screen to fix
 * it — which is why the count is DERIVED (`raw ? count : 0`) rather than
 * repaired by a reset effect (#4527 ruling item 2, mirroring #4306).
 *
 * The engine is stubbed deterministically — linting against the REAL engine is
 * `CelPredicateField.test.tsx`'s job; this suite tests WIRING, so the stub
 * treats "ends on a dangling binary operator" as the parse fault.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

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

/** The card's repro shape: a source left hanging on a binary operator. */
const DANGLING = /[*+\-/&|=<>]\s*$/;

function stubEngine(opts: { asWarning?: boolean } = {}) {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: (_role: string, input: unknown) => {
        const src = typeof input === 'string' ? input : String((input as { source?: string })?.source ?? '');
        if (!DANGLING.test(src)) return { ok: true, errors: [], warnings: [] };
        const issue = { message: 'Parse error: expression ends after an operator' };
        // The count is severity-gated: only `error` blocks Save, matching the
        // RLS editor and #4306. A warning-only verdict must report 0.
        return opts.asWarning
          ? { ok: true, errors: [], warnings: [issue] }
          : { ok: false, errors: [issue], warnings: [] };
      },
      introspectScope: () => ({
        fields: ['status', 'amount'],
        roots: ['record', 'user'],
        functions: ['has'],
      }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

/** `CelPredicateField` renders its editor as a combobox TEXTAREA. */
const rawEditor = () =>
  screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;

/**
 * Controlled harness — `ConditionBuilder` is a controlled editor, so the
 * committed CEL must round-trip or the second keystroke reverts the first.
 * `setExternally` simulates the parent replacing the value from somewhere
 * OTHER than this editor (a selection change, an edit elsewhere), which is
 * what drives the adopt effect and, with it, the prune case.
 */
function Harness({
  initial = '',
  report,
  external,
  pass = true,
}: {
  initial?: string;
  report: (count: number) => void;
  external?: string;
  pass?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      {external !== undefined && (
        <button type="button" onClick={() => setValue(external)}>
          set externally
        </button>
      )}
      <ConditionBuilder
        label="Visible when"
        value={value}
        onCommit={setValue}
        objectName="invoice"
        fields={[{ name: 'status' }, { name: 'amount' }]}
        {...(pass ? { onBlockingIssuesChange: report } : {})}
      />
    </>
  );
}

/** Render, switch into the raw CEL editor, and expose the count a host would hold. */
function renderRaw(opts: { initial?: string; external?: string; pass?: boolean } = {}) {
  const report = vi.fn();
  render(<Harness report={report} {...opts} />);
  fireEvent.click(screen.getByText('Expression'));
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current };
}

describe('ConditionBuilder — the raw CEL editor reports blocking issues (#4527)', () => {
  it("counts the card's repro: a dangling operator in the expression editor", async () => {
    stubEngine();
    const { current } = renderRaw();
    fireEvent.change(rawEditor(), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean predicate as zero, so a valid expression never blocks Save', async () => {
    stubEngine();
    const { current } = renderRaw();
    fireEvent.change(rawEditor(), { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('re-enables Save when the author fixes the expression', async () => {
    stubEngine();
    const { current } = renderRaw();
    const box = rawEditor();
    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
    fireEvent.change(box, { target: { value: 'record.amount > 10' } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('counts only ERRORS — an advisory warning never blocks Save', async () => {
    stubEngine({ asWarning: true });
    const { current } = renderRaw();
    fireEvent.change(rawEditor(), { target: { value: 'record.status ==' } });
    // Prove a verdict was actually produced and rendered, so the `0` below is
    // "the warning was not counted" rather than "no lint ever ran".
    await waitFor(
      () => expect(screen.getByText(/Parse error: expression ends after an operator/)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(current()).toBe(0);
  });

  /**
   * DECISIVE — the prune. An externally-replaced value that round-trips as a
   * simple predicate flips the builder out of raw mode in the same commit,
   * unmounting the CEL editor and cancelling its pending lint. Nothing reports
   * `0` afterwards, so a remembered count would hold Save shut forever.
   */
  it('drops the verdict when the raw editor unmounts, so Save cannot wedge shut', async () => {
    stubEngine();
    const { current } = renderRaw({ external: "record.status == 'open'" });

    fireEvent.change(rawEditor(), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'set externally' }));
    // The raw editor is gone — the row builder took over.
    await waitFor(() => expect(screen.queryByText('Expression')).toBeInTheDocument(), { timeout: 3000 });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('stays mountable with no reporter attached — the prop is optional', async () => {
    stubEngine();
    const { report } = renderRaw({ pass: false });
    fireEvent.change(rawEditor(), { target: { value: 'record.status ==' } });
    // The inline error still renders; nothing throws, nothing is reported.
    await waitFor(
      () => expect(screen.getByText(/Parse error: expression ends after an operator/)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(report).not.toHaveBeenCalled();
  });
});
