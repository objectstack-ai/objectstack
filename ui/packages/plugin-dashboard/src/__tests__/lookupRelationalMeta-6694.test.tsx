/**
 * objectui#6694 — lookup cells in `ObjectDataTable` / `RecordDetailDrawer` must
 * carry their reference target.
 *
 * Both widgets build their cell meta with `buildFieldMeta` and render it through
 * `renderFieldValue` -> `getCellRenderer` -> `LookupCellRenderer`
 * (`@object-ui/fields`). That renderer resolves its target from
 * `field.reference_to || field.reference` and its display field from
 * `field.display_field`. `buildFieldMeta` wrote NONE of those spellings, so the
 * renderer resolved `undefined` and two things failed — independently, and both
 * silently:
 *
 *  1. `useRefObjectSchema(referenceTo)` never loaded the referenced object's
 *     schema, so `resolveLookupRecordName` fell through the ADR-0079 resolver to
 *     `pickRecordDisplayName`'s generic `.name` / `.title` heuristic.
 *  2. `ReferencedRecordLink`'s `objectName` was always `undefined`, so
 *     `navigable` was always `false` and the cell never rendered a real anchor —
 *     no drill-through, no middle-click-new-tab, no copy-link.
 *
 * ⚠️ Consequence 1 is pinned with a referenced object whose display field is
 * `project_code` — NOT `name` / `title`. That is the whole point: the generic
 * fallback usually still produces a readable name, so a fixture whose display
 * field IS `name` passes before and after the fix and pins nothing. Each record
 * below therefore ALSO carries a `name`, holding the value the broken path
 * produced, and every assertion checks that the wrong one is absent.
 *
 * The two consequences get separate assertions because either can be fixed while
 * the other stays broken: consequence 2 needs only `reference_to`, while
 * consequence 1 additionally needs the referenced schema to actually load.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  SchemaRendererContext,
  RelatedRecordActionsProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    // Only the table shell is stubbed. Everything the assertions depend on —
    // `SchemaRendererContext`, `RelatedRecordActionsProvider` — is the REAL
    // export by identity, so the contexts this file installs are the same
    // objects `@object-ui/fields` reads from.
    SchemaRenderer: ({ schema }: any) => {
      const cols = schema.columns || [];
      const rows = schema.data || [];
      return (
        <table>
          <tbody>
            {rows.map((row: any, i: number) => (
              <tr key={i}>
                {cols.map((c: any) => (
                  <td key={c.accessorKey}>
                    {typeof c.cell === 'function'
                      ? c.cell(row[c.accessorKey], row)
                      : String(row[c.accessorKey] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    useDataScope: () => undefined,
  };
});

import { ObjectDataTable } from '../ObjectDataTable';
import { RecordDetailDrawer } from '../RecordDetailDrawer';
import { buildFieldMeta } from '../recordFields';

/**
 * The host's route builder — the ONLY thing that can turn a lookup cell into an
 * anchor. `ReferencedRecordLink` calls it with the resolved `objectName`, so it
 * is never reached at all while that value is `undefined`.
 */
const HOST: RelatedRecordActionsValue = {
  resolve: () => ({}),
  recordHref: (objectName, recordId) => `/app/${objectName}/view/${recordId}`,
};

/**
 * `refObjectSchemaCache` in `@object-ui/fields` is module-level and never
 * cleared, so each case below references its OWN object name. A shared name
 * would let one case's resolved schema satisfy another's assertion.
 */
function makeDataSource(opts: {
  ownerObject: string;
  refObject: string;
  rows: any[];
}) {
  const ownerSchema = {
    name: opts.ownerObject,
    fields: {
      project: { type: 'lookup', label: 'Project', reference: opts.refObject },
    },
  };
  const refSchema = {
    name: opts.refObject,
    // ADR-0079 canonical record-title pointer. Deliberately NOT `name`/`title`.
    nameField: 'project_code',
    fields: {
      project_code: { type: 'text', label: 'Code' },
      name: { type: 'text', label: 'Name' },
    },
  };
  return {
    find: async () => ({ data: opts.rows }),
    getObjectSchema: async (n: string) => (n === opts.refObject ? refSchema : ownerSchema),
    __ownerSchema: ownerSchema,
  };
}

