/**
 * objectui#6874 — `ObjectGrid`'s relational copy set must NOT carry
 * `titleFormat`.
 *
 * ## ⚠️ Why this is a pin and not a behaviour test
 *
 * `titleFormat` is a real, live key — but it has ZERO readers on a FIELD meta.
 * Every read of the identifier in this repo takes it off an OBJECT schema
 * (`objectDef` / `objectSchema` / `objSchema` in `record-title.ts`,
 * `containers.tsx`, `DetailView.tsx`, `ObjectKanban.tsx`, `ObjectCalendar.tsx`,
 * `useRecordSearch.ts`), and the one that this grid's own inline picker uses is
 * `refObjectSchema?.titleFormat` in `LookupField` — the REFERENCED object's
 * schema, fetched by `getSchema(referenceTo)`. So the target key (`reference_to`
 * then, `reference` since objectui#11070 round 4) is what makes
 * `titleFormat` work on this path, and the copy reached nothing.
 *
 * Removing it therefore changes no rendering at all: every other test in this
 * package stays green whether or not the removal is correct. A green suite
 * proves nothing here. What CAN be asserted is the thing that was actually
 * measured — the key is no longer WRITTEN onto the `fieldMeta` a cell renderer
 * receives — so this file asserts that absence directly, at all three of
 * `generateColumns`'s column-building call sites, and goes red the moment the
 * key is re-added to `RELATIONAL_META_KEYS`.
 *
 * ## The control against vacuity lives in the same assertions
 *
 * Each case also asserts that the SURVIVING keys do arrive on the same
 * meta. An absence assertion on its own passes for the wrong reason as soon as
 * the fixture stops reaching the copy path at all (a renamed helper, a column
 * path that no longer resolves this renderer, a def the grid never reads); the
 * presence half is what makes each `not.toHaveProperty` a measurement rather
 * than a tautology.
 *
 * The probe replaces the registered `lookup` cell renderer, which is exactly
 * how the real `LookupCellRenderer` receives this bag — `getCellRenderer` checks
 * the registry first — so what it captures is the `field` prop the shipped
 * renderer would have been handed.
 *
 * Same disposition, same list, same author path as objectui#6711, which retired
 * `reference_to_field` from this array; that absence is pinned in
 * `relationalMetaCopySet-6711.test.tsx`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import {
  registerAllFields,
  registerFieldRenderer,
  getCellRenderer,
  type CellRendererProps,
} from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'os_6874_report';

/**
 * One field def carrying EVERY relational key the grid has ever copied,
 * including both retired ones. A def that omitted `titleFormat` could not tell
 * "the grid stopped copying it" apart from "the fixture never offered it".
 */
const MANAGER_DEF = {
  type: 'lookup',
  label: 'Manager',
  // The target the grid copies — the one spelling read since objectui#11070
  // round 4 — beside the snake twin that round RETIRED, kept on the fixture so
  // its absence from the copied meta is a reading, not an omission.
  reference: 'users',
  reference_to: 'MUST_NOT_BE_COPIED',
  // The spec spelling — the only display pointer read since objectui#7155.
  displayField: 'name',
  // ⭐ The snake_case dialect objectui#7155 RETIRED. Kept on the fixture on
  // purpose, exactly like `reference_to_field` below: their absence from the
  // copied meta is then a reading, not a fixture that never offered them.
  display_field: 'MUST_NOT_BE_COPIED',
  id_field: 'MUST_NOT_BE_COPIED',
  description_field: 'MUST_NOT_BE_COPIED',
  lookup_filters: [['active', '=', true]],
  lookupFilters: [['active', '=', true]],
  // The key this file pins as retired (objectui#6874). Kept on the fixture on
  // purpose — a def without it would make the assertion vacuous.
  titleFormat: 'MUST_NOT_BE_COPIED',
  // Retired earlier, in objectui#6711. Kept for the same reason.
  reference_to_field: 'x',
};

