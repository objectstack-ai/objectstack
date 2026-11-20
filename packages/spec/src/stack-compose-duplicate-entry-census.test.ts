/**
 * [#35608] The same-package identity check of #22934 at the composition door,
 * for every collection of its table: two sub-stacks of ONE package that each
 * declare one entry under one identity are refused by `composeStacks`, with the
 * one-stack wording, naming both inputs — as `defineStack` refuses the pair
 * inside one stack. And the same table inside every `packages[i]` body.
 *
 * Measured on main `e91d9671` before the fix (the census this card asked for,
 * `composeStacks([A, B])` under the default manifest strategy, A carrying the
 * package manifest and the first entry, B the second entry under the same
 * identity, each input accepted by strict `defineStack` on its own except
 * where noted):
 *
 * ```
 * 26 keys          : ACCEPTED, the composed stack carried both entries (2)
 * objects          : REFUSED, STACK_COMPOSE_OBJECT_CONFLICT (`objectConflict: 'error'`, its own rule)
 * apps             : REFUSED, STACK_SINGLE_APP_VIOLATION (a module package's one-app count)
 * webhooks, apis   : B built with `strict: false` on that run (its own capability / namespace gate);
 *                    the rows below give B what it needs and build it strict
 * ```
 *
 * After the fix every key is refused: 28 by this check (`STACK_CROSS_REFERENCE_INVALID`,
 * which runs before the single-app count, as in `defineStack`), and `objects` by its
 * own object-conflict refusal, which this check leaves to the `objectConflict`
 * strategy. The census covers the table as it stands — 29 keys, the 27 of #22934
 * plus `queues` and `assignmentRules`, which joined the table later.
 *
 * The control is the cross-package reuse ADR-0048 §3.4 allows: under
 * `manifest: 'preserve'` two packages each declaring one entry under one
 * identity compose, each body judged on its own.
 *
 * A boot census (which entry the runtime serves) was not repeated here: #22934
 * measured it for the same collections and the same registrars.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

const manifest = { id: 'com.example.dupe', namespace: 'dupe', name: 'dupe', version: '1.0.0', type: 'module' as const };
const thing = { name: 'dupe_thing', label: 'Thing', sharingModel: 'private' as const, fields: { title: { type: 'text' as const, label: 'Title' } } };
const flow = {
  name: 'dupe_flow',
  label: 'Flow',
  type: 'autolaunched' as const,
  nodes: [{ id: 'start', type: 'start' as const, label: 'Start' }, { id: 'end', type: 'end' as const, label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};
const dataset = {
  name: 'dupe_ds',
  label: 'Dataset',
  object: 'dupe_thing',
  dimensions: [{ name: 'title', field: 'title', type: 'string' as const }],
  measures: [{ name: 'row_count', aggregate: 'count' as const }],
};
const queue = { name: 'dupe_queue', label: 'Queue', members: [] };
const listOf = (object: string) => ({ type: 'grid' as const, data: { provider: 'object' as const, object }, columns: ['title'] });

type Entry = Record<string, unknown>;

interface Row {
  key: string;
  /** The first entry, in the input that carries the package manifest. */
  first: Entry;
  /** A second entry under the same identity, in the second input. */
  second: Entry;
  /** The finding's subject. */
  subject: string;
  /** What the FIRST input needs for its entry to resolve. */
  context?: Entry;
  /** What the second input carries besides its entry (it is a sub-stack of the same package). */
  secondContext?: Entry;
}

const relabel = (e: Entry): Entry => ({ ...e, ...('label' in e ? { label: 'Second' } : { description: 'second' }) });
const byName = (key: string, noun: string, first: Entry & { name: string }, extra: Partial<Row> = {}): Row => ({
  key,
  first,
  second: relabel(first),
  subject: `${noun} '${first.name}'`,
  ...extra,
});