/** An `$expand`-ed lookup value whose generic `.name` is the WRONG answer. */
function expandedProject(id: string) {
  return { id, project_code: 'APOLLO-7', name: 'generic-fallback-name' };
}

describe('objectui#6694 — ObjectDataTable lookup cells carry their reference target', () => {
  it('pin 1: resolves the display name through the REFERENCED object schema, not the generic .name heuristic', async () => {
    const ds = makeDataSource({
      ownerObject: 'account_6694_a',
      refObject: 'project_6694_a',
      rows: [{ project: expandedProject('p-1') }],
    });

    render(
      <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
        <ObjectDataTable
          schema={{
            type: 'object-data-table',
            objectName: 'account_6694_a',
            columns: [{ header: 'Project', accessorKey: 'project' }],
          } as any}
          dataSource={ds}
        />
      </SchemaRendererContext.Provider>,
    );

    // `nameField: 'project_code'` wins — the ADR-0079 / issue #2357 resolution
    // that only runs once `useRefObjectSchema` has a reference target to load.
    await waitFor(
      () => expect(screen.getByText('APOLLO-7')).toBeInTheDocument(),
      { timeout: 3000 },
    );
    // …and the generic heuristic's answer is NOT what rendered. Without this the
    // assertion above could pass on a fixture where both agree.
    expect(screen.queryByText('generic-fallback-name')).not.toBeInTheDocument();
  });

  it('pin 2: renders a real drill-through anchor built by the host', async () => {
    const ds = makeDataSource({
      ownerObject: 'account_6694_b',
      refObject: 'project_6694_b',
      rows: [{ project: expandedProject('p-2') }],
    });

    render(
      <RelatedRecordActionsProvider value={HOST}>
        <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
          <ObjectDataTable
            schema={{
              type: 'object-data-table',
              objectName: 'account_6694_b',
              columns: [{ header: 'Project', accessorKey: 'project' }],
            } as any}
            dataSource={ds}
          />
        </SchemaRendererContext.Provider>
      </RelatedRecordActionsProvider>,
    );

    // `navigable` is `!!objectName && recordId != null`. The id was always
    // there; the object name is what the missing target key withheld, so
    // this anchor is the whole of consequence 2.
    const link = await waitFor(() => screen.getByRole('link'), { timeout: 3000 });
    expect(link).toHaveAttribute('href', '/app/project_6694_b/view/p-2');
  });
});

describe('objectui#6694 — RecordDetailDrawer lookup rows carry their reference target', () => {
  it('pin 1: resolves the display name through the REFERENCED object schema', async () => {
    const ds = makeDataSource({
      ownerObject: 'account_6694_c',
      refObject: 'project_6694_c',
      rows: [],
    });

    render(
      <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
        <RecordDetailDrawer
          record={{ id: 'a-1', project: expandedProject('p-3') }}
          objectName="account_6694_c"
          objectSchema={ds.__ownerSchema}
          onClose={() => {}}
        />
      </SchemaRendererContext.Provider>,
    );

    await waitFor(
      () => expect(screen.getByText('APOLLO-7')).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.queryByText('generic-fallback-name')).not.toBeInTheDocument();
  });

  it('pin 2: renders a real drill-through anchor built by the host', async () => {
    const ds = makeDataSource({
      ownerObject: 'account_6694_d',
      refObject: 'project_6694_d',
      rows: [],
    });

    render(
      <RelatedRecordActionsProvider value={HOST}>
        <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
          <RecordDetailDrawer
            record={{ id: 'a-2', project: expandedProject('p-4') }}
            objectName="account_6694_d"
            objectSchema={ds.__ownerSchema}
            onClose={() => {}}
          />
        </SchemaRendererContext.Provider>
      </RelatedRecordActionsProvider>,
    );

    const link = await waitFor(() => screen.getByRole('link'), { timeout: 3000 });
    expect(link).toHaveAttribute('href', '/app/project_6694_d/view/p-4');
  });
});

