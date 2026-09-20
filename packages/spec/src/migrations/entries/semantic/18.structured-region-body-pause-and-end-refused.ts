// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'structured-region-body-pause-and-end-refused',
  surface:
    'The BODY of every ADR-0031 structured region — `loop.config.body`, each '
    + '`parallel.config.branches[]`, and `try_catch.config.try` / `.catch` — at every depth the '
    + 'flow parse walks. Two node populations become undeclarable there: a node whose TYPE parks '
    + 'the run on EVERY execution (`screen`, `wait`, `approval`, `approval_revise`) and an '
    + '`end` node, whatever its `outcome`. ⛔ `subflow` and `map` are NOT in the population, '
    + 'although their executors also declare `supportsPause: true`: they pause exactly when the '
    + 'child flow their `config.flowName` names pauses, which is a DIFFERENT metadata record and '
    + 'is not in hand while this flow is parsed. Refusing them by type would also refuse '
    + '`loop { map(synchronous child) }`, a shape that runs correctly today, so a region-nested '
    + '`map` or `subflow` still parses and is met at RUN time instead.',
  replacement:
    'Move the node onto the TOP-LEVEL graph and route the region\'s exit to it. For an `end`: '
    + 'delete it from the body, give the region a normal exit, and put the terminator (with its '
    + '`outcome` / `message`) on the top-level graph — `loop { body: [ …, end ] }` becomes '
    + '`loop { body: [ … ] } → end`. For a pausing node: hoist it out of the container — '
    + '`loop { body: [ try_catch { try: [ approval ] } ] }` becomes a top-level `approval` with '
    + 'the loop fanning out around it, or the pausing half of the branch is split into a '
    + '`subflow` the top-level graph calls; where the repetition is genuinely needed, make the '
    + 'TOP-LEVEL graph the repeating construct with the pause on it rather than nesting the '
    + 'pause inside a region. A `try_catch` whose only purpose was to contain the region\'s '
    + 'refusal has nothing left to contain and is deleted with it.',
  reason:
    'Maintainer ruling, decision batch #145 item 5, verbatim and untranslated: 「同意,其他也同'
    + '意」, carrying the presented option C; extended by batch #146 「146 同意」, which attached '
    + 'the `end` half (the absorbed #18112) and recorded that #3267 is ruled 禁 — structured '
    + 'regions do not support durable pause and a region body cannot terminate the run, so this '
    + 'is that limit\'s authoring-time enforcement rather than an interim. The POPULATION was '
    + 'then fixed by decision batch #153 item 1, letter D (maintainer 「其他同意」): 「inside '
    + '`loop` / `parallel` branch / `try_catch` (try and catch) bodies at any depth, the node '
    + 'types `screen`, `wait`, `approval`, `approval_revise` and `end` are refused by '
    + '`FlowSchema.superRefine` … `map` and `subflow` are ⛔ not refused by type.」 A parse-time '
    + 'rule refuses what is STATICALLY wrong; refusing `map` / `subflow` by type would refuse a '
    + 'correct working shape on a guess about another record. The refusal already existed AT RUN '
    + 'TIME and said nothing an author could act on: the engine converts a suspension raised '
    + 'inside a region into an error at the region boundary, AFTER the executor has written its '
    + 'progress state into the enclosing scope, so a `try_catch` that contains that error leaves '
    + 'residue the next entry reads back as progress. Measured on a real `AutomationEngine`, '
    + '`loop { try_catch { map(pausing child) } }` over 3 iterations x 2 items: not one item\'s '
    + 'subflow ever completed, only two of three iterations reached the catch, and iteration 3 '
    + 'read `started === collection.length`, ran nothing, and returned SUCCESS with '
    + '`summary.failed = 0`. ⚠️ Read that measurement for the MECHANISM: the shape it was taken '
    + 'on is a `map`, which this parse rule deliberately does not reach — making the run-time '
    + 'refusal of a region-contained node that durably suspends LOUD is the second half of '
    + 'ruling D and ships as its own `domain:services` change. ⛔ NOT losslessly convertible: '
    + 'hoisting a node out of a region is a GRAPH REWRITE — new edges, a changed exit, sometimes '
    + 'a deleted container — and which of several shapes the author meant is an intent no '
    + 'artifact records, so a transform that picked one would be inventing the design. That '
    + 'leaves D3, a structured TODO naming each node to edit. ⚠️ Two further boundaries this '
    + 'refusal deliberately does NOT reach, because a parse cannot: a pausing node type '
    + 'contributed by a PLUGIN (ADR-0018 left the node-type namespace open and a parse has no '
    + 'registry), and a region nested past `MAX_REGION_DEPTH` (32), where the walk stops. For '
    + 'both, the engine\'s run-time refusal is still the only one — unchanged by this step, not '
    + 'fixed by it.',
  acceptanceCriteria:
    'No `screen` / `wait` / `approval` / `approval_revise` node and no `end` node sits inside '
    + 'any `loop` body, `parallel` branch or `try_catch` try/catch region in the stack, at any '
    + 'depth. `FlowSchema.parse` (and therefore `defineFlow`, `registerFlow`, `os validate` and '
    + 'a Studio publish) accepts the stack: a node still nested is refused with the node AND the '
    + 'region named in one message '
    + "(`A \\`approval\\` node may not sit inside a structured region — \\`loop 'sweep' body → "
    + "try_catch 'guard' try\\` is a region body …`), anchored at "
    + '`nodes[i].config.body.nodes[j].type` so a designer can jump to it. ⛔ A region-nested '
    + '`map` or `subflow` is NOT part of this migration and needs no edit to load — if such a '
    + 'flow reports `success` having processed nothing, that is the run-time half of the same '
    + 'ruling and not a stack edit. Behaviour to re-check after editing, because the fix CHANGES '
    + 'IT deliberately: a region-nested `end` was a no-op, so moving it to the top level makes '
    + 'the run actually TERMINATE there — check that the nodes after the container were not '
    + 'relying on continuing past it. A hoisted `approval` / `wait` / `screen` now parks the run '
    + 'where the enclosing graph can see it, so anything that polled for the sweep to finish '
    + 'sees a suspended run instead of a green-but-empty one.',
};
