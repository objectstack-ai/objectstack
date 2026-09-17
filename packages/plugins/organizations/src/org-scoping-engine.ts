// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ObjectQL doors the org-scoping back-fills reach through, named instead of
 * erased.
 *
 * Both back-fills (`claimOrphanOrgRows`, `claimOrgSeedOwnership`) used to take
 * `ql: any`. That is not a style preference in this corpus: the tenant-audit
 * census reads the RECEIVER's declared type to decide whether a write call site
 * is an engine write at all, and an `any` receiver has no type to read. Sites it
 * cannot place are reported as `unledgered` -- an error, never a default,
 * because a write it cannot see is a write the tenant-audit population does not
 * certify. Naming the doors here places both sites by their TYPE, which is the
 * one placement route that needs no ledger row.
 *
 * ⛔ Deliberately narrow, following `OrphanCleanupEngine` in `plugin-sharing`:
 * it declares only what these two functions call, so it cannot drift into a
 * second, competing description of the whole engine. Widen it by adding the door
 * you actually use, never by re-exporting the engine interface.
 *
 * ⛔ And deliberately PACKAGE-PRIVATE -- the same restraint one layer out. The
 * census reads the type declared at the RECEIVER, in this source tree; it never
 * reads the package's public entry, so exporting this bought the placement
 * nothing and only widened a published surface. ⛔ Do not add it to `index.ts`.
 */

import type { ServiceObject } from '@objectstack/spec/data';

export interface OrgScopingEngine {
  find(object: string, query: any, options?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
  /**
   * Optional on purpose. "registry unavailable" is a real, tested, logged no-op
   * path in both back-fills -- a caller handing over an engine without one gets
   * an empty result and a warning, not a throw -- so the type must be able to
   * describe that engine rather than forcing the guard to be dead code.
   */
  registry?: { getAllObjects(): ServiceObject[] };
}
