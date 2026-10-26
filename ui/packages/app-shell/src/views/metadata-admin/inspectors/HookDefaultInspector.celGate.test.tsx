// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Hook inspector must REPORT its blocking CEL verdict upward, so the host
 * that owns Save can refuse to publish a guard that does not parse —
 * objectui#4527 phase 2.
 *
 * Phase 1 (PR #4547) wired the SCOPED inspector family through
 * `MetadataInspectorProps.onBlockingIssuesChange`. This inspector is a DEFAULT
 * inspector: it takes `MetadataDefaultInspectorProps`, whose contract carried
 * no such member, so its "Run only when" guard rendered its inline parse error
 * and Save still saved. Phase 2 extends that contract symmetrically.
 *
 * The engine is stubbed deterministically — the live lint is
 * `CelPredicateField.test.tsx`'s job; this suite tests WIRING.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HookSchema } from '@objectstack/spec/data';

// objectui#4697 — HookDefaultInspector calls useObjectOptions() unconditionally
// (the "Object(s) this hook fires on" picker) even though every fixture here
// uses `object: '*'` and never renders the picker's options. Stub the shared
// client so that mount-time fetch doesn't escape to the real network; see
// PageBlockInspector.i18n.test.tsx for the full mechanism.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { HookDefaultInspector } from './HookDefaultInspector';
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
 * Author a hook the way a user does and parse it with the spec. `object: '*'`
 * keeps ConditionBuilder in raw/no-catalog mode, so no field fetch is involved
 * — the reporting channel is what is under test.
 */
function hookDraft(condition?: unknown): Record<string, unknown> {
  return HookSchema.parse({
    name: 'guard_hook',
    object: '*',
    events: ['beforeInsert'],
    handler: 'guard_fn',
    ...(condition === undefined ? {} : { condition }),
  }) as unknown as Record<string, unknown>;
}

/**
 * Stateful harness — the inspector is CONTROLLED, so the committed guard must
 * round-trip through the draft or the next keystroke reverts the last one and
 * the editor never lints what the author typed.
 */
function Harness({ initial, report }: { initial: Record<string, unknown>; report: (n: number) => void }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <HookDefaultInspector
      type="hook"
      name="guard_hook"
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale={'en-US' as never}
      onBlockingIssuesChange={report}
    />
  );
}

/** Render and switch the guard into its raw CEL editor. */
function renderRaw(condition?: unknown) {
  const report = vi.fn();
  render(<Harness initial={hookDraft(condition)} report={report} />);
  fireEvent.click(screen.getByText('Expression'));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  const current = () => report.mock.calls.at(-1)?.[0] as number | undefined;
  return { report, current, box };
}

describe('HookDefaultInspector — blocking CEL issues reach the host (#4527)', () => {
  it('counts a "Run only when" guard that does not parse', async () => {
    stubEngine();
    const { current, box } = renderRaw();
    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
  });

  it('reports a clean guard as zero, so a valid condition never blocks Save', async () => {
    stubEngine();
    const { current, box } = renderRaw();
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });

  it('re-enables Save when the author fixes the guard', async () => {
    stubEngine();
    const { current, box } = renderRaw();
    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await waitFor(() => expect(current()).toBe(1), { timeout: 3000 });
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(current()).toBe(0), { timeout: 3000 });
  });
});
