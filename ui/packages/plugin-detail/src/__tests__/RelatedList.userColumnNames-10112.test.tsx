/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10112 — a `user` column in a related list draws the referenced
 * person's display name, the way every ordinary list already does.
 *
 * The field is not off-spec and the data is not broken: `user` is a
 * reference-bearing type fixed to `sys_user`, and it is a member of
 * `@object-ui/core`'s `EXPANDABLE_FIELD_TYPES`. What diverged was this one
 * renderer. It asked for no `$expand` at all, so every reference column
 * arrived as its stored key; `lookup` / `master_detail` were caught by this
 * file's batch label fallback, whose predicate named only those two; and
 * `UserCellRenderer` has no resolver of its own — so the stored id was drawn
 * where the standalone list of the same object draws a name.
 *
 * ## What each case is for
 *
 *  - The AUTO-FETCH case is the reported defect: the list fetches its own
 *    rows, so the repair is the `$expand` an ordinary list already sends.
 *  - The CALLER-DATA case is the other supported input — a parent that hands
 *    `data` down. No query of this list's is involved, so only the batch
 *    fallback can resolve it, and that is the half whose predicate widened.
 *  - The CONTROL renders the same column, same fixture, with resolution made
 *    impossible. It must show the raw id. Without it, `not.toContain(the
 *    stored id)` above is unfalsifiable prose: an assertion that the id is
 *    absent proves nothing until the same column has been seen printing it.
 *  - The MEMBER-WITHDRAWAL probes decide that each site reads THAT object and
 *    not a private copy of its members.
 *
 * ## Why the probes withdraw a member instead of spying on `has`
 *
 * The pin this package already uses for this family (objectui#5874) records
 * calls to the `has` of the object core exports, on the ground that a
 * member-identical private copy leaves the recorder empty. ⛔ That instrument
 * does not transfer to this component, and the reason is structural rather
 * than stylistic: TWO sites here consult the family on the same render — the
 * `$expand` projection and the batch fallback — so a call recorded by either
 * one satisfies a recorder installed for the other. A private copy at one site
 * is masked by its neighbour, and the row reads green on the defect.
 *
 * So the probes OVERRIDE instead: withdraw `user` from the set core exports,
 * then read that one site's own output. A site that consults the shared object
 * changes what it does; a site holding a private copy does not, and goes red
 * here. Each probe is paired with the plain behavioural case above it — the
 * case fails when the site stops resolving at all, the probe fails when it
 * resolves through something other than the shared object — and neither
 * failure is reachable by the other's defect.
 *
 * ## Ablation directions, predicted before running and then measured
 *
 * Delete the `$expand` line from the auto-fetch: the auto-fetch case, the wire
 * case and the auto-fetch probe go RED; the caller-data case, the control and
 * the batch probe stay GREEN. Restore the private `lookup`/`master_detail`
 * disjunction in the batch loop: the caller-data case goes RED while the
 * auto-fetch half stays GREEN. Replace either site with a member-identical
 * private set: the behavioural case there stays GREEN and only that site's
 * withdrawal probe goes RED — which is the one failure a behavioural case
 * cannot produce, and the reason the probes exist.
 *
 * ⚠️ The control's first spelling did NOT hold in both directions, and the
 * run said so: it waited on the `sys_user` fetch, which the batch-half
 * ablation removes, so it failed for the mechanism it was supposed to be
 * independent of. It now waits on the lookup target instead. Recorded here
 * rather than quietly corrected, because a control that has never been seen
 * to survive the ablations is an assumption wearing a control's name.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399): below the 768
 * breakpoint `RelatedList` renders a gallery with no cells at all, and cells
 * are what this file reads.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer (the data-table), so
// a single column's cell can be rendered on its own — the whole table is not
// what is under test, one cell's text is.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

/** The card's own observed value: a 32-character opaque `sys_user` id. */
const OWNER_ID = 'lDPJgIdeRsnAguu8xj9vgeUzXSjsmxGd';
const OWNER_NAME = 'Dev Admin';

const opportunitySchema = {
  name: 'demo_opportunity',
  // ADR-0085 prominence — the derivation the card's reproduction goes through,
  // so the Owner column exists here for the reason it exists in the report.
  highlightFields: ['name', 'owner_id'],
  fields: {
    name: { type: 'text', label: 'Name' },
    // The PARENT relationship: removed from every column list this component
    // draws, so it must never be expanded either.
    account_id: { type: 'lookup', label: 'Account', reference: 'demo_account' },
    // An ORDINARY relation, and the positive control inside both withdrawal
    // probes: withdrawing `user` must leave this one resolving exactly as it
    // did, which is what makes a probe's negative half a reading rather than
    // an absence.
    campaign_id: { type: 'lookup', label: 'Campaign', reference: 'demo_campaign' },
    owner_id: { type: 'user', label: 'Owner', reference: 'sys_user' },
  },
};

const targetSchemas: Record<string, any> = {
  sys_user: { name: 'sys_user', fields: { name: { type: 'text', label: 'Name' } } },
  demo_account: { name: 'demo_account', fields: { name: { type: 'text', label: 'Name' } } },
  demo_campaign: { name: 'demo_campaign', fields: { name: { type: 'text', label: 'Name' } } },
};

const storedRow = {
  id: 'opp_1',
  name: 'Northwind renewal',
  account_id: 'acc_1',
  campaign_id: 'cmp_1',
  owner_id: OWNER_ID,
};
const ownerRecord = { id: OWNER_ID, name: OWNER_NAME };
const relatedRecords: Record<string, any[]> = {
  sys_user: [ownerRecord],
  demo_account: [{ id: 'acc_1', name: 'Northwind' }],
  demo_campaign: [{ id: 'cmp_1', name: 'Spring push' }],
};

/**
 * A server that honours `$expand` and nothing else.
 *
 * A root the query NAMES comes back as the related record; every other
 * reference column stays the stored key. That asymmetry is the only behaviour
 * this double has, and it is the one the repair depends on — a double that
 * resolved regardless would pass on the defect.
 */
const makeDataSource = (opts: { resolvableUsers?: boolean } = {}) => {
  const { resolvableUsers = true } = opts;
  return {
    getObjectSchema: vi.fn(async (api: string) => targetSchemas[api] ?? opportunitySchema),
    find: vi.fn(async (api: string, params: any) => {
      if (api === 'demo_opportunity') {
        const expand: string[] = Array.isArray(params?.$expand) ? params.$expand : [];
        const row: Record<string, any> = { ...storedRow };
        for (const root of expand) {
          const target = (opportunitySchema.fields as any)[root]?.reference;
          const hit = relatedRecords[target]?.find((r) => r.id === row[root]);
          if (hit) row[root] = hit;
        }
        return { data: [row], total: 1 };
      }
      if (api === 'sys_user' && !resolvableUsers) {
        throw new Error('sys_user is not readable here');
      }
      const ids: string[] = params?.$filter?.id?.$in ?? [];
      return { data: (relatedRecords[api] ?? []).filter((r) => ids.includes(r.id)) };
    }),
  };
};

const ownerColumn = () =>
  h.schema?.columns?.find((c: any) => c.accessorKey === 'owner_id');

/** The Owner value as it reached the table — expanded record or stored key. */
const ownerValue = () => (h.schema?.data ?? [])[0]?.owner_id;

/** Side-effect free readiness signal: has the Owner value stopped being a key? */
const ownerResolved = (): boolean =>
  typeof ownerValue() === 'object' && ownerValue() !== null;

/** Side-effect free readiness signal for the batch fallback's id -> name map. */
const batchNameLanded = (): boolean => {
  const el = ownerColumn()?.cell?.(OWNER_ID) as any;
  return typeof el?.props?.value === 'object' && el?.props?.value !== null;
};

/**
 * Render the Owner cell ONCE and return its text.
 *
 * Never called from inside a `waitFor`: that callback re-runs on DOM
 * mutations, so a rendering predicate feeds its own next run and leaks a
 * container per run (objectui#7756).
 */
const cellText = (value: any): string => {
  const col = ownerColumn();
  if (!col?.cell) return '';
  const { container, unmount } = render(<>{col.cell(value)}</>);
  const text = container.textContent ?? '';
  unmount();
  return text;
};

/** Every `$expand` this run asked the child collection for, flattened. */
const expandRootsSent = (dataSource: any): string[] =>
  dataSource.find.mock.calls
    .filter(([api]: any[]) => api === 'demo_opportunity')
    .map(([, params]: any[]) => params?.$expand)
    .filter(Boolean)
    .flat();

/** Which objects the batch fallback went and fetched. */
const batchTargetsFetched = (dataSource: any): string[] =>
  dataSource.find.mock.calls
    .map(([api]: any[]) => api)
    .filter((api: string) => api !== 'demo_opportunity');

const renderAutoFetch = (dataSource: any) =>
  render(
    <RelatedList
      title="Opportunities"
      type="table"
      api="demo_opportunity"
      objectName="demo_opportunity"
      referenceField="account_id"
      parentId="acc_1"
      dataSource={dataSource}
    />,
  );

const renderCallerData = (dataSource: any) =>
  render(
    <RelatedList
      title="Opportunities"
      type="table"
      api="demo_opportunity"
      objectName="demo_opportunity"
      referenceField="account_id"
      parentId="acc_1"
      data={[storedRow]}
      dataSource={dataSource}
    />,
  );

/**
 * Withdraw one member from the set `@object-ui/core` exports.
 *
 * The native `has` is reached through `Set.prototype`, never through the
 * patched property, so the passthrough cannot recurse into the override.
 */
const withdrawMember = (member: string) =>
  vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has').mockImplementation((key: string) =>
    key === member ? false : Set.prototype.has.call(EXPANDABLE_FIELD_TYPES, key),
  );

