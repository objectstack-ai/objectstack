/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:number` counts rows scoped to the RECORD IN VIEW (objectui#7297).
 *
 * The card, measured on a person's record page: the only filter an author
 * could write counted the whole organisation's tasks, under that person's name.
 * `@objectstack/spec` 17.5.0 declares `{record_id}` (`RECORD_CONTEXT_TOKENS`,
 * objectstack-ai/objectstack#20003); `useFilterScope()` now hands the resolver
 * the id of the mounted record (`RecordContextProvider`, the provider whose row
 * `visibleWhen` binds as `record`), and the metric resolves its filter through
 * the hook it already used for the session tokens. So:
 *
 *   - on a record page the count follows the record: two records, two counts,
 *     with no remount between them;
 *   - the component-level `dataSource.filter` takes the token too, through the
 *     same resolution (since objectui#11880 it is the metric's ONLY filter:
 *     every row below authors its filter there, and the binding's rule array
 *     reaches the adapter lowered to the ObjectQL AST);
 *   - with no record in context the token is refused by name (the
 *     `onUnresolved` channel, defaulting to `console.warn`) and left as written,
 *     so the query can only be refused or match nothing, never count everybody;
 *     the server's own refusal (`FILTER_TOKEN_UNRESOLVED` / 400) is shown where
 *     an unresolved `{current_user_id}`'s is, instead of a number.
 *
 * Driven through the real `SchemaRenderer` and this package's registrations.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { AdapterCtx, FilterScopeProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** How many open tasks each person has, keyed by the assignee comparand. */
const TASKS_BY_ASSIGNEE: Record<string, number> = { rec_ada: 3, rec_grace: 5 };

/** The comparand a filter carries for `assignee`, in either filter shape. */
function assigneeOf(filter: unknown): unknown {
  const text = JSON.stringify(filter ?? null);
  const hit = Object.keys(TASKS_BY_ASSIGNEE).find((id) => text.includes(`"${id}"`));
  if (hit) return hit;
  return text.includes('{record_id}') ? '{record_id}' : undefined;
}

/** An aggregating adapter whose count depends on the filter it is handed. */
function makeAdapter() {
  return {
    aggregate: vi.fn(async (_object: string, options: { filter?: unknown }) => {
      const assignee = assigneeOf(options.filter);
      const count = typeof assignee === 'string' ? TASKS_BY_ASSIGNEE[assignee] ?? 0 : 99;
      return [{ count }];
    }),
    find: vi.fn(async () => ({ data: [] })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
  };
}

/** One equality rule of a binding filter. */
const eq = (field: string, value: string) => ({ field, operator: 'equals', value });

/** The person's record page: "how many open tasks does THIS person have". */
const OPEN_TASKS = {
  type: 'element:number',
  id: 'open-tasks',
  dataSource: { object: 'task', filter: [eq('assignee', '{record_id}'), eq('status', 'open')] },
  properties: { aggregate: 'count' },
};

/** {@link OPEN_TASKS} with another binding filter. */
const openTasksFiltered = (filter: unknown[]) => ({ ...OPEN_TASKS, dataSource: { object: 'task', filter } });

function Page({ adapter, recordId, schema = OPEN_TASKS }: { adapter: object; recordId?: string; schema?: object }) {
  const tree = <SchemaRenderer schema={schema as never} />;
  return (
    <AdapterCtx.Provider value={adapter as never}>
      <FilterScopeProvider currentUserId="usr_viewer" currentOrgId="org_7">
        {recordId === undefined ? (
          tree
        ) : (
          <RecordContextProvider objectName="person" recordId={recordId}>
            {tree}
          </RecordContextProvider>
        )}
      </FilterScopeProvider>
    </AdapterCtx.Provider>
  );
}

const countBag = (filter: unknown) => ({ field: undefined, function: 'count', groupBy: '_all', filter });

describe('element:number resolves {record_id} against the mounted record (objectui#7297)', () => {
  it('counts the record in view, and follows it to the next record: two records, two counts', async () => {
    const adapter = makeAdapter();
    const { rerender } = render(<Page adapter={adapter} recordId="rec_ada" />);

    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
    expect(adapter.aggregate).toHaveBeenLastCalledWith(
      'task',
      countBag([['assignee', 'equals', 'rec_ada'], ['status', 'equals', 'open']]),
    );

    // Same tree, same mounted metric; only the record in context moves.
    rerender(<Page adapter={adapter} recordId="rec_grace" />);
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy());
    expect(adapter.aggregate).toHaveBeenLastCalledWith(
      'task',
      countBag([['assignee', 'equals', 'rec_grace'], ['status', 'equals', 'open']]),
    );
    expect(screen.queryByText('3')).toBeNull();
  });

  it('the component-level dataSource.filter takes the token through the same resolution', async () => {
    const adapter = makeAdapter();
    render(
      <Page
        adapter={adapter}
        recordId="rec_grace"
        schema={{
          type: 'element:number',
          id: 'bound-open-tasks',
          dataSource: { object: 'task', filter: [{ field: 'assignee', operator: 'equals', value: '{record_id}' }] },
          properties: { aggregate: 'count' },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText('5')).toBeTruthy());
    expect(adapter.aggregate).toHaveBeenLastCalledWith('task', countBag([['assignee', 'equals', 'rec_grace']]));
  });

  it('the session tokens are unchanged on a record page: {current_user_id} is still the viewer', async () => {
    const adapter = makeAdapter();
    render(
      <Page
        adapter={adapter}
        recordId="rec_ada"
        schema={openTasksFiltered([eq('assignee', '{record_id}'), eq('reviewer', '{current_user_id}')])}
      />,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(adapter.aggregate).toHaveBeenLastCalledWith(
      'task',
      countBag([['assignee', 'equals', 'rec_ada'], ['reviewer', 'equals', 'usr_viewer']]),
    );
  });
});

describe('element:number refuses {record_id} by name with no record in context (objectui#7297)', () => {
  it('left as written — never null, never dropped — and named in the unresolved-token warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = makeAdapter();
    render(<Page adapter={adapter} />);

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    // The condition reaches the query as authored: dropping it would count
    // every task (the card's failure), `null` would count none.
    expect(adapter.aggregate).toHaveBeenLastCalledWith(
      'task',
      countBag([['assignee', 'equals', '{record_id}'], ['status', 'equals', 'open']]),
    );

    const named = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('"{record_id}"'));
    expect(named.length).toBeGreaterThan(0);
    expect(named[0]).toContain('no record in context');
    expect(named[0]).not.toContain('not a recognised token');
  });

  it("shows the server's refusal by name, down the path an unresolved {current_user_id} takes", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The ObjectStack server's answer to a filter still carrying a token it has
    // no value for: `UnresolvedFilterTokenError`, code + status + a message
    // that names the token.
    const refusing = (token: string) => ({
      ...makeAdapter(),
      aggregate: vi.fn(async () => {
        throw Object.assign(new Error(`Filter token "{${token}}" could not be resolved`), {
          code: 'FILTER_TOKEN_UNRESOLVED',
          status: 400,
        });
      }),
    });

    // Control: an unresolved session token (no user signed in to scope).
    const sessionAdapter = refusing('current_user_id');
    render(
      <AdapterCtx.Provider value={sessionAdapter as never}>
        <SchemaRenderer
          schema={openTasksFiltered([eq('owner', '{current_user_id}')]) as never}
        />
      </AdapterCtx.Provider>,
    );
    await waitFor(() => expect(screen.getByText('Filter token "{current_user_id}" could not be resolved')).toBeTruthy());
    cleanup();

    const recordAdapter = refusing('record_id');
    render(<Page adapter={recordAdapter} />);
    await waitFor(() => expect(screen.getByText('Filter token "{record_id}" could not be resolved')).toBeTruthy());
    // A refusal, not a number: the value slot shows the empty dash.
    expect(screen.getByText('—')).toBeTruthy();
  });
});
