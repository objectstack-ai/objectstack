// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27485 — a formula that does not parse keeps the field's stored
 * `returnType`.
 *
 * The inspector stamps `returnType` from the formula's inferred CEL type once
 * the author edits it. A source with a parse fault infers no type (`unknown`),
 * so every keystroke that broke the formula cleared the stored type, and the
 * broken body reached the server without it. The stamp is now settled from the
 * editor's two verdicts on one source: a source with a lint error proves no
 * type and the stored one stays; a source that lints clean stamps the proven
 * type, or clears it when none is proven, as before.
 *
 * The engine is stubbed so both verdicts are deterministic; the live lint and
 * inference are CelPredicateField.test.tsx's job.
 */

import '@testing-library/jest-dom/vitest';
// The source loads these lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/formula';
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { __setCelFormulaLoader } from '../celAuthoring';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

/** The card's repro shape: a source left open on a bracket or an operator. */
const BROKEN = /[*+\-/&|=<>(]\s*$/;

function stubEngine() {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: (_role: string, input: unknown) => {
        const src = typeof input === 'string' ? input : String((input as { source?: string })?.source ?? '');
        return BROKEN.test(src)
          ? { ok: false, errors: [{ message: 'Parse error: unexpected end of input' }], warnings: [] }
          : { ok: true, errors: [], warnings: [] };
      },
      introspectScope: () => ({ fields: ['est_hours', 'budget'], roots: ['record'], functions: ['has'] }),
      // A broken source proves no type, as the engine answers it.
      inferExpressionType: (input: unknown) => {
        const src = typeof input === 'string' ? input : '';
        if (BROKEN.test(src)) return 'unknown' as const;
        if (src.includes("'")) return 'text' as const;
        if (src.includes('+')) return 'unknown' as const;
        // A field-over-field operator types `dyn`, as the engine answers it
        // (formula-return.ts): the quotient's type is unproven.
        if (/record\.\w+\s*\/\s*record\./.test(src)) return 'unknown' as const;
        if (src.includes('>')) return 'boolean' as const;
        return 'number' as const;
      },
    }),
  );
}

function Harness({ onDef, returnType = 'number' }: { onDef: (def: Record<string, unknown>) => void; returnType?: string }) {
  const [fields, setFields] = React.useState<Record<string, Record<string, unknown>>>({
    est_hours: { type: 'number' },
    f_total: { type: 'formula', label: 'F Total', expression: 'record.est_hours * 2', returnType },
  });
  React.useEffect(() => {
    onDef(fields.f_total);
  });
  return (
    <ObjectFieldInspector
      type="object"
      name="work_order"
      draft={{ name: 'work_order', fields }}
      selection={{ kind: 'field', id: 'f_total' }}
      onPatch={(patch: Record<string, unknown>) => setFields(patch.fields as typeof fields)}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
      onBlockingIssuesChange={() => {}}
    />
  );
}

function renderFormula(returnType?: string) {
  stubEngine();
  const defs: Array<Record<string, unknown>> = [];
  render(<Harness onDef={(def) => defs.push(def)} returnType={returnType} />);
  const box = screen.getByText('Formula (CEL)').parentElement!.querySelector('[role="combobox"]') as HTMLTextAreaElement;
  const latest = () => defs.at(-1)!;
  return { box, latest };
}

const settle = () => new Promise((r) => setTimeout(r, 600));

describe('ObjectFieldInspector — a broken formula keeps the stored returnType (objectstack#27485)', () => {
  it("the card's repro: `record.est_hours > (` leaves returnType as stored", async () => {
    const { box, latest } = renderFormula();
    fireEvent.change(box, { target: { value: 'record.est_hours > (' } });
    await waitFor(() => expect(screen.getByText(/Parse error/)).toBeInTheDocument(), { timeout: 3000 });
    await settle();
    expect(latest().expression).toBe('record.est_hours > (');
    expect(latest().returnType).toBe('number');
  });

  it('a source that parses again stamps its proven type', async () => {
    const { box, latest } = renderFormula();
    fireEvent.change(box, { target: { value: 'record.est_hours > (' } });
    await waitFor(() => expect(screen.getByText(/Parse error/)).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(box, { target: { value: "'hours: ' + string(record.est_hours)" } });
    await waitFor(() => expect(latest().returnType).toBe('text'), { timeout: 3000 });
  });

  it('a source that parses and proves no type still clears it, as before', async () => {
    const { box, latest } = renderFormula();
    fireEvent.change(box, { target: { value: 'record.est_hours + record.est_hours' } });
    await waitFor(() => expect(latest().returnType).toBeUndefined(), { timeout: 3000 });
  });
});

describe('ObjectFieldInspector — a declared percent survives a number verdict (objectstack#35047)', () => {
  it('an edit the engine proves `number` keeps `percent`: nothing infers a percentage', async () => {
    const { box, latest } = renderFormula('percent');
    fireEvent.change(box, { target: { value: 'record.est_hours / 40' } });
    await waitFor(() => expect(latest().expression).toBe('record.est_hours / 40'), { timeout: 3000 });
    await settle();
    expect(latest().returnType).toBe('percent');
  });

  it('a verdict that is not `number` still stamps over it', async () => {
    const { box, latest } = renderFormula('percent');
    fireEvent.change(box, { target: { value: "'hours: ' + string(record.est_hours)" } });
    await waitFor(() => expect(latest().returnType).toBe('text'), { timeout: 3000 });
  });

  it('CONTROL — a declared `number` takes the `number` verdict, as before', async () => {
    const { box, latest } = renderFormula();
    fireEvent.change(box, { target: { value: 'record.est_hours / 40' } });
    await waitFor(() => expect(latest().expression).toBe('record.est_hours / 40'), { timeout: 3000 });
    await settle();
    expect(latest().returnType).toBe('number');
  });
});

describe('ObjectFieldInspector — a declared percent or currency survives an unproven verdict (objectstack#35047)', () => {
  const RATIO = 'record.est_hours / record.budget';

  it("the spec's ratio shape: a field-over-field quotient proves no type and keeps `percent`", async () => {
    const { box, latest } = renderFormula('percent');
    fireEvent.change(box, { target: { value: RATIO } });
    await waitFor(() => expect(latest().expression).toBe(RATIO), { timeout: 3000 });
    await settle();
    expect(latest().returnType).toBe('percent');
  });

  it('the same quotient keeps a declared `currency`', async () => {
    const { box, latest } = renderFormula('currency');
    fireEvent.change(box, { target: { value: RATIO } });
    await waitFor(() => expect(latest().expression).toBe(RATIO), { timeout: 3000 });
    await settle();
    expect(latest().returnType).toBe('currency');
  });

  it('a `number` verdict keeps a declared `currency` too', async () => {
    const { box, latest } = renderFormula('currency');
    fireEvent.change(box, { target: { value: 'record.est_hours / 40' } });
    await waitFor(() => expect(latest().expression).toBe('record.est_hours / 40'), { timeout: 3000 });
    await settle();
    expect(latest().returnType).toBe('currency');
  });

  it('a verdict that proves another type still stamps over a declared `currency`', async () => {
    const { box, latest } = renderFormula('currency');
    fireEvent.change(box, { target: { value: 'record.est_hours > 40' } });
    await waitFor(() => expect(latest().returnType).toBe('boolean'), { timeout: 3000 });
  });

  it('CONTROL — the same quotient still clears a declared `number`, as before', async () => {
    const { box, latest } = renderFormula();
    fireEvent.change(box, { target: { value: RATIO } });
    await waitFor(() => expect(latest().returnType).toBeUndefined(), { timeout: 3000 });
  });
});
