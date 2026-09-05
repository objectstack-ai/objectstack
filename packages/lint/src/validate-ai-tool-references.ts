// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0109 / issue #3820 R7] `skill.tools[]` reference integrity — the tool
 * branch of the AI reference rules.
 *
 * Under ADR-0109's authoring model the DEFAULT third-party path declares no
 * tool records at all: a skill names either a platform-registered tool or an
 * auto-materialised action tool. A `skill.tools[]` entry therefore resolves
 * against, in order:
 *
 *   1. the stack's own `stack.tools[]` names (the optional refinement layer);
 *   2. `PLATFORM_PROVIDED_TOOL_NAMES` — the curated registry of tools the
 *      cloud AI runtime registers at boot (spec owns the list; the owning
 *      cloud packages carry the conformance tests);
 *   3. the materialised `action_<name>` family — one tool per declarative
 *      action (`stack.actions` ∪ every object's `actions`), the mechanism the
 *      built-in `actions_executor` subscribes to with `action_*`.
 *
 * Trailing-wildcard entries (`action_*`, `foo_*`) resolve when ANY member of
 * that universe matches the prefix.
 *
 * Severity is **warning** (ADR-0078 advisory-first ratchet), not error,
 * because the universe has a known blind spot: a runtime plugin outside the
 * registry can legitimately register tools no static analysis can see, and
 * the runtime deliberately tolerates unresolved names (skills may be authored
 * before their tools exist — `skill-registry.ts`). What the warning buys: the
 * HotCRM failure — 10 fictional tools across 6 skills, every one shipping
 * through `validate`/`lint` clean and surfacing as a copilot that claims
 * abilities it does not have — now surfaces at authoring time. On that same
 * corpus the resolution ladder above yields exactly 10 findings and 0 false
 * positives (6 references resolve via the registry).
 */

import { PLATFORM_PROVIDED_TOOL_NAMES, PLATFORM_TOOL_FAMILY_PREFIXES } from '@objectstack/spec/system';

import { suggestName } from './object-graph.js';

export const AI_SKILL_TOOL_UNRESOLVED = 'ai-skill-tool-unresolved';

export type AiToolRefSeverity = 'error' | 'warning';

export interface AiToolRefFinding {
  /** Always `warning` — see the header for why this rule starts advisory. */
  severity: AiToolRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `skill "revenue_forecasting" · tools`. */
  where: string;
  /** Config path, e.g. `skills[3].tools[1]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter((x): x is AnyRec => !!x && typeof x === 'object');
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function suggest(target: string, known: Set<string>): string {
  // The high-frequency near-miss first: naming the raw ACTION where the
  // materialised TOOL (`action_<name>`) is meant. Edit distance cannot catch
  // it (the prefix alone is 7 edits), and it is exactly the mistake the
  // ADR-0109 default path invites from authors who know their action names.
  // Rule-local knowledge (the tool-family prefixes), not the shared helper's
  // business — it stays here and wraps `suggestName` for everything else.
  for (const prefix of PLATFORM_TOOL_FAMILY_PREFIXES) {
    if (known.has(`${prefix}${target}`)) return ` Did you mean "${prefix}${target}"?`;
  }
  return suggestName(target, known);
}

/**
 * Action types with a headless invocation path. `url`/`modal`/`form` are
 * Studio-only UI types — the runtime never materialises a tool for them
 * because there is nothing to call without the UI collecting input first.
 */
const HEADLESS_ACTION_TYPES = new Set(['script', 'api', 'flow']);

/**
 * [#15444] The one row-level `operation` the spec admits (`ActionSchema.
 * operation`, `z.enum(['update'])` — #14092). Deliberately NOT a member of
 * {@link HEADLESS_ACTION_TYPES}: `operation` is not a type, and adding
 * `'update'` there would be the member spelling the ruling rejected. What
 * learns `operation` is the READER below. Spelled locally rather than imported
 * from `@objectstack/runtime`'s `DECLARATIVE_UPDATE_OPERATION`: this package is
 * authoring-time (`spec`, `formula`, `sdui-parser`) and does not depend on the
 * runtime at all — taking that dependency to reach one string would invert the
 * layering. The coupling that matters is behavioural, and it is pinned: the
 * predicate below must keep answering what the runtime's listing door answers.
 */
const DECLARATIVE_UPDATE_OPERATION = 'update';

/**
 * Would the runtime materialise an `action_<name>` tool for this action?
 *
 * Mirrors the STATIC half of the runtime's `actionSkipReason` (ADR-0011
 * opt-in + the headless-path checks). The runtime additionally checks
 * service wiring (is the automation service up?), which is not knowable at
 * authoring time and is deliberately not modelled here — this predicate is
 * about "did the author wire it", not "is the server configured".
 *
 * Getting this wrong in the permissive direction is worse than having no
 * rule: an author who names `action_foo` for a `type:'modal'` action would
 * be told the reference resolves, and would ship a skill whose instructions
 * promise a capability the agent can never call — the exact failure this
 * rule exists to catch.
 */
function materialisesAsTool(action: AnyRec): boolean {
  const ai = action.ai;
  if (!ai || typeof ai !== 'object') return false;
  const aiRec = ai as AnyRec;
  // ADR-0011 — opt-in, and `description` is the LLM-facing contract the
  // spec requires whenever `exposed` is true.
  if (aiRec.exposed !== true) return false;
  if (!strName(aiRec.description)) return false;

  // [#15444] `operation` before `type`, the precedence the runtime door reads
  // (`isDeclarativeUpdateAction` — #15079, ruling #14092). The declarative
  // single-record field write materialises a tool with NEITHER a `target` nor
  // a `body`: `ActionSchema` refuses both beside `operation: 'update'` because
  // the platform action route performs the write. The `script` arm below
  // therefore answers `false` for it — the exact divergence #15079 closed on
  // the runtime side, which lists it — and this rule would then report a
  // resolvable `action_<name>` reference as fictional, and name the action in
  // the near-miss hint as one that "never materialises".
  if (action.operation === DECLARATIVE_UPDATE_OPERATION) return true;
  const type = strName(action.type);
  if (!type || !HEADLESS_ACTION_TYPES.has(type)) return false;
  // `script` can carry either a named handler or an inline body; `api` and
  // `flow` are dispatched by target.
  if (type === 'script') return Boolean(action.target || action.body);
  return Boolean(action.target);
}

/**
 * The full set of tool names resolvable from this stack: declared tool
 * records ∪ the platform registry ∪ the materialised action family.
 */
function collectToolUniverse(stack: AnyRec): Set<string> {
  const universe = new Set<string>(PLATFORM_PROVIDED_TOOL_NAMES);

  for (const tool of asArray(stack.tools)) {
    const n = strName(tool.name);
    if (n) universe.add(n);
  }

  const addActionFamily = (actions: unknown) => {
    for (const action of asArray(actions)) {
      const n = strName(action.name);
      if (n && materialisesAsTool(action)) universe.add(`action_${n}`);
    }
  };
  addActionFamily(stack.actions);
  for (const obj of asArray(stack.objects)) {
    addActionFamily(obj.actions);
  }

  return universe;
}

/**
 * Actions that exist but are NOT AI-exposed, for the near-miss hint: naming
 * `action_foo` when `foo` exists but never materialises is a different
 * mistake from naming something fictional, and deserves a different fix.
 */
function collectUnexposedActionNames(stack: AnyRec): Set<string> {
  const names = new Set<string>();
  const scan = (actions: unknown) => {
    for (const action of asArray(actions)) {
      const n = strName(action.name);
      if (n && !materialisesAsTool(action)) names.add(n);
    }
  };
  scan(stack.actions);
  for (const obj of asArray(stack.objects)) scan(obj.actions);
  return names;
}

/**
 * Validate every `skill.tools[]` reference in a stack. Returns findings
 * (empty = clean).
 */
export function validateAiToolReferences(stack: AnyRec): AiToolRefFinding[] {
  const findings: AiToolRefFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const universe = collectToolUniverse(stack);
  const unexposedActions = collectUnexposedActionNames(stack);

  const resolves = (ref: string): boolean => {
    if (ref.endsWith('*')) {
      const prefix = ref.slice(0, -1);
      for (const name of universe) {
        if (name.startsWith(prefix)) return true;
      }
      return false;
    }
    return universe.has(ref);
  };

  const skills = asArray(stack.skills);
  for (let si = 0; si < skills.length; si++) {
    const skill = skills[si];
    const skillName = strName(skill.name) ?? `#${si}`;
    const refs = Array.isArray(skill.tools) ? skill.tools : [];

    for (let ti = 0; ti < refs.length; ti++) {
      const ref = strName(refs[ti]);
      if (!ref || resolves(ref)) continue;

      const isPattern = ref.endsWith('*');
      // The distinct, high-frequency case: the action EXISTS but never
      // materialises. "Fictional name" and "real action that isn't exposed"
      // need different fixes, so they get different messages.
      const unexposed =
        !isPattern && ref.startsWith('action_') && unexposedActions.has(ref.slice('action_'.length))
          ? ref.slice('action_'.length)
          : undefined;

      findings.push({
        severity: 'warning',
        rule: AI_SKILL_TOOL_UNRESOLVED,
        where: `skill "${skillName}" · tools`,
        path: `skills[${si}].tools[${ti}]`,
        message: isPattern
          ? `Skill "${skillName}" subscribes to tool family "${ref}", which matches nothing this ` +
            `stack can resolve (no declared tool, no platform tool, and no AI-exposed declarative ` +
            `action materialises into it). The subscription contributes zero tools at runtime.`
          : unexposed
            ? `Skill "${skillName}" references tool "${ref}", but the action "${unexposed}" does ` +
              `not become an AI tool: the runtime materialises \`action_<name>\` only for an ` +
              `action that opts in with \`ai.exposed: true\` + \`ai.description\` (ADR-0011) AND ` +
              `has a headless path (type \`script\`/\`api\`/\`flow\` with a target or body — ` +
              `\`url\`/\`modal\`/\`form\` are UI-only). The reference is dropped at runtime, so ` +
              `the skill promises a capability the agent cannot call.`
            : `Skill "${skillName}" references tool "${ref}", which resolves to nothing this stack ` +
              `can see: not a \`stack.tools\` record, not a platform-registered tool, and not a ` +
              `materialised action tool (\`action_<name>\`). The runtime silently drops the ` +
              `reference, so the skill's instructions claim a capability the agent does not have — ` +
              `the assistant will improvise or fail when asked to use it.` +
              suggest(ref, universe),
        hint: unexposed
          ? `Either opt "${unexposed}" in — set \`ai: { exposed: true, description: '…' }\` (≥40 ` +
            `chars, LLM-facing) and give it a headless type — or drop the reference and have the ` +
            `skill's instructions recommend the UI action instead. A \`modal\`/\`form\`/\`url\` ` +
            `action stays human-driven by design; that is a legitimate answer, not a gap.`
          : `Back "${ref}" with a real executable: declare a declarative action (or flow), opt it ` +
            `in with \`ai.exposed: true\` + \`ai.description\`, and reference its materialised ` +
            `tool (\`action_<name>\` — the ADR-0109 default path, no tool record needed); or ` +
            `reference a platform tool by its registered name; or remove the reference and the ` +
            `instructions that mention it. Ignore this only if a runtime plugin outside the ` +
            `platform registry provides "${ref}". Family prefixes materialised by the runtime: ` +
            `${PLATFORM_TOOL_FAMILY_PREFIXES.join(', ')}.`,
      });
    }
  }

  return findings;
}
