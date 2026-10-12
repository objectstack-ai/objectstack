/**
 * `defineStack` refuses two entries of one named collection that the runtime
 * would register under one identity — for the 27 collections of #22934, and
 * only those.
 *
 * Measured on main `246edf5b3` before the check existed (#22934 stage 0), each
 * collection carrying two entries under one identity: `defineStack` and
 * `os validate --json` accepted every pair (exit 0, `valid: true`), and the
 * boot — from source and from a built artifact — then kept one entry silently
 * or diverged:
 *
 * ```
 * 23 named collections + objectExtensions : last entry wins on both paths, no notice at the default log level
 * datasources                             : metadata describes the last entry, the driver connects the first's config
 * hooks                                   : metadata lists one hook, both handlers bind and run
 * docs                                    : os validate / os build refuse (docs/duplicate-name), a source boot keeps the last
 * ```
 *
 * The identity is what the registrars key an entry by: `name` (25 keys),
 * `extend` (`objectExtensions`), and for `views` the object an aggregated
 * container binds to (`deriveViewContainerObject`). Out of the table, each
 * for its own reason: `plugins`, `agents`, `picklistExtensions`, and `actions`
 * / `functions`, which have their own checks (`stack-duplicate-action-key`,
 * `stack-duplicate-function-name`).
 *
 * Refusals assert the ADR-0112 envelope (`code` + `status`), the issue count,
 * the header and the named subjects — the collection, the identity and every
 * index — rather than a bare `toThrow()`, which a refusal for any other reason
 * would also satisfy. Every refusal row differs from its CONTROL row by the
 * second entry's identity alone.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';
import { MAP_SUPPORTED_FIELDS } from './shared/metadata-collection.zod';

const manifest = {
  id: 'com.example.dupe',
  namespace: 'dupe',
  name: 'duplicate-entry-test',
  version: '1.0.0',
  // A module package: an `app` package's single-app count would refuse two
  // DISTINCT apps, which the control rows need to accept.
  type: 'module' as const,
};

const thing = {
  name: 'dupe_thing',
  label: 'Thing',
  sharingModel: 'private' as const,
  fields: { title: { type: 'text' as const, label: 'Title' } },
};

const flow = {
  name: 'dupe_flow',
  label: 'Flow',
  type: 'autolaunched' as const,
  nodes: [
    { id: 'start', type: 'start' as const, label: 'Start' },
    { id: 'end', type: 'end' as const, label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const dataset = {
  name: 'dupe_ds',
  label: 'Dataset',
  object: 'dupe_thing',
  dimensions: [{ name: 'title', field: 'title', type: 'string' as const }],
  measures: [{ name: 'row_count', aggregate: 'count' as const }],
};

const listOf = (object: string) => ({
  type: 'grid' as const,
  data: { provider: 'object' as const, object },
  columns: ['title'],
});

type Entry = Record<string, unknown>;

interface Row {
  /** The collection. */
  key: string;
  /** A spec-valid entry carrying `identity`. */
  entry: Entry;
  /** The identity the registrars key `entry` by. */
  identity: string;
  /** A second entry under the SAME identity, differing in content. */
  sameIdentity: (entry: Entry) => Entry;
  /** A second entry under a DIFFERENT identity (the control). */
  otherIdentity: (entry: Entry) => Entry;
  /** How the finding opens. */
  subject: string;
  /** What else the stack needs for `entry` to resolve. */
  context?: Record<string, unknown>;
}

/** Most rows: identity is `name`; the twin relabels, the control renames. */
const byName = (
  key: string,
  noun: string,
  entry: Entry & { name: string },
  context?: Record<string, unknown>,
): Row => ({
  key,
  entry,
  identity: entry.name,
  sameIdentity: (e) => ({ ...e, ...('label' in e ? { label: 'Second' } : { description: 'second' }) }),
  otherIdentity: (e) => ({ ...e, name: `${entry.name}_two` }),
  subject: `${noun} '${entry.name}'`,
  context,
});

