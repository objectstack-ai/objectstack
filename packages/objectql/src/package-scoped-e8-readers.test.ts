// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Pays the lint root's first load at collection, never inside a clocked case.
import './__fixtures__/lint-root-preload.testkit.js';

/**
 * ADR-0150 child E8 (#31680): the by-name readers of the presentation and AI
 * types — app, page, dashboard, report, book, analytics cube, tool, skill and
 * agent — consult `(package, name)` through the one resolver
 * (`resolvePackageScopedName`, child R).
 *
 * The readers, each over the real `SchemaRegistry`:
 *
 *  - the protocol's by-name read (`getMetaItem` / `getMetaItemForExecution`,
 *    what `GET /api/v1/meta/TYPE/NAME` and MCP `agent_prompt` read) when it
 *    names no package — a caller with no package;
 *  - `SchemaRegistry.getApp(name, currentPackageId?)`;
 *  - `MetadataFacade.get` / `getEntry` / `exists`.
 *
 * Narrowings, each declared on the card and the PR: (1) a bare name of an
 * uncovered type two packages hold refuses naming both, where the first
 * registered was served; (2) a package caller's bare name whose only holder is
 * the environment's own item (ADR-0150 D3 (a)); (3) a package caller's bare
 * name whose one package holder is outside its declared closure (D3 step 3,
 * the epic seat's ruling on #31527). Everything else is the CONTROL: one
 * holder answers as before, zero holders stays not-found, and the protocol
 * read that names a package (`?package=`, child G1's exact qualifier) is not
 * touched here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { MetadataFacade } from './metadata-facade.js';
import { resolveThrownHttpError } from '@objectstack/types';
import { PackageScopedNameRefusedError as CorePackageScopedNameRefusedError } from '@objectstack/core';
import * as barrel from './index.js';
import * as leanEntry from './core.js';
import {
  PACKAGE_SCOPED_READ_TYPES,
  PackageScopedNameRefusedError,
} from './package-scoped-read.js';
import { isPackageScopedType, resolvePackageScopedName } from './package-scoped-resolver.js';
import { BARE_NAME_REGISTRY_TYPES } from './bare-name-one-holder.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const P = 'com.acme.caller';

/** The nine types this card wires, as the registry spells them. */
const E8_TYPES = ['app', 'page', 'dashboard', 'report', 'book', 'analytics_cube', 'tool', 'skill', 'agent'] as const;
/** Of them, the ones phase 1's one-holder refusal does not cover: two package holders can exist today. */
const UNCOVERED = E8_TYPES.filter((t) => !(BARE_NAME_REGISTRY_TYPES as readonly string[]).includes(t));

const manifest = (id: string, deps: string[] = []) => ({
  id,
  name: id,
  version: '1.0.0',
  type: 'app',
  namespace: id.split('.').pop()!,
  ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
}) as never;

let registry: SchemaRegistry;
let protocol: ObjectStackProtocolImplementation;
let facade: MetadataFacade;

const install = (id: string, deps: string[] = []) => registry.installPackage(manifest(id, deps), 'code');
const body = (type: string, name: string, tag: string): Record<string, unknown> =>
  type === 'skill'
    ? { name, label: `${tag} skill`, description: `${tag} skill`, instructions: tag, tools: [] }
    : type === 'agent'
      ? { name, label: `${tag} agent`, role: tag, instructions: tag }
      : { name, label: `${tag} ${type}` };
/** A package's item, in its composite slot. */
const ship = (type: string, name: string, packageId: string) =>
  registry.registerItem(type, body(type, name, packageId.split('.').pop()!), 'name' as never, packageId);
/** The environment's own item: a package-less row in the bare slot. */
const envItem = (type: string, name: string) =>
  registry.registerItem(type, { ...body(type, name, 'env'), _provenance: 'org' }, 'name' as never);
const labelOf = (item: unknown) => (item as { label?: string } | undefined)?.label;

