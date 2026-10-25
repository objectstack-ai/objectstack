/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One dropdown open, one candidate query — objectui#10223.
 *
 * Reported from a real deployment: a scheduling form's lookup to a
 * `task_version` object, whose `highlightFields` include the master_detail
 * field `task`. The lookup declares no `lookupColumns`, so the dropdown
 * previews the first highlight columns — `task` among them. The candidate
 * query sent no `$expand`, every candidate's `task` came back as a bare
 * foreign key, and the lookup cell renderer resolved each one with its own
 * `findOne`: one request per candidate on every open, on top of the list
 * query. The display was right; the load was not.
 *
 * The fixture mirrors that shape: a full page of candidates, one master_detail
 * column inside the derived preview columns, no `lookupColumns`. What is
 * pinned:
 *
 *  - the open costs ONE candidate query, and it carries `$expand` for exactly
 *    the previewed reference column — no per-row `findOne` follows, and the
 *    subtitle still names each related record;
 *  - a previewed `user` column rides the same rule (`buildExpandFields` is the
 *    one reference-bearing family), and now names the person;
 *  - the control: with no reference column previewed the query carries no
 *    `$expand` key at all — nor with no column previewed at all (the display
 *    field alone), where an empty list would otherwise mean "every relation";
 *  - the browse-all picker behind the dropdown, the same way;
 *  - field-level security gates the expansion, as at every other
 *    `buildExpandFields` call site: a relation the loaded policy denies is not
 *    asked for (dropdown, recents rail, picker), a readable one is, and with
 *    no policy loaded nothing is filtered;
 *  - expansion changes nothing a host or a user reads besides the request
 *    count. The option labels (including a `titleFormat` template that names
 *    the expanded field), the preview text, and the record handed to
 *    `onSelectRecord` / `onSelectRecords` are the same whether or not the
 *    backend honours `$expand` — the second backend returns bare ids, which is
 *    also the fallback for a backend that ignores the parameter.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import { LookupField } from './LookupField';
import { RecordPickerDialog } from './RecordPickerDialog';
import { pushRecentLookupId } from './recentLookups';
import { getCellRenderer } from '../index';

/** A full dropdown page — the page size the inline dropdown asks for. */
const CANDIDATES = 50;

const TASK_VERSION_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  code: { type: 'text', label: 'Code' },
  task: { type: 'master_detail', label: 'Task', reference: 'task' },
  version: { type: 'number', label: 'Version' },
  owner: { type: 'user', label: 'Owner', reference: 'sys_user' },
};

interface BackendOptions {
  /**
   * Unique per test. The lookup cell renderer's name cache is module-level, so
   * a task id resolved by one test would read as "no fetch needed" in the next.
   */
  prefix: string;
  highlightFields: string[];
  /** A backend that ignores `$expand` returns bare foreign keys. */
  honoursExpand?: boolean;
  titleFormat?: string;
  /** The referenced object's declared fields (default `TASK_VERSION_FIELDS`). */
  fields?: Record<string, any>;
}