const CENSUS: readonly Row[] = [
  byName('objects', 'Object', { ...thing, name: 'dupe_other', label: 'Other' }),
  byName('datasources', 'Datasource', { name: 'dupe_ext', label: 'Ext', driver: 'sqlite', config: { filename: ':memory:' } }),
  byName('pages', 'Page', { name: 'dupe_page', label: 'Page', type: 'app', regions: [] }),
  byName('dashboards', 'Dashboard', { name: 'dupe_dash', label: 'Dash', widgets: [] }),
  byName('reports', 'Report', { name: 'dupe_report', label: 'Report', type: 'summary', dataset: 'dupe_ds', rows: ['title'], values: ['row_count'] }, { context: { datasets: [dataset] } }),
  byName('datasets', 'Dataset', dataset),
  byName('flows', 'Flow', flow),
  byName('jobs', 'Job', { name: 'dupe_job', label: 'Job', schedule: { type: 'interval', intervalMs: 60000 }, body: { language: 'js', source: 'return 1;', capabilities: [] } }),
  byName('emailTemplates', 'Email template', { name: 'dupe_mail', label: 'Mail', subject: 'Hi', bodyHtml: '<p>Hello</p>' }, { subject: "Email template 'dupe_mail' for locale 'en-US'" }),
  byName('books', 'Book', { name: 'dupe_book', label: 'Book', groups: [] }),
  byName('positions', 'Position', { name: 'dupe_pos', label: 'Pos' }),
  byName('permissions', 'Permission set', { name: 'dupe_perm', label: 'Perm', objects: {} }),
  byName('capabilities', 'Capability', { name: 'dupe.export', label: 'Export' }),
  byName('sharingRules', 'Sharing rule', { name: 'dupe_share', label: 'Share', object: 'dupe_thing', type: 'criteria', condition: 'true', sharedWith: { type: 'team', value: 'team_ops' } }),
  byName('queues', 'Queue', queue),
  byName('assignmentRules', 'Assignment rule', { name: 'dupe_route', object: 'dupe_thing', entries: [{ name: 'to_queue', assignTo: { type: 'queue', value: 'dupe_queue' } }] }, { context: { queues: [queue] } }),
  byName('webhooks', 'Webhook', { name: 'dupe_webhook', label: 'Webhook', object: 'dupe_thing', triggers: ['create'], url: 'https://example.com/hook' }, {
    context: { requires: ['webhooks', 'realtime'] },
    secondContext: { requires: ['webhooks', 'realtime'] },
  }),
  byName('hooks', 'Hook', { name: 'dupe_hook', label: 'Hook', object: 'dupe_thing', events: ['beforeInsert'], handler: () => {} }),
  byName('mappings', 'Mapping', { name: 'dupe_map', label: 'Map', targetObject: 'dupe_thing', fieldMapping: [{ source: 'a', target: 'title' }] }),
  byName('analyticsCubes', 'Analytics cube', { name: 'dupe_cube', title: 'Cube', description: 'first', sql: 'dupe_thing', measures: {}, dimensions: {} }),
  byName('connectors', 'Connector', { name: 'dupe_conn', label: 'Conn', type: 'api' }),
  byName('picklists', 'Picklist', { name: 'dupe_pick', label: 'Pick', options: [{ value: 'aa', label: 'A' }] }),
  byName('docs', 'Doc', { name: 'dupe_doc', label: 'Doc', content: '# Doc' }),
  byName('tools', 'Tool', { name: 'dupe_tool', label: 'Tool', description: 'tool', parameters: { type: 'object', properties: {} } }),
  byName('skills', 'Skill', { name: 'dupe_skill', label: 'Skill', description: 'skill', instructions: 'x', tools: [] }),
  {
    // The second container binds the same object the other way round: no
    // top-level `object`, the binding read off its form.
    key: 'views',
    first: { object: 'dupe_thing', list: listOf('dupe_thing') },
    second: { form: { type: 'simple', data: { provider: 'object', object: 'dupe_thing' }, sections: [{ fields: ['title'] }] } },
    subject: "View container 'dupe_thing'",
  },
  {
    // One name on two paths (one METHOD + path is the endpoint gate's own
    // refusal). An `apis` stack owes an explicit namespace, so the second
    // sub-stack carries the package manifest too.
    ...byName('apis', 'API endpoint', { name: 'dupe_api', description: 'api', path: '/api/v1/apps/dupe/p1', method: 'GET', type: 'flow', target: 'dupe_flow' }, {
      context: { flows: [flow] },
      secondContext: { manifest },
    }),
    second: { name: 'dupe_api', description: 'api', path: '/api/v1/apps/dupe/p2', method: 'GET', type: 'flow', target: 'dupe_flow' },
  },
  byName('apps', 'App', { name: 'dupe_app', label: 'App', navigation: [{ id: 'nav_1', type: 'object', objectName: 'dupe_thing', label: 'Thing' }] }),
  {
    key: 'objectExtensions',
    first: { extend: 'dupe_thing', fields: { ext_one: { type: 'text', label: 'Ext one' } } },
    second: { extend: 'dupe_thing', fields: { ext_two: { type: 'text', label: 'Ext two' } } },
    subject: "Object extension of 'dupe_thing'",
  },
];

interface Refusal { name?: string; code?: string; status?: number; issues?: readonly string[]; message: string }

function refusalOf(run: () => unknown): Refusal | null {
  try {
    run();
    return null;
  } catch (e) {
    return e as Refusal;
  }
}

/** The input carrying the package manifest and the row's first entry. */
const firstInput = (row: Row, m: Entry = manifest) =>
  defineStack({
    manifest: m,
    objects: row.key === 'objects' ? [thing, row.first] : [thing],
    ...row.context,
    ...(row.key === 'objects' ? {} : { [row.key]: [row.first] }),
  } as never);

