// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22902. An accept-set narrowing of the stack aggregate: two entries of one
// stack's `functions` ARRAY that author the same `name` are refused by the
// cross-reference pass, the one-stack sibling of the duplicate action-key
// refusal and of `composeStacks`' cross-stack function-name refusal. No D2
// conversion: which entry should own the name, and what the other one is
// renamed to (with every hook, action and script node that reads it), is the
// author's call.
export const entry: SemanticMigration = {
  id: 'stack-functions-array-duplicate-name-refused',
  surface:
    'stack.functions in the ARRAY form — two or more entries that author the same name, e.g. '
    + "functions: [{ name: 'sync', handler: a }, { name: 'sync', handler: b }]",
  replacement:
    'One entry per name. Rename one of the colliding entries (and every hook handler, action target '
    + 'and flow script node that should call it), or merge them into a single entry and delete the '
    + 'other. The map form, which cannot author one name twice, is unchanged, and so is an array whose '
    + 'names are distinct.',
  reason:
    'Functions are one flat namespace resolved by name: a hook handler, an action target and a flow '
    + 'script node all look a function up by its name, and the engine registers each under that name. '
    + 'The array form could author one name twice and nothing refused it, so the two entries diverged '
    + 'silently and differently on each path. objectstack build exited 0 and shipped the second entry '
    + 'under a suffixed internal ref the author never wrote and nothing references, so the name ran the '
    + 'FIRST entry; a source boot registered the name as the SECOND entry and dropped the first, with no '
    + 'notice. The same stack therefore ran different code under one name depending on whether it was '
    + 'built. composeStacks already refused the same name across two stacks; the stack aggregate now '
    + 'refuses it inside one stack, in the same cross-reference envelope as a duplicate action key. '
    + 'Not convertible: which entry keeps the name is a fact only the author holds.',
  acceptanceCriteria:
    'os validate and os build load the stack without a STACK_CROSS_REFERENCE_INVALID refusal. A stack '
    + 'that still repeats a name is refused at load, with one finding per colliding name that names the '
    + 'name and every index (stack.functions[i] and stack.functions[j]). After renaming, check that '
    + 'each hook, action and script node that calls the renamed function now names the entry it '
    + 'means, rather than assuming the old resolution was the intended one.',
};