function makeBackend({
  prefix,
  highlightFields,
  honoursExpand = true,
  titleFormat,
  fields = TASK_VERSION_FIELDS,
}: BackendOptions) {
  const tasks: Record<string, { id: string; name: string }> = {};
  const users: Record<string, { id: string; name: string }> = {};
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < CANDIDATES; i++) {
    const taskId = `${prefix}_task_${i}`;
    const userId = `${prefix}_user_${i}`;
    tasks[taskId] = { id: taskId, name: `Assembly step ${i}` };
    users[userId] = { id: userId, name: `Owner ${i}` };
    rows.push({ id: `${prefix}_tv_${i}`, name: `TV-${i}`, code: `C-${i}`, task: taskId, version: i + 1, owner: userId });
  }
  /** What `$expand` puts in place of each relation's key. */
  const related: Record<string, Record<string, unknown>> = { task: tasks, owner: users };

  const find = vi.fn(async (objectName: string, params?: Record<string, any>) => {
    if (objectName !== 'task_version') return { data: [], total: 0 };
    const expand: string[] = honoursExpand && Array.isArray(params?.$expand) ? params!.$expand : [];
    const skip = Number(params?.$skip ?? 0);
    const top = Number(params?.$top ?? rows.length);
    const data = rows.slice(skip, skip + top).map((r) => {
      const row = { ...r };
      for (const f of expand) if (related[f]) row[f] = related[f][r[f]];
      return row;
    });
    return { data, total: rows.length };
  });
  const findOne = vi.fn(async (objectName: string, id: string) =>
    objectName === 'task' ? tasks[id] ?? null : null,
  );
  const getObjectSchema = vi.fn(async (objectName: string) => {
    if (objectName === 'task_version') {
      return {
        name: 'task_version',
        fields,
        highlightFields,
        ...(titleFormat ? { titleFormat } : {}),
      };
    }
    if (objectName === 'task') {
      return { name: 'task', fields: { name: { type: 'text', label: 'Name' } } };
    }
    return undefined;
  });

  return { dataSource: { find, findOne, getObjectSchema } as any, rows };
}

type Backend = ReturnType<typeof makeBackend>;

/** The candidate queries — `find` on the referenced object itself. */
function candidateQueries(backend: Backend): Array<Record<string, any>> {
  return backend.dataSource.find.mock.calls
    .filter(([objectName]: [string]) => objectName === 'task_version')
    .map(([, params]: [string, Record<string, any>]) => params);
}

/** Every read that is NOT a candidate query: per-row resolution of `task`. */
function perRowReads(backend: Backend): number {
  const finds = backend.dataSource.find.mock.calls.filter(
    ([objectName]: [string]) => objectName !== 'task_version',
  ).length;
  return finds + backend.dataSource.findOne.mock.calls.length;
}

/**
 * Macrotask flushes, as in `LookupField.pickerAgreement.test.tsx`: the schema
 * fetches, any per-id resolution and the re-render that carries a resolved
 * name all settle, without a predicate that would have to encode the answer.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/**
 * Mount the lookup the way a form does and wait for the referenced schema,
 * which lands at mount — before any user can reach the trigger.
 */
/** Wraps the rendered tree — a permission provider, or nothing. */
type Wrap = (node: React.ReactElement) => React.ReactElement;
const bare: Wrap = (node) => node;

async function mountLookup(
  backend: Backend,
  extra: Record<string, unknown> = {},
  wrap: Wrap = bare,
): Promise<void> {
  render(
    wrap(
      <SchemaRendererContext.Provider value={{ dataSource: backend.dataSource } as any}>
        <LookupField
          value={undefined}
          onChange={() => {}}
          dataSource={backend.dataSource}
          field={{ reference: 'task_version' } as never}
          {...(extra as object)}
        />
      </SchemaRendererContext.Provider>,
    ),
  );
  await waitFor(() => expect(backend.dataSource.getObjectSchema).toHaveBeenCalledWith('task_version'));
  await settle();
}

async function openDropdown(
  backend: Backend,
  extra: Record<string, unknown> = {},
  wrap: Wrap = bare,
): Promise<void> {
  await mountLookup(backend, extra, wrap);
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(CANDIDATES));
  await settle();
}

function previewTexts(field: string): string[] {
  return Array.from(document.querySelectorAll(`[data-lookup-preview="${field}"]`)).map(
    (el) => el.textContent ?? '',
  );
}

