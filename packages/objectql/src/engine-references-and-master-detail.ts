// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Realtime, i18n, home amounts, validation messages, references, master-detail"
 * section of `ObjectQL`: the bodies of `inspectDanglingReferences`,
 * `inspectCascadeDelete` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link ReferencesAndMasterDetailHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { postureUsesUnionScope } from '@objectstack/spec/security';
import { auditDanglingReferences } from './integrity/dangling-reference-audit.js';
import type { AuditableObject, DanglingReferenceAuditOptions, DanglingReferenceReport } from './integrity/dangling-reference-audit.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface ReferencesAndMasterDetailHost {
  readonly _registry: ObjectQL['_registry'];
  collectCascadeDeleteSet: ObjectQL['collectCascadeDeleteSet'];
  find: ObjectQL['find'];
  readonly logger: ObjectQL['logger'];
  referenceExists: ObjectQL['referenceExists'];
  resolveEnginePosture: ObjectQL['resolveEnginePosture'];
  resolveObjectName: ObjectQL['resolveObjectName'];
}

/** The body of `ObjectQL#inspectDanglingReferences`; the method's docblock there is its contract. */
export async function inspectDanglingReferences(this: Pick<ReferencesAndMasterDetailHost, '_registry' | 'find' | 'logger' | 'referenceExists' | 'resolveEnginePosture'>, options?: DanglingReferenceAuditOptions): Promise<DanglingReferenceReport> {
    // Read once per run, live — the posture IN FORCE, by the engine's one reader.
    const unionScope = postureUsesUnionScope(this.resolveEnginePosture());
    return auditDanglingReferences(
      {
        objects: () => this._registry.getAllObjects() as unknown as AuditableObject[],
        find: (object, opts) => this.find(object, opts as any) as Promise<Array<Record<string, unknown>>>,
        probe: (target, id, organization) => this.referenceExists(
          target, id, organization == null || unionScope ? undefined : ({ tenantId: organization } as ExecutionContext),
        ),
        warn: (msg, meta) => this.logger?.warn?.(msg, meta as any),
      },
      options,
    );
  }

/** The body of `ObjectQL#inspectCascadeDelete`; the method's docblock there is its contract. */
export async function inspectCascadeDelete(this: Pick<ReferencesAndMasterDetailHost, '_registry' | 'collectCascadeDeleteSet' | 'resolveObjectName'>, object: string, id: string | number): Promise<Array<{ object: string; id: string }>> {
    const resolved = this.resolveObjectName(object);
    const set = await this.collectCascadeDeleteSet(
      resolved, [id], undefined, this._registry.getAllObjects(), { fileElevations: false },
    );
    const root = { object: resolved, id: String(id) };
    const members = [root];
    for (const [memberObject, ids] of set.members) {
      for (const memberId of ids) {
        if (memberObject === root.object && memberId === root.id) continue;
        members.push({ object: memberObject, id: memberId });
      }
    }
    return members;
  }
