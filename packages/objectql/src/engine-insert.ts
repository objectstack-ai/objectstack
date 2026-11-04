// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Write preparation and insert" section of `ObjectQL`:
 * the bodies of `staticReadonlyCreateStrip` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link InsertHost}: exactly the
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
import type { EvalPermissions } from '@objectstack/formula';
import { stripReadonlyFields } from './validation/rule-validator.js';
import type { staticReadonlyInsertSubject } from './validation/rule-validator.js';
import type { PermissionResolution } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface InsertHost {
  applyFieldDefaults: ObjectQL['applyFieldDefaults'];
  resolveDefaultPermissions: ObjectQL['resolveDefaultPermissions'];
}

/** The body of `ObjectQL#staticReadonlyCreateStrip`; the method's docblock there is its contract. */
export async function staticReadonlyCreateStrip(this: Pick<InsertHost, 'applyFieldDefaults' | 'resolveDefaultPermissions'>, object: string, readonlySubject: NonNullable<ReturnType<typeof staticReadonlyInsertSubject>>, row: Record<string, unknown>, supplied: Readonly<Record<string, unknown>>, context: ExecutionContext | undefined, pass: {
      logger: Parameters<typeof stripReadonlyFields>[3];
      strictReadonlyWrites: boolean;
      hookWrittenKeys: ReadonlySet<string> | undefined;
      nowSnap: Date;
      permissionResolution: PermissionResolution | undefined;
    }): Promise<{ row: Record<string, unknown>; taken: string[]; error?: unknown }> {
    const stripped = stripReadonlyFields(
      readonlySubject as any, row, supplied, pass.logger,
      {
        strictReadonlyWrites: pass.strictReadonlyWrites,
        hookWrittenKeys: pass.hookWrittenKeys,
        verb: 'insert',
      },
    ) as Record<string, unknown>;
    if (stripped === row) return { row, taken: [] };
    const taken = Object.keys(row).filter((k) => !(k in stripped));
    if (taken.length > 0) {
      let redefaultPermissions: EvalPermissions | undefined;
      try {
        redefaultPermissions = (await this.resolveDefaultPermissions(
          object, [stripped], context, pass.permissionResolution, taken,
        ))(stripped);
      } catch (err) {
        return { row, taken, error: err };
      }
      const redefaulted = this.applyFieldDefaults(object, stripped, context, pass.nowSnap, redefaultPermissions);
      for (const k of taken) {
        if (redefaulted[k] !== undefined) stripped[k] = redefaulted[k];
      }
    }
    return { row: stripped, taken };
  }