afterEach(() => {
  cleanup();
  // Selecting an option records it as "recently used"; keep tests independent.
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('LookupField — the dropdown expands the reference columns it previews (objectui#10223)', () => {
  it('one open costs one candidate query carrying `$expand`, and no per-row read', async () => {
    const backend = makeBackend({ prefix: 'card', highlightFields: ['code', 'task', 'version'] });
    await openDropdown(backend);

    const queries = candidateQueries(backend);
    expect(queries).toHaveLength(1);
    expect(queries[0].$expand).toEqual(['task']);
    expect(perRowReads(backend)).toBe(0);

    // The subtitle still names every related record.
    const tasks = previewTexts('task');
    expect(tasks).toHaveLength(CANDIDATES);
    expect(tasks[0]).toBe('Assembly step 0');
    expect(tasks[CANDIDATES - 1]).toBe(`Assembly step ${CANDIDATES - 1}`);
  });

  it('a previewed `user` column is expanded by the same rule, and names the person', async () => {
    const backend = makeBackend({ prefix: 'usr', highlightFields: ['code', 'owner'] });
    await openDropdown(backend);

    const queries = candidateQueries(backend);
    expect(queries).toHaveLength(1);
    expect(queries[0].$expand).toEqual(['owner']);
    expect(perRowReads(backend)).toBe(0);
    // The user cell renderer names an expanded record; a bare id it can only
    // mark as unresolved.
    const owners = previewTexts('owner');
    expect(owners[0]).toContain('Owner 0');
    expect(owners[0]).not.toContain('usr_user_0');
  });

  it('control: with no reference column previewed, the query carries no `$expand` key', async () => {
    const backend = makeBackend({ prefix: 'ctrl', highlightFields: ['code', 'version'] });
    await openDropdown(backend);

    const queries = candidateQueries(backend);
    expect(queries).toHaveLength(1);
    expect('$expand' in queries[0]).toBe(false);
    expect(perRowReads(backend)).toBe(0);
    expect(previewTexts('task')).toHaveLength(0);
    expect(previewTexts('code')[0]).toBe('C-0');
  });

  it('the browse-all picker behind it expands the same column, and reads nothing per row', async () => {
    const backend = makeBackend({ prefix: 'pick', highlightFields: ['code', 'task', 'version'] });
    await mountLookup(backend);
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-all-records'));
    });
    await waitFor(() => expect(screen.getByText('TV-0')).toBeInTheDocument());
    await settle();

    const queries = candidateQueries(backend);
    expect(queries).toHaveLength(1);
    expect(queries[0].$expand).toEqual(['task']);
    expect(perRowReads(backend)).toBe(0);

    const cells = Array.from(document.querySelectorAll('[data-lookup-cell="task"]'));
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0].textContent).toBe('Assembly step 0');
  });
});

