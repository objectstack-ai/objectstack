// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26725] The ONE predicate behind "an object declares each action name once".
 *
 * An action's `name` is its identifier on its object: the runtime registers and
 * dispatches it under `<object>:<name>`, and the action endpoint addresses it
 * as `/api/v1/actions/<object>/<name>`. Two entries of one object's `actions`
 * under one name are two declarations under one key, so which one runs is
 * undefined. `defineStack`'s cross-reference pass already refused that pair
 * for a stack, but the object save door parses an object alone, so it saved
 * and published the pair.
 *
 * Read by two doors, one judgement:
 *
 * - `ObjectSchema`'s refinement (`object.zod.ts`), so every door that parses an
 *   object refuses the pair: `defineStack`, `os validate`, the object save door
 *   (422 `INVALID_METADATA`) and the stored-row diagnostics;
 * - the v18 stored-row listing (`conversions/refused-shapes.ts`), so
 *   `os migrate meta --stored` names each stored object this refuses.
 *
 * Scope is ONE object's own `actions` array. A standalone action bound to the
 * object by `objectName` is a second item, judged where both are visible:
 * `defineStack`'s duplicate action-key check for one stack, and the runtime's
 * bound-action collision report for two packages.
 */

/** One action name that an object's `actions` array declares more than once. */
export interface DuplicateActionName {
  /** The repeated action name. */
  readonly name: string;
  /** Every index of `actions` that declares it, ascending. */
  readonly indexes: readonly number[];
  /** The refusal's message, naming the action, every index and the fix. */
  readonly message: string;
}

/** `actions[0] and actions[1]`, `actions[0], actions[2] and actions[5]`. */
function joinIndexes(indexes: readonly number[]): string {
  const sites = indexes.map((i) => `actions[${i}]`);
  if (sites.length <= 1) return sites.join('');
  return `${sites.slice(0, -1).join(', ')} and ${sites[sites.length - 1]}`;
}

/**
 * Every action name that `actions` declares more than once, in the order each
 * name first appears. An empty list means nothing to refuse. Read on a parsed
 * object or a stored body alike: a non-array, a non-object entry and an entry
 * with no string `name` are left to the schema's own issues.
 */
export function duplicateActionNames(objectName: unknown, actions: unknown): DuplicateActionName[] {
  if (!Array.isArray(actions)) return [];
  const indexesByName = new Map<string, number[]>();
  actions.forEach((action, index) => {
    const name = action !== null && typeof action === 'object' ? (action as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || name === '') return;
    const list = indexesByName.get(name);
    if (list) list.push(index);
    else indexesByName.set(name, [index]);
  });
  const owner = typeof objectName === 'string' && objectName.length > 0 ? `Object '${objectName}'` : 'This object';
  const out: DuplicateActionName[] = [];
  for (const [name, indexes] of indexesByName) {
    if (indexes.length < 2) continue;
    out.push({
      name,
      indexes,
      message:
        `${owner} declares the action '${name}' ${indexes.length === 2 ? 'twice' : `${indexes.length} times`} `
        + `in actions: ${joinIndexes(indexes)}. An action name identifies the action on its object (it is the `
        + 'key the action runs under), so only one of these declarations could run. Rename all but one of them, '
        + 'or remove the duplicate.',
    });
  }
  return out;
}