const BATCH: readonly Row[] = [
  byName('objects', 'Object', { name: 'dupe_other', label: 'Other', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }),
  byName('datasources', 'Datasource', { name: 'dupe_ext', label: 'Ext', driver: 'sqlite', config: { filename: ':memory:' } }),
  byName('pages', 'Page', { name: 'dupe_page', label: 'Page', type: 'app', regions: [] }),
  byName('dashboards', 'Dashboard', { name: 'dupe_dash', label: 'Dash', widgets: [] }),
  byName('reports', 'Report', { name: 'dupe_report', label: 'Report', type: 'summary', dataset: 'dupe_ds', rows: ['title'], values: ['row_count'] }, { datasets: [dataset] }),
  byName('datasets', 'Dataset', dataset),
  byName('flows', 'Flow', flow),
  byName('jobs', 'Job', { name: 'dupe_job', label: 'Job', schedule: { type: 'interval', intervalMs: 60000 }, body: { language: 'js', source: 'return 1;', capabilities: [] } }),
  byName('emailTemplates', 'Email template', { name: 'dupe_mail', label: 'Mail', subject: 'Hi', bodyHtml: '<p>Hello</p>' }),
  byName('books', 'Book', { name: 'dupe_book', label: 'Book', groups: [] }),
  byName('positions', 'Position', { name: 'dupe_pos', label: 'Pos' }),
  byName('permissions', 'Permission set', { name: 'dupe_perm', label: 'Perm', objects: {} }),
  byName('capabilities', 'Capability', { name: 'dupe.export', label: 'Export' }),
  byName('sharingRules', 'Sharing rule', { name: 'dupe_share', label: 'Share', object: 'dupe_thing', type: 'criteria', condition: 'true', sharedWith: { type: 'team', value: 'team_ops' } }),
  byName('webhooks', 'Webhook', { name: 'dupe_webhook', label: 'Webhook', object: 'dupe_thing', triggers: ['create'], url: 'https://example.com/hook' }),
  byName('hooks', 'Hook', { name: 'dupe_hook', label: 'Hook', object: 'dupe_thing', events: ['beforeInsert'], handler: () => {} }),
  byName('mappings', 'Mapping', { name: 'dupe_map', label: 'Map', targetObject: 'dupe_thing', fieldMapping: [{ source: 'a', target: 'title' }] }),
  byName('analyticsCubes', 'Analytics cube', { name: 'dupe_cube', title: 'Cube', description: 'first', sql: 'dupe_thing', measures: {}, dimensions: {} }),
  byName('connectors', 'Connector', { name: 'dupe_conn', label: 'Conn', type: 'api' }),
  byName('picklists', 'Picklist', { name: 'dupe_pick', label: 'Pick', options: [{ value: 'aa', label: 'A' }] }),
  byName('docs', 'Doc', { name: 'dupe_doc', label: 'Doc', content: '# Doc' }),
  byName('tools', 'Tool', { name: 'dupe_tool', label: 'Tool', description: 'tool', parameters: { type: 'object', properties: {} } }),
  byName('skills', 'Skill', { name: 'dupe_skill', label: 'Skill', description: 'skill', instructions: 'x', tools: [] }),
  {
    key: 'views',
    entry: { object: 'dupe_thing', list: listOf('dupe_thing') },
    identity: 'dupe_thing',
    // A second container for the same object, written the other way round:
    // no top-level `object`, the binding read off its form instead.
    sameIdentity: () => ({
      form: { type: 'simple', data: { provider: 'object', object: 'dupe_thing' }, sections: [{ fields: ['title'] }] },
    }),
    otherIdentity: () => ({ object: 'dupe_second', list: listOf('dupe_second') }),
    subject: "View container 'dupe_thing'",
    context: { objects: [thing, { ...thing, name: 'dupe_second', label: 'Second' }] },
  },
  {
    // Same METHOD + path is the endpoint gate's own refusal; one name on two
    // paths is what reached the boot, and its first path answered 404.
    ...byName('apis', 'API endpoint', { name: 'dupe_api', description: 'api', path: '/api/v1/apps/dupe/p1', method: 'GET', type: 'flow', target: 'dupe_flow' }, { flows: [flow] }),
    sameIdentity: (e) => ({ ...e, path: '/api/v1/apps/dupe/p2' }),
    otherIdentity: (e) => ({ ...e, name: 'dupe_api_two', path: '/api/v1/apps/dupe/p2' }),
  },
  byName('apps', 'App', { name: 'dupe_app', label: 'App', navigation: [{ id: 'nav_1', type: 'object', objectName: 'dupe_thing', label: 'Thing' }] }),
  {
    key: 'objectExtensions',
    entry: { extend: 'dupe_thing', fields: { ext_one: { type: 'text', label: 'Ext one' } } },
    identity: 'dupe_thing',
    sameIdentity: () => ({ extend: 'dupe_thing', fields: { ext_two: { type: 'text', label: 'Ext two' } } }),
    otherIdentity: () => ({ extend: 'dupe_second', fields: { ext_two: { type: 'text', label: 'Ext two' } } }),
    subject: "Object extension of 'dupe_thing'",
    context: { objects: [thing, { ...thing, name: 'dupe_second', label: 'Second' }] },
  },
];