describe('LookupField — no displayed reference column, no `$expand` (objectui#10223)', () => {
  /**
   * `buildExpandFields` reads an EMPTY column list as "no restriction" and
   * returns every relation the object declares. A dropdown whose picker
   * columns are the display field alone previews nothing, so it must not
   * hand that function an empty list: the object below declares audit and
   * ownership relations (`created_by`, `owner_id`) plus the master_detail
   * `task` and the `user` field `owner`, and the dropdown renders none of them.
   */
  const WITH_AUDIT_RELATIONS: Record<string, any> = {
    ...TASK_VERSION_FIELDS,
    created_by: { type: 'user', label: 'Created By', reference: 'sys_user' },
    owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  };

  it('dropdown and recents rail: `highlightFields` naming only the display field send no `$expand` key', async () => {
    const backend = makeBackend({ prefix: 'nameonly', highlightFields: ['name'], fields: WITH_AUDIT_RELATIONS });
    pushRecentLookupId('task_version', 'nameonly_tv_1');
    await openDropdown(backend);

    const queries = candidateQueries(backend);
    const recents = queries.filter((p) => JSON.stringify(p.$filter ?? {}).includes('$in'));
    const main = queries.filter((p) => !recents.includes(p));
    expect(main).toHaveLength(1);
    expect(recents).toHaveLength(1);
    expect('$expand' in main[0]).toBe(false);
    expect('$expand' in recents[0]).toBe(false);
    expect(previewTexts('task')).toHaveLength(0);
  });

  it('picker: no rendered column besides the id sends no `$expand` key', async () => {
    const backend = makeBackend({ prefix: 'idonly', highlightFields: ['name'], fields: WITH_AUDIT_RELATIONS });
    render(
      <SchemaRendererContext.Provider value={{ dataSource: backend.dataSource } as any}>
        <RecordPickerDialog
          open
          onOpenChange={() => {}}
          dataSource={backend.dataSource}
          objectName="task_version"
          displayField="name"
          columns={['id']}
          onSelect={() => {}}
          cellRenderer={getCellRenderer}
          fieldsMeta={WITH_AUDIT_RELATIONS}
        />
      </SchemaRendererContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-idonly_tv_0')).toBeInTheDocument());
    const queries = candidateQueries(backend);
    expect(queries).toHaveLength(1);
    expect('$expand' in queries[0]).toBe(false);
  });
});

describe('LookupField — expansion changes the request count and nothing else (objectui#10223)', () => {
  /**
   * `titleFormat` names the expanded field on purpose: a template that
   * printed an expanded record would print an object where it used to print
   * the key.
   */
  const TITLE_FORMAT = '{code} - {task}';

  interface DropdownReading {
    labels: string[];
    previews: string[];
    picked: Record<string, unknown>;
  }

  async function readDropdown(honoursExpand: boolean): Promise<DropdownReading> {
    const backend = makeBackend({
      prefix: 'same',
      highlightFields: ['code', 'task', 'version'],
      honoursExpand,
      titleFormat: TITLE_FORMAT,
    });
    const onSelectRecord = vi.fn();
    await openDropdown(backend, { onSelectRecord });
    const options = screen.getAllByRole('option').slice(0, 3);
    const labels = options.map((o) => o.getAttribute('title') ?? '');
    const previews = previewTexts('task').slice(0, 3);
    await act(async () => {
      fireEvent.click(options[0]);
    });
    expect(onSelectRecord).toHaveBeenCalledTimes(1);
    const picked = onSelectRecord.mock.calls[0][0] as Record<string, unknown>;
    cleanup();
    localStorage.clear();
    return { labels, previews, picked };
  }

  it('dropdown: same labels, same subtitles, same record handed to onSelectRecord', async () => {
    // The expanding backend first: it resolves nothing per row, so it leaves
    // the module-level name cache empty for the bare-id run that follows.
    const expanded = await readDropdown(true);
    const bare = await readDropdown(false);

    expect(expanded).toEqual(bare);
    expect(expanded.labels[0]).toBe('C-0 - same_task_0');
    expect(expanded.previews[0]).toBe('Assembly step 0');
    expect(expanded.picked.task).toBe('same_task_0');
  });

  interface PickerReading {
    titles: string[];
    tasks: string[];
    picked: Record<string, unknown>[];
  }

  async function readPicker(honoursExpand: boolean): Promise<PickerReading> {
    const backend = makeBackend({
      prefix: 'samepick',
      highlightFields: ['code', 'task', 'version'],
      honoursExpand,
    });
    const onSelectRecords = vi.fn();
    render(
      <SchemaRendererContext.Provider value={{ dataSource: backend.dataSource } as any}>
        <RecordPickerDialog
          open
          onOpenChange={() => {}}
          dataSource={backend.dataSource}
          objectName="task_version"
          objectSchema={{ name: 'task_version', fields: TASK_VERSION_FIELDS, titleFormat: TITLE_FORMAT }}
          columns={['name', 'code', 'task', 'version']}
          onSelect={() => {}}
          onSelectRecords={onSelectRecords}
          cellRenderer={getCellRenderer}
          fieldsMeta={TASK_VERSION_FIELDS}
        />
      </SchemaRendererContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-samepick_tv_0')).toBeInTheDocument());
    await settle();
    const read = (field: string) =>
      Array.from(document.querySelectorAll(`[data-lookup-cell="${field}"]`))
        .slice(0, 3)
        .map((el) => el.textContent ?? '');
    const titles = read('name');
    const tasks = read('task');
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-row-samepick_tv_0'));
    });
    expect(onSelectRecords).toHaveBeenCalledTimes(1);
    const picked = onSelectRecords.mock.calls[0][0] as Record<string, unknown>[];
    cleanup();
    return { titles, tasks, picked };
  }

  it('picker: same title cells, same task cells, same records handed to onSelectRecords', async () => {
    const expanded = await readPicker(true);
    const bare = await readPicker(false);

    expect(expanded).toEqual(bare);
    expect(expanded.titles[0]).toBe('C-0 - samepick_task_0');
    expect(expanded.tasks[0]).toBe('Assembly step 0');
    expect(expanded.picked).toEqual([
      {
        id: 'samepick_tv_0',
        name: 'TV-0',
        code: 'C-0',
        task: 'samepick_task_0',
        version: 1,
        owner: 'samepick_user_0',
      },
    ]);
  });
});

