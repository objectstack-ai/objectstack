// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30052 codemod] The "Repository bound to one object and one execution
 * context" section: the bodies of `ObjectRepository`'s methods `find`,
 * `findOne`, `insert`, `create`, `update`, `updateById`, `delete`,
 * `deleteById`, `count`, `aggregate`, `execute` moved out of `engine.ts` whole
 * by `scripts/codemod-split-engine.mjs` (its second pass).
 *
 * A MOVE, not a redesign. {@link ObjectRepositoryFacet} is a stateless facet of
 * `ObjectRepository`: each static method of it is the body of the
 * `ObjectRepository` method of the same name exactly as it stood: not
 * re-indented, not formatted, not edited. The method stays on the class as a
 * one-call stub with its signature, so the published surface, an instance spy
 * and a subclass override are what they were. A public method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectRepository`.
 *
 * The bodies reach the instance through {@link ObjectRepositoryHost}: exactly
 * the `ObjectRepository` members they read, private ones included. Every stub
 * hands its body, by a `.call`, the same host: `objectRepositoryHost` in
 * `engine-scoped-hosts.ts`, built once per instance by the class's static
 * block. Methods go as closures that call them on the instance at call time;
 * fields and accessors go as GETTERS, read when the body reads them, and a
 * field a body assigns goes with a SETTER that assigns it on the instance.
 *
 * Values declared in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { markAppAutomationElevation } from '@objectstack/core';
import { ScopedContext } from './engine.js';
import type { ObjectRepository } from './engine.js';

/**
 * The `ObjectRepository` members the bodies of {@link ObjectRepositoryFacet}
 * read — every one of them, and no other. Each is typed AS the class member (an
 * indexed access on the class), so a change to a member's signature on the
 * class is a change here too. `readonly` members are the getters; the others
 * are fields a body assigns.
 */
export interface ObjectRepositoryHost {
  readonly context: ObjectRepository['context'];
  readonly engine: ObjectRepository['engine'];
  insert: ObjectRepository['insert'];
  readonly objectName: ObjectRepository['objectName'];
}

/** The bodies of `ObjectRepository`'s methods: a stateless facet, called by the class's stubs. */
export class ObjectRepositoryFacet {
  /** The body of `ObjectRepository#find`; the method's docblock there is its contract. */
  static async find(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, query: any = {}): Promise<any[]> {
    return this.engine.find(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#findOne`; the method's docblock there is its contract. */
  static async findOne(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, query: any = {}): Promise<Record<string, any> | null> {
    return this.engine.findOne(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#insert`; the method's docblock there is its contract. */
  static async insert(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, data: any): Promise<any> {
    return this.engine.insert(this.objectName, data, {
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#create`; the method's docblock there is its contract. */
  static async create(this: Pick<ObjectRepositoryHost, 'insert'>, data: any): Promise<any> {
    return this.insert(data);
  }

  /** The body of `ObjectRepository#update`; the method's docblock there is its contract. */
  static async update(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, data: any, options: any = {}): Promise<Record<string, any> | number | null> {
    return this.engine.update(this.objectName, data, {
      ...options,
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#updateById`; the method's docblock there is its contract. */
  static async updateById(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, id: string | number, data: any): Promise<any> {
    return this.engine.update(this.objectName, { ...data, id: id }, {
      where: { id: id },
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#delete`; the method's docblock there is its contract. */
  static async delete(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, options: any = {}): Promise<any> {
    return this.engine.delete(this.objectName, {
      ...options,
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#deleteById`; the method's docblock there is its contract. */
  static async deleteById(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, id: string | number): Promise<any> {
    return this.engine.delete(this.objectName, {
      where: { id: id },
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#count`; the method's docblock there is its contract. */
  static async count(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, query: any = {}): Promise<number> {
    return this.engine.count(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#aggregate`; the method's docblock there is its contract. */
  static async aggregate(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, query: any = {}): Promise<any[]> {
    return this.engine.aggregate(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** The body of `ObjectRepository#execute`; the method's docblock there is its contract. */
  static async execute(this: Pick<ObjectRepositoryHost, 'context' | 'engine' | 'objectName'>, actionName: string, params?: any): Promise<any> {
    if (this.engine.executeAction) {
      // [#25653] With the `'action'` mark, as `buildActionExecutionContext`
      // (runtime) gives the REST and MCP doors' action bodies: the action this
      // reaches is app-authored automation running elevated, so its writes to
      // the four identity-assignment objects are refused (plugin-security).
      const executionContext: ExecutionContext = markAppAutomationElevation(
        { ...this.context, isSystem: true },
        'action',
      );
      return this.engine.executeAction(this.objectName, actionName, {
        ...params,
        userId: this.context.userId,
        tenantId: this.context.tenantId,
        roles: this.context.positions,
        executionContext,
        api: new ScopedContext(executionContext, this.engine),
      });
    }
    throw new Error(`Actions not supported by engine`);
  }
}