interface Refusal {
  name?: string;
  code?: string;
  status?: number;
  issues?: readonly string[];
  message: string;
}

/** The stack `row` builds with `entries` in its collection. */
function stackOf(row: Row, entries: Entry[]): Record<string, unknown> {
  const stack: Record<string, unknown> = { manifest, objects: [thing], ...row.context };
  stack[row.key] = row.key === 'objects' ? [...(stack.objects as Entry[]), ...entries] : entries;
  return stack;
}

/** The thrown refusal, or `null` when the stack is accepted. */
function refusal(stack: Record<string, unknown>, options?: Parameters<typeof defineStack>[1]): Refusal | null {
  try {
    defineStack(stack as never, options);
    return null;
  } catch (e) {
    return e as Refusal;
  }
}

function expectCrossReferenceEnvelope(r: Refusal | null, issueCount: number): asserts r is Refusal {
  expect(r, 'the stack is refused').not.toBeNull();
  expect(r!.name).toBe('StackCrossReferenceError');
  expect(r!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(r!.status).toBe(422);
  expect(r!.issues).toHaveLength(issueCount);
  expect(r!.message).toContain(
    `defineStack cross-reference validation failed (${issueCount} issue${issueCount === 1 ? '' : 's'}):`,
  );
}

/** The one finding opening with `subject` in `key`, which must name exactly `indices`. */
function findingFor(r: Refusal, key: string, subject: string, indices: number[]): string {
  const found = (r.issues ?? []).filter((issue) => issue.startsWith(`${subject} is declared `));
  expect(found, `exactly one finding for ${subject}`).toHaveLength(1);
  const finding = found[0];
  expect(finding).toContain(`in \`${key}\`: `);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = [...finding.matchAll(new RegExp(`stack\\.${escaped}\\[(\\d+)\\]`, 'g'))].map((m) => Number(m[1]));
  expect(named, `the indices ${subject} names`).toEqual(indices);
  // The finding reaches the message too, as one `✗` line.
  expect(r.message).toContain(`  ✗ ${finding}`);
  return finding;
}

/** Where the first batch entry sits in its collection (`objects` keeps `thing` first). */
const firstIndex = (row: Row): number => (row.key === 'objects' ? 1 : 0);

describe('defineStack - a duplicate identity inside one named collection is refused', () => {
  it('covers exactly the 27 collections of the batch', () => {
    expect(BATCH.map((row) => row.key)).toEqual([
      'objects', 'datasources', 'pages', 'dashboards', 'reports', 'datasets', 'flows', 'jobs',
      'emailTemplates', 'books', 'positions', 'permissions', 'capabilities', 'sharingRules', 'webhooks',
      'hooks', 'mappings', 'analyticsCubes', 'connectors', 'picklists', 'docs', 'tools', 'skills', 'views',
      'apis', 'apps', 'objectExtensions',
    ]);
  });

  it.each(BATCH.map((row) => [row.key, row] as const))(
    '%s: two entries under one identity are refused, naming the collection, the identity and both indices',
    (_key, row) => {
      const r = refusal(stackOf(row, [row.entry, row.sameIdentity(row.entry)]));
      expectCrossReferenceEnvelope(r, 1);
      const at = firstIndex(row);
      const finding = findingFor(r, row.key, row.subject, [at, at + 1]);
      expect(finding).toContain('is declared twice');
    },
  );

  it.each(BATCH.filter((row) => row.key !== 'apis').map((row) => [row.key, row] as const))(
    '%s: byte-identical twins are refused too — two registrations whatever they hold',
    (_key, row) => {
      const r = refusal(stackOf(row, [row.entry, { ...row.entry }]));
      expectCrossReferenceEnvelope(r, 1);
      const at = firstIndex(row);
      findingFor(r, row.key, row.subject, [at, at + 1]);
    },
  );

  it('apis: a byte-identical twin repeats METHOD + path too, which the endpoint gate already refuses at the parse', () => {
    const row = BATCH.find((candidate) => candidate.key === 'apis')!;
    const r = refusal(stackOf(row, [row.entry, { ...row.entry }]));
    expect(r?.code).toBe('STACK_SCHEMA_INVALID');
    expect(r?.status).toBe(422);
  });

  it('one finding per collision, each listing every index, across collections', () => {
    const page = (name: string, label: string) => ({ name, label, type: 'app' as const, regions: [] });
    const r = refusal({
      manifest,
      objects: [thing],
      pages: [page('dupe_a', 'A1'), page('dupe_b', 'B1'), page('dupe_a', 'A2'), page('dupe_c', 'C'), page('dupe_a', 'A3')],
      flows: [flow, { ...flow, label: 'Second' }],
    });
    expectCrossReferenceEnvelope(r, 2);
    expect(findingFor(r, 'pages', "Page 'dupe_a'", [0, 2, 4])).toContain('is declared 3 times');
    findingFor(r, 'flows', "Flow 'dupe_flow'", [0, 1]);
    expect(r.issues!.some((issue) => issue.includes("'dupe_b'") || issue.includes("'dupe_c'"))).toBe(false);
  });

  it('refuses in an object-less stack — the check needs no object to resolve against', () => {
    const page = { name: 'dupe_page', label: 'Page', type: 'app' as const, regions: [] };
    const r = refusal({ manifest, pages: [page, { ...page, label: 'Second' }] });
    expectCrossReferenceEnvelope(r, 1);
    findingFor(r, 'pages', "Page 'dupe_page'", [0, 1]);
  });

  it('refuses two map keys whose entries spell one explicit `name` — the normalized identity collides', () => {
    const r = refusal({
      manifest,
      objects: [thing],
      pages: {
        dupe_a: { name: 'dupe_x', label: 'A', type: 'app', regions: [] },
        dupe_b: { name: 'dupe_x', label: 'B', type: 'app', regions: [] },
      },
    });
    expectCrossReferenceEnvelope(r, 1);
    findingFor(r, 'pages', "Page 'dupe_x'", [0, 1]);
  });

  it('views: a named container and an unnamed one bound to the same object collide on that object', () => {
    const r = refusal({
      manifest,
      objects: [thing],
      views: [{ name: 'dupe_thing', list: listOf('dupe_thing') }, { list: listOf('dupe_thing') }],
    });
    expectCrossReferenceEnvelope(r, 1);
    findingFor(r, 'views', "View container 'dupe_thing'", [0, 1]);
  });

  it('apps: on an `app` package two apps under one name are this refusal, which runs before the single-app count', () => {
    const app = { name: 'dupe_app', label: 'App' };
    const r = refusal({ manifest: { ...manifest, type: 'app' }, objects: [thing], apps: [app, { ...app, label: 'Second' }] });
    expectCrossReferenceEnvelope(r, 1);
    findingFor(r, 'apps', "App 'dupe_app'", [0, 1]);
  });

  it('joins the existing aggregate: one envelope with the action-key and function-name findings', () => {
    const act = (name: string) => ({ name, label: name, type: 'script' as const, target: 'noop' });
    const page = { name: 'dupe_page', label: 'Page', type: 'app' as const, regions: [] };
    const r = refusal({
      manifest,
      objects: [thing],
      actions: [act('dupe_go'), act('dupe_go')],
      functions: [{ name: 'kc_a', handler: () => 1 }, { name: 'kc_a', handler: () => 2 }],
      pages: [page, { ...page, label: 'Second' }],
    });
    expectCrossReferenceEnvelope(r, 3);
    findingFor(r, 'pages', "Page 'dupe_page'", [0, 1]);
    expect(r.issues!.some((issue) => issue.startsWith("Action key 'global:dupe_go' is declared twice"))).toBe(true);
    expect(r.issues!.some((issue) => issue.startsWith("Function 'kc_a' is declared twice"))).toBe(true);
  });

  it.each(BATCH.map((row) => [row.key, row] as const))(
    '%s: is skipped under `strict: false`, like every other cross-reference check',
    (_key, row) => {
      expect(refusal(stackOf(row, [row.entry, row.sameIdentity(row.entry)]), { strict: false })).toBeNull();
    },
  );
});

describe('defineStack - CONTROL: distinct identities and the out-of-batch collections are accepted unchanged', () => {
  it.each(BATCH.map((row) => [row.key, row] as const))(
    '%s: two entries under two identities are accepted, in order',
    (_key, row) => {
      const second = row.otherIdentity(row.entry);
      expect(refusal(stackOf(row, [row.entry, second]))).toBeNull();
      const out = defineStack(stackOf(row, [row.entry, second]) as never) as unknown as Record<string, Entry[]>;
      const at = firstIndex(row);
      expect(out[row.key]).toHaveLength(at + 2);
    },
  );

  const mapRows = BATCH.filter((row) => (MAP_SUPPORTED_FIELDS as readonly string[]).includes(row.key));

  it('the map-supported collections in the batch are the 19 the normalizer names', () => {
    expect(mapRows.map((row) => row.key).sort()).toEqual([
      'analyticsCubes', 'apis', 'apps', 'connectors', 'dashboards', 'datasets', 'datasources', 'emailTemplates',
      'flows', 'hooks', 'jobs', 'mappings', 'objects', 'pages', 'permissions', 'positions', 'reports',
      'sharingRules', 'webhooks',
    ]);
  });

  it.each(mapRows.map((row) => [row.key, row] as const))(
    '%s: the map form under two keys is accepted, each key its entry\'s name',
    (_key, row) => {
      const strip = ({ name: _drop, ...rest }: Entry) => rest;
      const second = row.otherIdentity(row.entry);
      const map: Record<string, Entry> = {
        [row.identity]: strip(row.entry),
        [String(second.name)]: strip(second),
      };
      const stack: Record<string, unknown> = { manifest, objects: [thing], ...row.context };
      if (row.key === 'objects') map[thing.name] = strip(thing);
      stack[row.key] = map;
      expect(refusal(stack)).toBeNull();
      const out = defineStack(stack as never) as unknown as Record<string, Array<{ name: string }>>;
      expect(out[row.key].map((e) => e.name)).toEqual(Object.keys(map));
    },
  );

  it('the cross-scope action pair — one global, one object-bound, one name — stays accepted', () => {
    const act = { name: 'dupe_go', label: 'Go', type: 'script' as const, target: 'noop' };
    expect(refusal({ manifest, objects: [thing], actions: [act, { ...act, objectName: 'dupe_thing' }] })).toBeNull();
  });

  it('`plugins`, `agents` and `picklistExtensions` are not in the table: a repeated identity there is not this refusal', () => {
    const plugin = { name: 'com.example.dupe.plugin', init: () => {} };
    const agent = { name: 'dupe_agent', label: 'Agent', role: 'helper', instructions: 'help' };
    expect(refusal({
      manifest,
      objects: [thing],
      plugins: [plugin, plugin],
      agents: [agent, { ...agent, label: 'Second' }],
      picklists: [{ name: 'dupe_pick', label: 'Pick', options: [{ value: 'aa', label: 'A' }] }],
      picklistExtensions: [
        { extend: 'dupe_pick', options: [{ value: 'bb', label: 'B' }] },
        { extend: 'dupe_pick', options: [{ value: 'cc', label: 'C' }] },
      ],
    })).toBeNull();
  });
});
