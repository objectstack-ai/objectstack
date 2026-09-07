// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0063 §2] `stack.agents` is a platform-internal slot (issue #3820).
 *
 * ADR-0063 §2 withdrew tenant/app-package custom agents: the kernel ships
 * exactly two agents (`ask`, `build`), the surface the user is in binds one,
 * and third parties extend the platform by authoring **skills**, never
 * `*.agent.ts`. The `agent` metadata type carries the decision
 * (`allowRuntimeCreate: false, allowOrgOverride: false`), and the runtime
 * enforces it on both paths — `listAgents()` filters non-platform records out
 * of the catalog, and `loadAgent()` refuses them outright (cloud#904), so a
 * stack-authored agent 404s on chat and cannot be pinned via
 * `app.defaultAgent`.
 *
 * What was missing is the AUTHORING-time signal. `defineStack` still accepts
 * an `agents` array, so an app package could declare agents that parse,
 * validate, and build into the artifact — and then do nothing at runtime.
 * HotCRM shipped two of them for months. That is the ADR-0078 shape this rule
 * closes: loud at the producer, tolerant at the consumer (Prime Directive
 * #12).
 *
 * Severity is **warning**, not error, for one reason: the platform's own
 * packages legitimately author agent records, and this rule cannot tell a
 * platform package from an app package by reading the stack alone. A warning
 * that names the runtime consequence is honest for both readers; the runtime
 * is what actually gates. Deliberately NOT a Zod refine — an existing stack
 * must keep parsing (ADR-0078 non-goal #1).
 *
 * ## The value half (issue #6041)
 *
 * The rule above catches a stack that *declares* a withdrawn agent record.
 * It never looked at `app.defaultAgent` — a plain
 * `SnakeCaseIdentifierSchema` string, so any snake_case value parses, builds,
 * and passes `os:check` even when it names nothing the runtime will ever
 * resolve. #5985 measured the blind spot directly: replaying the bad example
 * `defaultAgent: 'sales_copilot'` left `check:skill-examples` at 208 green,
 * EXIT=0. `app.defaultAgent` silently falls back to the platform default at
 * runtime (ADR-0063 §1) instead of crashing, which is why this limb is
 * **warning**, not error, same as the rule above — the maintainer ruling on
 * #6041 (2026-08-07, reaffirmed 2026-08-09) is option A: add the value check
 * at warning tier, reusing `PLATFORM_AGENT_NAMES` rather than narrowing the
 * schema to an enum (a breaking authoring change ADR-0063 already walked
 * back once).
 *
 * ## Why the value limb no longer reads the same roster (issue #14461)
 *
 * `PLATFORM_AGENT_NAMES` holds FOUR names, and reusing it for the value limb
 * meant this gate accepted `defaultAgent: 'metadata_assistant'` — the exact
 * spelling `skills/objectstack-ai` tells authors is "not vocabulary". The
 * platform then taught it from its own only live example: `studio.app.ts`
 * pinned the alias. So an AI author copying the one working example in the
 * repo wrote the forbidden spelling and this rule waved it through — the
 * silent-tolerance shape ADR-0078 exists to close, committed by the gate
 * itself.
 *
 * The maintainer ruling on #14461 (2026-09-03) re-pins Studio to `build` and
 * SPLITS the two limbs' rosters, keeping both of #6041's operative decisions
 * intact (warning tier, no Zod enum):
 *
 *  - the DECLARATION limb still reads all four names. Its question is "does
 *    this record shadow a platform record?", and declaring `metadata_assistant`
 *    shadows `build` through the alias exactly as declaring `build` does. That
 *    judgement is unchanged.
 *  - the VALUE limb reads `CANONICAL_AGENT_NAMES` only, and a legacy alias
 *    gets its own rule id and wording ({@link DEFAULT_AGENT_LEGACY_ALIAS}).
 *    Its question is "is this the right thing to WRITE?", and the answer for
 *    an alias is no even though it resolves.
 *
 * The alias limb stays `warning`, not `error`, and for a sharper reason than
 * the roster limb: an aliased pin is not broken. It resolves, the app gets the
 * agent it meant, and nothing a user can see is wrong — which is precisely why
 * the signal has to be an authoring-time nudge rather than a build break.
 */

import { recordsOf } from './object-graph.js';

export const AGENT_AUTHORING_WITHDRAWN = 'agent-authoring-withdrawn';

/** `app.defaultAgent` names something outside the platform agent roster. */
export const DEFAULT_AGENT_OUTSIDE_ROSTER = 'default-agent-outside-roster';

/** `app.defaultAgent` spells a platform agent by its RETIRED alias (#14461). */
export const DEFAULT_AGENT_LEGACY_ALIAS = 'default-agent-legacy-alias';

export type AiAgentAuthoringSeverity = 'error' | 'warning';

export interface AiAgentAuthoringFinding {
  /** Always `warning` — the runtime is the gate; this is the authoring-time signal. */
  severity: AiAgentAuthoringSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `agent "sales_copilot"`. */
  where: string;
  /** Config path, e.g. `agents[0]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The two platform agent ids — the only two names that are AUTHORING
 * vocabulary (ADR-0063 §1). This is the roster the `app.defaultAgent` value
 * limb judges against.
 */
const CANONICAL_AGENT_NAMES: readonly string[] = ['ask', 'build'];

/**
 * Retired spellings → the canonical id each resolves to (`data_chat` → `ask`,
 * `metadata_assistant` → `build`), registered one-way in the cloud alias
 * registry at plugin init — ADR-0063 §2. Resolution-only: they are not
 * separate records, and the agent catalog shows each agent once under its
 * canonical name. Kept resolvable for old bookmarks and persisted `agent_id`s;
 * never for new authoring (#14461).
 */
const LEGACY_AGENT_ALIASES = new Map<string, string>([
  ['data_chat', 'ask'],
  ['metadata_assistant', 'build'],
]);

/**
 * Every name that refers to a platform agent, canonically or through its
 * alias. A stack that re-declares any of these four is doing something
 * different from inventing a custom persona (it is shadowing a platform
 * record, directly or through its alias), so it gets its own wording.
 *
 * Deliberately NOT the roster the value limb reads — see the docblock's
 * "#14461" section for why the two questions take different tables.
 */
const PLATFORM_AGENT_NAMES = new Set<string>([
  ...CANONICAL_AGENT_NAMES,
  ...LEGACY_AGENT_ALIASES.keys(),
]);

/**
 * Flag every agent declared in a stack. Returns findings (empty = clean,
 * which is what every app package should be).
 */
export function validateAiAgentAuthoring(stack: AnyRec): AiAgentAuthoringFinding[] {
  const findings: AiAgentAuthoringFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const agents = recordsOf(stack.agents);
  for (let ai = 0; ai < agents.length; ai++) {
    const agent = agents[ai];
    const name = strName(agent.name) ?? `#${ai}`;
    const isPlatformName = PLATFORM_AGENT_NAMES.has(name);
    const skillCount = Array.isArray(agent.skills) ? agent.skills.length : 0;

    findings.push({
      severity: 'warning',
      rule: AGENT_AUTHORING_WITHDRAWN,
      where: `agent "${name}"`,
      path: `agents[${ai}]`,
      message: isPlatformName
        ? `This stack declares an agent named "${name}", which is a PLATFORM agent id. The ` +
          `runtime serves its own record for that name and ignores this one — the declaration ` +
          `has no effect and will drift from the platform's definition.`
        : `This stack declares the agent "${name}", but tenant/app-package agents were withdrawn ` +
          `(ADR-0063 §2): the kernel ships exactly two agents (\`ask\`, \`build\`) and the surface ` +
          `the user is in binds one. The runtime filters this record out of the agent catalog and ` +
          `refuses to load it, so it never runs — it parses, validates, and ships as inert ` +
          `metadata.`,
      hint: isPlatformName
        ? `Remove the declaration; the platform owns "${name}". Extend it with skills instead.`
        : `Delete the agent and express its capability as skills. Everything an agent carried ` +
          `that a skill does not is persona text: move the useful parts of \`instructions\` into ` +
          `the skills' own instructions.` +
          (skillCount > 0
            ? ` The ${skillCount} skill${skillCount === 1 ? '' : 's'} this agent references ` +
              `already carry the capability — they attach to the platform agent by \`surface\` ` +
              `affinity, so nothing is lost by dropping the persona.`
            : ``),
    });
  }

  const roster = CANONICAL_AGENT_NAMES.join(', ');
  const apps = recordsOf(stack.apps);
  for (let appIdx = 0; appIdx < apps.length; appIdx++) {
    const app = apps[appIdx];
    const defaultAgent = strName(app.defaultAgent);
    if (!defaultAgent || CANONICAL_AGENT_NAMES.includes(defaultAgent)) continue;

    const appName = strName(app.name) ?? `#${appIdx}`;
    const canonical = LEGACY_AGENT_ALIASES.get(defaultAgent);

    // [#14461] Two different defects share this slot, and collapsing them
    // would misdescribe both: an alias RESOLVES (the app gets the agent it
    // meant) and an unknown name does NOT (the pin is inert). Separate rule
    // ids so a consumer can act on them separately.
    if (canonical) {
      findings.push({
        severity: 'warning',
        rule: DEFAULT_AGENT_LEGACY_ALIAS,
        where: `app "${appName}".defaultAgent`,
        path: `apps[${appIdx}].defaultAgent`,
        message:
          `app "${appName}" pins \`defaultAgent\` to "${defaultAgent}", the RETIRED alias of the ` +
          `platform agent "${canonical}". It still resolves — the alias registry maps legacy ` +
          `names to canonical ones for old bookmarks and persisted \`agent_id\`s (ADR-0063 §2) — ` +
          `so nothing is broken at runtime; what is wrong is the spelling in the artifact. It is ` +
          `also the weaker pin: resolution depends on the owning package's in-process alias ` +
          `registration having run, which the canonical id does not.`,
        hint:
          `Write \`defaultAgent: '${canonical}'\`. The aliases are back-compat resolution, not ` +
          `authoring vocabulary — always author the canonical id (${roster}).`,
      });
      continue;
    }

    findings.push({
      severity: 'warning',
      rule: DEFAULT_AGENT_OUTSIDE_ROSTER,
      where: `app "${appName}".defaultAgent`,
      path: `apps[${appIdx}].defaultAgent`,
      message:
        `app "${appName}" pins \`defaultAgent\` to "${defaultAgent}", which is not a platform ` +
        `agent (${roster}). The kernel ships exactly two agents (ADR-0063 §2) and resolves this ` +
        `key against them and their legacy aliases only — an unrecognized name is not rejected, ` +
        `it silently falls back to the platform default at runtime, so the pin has no effect and ` +
        `the value drifts from what actually serves the app.`,
      hint:
        `Set \`defaultAgent\` to one of the platform agent names: ${roster}. If the goal is a ` +
        `dedicated persona or capability, express it as skills instead — they attach to "ask" ` +
        `/ "build" by surface affinity, not as a custom \`defaultAgent\` value.`,
    });
  }

  return findings;
}
