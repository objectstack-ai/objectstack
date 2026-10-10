// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-bound-variable-name
 *
 * **The `$` names are the flow engine's at EVERY binding door** (#22502,
 * #22572).
 *
 * A flow names the variables it binds in eight places, and this module governs
 * all of them ({@link FLOW_BINDING_KEYS}):
 *
 *  - a node's `outputVariable` (`get_record`, `create_record`, `map`,
 *    `script`, `subflow`) and a `try_catch` node's `errorVariable` (#22502);
 *  - a `loop` or `map` node's `iteratorVariable` and `indexVariable`, which
 *    bind the current item and its index in the enclosing scope;
 *  - an object-form `screen` node's `idVariable`, and a `screen` field's
 *    `name` — the resume that submits the screen writes the saved record's id,
 *    and each field's value, under those names;
 *  - a declared flow variable's `name` (`FlowSchema.variables[].name`);
 *  - an `assignment` node's targets, in the three shapes its executor reads
 *    ({@link flowAssignmentTargets}).
 *
 * Each took any string, so a flow could bind `$row` — and then not read it: a
 * text slot refuses a `{{ }}` hole whose root is a `$` name the engine does not
 * bind (`flow-text-slot-template.ts`, #22477), and its remedy is to drop the
 * `$`. One contract's two doors disagreed about whether an author may own a `$`
 * name. Measured on the run, it was worse than unreadable: a `$` binding over
 * one of the engine's own names replaces it for the rest of the run
 * (`iteratorVariable: '$record'` leaves the trigger record holding the last
 * item, `indexVariable: '$runId'` the run id holding an index), a declared
 * `$record` is overwritten by the engine at run start, and a `screen` whose
 * `idVariable` or field is a `$` name can never be submitted — the resume that
 * carries it is refused (`INVALID_SIGNAL`).
 *
 * They agree now, on the rule that judge already reads: the `$` names are
 * reserved for the engine (a resume signal may not write one either —
 * `IAutomationService.resume`'s `INVALID_SIGNAL`). So a binding refuses a name
 * that starts with `$`, and its remedy is the same name without the `$`, read
 * as `{{ name }}`. The one `$` name an author may write is the one the engine
 * itself binds there: `errorVariable: '$error'`, the key's default — the
 * caught error the engine publishes as `$error` either way.
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
 * (`shared/refinement-projection.ts`). A key composes it as its string schema
 * (`pattern`); the canonical `assignments` map composes it as its KEY schema
 * (`propertyNames.pattern`). Each executor parses its config against the same
 * contract (`parseNodeConfig`), so `FlowSchema.parse`,
 * `AutomationEngine.registerFlow`, `objectstack validate` and the run itself
 * all refuse such a name through `flowNodeConfigRefusals`, anchored at the key.
 *
 * Two positions are not a key of a contract a door applies, and are judged by
 * {@link flowBoundVariableNameRefusal} instead — the same rule, the same
 * sentence: an `assignment` node's targets (no executor contract parses its
 * config, so `FlowSchema` walks {@link flowAssignmentTargets}), and the bare
 * legacy `assignment` config's top-level keys inside `AssignmentConfigSchema`
 * itself, where no key schema reaches (a `.catchall()` sees values only).
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

/**
 * Each binding position this module governs, and the clause its refusal says
 * about it. `errorVariable` alone admits a `$` name (`$error`), so its clause
 * is written in {@link boundVariableNameRefusal}.
 */
const BINDING_CLAUSES = {
  outputVariable: 'an `outputVariable` may not bind one',
  errorVariable: '',
  iteratorVariable: 'a `loop` or `map` `iteratorVariable` may not bind one',
  indexVariable: 'a `loop` or `map` `indexVariable` may not bind one',
  idVariable:
    'an object-form `screen` `idVariable` may not bind one (the resume that submits the screen could not write it)',
  variableName: 'a flow may not declare a variable under one',
  screenFieldName:
    'a `screen` field, whose value binds to a variable of its `name`, may not be named with one (the resume that '
    + 'submits the screen could not write it)',
  assignmentTarget: 'an `assignment` node may not set one',
} as const;

/** The binding positions this module governs — a key, or a position that names a variable. */
export type FlowBindingKey = keyof typeof BINDING_CLAUSES;

/**
 * Every binding position, in a fixed order — the vocabulary the enumeration
 * pin (`flow-bound-variable-name.test.ts`) holds equal to the sites it judges.
 */
export const FLOW_BINDING_KEYS: readonly FlowBindingKey[] = Object.keys(BINDING_CLAUSES) as FlowBindingKey[];

/**
 * Any string whose first character is not `$` — the empty string included,
 * which every executor reads as "no binding". `[\s\S]` rather than `.` so a
 * name carrying a line break is judged on its first character too.
 */
const NOT_DOLLAR_LED = '[^$][\\s\\S]*';

/** Why a `$`-led name is refused at a binding position, with its remedy. */
function boundVariableNameRefusal(key: FlowBindingKey, name: string): string {
  const bare = name.replace(/^\$+/, '');
  const read = key === 'errorVariable' ? `${bare}.message` : bare;
  const lead =
    `\`${name}\` is a \`$\` name, and the \`$\` names are reserved for the flow engine's own variables (a resume `
    + 'signal may not write one either), so ';
  const rule = key === 'errorVariable'
    ? `a \`try_catch\` \`errorVariable\` may name only the engine's own \`${ENGINE_ERROR_VARIABLE}\`, its default, `
      + 'and a flow text slot refuses to read any other `$` name. '
    : `${BINDING_CLAUSES[key]}, and a flow text slot refuses to read it. `;
  const remedy = bare === ''
    ? 'Name the variable without the `$` and read it as a `{{ }}` hole over that name'
    : `Name it \`${bare}\` and read it as \`{{ ${read} }}\``;
  const keepDefault = key === 'errorVariable'
    ? `, or delete \`errorVariable\` and read the default \`{{ ${ENGINE_ERROR_VARIABLE}.message }}\`.`
    : '.';
  return lead + rule + remedy + keepDefault;
}

/**
 * The string schema of a binding position: a name that does not start with
 * `$`, and for `errorVariable` the engine's own `$error` as well. The caller
 * adds `.min(1)`, `.optional()` or `.default(…)` and its `.describe()`.
 */
export function flowBoundVariableNameSchema(key: FlowBindingKey) {
  const engineOwn = key === 'errorVariable' ? `${ENGINE_ERROR_VARIABLE.replace('$', '\\$')}|` : '';
  return z.string().regex(new RegExp(`^(?:${engineOwn}${NOT_DOLLAR_LED})?$`), {
    error: (issue) => boundVariableNameRefusal(key, String(issue.input)),
  });
}

const RULE_BY_KEY = new Map<FlowBindingKey, ReturnType<typeof flowBoundVariableNameSchema>>();

/**
 * The rule's refusal of `name` at `key` — the very sentence the key's schema
 * gives — or `undefined` when the rule admits it. For the positions no key
 * schema reaches (see the module docblock).
 */
export function flowBoundVariableNameRefusal(key: FlowBindingKey, name: string): string | undefined {
  let rule = RULE_BY_KEY.get(key);
  if (rule === undefined) {
    rule = flowBoundVariableNameSchema(key);
    RULE_BY_KEY.set(key, rule);
  }
  const result = rule.safeParse(name);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/** One variable an `assignment` node binds, at the config path the author wrote it. */
export interface FlowAssignmentTarget {
  /** The path under the node's `config`: `['assignments', 'total']`, `['assignments', 0, 'variable']`, `['total']`. */
  readonly path: readonly (string | number)[];
  /** The variable name the executor binds. */
  readonly name: string;
}

/**
 * Every variable an `assignment` node's `config` binds, in the three shapes its
 * executor reads (`service-automation` `builtin/logic-nodes.ts`), and only
 * those — a key the executor never binds is no binding:
 *
 *  - `assignments` an array — the legacy `[{ variable, value }]` form: each
 *    item's first non-null `variable`, `name` or `key`, when it is a non-empty
 *    string;
 *  - `assignments` any other object — the canonical map: each own key;
 *  - otherwise (no `assignments`, or a value that is neither) — the bare legacy
 *    config: each top-level key.
 */
export function flowAssignmentTargets(config: unknown): FlowAssignmentTarget[] {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return [];
  const raw = (config as Record<string, unknown>).assignments;
  const out: FlowAssignmentTarget[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((item: unknown, index) => {
      if (item === null || typeof item !== 'object') return;
      const entry = item as Record<string, unknown>;
      const key = (['variable', 'name', 'key'] as const).find((k) => entry[k] !== undefined && entry[k] !== null);
      const name = key === undefined ? undefined : entry[key];
      if (key !== undefined && typeof name === 'string' && name !== '') out.push({ path: ['assignments', index, key], name });
    });
    return out;
  }
  if (raw !== null && typeof raw === 'object') {
    for (const name of Object.keys(raw)) out.push({ path: ['assignments', name], name });
    return out;
  }
  for (const name of Object.keys(config)) out.push({ path: [name], name });
  return out;
}
