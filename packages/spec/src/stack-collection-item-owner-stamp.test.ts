// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0010] The BUILD door of the collection-item owner-stamp rule: the stack
 * schema refuses an item whose body carries a `_packageId` other than the
 * package that ships it (`applyCollectionItemOwnerStampGate`, `stack.zod.ts`,
 * calling `judgeCollectionItemOwnerStamp`).
 *
 * Before this gate such a stack parsed, and only the registration door refused
 * it, at boot or install. `defineStack`, `os validate`, `os build` and the
 * artifact door all run this one parse, so it is pinned here on the parse and
 * through `defineStack`, with the envelope each answers: the issue's `code` and
 * path at the parse, `STACK_SCHEMA_INVALID` / 422 from `defineStack`.
 *
 * The judge reads the PARSED stack, so a key the parse dropped would make it
 * unreachable: every judged collection's item schema declares `_packageId`
 * (`MetadataProtectionFields`, held by the authorable-surface ratchet), and the
 * last suite drives one item of each shape class (a plain item, a transformed
 * action, a seed dataset, a view container) through the parse to the judge.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack, ObjectStackDefinitionSchema } from './stack.zod';
import {
  judgeCollectionItemOwnerStamp,
  OWNER_STAMP_JUDGED_COLLECTIONS,
  type OwnerStampJudgedCollection,
} from './kernel/collection-item-owner-stamp';

type Envelope = Error & { code?: string; status?: number; issues?: Array<{ code?: string; path?: PropertyKey[]; message?: string }> };

const CRM = 'com.acme.crm';
const OTHER = 'com.acme.other';

const connector = (name: string, stamp?: unknown) => ({
  name,
  label: 'Probe',
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec: './specs/billing.json' },
  ...(stamp === undefined ? {} : { _packageId: stamp }),
});

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  namespace: 'crm',
  version: '1.0.0',
  type: 'app' as const,
  ...extra,
});