describe('LookupField — field-level security gates the expansion (objectui#10223)', () => {
  /**
   * The real provider, not a stub: `checkField` answers from a policy that
   * denies `task_version.task` to the `viewer` role and says nothing about
   * `owner`. Both relations are previewed, so the pin reads a FILTER — one
   * name removed, the other kept — rather than an expansion that vanished.
   */
  function withPolicy(taskReadable: boolean): Wrap {
    return (node) => (
      <PermissionProvider
        roles={[]}
        userRoles={['viewer']}
        permissions={[
          {
            object: 'task_version',
            roles: { viewer: { actions: ['read'], fieldPermissions: [{ field: 'task', read: taskReadable }] } },
          },
        ]}
      >
        {node}
      </PermissionProvider>
    );
  }

  const HIGHLIGHTS = ['code', 'task', 'owner'];

  it('dropdown: a relation the policy denies is not expanded; the readable one still is', async () => {
    const backend = makeBackend({ prefix: 'flsdeny', highlightFields: HIGHLIGHTS });
    await openDropdown(backend, {}, withPolicy(false));
    const queries = candidateQueries(backend);
    expect(queries).toHaveLength(1);
    expect(queries[0].$expand).toEqual(['owner']);
  });

  it('dropdown: a readable relation is expanded as before', async () => {
    const backend = makeBackend({ prefix: 'flsallow', highlightFields: HIGHLIGHTS });
    await openDropdown(backend, {}, withPolicy(true));
    expect(candidateQueries(backend)[0].$expand).toEqual(['task', 'owner']);
  });

  it('dropdown: no policy loaded (no provider) filters nothing', async () => {
    const backend = makeBackend({ prefix: 'flsnone', highlightFields: HIGHLIGHTS });
    await openDropdown(backend);
    expect(candidateQueries(backend)[0].$expand).toEqual(['task', 'owner']);
  });

  it('recents rail: the same gate applies to its query', async () => {
    const backend = makeBackend({ prefix: 'flsrecent', highlightFields: HIGHLIGHTS });
    pushRecentLookupId('task_version', 'flsrecent_tv_1');
    pushRecentLookupId('task_version', 'flsrecent_tv_0');
    await openDropdown(backend, {}, withPolicy(false));
    const recents = candidateQueries(backend).filter((p) => JSON.stringify(p.$filter ?? {}).includes('$in'));
    expect(recents).toHaveLength(1);
    expect(recents[0].$expand).toEqual(['owner']);
  });

  it('picker: a relation the policy denies is not expanded; the readable one still is', async () => {
    const backend = makeBackend({ prefix: 'flspick', highlightFields: HIGHLIGHTS });
    render(
      withPolicy(false)(
        <SchemaRendererContext.Provider value={{ dataSource: backend.dataSource } as any}>
          <RecordPickerDialog
            open
            onOpenChange={() => {}}
            dataSource={backend.dataSource}
            objectName="task_version"
            displayField="name"
            columns={['name', 'code', 'task', 'owner']}
            onSelect={() => {}}
            cellRenderer={getCellRenderer}
            fieldsMeta={TASK_VERSION_FIELDS}
          />
        </SchemaRendererContext.Provider>,
      ),
    );
    await waitFor(() => expect(screen.getByTestId('record-row-flspick_tv_0')).toBeInTheDocument());
    const queries = candidateQueries(backend);
    expect(queries).toHaveLength(1);
    expect(queries[0].$expand).toEqual(['owner']);
  });
});
