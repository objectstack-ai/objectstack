// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework #3508 — the approver "Value" cell must source directory kinds
 * (`user` / `team` / `department`) from DATA records, not the metadata
 * registry: `GET /api/v1/meta/user` lists no `sys_user` rows, so the old
 * datalist was always empty and the control silently degraded to a raw-id text
 * box. `position` was a fourth until `@objectstack/spec` 18 bound it to the
 * registry itself (objectstack#22710, objectui#12030); its picker is the
 * registry arm, pinned by `FlowReferenceField.registrySource-7611.test.tsx`.
 *
 * Load-bearing behaviours:
 *   1. the record-lookup bindings mirror the ENGINE's resolution semantics
 *      (`plugin-approvals` resolveApproverSpec) — object names and the
 *      committed field;
 *   2. with an adapter, a directory kind renders the record lookup (with the
 *      manual-entry escape hatch — the author is never trapped);
 *   3. without an adapter (offline preview gallery) it degrades to free text
 *      and does NOT fall back to the metadata list;
 *   4. `org-membership-level` is a STRICT select (free text is how
 *      `sales_manager` got stored into a closed enum). The tier VOCABULARY —
 *      published-enum-first, spec-derived fallback — is covered in
 *      `FlowReferenceField.membershipTier.test.tsx` (objectui#5309);
 *   5. `manager` is auto-resolved (disabled cell + explanation);
 *   6. `queue` warns that the runtime resolves it to nobody.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => {
  const metaList = vi.fn(async () => [] as unknown[]);
  return {
    adapter: null as unknown,
    metaList,
    // STABLE identity, like the real memoized client: `useMetadataListOptions`
    // keys its effect on the client object, so a fresh `{ list }` per render
    // would setState → re-render → setState forever and hang the run.
    metadataClient: { list: metaList },
  };
});

// Static factories, matching AccessExplainPanel.test.tsx: app-shell tests stub
// `@object-ui/fields` and `@object-ui/react` rather than load their real
// graphs. LookupField's own behaviour (search, hydration through `idField`,
// commit-on-select) is covered in the fields package — this suite verifies
// the WIRING: which cell renders per kind, and what binding it receives.
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => state.adapter,
  // @object-ui/components wires this at module scope (related-count-store).
  subscribeDataChanges: () => () => {},
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  LookupField: (props: { field?: { reference?: string; idField?: string; multiple?: boolean; allowCreate?: boolean } }) => (
    <div
      data-testid="record-lookup"
      data-object={props.field?.reference}
      data-value-field={props.field?.idField}
      data-multiple={String(props.field?.multiple ?? false)}
      data-allow-create={String(props.field?.allowCreate)}
      data-field-keys={Object.keys(props.field ?? {}).sort().join(' ')}
    />
  ),
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { ReferenceCombobox, KIND_TO_RECORD_LOOKUP } from './FlowReferenceField';

afterEach(() => {
  cleanup();
  state.adapter = null;
  state.metaList.mockClear();
});

function makeAdapter() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async () => undefined),
  };
}

function renderRef(kind: string, props: Partial<React.ComponentProps<typeof ReferenceCombobox>> = {}) {
  return render(
    <ReferenceCombobox
      resolved={{ kind: kind as never }}
      value={props.value ?? ''}
      onCommit={props.onCommit ?? vi.fn()}
      onSelect={props.onSelect}
      disabled={props.disabled}
      placeholder={props.placeholder}
    />,
  );
}

describe('KIND_TO_RECORD_LOOKUP — engine contract (#3508)', () => {
  it('mirrors resolveApproverSpec: objects and committed fields', () => {
    // applyOooDelegation(String(value)) — a sys_user id.
    expect(KIND_TO_RECORD_LOOKUP.user).toMatchObject({ object: 'sys_user', valueField: 'id' });
    // find('sys_team_member', { team_id: value }) — a sys_team id.
    expect(KIND_TO_RECORD_LOOKUP.team).toMatchObject({ object: 'sys_team', valueField: 'id' });
    // find('sys_business_unit', { id: value }) — NOT a sys_department.
    expect(KIND_TO_RECORD_LOOKUP.department).toMatchObject({ object: 'sys_business_unit', valueField: 'id' });
    // `position` is the registry member since `@objectstack/spec` 18: its value
    // is the position's machine NAME, listed off `GET /api/v1/meta/position`,
    // so it has no record lookup at all (objectui#12030).
    expect(KIND_TO_RECORD_LOOKUP.position).toBeUndefined();
  });

  it('covers exactly the directory kinds — enum/auto/unsupported/registry kinds stay off the record path', () => {
    expect(Object.keys(KIND_TO_RECORD_LOOKUP).sort()).toEqual(['department', 'team', 'user']);
  });
});