/** The coded refusal every rewired reader raises, with every candidate named. */
async function expectRefusal(read: () => unknown, reason: string, named: readonly string[]) {
  let thrown: unknown;
  try {
    await read();
  } catch (err) {
    thrown = err;
  }
  expect(thrown, 'the read refuses').toBeInstanceOf(PackageScopedNameRefusedError);
  const err = thrown as PackageScopedNameRefusedError;
  expect(err.code).toBe('RESOURCE_CONFLICT');
  expect(err.status).toBe(409);
  expect(err.refusal.reason).toBe(reason);
  for (const holder of named) expect(err.message).toContain(holder);
}

beforeEach(() => {
  registry = new SchemaRegistry({ multiTenant: false });
  const engine = {
    registry,
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
  };
  protocol = new ObjectStackProtocolImplementation(engine as never);
  facade = new MetadataFacade(registry);
  install(A);
  install(B);
});

describe('E8 wires exactly the nine types, every one of them package-scoped', () => {
  it('PACKAGE_SCOPED_READ_TYPES is the card\'s nine and the later children\'s own, each one R addresses by package', () => {
    // Later children of epic #31527 append their own type in their own change.
    const LATER = ['email_template'];
    expect([...PACKAGE_SCOPED_READ_TYPES].sort()).toEqual([...E8_TYPES, ...LATER].sort());
    for (const type of PACKAGE_SCOPED_READ_TYPES) expect(isPackageScopedType(type), type).toBe(true);
  });
});

describe('the refusal crosses a wire door as 409 RESOURCE_CONFLICT (ADR-0150 D5), never 500 or 404', () => {
  it('the dispatcher\'s thrown-error reading answers 409 with the resolver\'s sentence', () => {
    install(P);
    ship('page', 'home', A);
    ship('page', 'home', B);
    const refusal = resolvePackageScopedName(registry, { type: 'page', name: 'home' });
    expect(refusal.status).toBe('refused');
    const err = new PackageScopedNameRefusedError(refusal as never);
    const answer = resolveThrownHttpError(err, 500);
    expect(answer.status).toBe(409);
    expect(answer.code).toBe('RESOURCE_CONFLICT');
    expect(answer.message).toBe((refusal as { message: string }).message);
    expect(answer.message).toContain(A);
    expect(answer.message).toContain(B);
  });
});

describe('the refusal class is @objectstack/core\'s, one binding on every objectql entry (#31852)', () => {
  it('package-scoped-read, the barrel and the lean `./core` entry all export core\'s class itself', () => {
    expect(PackageScopedNameRefusedError).toBe(CorePackageScopedNameRefusedError);
    expect(barrel.PackageScopedNameRefusedError).toBe(CorePackageScopedNameRefusedError);
    expect(leanEntry.PackageScopedNameRefusedError).toBe(CorePackageScopedNameRefusedError);
  });

  it('a lean consumer matches SchemaRegistry#getApp\'s refusal by class, not only by code and status', () => {
    ship('app', 'home', A);
    ship('app', 'home', B);
    let thrown: unknown;
    try {
      registry.getApp('home');
    } catch (err) {
      thrown = err;
    }
    expect(registry).toBeInstanceOf(leanEntry.SchemaRegistry);
    expect(thrown).toBeInstanceOf(leanEntry.PackageScopedNameRefusedError);
    expect(thrown).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409, httpStatus: 409 });
  });
});

