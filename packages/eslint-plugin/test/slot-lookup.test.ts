// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { SLOT_LOOKUP_ANY_MESSAGE, slotLookupPlugin } from '../src/index.mjs';
import { lintWith, ruleTester } from './rule-tester.js';

const rule = slotLookupPlugin.rules['no-any-assignment'];

/** The lists the root config passes today; the cases below do not depend on more. */
const options = [{
  lookups: ['resolveService', 'getService', 'getRequestKernelService'],
  uncontracted: ['protocol', 'mcp', 'kernel-resolver', 'scope-manager'],
}];

const erased = [{ messageId: 'erased' }];

ruleTester.run('slot-lookup/no-any-assignment', rule, {
  valid: [
    // The correctly-typed split form the rule exists to leave alone.
    { code: "let i18n: II18nService | undefined; i18n = ctx.getService('i18n');", options },
    // An undeclared target resolves to nothing, so nothing is claimed about it.
    { code: "svc = ctx.getService('data');", options },
    // A member target is not a declared variable.
    { code: "let holder: any = {}; holder.svc = ctx.getService('data');", options },
    // An uncontracted slot legitimately yields `any`, exempt by name.
    { code: "let m: any; m = ctx.getService('mcp');", options },
    { code: "let r: any; r = await deps.resolveService('kernel-resolver', env);", options },
    // Not a lookup method.
    { code: "let x: any; x = ctx.getObjectQL();", options },
    // A bare call is not a dispatcher lookup.
    { code: "let x: any; x = getService('data');", options },
  ],
  invalid: [
    // The fourth erasure shape as the rule's history names it.
    { code: "let ql: any;\ntry { ql = ctx.getService('objectql'); } catch { /* optional */ }", options, errors: erased },
    { code: "let auth: any; auth = await deps.resolveService('auth', env);", options, errors: erased },
    { code: "let k: any; k = req.getRequestKernelService('data');", options, errors: erased },
    // The lookup nested inside the assigned expression still erases the slot.
    { code: "let d: any; d = (await ctx.getService('data')) ?? fallback;", options, errors: erased },
    // Declared in an outer scope, assigned in an inner one.
    { code: "let d: any;\nfunction init() { d = ctx.getService('data'); }", options, errors: erased },
  ],
});

describe('slot-lookup/no-any-assignment configuration', () => {
  it('reports with the message the ratchet counts by', () => {
    const messages = lintWith('slot-lookup', slotLookupPlugin, ['error', ...options],
      "let d: any; d = ctx.getService('data');");
    expect(messages.map((m) => m.message)).toEqual([SLOT_LOOKUP_ANY_MESSAGE]);
  });

  it('refuses a config that does not pass the slot lists', () => {
    expect(() => lintWith('slot-lookup', slotLookupPlugin, 'error', 'const a = 1;'))
      .toThrow(/should NOT have fewer than 1 items/);
  });
});
