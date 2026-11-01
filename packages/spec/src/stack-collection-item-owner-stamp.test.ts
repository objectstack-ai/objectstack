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
import { judgeCollectionItemOwnerStamp } from './kernel/collection-item-owner-stamp';

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