function refusal(config: unknown): Envelope | null {
  try {
    defineStack(config as never);
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

/** Every issue the parse raises at a `_packageId`, as `[path, code, message]`. */
function stampIssues(config: unknown): Array<[string, string, string]> {
  const result = ObjectStackDefinitionSchema.safeParse(config);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.path[i.path.length - 1] === '_packageId')
    .map((i) => [i.path.join('.'), i.code, i.message]);
}

describe('[ADR-0010] defineStack refuses a collection item whose body `_packageId` is not the stack\'s package', () => {
  it('a connector naming another package: STACK_SCHEMA_INVALID / 422, the issue at its `_packageId`, in the judge\'s build words', () => {
    const error = refusal({ manifest: manifest(CRM), connectors: [connector('probe_conn', OTHER)] });
    expect(error, 'the stack must be refused').not.toBeNull();
    expect(error).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issue = error!.issues!.find((i) => i.path?.join('.') === 'connectors.0._packageId');
    expect(issue, 'located at the item\'s key').toMatchObject({ code: 'custom' });
    expect(issue!.message).toBe(
      judgeCollectionItemOwnerStamp({ _packageId: OTHER }, 'connector', 'probe_conn', CRM, 'build')!.message,
    );
    expect(issue!.message!.indexOf("Drop `_packageId` from connector 'probe_conn'")).toBe(0);
  });

  it('CONTROL: the same stack without the stamp, and with a stamp equal to `manifest.id`, is accepted', () => {
    expect(refusal({ manifest: manifest(CRM), connectors: [connector('probe_conn')] })).toBeNull();
    expect(refusal({ manifest: manifest(CRM), connectors: [connector('probe_conn', CRM)] })).toBeNull();
  });

  it('`\'\'` is a stamp: refused by the judge; `null` is a stamp too, refused first by the item schema at the same key', () => {
    expect(stampIssues({ manifest: manifest(CRM), connectors: [connector('probe_conn', '')] }))
      .toEqual([['connectors.0._packageId', 'custom', expect.stringContaining('carries _packageId "", but this stack ships it')]]);
    expect(stampIssues({ manifest: manifest(CRM), connectors: [connector('probe_conn', null)] }))
      .toEqual([['connectors.0._packageId', 'invalid_type', expect.any(String)]]);
  });

  it('a stack with no `manifest` ships its items from no package: any stamp is refused', () => {
    for (const stamp of [OTHER, CRM]) {
      expect(stampIssues({ connectors: [connector('probe_conn', stamp)] }), stamp)
        .toEqual([['connectors.0._packageId', 'custom', expect.stringContaining('from no package (the stack declares no `manifest`)')]]);
    }
    expect(stampIssues({ connectors: [connector('probe_conn')] })).toEqual([]);
  });

  it('a map-format collection is judged on the array it normalises to', () => {
    const error = refusal({
      manifest: manifest(CRM),
      connectors: { probe_conn: { label: 'Probe', type: 'api', provider: 'openapi', providerConfig: { spec: './s.json' }, _packageId: OTHER } },
    });
    expect(error).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(error!.issues!.map((i) => i.path?.join('.'))).toContain('connectors.0._packageId');
  });
});

describe('[ADR-0010] the parse keeps the stamp for the judge, across shape classes', () => {
  const stack = (extra: Record<string, unknown>) => ({ manifest: manifest(CRM), ...extra });

  it('an action (a transformed item schema) is judged at its `_packageId`', () => {
    const action = { name: 'crm_go', label: 'Go', type: 'script', target: 'go' };
    expect(stampIssues(stack({ actions: [{ ...action, _packageId: OTHER }] })).map(([p, c]) => [p, c]))
      .toEqual([['actions.0._packageId', 'custom']]);
    expect(stampIssues(stack({ actions: [action] }))).toEqual([]);
  });

  it('a seed dataset is judged under the type word `data`, named by its object', () => {
    const data = { object: 'crm_task', records: [] };
    expect(stampIssues(stack({ data: [{ ...data, _packageId: OTHER }] })))
      .toEqual([['data.0._packageId', 'custom', expect.stringContaining("Drop `_packageId` from data 'crm_task'")]]);
    expect(stampIssues(stack({ data: [data] }))).toEqual([]);
  });

  it('a view container is judged, named by the object it binds to', () => {
    const view = { object: 'crm_task', list: { type: 'grid', columns: ['name'] } };
    expect(stampIssues(stack({ views: [{ ...view, _packageId: OTHER }] })))
      .toEqual([['views.0._packageId', 'custom', expect.stringContaining("Drop `_packageId` from view 'crm_task'")]]);
    expect(stampIssues(stack({ views: [view] }))).toEqual([]);
  });
});

describe('[ADR-0010] a release artifact\'s items are judged against the package that registers each one', () => {
  /** Two packages composed as `os build` does (ADR-0130 D4), the crm connector's stamp as the variable. */
  // The artifact's own manifest is the LAST input's (`'preserve'` keeps the
  // `'last'` pick), so it is the orders module's, never the package under test.
  const twoPackages = (crmStamp?: string) => composeStacks([
    defineStack({ manifest: manifest(CRM), connectors: [connector('crm_conn', crmStamp)] } as never, { strict: false }),
    defineStack({ manifest: manifest('com.acme.orders', { type: 'module' }), connectors: [connector('orders_conn')] } as never),
  ], { manifest: 'preserve' }) as unknown as {
    manifest: { id: string };
    packages: Array<{ manifest: Record<string, unknown> }>;
    [key: string]: unknown;
  };

  it('a body\'s item is judged against that body\'s own id', () => {
    const artifact = twoPackages(OTHER);
    const at = artifact.packages.findIndex((p) => p.manifest.id === CRM);
    expect(stampIssues(artifact).map(([path]) => path)).toEqual([`packages.${at}.manifest.connectors.0._packageId`]);
    // CONTROL: the stamp naming the body that ships it, and no stamp.
    expect(stampIssues(twoPackages(CRM))).toEqual([]);
    expect(stampIssues(twoPackages())).toEqual([]);
  });

  it('a top-level item no body declares is the residual, judged against the artifact\'s `manifest.id`', () => {
    const artifact = { ...twoPackages(), connectors: [connector('stray_conn', OTHER)] };
    const owner = artifact.manifest.id;
    expect(stampIssues(artifact)).toEqual([['connectors.0._packageId', 'custom', expect.stringContaining(`from package '${owner}'`)]]);
    // CONTROL: the residual stamped with the artifact's own id.
    expect(stampIssues({ ...twoPackages(), connectors: [connector('stray_conn', owner)] })).toEqual([]);
  });

  it('CONTROL: a top-level COPY of a body\'s item is not judged against the artifact\'s id', () => {
    const artifact = twoPackages(CRM);
    const flattened = { ...artifact, connectors: [connector('crm_conn', CRM), connector('orders_conn')] };
    expect(flattened.manifest.id).not.toBe(CRM);
    expect(stampIssues(flattened)).toEqual([]);
  });
});

// ─── Key by key: one pin per judged collection ──────────────────────────────

/** The object every fixture below binds to. */
const PROBE_OBJECT = {
  name: 'probe_thing',
  label: 'Thing',
  sharingModel: 'private',
  ownership: 'user',
  fields: { title: { type: 'text', label: 'Title' } },
};

const probeFlow = {
  name: 'probe_flow',
  label: 'Flow',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const probeDataset = {
  name: 'probe_ds',
  label: 'Dataset',
  object: 'probe_thing',
  dimensions: [{ name: 'title', field: 'title', type: 'string' }],
  measures: [{ name: 'row_count', aggregate: 'count' }],
};

const probeQueue = { name: 'probe_queue', label: 'Queue', members: [] };

/**
 * One spec-valid item per judged collection, and what else the stack needs for
 * it to resolve. Keyed by the constant's own member type, so a collection added
 * to {@link OWNER_STAMP_JUDGED_COLLECTIONS} does not compile here until it has
 * a fixture, and the suite below reads its list from the constant itself.
 */
const JUDGED_FIXTURES: Record<OwnerStampJudgedCollection, { item: Record<string, unknown>; context?: Record<string, unknown> }> = {
  objects: { item: { ...PROBE_OBJECT, name: 'probe_other', label: 'Other' } },
  apps: { item: { name: 'probe_app', label: 'App', navigation: [{ id: 'nav_1', type: 'object', objectName: 'probe_thing', label: 'Thing' }] } },
  picklists: { item: { name: 'probe_pick', label: 'Pick', options: [{ value: 'aa', label: 'A' }] } },
  actions: { item: { name: 'probe_go', label: 'Go', type: 'script', target: 'go' } },
  views: { item: { object: 'probe_thing', list: { type: 'grid', data: { provider: 'object', object: 'probe_thing' }, columns: ['title'] } } },
  pages: { item: { name: 'probe_page', label: 'Page', type: 'app', regions: [] } },
  dashboards: { item: { name: 'probe_dash', label: 'Dash', widgets: [] } },
  reports: {
    item: { name: 'probe_report', label: 'Report', type: 'summary', dataset: 'probe_ds', rows: ['title'], values: ['row_count'] },
    context: { datasets: [probeDataset] },
  },
  datasets: { item: probeDataset },
  flows: { item: probeFlow },
  webhooks: {
    item: { name: 'probe_webhook', label: 'Webhook', object: 'probe_thing', triggers: ['create'], url: 'https://example.com/hook' },
    context: { requires: ['webhooks', 'realtime'] },
  },
  jobs: { item: { name: 'probe_job', label: 'Job', schedule: { type: 'interval', intervalMs: 60000 }, body: { language: 'js', source: 'return 1;', capabilities: [] } } },
  positions: { item: { name: 'probe_pos', label: 'Pos' } },
  permissions: { item: { name: 'probe_perm', label: 'Perm', objects: {} } },
  capabilities: { item: { name: 'probe.export', label: 'Export' } },
  sharingRules: { item: { name: 'probe_share', label: 'Share', object: 'probe_thing', type: 'criteria', condition: 'true', sharedWith: { type: 'team', value: 'team_ops' } } },
  queues: { item: probeQueue },
  assignmentRules: {
    item: { name: 'probe_route', object: 'probe_thing', entries: [{ name: 'to_queue', assignTo: { type: 'queue', value: 'probe_queue' } }] },
    context: { queues: [probeQueue] },
  },
  agents: { item: { name: 'probe_agent', label: 'Agent', role: 'Assistant', instructions: 'Triage the request.' } },
  tools: { item: { name: 'probe_tool', label: 'Tool', description: 'tool', parameters: { type: 'object', properties: {} } } },
  skills: { item: { name: 'probe_skill', label: 'Skill', description: 'skill', instructions: 'x', tools: [] } },
  apis: {
    item: { name: 'probe_api', description: 'api', path: '/api/v1/apps/crm/p1', method: 'GET', type: 'flow', target: 'probe_flow' },
    context: { flows: [probeFlow] },
  },
  hooks: { item: { name: 'probe_hook', label: 'Hook', object: 'probe_thing', events: ['beforeInsert'], handler: () => {} } },
  mappings: { item: { name: 'probe_map', label: 'Map', targetObject: 'probe_thing', fieldMapping: [{ source: 'a', target: 'title' }] } },
  analyticsCubes: { item: { name: 'probe_cube', title: 'Cube', description: 'cube', sql: 'probe_thing', measures: {}, dimensions: {} } },
  connectors: { item: connector('probe_conn') },
  emailTemplates: { item: { name: 'probe_mail', label: 'Mail', subject: 'Hi', bodyHtml: '<p>Hello</p>' } },
  docs: { item: { name: 'probe_doc', label: 'Doc', content: '# Doc' } },
  books: { item: { name: 'probe_book', label: 'Book', groups: [] } },
  data: { item: { object: 'probe_thing', records: [] } },
};

/** Where the fixture of `key` sits in its collection: `objects` keeps the probe object first. */
const fixtureIndex = (key: OwnerStampJudgedCollection): number => (key === 'objects' ? 1 : 0);

/** A one-package stack carrying the fixture of `key`, stamped `stamp` (absent when `undefined`). */
function stackWith(key: OwnerStampJudgedCollection, stamp?: unknown): Record<string, unknown> {
  const { item, context } = JUDGED_FIXTURES[key];
  const stamped = stamp === undefined ? { ...item } : { ...item, _packageId: stamp };
  const stack: Record<string, unknown> = { manifest: manifest(CRM, { type: 'module' }), objects: [PROBE_OBJECT], ...context };
  stack[key] = key === 'objects' ? [PROBE_OBJECT, stamped] : [stamped];
  return stack;
}

describe('[ADR-0010] the build door judges every collection the registration door judges, key by key', () => {
  it('the fixture table covers exactly the judged collections', () => {
    expect(Object.keys(JUDGED_FIXTURES).sort()).toEqual([...OWNER_STAMP_JUDGED_COLLECTIONS].sort());
  });

  it.each(OWNER_STAMP_JUDGED_COLLECTIONS.map((key) => [key] as const))(
    '%s: one foreign-stamped item raises the gate\'s issue at its `_packageId`; unstamped, the same stack parses',
    (key) => {
      const control = ObjectStackDefinitionSchema.safeParse(stackWith(key));
      expect(control.success, `CONTROL: ${control.success ? '' : JSON.stringify(control.error.issues.slice(0, 3))}`).toBe(true);
      // The item schema must keep the key for the judge: one that stops
      // spreading `MetadataProtectionFields` either strips it (no issue here)
      // or refuses it as unrecognized (an issue at the item, not this one).
      expect(stampIssues(stackWith(key, OTHER)).map(([path, code]) => [path, code]))
        .toEqual([[`${key}.${fixtureIndex(key)}._packageId`, 'custom']]);
      expect(stampIssues(stackWith(key, CRM)), 'CONTROL: a stamp equal to `manifest.id`').toEqual([]);
    },
  );
});

// ─── The residual walk, as the boot walks it ────────────────────────────────

describe('[ADR-0010 · ADR-0130 D4] a `packages[]` stack\'s residual is judged on exactly what the boot files as residual', () => {
  const ORDERS = 'com.acme.orders';
  const listOf = (object: string) => ({ type: 'grid', data: { provider: 'object', object }, columns: ['title'] });
  const OTHER_OBJECT = { ...PROBE_OBJECT, name: 'probe_other', label: 'Other' };

  /** Two packages composed as `os build` does; the artifact's own id is the orders module's. */
  const artifactOf = (crmBody: Record<string, unknown> = {}) => composeStacks([
    defineStack({ manifest: manifest(CRM, { type: 'module' }), objects: [PROBE_OBJECT, OTHER_OBJECT], ...crmBody } as never, { strict: false }),
    defineStack({ manifest: manifest(ORDERS, { type: 'module' }) } as never),
  ], { manifest: 'preserve' }) as unknown as Record<string, unknown> & { manifest: { id: string } };

  it.each([['data'], ['jobs']] as const)(
    'a top-level `%s` item no body declares is filed by no boot door as a residual, so its stamp is not judged at the build door either',
    (key) => {
      const { item, context } = JUDGED_FIXTURES[key];
      const artifact = { ...artifactOf(), ...context, [key]: [{ ...item, _packageId: OTHER }] };
      expect(artifact.manifest.id).toBe(ORDERS);
      expect(ObjectStackDefinitionSchema.safeParse(artifact).success).toBe(true);
    },
  );

  it('a residual dataset IS filed under the artifact\'s id (the residual rule walks `datasets`), so its stamp is judged', () => {
    const { item } = JUDGED_FIXTURES.datasets;
    expect(stampIssues({ ...artifactOf(), datasets: [{ ...item, _packageId: OTHER }] }).map(([path]) => path))
      .toEqual(['datasets.0._packageId']);
  });

  it('CONTROL: a residual picklist IS filed under the artifact\'s id (the metadata door registers it), so its stamp is still judged', () => {
    const { item } = JUDGED_FIXTURES.picklists;
    expect(stampIssues({ ...artifactOf(), picklists: [{ ...item, _packageId: OTHER }] }).map(([path]) => path))
      .toEqual(['picklists.0._packageId']);
  });

  it('a view container is claimed by the object it binds to, however its binding is spelled: a copy spelled the other way is not a residual', () => {
    // The body's container binds through its list alone; the top-level copy
    // through its own `object`, carrying the body's own stamp.
    const artifact = artifactOf({ views: [{ list: listOf('probe_thing') }] });
    const flattened = { ...artifact, views: [{ object: 'probe_thing', list: listOf('probe_thing'), _packageId: CRM }] };
    expect(stampIssues(flattened)).toEqual([]);
  });

  it('two containers that bind different objects through their lists alone are two slots: the top-level one is a residual, judged', () => {
    const artifact = artifactOf({ views: [{ list: listOf('probe_thing') }] });
    const withResidual = { ...artifact, views: [{ list: listOf('probe_thing') }, { list: listOf('probe_other'), _packageId: OTHER }] };
    expect(stampIssues(withResidual)).toEqual([
      ['views.1._packageId', 'custom', expect.stringContaining(`from package '${ORDERS}'`)],
    ]);
  });
});
