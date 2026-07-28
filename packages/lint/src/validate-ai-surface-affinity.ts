// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0064 §3] Skill ↔ agent surface affinity (issue #3820).
 *
 * An agent binds a product surface (`'ask'` | `'build'`, ADR-0063 §1) and a
 * skill declares which surface it belongs to (`'ask'` | `'build'` | `'both'`,
 * ADR-0063 §3). A skill may only attach to an agent whose surface it matches —
 * `'both'` attaches to either. The runtime treats a violation as a FAST LOAD
 * ERROR: `resolveActiveSkills()` throws on the first incompatible binding, so
 * an agent shipping one mismatched skill reference fails at **chat time** with
 * a 500 — after parse, after validate, after deploy.
 *
 * Both sides of the check are declared in the same stack, so the contradiction
 * is statically provable and this rule carries severity **error** with zero
 * false positives by construction. Both sides default to `'ask'` when the
 * `surface` field is absent (mirroring the runtime's defaults), so the rule is
 * safe on the raw/normalized config the `lint` path carries as well as the
 * schema-parsed stack.
 *
 * Scope note: this rule deliberately does NOT check that `agent.skills[]`
 * names resolve at all. Kernel skills (`schema_reader`, the `ask`/`build`
 * bundles) are runtime-registered and statically invisible, and whether
 * app-stack tool/skill namespaces get a platform-name registry is an open
 * decision (#3820 D0/D2) — resolving names against `stack.skills` alone would
 * flag every kernel-skill reference. An unresolved name is therefore skipped
 * here; only a reference that resolves in-stack AND contradicts the affinity
 * contract is reported.
 */

export const AI_SKILL_SURFACE_MISMATCH = 'ai-skill-surface-mismatch';

export type AiSurfaceAffinitySeverity = 'error' | 'warning';

export interface AiSurfaceAffinityFinding {
  /** Always `error` — the runtime throws on this binding at chat time. */
  severity: AiSurfaceAffinitySeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `agent "sales_copilot" · skills`. */
  where: string;
  /** Config path, e.g. `agents[0].skills[2]`. */
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

/** The runtime defaults an absent `surface` to `'ask'` on both sides. */
function surfaceOf(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : 'ask';
}

/**
 * Validate every in-stack agent→skill binding against the ADR-0064 §3 surface
 * affinity contract. Returns findings (empty = clean).
 */
export function validateAiSurfaceAffinity(stack: AnyRec): AiSurfaceAffinityFinding[] {
  const findings: AiSurfaceAffinityFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const skillsByName = new Map<string, AnyRec>();
  for (const skill of asArray(stack.skills)) {
    const n = strName(skill.name);
    if (n) skillsByName.set(n, skill);
  }

  const agents = asArray(stack.agents);
  for (let ai = 0; ai < agents.length; ai++) {
    const agent = agents[ai];
    const agentName = strName(agent.name) ?? `#${ai}`;
    const agentSurface = surfaceOf(agent.surface);
    const skillRefs = Array.isArray(agent.skills) ? agent.skills : [];

    for (let si = 0; si < skillRefs.length; si++) {
      const ref = strName(skillRefs[si]);
      if (!ref) continue;
      const skill = skillsByName.get(ref);
      // Unresolved in-stack → runtime-registered kernel skill or another
      // package's — out of this rule's scope (see header; #3820 D0/D2).
      if (!skill) continue;

      const skillSurface = surfaceOf(skill.surface);
      if (skillSurface === 'both' || skillSurface === agentSurface) continue;

      findings.push({
        severity: 'error',
        rule: AI_SKILL_SURFACE_MISMATCH,
        where: `agent "${agentName}" · skills`,
        path: `agents[${ai}].skills[${si}]`,
        message:
          `Agent "${agentName}" (surface: '${agentSurface}') references skill "${ref}" ` +
          `(surface: '${skillSurface}') — incompatible affinity (ADR-0064 §3). The runtime ` +
          `refuses this binding with a load error, so chatting with this agent fails at ` +
          `request time even though the stack parses and validates cleanly.`,
        hint:
          `A skill may only attach to an agent whose surface it matches. Move "${ref}" to a ` +
          `'${skillSurface}'-surface agent, change its \`surface\` to '${agentSurface}', or — ` +
          `only if it is a genuinely shared, read-only capability — declare \`surface: 'both'\`.`,
      });
    }
  }

  return findings;
}
