// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24164 ruling E′, item 2] An object's declared default row scope
 * (`ObjectSchema.defaultRowScope`) as the one policy
 * `SecurityPlugin.collectRLSPolicies` applies when no permission set the
 * caller holds carries a row policy for that object and operation.
 *
 * ## What "carries a row policy" means
 *
 * Exactly what the collection already means by an EMPTY collection: the held
 * sets' policies for this object and operation, after the ADR-0105 D3
 * admission, `enabled`, the `positions` domain and `'*'` matching
 * (`RLSCompiler.getApplicablePolicies`). So a held `'*'` policy counts, a
 * policy switched off or outside the caller's positions does not, and a held
 * policy for another operation does not either: an object whose held sets
 * scope only `update` reads under its default. The default is never added to
 * a non-empty collection: an authored set policy is used as authored.
 *
 * The default then takes the path a held policy takes, from the same
 * admission onward: `getApplicablePolicies` judges its own `enabled`,
 * `positions` and `operation`, and the compiler compiles its `using` /
 * `check`. A `using` that does not lower is dropped with the same WARN and
 * fails closed to the same `RLS_DENY_FILTER` an authored policy's does,
 * because it is the same code. Superuser-bypass principals never reach the
 * collection, so the default cannot touch them.
 *
 * ## Why the registry, and what the read costs
 *
 * The declaration is read off `ql.getSchema(object)`, the ObjectQL registry's
 * resolved object: the schema the engine compiles every find against, and the
 * source `getObjectSecurityMeta` prefers. An object the registry does not
 * resolve is refused by the engine's own door before any read runs. The read
 * is two in-memory map lookups behind the registry's merged-object cache, and
 * it is made only when the held collection is empty: no I/O and no parse on
 * any path.
 *
 * ## Provenance
 *
 * The policy built here is recognised by IDENTITY ({@link
 * isObjectDefaultRowScopePolicy}), never by spelling, for the reason
 * `platform-ownership-policies.ts` gives for the floor's alternates: a held
 * policy byte-identical to an object's default is still the set's own policy,
 * and explain must name it as such. `RLSCompiler.compileFilter` carries the
 * mark onto the compiled filter, which is how explain names an applied
 * default by its declaration rather than by a permission set.
 */

import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';

/** The policies {@link objectDefaultRowScopePolicy} built — an object's default, by identity. */
const OBJECT_DEFAULT_INSTANCES = new WeakSet<object>();

/**
 * The declared default row scope of `objectName` as one row-level security
 * policy, with `object` set to the declaring object (the key implies it, and
 * a stray `object` on a body that reached the registry unparsed cannot
 * retarget it). `null` when the schema declares none, which keeps an object
 * with no default exactly as it was.
 *
 * Built fresh per call: the collection hands it to filters and compilers that
 * never write to it, and a fresh object keeps two registered objects that
 * spread one shared scope literal from ever sharing a policy instance.
 */
export function objectDefaultRowScopePolicy(objectName: string, schema: unknown): RowLevelSecurityPolicy | null {
  if (schema === null || typeof schema !== 'object') return null;
  const scope = (schema as { defaultRowScope?: unknown }).defaultRowScope;
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) return null;
  const policy = { ...(scope as Omit<RowLevelSecurityPolicy, 'object'>), object: objectName } as RowLevelSecurityPolicy;
  OBJECT_DEFAULT_INSTANCES.add(policy);
  return policy;
}

/**
 * True iff `policy` is an object's declared default row scope, as
 * {@link objectDefaultRowScopePolicy} built it — never a held set's policy,
 * whatever it spells.
 */
export function isObjectDefaultRowScopePolicy(policy: object): boolean {
  return OBJECT_DEFAULT_INSTANCES.has(policy);
}
