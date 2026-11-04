// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Write preparation and insert" section of `ObjectQL`:
 * the bodies of `staticReadonlyCreateStrip`, `updateByIdExpecting`,
 * `assignment`, `readUpdatePriorRow`, `insertMany` moved out of `engine.ts`
 * whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link InsertFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link InsertHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each stub hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class,
 * and a field a body assigns goes with a SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { DataEngineInsertOptions, EngineCountOptions, EngineQueryOptions, QueryAST } from '@objectstack/spec/data';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataDriver } from '@objectstack/core';
import { ConcurrentUpdateError } from './concurrent-update-error.js';
import { ASSIGNMENT_RULE_TYPE, AssignmentRuleEvaluator } from './assignment-rules.js';
import type { EvalPermissions } from '@objectstack/formula';
import { stripReadonlyFields } from './validation/rule-validator.js';
import type { staticReadonlyInsertSubject } from './validation/rule-validator.js';
import { declaredColumnSet, withDeclaredColumnsOnly } from './declared-read-columns.js';
import { WRITE_PRECONDITION_OPTION } from './engine-top-level.js';
import type { PermissionResolution } from './engine-top-level.js';
import type { InsertManyRowOutcome, ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link InsertFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface InsertHost {
  readonly _registry: ObjectQL['_registry'];
  applyFieldDefaults: ObjectQL['applyFieldDefaults'];
  assignmentEvaluator: ObjectQL['assignmentEvaluator'];
  buildDriverOptions: ObjectQL['buildDriverOptions'];
  count: ObjectQL['count'];
  find: ObjectQL['find'];
  getDriver: ObjectQL['getDriver'];
  insert: ObjectQL['insert'];
  readonly logger: ObjectQL['logger'];
  ownershipQueueService: ObjectQL['ownershipQueueService'];
  preconditionDegradedWarned: ObjectQL['preconditionDegradedWarned'];
  resolveDefaultPermissions: ObjectQL['resolveDefaultPermissions'];
  update: ObjectQL['update'];
}

/** The bodies of the "Write preparation and insert" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class InsertFacet {
  /**
   * [#20805] The create path's static-`readonly` strip of ONE row, together
   * with the re-default of every key it takes — the door as `insert()` runs it,
   * lifted out so that {@link ObjectQL.validate} runs the same door over its
   * preview rows instead of a copy of it (one function per door). `insert()`
   * owns everything around it: the `isSystem` gate, the per-call
   * `insertDropped` union, the `preserveAudit`-ignored WARN and partial-mode
   * culling; `validate()` passes no logger, because a preview writes nothing
   * and a strip line would say otherwise.
   *
   * The field's `defaultValue` is RE-DERIVED for every key the strip took,
   * which is #3043's stated contract and a guarantee in its own right: a forged
   * `approval_status` becomes `draft` — the enforced initial state — never
   * NULL, so a stripped forgery cannot leave a row in a state the object's own
   * rules (`requiredWhen`, the state machine) were written to exclude. The
   * deleted ingress copy got this for free by running BEFORE
   * `applyFieldDefaults`; a strip that runs after the hooks has to ask. Asked
   * over the STRIPPED row, so a `defaultValue` expression reads the payload it
   * will really be stored beside, and copied back key by key:
   * `applyFieldDefaults` also fills every OTHER absent field, and a hook that
   * deliberately wrote `null` must keep its null (the first defaults pass,
   * ahead of the hooks, is the one that owns those keys).
   *
   * [#20082] A re-derived `can` default takes the write's map too — from the
   * same resolution, so this asks nothing new unless it is the first pass to
   * need it. Scoped to the TAKEN keys: those are the only defaults this pass
   * keeps, so no other field's default can make it ask, or fail.
   *
   * @returns the row as the strip leaves it (the SAME reference when nothing
   *   was taken) and the keys taken, in the row's key order. When the
   *   re-default's permission resolution fails, `error` carries it and `row`
   *   is the row as it arrived: the caller decides whether that fails the
   *   write or culls the row, and the taken keys are still reported.
   */
  static async staticReadonlyCreateStrip(this: Pick<InsertHost, 'applyFieldDefaults' | 'resolveDefaultPermissions'>, object: string, readonlySubject: NonNullable<ReturnType<typeof staticReadonlyInsertSubject>>, row: Record<string, unknown>, supplied: Readonly<Record<string, unknown>>, context: ExecutionContext | undefined, pass: {
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

  /**
   * [#22445] The by-id update's prior-row read: the STORED row an update of
   * `id` judges, or `null` when the store holds none. One spelling, read by
   * `update()`'s by-id branch and by the `update`-mode preview
   * ({@link ObjectQL.validate}), so the preview judges the image the write
   * judges rather than a second reading of it.
   *
   * A raw driver read, not the read door: the rules judge the row as STORED,
   * so no formula is evaluated, no file reference resolved, no read hook run.
   * ⛔ It answers no access question — `update()` reaches it only after the
   * write gates in its middleware chain, and the preview asks the read door
   * first (see `storedRows` in `validate()`).
   *
   * `buildDriverOptions` carries the open transaction and the tenant scope onto
   * the raw read, as on every engine read. [#21613] The row is shaped like
   * every other row this engine reads off a driver: the declared field set, so
   * the update's `previous` (bound for its hooks, and the audit ledger's side
   * of every update diff) and its returned row are ONE view. Shaping only the
   * returned row would make every update of a row carrying a retired column
   * record that column as changed, its stored value included.
   */
  /**
   * [ADR-0142 D4] The by-id write under {@link OperationContext.writePrecondition}:
   * the driver's conditional `updateMany` over `{ id, ...expect }`, then a
   * readback by id. Zero rows matched is {@link ConcurrentUpdateError}. A driver
   * with no `updateMany` writes unconditionally, logged once per process.
   */
  static async updateByIdExpecting(this: Pick<InsertHost, 'logger' | 'preconditionDegradedWarned'>, driver: IDataDriver, object: string, id: unknown, data: Record<string, unknown>, expect: Readonly<Record<string, unknown>>, options: Parameters<IDataDriver['findOne']>[2]): Promise<unknown> {
    if (typeof driver.updateMany !== 'function') {
      if (!this.preconditionDegradedWarned) {
        this.preconditionDegradedWarned = true;
        this.logger.warn(
          `[objectql] the driver for '${object}' has no conditional update (updateMany), so a by-id write ` +
            'precondition degrades to the pre-image check and the write goes through unconditionally: two ' +
            'concurrent claims of one record may both land, and the round-robin cursor may repeat a member.',
          { object },
        );
      }
      return driver.update(object, id as string, data, options);
    }
    const affected = await driver.updateMany(object, { object, where: { ...expect, id } } as QueryAST, data, options);
    if (!(Number(affected) > 0)) throw new ConcurrentUpdateError(object, String(id));
    return driver.findOne(object, { object, where: { id }, limit: 1 } as QueryAST, options);
  }

  /** The body of `ObjectQL#assignment`; the method's docblock there is its contract. */
  static assignment(this: Pick<InsertHost, '_registry' | 'assignmentEvaluator' | 'count' | 'find' | 'insert' | 'logger' | 'ownershipQueueService' | 'update'>): AssignmentRuleEvaluator {
    if (!this.assignmentEvaluator) {
      this.assignmentEvaluator = new AssignmentRuleEvaluator({
        listRules: () => this._registry.listItems(ASSIGNMENT_RULE_TYPE) as unknown[],
        getSchema: (object) => this._registry.getObject(object),
        hasObject: (object) => Boolean(this._registry.getObject(object)),
        queues: () => this.ownershipQueueService(),
        find: async (object, where, context, limit) =>
          (await this.find(object, { where, ...(limit ? { limit } : {}) } as EngineQueryOptions, { context: context as ExecutionContext })) as Record<string, unknown>[],
        count: (object, where, context) => this.count(object, { where } as EngineCountOptions, { context: context as ExecutionContext }),
        insert: (object, data, context) => this.insert(object, data, { context: context as ExecutionContext }),
        updateExpecting: (object, id, data, expect, context) =>
          this.update(object, { ...data, id }, { context: context as ExecutionContext, [WRITE_PRECONDITION_OPTION]: expect } as any),
        logger: this.logger,
      });
    }
    return this.assignmentEvaluator;
  }

  /** The body of `ObjectQL#readUpdatePriorRow`; the method's docblock there is its contract. */
  static async readUpdatePriorRow(this: Pick<InsertHost, '_registry' | 'buildDriverOptions' | 'getDriver'>, object: string, id: unknown, context: ExecutionContext | undefined, base?: unknown): Promise<Record<string, unknown> | null> {
    const priorAst: QueryAST = { object, where: { id }, limit: 1 } as QueryAST;
    const preOpts = this.buildDriverOptions(object, context, base as any);
    return withDeclaredColumnsOnly(
      await this.getDriver(object).findOne(object, priorAst, preOpts) as Record<string, unknown> | null,
      declaredColumnSet(this._registry.getObject(object)),
    );
  }

  /** The body of `ObjectQL#insertMany`; the method's docblock there is its contract. */
  static async insertMany(this: Pick<InsertHost, 'insert'>, object: string, rows: any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<InsertManyRowOutcome[]> {
    if (!Array.isArray(rows)) throw new Error('insertMany expects an array of rows');
    return this.insert(object, rows, { ...(options ?? {}), __partialRowErrors: true } as any);
  }
}
