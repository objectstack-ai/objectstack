// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#31697, epic B-shape item 1 (#31527 comment 6766935846), ADR-0150 D3/D4]
// The ARTIFACT door — the one `os dev` and `os start` load a compiled artifact
// through, which registers every package body's items into the metadata
// service stamped `_packageId` — keeps each namespace's same-named action in
// the metadata service's in-memory store. That store keyed `action` by bare
// name, so the package registered last overwrote the other before any reader
// resolved the name. `action` is now a package-slotted store type beside
// `api`, in the same change that made its object-less name one per namespace.
//
// Pinned, on a boot of two packages of two namespaces (`alpha`, `beta`), each
// shipping the object-less action `qa_shared_digest`:
//   - the metadata service answers a read naming each package its own item,
//     lists both, and refuses the read naming none (409, naming both);
//   - `/meta/action/NAME?package=` serves each package's own, and the bare
//     `/meta/action/NAME` is 409 naming both;
//   - CONTROL: an action one package holds is answered to every read, bare or
//     by its package, as before;
//   - two packages' same-named actions bound to their OWN objects are two
//     identities (contract review G1): both kept, each package's read answers
//     its own (base: the survivor's body under the asked package's stamp);
//     [#32244] the bare read, in process and over HTTP, is 409 naming both
//     packages with their objects;
//   - the bare layered read of the two-holder object-less name is 409 naming
//     both, and `?package=` serves each package's own code layer.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { composeStacks, defineStack } from '@objectstack/spec';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

const ALPHA = 'com.qa.slot.alpha';
const BETA = 'com.qa.slot.beta';
const SHARED = 'qa_shared_digest';
const SOLO = 'qa_solo_digest';
const BOUND = 'qa_shared_bound';

const item = (p: string) => ({
  name: `${p}_item`, label: `${p} item`, sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
});
const action = (p: string, name: string, extra: Record<string, unknown> = {}) => ({
  name, label: `${p} ${name}`, type: 'script', body: { language: 'js', source: `return { from: '${p}' };`, capabilities: [] }, ...extra,
});

