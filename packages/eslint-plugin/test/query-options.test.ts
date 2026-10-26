// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { queryOptionsPlugin } from '../src/index.mjs';
import { ruleTester } from './rule-tester.js';

const rule = queryOptionsPlugin.rules['no-any-erasure'];

const erased = [{ messageId: 'erased' }];

ruleTester.run('query-options/no-any-erasure', rule, {
  valid: [
    { code: "engine.find('task', { where: { done: false } });" },
    { code: "const opts: EngineQueryOptions = { limit: 1 }; engine.find('task', opts);" },
    // The sanctioned escape for deliberately off-contract input.
    { code: "engine.find('task', bad as unknown as EngineQueryOptions);" },
    // Argument 0 is the object name; `Array.prototype.find(cb)` lives there too.
    { code: "rows.find((row) => row as any);" },
    { code: "engine.find(name as any, query);" },
    // An `any` PARAMETER forwarded into a query is out of this rule's cut.
    { code: "function list(opts: any) { return engine.find('task', opts); }" },
    // A bare callee is not an engine method.
    { code: "find('task', q as any);" },
    { code: "engine.insert('task', row as any);" },
    // `orderBy` only by name, never through a computed key.
    { code: "const q = { [orderBy]: sort as any };" },
    { code: "const q = { sort: sort as any };" },
  ],
  invalid: [
    { code: "engine.find('task', { where } as any);", errors: erased },
    { code: "engine.findOne('task', q as any);", errors: erased },
    { code: "engine.count('task', <any>q);", errors: erased },
    // Argument 2, the engine/driver options bag.
    { code: "engine.aggregate('task', q, ctx as any);", errors: erased },
    // Re-labelled after the erasure, and through a non-null wrapper.
    { code: "engine.find('task', q as any as EngineQueryOptions);", errors: erased },
    { code: "engine.find('task', (q as any)!);", errors: erased },
    // The split form, resolved through scope.
    { code: "const opts: any = { limit: 5 };\nengine.find('task', opts);", errors: erased },
    { code: "let opts: any;\nfunction run() { return this.engine.find('task', opts); }", errors: erased },
    // `orderBy` erased one level below the argument (#4674's own key).
    { code: "engine.find('task', { ...(ast.orderBy ? { orderBy: ast.orderBy as any } : {}) });", errors: erased },
    { code: "const q = { 'orderBy': sort as any };", errors: erased },
  ],
});
