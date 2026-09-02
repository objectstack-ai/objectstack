// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which platform trigger a flow ASKS FOR, derived from its declaration alone.
 *
 * This is the authoring-time mirror of the automation engine's binding
 * resolution (`AutomationEngine.resolveTriggerBinding` in
 * `@objectstack/service-automation`): the same start-node reads, in the same
 * precedence order, answering only the KIND — which registered trigger the
 * engine would hand the flow to — never the binding itself. The convention it
 * reads is the one the engine reads: a flow's start node carries the trigger
 * details in its `config` (`{ objectName, triggerType, condition }` for
 * record-change, a `schedule` descriptor for time-based flows, a `timeRelative`
 * descriptor for the declarative date sweep), and the flow's top-level `type`
 * names the `schedule` / `api` flows that carry no such config.
 *
 * Two authoring surfaces consume it, so they cannot drift apart on the one
 * question "does this flow auto-launch?":
 *
 *   - `defineStack` refuses a stack whose flow resolves to a kind while
 *     `requires` omits `'triggers'` — the single token that installs every one
 *     of these triggers (`PLATFORM_CAPABILITY_PROVIDERS.triggers`). Without it
 *     the flow registers, validates, builds, and never fires.
 *   - `@objectstack/lint`'s `validate-flow-trigger-readiness` reads it as the
 *     auto-triggered predicate behind its draft-status rule.
 *
 * Precedence is the engine's, and it decides the NAME a diagnostic prints: a
 * start node carrying BOTH a `timeRelative` descriptor and a `schedule` cadence
 * is a time-relative sweep (the cadence is its sweep interval), not a plain
 * schedule flow.
 *
 * One deliberate difference from the engine: the ARRAY form of `triggerType`
 * (`['record-after-create', 'record-after-delete']`) resolves to no kind here.
 * Multi-event unions are unsupported (#3457); the engine routes that shape to
 * the record-change trigger ONLY so the trigger can refuse it loudly at bind
 * time — a diagnostic route, not a trigger the flow could ever fire on — and
 * `@objectstack/lint` already reports the shape itself as an `error`
 * (`flow-trigger-unknown-event`). Reading it as "asks for a record-change
 * trigger" here would have `defineStack` demand a capability for a flow that
 * cannot use it, and would widen the lint rule's auto-triggered set.
 */
export type FlowTriggerKind = 'record_change' | 'time_relative' | 'schedule' | 'api';

/** Every kind {@link resolveFlowTriggerKind} can answer, in the engine's precedence order. */
export const FLOW_TRIGGER_KINDS: readonly FlowTriggerKind[] = Object.freeze([
  'record_change',
  'time_relative',
  'schedule',
  'api',
]);

/**
 * Resolve the trigger kind a flow declares, or `undefined` for a flow with no
 * auto-launch trigger (a `screen` flow, or an `autolaunched` one started by
 * hand or from a screen).
 *
 * Reads the flow structurally — `type` and the first `start` node's `config` —
 * so it accepts a raw authored object, a `defineFlow` result and a parsed
 * stack's flow alike; anything that is not that shape resolves to `undefined`
 * rather than throwing.
 */
export function resolveFlowTriggerKind(flow: unknown): FlowTriggerKind | undefined {
  if (!flow || typeof flow !== 'object') return undefined;
  const f = flow as { type?: unknown; nodes?: unknown };
  const nodes = Array.isArray(f.nodes) ? (f.nodes as unknown[]) : [];
  const start = nodes.find(
    (n): n is { config?: unknown } =>
      !!n && typeof n === 'object' && (n as { type?: unknown }).type === 'start',
  );
  const config: Record<string, unknown> =
    start?.config && typeof start.config === 'object' ? (start.config as Record<string, unknown>) : {};
  const triggerType = typeof config.triggerType === 'string' ? config.triggerType : undefined;

  if (triggerType !== undefined && triggerType.startsWith('record-')) return 'record_change';
  // Before `schedule`: a time-relative sweep ALSO carries a `schedule` cadence
  // (its sweep interval). Arrays and `Date` pass `typeof … === 'object'` on
  // purpose — the engine routes them, and `TimeRelativeTriggerSchema` is the
  // one that refuses them, which is where that verdict belongs.
  if (config.timeRelative != null && typeof config.timeRelative === 'object') return 'time_relative';
  if (config.schedule != null || f.type === 'schedule') return 'schedule';
  if (f.type === 'api' || triggerType === 'api') return 'api';
  return undefined;
}
