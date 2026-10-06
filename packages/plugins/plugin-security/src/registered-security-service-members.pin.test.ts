// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every member of the `security` service this plugin registers is either
 * DECLARED on `ISecurityService` (`@objectstack/spec/contracts`) or listed in
 * this file's ledger with a reason. A served member in neither turns this pin
 * red, by name.
 *
 * ## Why this pin exists
 *
 * The registered object is two pieces. The literal is typed against
 * `ISecurityService`, so the compiler refuses any member the contract does not
 * declare. The extension is merged on with `Object.assign` beside it, and
 * nothing types that half against the contract. Two cross-package seams were
 * served from the extension while the contract did not declare them: the
 * overlay discard the REST route calls, and the ownership-floor alternate seam
 * `service-storage` calls at boot. A contract reader could not see that either
 * seam existed, what it refused, or that a caller must feature-detect it. Both
 * are declared now; this pin keeps the next one from going undeclared.
 *
 * ## How the declared list stays equal to the interface
 *
 * `DECLARED_MEMBERS` is a test-local list, not a spec export, held to
 * `keyof ISecurityService` by a `satisfies` clause. A member added to the
 * interface and not listed here fails to compile (missing property); a name
 * listed here that the interface does not declare fails to compile (excess
 * property); and each entry's `required` / `optional` tag must match the
 * interface. The compile half runs in this package's `typecheck`
 * (`tsconfig.test.json` compiles every test here); vitest does not type-check.
 * A runtime list exported from `packages/spec` would have grown the published
 * surface to serve one test, and it could still drift from the interface
 * unless something like this clause held it there.
 *
 * ## What it does NOT pin
 *
 * Declared-but-not-served is legal for an OPTIONAL member: the contract lets a
 * partial implementation omit one, and callers feature-detect. So the reverse
 * direction is used only as this pin's non-vacuity control: every REQUIRED
 * member must be among the enumerated members, which fails if the boot stopped
 * reaching the registration or the enumeration stopped seeing the members.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ISecurityService } from '@objectstack/spec/contracts';

import { SecurityPlugin } from './security-plugin.js';
import { discardPermissionSetOverlay } from './permission-set-overlay-discard.js';
import { OwnershipFloorAlternates } from './ownership-floor-alternates.js';

/** `optional` exactly when the interface declares the member with `?`. */
type DeclaredOptionality = {
  readonly [K in keyof ISecurityService]-?: object extends Pick<ISecurityService, K> ? 'optional' : 'required';
};

/** Every member `ISecurityService` declares — held equal to the interface by the compiler (see the header). */
const DECLARED_MEMBERS = {
  getReadFilter: 'required',
  getReadableFields: 'required',
  getMetadataReadableFields: 'optional',
  getQueryableFields: 'optional',
  getWritableFields: 'optional',
  resolvePermissionSetNames: 'required',
  resolvePermissionSetsForContext: 'optional',
  getEffectiveObjectPermissions: 'optional',
  canExport: 'required',
  canReadObject: 'optional',
  hasWriteBypass: 'required',
  resolveWriteScope: 'required',
  describeDelegationNarrowing: 'optional',
  checkAuthoredRowWrite: 'optional',
  explain: 'required',
  describeDelegableScope: 'required',
  listAudienceBindingSuggestions: 'required',
  confirmAudienceBindingSuggestion: 'required',
  dismissAudienceBindingSuggestion: 'required',
  discardPermissionSetOverlay: 'optional',
  contributeOwnershipFloorAlternates: 'optional',
} as const satisfies DeclaredOptionality;

/**
 * Members the registered service serves that are deliberately NOT part of the
 * contract — plugin-internal, no caller outside this package — each with the
 * reason. Empty: every served member is declared. An entry here is a decision
 * that a member stays off the contract; a member another package calls is a
 * contract, and belongs on `ISecurityService` instead.
 */
const SERVED_NOT_DECLARED: Readonly<Record<string, string>> = {};

/**
 * Every member name the object exposes, along its whole prototype chain up to
 * (not including) `Object.prototype`, enumerable or not, symbols included. A
 * class-backed service keeps its methods on the prototype, where `Object.keys`
 * would see nothing and this pin would pass over zero members.
 */
function servedMembers(service: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = service; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Reflect.ownKeys(o)) {
      if (key === 'constructor') continue;
      names.add(typeof key === 'symbol' ? key.toString() : key);
    }
  }
  return [...names].sort();
}

/** Boot the real plugin far enough to register `security`, and return what it registered. */
async function registeredSecurityService(): Promise<object> {
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: vi.fn(),
      getSchema: () => undefined,
    },
    metadata: {
      get: async () => undefined,
      list: async () => [],
    },
  };
  const registerService = vi.fn();
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin();
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  const security = registerService.mock.calls.find((c: unknown[]) => c[0] === 'security')?.[1];
  if (security === null || typeof security !== 'object') {
    throw new Error('the plugin did not register a `security` service object');
  }
  return security;
}

describe('the registered `security` service serves only what ISecurityService declares', () => {
  it('every served member is declared on ISecurityService or ledgered here with a reason', async () => {
    const served = servedMembers(await registeredSecurityService());

    // Non-vacuity: the required members are served, so the enumeration below
    // is looking at the real object.
    const required = Object.entries(DECLARED_MEMBERS)
      .filter(([, optionality]) => optionality === 'required')
      .map(([name]) => name);
    expect(
      required.filter((name) => !served.includes(name)),
      'required ISecurityService members missing from the enumerated service',
    ).toEqual([]);

    const undeclared = served.filter(
      (name) => !Object.hasOwn(DECLARED_MEMBERS, name) && !Object.hasOwn(SERVED_NOT_DECLARED, name),
    );
    expect(
      undeclared,
      'served by the registered `security` service but neither declared on ISecurityService ' +
        '(packages/spec/src/contracts/security-service.ts) nor ledgered in SERVED_NOT_DECLARED with a reason',
    ).toEqual([]);
  });

  it('the ledger names only members that are served and not declared', async () => {
    const served = servedMembers(await registeredSecurityService());
    for (const [name, reason] of Object.entries(SERVED_NOT_DECLARED)) {
      expect(served, `ledger entry '${name}' is not served — delete it`).toContain(name);
      expect(Object.hasOwn(DECLARED_MEMBERS, name), `ledger entry '${name}' is declared — delete it`).toBe(false);
      expect(reason.trim().length, `ledger entry '${name}' carries no reason`).toBeGreaterThan(0);
    }
  });

  it('the two extension members are served with the signatures the contract declares (compile-time)', () => {
    // The `Object.assign` half is not typed against the contract, so these two
    // witnesses are: each is the contract's member type, implemented by
    // delegating to the function the registered member delegates to. A
    // parameter the contract hands over that the implementation cannot take,
    // or a result the implementation returns that the contract does not
    // promise, stops this file compiling. Never invoked.
    const discard: NonNullable<ISecurityService['discardPermissionSetOverlay']> = (callerContext, id) =>
      discardPermissionSetOverlay(null as never, callerContext, id);
    const contribute: NonNullable<ISecurityService['contributeOwnershipFloorAlternates']> = (plugin, alternates) =>
      new OwnershipFloorAlternates().contribute(plugin, alternates);
    expect(typeof discard).toBe('function');
    expect(typeof contribute).toBe('function');
  });
});