beforeEach(() => {
  h.schema = null;
});

afterEach(() => {
  // The probes patch a Set exported by core — a shared module-level object. A
  // leaked patch would follow every later file in this worker.
  vi.restoreAllMocks();
});

describe('RelatedList user columns render names, not stored ids (objectui#10112)', () => {
  it('auto-fetch: asks the server to expand the user reference and draws the name', async () => {
    const dataSource = makeDataSource();
    renderAutoFetch(dataSource as any);

    await waitFor(() => expect(ownerResolved()).toBe(true));

    const text = cellText(ownerValue());
    expect(text).toContain(OWNER_NAME);
    expect(text).not.toContain(OWNER_ID);
  });

  it('expands the visible relations and NOT the parent FK the list never draws', async () => {
    const dataSource = makeDataSource();
    renderAutoFetch(dataSource as any);

    // `account_id` is the parent relationship: `filterFK` removes it from every
    // column list this component draws, so expanding it could only buy a
    // sub-read nothing renders. `name` is not reference-bearing at all.
    await waitFor(() =>
      expect(dataSource.find).toHaveBeenCalledWith(
        'demo_opportunity',
        expect.objectContaining({ $expand: ['campaign_id', 'owner_id'] }),
      ),
    );
    expect(expandRootsSent(dataSource)).not.toContain('account_id');
    expect(expandRootsSent(dataSource)).not.toContain('name');
  });

  it('caller-supplied rows: the batch fallback resolves the user column too', async () => {
    const dataSource = makeDataSource();
    renderCallerData(dataSource as any);

    // No list query is sent on this path, so the name can only come from the
    // batch fallback — which skipped `user` entirely before this card.
    await waitFor(() =>
      expect(dataSource.find).toHaveBeenCalledWith('sys_user', expect.anything()),
    );
    await waitFor(() => expect(batchNameLanded()).toBe(true));

    const text = cellText(OWNER_ID);
    expect(text).toContain(OWNER_NAME);
    expect(text).not.toContain(OWNER_ID);
  });

  it('CONTROL: the same column prints the stored id when nothing can resolve it', async () => {
    // Same fixture, same column, resolution made impossible. This is the
    // reading the two cases above assert the absence of — and an absence is
    // not evidence until the presence has been seen on the same instrument.
    //
    // ⛔ It waits on the LOOKUP target, never on `sys_user`. Measured, not
    // assumed: waiting on `sys_user` made this row fail under the batch-half
    // ablation, because the wait — not the assertion — depended on the very
    // predicate being ablated. A control whose readiness signal is entangled
    // with the mechanism under test reports that mechanism twice and controls
    // nothing. The lookup fetch proves the batch loop RAN; the user id then
    // stayed unresolved because this double refuses to read `sys_user`.
    const dataSource = makeDataSource({ resolvableUsers: false });
    renderCallerData(dataSource as any);

    await waitFor(() => expect(batchTargetsFetched(dataSource)).toContain('demo_campaign'));
    await waitFor(() => expect(ownerColumn()).toBeTruthy());

    const text = cellText(OWNER_ID);
    expect(text).toContain(OWNER_ID);
    expect(text).not.toContain(OWNER_NAME);
  });
});

describe('each site reads core’s family object, not a copy of it (objectui#10112)', () => {
  it('the `$expand` roots come from that object — withdraw `user` and the root goes', async () => {
    withdrawMember('user');
    const dataSource = makeDataSource();
    renderAutoFetch(dataSource as any);

    // The lookup is the positive control: it proves the projection still ran
    // and still expanded, so the missing user root is a withdrawal and not a
    // dead render.
    await waitFor(() => expect(expandRootsSent(dataSource)).toContain('campaign_id'));
    expect(expandRootsSent(dataSource)).not.toContain('owner_id');
  });

  it('the batch fallback reads that object too — withdraw `user` and it stops gathering', async () => {
    withdrawMember('user');
    const dataSource = makeDataSource();
    renderCallerData(dataSource as any);

    await waitFor(() => expect(batchTargetsFetched(dataSource)).toContain('demo_campaign'));
    expect(batchTargetsFetched(dataSource)).not.toContain('sys_user');
  });
});
