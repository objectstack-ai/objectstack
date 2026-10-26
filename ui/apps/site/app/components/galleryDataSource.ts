/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 */

/**
 * The docs gallery's stand-in data source (objectui#4600, extended by #5113).
 *
 * The catalog is a **presentation corpus**: it ships JSON, not a backend, and
 * the gallery renders it with no application behind it. Most entries need
 * nothing — their data is inline. Two kinds of entry are the exception, and
 * both route through the host's `dataSource`:
 *
 *  - dataset-bound dashboard widgets — `DatasetWidget` calls
 *    `dataSource.queryDataset`, and with no such function it renders "This data
 *    source does not support dataset queries." (objectui#4600);
 *  - object-bound entries — `object-view` / `object-grid` / `object-form` call
 *    `getObjectSchema` and `find`, and `dataSource` is not a schema key: it is
 *    a prop the registered renderer pulls off `SchemaRendererContext`
 *    (`packages/plugin-view/src/index.tsx`). With nothing behind it, a
 *    `plugin-view` example can only be a hand-drawn picture of one — which is
 *    what the three `plugin-view` catalog entries were until objectui#5113.
 *
 * So this is the smallest thing that lets both draw. It is a DEMO fixture, not
 * a data-source implementation — real ones live in `@object-ui/data-*`.
 *
 * ## What it honours, and what it does not
 *
 * Stated because a fixture that silently ignores a query parameter turns any
 * example authoring that parameter into a lie on the page — the exact defect
 * objectui#5113 exists to remove.
 *
 *  - `queryDataset` — canned rows shaped from the query's own `dimensions` /
 *    `measures`. Does NOT filter, aggregate or honour `runtimeFilter`.
 *  - `find` — honours `$search` (case-insensitive substring over the object's
 *    string fields), `$orderby` (all of the shapes `QueryParams` declares) and
 *    the `$skip` / `$top` window. Does NOT honour `$filter` or `$expand`,
 *    which is why no catalog entry authors a `filter` on a view it renders
 *    through this fixture.
 *  - writes (`create` / `update` / `delete`) — applied to this module's own
 *    in-memory rows, so a record a reader creates in a demo drawer shows up in
 *    that page's list. They live as long as the tab does and reach nothing.
 *
 * It is gallery-only on purpose: `apps/site` is `private`, so nothing here is
 * a published package surface.
 */

/** The subset of a dataset query this fixture reads. */
interface GalleryDatasetQuery {
  dimensions?: string[];
  measures?: string[];
}

/** One canned row: dimension values plus measure values. */
type GalleryRow = Record<string, unknown>;

/** A record in the demo object below. `id` is what row clicks resolve. */
type GalleryRecord = Record<string, unknown> & { id: string };

/**
 * The one object the gallery serves, in the shape `getObjectSchema` returns
 * everywhere else in the repo — `{ label, fields: { <name>: { label, type } } }`
 * — because that is what `ObjectGrid` / `ObjectForm` read to pick a cell
 * renderer and a field widget.
 *
 * `users` and these field names are the ones `content/docs/plugins/
 * plugin-view.mdx` teaches in its own prose examples, so a reader comparing the
 * live example against the snippet above it sees one object, not two.
 */
const USERS_SCHEMA = {
  name: 'users',
  label: 'Users',
  fields: {
    name: { label: 'Name', type: 'text' },
    email: { label: 'Email', type: 'email' },
    role: {
      label: 'Role',
      type: 'select',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
        { label: 'Viewer', value: 'viewer' },
      ],
    },
    department: { label: 'Department', type: 'text' },
    status: {
      label: 'Status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Invited', value: 'invited' },
        { label: 'Suspended', value: 'suspended' },
      ],
    },
    created_at: { label: 'Created', type: 'date' },
  },
} as const;

const USERS_ROWS: GalleryRecord[] = [
  { id: '1', name: 'Alice Johnson', email: 'alice@example.com', role: 'admin', department: 'Engineering', status: 'active', created_at: '2024-01-14' },
  { id: '2', name: 'Bob Chen', email: 'bob@example.com', role: 'member', department: 'Design', status: 'active', created_at: '2024-02-03' },
  { id: '3', name: 'Carla Gómez', email: 'carla@example.com', role: 'member', department: 'Sales', status: 'invited', created_at: '2024-03-21' },
  { id: '4', name: 'Dan Whitfield', email: 'dan@example.com', role: 'viewer', department: 'Support', status: 'suspended', created_at: '2024-04-09' },
  { id: '5', name: 'Emily Novak', email: 'emily@example.com', role: 'member', department: 'Engineering', status: 'active', created_at: '2024-05-30' },
];

