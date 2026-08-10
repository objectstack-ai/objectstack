// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'hook-register-empty-object-target-refused',
  surface:
    "engine.registerHook(event, handler, { object: '' | [] | [''] }), and a scope whose "
    + '`excludeObjects` cancels its `object` entirely',
  replacement:
    "name the object(s) — `object: 'account'` / `object: ['account', 'contact']` — or, for "
    + "a global hook, `object: '*'` or no `object` key at all; for a cancelled scope, widen "
    + '`object` or drop the overlapping names from `excludeObjects`',
  reason:
    '#4281 ruled that an empty hook target is not "no target" and closed the shape at the '
    + "two METADATA doors — `HookSchema.object`'s refine and `hook-binder.ts`'s "
    + '`normalizeObjects`. `engine.registerHook`, the CODE door, goes through neither, so '
    + 'all three spellings still registered, each producing a defect the author did not '
    + "write: `''` is FALSY, so the allow face was skipped entirely and the entry became a "
    + "GLOBAL hook (#4281's headline failure mode — blank intent taking the broadest "
    + "possible blast radius); `[]` and `['']` are truthy but admit no object name, so the "
    + 'entry could never fire. #5928 then added the `excludeObjects` face, which brought a '
    + 'fourth shape reached by arithmetic rather than by one bad name: an `object` list '
    + 'every member of which is also excluded admits nothing, so that entry can never fire '
    + 'either. All four are ADR-0078 silently-inert declarations, and all four are now '
    + 'refused at REGISTRATION.\n\n'
    + 'No mechanical rewrite exists, in either direction. The refused values carry no '
    + "recoverable intent — `object: ''` could have meant `'*'` (what it actually did) or a "
    + 'specific object name the author forgot to fill in, and those are opposite '
    + 'registrations; choosing between them is a judgment the chain cannot make. Nor could '
    + "the MATCHING read be changed instead: teaching the matcher that `''` is an "
    + 'unmatchable name would silently convert a hook firing on every object into one '
    + 'firing on none — the same class of defect pointing the other way, which is why '
    + '#5928 declined to do it in passing.\n\n'
    + 'This is a RUNTIME registration API, not stored metadata, so — like '
    + '`hook-context-session-roles-retired` at this step — there is no `sys_metadata` row '
    + 'for the D2 chain to rewrite and the ledger entry is the notification channel. One '
    + 'metadata surface reaches it INDIRECTLY and is the reason this is not purely a '
    + "code-side note: a `record-change` flow's start node forwards `config.objectName` "
    + 'verbatim into `registerHook` (`RecordChangeTrigger.start`), so a flow authored with '
    + 'a blank `objectName` used to bind a trigger to EVERY object in the tenant. It now '
    + "fails to bind instead, loudly — the automation engine's per-flow bind guard warns "
    + 'and the `kernel:bootstrapped` binding audit re-reports it — which is the correct '
    + 'end state, but it is an observable change for that flow. #6573, #4281, #4001, '
    + '#5928, ADR-0078.',
  acceptanceCriteria:
    'No `registerHook` call site passes an empty `object` target, and none passes an '
    + '`excludeObjects` list covering every name in its `object` list. Every `record-change` '
    + 'flow start node declares a non-blank `config.objectName`, or omits the key if the '
    + 'flow is genuinely meant to fire on every object. Boot completes with no '
    + '"[ObjectQL] Hook ... declares an empty `object` target" throw and no '
    + '"[record-change] ... not bound" warning naming a flow you expect to fire.',
};
