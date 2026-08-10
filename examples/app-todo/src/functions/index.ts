// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Flow Functions Barrel — the named callables `script` nodes invoke.
 *
 * `todoFunctions` is what `defineStack({ functions })` registers; the automation
 * plugin bridges that map to `AutomationEngine.resolveFunction`, which is how a
 * `script` node's `config.function` resolves at run time (#1870).
 */

export { computeNextTaskDueDate } from './task.functions';

import { computeNextTaskDueDate } from './task.functions';

/** Name → handler map for `defineStack({ functions })`. */
export const todoFunctions = {
  computeNextTaskDueDate,
};
