// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-bound-variable-name
 *
 * **The `$` names are the flow engine's at the BINDING doors too** (#22502).
 *
 * A flow names a variable it binds in two config keys this module governs: a
 * node's `outputVariable` (`get_record`, `create_record`, `map`, `script`,
 * `subflow`) and a `try_catch` node's `errorVariable`. Both took any string,
 * so a flow could bind `$caught` — and then not read it: a text slot refuses a
 * `{{ }}` hole whose root is a `$` name the engine does not bind
 * (`flow-text-slot-template.ts`, #22477), and its remedy is to drop the `$`.
 * One contract's two doors disagreed about whether an author may own a `$`
 * name.
 *
 * They agree now, on the rule that judge already reads: the `$` names are
 * reserved for the engine (a resume signal may not write one either —
 * `IAutomationService.resume`'s `INVALID_SIGNAL`). So a binding key refuses a
 * name that starts with `$`, and its remedy is the same name without the `$`,
 * read as `{{ name }}`. The one `$` name an author may write is the one the
 * engine itself binds there: `errorVariable: '$error'`, the key's default —
 * the caught error the engine publishes as `$error` either way.
 *
 * ## The prefix rule, not a second list
 *
 * The text-slot judge reads the engine's closed list of `$` variables
 * (`FLOW_ENGINE_VARIABLES`) because a READ must name a variable that exists.
 * A BINDING must not claim a name in the engine's namespace at all, whichever
 * of its names that is — `outputVariable: '$record'` would overwrite the trigger
 * record — so this module reads only the prefix the list implies, and never a
 * copy of the list.
 *
 * ## A pattern, so the published JSON Schema states it
 *
 * The rule is a `regex` check, not a `.refine()`: `z.toJSONSchema()` emits a
 * regex as `pattern`, so the published schema refuses exactly what the parse
 * refuses, where a refinement would be dropped from it
 * (`shared/refinement-projection.ts`). Each executor parses its config against
 * the same contract (`parseNodeConfig`), so `FlowSchema.parse`,
 * `AutomationEngine.registerFlow`, `objectstack validate` and the run itself
 * all refuse such a name through `flowNodeConfigRefusals`, anchored at the key.
 *
 * ## ⛔ Package-internal — NOT a public export
 *
 * Deliberately absent from `automation/index.ts`: its callers are the node
 * contracts that compose it, and the rule they publish is the `pattern` on
 * each key.
 */

import { z } from 'zod';

/** The name the engine binds a `try_catch`'s caught error to when `errorVariable` is absent. */
export const ENGINE_ERROR_VARIABLE = '$error';

/** The config keys that bind a flow variable by name, and that this module governs. */
export type FlowBindingKey = 'outputVariable' | 'errorVariable';

/**
 * Any string whose first character is not `$` — the empty string included,
 * which every executor reads as "no binding". `[\s\S]` rather than `.` so a
 * name carrying a line break is judged on its first character too.
 */
const NOT_DOLLAR_LED = '[^$][\\s\\S]*';

/** Why a `$`-led name is refused at a binding key, with its remedy. */
function boundVariableNameRefusal(key: FlowBindingKey, name: string): string {
  const bare = name.replace(/^\$+/, '');
  const read = key === 'errorVariable' ? `${bare}.message` : bare;
  const lead =
    `\`${name}\` is a \`$\` name, and the \`$\` names are reserved for the flow engine's own variables (a resume `
    + 'signal may not write one either), so ';
  const rule = key === 'errorVariable'
    ? `a \`try_catch\` \`errorVariable\` may name only the engine's own \`${ENGINE_ERROR_VARIABLE}\`, its default, `
      + 'and a flow text slot refuses to read any other `$` name. '
    : 'an `outputVariable` may not bind one, and a flow text slot refuses to read it. ';
  const remedy = bare === ''
    ? 'Name the variable without the `$` and read it as a `{{ }}` hole over that name'
    : `Name it \`${bare}\` and read it as \`{{ ${read} }}\``;
  const keepDefault = key === 'errorVariable'
    ? `, or delete \`errorVariable\` and read the default \`{{ ${ENGINE_ERROR_VARIABLE}.message }}\`.`
    : '.';
  return lead + rule + remedy + keepDefault;
}

/**
 * The string schema of a binding key: a name that does not start with `$`,
 * and for `errorVariable` the engine's own `$error` as well. The caller adds
 * `.optional()` or `.default(…)` and its `.describe()`.
 */
export function flowBoundVariableNameSchema(key: FlowBindingKey) {
  const engineOwn = key === 'errorVariable' ? `${ENGINE_ERROR_VARIABLE.replace('$', '\\$')}|` : '';
  return z.string().regex(new RegExp(`^(?:${engineOwn}${NOT_DOLLAR_LED})?$`), {
    error: (issue) => boundVariableNameRefusal(key, String(issue.input)),
  });
}