describe('narrowing (1) — an uncovered type two packages hold: the bare read refuses naming both', () => {
  for (const type of UNCOVERED) {
    it(`${type}: a caller with no package is refused at the protocol read (both faces), the registry and the facade`, async () => {
      ship(type, 'home', A);
      ship(type, 'home', B);
      await expectRefusal(() => protocol.getMetaItem({ type, name: 'home' }), 'ambiguous-in-environment', [A, B]);
      await expectRefusal(() => protocol.getMetaItemForExecution({ type, name: 'home' }), 'ambiguous-in-environment', [A, B]);
      await expectRefusal(() => facade.get(type, 'home'), 'ambiguous-in-environment', [A, B]);
      await expectRefusal(() => facade.getEntry(type, 'home'), 'ambiguous-in-environment', [A, B]);
      if (type === 'app') await expectRefusal(() => registry.getApp('home'), 'ambiguous-in-environment', [A, B]);
    });

    it(`${type}: each package's own item for its own callers`, async () => {
      ship(type, 'home', A);
      ship(type, 'home', B);
      expect(labelOf(await facade.get(type, 'home', A))).toBe(`alpha ${type}`);
      expect(labelOf(await facade.get(type, 'home', B))).toBe(`beta ${type}`);
      if (type === 'app') {
        expect(labelOf(registry.getApp('home', A))).toBe('alpha app');
        expect(labelOf(registry.getApp('home', B))).toBe('beta app');
      }
    });
  }

  it('`exists` answers true: two holders are a fact, not an absence', async () => {
    ship('page', 'home', A);
    ship('page', 'home', B);
    expect(await facade.exists('page', 'home')).toBe(true);
  });
});

describe('CONTROL — one holder answers exactly as before, at every rewired reader', () => {
  for (const type of E8_TYPES) {
    it(`${type}: one package holder is served to a caller with no package, to the holder and to a dependent`, async () => {
      install(P, [A]);
      ship(type, 'solo', A);
      const before = registry.getItem(type, 'solo');
      expect(labelOf(before)).toBe(`alpha ${type}`);
      expect(labelOf((await protocol.getMetaItem({ type, name: 'solo' }))?.item)).toBe(`alpha ${type}`);
      expect(labelOf((await protocol.getMetaItemForExecution({ type, name: 'solo' }))?.item)).toBe(`alpha ${type}`);
      expect(labelOf(await facade.get(type, 'solo'))).toBe(`alpha ${type}`);
      expect(labelOf(await facade.get(type, 'solo', A))).toBe(`alpha ${type}`);
      expect(labelOf(await facade.get(type, 'solo', P))).toBe(`alpha ${type}`);
      expect(labelOf(facade.getEntry(type, 'solo'))).toBe(`alpha ${type}`);
      expect(await facade.exists(type, 'solo')).toBe(true);
    });

    it(`${type}: the environment's own item is served to a caller with no package`, async () => {
      envItem(type, 'local');
      expect(labelOf((await protocol.getMetaItem({ type, name: 'local' }))?.item)).toBe(`env ${type}`);
      expect(labelOf(await facade.get(type, 'local'))).toBe(`env ${type}`);
    });

    it(`${type}: zero holders stays not-found, never a refusal`, async () => {
      expect((await protocol.getMetaItem({ type, name: 'nothing' }))?.item).toBeUndefined();
      expect(await facade.get(type, 'nothing')).toBeUndefined();
      expect(await facade.get(type, 'nothing', A)).toBeUndefined();
      expect(await facade.exists(type, 'nothing')).toBe(false);
    });

    it(`${type}: the protocol read that names a package is untouched (child G1's exact qualifier)`, async () => {
      ship(type, 'solo', A);
      expect(labelOf((await protocol.getMetaItem({ type, name: 'solo', packageId: A }))?.item)).toBe(`alpha ${type}`);
    });
  }

  it('an app served through getApp still carries its navigation contributions', () => {
    ship('app', 'crm', A);
    registry.registerAppNavContribution({ app: 'crm', items: [{ id: 'nav_x', type: 'url', url: '/x', label: 'X' }] }, B);
    for (const app of [registry.getApp('crm'), registry.getApp('crm', A)] as Array<{ navigation?: Array<{ id?: string }> }>) {
      expect(app?.navigation?.map((n) => n.id)).toContain('nav_x');
    }
  });
});

describe('narrowing (2) — D3 (a): a package caller never resolves to the environment\'s own item', () => {
  for (const type of E8_TYPES) {
    it(`${type}: refused, naming the environment`, async () => {
      install(P);
      envItem(type, 'local');
      await expectRefusal(() => facade.get(type, 'local', P), 'outside-closure', ['the environment']);
      if (type === 'app') await expectRefusal(() => registry.getApp('local', P), 'outside-closure', ['the environment']);
    });
  }
});

