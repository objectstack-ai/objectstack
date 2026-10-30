// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27644 — the served error at `verdictPath` counts as blocking in
 * the ROW builder too.
 *
 * The raw editor reports the server's errors through `CelPredicateField`'s
 * lint report (objectstack#27482), but the row builder mounts no CEL editor,
 * and a stored guard the publish refuses (`record.amount > 100`, an ordering
 * compare on a nullable field) round-trips as a row. So the builder reads the
 * same hold itself: while `value` is the judged text it shows the server's
 * message and reports it; once the row is edited away it reports none.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder } from './ConditionBuilder';
import { DraftVerdictBodyContext, DraftVerdictContext } from '../draftVerdict';
import { __setCelFormulaLoader } from '../celAuthoring';

const REFUSED = 'record.amount > 100';
const REFUSAL = "validation rule 'amount_cap' applies `>` to `record.amount`, which may be null";
const PATH = 'validations.0.condition';
const VERDICT = { valid: false, errors: [{ path: PATH, message: REFUSAL, code: 'expression-invalid' }] };
const JUDGED = { validations: [{ name: 'amount_cap', condition: REFUSED }] };
const FIELDS = [{ name: 'amount', label: 'Amount', type: 'number' }];

beforeEach(() => {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
      introspectScope: () => ({ fields: ['amount'], roots: ['record'], functions: [] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
});
afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

function Host({ verdictPath, onCount }: { verdictPath?: string; onCount: (n: number) => void }) {
  const [value, setValue] = React.useState(REFUSED);
  return (
    <DraftVerdictContext.Provider value={VERDICT}>
      <DraftVerdictBodyContext.Provider value={JUDGED}>
        <ConditionBuilder
          value={value}
          onCommit={setValue}
          fields={FIELDS}
          scope="record"
          verdictPath={verdictPath}
          onBlockingIssuesChange={onCount}
        />
      </DraftVerdictBodyContext.Provider>
    </DraftVerdictContext.Provider>
  );
}

describe('ConditionBuilder — the row builder counts the served hold (objectstack#27644)', () => {
  it('opens the refused guard as a row, shows the server message and reports it as blocking', async () => {
    const onCount = vi.fn();
    render(<Host verdictPath={PATH} onCount={onCount} />);
    // Row mode: the value input, no raw CEL editor.
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
    expect(screen.queryAllByRole('combobox').some((el) => el.tagName === 'TEXTAREA')).toBe(false);
    expect(screen.getByTestId('cel-server-error')).toHaveTextContent(REFUSAL);
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));
  });

  it('editing the row away releases: no message, 0 reported', async () => {
    const onCount = vi.fn();
    render(<Host verdictPath={PATH} onCount={onCount} />);
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));

    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '50' } });

    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(0));
    expect(screen.queryByTestId('cel-server-error')).toBeNull();
  });

  it('control: without a verdictPath the builder reads no verdict', async () => {
    const onCount = vi.fn();
    render(<Host onCount={onCount} />);
    await waitFor(() => expect(onCount).toHaveBeenCalled());
    expect(onCount).toHaveBeenLastCalledWith(0);
    expect(screen.queryByTestId('cel-server-error')).toBeNull();
  });
});
