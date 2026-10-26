/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { HeaderHighlight } from '../HeaderHighlight';

// Probe the LookupField editor so the reference-key tests can assert which
// relation target the enriched field carried. Everything else in
// @object-ui/fields stays real (cell renderers, other editors).
vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    LookupField: ({ field }: any) => (
      <div
        data-testid="lookup-editor"
        data-reference={field?.reference ?? ''}
        data-reference-to={field?.reference_to ?? ''}
        data-reference-field={field?.reference_field ?? ''}
      />
    ),
  };
});

/**
 * objectui#2407 P2 — the highlights strip becomes editable against the SHARED
 * record-level draft: double-click / pencil enters the same edit session as the
 * body, computed/readonly highlights expose no editor, and edits land in the
 * one draft the save bar commits.
 */

// Surfaces the shared draft so we can prove highlight edits land in the SAME
// draft the body + save bar read.
function DraftProbe() {
  const inline = useInlineEdit();
  return <div data-testid="draft">{JSON.stringify(inline?.draft ?? null)}</div>;
}

const objectSchema = {
  fields: {
    owner: { type: 'text' },
    score: { type: 'formula' }, // computed → never editable
  },
};
const fields = [{ name: 'owner', label: 'Owner' }, { name: 'score', label: 'Score' }] as any;
const data = { owner: 'Alice', score: '99' };

describe('HeaderHighlight — editable highlights (P2)', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  it('is read-only with no <InlineEditProvider> (bare usage)', () => {
    render(<HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Alice')).toBeNull();
  });

  it('double-clicking an editable highlight enters the shared edit session', () => {
    render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
        <DraftProbe />
      </InlineEditProvider>,
    );
    // Read mode: value shown, no editor.
    expect(screen.queryByDisplayValue('Alice')).toBeNull();
    fireEvent.doubleClick(screen.getByText('Alice'));
    // Now editable in place.
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
  });

  it('never exposes an editor for a computed highlight, even while editing', () => {
    render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
      </InlineEditProvider>,
    );
    fireEvent.doubleClick(screen.getByText('Alice')); // enter edit
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument(); // owner editable
    expect(screen.queryByDisplayValue('99')).toBeNull(); // score (formula) stays read-only
  });

  it('routes a highlight edit into the SHARED draft', () => {
    render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
        <DraftProbe />
      </InlineEditProvider>,
    );
    fireEvent.doubleClick(screen.getByText('Alice'));
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Bob' } });
    expect(screen.getByTestId('draft').textContent).toBe('{"owner":"Bob"}');
  });

  it('offers no editor when the record is not editable (canEdit=false)', () => {
    render(
      <InlineEditProvider canEdit={false}>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
      </InlineEditProvider>,
    );
    fireEvent.doubleClick(screen.getByText('Alice'));
    expect(screen.queryByDisplayValue('Alice')).toBeNull();
  });
});

/**
 * objectui#2407 P2 follow-up — backend object schemas use the
 * ObjectStack-convention `reference` key (e.g. showcase_project.account has
 * `"reference": "showcase_account"`), not `reference_to`. The strip must read
 * it (like DetailSection) or the lookup editor gets no target object: it can
 * neither hydrate the current value nor search candidates.
 *
 * ⭐ objectui#6837 half 2 narrowed the READ to that one key. `reference` is the
 * only target spelling `@objectstack/spec`'s `FieldSchema` declares; it refuses
 * `reference_to` by name with its own "did you mean -> `reference`?" rename.
 * Maintainer 2026-08-31: protocol normalization belongs on the SERVER, the
 * front end just executes the protocol (objectstack#13847 landed the server
 * half). The `reference_to` case below therefore asserts a REFUSAL now, and is
 * bounded by the choke-point control beside it.
 *
 * ⭐ objectui#11070 round 4 narrowed the key the strip WRITES as well.
 * `enrichDetailField` stamps `reference` onto the enriched field — the key
 * `FieldMetadata` / `DetailViewField`, ObjectUI's own contracts, declare since
 * that round, and the only one `LookupField` reads. Both halves are asserted
 * below: the read takes `reference`, the write emits `reference` and no
 * `reference_to`.
 */
describe('HeaderHighlight — lookup highlight reference-key normalization', () => {
  const lookupFields = [{ name: 'account', label: 'Account' }] as any;
  const lookupData = { account: 'acc-1' };

  // Enters the shared edit session on the lookup field directly (its read-mode
  // rendering of a bare id is not what these tests are about).
  function EnterEdit() {
    const inline = useInlineEdit();
    return (
      <button type="button" onClick={() => inline!.enter('account')}>
        enter-edit
      </button>
    );
  }

  const renderStrip = (accountField: Record<string, any>) => {
    render(
      <InlineEditProvider canEdit>
        <HeaderHighlight
          fields={lookupFields}
          data={lookupData}
          objectSchema={{ fields: { account: accountField } }}
        />
        <EnterEdit />
      </InlineEditProvider>,
    );
    fireEvent.click(screen.getByText('enter-edit'));
    return screen.getByTestId('lookup-editor');
  };

  it('passes the backend `reference` key to the LookupField as `reference`, and emits no `reference_to`', () => {
    const editor = renderStrip({
      type: 'lookup',
      reference: 'showcase_account',
      reference_field: 'name',
    });
    expect(editor.getAttribute('data-reference')).toBe('showcase_account');
    expect(editor.getAttribute('data-reference-to')).toBe('');
    expect(editor.getAttribute('data-reference-field')).toBe('name');
  });

  it('does NOT read `reference_to` off the object schema any more (objectui#6837 half 2)', () => {
    // This assertion is the inverse of what it was before half 2. It is a
    // REFUSAL, and the test above is its non-vacuous control: a strip that had
    // stopped resolving anything would satisfy this one too.
    const editor = renderStrip({ type: 'lookup', reference_to: 'showcase_account' });
    expect(editor.getAttribute('data-reference')).toBe('');
    expect(editor.getAttribute('data-reference-to')).toBe('');
  });

  it('a `reference_to`-only def that came through the ingestion choke point STILL resolves', () => {
    // What bounds the break: `normalizeSchemaReferenceKeys` folds a legacy
    // spelling onto `reference`, so any def that entered through
    // `MetadataProvider` or `ObjectStackAdapter.getObjectSchema` is unaffected.
    // Only a def that bypassed that door reaches this reader raw.
    const def = { type: 'lookup', reference_to: 'showcase_account' };
    normalizeSchemaReferenceKeys({ fields: { account: def } });
    const editor = renderStrip(def);
    expect(editor.getAttribute('data-reference')).toBe('showcase_account');
  });
});
