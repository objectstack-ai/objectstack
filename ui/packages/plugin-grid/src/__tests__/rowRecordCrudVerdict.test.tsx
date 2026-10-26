/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [#4296] The row kebab vs the RECORD-level write verdict.
 *
 * The card measured one screen giving two opposite answers for one record and
 * one user: the row kebab offered Edit and Delete (it ANDed only the
 * OBJECT-level grant — `rowCrudAffordances` layer (d), #4096), while the record
 * detail header hid both (it also folds the record-grained verdict, via
 * `plugin-detail`'s `useRecordEditable`, objectstack#3821). The server agreed
 * with the detail header: `PATCH` and `DELETE` on that row both answer
 * `403 "You do not have access to this record"`. The kebab was offering two
 * buttons that cannot succeed.
 *
 * The repro shape reproduced here is the card's, exactly: object-level grant
 * TRUE (`allowEdit` / `allowDelete`, full `apiOperations`) + `writeScope: 'own'`
 * + a row owned by somebody else. Nothing about the OBJECT-level chain changes;
 * every gate above still runs first.
 *
 * ## What the fake server is
 *
 * ONE fake `security/explain` service, serving BOTH question shapes out of ONE
 * verdict table: the batch form (`recordIds`, objectstack#8326 / PR #8452) the
 * grid asks, and the singular form (`recordId`) the detail header asks. That is
 * what makes the truth-table agreement test below a real agreement test — the
 * two surfaces are asked the same question about the same record by the same
 * principal, and the assertion is that they return the same answer. The real
 * handler guarantees the same thing by construction ("the batch answer for a
 * record is the singular answer for that record"), so a fake that could answer
 * the two forms differently would be testing something the platform does not do.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EXPLAIN_BATCH_MAX_RECORD_IDS } from '@objectstack/spec/security';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

// Same stable-identity permission stub as `rowCrudEffectiveOps.test.tsx`:
// ObjectGrid carries `perms` in `useMemo` dependency arrays, so a fresh object
// per call would churn those memos every render.
const { permsStub, state } = vi.hoisted(() => {
  const state: {
    effectiveOps: string[] | undefined;
    permUpdate: boolean;
    permDelete: boolean;
  } = { effectiveOps: undefined, permUpdate: true, permDelete: true };
  return {
    state,
    permsStub: {
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => state.effectiveOps,
      can: (_obj: string, action: string) =>
        action === 'delete' ? state.permDelete : state.permUpdate,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub };
});

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
// READ-ONLY reference to the OTHER surface's real implementation. The agreement
// pin is worth nothing against a local re-statement of the detail header's
// logic: it has to consume the same hook `RecordDetailView` consumes, unchanged
// and unmocked, so that a future divergence on EITHER side fails here.
import {
  useRecordEditable,
  __clearRecordEditableCache,
} from '../../../plugin-detail/src/useRecordEditable';

registerAllFields();

const OBJECT = 'showcase_project';
/** The caller's own row — `writeScope: 'own'` admits it. */
const OWN_ROW = { id: 'r_own', name: 'My Project' };
/** The card's row: owner `linus@example.com`, refused by the server with 403. */
const OTHER_ROW = { id: 'r_other', name: 'Legacy Sunset' };
const ROWS = [OWN_ROW, OTHER_ROW];

const FULL = ['get', 'list', 'create', 'update', 'delete'];

type Operation = 'update' | 'delete';

interface ExplainCall {
  object?: string;
  operation?: Operation;
  recordId?: string;
  recordIds?: string[];
}

/**
 * The fake `security/explain` service. `verdicts` is the record-grained truth
 * the real engine would derive from `writeScope` / sharing / RLS.
 */
const server = {
  calls: [] as ExplainCall[],
  responses: [] as Promise<unknown>[],
  verdicts: new Map<string, Record<Operation, boolean>>(),
  /** Non-OK response (401 / 403 / 501 / 5xx) — the fail-open path. */
  ok: true,
  /** Network / CORS failure — the other fail-open path. */
  network: true,
  /** A service predating the batch form: answers object-level, no `records`. */
  answersBatch: true,
  /** Set by {@link hold}: responses wait here until {@link release} is called. */
  gate: null as Promise<void> | null,
  release: () => {},
  /** Hold every answer open, so the pre-verdict window is a real, testable state. */
  hold() {
    server.gate = new Promise<void>((resolve) => {
      server.release = () => resolve();
    });
  },
  reset() {
    server.calls = [];
    server.responses = [];
    server.verdicts = new Map();
    server.ok = true;
    server.network = true;
    server.answersBatch = true;
    server.gate = null;
    server.release = () => {};
  },
};

const apiFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init?.body ?? '{}')) as ExplainCall;
  server.calls.push(body);
  if (!server.network) throw new TypeError('Failed to fetch');
  const operation = (body.operation ?? 'update') as Operation;
  // A record the engine cannot resolve fail-closes to `visible: false` — the
  // platform's own missing-record semantics, mirrored here.
  const visibleFor = (id: string) => server.verdicts.get(id)?.[operation] ?? false;
  const base = {
    allowed: true,
    object: body.object,
    operation,
    principal: { userId: 'u_member' },
    layers: [],
  };
  const payload = !server.answersBatch
    ? base
    : Array.isArray(body.recordIds)
      ? { ...base, records: body.recordIds.map((id) => ({ recordId: id, visible: visibleFor(id) })) }
      : typeof body.recordId === 'string'
        ? { ...base, record: { recordId: body.recordId, visible: visibleFor(body.recordId) } }
        : base;
  const res = {
    ok: server.ok,
    status: server.ok ? 200 : 500,
    json: async () => payload,
  } as unknown as Response;
  const settled = (async () => {
    if (server.gate) await server.gate;
    return res;
  })();
  server.responses.push(settled);
  return settled;
};

/** The detail header's verdict for one record, rendered as observable text. */
const DetailHeaderProbe: React.FC<{ recordId: string; operation: Operation }> = ({
  recordId,
  operation,
}) => {
  const allowed = useRecordEditable(OBJECT, recordId, operation);
  return <span data-testid={`detail-${operation}-${recordId}`}>{String(allowed)}</span>;
};

interface Case {
  rows?: Array<Record<string, unknown>>;
  effectiveOps?: string[];
  permUpdate?: boolean;
  permDelete?: boolean;
  /** Mount the detail-header probes for the truth-table agreement pin. */
  probes?: Array<{ recordId: string; operation: Operation }>;
}

function renderGrid(c: Case = {}) {
  state.effectiveOps = c.effectiveOps ?? FULL;
  state.permUpdate = c.permUpdate ?? true;
  state.permDelete = c.permDelete ?? true;
  const rows = c.rows ?? ROWS;
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: rows },
    // A page big enough to hold every fixture row, so "the rows on screen" is
    // the whole fixture and the call-count pins are unambiguous.
    pageSize: 500,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource} apiFetch={apiFetch}>
        <ObjectGrid
          schema={schema}
          dataSource={dataSource}
          onEdit={() => {}}
          onDelete={() => {}}
          onBulkDelete={() => {}}
        />
        {(c.probes ?? []).map((p) => (
          <DetailHeaderProbe key={`${p.operation}:${p.recordId}`} {...p} />
        ))}
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Wait for the rows to be on screen, then for every explain answer to land. */
async function settle(expectedCalls: number) {
  await waitFor(() => expect(server.calls.length).toBe(expectedCalls));
  await act(async () => {
    await Promise.allSettled(server.responses);
  });
}

/**
 * What the kebab of the row displaying `label` surfaces.
 *
 * Located by ROW rather than by index: a row whose entries are all hidden grows
 * no "⋮" trigger at all (#3562), so `queryAllByTestId('row-action-trigger')[i]`
 * silently addresses a different row as soon as the fix works.
 */
async function rowKebab(label: string): Promise<{ edit: boolean; delete: boolean }> {
  const row = screen.getByText(label).closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return { edit: false, delete: false };
  await userEvent.click(trigger);
  const answer = {
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
  };
  // Close the (portalled) menu so the next row's read sees only its own items.
  await userEvent.keyboard('{Escape}');
  return answer;
}

beforeEach(() => {
  server.reset();
  __clearRecordCrudVerdictCache();
  __clearRecordEditableCache();
  server.verdicts.set(OWN_ROW.id, { update: true, delete: true });
  server.verdicts.set(OTHER_ROW.id, { update: false, delete: false });
});
afterEach(() => {
  cleanup();
});

describe('[#4296] the row kebab folds the record-level verdict', () => {
  it('the card repro: object grant true + writeScope own + a NON-OWNED row loses Edit and Delete', async () => {
    // Pre-fix this returned `{ edit: true, delete: true }` — the whole card.
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await settle(2);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: false, delete: false });
  });

  it("an owner's OWN row still offers Edit and Delete under writeScope own", async () => {
    // The control group in the other direction: the fix must not cost a user
    // the rows they may genuinely write, or it is a capability regression
    // wearing a bug fix's clothes.
    renderGrid();
    await waitFor(() => expect(screen.getByText(OWN_ROW.name)).toBeInTheDocument());
    await settle(2);
    expect(await rowKebab(OWN_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('hides rather than disables — a fully denied row grows no "⋮" trigger at all', async () => {
    // Ruling: hide, don't disable (the detail header's posture and #4096's
    // precedent). #3562's invariant rides along: the guard and the items read
    // ONE decision, so a row with nothing left must not sprout an empty menu.
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await settle(2);
    const deniedRow = screen.getByText(OTHER_ROW.name).closest('tr');
    expect(deniedRow?.querySelector('[data-testid="row-action-trigger"]')).toBeNull();
    // …while the permitted row on the same screen keeps its trigger, so the
    // assertion above is observing the verdict and not an empty grid.
    const ownRow = screen.getByText(OWN_ROW.name).closest('tr');
    expect(ownRow?.querySelector('[data-testid="row-action-trigger"]')).not.toBeNull();
  });

  it('gates update and delete independently on the same row', async () => {
    server.verdicts.set(OTHER_ROW.id, { update: false, delete: true });
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await settle(2);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: false, delete: true });
  });
});

/**
 * The card's truth table, as a literal agreement test: same record, same user,
 * both surfaces. The detail side is the REAL `useRecordEditable` — imported,
 * not re-implemented — so this fails if either surface drifts.
 */
describe('[#4296] kebab answer == detail-header answer, for the same record and user', () => {
  it('agrees on the NON-OWNED row (both hide) and on the OWN row (both show)', async () => {
    renderGrid({
      probes: [
        { recordId: OTHER_ROW.id, operation: 'update' },
        { recordId: OTHER_ROW.id, operation: 'delete' },
        { recordId: OWN_ROW.id, operation: 'update' },
        { recordId: OWN_ROW.id, operation: 'delete' },
      ],
    });
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    // 2 batch calls (one per operation, for the page) + 4 singular probes.
    await settle(6);

    // The detail header's own verdicts, measured first and independently.
    await waitFor(() =>
      expect(screen.getByTestId(`detail-update-${OTHER_ROW.id}`)).toHaveTextContent('false'),
    );
    const detail = (recordId: string, operation: Operation) =>
      screen.getByTestId(`detail-${operation}-${recordId}`).textContent === 'true';

    const otherKebab = await rowKebab(OTHER_ROW.name);
    const ownKebab = await rowKebab(OWN_ROW.name);

    // The agreement itself — the cell the card measured as contradictory.
    expect(otherKebab).toEqual({
      edit: detail(OTHER_ROW.id, 'update'),
      delete: detail(OTHER_ROW.id, 'delete'),
    });
    expect(ownKebab).toEqual({
      edit: detail(OWN_ROW.id, 'update'),
      delete: detail(OWN_ROW.id, 'delete'),
    });
    // …and the values that agreement lands on, so a mutually-broken pair of
    // surfaces cannot satisfy the assertions above by agreeing on nonsense.
    expect(otherKebab).toEqual({ edit: false, delete: false });
    expect(ownKebab).toEqual({ edit: true, delete: true });
  });
});

/**
 * Ruling 3 — missing data degrades to TODAY, never over-hides. The server is
 * the authority and already fail-closes with a 403; an over-hidden row costs a
 * permitted user a capability they actually have, which is strictly worse than
 * the wasted click this card is about. Same posture as `useRecordEditable`.
 *
 * The control group for this whole block is the repro test above: it observes
 * "hidden" through the identical helper, so a passing degradation case here is
 * not just a probe that cannot see anything.
 */
describe('[#4296] degradation — an unanswered row keeps the object-level verdict', () => {
  it('a non-OK explain response leaves both entries where they were', async () => {
    server.ok = false;
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await settle(2);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('a network failure leaves both entries where they were', async () => {
    server.network = false;
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await settle(2);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('a service that answers no records[] at all (pre-batch backend) changes nothing', async () => {
    server.answersBatch = false;
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await settle(2);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('a row carrying no id keeps the object-level verdict', async () => {
    // Nothing to ask the server about, so nothing can narrow it.
    renderGrid({ rows: [{ name: 'Anonymous Row' }] });
    await waitFor(() => expect(screen.getByText('Anonymous Row')).toBeInTheDocument());
    expect(server.calls.length).toBe(0);
    expect(await rowKebab('Anonymous Row')).toEqual({ edit: true, delete: true });
  });

  it('the pre-answer window renders today\'s verdict, not a hidden one', async () => {
    // The rows paint before the round trip resolves. Fail-open means the kebab
    // shows the object-level answer in that window rather than blinking through
    // a hidden state — the same window `useRecordEditable` has always had on
    // the detail header. The answer is HELD open here, so the window is a real
    // state this test observes rather than a race it hopes to catch.
    server.hold();
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await waitFor(() => expect(server.calls.length).toBe(2));
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: true, delete: true });
    // …and once the verdict lands, the entries go.
    server.release();
    await settle(2);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: false, delete: false });
  });
});

/**
 * The batch shape — the reason this card was blocked on objectstack#8326 at
 * all. A per-row probe would cost 2N round trips; the fold asks one batched
 * question per (object, operation) for the whole page.
 */
describe('[#4296] one batched call per (object, operation) per page', () => {
  const bigPage = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `r_${i}`, name: `Row ${i}` }));

  it('a 50-row page issues 2 explain calls, not 100', async () => {
    const rows = bigPage(50);
    for (const r of rows) server.verdicts.set(r.id, { update: true, delete: true });
    const { container } = renderGrid({ rows });
    // objectui#10657: the fixture's `name` column authors no type, so until the
    // grid's own schema read lands it is WITHHELD (drawn as the mask) and its
    // text is no readiness signal: on this many rows the settled re-render
    // outran the wait. The rows being on screen is: count them.
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(rows.length));
    await settle(2);

    expect(server.calls.length).toBe(2);
    expect(server.calls.map((c) => c.operation).sort()).toEqual(['delete', 'update']);
    for (const call of server.calls) {
      expect(call.object).toBe(OBJECT);
      // The batch spelling, never the singular one — a request carrying both
      // is a 400 on the real server, and N singular calls is the cost this
      // whole design exists to avoid.
      expect(call.recordId).toBeUndefined();
      expect(call.recordIds).toEqual(rows.map((r) => r.id));
    }
  });

  it('paginates under the server\'s cap instead of sending a request it would refuse', async () => {
    // The cap is the server's (`EXPLAIN_BATCH_MAX_RECORD_IDS`, imported from
    // the package that owns it rather than re-typed — objectui#6286): over-cap
    // requests are refused with 400 VALIDATION_FAILED, never truncated, and the
    // spec directs consumers to paginate under it. Still amortized — 2 calls
    // per operation, never one per row.
    //
    // The fixture is sized FROM the cap: `cap + m` rows with `0 < m <= cap` is
    // exactly two chunks per operation for ANY cap, so this stays a cap test if
    // the contract moves. That does NOT make it a two-world test for the
    // import itself — the value is the same on both sides of that change, which
    // is what `../hooks/useRecordCrudVerdicts.batchCap.test.tsx` exists to pin.
    const cap = EXPLAIN_BATCH_MAX_RECORD_IDS;
    const rows = bigPage(cap + Math.min(50, cap));
    for (const r of rows) server.verdicts.set(r.id, { update: true, delete: true });
    const { container } = renderGrid({ rows });
    // objectui#10657: the fixture's `name` column authors no type, so until the
    // grid's own schema read lands it is WITHHELD (drawn as the mask) and its
    // text is no readiness signal: on this many rows the settled re-render
    // outran the wait. The rows being on screen is: count them.
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(rows.length));
    await settle(4);

    expect(server.calls.length).toBe(4);
    for (const call of server.calls) {
      expect(call.recordIds!.length).toBeLessThanOrEqual(cap);
      expect(call.recordIds!.length).toBeGreaterThan(0);
    }
    for (const operation of ['update', 'delete'] as const) {
      const asked = server.calls
        .filter((c) => c.operation === operation)
        .flatMap((c) => c.recordIds!);
      expect(asked.sort()).toEqual(rows.map((r) => r.id).sort());
    }
  });

  it('asks nothing when the OBJECT-level verdict already hides both entries', async () => {
    // A question whose answer cannot change anything is not worth a round trip.
    renderGrid({ permUpdate: false, permDelete: false });
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    expect(server.calls.length).toBe(0);
  });
});

/**
 * [#4096] The object-level chain is untouched — this layer only ever removes.
 * The pins that matter live in `rowCrudEffectiveOps.test.tsx`; these are the
 * two directions that could only break through the NEW layer.
 */
describe('[#4296] the record layer intersects, never unions', () => {
  it('a record-level grant cannot re-open an object-level denial', async () => {
    // The server would happily write this record, but the principal has no
    // `allowDelete` on the object — Delete stays hidden, and no delete question
    // is even asked.
    server.verdicts.set(OTHER_ROW.id, { update: true, delete: true });
    renderGrid({ permDelete: false });
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await settle(1);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: true, delete: false });
    expect(server.calls.map((c) => c.operation)).toEqual(['update']);
  });

  it('a record-level grant cannot re-open a closed API exposure surface', async () => {
    server.verdicts.set(OTHER_ROW.id, { update: true, delete: true });
    renderGrid({ effectiveOps: ['get', 'list'] });
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    expect(server.calls.length).toBe(0);
    expect(await rowKebab(OTHER_ROW.name)).toEqual({ edit: false, delete: false });
  });
});
