// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Action inspector must REPORT its blocking CEL verdicts upward, so the
 * host that owns Save can refuse to publish a predicate that does not parse —
 * objectui#4527 phase 2.
 *
 * This inspector mounts TWO ConditionBuilders — "Visible when" (`visible`) and
 * "Disabled when" (`disabled`) — and is a DEFAULT inspector, so before phase 2
 * it had no channel to report through at all.
 *
 * ## The decisive case
 *
 * Two editors report independently and asynchronously, so a single shared
 * counter lets whichever linted last overwrite the other: fixing "Visible when"
 * while "Disabled when" is still malformed would hand back a writable Save.
 * A shared counter passes every single-editor case below and fails only
 * {@link https://github.com/objectstack-ai/objectui/issues/4527 the both-faulty
 * case} — which is why the count is a per-SITE map, exactly as
 * ObjectFieldInspector's is.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

// objectui#4697 — ActionDefaultInspector calls useObjectOptions() and
// useObjectFields(objectName) unconditionally (the object/field pickers behind
// its two ConditionBuilders). Stub the shared client so that mount-time fetch
// doesn't escape to the real network; see PageBlockInspector.i18n.test.tsx for
// the full mechanism.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ActionDefaultInspector } from './ActionDefaultInspector';
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
      introspectScope: () => ({ fields: ['status'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

/**
 * Stateful harness — the inspector is CONTROLLED, so committed predicates must
 * round-trip through the draft or the next keystroke reverts the last one and
 * the editors never lint what the author typed.
 */
function Harness({ report }: { report: (n: number) => void }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'approve',
    label: 'Approve',
    type: 'script',
  });
  return (
    <ActionDefaultInspector
      type="action"
      name="approve"
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale={'en-US' as never}
      onBlockingIssuesChange={report}
    />
  );
}

function renderInspector() {
  const report = vi.fn();
  render(<Harness report={report} />);
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current };
}

/**
 * A ConditionBuilder's own root, located by its label — the two builders are
 * otherwise identical, so every interaction must be scoped to one of them.
 */
function builder(label: string): HTMLElement {
  return screen.getByText(label).parentElement!.parentElement! as HTMLElement;
}

/** Switch one builder into raw CEL mode and hand back its editor. */
function rawEditorFor(label: string): HTMLTextAreaElement {
  const root = builder(label);
  fireEvent.click(within(root).getByText('Expression'));
  return within(root)
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

describe('ActionDefaultInspector — blocking CEL issues reach the host (#4527)', () => {
  it('counts a "Visible when" predicate that does not parse', async () => {
    stubEngine();
    const { current } = renderInspector();
    fireEvent.change(rawEditorFor('Visible when'), { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('counts a "Disabled when" predicate that does not parse', async () => {
    stubEngine();
    const { current } = renderInspector();
    fireEvent.change(rawEditorFor('Disabled when'), { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports clean predicates as zero, so valid conditions never block Save', async () => {
    stubEngine();
    const { current } = renderInspector();
    fireEvent.change(rawEditorFor('Visible when'), { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  /**
   * DECISIVE — the per-site map. One shared counter passes every case above
   * and fails here: fixing one editor would drop the total to 0 while the
   * other predicate is still malformed.
   */
  it('keeps each editor independent — fixing one leaves the other counted', async () => {
    stubEngine();
    const { current } = renderInspector();
    const visible = rawEditorFor('Visible when');
    const disabled = rawEditorFor('Disabled when');

    fireEvent.change(visible, { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });

    fireEvent.change(disabled, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(current()).toBe(2), { timeout: 3000 });

    fireEvent.change(visible, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });
});
