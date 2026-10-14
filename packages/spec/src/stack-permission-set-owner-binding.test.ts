// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0086 D3] The BUILD door of the permission-set owner-binding rule: the
 * stack schema refuses a set whose body `packageId` disagrees with the package
 * that ships it (`applyPermissionSetOwnerBindingGate`, `stack.zod.ts`).
 *
 * Before this gate a stack whose set declared another package's id parsed, and
 * the registry filed the set under the stack's own package with no word to the
 * author. `defineStack`, `os validate`, `os build` and the artifact door all
 * run this one parse, so it is pinned here on the parse and through
 * `defineStack`, with the envelope each answers: the issue's `code` and path
 * at the parse, `STACK_SCHEMA_INVALID` / 422 from `defineStack`.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack, ObjectStackDefinitionSchema } from './stack.zod';

type Envelope = Error & { code?: string; status?: number; issues?: Array<{ code?: string; path?: PropertyKey[]; message?: string }> };

const CRM = 'com.acme.crm';
const OTHER = 'com.acme.other';

const set = (name: string, packageId?: string) => ({
  name,
  label: 'Probe',
  objects: {},
  ...(packageId === undefined ? {} : { packageId }),
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

/** The issues the parse raises at a `packageId`, as `[path, message]`. */
function ownerIssues(config: unknown): Array<[string, string]> {
  const result = ObjectStackDefinitionSchema.safeParse(config);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.path[i.path.length - 1] === 'packageId')
    .map((i) => [i.path.join('.'), i.message]);
}

describe('[ADR-0086 D3] defineStack refuses a permission set whose body `packageId` is not the stack\'s package', () => {
  it('a set naming another package: STACK_SCHEMA_INVALID / 422, the issue at its `packageId`, the prescription first', () => {
    const error = refusal({ manifest: manifest(CRM), permissions: [set('crm_member', OTHER)] });
    expect(error, 'the stack must be refused').not.toBeNull();
    expect(error).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issue = error!.issues!.find((i) => i.path?.join('.') === 'permissions.0.packageId');
    expect(issue, 'located at the set\'s key').toMatchObject({ code: 'custom' });
    expect(issue!.message!.indexOf("Drop `packageId` from permission set 'crm_member'")).toBe(0);
    expect(issue!.message).toContain(`from package '${CRM}'`);
  });

  it('a stack with no `manifest` ships its sets from no package: any key is refused, the empty string included', () => {
    for (const declared of [OTHER, CRM, '']) {
      const error = refusal({ permissions: [set('crm_member', declared)] });
      expect(error, `packageId '${declared}'`).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      expect(error!.issues!.map((i) => i.path?.join('.'))).toContain('permissions.0.packageId');
    }
  });

  it('a map-format collection is judged on the array it normalises to', () => {
    const error = refusal({ manifest: manifest(CRM), permissions: { crm_member: { label: 'Probe', objects: {}, packageId: OTHER } } });
    expect(error).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(error!.issues!.map((i) => i.path?.join('.'))).toContain('permissions.0.packageId');
  });

  it('CONTROL: a key equal to `manifest.id`, and an absent key with or without a manifest, are accepted', () => {
    expect(refusal({ manifest: manifest(CRM), permissions: [set('crm_member', CRM)] })).toBeNull();
    expect(refusal({ manifest: manifest(CRM), permissions: [set('crm_member')] })).toBeNull();
    expect(refusal({ permissions: [set('crm_member')] })).toBeNull();
  });
});

describe('[ADR-0086 D3] a release artifact\'s sets are judged against the package that registers each one', () => {
  /** Two packages composed as `os build` does (ADR-0130 D4), the core set's key as the variable. */
  // The artifact's own manifest is the LAST input's (`'preserve'` keeps the
  // `'last'` pick), so it is the orders module's, never the package under test.
  const twoPackages = (coreKey?: string) => composeStacks([
    defineStack({ manifest: manifest(CRM), permissions: [set('crm_member', coreKey)] } as never, { strict: false }),
    defineStack({ manifest: manifest('com.acme.orders', { type: 'module' }), permissions: [set('orders_member')] } as never),
  ], { manifest: 'preserve' }) as unknown as Record<string, unknown> & { packages: Array<{ manifest: Record<string, unknown> }> };

  it('a body\'s set is judged against that body\'s own id', () => {
    const artifact = twoPackages(OTHER);
    const at = artifact.packages.findIndex((p) => p.manifest.id === CRM);
    expect(ownerIssues(artifact).map(([path]) => path)).toEqual([`packages.${at}.manifest.permissions.0.packageId`]);
    // CONTROL: the same artifact, the key naming the body that ships it.
    expect(ownerIssues(twoPackages(CRM))).toEqual([]);
    expect(ownerIssues(twoPackages())).toEqual([]);
  });

  it('a top-level set no body declares is the residual, judged against the artifact\'s `manifest.id`', () => {
    const artifact = { ...twoPackages(), permissions: [set('stray_member', OTHER)] };
    const owner = String((artifact.manifest as { id: string }).id);
    expect(ownerIssues(artifact)).toEqual([['permissions.0.packageId', expect.stringContaining(`from package '${owner}'`)]]);
    // CONTROL: the residual declaring the artifact's own id.
    expect(ownerIssues({ ...twoPackages(), permissions: [set('stray_member', owner)] })).toEqual([]);
  });

  it('CONTROL: a top-level COPY of a body\'s set is not judged against the artifact\'s id (the both-halves artifact shape)', () => {
    // An artifact built before #14512 carried every body's collections a second
    // time at the top level, under the artifact's own (last-picked) manifest.
    // That copy is never registered from the top level, so its key — which
    // names the body that ships it — is no disagreement.
    const artifact = twoPackages(CRM);
    const flattened = { ...artifact, permissions: [set('crm_member', CRM), set('orders_member')] };
    expect(String((flattened.manifest as { id: string }).id)).not.toBe(CRM);
    expect(ownerIssues(flattened)).toEqual([]);
  });
});