/** Rows per object name. Unknown names resolve to an empty collection. */
const OBJECTS: Record<string, { schema: typeof USERS_SCHEMA; rows: GalleryRecord[] }> = {
  users: { schema: USERS_SCHEMA, rows: USERS_ROWS },
};

/** `$orderby` in every shape `QueryParams` declares, as [field, direction]. */
function orderPairs(orderby: unknown): Array<[string, 'asc' | 'desc']> {
  if (!orderby) return [];
  if (typeof orderby === 'string') {
    return orderby
      .split(',')
      .map((clause) => clause.trim())
      .filter(Boolean)
      .map((clause) => {
        const [field, direction] = clause.split(/\s+/);
        return [field, direction?.toLowerCase() === 'desc' ? 'desc' : 'asc'] as [string, 'asc' | 'desc'];
      });
  }
  if (Array.isArray(orderby)) {
    return orderby.flatMap((entry) =>
      typeof entry === 'string'
        ? orderPairs(entry)
        : entry && typeof entry === 'object' && 'field' in entry
          ? [[(entry as { field: string }).field, (entry as { order?: string }).order === 'desc' ? 'desc' : 'asc'] as [string, 'asc' | 'desc']]
          : [],
    );
  }
  if (typeof orderby === 'object') {
    return Object.entries(orderby as Record<string, string>).map(
      ([field, direction]) => [field, direction === 'desc' ? 'desc' : 'asc'] as [string, 'asc' | 'desc'],
    );
  }
  return [];
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export const galleryDataSource = {
  async queryDataset(dataset: string, query: GalleryDatasetQuery) {
    const dimensions = query?.dimensions ?? [];
    const measures = query?.measures ?? [];
    const measure = measures[0] ?? 'value';
    const rows: GalleryRow[] = dimensions.length
      ? [
          { [dimensions[0]]: 'Alpha', [measure]: 42 },
          { [dimensions[0]]: 'Beta', [measure]: 27 },
        ]
      : [{ [measure]: 69 }];
    // `object` is what makes a chart drillable; a demo fixture has nothing to
    // drill INTO, so it is deliberately omitted along with `dimensionFields`.
    return { rows, fields: [] };
  },

  async getObjectSchema(objectName: string) {
    return OBJECTS[objectName]?.schema ?? { name: objectName, label: objectName, fields: {} };
  },

  async find(objectName: string, params?: Record<string, unknown>) {
    const rows = OBJECTS[objectName]?.rows ?? [];
    const fields = OBJECTS[objectName]?.schema.fields ?? {};
    let result = [...rows];

    const search = typeof params?.$search === 'string' ? params.$search.trim().toLowerCase() : '';
    if (search) {
      const searchable = Array.isArray(params?.$searchFields)
        ? (params.$searchFields as string[])
        : Object.keys(fields);
      result = result.filter((row) =>
        searchable.some((field) => String(row[field] ?? '').toLowerCase().includes(search)),
      );
    }

    for (const [field, direction] of orderPairs(params?.$orderby).reverse()) {
      result.sort((a, b) => (direction === 'desc' ? -1 : 1) * compare(a[field], b[field]));
    }

    const total = result.length;
    const skip = typeof params?.$skip === 'number' ? params.$skip : 0;
    const top = typeof params?.$top === 'number' ? params.$top : undefined;
    return { data: result.slice(skip, top === undefined ? undefined : skip + top), total };
  },

  async findOne(objectName: string, id: string | number) {
    return (OBJECTS[objectName]?.rows ?? []).find((row) => String(row.id) === String(id)) ?? null;
  },

  async create(objectName: string, data: Record<string, unknown>) {
    const record: GalleryRecord = { ...data, id: `demo-${Date.now()}` };
    OBJECTS[objectName]?.rows.unshift(record);
    return record;
  },

  async update(objectName: string, id: string | number, data: Record<string, unknown>) {
    const rows = OBJECTS[objectName]?.rows ?? [];
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index === -1) return { ...data, id } as GalleryRecord;
    rows[index] = { ...rows[index], ...data };
    return rows[index];
  },

  async delete(objectName: string, id: string | number) {
    const rows = OBJECTS[objectName]?.rows ?? [];
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index !== -1) rows.splice(index, 1);
    return true;
  },
};
