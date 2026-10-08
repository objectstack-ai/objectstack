// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22343 — the D3 entry for closing the shared retry policy and, with it, for
// the build doors judging a `try_catch` node's config keys. `RetryPolicySchema`
// (`shared/retry-policy.zod.ts`) was a plain `z.object`, so it stripped a key it
// did not declare, on both of its parsers: `job.retryPolicy` and a `try_catch`
// node's `retry`. That strip was why `try_catch` was the one builtin
// `flow-builtin-node-config-undeclared-keys-refused` left on `registerFlow`'s
// descriptor walk. The schema is a `strictObject` now, and the spec's key arm
// judges `try_catch` like every other builtin. The census found no writer that
// relied on the strip. No key is removed, so there is no tombstone and no
// RETIRED_KEYS_BY_MAJOR row, and no D2 conversion exists: the platform cannot
// know what an undeclared key was meant to be.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'try-catch-and-retry-policy-undeclared-keys-refused',
  surface:
    'a retry policy carrying a key it does not declare (a typo such as maxRetry, a key borrowed from another '
    + 'retry vocabulary such as baseDelayMs or maxAttempts, or a key nothing reads), wherever the policy is '
    + 'written: a job retryPolicy, and the retry block of a try_catch flow node; and a try_catch flow node whose '
    + 'config carries a key beside try, catch, errorVariable and retry that its executor contract does not '
    + 'declare. Never a key on the try or catch region object or on its nodes and edges (the region check at '
    + 'registration owns those). Reachable wherever a job or a flow is authored or stored: defineStack sources, '
    + 'defineFlow(), an exported stack passed to objectstack validate or objectstack compile, a flow saved from '
    + 'the Studio flow designer, and a flow row already sitting in sys_metadata',
  replacement:
    'the key the policy declares, or no key: maxRetries (retries after the first attempt), backoffMs (the base '
    + 'delay), backoffMultiplier, maxRetryDelayMs and jitter. Rename a typo to the declared key the refusal\'s '
    + 'did-you-mean names; write a delay borrowed from another vocabulary as backoffMs or maxRetryDelayMs; '
    + 'write a count of total attempts as maxRetries one lower (maxAttempts 3 is maxRetries 2); delete a key '
    + 'nothing reads. A retryDelayMs is still answered by its own tombstone: rename it to backoffMs',
  reason:
    '`RetryPolicySchema` was a plain `z.object`, which strips a key it does not declare. Its defaults are '
    + 'opt-in (`maxRetries` 0, `backoffMultiplier` 1), so a stripped key falls back to "no retry" or to a flat '
    + 'delay: a `job.retryPolicy` with `maxRetry: 3` parsed, deployed and never retried, and nothing said so. On '
    + 'a `try_catch` node the strip also kept the flow parse from judging the node\'s keys: its descriptor '
    + 'closes `retry` to five keys, so `registerFlow`\'s undeclared-key walk (`validateNodeConfigKeys`) refused '
    + 'a key the contract would have accepted, and `flow-builtin-node-config-undeclared-keys-refused` left '
    + '`try_catch` to that walk. A `retry.maxRetry` typo or a `bogusKey` beside `try` therefore passed '
    + '`objectstack validate` and `objectstack compile` and was refused only when the flow registered. The '
    + 'policy is now a `strictObject`: an undeclared key is refused at parse, naming the key, with a '
    + 'did-you-mean for a near miss. Measured before closing it: every writer of either parser in this '
    + 'repository and in the pinned objectui writes only declared keys, so it is closed on the shared schema. '
    + 'The one judge `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first), '
    + '`objectstack validate` and the metadata save door share (`flowNodeConfigRefusals`) now judges '
    + '`try_catch` keys like every other builtin\'s, as `node-config-refused-by-contract` anchored at the key '
    + '(`nodes.N.config.retry.maxRetry`), and the descriptor walk stands aside for it, so it keeps plugin node '
    + 'types only. The descriptor\'s declared key sets equal the contract\'s at every position the walk '
    + 'descends to, so registration refuses what it refused before. ⚠️ The one key the walk refused that the '
    + 'contract declares is the `retryDelayMs` tombstone. The `retry-policy-converged` conversion renames it '
    + 'before every door that converts first, but keeps it beside a `backoffMs` holding a different value, and '
    + 'leaves it when it is `null`. The key arm refuses what survives at `nodes.N.config.retry.retryDelayMs`, in '
    + 'the tombstone\'s own words, so registration widens nowhere. A `script` node\'s retired keys keep the '
    + 'scope they had. ⚠️ No D2 conversion: the platform cannot know what an undeclared key was meant to be. '
    + '⚠️ Where such a node already sits, the whole flow is refused, as registration already refused it: from '
    + 'the metadata registry or `sys_metadata` at boot it is skipped with a `warn` naming it, while the flows '
    + 'beside it register; a `defineStack` source throws `StackSchemaInvalidError`; a save from Studio answers '
    + '422 naming the key. A job whose `retryPolicy` carries such a key is new to refusal (no door judged '
    + 'one before): its `defineStack` source throws `StackSchemaInvalidError` at `jobs.N.retryPolicy`, and an '
    + 'artifact carrying it is refused whole at load. ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed stack. '
    + 'Each refusal names the key: a job\'s at `jobs.N.retryPolicy` with the unrecognized key and its '
    + 'did-you-mean, a flow\'s at `nodes.N.config.retry.<key>` or `nodes.N.config.<key>` for a `try_catch` '
    + 'node, and `validateStackExpressions` phrases it as `node \'n\' (try_catch) config.retry.maxRetry`. For '
    + 'each hit rename or delete the key per the replacement. Two proofs. (1) For a stack authored in config '
    + 'files, `objectstack validate` is clean. (2) Boot the stack and confirm each flow REGISTERS: no `failed to '
    + 'register flow` warn for it. A retry policy and a `try_catch` node whose keys the contract declares parse '
    + 'and register byte-identically to before.',
};