const artifactPackage = (p: 'alpha' | 'beta') => defineStack({
  manifest: { id: `com.qa.slot.${p}`, namespace: p, name: `qa_slot_${p}`, version: '1.0.0', type: p === 'alpha' ? 'app' : 'module' },
  objects: [item(p)],
  actions: [
    action(p, `${p}_${SHARED}`),
    action(p, BOUND, { objectName: `${p}_item` }),
    ...(p === 'alpha' ? [action(p, SOLO)] : []),
  ],
} as never);

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('[#31697] the artifact door keeps each namespace\'s same-named action in the metadata service', () => {
  // `composeStacks` refuses two stacks' same object-less action key at compose
  // time, ahead of the widening (reported on the card as out of scope). The
  // compiled artifact keeps each package's body apart (`packages[].manifest`),
  // so each package ships the shared name by renaming its own placeholder
  // there, which is the artifact a per-package build of each would hold.
  const artifact = composeStacks([artifactPackage('alpha'), artifactPackage('beta')], { manifest: 'preserve' }) as any;
  for (const pkg of artifact.packages) {
    for (const declared of pkg.manifest.actions) {
      if (declared.name === `${pkg.manifest.namespace}_${SHARED}`) {
        declared.name = SHARED;
        declared.label = `${pkg.manifest.namespace} ${SHARED}`;
      }
    }
  }

  let stack: VerifyStack;
  let admin: string;
  let dir: string;
  let metadata: {
    get(type: string, name: string, packageId?: string): Promise<any>;
    list(type: string): Promise<any[]>;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-slotted-store-action-'));
    const artifactPath = join(dir, 'objectstack.json');
    writeBuildShapedArtifact(artifact as unknown as Record<string, unknown>, artifactPath);
    stack = await bootStack(artifact, {
      extraPlugins: [
        new MetadataPlugin({
          rootDir: dir, watch: false, artifactWatch: false, registerSystemObjects: false,
          artifactSource: { mode: 'local-file', path: artifactPath },
        }),
      ],
    });
    admin = await stack.signIn();
    metadata = await stack.kernel.getServiceAsync('metadata');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const metaItem = async (name: string, pkg?: string) => {
    const r = await stack.apiAs(admin, 'GET', `/meta/action/${name}${pkg ? `?package=${pkg}` : ''}`);
    const text = await r.text();
    const body = JSON.parse(text);
    const it = body?.item ?? body?.data?.item ?? body?.data;
    return { status: r.status, label: it?.label, packageId: it?._packageId, code: codeOf(body), text };
  };

  it('the metadata service holds both packages\' object-less action: a read naming each package answers its own, and the read naming none is refused naming both (BASE: every read answered the package registered last)', async () => {
    expect((await metadata.get('action', SHARED, ALPHA))?.label).toBe(`alpha ${SHARED}`);
    expect((await metadata.get('action', SHARED, BETA))?.label).toBe(`beta ${SHARED}`);
    expect((await metadata.list('action')).filter((i) => i?.name === SHARED).map((i) => i?.label).sort())
      .toEqual([`alpha ${SHARED}`, `beta ${SHARED}`]);
    const refused = await metadata.get('action', SHARED).then(() => undefined, (e: any) => e);
    expect([refused?.code, refused?.status], 'never one of them picked').toEqual(['RESOURCE_CONFLICT', 409]);
    for (const holder of [ALPHA, BETA]) expect(String(refused?.message)).toContain(holder);
  });

  it('`/meta/action/NAME?package=` serves each package\'s own object-less action; the bare read is 409 naming both', async () => {
    for (const p of ['alpha', 'beta'] as const) {
      const read = await metaItem(SHARED, `com.qa.slot.${p}`);
      expect([read.status, read.label, read.packageId], read.text.slice(0, 300)).toEqual([200, `${p} ${SHARED}`, `com.qa.slot.${p}`]);
    }
    const bare = await metaItem(SHARED);
    expect([bare.status, bare.code], bare.text.slice(0, 300)).toEqual([409, 'RESOURCE_CONFLICT']);
    for (const holder of [ALPHA, BETA]) expect(bare.text).toContain(holder);
  });

  it('CONTROL — one holder per name: every read answers the one package\'s action, bare or by its package', async () => {
    expect((await metadata.get('action', SOLO))?.label).toBe(`alpha ${SOLO}`);
    expect((await metadata.get('action', SOLO, ALPHA))?.label).toBe(`alpha ${SOLO}`);
    const bare = await metaItem(SOLO);
    expect([bare.status, bare.label, bare.packageId], bare.text.slice(0, 300)).toEqual([200, `alpha ${SOLO}`, ALPHA]);
  });

  it('two packages\' same-named actions bound to their own objects are two identities: the metadata service keeps both and answers each package its own; `/meta/action/NAME?package=` serves each its own; [#32244] the bare read, in process and over HTTP, is 409 naming both packages with their objects (BASE: the survivor\'s body, under the asked package\'s stamp; #32244 BASE: the bare read answered one of them)', async () => {
    expect((await metadata.get('action', BOUND, ALPHA))?.label).toBe(`alpha ${BOUND}`);
    expect((await metadata.get('action', BOUND, BETA))?.label).toBe(`beta ${BOUND}`);
    expect((await metadata.list('action')).filter((i) => i?.name === BOUND).map((i) => i?.label).sort())
      .toEqual([`alpha ${BOUND}`, `beta ${BOUND}`]);
    const refused = await metadata.get('action', BOUND).then(() => undefined, (e: any) => e);
    expect([refused?.code, refused?.status, refused?.refusal?.reason], 'the in-process bare read refuses')
      .toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
    expect(refused.refusal.candidates.map((c: any) => c.packageId)).toEqual([ALPHA, BETA]);
    for (const p of ['alpha', 'beta'] as const) {
      const read = await metaItem(BOUND, `com.qa.slot.${p}`);
      expect([read.status, read.label, read.packageId], read.text.slice(0, 300)).toEqual([200, `${p} ${BOUND}`, `com.qa.slot.${p}`]);
    }
    const bare = await metaItem(BOUND);
    expect([bare.status, bare.code], bare.text.slice(0, 300)).toEqual([409, 'RESOURCE_CONFLICT']);
    for (const p of ['alpha', 'beta'] as const) {
      expect(bare.text).toContain(`package \\"com.qa.slot.${p}\\" binds it to object \\"${p}_item\\"`);
    }
  });

  it('the bare layered read `/meta/action/NAME/layers` of the two-holder object-less name is refused 409 naming both; `?package=` serves each package its own code layer', async () => {
    const bare = await stack.apiAs(admin, 'GET', `/meta/action/${SHARED}/layers`);
    const text = await bare.text();
    expect([bare.status, codeOf(JSON.parse(text))], text.slice(0, 300)).toEqual([409, 'RESOURCE_CONFLICT']);
    for (const holder of [ALPHA, BETA]) expect(text).toContain(holder);
    for (const p of ['alpha', 'beta'] as const) {
      const r = await stack.apiAs(admin, 'GET', `/meta/action/${SHARED}/layers?package=com.qa.slot.${p}`);
      const body = (await r.json()) as any;
      expect([r.status, body?.code?.label], JSON.stringify(body).slice(0, 300)).toEqual([200, `${p} ${SHARED}`]);
    }
  });
});