/**
 * The keys that survive every retirement so far — the control.
 *
 * ⭐ objectui#11070 round 4 shrank it again, from three to two: the choke
 * point stopped stamping `reference_to` and no consumer reads it, so the target
 * is copied as `reference` alone.
 *
 * ⭐ objectui#7155 shrank this from six to three. It converged the lookup
 * dialect on the spec's camelCase, so `display_field` / `id_field` /
 * `description_field` / `lookup_filters` are no longer copied — `displayField`
 * carries the display pointer now, and the other three were already off the
 * copy set (objectui#7166) under their snake spellings only.
 *
 * ⛔ Keep this list non-empty and keep asserting it: it is what separates "the
 * retirement removed exactly its key" from "the copy stopped working".
 */
const SURVIVING_KEYS = [
  'reference', 'displayField',
] as const;

const ROWS = [{ id: 'r1', name: 'Tower T1', manager: 'u1' }];

const captured: Record<string, any>[] = [];

function ProbeCell({ value, field }: CellRendererProps): React.ReactElement {
  captured.push(field as unknown as Record<string, any>);
  return <span data-testid="probe">{String(value ?? '')}</span>;
}

let originalLookupRenderer: React.FC<CellRendererProps>;

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  originalLookupRenderer = getCellRenderer('lookup');
  registerFieldRenderer('lookup', ProbeCell);
});

afterAll(() => {
  registerFieldRenderer('lookup', originalLookupRenderer);
});

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        manager: { ...MANAGER_DEF },
      },
    }),
  } as any;
}

async function renderAndCaptureMeta(schemaExtra: Record<string, any>) {
  captured.length = 0;
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    // objectui#8348 — the DECLARED inline-rows spelling. `object-grid`'s published
    // `data` row is the `ViewData` union ("the bare-array shortcut is refused"), so
    // `getDataConfig` no longer lifts a bare array; `{ provider: 'value', items }`
    // resolves to the same config this file has always exercised.
    data: { provider: 'value', items: ROWS },
    pagination: { pageSize: 50 },
    ...schemaExtra,
  };
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  // ⚠️ Wait for the ENRICHED meta, not merely the first one. The object schema
  // arrives from an async fetch, so the first paint hands the renderer a bare
  // `{ name, type }` — on which `not.toHaveProperty('titleFormat')` passes for
  // the wrong reason. `label` is the signal because it is written from the same
  // `objectDefField` block, immediately BEFORE `applyRelationalMeta`, and is not
  // itself one of the keys under test — so the wait cannot manufacture the
  // assertions below.
  await waitFor(() => {
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[captured.length - 1]).toHaveProperty('label');
  });
  return captured[captured.length - 1];
}

/**
 * The three call sites of `applyRelationalMeta`, reached by the three shapes
 * `generateColumns` branches on: ListColumn objects, a string array, and the
 * inline-data path (rows handed down + an authored `fields` projection).
 */
const CALL_SITES: Array<[string, Record<string, any>]> = [
  ['ListColumn objects', { columns: [{ field: 'manager', label: 'Manager', type: 'lookup' }] }],
  ['string columns', { columns: ['manager'] }],
  ['inline data + fields projection', { fields: ['manager'] }],
];

describe('objectui#6874 — ObjectGrid no longer copies `titleFormat` onto fieldMeta', () => {
  for (const [name, schemaExtra] of CALL_SITES) {
    it(`does not copy it (${name})`, async () => {
      const meta = await renderAndCaptureMeta(schemaExtra);
      expect(meta).not.toHaveProperty('titleFormat');
    });

    it(`still copies the surviving relational keys (${name})`, async () => {
      const meta = await renderAndCaptureMeta(schemaExtra);
      for (const key of SURVIVING_KEYS) {
        expect(meta).toHaveProperty(key);
      }
      expect(meta.reference).toBe('users');
      expect(meta).not.toHaveProperty('reference_to');
      expect(meta.displayField).toBe('name');
      // objectui#7166 retired `lookupFilters` from the copy set — its only
      // reader is an editor widget, which `renderCellEditor` feeds from the
      // schema def. The fixture above still declares it, so this absence is a
      // reading and not a fixture that never offered the key.
      expect(meta).not.toHaveProperty('lookupFilters');
      // ⭐ objectui#7155 — the retired snake_case dialect is not copied either.
      // The fixture declares all four, so each absence is a reading.
      for (const retired of ['display_field', 'id_field', 'description_field', 'lookup_filters']) {
        expect(meta, `${retired} is copied again — objectui#7155 retired it`).not.toHaveProperty(retired);
      }
    });
  }
});
