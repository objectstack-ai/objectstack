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

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function suggest(target: string, known: Set<string>): string {
  // The high-frequency near-miss first: naming the raw ACTION where the
  // materialised TOOL (`action_<name>`) is meant. Edit distance cannot catch
  // it (the prefix alone is 7 edits), and it is exactly the mistake the
  // ADR-0109 default path invites from authors who know their action names.
  for (const prefix of PLATFORM_TOOL_FAMILY_PREFIXES) {
    if (known.has(`${prefix}${target}`)) return ` Did you mean "${prefix}${target}"?`;
  }

  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const d = distance(target, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  const limit = Math.max(2, Math.floor(target.length / 3));
  return best && bestScore <= limit ? ` Did you mean "${best}"?` : '';
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
      if (n) universe.add(`action_${n}`);
    }
  };
  addActionFamily(stack.actions);
  for (const obj of asArray(stack.objects)) {
    addActionFamily(obj.actions);
  }

  return universe;
}

/**
 * Validate every `skill.tools[]` reference in a stack. Returns findings
 * (empty = clean).
 */
export function validateAiToolReferences(stack: AnyRec): AiToolRefFinding[] {
  const findings: AiToolRefFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const universe = collectToolUniverse(stack);

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
      findings.push({
        severity: 'warning',
        rule: AI_SKILL_TOOL_UNRESOLVED,
        where: `skill "${skillName}" · tools`,
        path: `skills[${si}].tools[${ti}]`,
        message: isPattern
          ? `Skill "${skillName}" subscribes to tool family "${ref}", which matches nothing this ` +
            `stack can resolve (no declared tool, no platform tool, and no declarative action ` +
            `materialises into it). The subscription contributes zero tools at runtime.`
          : `Skill "${skillName}" references tool "${ref}", which resolves to nothing this stack ` +
            `can see: not a \`stack.tools\` record, not a platform-registered tool, and not a ` +
            `materialised action tool (\`action_<name>\`). The runtime silently drops the ` +
            `reference, so the skill's instructions claim a capability the agent does not have — ` +
            `the assistant will improvise or fail when asked to use it.` +
            suggest(ref, universe),
        hint:
          `Back "${ref}" with a real executable: declare a declarative action (or flow) and ` +
          `reference its materialised tool (\`action_<name>\` — the ADR-0109 default path, no ` +
          `tool record needed), reference a platform tool by its registered name, or remove the ` +
          `reference and the instructions that mention it. Ignore this only if a runtime plugin ` +
          `outside the platform registry provides "${ref}". Family prefixes materialised by the ` +
          `runtime: ${PLATFORM_TOOL_FAMILY_PREFIXES.join(', ')}.`,
      });
    }
  }

  return findings;
}
