// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'structured-region-body-pause-and-end-refused',
  surface:
    'The BODY of every ADR-0031 structured region — `loop.config.body`, each '
    + '`parallel.config.branches[]`, and `try_catch.config.try` / `.catch` — at every depth the '
    + 'flow parse walks. Two node populations become undeclarable there: a node whose TYPE can '
    + 'durably pause (`screen`, `wait`, `subflow`, `map`, `approval`, `approval_revise`) and an '
    + '`end` node, whatever its `outcome`. ⚠️ Judged on the node TYPE, which is WIDER than the '
    + 'runs that actually broke: a `map` or `subflow` pauses exactly when the child flow it '
    + 'names pauses, so a region-nested `map` over a synchronous child ran green and is refused '
    + 'now. That is deliberate — the legality of the old shape lived in a DIFFERENT metadata '
    + 'record and could be revoked by editing that record, which is not a contract an author '
    + 'can rely on.',
  replacement:
    'Move the node onto the TOP-LEVEL graph and route the region\'s exit to it. For an `end`: '
    + 'delete it from the body, give the region a normal exit, and put the terminator (with its '
    + '`outcome` / `message`) on the top-level graph — `loop { body: [ …, end ] }` becomes '
    + '`loop { body: [ … ] } → end`. For a pausing node: hoist it out of the container — '
    + '`loop { body: [ try_catch { try: [ map ] } ] }` becomes a top-level `map` (its own '
    + 'per-item subflow already iterates, so the enclosing `loop` is usually redundant), and '
    + 'where the repetition is genuinely needed, make the TOP-LEVEL graph the repeating '
    + 'construct with the pause on it rather than nesting the pause inside a region. A '
    + '`try_catch` whose only purpose was to contain the region\'s refusal has nothing left to '
    + 'contain and is deleted with it.',
  reason:
    'Maintainer ruling, decision batch #145 item 5, verbatim and untranslated: 「同意,其他也同'
    + '意」, carrying the presented option C; extended by batch #146 「146 同意」, which attached '
    + 'the `end` half (the absorbed #18112) and recorded that #3267 is ruled 禁 — structured '
    + 'regions do not support durable pause and a region body cannot terminate the run, so this '
    + 'is that limit\'s authoring-time enforcement rather than an interim. The refusal already '
    + 'existed AT RUN TIME and said nothing an author could act on: the engine converts a '
    + 'suspension raised inside a region into an error at the region boundary, AFTER the '
    + 'executor has written its progress state into the enclosing scope, so a `try_catch` that '
    + 'contains that error leaves residue the next entry reads back as progress. Measured on a '
    + 'real `AutomationEngine`, `loop { try_catch { map(pausing child) } }` over 3 iterations x '
    + '2 items: not one item\'s subflow ever completed, only two of three iterations reached '
    + 'the catch, and iteration 3 read `started === collection.length`, ran nothing, and '
    + 'returned SUCCESS with `summary.failed = 0`. ⛔ NOT losslessly convertible: hoisting a '
    + 'node out of a region is a GRAPH REWRITE — new edges, a changed exit, sometimes a deleted '
    + 'container — and which of several shapes the author meant is an intent no artifact '
    + 'records, so a transform that picked one would be inventing the design. That leaves D3, a '
    + 'structured TODO naming each node to edit. ⚠️ Two boundaries this refusal deliberately '
    + 'does NOT reach, because a parse cannot: a pausing node type contributed by a PLUGIN '
    + '(ADR-0018 left the node-type namespace open and a parse has no registry), and a region '
    + 'nested past `MAX_REGION_DEPTH` (32), where the walk stops. For both, the engine\'s '
    + 'run-time refusal is still the only one — unchanged by this step, not fixed by it.',
  acceptanceCriteria:
    'No `screen` / `wait` / `subflow` / `map` / `approval` / `approval_revise` node and no '
    + '`end` node sits inside any `loop` body, `parallel` branch or `try_catch` try/catch '
    + 'region in the stack, at any depth. `FlowSchema.parse` (and therefore `defineFlow`, '
    + '`registerFlow`, `os validate` and a Studio publish) accepts the stack: a node still '
    + 'nested is refused with the node AND the region named in one message '
    + "(`A \\`map\\` node may not sit inside a structured region — \\`loop 'sweep' body → "
    + "try_catch 'guard' try\\` is a region body …`), anchored at "
    + '`nodes[i].config.body.nodes[j].type` so a designer can jump to it. Behaviour to re-check '
    + 'after editing, because the fix CHANGES IT deliberately: a sweep that used to report '
    + '`success` having processed nothing now processes its items, so anything downstream that '
    + 'had quietly stopped receiving work starts receiving it again, and any alerting tuned to '
    + 'the empty-but-green runs will see real volume. A region-nested `end` was a no-op, so '
    + 'moving it to the top level makes the run actually TERMINATE there — check that the nodes '
    + 'after the container were not relying on continuing past it.',
};
