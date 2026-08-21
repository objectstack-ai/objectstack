// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE `vi.mock('./registry', …)` factory for this package's engine suites
 * (#10551).
 *
 * ## What this replaces
 *
 * `vi.mock('./registry', …)` appeared in **twelve** test files in this
 * directory, and all twelve were hand-copies of one shape: the same
 * `const instance: any = {…}` member list, the same
 * `function SchemaRegistry() { return instance; }`, the same
 * `Object.assign(SchemaRegistry, instance)`, the same trailing `computeFQN` /
 * `parseFQN` / `RESERVED_NAMESPACES` envelope.
 *
 * They had drifted, and the drift was invisible by construction — nothing
 * compared the copies. Eleven declared twelve members;
 * `engine-count-read-filter.test.ts` declared **eleven**, omitting
 * `getAllObjects`. That omission was measured to be inert (a recording `Proxy`
 * on all twelve doubles over the whole 224-file suite recorded **zero**
 * accesses to an undeclared member), but inert is a property of which paths a
 * suite happens to drive today, not a property of the double: the same omission
 * in a suite that *did* drive one of the 13 `getAllObjects` call sites in this
 * package is exactly #9002, and #9154, and #8896.
 *
 * ## Why a shared factory rather than adding the one missing line
 *
 * Adding `getAllObjects` to the outlier fixes today's instance and leaves the
 * mechanism that produced it. The deciding evidence is the two lesson comments
 * carried below: each one was written once, into whichever copy happened to be
 * under repair, and **could not reach the other eleven, because there was no
 * shared factory to write it in**. Here, every call site inherits them.
 *
 * ## Why this module is `.ts` and not `*.test.ts`
 *
 * Two reasons, and they point the same way as `register-object-authored-shape.pin.ts`:
 *   - vitest's default `include` collects `*.test.ts`, so a shared helper named
 *     that way is collected as a suite with no tests in it;
 *   - `packages/objectql/tsconfig.json` excludes `**\/*.test.ts`, so a helper
 *     named that way would be type-checked by no program the `typecheck` script
 *     runs. This file IS in that program.
 *
 * It is not reachable from `src/index.ts` or `src/core.ts`, so `tsup` never
 * bundles it and it is never published.
 *
 * ## Usage — the async factory is the hoisting-safe form
 *
 * `vi.mock` calls are hoisted above the file's imports, so this module cannot be
 * imported at the top of a test and referenced from the factory. `vi.mock`
 * accepts an **async** factory, which makes a dynamic `import()` inside it legal
 * and ordered correctly:
 *
 * ```ts
 * vi.mock('./registry', async () => {
 *   const { createRegistryModuleMock } = await import('./registry-module-mock.js');
 *   return createRegistryModuleMock();
 * });
 * ```
 *
 * Pass `instance` to override individual members with suite-specific behaviour
 * (`engine.test.ts` drives a stateful in-memory registry that way), and
 * `computeFQN` / `parseFQN` / `reservedNamespaces` to override the module
 * envelope. Overrides are merged over the defaults, so a suite that overrides
 * one member still inherits the other eleven — which is the property that makes
 * the drift unrepeatable.
 */

import { vi } from 'vitest';

/**
 * The registry double's member set — the twelve members every hand-copy
 * declared (before the merge, eleven of the twelve copies declared all of
 * them; the twelfth omitted `getAllObjects`).
 *
 * The index signature is deliberate: the hand-copies were typed `any`, and a
 * suite that needs to model a member the real `SchemaRegistry` grows tomorrow
 * must be able to add it here without a type edit standing in the way.
 */
export interface RegistryDoubleInstance {
  getObject: any;
  resolveObject: any;
  getAllObjects: any;
  registerObject: any;
  getObjectOwner: any;
  registerNamespace: any;
  registerKind: any;
  registerItem: any;
  registerApp: any;
  installPackage: any;
  reset: any;
  metadata: any;
  [member: string]: any;
}

/** The module shape `vi.mock('./registry', …)` must return. */
export interface RegistryModuleMock {
  SchemaRegistry: any;
  computeFQN: (namespace: string | undefined, name: string) => string;
  parseFQN: (fqn: string) => { namespace: string | undefined; shortName: string };
  RESERVED_NAMESPACES: Set<string>;
}

export interface RegistryModuleMockOptions {
  /** Per-suite member overrides, merged over the default member set. */
  instance?: Partial<RegistryDoubleInstance>;
  /** Defaults to the identity mapping (no namespace prefixing). */
  computeFQN?: (namespace: string | undefined, name: string) => string;
  /** Defaults to "the whole string is the short name". */
  parseFQN?: (fqn: string) => { namespace: string | undefined; shortName: string };
  /** Defaults to `new Set(['base', 'system'])`. */
  reservedNamespaces?: Set<string>;
}

/**
 * Build the module object for `vi.mock('./registry', …)`.
 *
 * @param options per-suite overrides; every unset member takes the default.
 */
export function createRegistryModuleMock(
  options: RegistryModuleMockOptions = {},
): RegistryModuleMock {
  const {
    instance: instanceOverrides,
    computeFQN = (_namespace: string | undefined, name: string) => name,
    parseFQN = (fqn: string) => ({ namespace: undefined, shortName: fqn }),
    reservedNamespaces = new Set(['base', 'system']),
  } = options;

  const instance: RegistryDoubleInstance = {
    getObject: vi.fn(),
    resolveObject: vi.fn((name: string) => instance.getObject(name)),
    // [#9002] This double used to omit `getAllObjects`, and the suite passed
    // anyway: `delete()`'s by-id branch reads it twice (`planCascadeAtomicity`,
    // then `cascadeDeleteRelations`) and BOTH reads sat behind a `catch` that
    // answered "no relations". The swallow absorbed the `TypeError` this
    // omission raises just as silently as it would absorb a real read failure,
    // so an incomplete double read as a registry with nothing in it. With the
    // swallows gone the omission is a hard failure, which is the point — the
    // double now has to model the method the engine actually calls. Empty is
    // the right body here: a suite that registers no relations is telling the
    // truth when it says "no object references the deleted one", where a double
    // that cannot answer at all leaves the engine to invent it.
    //
    // [#9154] The same member, the same lesson, learned a second time from the
    // other side: the engine's roll-up summary index read it as
    // `getAllObjects?.() ?? []`, so a double that does not model the method was
    // indistinguishable from a registry with nothing in it — the write path
    // silently skipped the insert-time roll-up seed (#5749) and the post-write
    // recompute. With the optional call gone the omission is a hard `TypeError`.
    // Empty is the truthful body for a suite that declares no `summary` field:
    // the roll-up index over it is empty either way, and now it says so instead
    // of the engine inventing it.
    //
    // ⚠️ Both lessons were written into ONE of the twelve hand-copies each, and
    // neither could reach the other eleven. That is why they live here (#10551).
    // A suite whose truthful answer is NOT "no objects" overrides this member —
    // it does not delete it.
    getAllObjects: vi.fn(() => []),
    registerObject: vi.fn(),
    getObjectOwner: vi.fn(),
    registerNamespace: vi.fn(),
    registerKind: vi.fn(),
    registerItem: vi.fn(),
    registerApp: vi.fn(),
    installPackage: vi.fn(),
    reset: vi.fn(),
    metadata: { get: vi.fn(() => new Map()) },
    ...instanceOverrides,
  };

  function SchemaRegistry(): RegistryDoubleInstance {
    return instance;
  }
  Object.assign(SchemaRegistry, instance);

  return {
    SchemaRegistry,
    computeFQN,
    parseFQN,
    RESERVED_NAMESPACES: reservedNamespaces,
  };
}
