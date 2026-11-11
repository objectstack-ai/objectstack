// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package that carries a `kind: 'full'` record page placing no component
 * (objectstack#32434), at the two doors the `manifest` service holds.
 *
 * The page parse refuses such a page at `regions`
 * (`checkPageRecordPlacesComponent`, `@objectstack/spec/ui`). Where a package
 * meets that parse decides what happens to it, the same way it does for an
 * unplaced region (`page-template-closed-region-unplaced-refused`):
 *
 *   - a release artifact handed WHOLE to the service is parsed body by body
 *     (`resolveArtifactPackageEntries`, ADR-0130 D4), so the artifact is
 *     refused with the parse's sentence and nothing registers;
 *   - one package body handed to the service FLAT — the way a hosted kernel
 *     registers an installed package — meets no page parse: the registry does
 *     not judge regions, so the package installs and its page is served as
 *     installed, still drawing a blank detail panel until it is fixed.
 *
 * Both are measurements of this change, not new behaviour of the doors.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type Bag = Record<string, any>;
type ManifestService = { register(m: unknown): void | Promise<void> };

const PKG = 'com.acme.leave';

/** A package body carrying the card's page: a record page of `leave_request` with no `regions`. */
const body = (): Bag => ({
  id: PKG,
  name: 'leave',
  version: '1.0.0',
  type: 'app',
  pages: [{ name: 'leave_request_record', label: 'Leave request', type: 'record', object: 'leave_request', template: 'default' }],
});

const kernels: ObjectKernel[] = [];
const boot = async () => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  kernels.push(kernel);
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const manifest = kernel.getService<ManifestService>('manifest');
  const register = async (m: unknown): Promise<Error | undefined> => {
    try {
      await manifest.register(m);
      return undefined;
    } catch (e) {
      return e as Error;
    }
  };
  return { registry: ql.registry, register };
};

afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
});

describe('a package carrying a full record page that places no component (#32434)', () => {
  it('a release artifact handed whole is refused at the page\'s `regions`, with the parse\'s sentence, and nothing registers', async () => {
    const { registry, register } = await boot();
    const err = await register({ packages: [{ manifest: body() }] });
    expect(err, 'the artifact was refused').toBeDefined();
    expect(err!.message).toContain('pages.0.regions');
    expect(err!.message).toContain('This record page places no component in its `regions`, so every record of its object would open on a blank detail panel');
    expect(registry.getPackage(PKG)).toBeUndefined();
  });

  it('one body handed flat installs: the registry does not judge regions, so the page is served as installed', async () => {
    const { registry, register } = await boot();
    expect(await register(body())).toBeUndefined();
    expect(registry.getPackage(PKG)).toBeDefined();
    const page = registry.listItems<Bag>('page').find((p) => p.name === 'leave_request_record');
    expect(page).toMatchObject({ type: 'record', object: 'leave_request' });
    expect(page!.regions ?? []).toEqual([]);
  });

  it('CONTROL — the same artifact whose page places one component registers', async () => {
    const { registry, register } = await boot();
    const placed = body();
    placed.pages[0].regions = [{ name: 'main', components: [{ type: 'record:details' }] }];
    expect(await register({ packages: [{ manifest: placed }] })).toBeUndefined();
    expect(registry.getPackage(PKG)).toBeDefined();
  });
});
