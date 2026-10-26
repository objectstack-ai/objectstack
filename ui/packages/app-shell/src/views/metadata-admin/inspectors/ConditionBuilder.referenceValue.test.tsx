// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConditionBuilder row mode — a value that is plainly a REFERENCE compiles as
 * one, instead of being quoted into a string literal (objectui#6293).
 *
 * The observable pinned here is the emitted CEL, not the UI state: `fmtValue`
 * quoted anything that was not a number / `true` / `false` / `null`, so
 * "this field differs from its prior value" — the idiom that DEFINES a
 * change-detection predicate — compiled to `previous == 'previous.status'`.
 * That parses, registers and evaluates, and is always false; nothing at any
 * layer objects, because `previous` is a declared root and a string literal's
 * contents are deliberately not scanned for references.
 *
 * Mounted through the real component and read off `onCommit`, because the
 * commit path above `fmtValue` is part of the defect — a unit test of the
 * formatter alone would not have caught a builder that never reaches it.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// objectui#4697 — ConditionBuilder calls useObjectFields(objectName)
// unconditionally even when a `fields` prop is supplied, so stub the shared
// client to keep the mount-time fetch off the network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder } from './ConditionBuilder';

afterEach(cleanup);

const FIELDS = [
  { name: 'status', label: 'Status' },
  { name: 'done', label: 'Done' },
];

/**
 * Controlled harness — the hook-condition surface, opened on `previous == null`
 * exactly as the card measured it (that round-trips, so the builder opens in
 * ROW mode with a live value box).
 */
function Harness({ initial }: { initial: string }) {
  const [v, setV] = React.useState(initial);
  return (
    <div>
      <ConditionBuilder
        label="Run only when"
        value={v}
        onCommit={setV}
        objectName="task"
        fields={FIELDS}
      />
      <pre data-testid="committed">{v}</pre>
    </div>
  );
}

/** Type into the row's live value box and return the CEL that was emitted. */
function typeIntoValueBox(text: string): string {
  const input = screen.getByPlaceholderText('value') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  return screen.getByTestId('committed').textContent ?? '';
}

describe('ConditionBuilder row mode — reference vs. literal in the value box (#6293)', () => {
  it('opens `previous == null` in ROW mode with a live value box (positive probe)', () => {
    const { container } = render(<Harness initial="previous == null" />);
    expect(container.querySelector('textarea')).toBeNull(); // not the raw CEL editor
    expect((screen.getByPlaceholderText('value') as HTMLInputElement).value).toBe('null');
  });

  it('compiles a value under a declared root as the REFERENCE it plainly is', () => {
    render(<Harness initial="previous == null" />);
    expect(typeIntoValueBox('previous.status')).toBe('previous == previous.status');
  });

  it('compiles `record.<field>` on the value side as a reference too', () => {
    render(<Harness initial="previous == null" />);
    expect(typeIntoValueBox('record.status')).toBe('previous == record.status');
  });

  it('CONTROL — a literal is still quoted', () => {
    render(<Harness initial="previous == null" />);
    expect(typeIntoValueBox('done')).toBe("previous == 'done'");
  });

  it('CONTROL — a number is still emitted unquoted', () => {
    render(<Harness initial="previous == null" />);
    expect(typeIntoValueBox('42')).toBe('previous == 42');
  });

  it('CONTROL — a dotted value under an UNDECLARED root is still quoted', () => {
    // The repair keys on the declared root vocabulary, not on "contains a dot":
    // `foo` is not a root any mounting surface binds, and `1.2.3` is a version
    // string. Both stay literal text.
    render(<Harness initial="previous == null" />);
    expect(typeIntoValueBox('foo.bar')).toBe("previous == 'foo.bar'");
    expect(typeIntoValueBox('1.2.3')).toBe("previous == '1.2.3'");
  });

  it('the emitted reference round-trips — reopening it stays in ROW mode', () => {
    // If it did not round-trip, the builder would flip to the raw CEL editor
    // the moment the author reopened the record they had just authored.
    const { container } = render(<Harness initial="record.status != previous.status" />);
    expect(container.querySelector('textarea')).toBeNull();
    expect((screen.getByPlaceholderText('value') as HTMLInputElement).value).toBe('previous.status');
  });

  it('is NOT retroactive — an already-stored quoted literal opens in RAW mode, never silently rewritten', () => {
    // A predicate already persisted as text (whether the author meant the text
    // or hit this defect) is not the builder's to reinterpret: it no longer
    // round-trips, so the component's existing safety rule hands it to the raw
    // CEL editor where the author can see both readings and decide.
    const { container } = render(<Harness initial="previous == 'previous.status'" />);
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(screen.getByTestId('committed').textContent).toBe("previous == 'previous.status'");
  });
});