describe('narrowing (3) — D3 step 3: one holder outside the package caller\'s declared closure', () => {
  for (const type of E8_TYPES) {
    it(`${type}: refused, naming the holder; inside the closure it is served`, async () => {
      install(P);
      ship(type, 'solo', A);
      await expectRefusal(() => facade.get(type, 'solo', P), 'outside-closure', [A]);
      if (type === 'app') await expectRefusal(() => registry.getApp('solo', P), 'outside-closure', [A]);
      install('com.acme.dependent', [A]);
      expect(labelOf(await facade.get(type, 'solo', 'com.acme.dependent'))).toBe(`alpha ${type}`);
    });
  }
});

describe('email_template joins the readers (ADR-0150 D9, child B #31699): the by-name read resolves member by member', () => {
  /** One member of `packageId`'s bundle `name` (its composite slot), or the environment's own when `packageId` is undefined. */
  const tpl = (name: string, locale: string, packageId?: string) => {
    const tag = packageId ? packageId.split('.').pop()! : 'env';
    const item = { name, label: `${tag} ${locale}`, locale, subject: `${tag} ${locale}`, bodyHtml: `<p>${tag}</p>` };
    if (packageId) registry.registerItem('email_template', item, 'name' as never, packageId);
    else registry.registerItem('email_template', { ...item, _provenance: 'org' }, 'name' as never);
  };

  it('a caller with no package is refused a name two packages ship, naming both, at every member', async () => {
    tpl('welcome', 'en-US', A);
    tpl('welcome', 'en-US', B);
    tpl('welcome', 'zh-CN', B);
    await expectRefusal(() => protocol.getMetaItem({ type: 'email_template', name: 'welcome' }), 'ambiguous-in-environment', [A, B]);
    await expectRefusal(() => protocol.getMetaItem({ type: 'email_template', name: 'welcome', member: 'zh-CN' } as never), 'ambiguous-in-environment', [A, B]);
    await expectRefusal(() => protocol.getMetaItemForExecution({ type: 'email_template', name: 'welcome' }), 'ambiguous-in-environment', [A, B]);
    await expectRefusal(() => facade.get('email_template', 'welcome'), 'ambiguous-in-environment', [A, B]);
  });

  it('the read that names a package serves that package\'s member, never the other\'s (child G1\'s exact qualifier)', async () => {
    tpl('welcome', 'en-US', A);
    tpl('welcome', 'en-US', B);
    expect(labelOf((await protocol.getMetaItem({ type: 'email_template', name: 'welcome', packageId: A }))?.item)).toBe('alpha en-US');
    expect(labelOf((await protocol.getMetaItem({ type: 'email_template', name: 'welcome', packageId: B }))?.item)).toBe('beta en-US');
  });

  it('CONTROL — one holder: each member is served to a caller with no package, as before', async () => {
    tpl('solo', 'en-US', A);
    tpl('solo', 'zh-CN', A);
    expect(labelOf((await protocol.getMetaItem({ type: 'email_template', name: 'solo' }))?.item)).toBe('alpha en-US');
    expect(labelOf((await protocol.getMetaItem({ type: 'email_template', name: 'solo', member: 'zh-CN' } as never))?.item)).toBe('alpha zh-CN');
    expect(labelOf(await facade.get('email_template', 'solo'))).toBe('alpha en-US');
  });

  it('CONTROL — the environment\'s own template is served to a caller with no package', async () => {
    tpl('local', 'en-US');
    expect(labelOf((await protocol.getMetaItem({ type: 'email_template', name: 'local' }))?.item)).toBe('env en-US');
  });
});

describe('the types E8 does not wire keep the legacy read', () => {
  it('a view (bucket 1) and a flow (child E1) are read by getItem, untouched', async () => {
    ship('flow', 'onboard', A);
    expect(labelOf(await facade.get('flow', 'onboard', P))).toBe('alpha flow');
  });
});
