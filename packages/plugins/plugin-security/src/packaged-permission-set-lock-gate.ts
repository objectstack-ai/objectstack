// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE METADATA-DOOR REGISTRATION of the packaged-permission-set lock
 * (commit 5619aace3; maintainer ruling 2026-08-25, verbatim: 「11843 同意」 — option B:
 * keep NARROW, move the lock).
 *
 * `packaged-permission-set-lock.ts` refuses a write that targets a
 * package-declared permission set. Until this file existed it had exactly one
 * enforcement point: the `sys_permission_set` DATA door's write-through
 * (retired with that object in C3 stages 7a and 8; this gate is now the lock's
 * only enforcement point). The
 * metadata protocol's pre-persistence authoring-gate seam (ADR-0094 addendum;
 * `registerAuthoringGate`) carried an `'object'` registration only — so a
 * metadata-door write targeting the same package-declared set reached
 * persistence whenever the ADR-0005 tier gate was open for the type
 * (`OS_METADATA_WRITABLE=permission`, the documented operator hatch), and the
 * resulting overlay won at read. Same lock, two doors, one of them unguarded.
 *
 * This registration closes that door WITHOUT authoring a second refusal:
 *
 *  - ⭐ ONE SPELLING (Prime Directive #8). The gate calls
 *    {@link assertPermissionSetNotPackageDeclared} — the same assertion the
 *    retired data door called, consulting the same {@link classifyPackagedPermissionSet}
 *    classifier and throwing the same error classes
 *    (`PackagedPermissionSetLockedError`, and the fail-closed
 *    `PackagedPermissionSetProvenanceUnknownError` when no provenance source
 *    can answer — the lock's header says why accepting on `unknown` is the one
 *    guess a write door must not make). The code (`NOT_OVERRIDABLE`), the
 *    status (403) and the clone prescription cannot drift between the doors,
 *    because both doors run the same lines.
 *
 *  - The hatch's documented capability is RETAINED (the ruling explicitly kept
 *    #8146 NARROW): a write to any name no installed package declares keeps
 *    working exactly as `environment-variables.mdx` promises, hatch open or
 *    closed — the gate returns without effect on an `org` verdict.
 *
 *  - The classifier's runtime-shadow exclusion carries over unchanged: a set
 *    whose definition lives only in `sys_metadata` (ADR-0070 package-door
 *    authoring; hydrated into the registry as a `sys_metadata`-stamped shadow)
 *    is NOT "package-declared" to the lock, so the surviving
 *    `allowRuntimeCreate` tier (ADR-0094 D5-R) stays editable through this
 *    door. Only an artifact-shipped declaration locks.
 *
 *  - The seam's own contract does the channel split: `saveMetaItem` runs
 *    authoring gates for BOTH draft and publish-mode environment saves and for
 *    NEITHER on the `package-author` channel (#6710/#7674) — a package
 *    publishing its own declaration never meets this gate.
 *
 * The layered read mirrors the data door's `probeLayered`: the lock's second
 * artifact source for kernels with no readable SchemaRegistry, reported as
 * `failed` rather than collapsed into "no artifact" when the read throws
 * (that distinction is what `unknown` fail-closed rests on).
 *
 * Like `registerObjectPostureGate`, registration is feature-detected: a
 * protocol that predates `registerAuthoringGate` (older embeddings, unit-test
 * stubs) keeps its existing behavior, and the caller can read the `false`.
 */

import {
  assertPermissionSetNotPackageDeclared,
  type LayeredProbe,
} from './packaged-permission-set-lock.js';

/** The packages a `409` refusal of a read naming no package names (ADR-0150 D5), or `undefined` for any other error. */
function refusedPackageHolders(error: unknown): string[] | undefined {
  const failure = error as { code?: unknown; refusal?: { candidates?: unknown } } | null;
  const candidates = failure?.refusal?.candidates;
  if (failure?.code !== 'RESOURCE_CONFLICT' || !Array.isArray(candidates)) return undefined;
  const packages = candidates
    .filter((c) => !!c && typeof c === 'object' && c.kind === 'package' && typeof c.packageId === 'string')
    .map((c) => c.packageId as string);
  return packages.length > 0 ? packages : undefined;
}

/** Context subset of the protocol's MetadataAuthoringGateContext this gate consumes. */
export interface PermissionSetLockGateContext {
  type: string;
  name: string;
  body: unknown;
}

/**
 * Wire the packaged-permission-set lock onto the metadata protocol's
 * pre-persistence authoring-gate seam for the `permission` type. Returns
 * `true` when wired.
 */
export function registerPackagedPermissionSetLockGate(protocol: any, ql: any): boolean {
  if (!protocol || typeof protocol.registerAuthoringGate !== 'function') return false;
  protocol.registerAuthoringGate('permission', async (ctx: PermissionSetLockGateContext) => {
    let probe: LayeredProbe | undefined;
    if (typeof protocol.getMetaItemLayered === 'function') {
      try {
        const envelope = await protocol.getMetaItemLayered({ type: 'permission', name: ctx.name });
        probe = { status: 'read', envelope };
      } catch (e) {
        // [ADR-0150 D3, #31698] A read naming no package of a name two
        // packages hold is refused naming each: each holder's layers are then
        // read at its package, so the lock judges every one of them.
        const holders = refusedPackageHolders(e);
        try {
          if (!holders) throw e;
          const envelopes: unknown[] = [];
          for (const packageId of holders) envelopes.push(await protocol.getMetaItemLayered({ type: 'permission', name: ctx.name, packageId }));
          probe = { status: 'read', envelopes };
        } catch (failure) {
          probe = { status: 'failed', reason: String((failure as Error)?.message ?? failure) };
        }
      }
    }
    // A metadata-door save that targets a package-declared name is an
    // override of the shipped base whether or not an overlay row exists yet,
    // so the remedy the refusal teaches is the clone path.
    assertPermissionSetNotPackageDeclared(ctx.name, ql, 'update', probe);
  });
  return true;
}
