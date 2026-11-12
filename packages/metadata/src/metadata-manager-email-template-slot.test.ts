// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31699, ADR-0150 child B; #31527 B-shape item 1] `email_template` is stored
 * per `(package, name)` in `MetadataManager`'s in-memory store, in the same
 * change that lets two packages of two namespaces each hold one template name
 * (`NAMESPACE_SCOPED_BARE_NAME_TYPES`). Keyed by bare name, the second
 * package's `registerInMemory('email_template', NAME, …)` overwrote the
 * first's, and `get` answered the survivor whatever package the read named.
 * The items are stamped the way the boot registrar stamps them (`_packageId`).
 */

import { describe, it, expect, vi } from 'vitest';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { MetadataManager } from './metadata-manager.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from './package-slotted-store.js';
import { MemoryLoader } from './loaders/memory-loader.js';

vi.mock('@objectstack/core', async (orig) => ({
  ...((await orig()) as object),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const ALPHA = 'com.alpha.app';
const BETA = 'com.beta.app';
const NAME = 'welcome';

const shipped = (packageId: string, subject: string) => ({
  name: NAME,
  locale: 'en-US',
  subject,
  bodyHtml: `<p>${subject}</p>`,
  _packageId: packageId,
  _provenance: 'package',
});

function twoHolders(): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  manager.registerInMemory('email_template', NAME, shipped(ALPHA, 'alpha'));
  manager.registerInMemory('email_template', NAME, shipped(BETA, 'beta'));
  return manager;
}

describe('[#31699] the in-memory email_template store keeps one slot per (package, name) (ADR-0150 D4)', () => {
  it('the type is in the slotted set beside api', () => {
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('email_template')).toBe(true);
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('api')).toBe(true);
  });

  it('two packages\' same-named templates both stay in the store (BASE: the later write overwrote the earlier)', async () => {
    const manager = twoHolders();
    expect(((await manager.list('email_template')) as any[]).map((i) => i.subject)).toEqual(['alpha', 'beta']);
    expect(await manager.listNames('email_template')).toEqual([NAME]);
  });

  it('a read naming a package answers that package\'s template, both faces alike; a package holding none answers nothing', async () => {
    const manager = twoHolders();
    expect(((await manager.get('email_template', NAME, ALPHA)) as any)?.subject).toBe('alpha');
    expect(((await manager.get('email_template', NAME, BETA)) as any)?.subject).toBe('beta');
    expect(((await manager.getDiagnosed('email_template', NAME, BETA)).data as any)?.subject).toBe('beta');
    expect(await manager.get('email_template', NAME, 'com.gamma.app'), 'never another package\'s template').toBeUndefined();
  });

  it('a read naming no package of the two-holder name is the D3 refusal naming both, never one of them picked', async () => {
    const manager = twoHolders();
    for (const read of [() => manager.get('email_template', NAME), () => manager.getDiagnosed('email_template', NAME)]) {
      const err = await read().then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
      expect(err, 'the read refuses').toBeInstanceOf(PackageScopedNameRefusedError);
      expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
      expect(err!.refusal.candidates).toEqual([
        { kind: 'package', packageId: ALPHA },
        { kind: 'package', packageId: BETA },
      ]);
    }
  });

  it('CONTROL — one holder: every read answers the one template registered, as the bare-name map did', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    const item = shipped(ALPHA, 'alpha');
    manager.registerInMemory('email_template', NAME, item);
    expect(await manager.get('email_template', NAME)).toBe(item);
    expect(await manager.get('email_template', NAME, ALPHA)).toBe(item);
    expect(await manager.list('email_template')).toEqual([item]);
  });

  it('CONTROL — a type outside the slotted set keeps one item per name: the later package\'s write replaces the earlier', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('view', NAME, { name: NAME, _packageId: ALPHA });
    const later = { name: NAME, _packageId: BETA };
    manager.registerInMemory('view', NAME, later);
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('view')).toBe(false);
    expect(await manager.get('view', NAME)).toBe(later);
    expect(await manager.list('view')).toEqual([later]);
  });
});