describe('ReferenceCombobox — directory kinds (#3508)', () => {
  it('renders the record lookup with a manual-entry escape hatch when an adapter is present', () => {
    state.adapter = makeAdapter();
    renderRef('user');
    const cell = screen.getByTestId('record-lookup');
    expect(cell.getAttribute('data-object')).toBe('sys_user');
    expect(cell.getAttribute('data-value-field')).toBe('id');
    expect(cell.getAttribute('data-multiple')).toBe('false');
    expect(screen.getByTitle('Enter value manually')).toBeInTheDocument();
  });

  it('opts the picker out of quick-create with the spec\'s `allowCreate: false`, and no snake twin (objectui#12157)', () => {
    // `LookupField` reads `allowCreate` alone since objectui#12157; an emit left
    // on `allow_create` would be read by nothing, and the widget's default
    // (ON for a user-facing reference) would decide instead of this picker.
    state.adapter = makeAdapter();
    renderRef('team');
    const cell = screen.getByTestId('record-lookup');
    expect(cell.getAttribute('data-allow-create')).toBe('false');
    const keys = (cell.getAttribute('data-field-keys') ?? '').split(' ');
    expect(keys).toContain('allowCreate');
    expect(keys).not.toContain('allow_create');
  });

  it('position renders no record lookup — its picker is the registry arm since spec 18 (objectui#12030)', () => {
    // It committed `sys_position.name` through a record lookup until
    // `@objectstack/spec` 18 bound `position` to the registry. The registry
    // picker, which commits the item's machine NAME, is pinned in
    // `FlowReferenceField.registrySource-7611.test.tsx`.
    state.adapter = makeAdapter();
    renderRef('position');
    expect(screen.queryByTestId('record-lookup')).toBeNull();
  });

  it('manual mode: typing commits the raw value and can return to the picker', () => {
    state.adapter = makeAdapter();
    const onCommit = vi.fn();
    renderRef('user', { onCommit });
    fireEvent.click(screen.getByTitle('Enter value manually'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'usr_123' } });
    expect(onCommit).toHaveBeenCalledWith('usr_123');
    // The way back to the picker stays available.
    expect(screen.getByTitle('Pick from records')).toBeInTheDocument();
  });

  it('degrades to plain free text offline (no adapter) and never queries the metadata list', () => {
    renderRef('user');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByTitle('Enter value manually')).not.toBeInTheDocument();
    // The old bug: user/team/department/queue mapped to client.list(kind) →
    // GET /api/v1/meta/:kind, an endpoint that lists no records.
    expect(state.metaList).not.toHaveBeenCalled();
  });
});

describe('ReferenceCombobox — org-membership-level is a strict select', () => {
  it('renders the tier label, not a free-text box', () => {
    renderRef('org-membership-level', { value: 'owner' });
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('surfaces a stored out-of-enum value flagged instead of blanking it', () => {
    renderRef('org-membership-level', { value: 'sales_manager' });
    expect(screen.getByText('sales_manager (invalid)')).toBeInTheDocument();
  });
});

describe('ReferenceCombobox — manager is auto-resolved', () => {
  it('renders a disabled cell with the explanation', () => {
    renderRef('manager');
    const input = screen.getByPlaceholderText('Resolved automatically');
    expect(input).toBeDisabled();
    expect(screen.getByText(/submitter's manager/i)).toBeInTheDocument();
  });

  it('still displays a stored advanced override value', () => {
    renderRef('manager', { value: 'requested_for' });
    expect(screen.getByDisplayValue('requested_for')).toBeInTheDocument();
  });
});

describe('ReferenceCombobox — queue warns (declared-but-unenforced)', () => {
  it('keeps the stored value editable but warns that it resolves to nobody', () => {
    const onCommit = vi.fn();
    renderRef('queue', { value: 'q_west', onCommit });
    expect(screen.getByText(/not supported by the runtime/i)).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('q_west'), { target: { value: 'q_east' } });
    expect(onCommit).toHaveBeenCalledWith('q_east');
    expect(state.metaList).not.toHaveBeenCalled();
  });
});
