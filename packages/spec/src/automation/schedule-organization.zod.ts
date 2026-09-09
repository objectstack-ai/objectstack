// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * The ACTING ORGANIZATION of a time-triggered flow — the one start-node key
 * that says which organization a scheduled run executes as.
 *
 * ## Why the key exists
 *
 * A record-change flow inherits its organization from the write that fired it:
 * the triggering session's `tenantId` rides the {@link AutomationContext} into
 * the run, so every tenant-scoped write below it — `sys_inbox_message`,
 * `sys_notification_delivery`, `sys_automation_run` — resolves an organization
 * the way a session write does. A TIME-triggered flow has no such session. The
 * schedule trigger and the time-relative sweep launch their runs from a job
 * tick, and a job tick carries no identity at all, so the run reached the
 * tenancy guard (`system-write-organization.ts`) with nothing to offer it. On
 * an install holding more than one `sys_organization` that guard refuses,
 * correctly and by design — and the refusal landed on rows the run never
 * reported: the notification wrote with `organization_id = NULL`, every
 * tenant-scoped row beneath it was refused, and the tick still summarised
 * itself as healthy.
 *
 * ## The ruling this key implements
 *
 * Maintainer, 2026-09-08, verbatim:
 *
 * > 多组织定时任务本来只能在组织内运行，应该带组织ID，不允许跨组织的定时任务。
 *
 * A time-triggered flow is **organization-scoped by construction**: it names
 * one organization and the run executes as that organization. There is
 * deliberately no fan-out — a tenant that wants the same sweep in N
 * organizations declares it N times — and there is deliberately no fallback: a
 * flow that names none is a DECLARATION ERROR, not a run that quietly picks
 * one. Guessing is the failure this key exists to prevent, and the platform
 * organization is not a safe guess: a wrong `organization_id` is worse than a
 * null, because a null is visibly missing while a wrong value is silently
 * authoritative to every report, export and cleanup script that filters by
 * organization.
 *
 * ## Where it lives, and why there
 *
 * On the flow's START node `config`, beside the cadence it scopes:
 *
 * ```ts
 * config: {
 *   schedule: { type: 'cron', expression: '0 8 * * *' },
 *   organization: 'org_msokm9oaz0cal87q',
 * }
 * ```
 *
 * The start node is where every other trigger-binding fact already lives —
 * `FlowSchema` refuses a top-level `schedule` in as many words ("a schedule
 * flow declares its cron/interval as `config.schedule` on the START node, not
 * at the flow top level"), and `resolveTriggerBinding` hands the whole start
 * `config` to the trigger. Putting the organization at the flow top level would
 * split one binding across two layers; putting it inside the `schedule`
 * descriptor would make it invisible to the time-relative sweep, which carries
 * its cadence in the same slot but binds through a different descriptor. One
 * key, one layer, both time triggers.
 */

/** The start-node `config` key naming a time-triggered flow's acting organization. */
export const SCHEDULE_ORGANIZATION_KEY = 'organization';

/**
 * The value shape: an organization id — `sys_organization.id`, the same string
 * a session write carries as `ExecutionContext.tenantId` and the same string
 * the tenancy guard stamps onto `organization_id`.
 *
 * A bare non-empty string rather than a pattern: organization ids are minted at
 * runtime (`org_…` today) and a deployment that has migrated ids from elsewhere
 * must not be refused by a shape this layer invented. What is checked is that a
 * value was DECLARED — which is the whole of what the ruling asks for.
 */
export const ScheduleOrganizationSchema = z
  .string()
  .min(1)
  .describe(
    'Organization id (sys_organization.id) this scheduled/time-relative flow runs as. Required: a time-triggered run has no session to inherit a tenant from.',
  );

/**
 * The declared value's type — the alias the machine-readable surface needs
 * beside the schema, and the name a reference page's import example carries.
 *
 * `z.input` per ADR-0122: the bare name is reserved for the AUTHOR state. No
 * `ScheduleOrganizationParsed` sibling exists because the two states are the
 * same type here — the schema neither transforms nor defaults, it only refuses
 * what cannot be acted on.
 */
export type ScheduleOrganization = z.input<typeof ScheduleOrganizationSchema>;

/**
 * Spellings an author reaches for that are NOT this key, in the order a
 * diagnostic should try them. The start node's `config` is an OPEN record by
 * design (ADR-0018), so none of these is refused by any schema — a flow
 * carrying `organizationId` parses, binds, and runs with no organization at
 * all. Naming them in the refusal is the only place the mistake becomes
 * visible, so this list is load-bearing rather than decorative.
 *
 * Module-local on purpose: its only reader is
 * {@link findScheduleOrganizationNearMissInConfig} in this file, and an export
 * whose consumers all live inside its own package does not belong on a
 * published barrel. A caller that needs the vocabulary needs the ANSWER, which
 * that function gives.
 */
const SCHEDULE_ORGANIZATION_NEAR_MISSES: readonly string[] = Object.freeze([
  'organizationId',
  'organization_id',
  'organizationID',
  'orgId',
  'org_id',
  'org',
  'tenantId',
  'tenant_id',
  'tenant',
]);

/** The start node's `config`, or `{}` for a flow shaped like anything else. */
function startConfigOf(flow: unknown): Record<string, unknown> {
  if (!flow || typeof flow !== 'object') return {};
  const nodes = (flow as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return {};
  const start = nodes.find(
    (n): n is { config?: unknown } =>
      !!n && typeof n === 'object' && (n as { type?: unknown }).type === 'start',
  );
  return start?.config && typeof start.config === 'object'
    ? (start.config as Record<string, unknown>)
    : {};
}

/**
 * The acting organization a flow declares, or `undefined`.
 *
 * Structural, like {@link resolveFlowTriggerKind}: it reads a raw authored
 * object, a `defineFlow` result and a parsed stack's flow alike, and answers
 * `undefined` for anything else rather than throwing. A present-but-unusable
 * value (empty string, a number, an object) answers `undefined` too — the
 * caller's next step is the refusal either way, and reporting "declared" for a
 * value nothing can act on is the silent-acceptance this key exists to end.
 */
export function resolveScheduleOrganization(flow: unknown): string | undefined {
  const raw = startConfigOf(flow)[SCHEDULE_ORGANIZATION_KEY];
  const parsed = ScheduleOrganizationSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The near-miss key an organization-less START NODE `config` actually wrote, if
 * any — so the refusal can say "you wrote `organizationId`" instead of "you
 * wrote nothing".
 *
 * ⛔ Takes the start node's `config` record, NOT a flow — hence the name. The
 * caller that needs this is a TRIGGER, and a trigger never holds the flow: the
 * engine parses the start node and hands it a binding whose `config` is that
 * record. A flow-shaped overload would answer `undefined` for the very input
 * the only caller has, which is the silent-acceptance this module exists to
 * end, so the argument it wants is the one the name asks for.
 *
 * Anything that is not a record answers `undefined` rather than throwing,
 * matching {@link resolveScheduleOrganization}'s structural posture.
 */
export function findScheduleOrganizationNearMissInConfig(
  startConfig: unknown,
): string | undefined {
  if (!startConfig || typeof startConfig !== 'object') return undefined;
  const config = startConfig as Record<string, unknown>;
  return SCHEDULE_ORGANIZATION_NEAR_MISSES.find(
    (k) => Object.prototype.hasOwnProperty.call(config, k) && config[k] != null && config[k] !== '',
  );
}

/**
 * The one refusal sentence, so the schedule trigger and the time-relative
 * trigger say the same thing about the same defect.
 *
 * ⛔ `FlowSchema` does NOT emit it, and deliberately does not: the start node's
 * `config` is an open record (ADR-0018) and every flow this repo's own packages
 * ship would become unparseable if the key were required at parse time.
 * Enforcement is at BIND — the two triggers below — which is where the
 * consequence lives: there is no path by which an organization-less
 * time-triggered run reaches the data layer once bind refuses.
 *
 * It names the flow (the ruling requires that), the key, where the key goes,
 * and — when the author wrote a near-miss — which spelling of theirs was
 * dropped. It states the consequence rather than only the rule, because the
 * consequence is the part an operator has already seen: this is the flow whose
 * tick delivered nothing.
 */
export function describeMissingScheduleOrganization(
  flowName: string,
  options?: { readonly kind?: string; readonly nearMiss?: string },
): string {
  const kind = options?.kind === 'time_relative' ? 'time-relative' : 'scheduled';
  const nearMiss = options?.nearMiss;
  return (
    `${kind} flow '${flowName}' declares no acting organization: its start node's \`config\` is ` +
    `missing the \`${SCHEDULE_ORGANIZATION_KEY}\` key` +
    (nearMiss
      ? ` (it carries \`${nearMiss}\`, which is not this key — the start node's \`config\` is an open ` +
        `record, so that spelling was accepted and then ignored)`
      : '') +
    `. A time-triggered run has no session to inherit a tenant from, so without this key the run ` +
    `executes with no organization: on an install holding more than one \`sys_organization\` every ` +
    `tenant-scoped write beneath it is refused — the inbox rows a \`notify\` node emits and the ` +
    `\`sys_automation_run\` history row — while the tick still reports itself healthy. ` +
    `Declare the organization the sweep runs in: \`config: { ${SCHEDULE_ORGANIZATION_KEY}: '<sys_organization.id>' }\`. ` +
    `A sweep wanted in several organizations is declared once per organization — ` +
    `a single flow is never fanned out across them, and no organization is ever chosen for it.`
  );
}