/**
 * [#32517, ADR-0150; the member dimension `DatabaseLoader` keeps since #32214]
 * `email_template` is a bundled type: one `(package, name)` holds a member per
 * `locale` (`ITEM_KEY_DISCRIMINATORS`). The in-memory registry and the artifact
 * door's `MemoryLoader` keyed a slot by `(package, name)` alone, so a second
 * locale of one package's template overwrote the first on the metadata
 * service's own reads (`list`, `loadMany`, `loadManyKeyed`). Each member now
 * has its own key under its slot; the slot rules (D3 refusals, D4
 * customization, removal by package) still count packages, never members.
 */
describe('[#32517] a bundled type keeps one item per (package, name, member) in the registry and the MemoryLoader', () => {
  const member = (packageId: string | undefined, locale: string, subject = `${packageId ?? 'env'}:${locale}`) => ({
    name: NAME,
    label: 'Welcome',
    locale,
    subject,
    bodyHtml: '<p>hi</p>',
    ...(packageId === undefined ? {} : { _packageId: packageId, _provenance: 'package' }),
  });
  const subjects = (items: unknown[]) => (items as Array<{ subject: string }>).map((item) => item.subject).sort();
  const keyedSubjects = (items: Array<{ name: string; data: unknown }>) =>
    items.map((entry) => `${entry.name}/${(entry.data as { subject: string }).subject}`).sort();

  function registered(...items: Array<ReturnType<typeof member>>): MetadataManager {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    for (const item of items) manager.registerInMemory('email_template', NAME, item);
    return manager;
  }

  async function stored(...items: Array<ReturnType<typeof member>>): Promise<{ manager: MetadataManager; loader: MemoryLoader }> {
    const loader = new MemoryLoader();
    for (const item of items) await loader.save('email_template', NAME, item);
    return { manager: new MetadataManager({ formats: ['json'], loaders: [loader] }), loader };
  }

  const ONE_HOLDER = () => [member(ALPHA, 'en-US'), member(ALPHA, 'fr-FR')];
  const TWO_HOLDERS = () => [member(ALPHA, 'en-US'), member(ALPHA, 'fr-FR'), member(BETA, 'en-US'), member(BETA, 'fr-FR')];

  it('the registry: one holder\'s two locales are both listed (BASE: the later locale overwrote the earlier)', async () => {
    const manager = registered(...ONE_HOLDER());
    expect(subjects(await manager.list('email_template'))).toEqual([`${ALPHA}:en-US`, `${ALPHA}:fr-FR`]);
    expect(await manager.listNames('email_template')).toEqual([NAME]);
  });

  it('the registry: two holders\' two locales each are all listed', async () => {
    const manager = registered(...TWO_HOLDERS());
    expect(subjects(await manager.list('email_template'))).toEqual(
      [`${ALPHA}:en-US`, `${ALPHA}:fr-FR`, `${BETA}:en-US`, `${BETA}:fr-FR`],
    );
  });

  it('the MemoryLoader: one holder\'s two locales answer loadMany, loadManyKeyed and list, on the loader and on the service', async () => {
    const { manager, loader } = await stored(...ONE_HOLDER());
    const both = [`${ALPHA}:en-US`, `${ALPHA}:fr-FR`];
    expect(subjects(await loader.loadMany('email_template'))).toEqual(both);
    expect(subjects(await manager.loadMany('email_template'))).toEqual(both);
    expect(keyedSubjects(await manager.loadManyKeyed('email_template'))).toEqual(both.map((s) => `${NAME}/${s}`));
    expect(subjects(await manager.list('email_template'))).toEqual(both);
  });

  it('the MemoryLoader: two holders\' two locales each answer loadMany, loadManyKeyed and list', async () => {
    const { manager } = await stored(...TWO_HOLDERS());
    const all = [`${ALPHA}:en-US`, `${ALPHA}:fr-FR`, `${BETA}:en-US`, `${BETA}:fr-FR`];
    expect(subjects(await manager.loadMany('email_template'))).toEqual(all);
    expect(keyedSubjects(await manager.loadManyKeyed('email_template'))).toEqual(all.map((s) => `${NAME}/${s}`));
    expect(subjects(await manager.list('email_template'))).toEqual(all);
  });

  it('the artifact door\'s shape (loader and registry both hold every member): each member is listed once', async () => {
    const { manager } = await stored(...TWO_HOLDERS());
    for (const item of TWO_HOLDERS()) manager.registerInMemory('email_template', NAME, item);
    expect(subjects(await manager.list('email_template'))).toEqual(
      [`${ALPHA}:en-US`, `${ALPHA}:fr-FR`, `${BETA}:en-US`, `${BETA}:fr-FR`],
    );
  });

  it('get: a read naming a package answers that package\'s member written last; one holder\'s two locales are ONE holder (no D3 refusal)', async () => {
    const one = registered(...ONE_HOLDER());
    expect(((await one.get('email_template', NAME)) as any)?.subject).toBe(`${ALPHA}:fr-FR`);
    expect(((await one.get('email_template', NAME, ALPHA)) as any)?.subject).toBe(`${ALPHA}:fr-FR`);
    const two = registered(...TWO_HOLDERS());
    expect(((await two.get('email_template', NAME, ALPHA)) as any)?.subject).toBe(`${ALPHA}:fr-FR`);
    expect(((await two.getDiagnosed('email_template', NAME, BETA)).data as any)?.subject).toBe(`${BETA}:fr-FR`);
    const { manager: loaderOnly } = await stored(...ONE_HOLDER());
    expect(((await loaderOnly.get('email_template', NAME, ALPHA)) as any)?.subject).toBe(`${ALPHA}:fr-FR`);
    expect(((await loaderOnly.get('email_template', NAME)) as any)?.subject).toBe(`${ALPHA}:fr-FR`);
  });

  it('D3 unchanged: a read or removal naming no package of a two-holder name refuses naming each PACKAGE once, never a member', async () => {
    for (const manager of [registered(...TWO_HOLDERS()), (await stored(...TWO_HOLDERS())).manager]) {
      for (const act of [() => manager.get('email_template', NAME), () => manager.unregister('email_template', NAME)]) {
        const err = await act().then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
        expect(err, 'refused').toBeInstanceOf(PackageScopedNameRefusedError);
        expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
        expect(err!.refusal.candidates).toEqual([
          { kind: 'package', packageId: ALPHA },
          { kind: 'package', packageId: BETA },
        ]);
      }
      expect(subjects(await manager.list('email_template')), 'nothing removed').toHaveLength(4);
    }
  });

  it('remove: naming a package drops every member of that package\'s slot only; naming none drops every member of a one-holder name', async () => {
    for (const make of [async () => registered(...TWO_HOLDERS()), async () => (await stored(...TWO_HOLDERS())).manager]) {
      const manager = await make();
      await manager.unregister('email_template', NAME, { packageId: ALPHA });
      expect(subjects(await manager.list('email_template'))).toEqual([`${BETA}:en-US`, `${BETA}:fr-FR`]);
      await manager.unregister('email_template', NAME);
      expect(await manager.list('email_template')).toEqual([]);
    }
  });

  it('D4 unchanged: a package-less locale under a name one package holds is that holder\'s member, never a second holder', async () => {
    const manager = registered(member(ALPHA, 'en-US'), member(undefined, 'fr-FR'));
    expect(subjects(await manager.list('email_template'))).toEqual([`${ALPHA}:en-US`, 'env:fr-FR']);
    expect(((await manager.get('email_template', NAME, ALPHA)) as any)?.subject).toBe('env:fr-FR');
    await manager.unregister('email_template', NAME, { packageId: ALPHA });
    expect(await manager.list('email_template'), 'the customization went with its holder\'s slot').toEqual([]);
  });

  it('list order: each slot\'s member written last first (the one item each slot listed before), then the other members — registry and door alike', async () => {
    const order = (items: unknown[]) => (items as Array<{ subject: string }>).map((item) => item.subject);
    expect(order(await registered(...ONE_HOLDER()).list('email_template'))).toEqual([`${ALPHA}:fr-FR`, `${ALPHA}:en-US`]);
    expect(order(await registered(...TWO_HOLDERS()).list('email_template'))).toEqual(
      [`${ALPHA}:fr-FR`, `${BETA}:fr-FR`, `${ALPHA}:en-US`, `${BETA}:en-US`],
    );
    expect(order(await (await stored(...TWO_HOLDERS())).manager.list('email_template'))).toEqual(
      [`${ALPHA}:fr-FR`, `${BETA}:fr-FR`, `${ALPHA}:en-US`, `${BETA}:en-US`],
    );
    const rewritten = registered(...ONE_HOLDER(), member(ALPHA, 'en-US', 'en again'));
    expect(order(await rewritten.list('email_template'))).toEqual(['en again', `${ALPHA}:fr-FR`]);
  });

  it('a read the registry cannot answer (loader only): the slot\'s member written last, the one `list` puts first (BASE: the same)', async () => {
    const rewrite = () => [...ONE_HOLDER(), member(ALPHA, 'en-US', 'en again')];
    const { manager } = await stored(...rewrite());
    expect(((await manager.get('email_template', NAME)) as any)?.subject).toBe('en again');
    expect(((await manager.get('email_template', NAME, ALPHA)) as any)?.subject).toBe('en again');
    expect(((await manager.list('email_template'))[0] as any)?.subject).toBe('en again');
    const { manager: frLast } = await stored(...ONE_HOLDER());
    expect(((await frLast.get('email_template', NAME)) as any)?.subject).toBe(`${ALPHA}:fr-FR`);
    expect(((await frLast.list('email_template'))[0] as any)?.subject).toBe(`${ALPHA}:fr-FR`);
    // CONTROL: the registry answers the same.
    expect(((await registered(...rewrite()).get('email_template', NAME)) as any)?.subject).toBe('en again');
  });

  /**
   * [#32560] The view a read over the loaders judges inherits the registry's
   * write order (the action read's "written last"). A slot only a loader holds
   * has no member in that order, and still answers its first member — the
   * member written last, which `loadSlots` hands first.
   */
  it('a read the registry cannot answer while it holds another item of the type: the loader slot\'s member written last still answers (BASE: the same)', async () => {
    const { manager } = await stored(...ONE_HOLDER(), member(ALPHA, 'en-US', 'en again'));
    manager.registerInMemory('email_template', 'other_template', { ...member(BETA, 'en-US'), name: 'other_template' });
    expect(((await manager.get('email_template', NAME)) as any)?.subject).toBe('en again');
    expect(((await manager.get('email_template', NAME, ALPHA)) as any)?.subject).toBe('en again');
    const { manager: frLast } = await stored(...ONE_HOLDER());
    frLast.registerInMemory('email_template', 'other_template', { ...member(BETA, 'en-US'), name: 'other_template' });
    expect(((await frLast.get('email_template', NAME, ALPHA)) as any)?.subject).toBe(`${ALPHA}:fr-FR`);
  });

  it('a second write of one member replaces that member only', async () => {
    const manager = registered(...ONE_HOLDER(), member(ALPHA, 'fr-FR', 'fr again'));
    expect(subjects(await manager.list('email_template'))).toEqual([`${ALPHA}:en-US`, 'fr again']);
  });

  it('CONTROL — an unbundled type keeps one item per slot: a second write of one package\'s name replaces the first, whatever `locale` it carries', async () => {
    for (const type of ['agent', 'skill']) {
      expect(PACKAGE_SLOTTED_STORE_TYPES.has(type)).toBe(true);
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      const loader = new MemoryLoader();
      manager.registerInMemory(type, NAME, { name: NAME, locale: 'en-US', _packageId: ALPHA });
      const later = { name: NAME, locale: 'fr-FR', _packageId: ALPHA };
      manager.registerInMemory(type, NAME, later);
      await loader.save(type, NAME, { name: NAME, locale: 'en-US', _packageId: ALPHA });
      await loader.save(type, NAME, later);
      expect(await manager.list(type)).toEqual([later]);
      expect(await loader.loadMany(type)).toEqual([later]);
    }
  });
});