/** A second sub-stack of the same package, carrying the second entry (strict: accepted on its own). */
const secondInput = (row: Row) =>
  defineStack(
    { ...row.secondContext, [row.key]: [row.second] } as never,
    row.key === 'apis' ? { artifactFlows: ['dupe_flow'] } : undefined,
  );

const index = (row: Row): number => (row.key === 'objects' ? 1 : 0);

describe('composeStacks - two sub-stacks of one package under one identity, every key of the table', () => {
  it('the census covers the 29 keys of the identity table, in its order', () => {
    expect(CENSUS.map((row) => row.key)).toEqual([
      'objects', 'datasources', 'pages', 'dashboards', 'reports', 'datasets', 'flows', 'jobs', 'emailTemplates',
      'books', 'positions', 'permissions', 'capabilities', 'sharingRules', 'queues', 'assignmentRules', 'webhooks',
      'hooks', 'mappings', 'analyticsCubes', 'connectors', 'picklists', 'docs', 'tools', 'skills', 'views', 'apis',
      'apps', 'objectExtensions',
    ]);
  });

  it.each(CENSUS.map((row) => [row.key, row] as const))('%s: each input is accepted on its own', (_key, row) => {
    expect(refusalOf(() => firstInput(row))).toBeNull();
    expect(refusalOf(() => secondInput(row))).toBeNull();
  });

  it('objects: refused by the object-conflict strategy, which owns that key at composition', () => {
    const row = CENSUS.find((candidate) => candidate.key === 'objects')!;
    const r = refusalOf(() => composeStacks([firstInput(row), secondInput(row)]));
    expect(r?.code).toBe('STACK_COMPOSE_OBJECT_CONFLICT');
    expect(r?.status).toBe(422);
  });

  it.each(CENSUS.filter((row) => row.key !== 'objects').map((row) => [row.key, row] as const))(
    '%s: refused in the cross-reference envelope with the one-stack wording, naming both inputs',
    (_key, row) => {
      const r = refusalOf(() => composeStacks([firstInput(row), secondInput(row)]));
      expect(r, 'the composition is refused').not.toBeNull();
      expect(r!.name).toBe('StackCrossReferenceError');
      expect(r!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
      expect(r!.status).toBe(422);
      expect(r!.issues).toHaveLength(1);
      expect(r!.message).toContain('composeStacks artifact cross-reference validation failed (1 issue):');
      const second = row.secondContext?.manifest ? "'com.example.dupe' (stack #1)" : 'stack #1';
      expect(r!.issues![0]).toMatch(
        new RegExp(
          `^${escape(row.subject)} is declared twice in \`${row.key}\`: ` +
            `${escape(`'com.example.dupe' (stack #0) ${row.key}[${index(row)}] and ${second} ${row.key}[0]`)}\\. `,
        ),
      );
    },
  );

  it.each(CENSUS.filter((row) => row.key !== 'objects').map((row) => [row.key, row] as const))(
    '%s: refused inside a `packages[i]` body of a stack, at the body\'s path',
    (_key, row) => {
      const body = {
        ...manifest,
        objects: [thing],
        ...row.context,
        [row.key]: [row.first, row.second],
      };
      const r = refusalOf(() => defineStack({ manifest, packages: [{ manifest: body }] } as never));
      expect(r?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
      const finding = (r?.issues ?? []).find((issue) => issue.startsWith(`${row.subject} is declared twice`));
      expect(finding, `a finding for ${row.subject}`).toBeDefined();
      expect(finding).toContain(
        `in \`${row.key}\`: stack.packages[0].manifest.${row.key}[0] and stack.packages[0].manifest.${row.key}[1]. `,
      );
    },
  );
});

describe('composeStacks - CONTROL: two packages each declaring one entry under one identity compose (ADR-0048 §3.4)', () => {
  const other = { ...manifest, id: 'com.example.other', name: 'other' };

  /** The second row entry as a package of its own: object-less, so its references are not judged here. */
  const otherPackage = (row: Row) =>
    defineStack(
      { ...row.secondContext, manifest: other, [row.key]: [row.second] } as never,
      row.key === 'apis' ? { artifactFlows: ['dupe_flow'] } : undefined,
    );

  it.each(CENSUS.filter((row) => row.key !== 'objects').map((row) => [row.key, row] as const))(
    '%s: under `manifest: \'preserve\'` each body is judged on its own, and the pair composes',
    (_key, row) => {
      const r = refusalOf(() => composeStacks([firstInput(row), otherPackage(row)], { manifest: 'preserve' }));
      expect(r?.message ?? null).toBeNull();
      const artifact = composeStacks([firstInput(row), otherPackage(row)], { manifest: 'preserve' }) as unknown as {
        packages: Array<{ manifest: Record<string, unknown[]> }>;
      };
      expect(artifact.packages.map((p) => p.manifest[row.key]?.length)).toEqual([1, 1]);
    },
  );
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