/**
 * The copy-set boundary.
 *
 * `ObjectGrid`'s `applyRelationalMeta` copies SEVEN keys — it copied NINE until
 * objectui#6711 and objectui#6874 retired `reference_to_field` and `titleFormat`
 * from its list, both on the reader measurement this seam had already recorded.
 * This seam copies THREE,
 * and the difference is measured rather than preferred: the grid's cells are
 * EDITABLE, so its extra keys feed the inline picker (`LookupField` / `UserField`
 * read `id_field`, `description_field`, `lookup_filters`, `lookupFilters`).
 * These two widgets are read-only — their only render path ends at a CELL
 * renderer — and `packages/fields/src/index.tsx` reads exactly three relational
 * keys off a cell's `field` prop.
 *
 * ⛔ This is what stops the omitted keys from being added back "for parity": a
 * `FieldMeta` member written on every call and read by nothing is precisely what
 * objectui#6625 (`decimals`) and objectui#6597 (`referenceTo`) retired from this
 * same file. If these widgets ever gain inline editing, that is the event that
 * earns the picker keys — not symmetry with the grid.
 */
describe('objectui#6694 — buildFieldMeta copies the cell-read relational keys and no others', () => {
  const def = {
    type: 'lookup',
    reference: 'project',
    // The snake twin objectui#11070 round 4 RETIRED — the cell reads
    // `reference` alone. Kept on the fixture so its absence below is a reading.
    reference_to: 'project',
    // The snake twin of `displayField`, RETIRED by objectui#11070's
    // text-family round — the cell reads `displayField`, and the ingestion
    // choke point folds a served `display_field` onto it. Kept on the fixture
    // so its absence below is a reading.
    display_field: 'project_code',
    // The SPEC spelling of the same pointer (objectui#6875). `FieldSchema`
    // declares `displayField` and none of the snake twins, so this is the leg a
    // live `getObjectSchema` actually serves — it must be copied.
    displayField: 'project_code',
    // The chain's third leg. Read by `LookupCellRenderer`, but `FieldSchema`
    // refuses it with `unrecognized_keys`, so no producer can emit it and
    // copying it would reach nothing (objectui#6711's reasoning). NOT copied.
    reference_field: 'x',
    // Six keys with no reader on this path. FOUR of them the grid still copies
    // (its picker-only keys); the other two it has since retired as well —
    // `reference_to_field` (objectui#6711) and `titleFormat` (objectui#6874).
    // All six stay on the fixture on purpose: the assertion below pins THIS
    // seam's boundary, which does not move when the grid's list does.
    reference_to_field: 'x',
    id_field: 'x',
    description_field: 'x',
    lookup_filters: [['a', '=', 1]],
    lookupFilters: [['a', '=', 1]],
    titleFormat: '{project_code}',
  };

  it('copies reference / displayField — and not the retired reference_to / display_field', () => {
    const meta = buildFieldMeta({ accessorKey: 'project', label: 'Project', def }) as any;
    expect(meta.reference).toBe('project');
    expect(meta).not.toHaveProperty('reference_to');
    expect(meta).not.toHaveProperty('display_field');
    // objectui#6875 — the spec-declared spelling, previously dropped here and in
    // `ObjectGrid` at the same time.
    expect(meta.displayField).toBe('project_code');
  });

  it('does NOT copy the picker-only keys', () => {
    const meta = buildFieldMeta({ accessorKey: 'project', label: 'Project', def }) as any;
    for (const k of [
      'reference_to_field', 'id_field', 'description_field',
      'lookup_filters', 'lookupFilters', 'titleFormat',
      // Read by `LookupCellRenderer`, but unproducible under the strict
      // `FieldSchema` — objectui#6875 measured it and left it out on purpose.
      'reference_field',
    ]) {
      expect(meta).not.toHaveProperty(k);
    }
  });

  it('adds no relational keys at all to a non-relational field', () => {
    const meta = buildFieldMeta({
      accessorKey: 'amount', label: 'Amount', def: { type: 'currency' },
    }) as any;
    for (const k of ['reference_to', 'reference', 'display_field', 'displayField']) {
      expect(meta).not.toHaveProperty(k);
    }
  });
});
