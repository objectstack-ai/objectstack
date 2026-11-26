// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow designer's helpers: the runtime state, the registration read, the
 * new-flow trigger helpers, `pairIdOf` and the copied-flow arrival reader,
 * moved out of `StudioDesignSurface.tsx` unchanged by objectstack#29988 (slice 4
 * of the move-only split). objectstack#36903 — the rail they were named for is
 * gone with its status dot, glyph tables and grouping reads; the designer and
 * the list's create dialog read what is left.
 */

import type { MetadataClient } from '@object-ui/data-objectstack';
import type { FlowRuntimeState as SpecFlowRuntimeState } from '@objectstack/spec/contracts';
import { customizationPackageId } from '@objectstack/spec/kernel';
import {
  fieldsForNodeType,
  localizeFlowFields,
  type FlowConfigField,
} from '../metadata-admin/inspectors/flow-node-config.js';
import type { FlowRuntimeRow } from '../metadata-admin/previews/flow-problems.js';
import type { FlowRegistration } from '@objectstack/spec/api';

/**
 * One flow's runtime enable/bound state, as `GET /automation/_status` puts it on
 * the wire — the same report `IAutomationService.getFlowRuntimeStates` produces,
 * so the shape is the spec's and is TAKEN from it rather than restated
 * (objectui#7265; this used to be a module-local copy under the spec's own name,
 * already three keys behind it).
 *
 * `Partial<>` is the one deliberate divergence, and it is about the READER, not
 * the contract: this types a JSON body that has not been validated and may come
 * from an older backend that sends neither `enabled` nor `bound` — the effect
 * hard-codes the degraded case (`if (!res.ok) return`, "dots just don't
 * render"). Every member is therefore optional HERE while the contract keeps
 * `name` / `enabled` / `bound` required, and the reads below narrow each one
 * explicitly (`if (s?.name)`, then `s.enabled !== false`, `!!s.bound` and the
 * two string checks in `flowRailState`) instead of trusting the type. Pinned in
 * `spec-symbol-parity.test.ts`: if the spec ever
 * relaxes those three itself, the pin fails and this alias should collapse to a
 * plain re-export.
 */
export type FlowRuntimeState = Partial<SpecFlowRuntimeState>;

/**
 * What the Automations rail keeps from one flow's runtime row (objectui#11281).
 *
 * `bound` alone cannot say why an enabled flow is unbound. The contract's
 * `FlowRuntimeState.bound` is false both for a flow that declares no trigger
 * and for one whose declared trigger the engine has not armed, and "`triggerType`
 * distinguishes the two". `reason` is the platform's one sentence for why such a
 * flow is not armed: a deployment policy and a binding failure each arrive in
 * the platform's own words. So the rail keeps both beside `enabled` / `bound`.
 *
 * The shape is `flow-problems`' `FlowRuntimeRow` (objectui#11779): the rail,
 * the flow header and the Problems panel derive one run status from it
 * (`deriveFlowRunStatus`), so it is declared once, where that derivation is.
 *
 * `unboundCause` rides in it too: the ledger switch on a read-only package's
 * flow (ADR-0146 D4) reads it for its presence, the same reading Setup ›
 * Packaged automation shows, and the run note words a known cause from it.
 */
export type FlowRailState = FlowRuntimeRow;

/**
 * Narrow one unvalidated runtime row into the rail's state. `triggerType`,
 * `reason` and `unboundCause` are kept only as non-empty strings and are
 * otherwise absent, the way the engine omits them, so a row without them, and
 * every older backend, reads exactly as it did before they existed.
 */
export function flowRailState(s: FlowRuntimeState): FlowRailState {
  const { triggerType, reason, unboundCause } = s;
  return {
    enabled: s.enabled !== false,
    bound: !!s.bound,
    ...(typeof triggerType === 'string' && triggerType.length > 0 ? { triggerType } : {}),
    ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
    ...(typeof unboundCause === 'string' && unboundCause.length > 0 ? { unboundCause } : {}),
  };
}

/**
 * The engine's registration verdict on each flow of the rail's scope
 * (objectui#12349): the flow list's `registrations`, which the server serves
 * beside the items, read through the same list read the rail's own loader
 * makes (one request when both are in flight). Every entry is parsed with the
 * spec's `FlowRegistrationSchema` at the client.
 *
 * A read that fails leaves every flow unjudged — what an absent
 * `registrations` already means — so the rail reads as it did before the
 * verdict existed; the rail's own list read reports a failing list.
 */
export async function readFlowRegistrations(
  client: { listResponse: MetadataClient['listResponse'] },
  packageId: string | null,
): Promise<Record<string, FlowRegistration>> {
  try {
    const answer = await client.listResponse('flow', packageId === null ? {} : { packageId });
    return answer.registrations ?? {};
  } catch {
    return {};
  }
}

/** The trigger the New automation dialog chose (objectui#11788). */
export interface NewFlowTrigger {
  triggerType: string;
  /** The object a record trigger watches, when the author named one. */
  objectName?: string;
}

/**
 * The Start node's own trigger and object fields, localized — the source of the
 * New automation dialog's choices (objectui#11788), so the dialog offers what
 * the Start node offers, under the same labels, and shows the object picker for
 * exactly the triggers the Start node shows it for (`objectName`'s `showWhen`).
 */
export function newFlowTriggerFields(locale: string): { trigger?: FlowConfigField; object?: FlowConfigField } {
  const start = localizeFlowFields('start', fieldsForNodeType('start'), locale);
  return {
    trigger: start.find((f) => f.id === 'triggerType'),
    object: start.find((f) => f.id === 'objectName'),
  };
}

/**
 * `flow` with the chosen trigger written on its Start node, where the Start
 * node's trigger field writes it (`config.triggerType`, and `config.objectName`
 * for the object) — objectui#11788. No choice leaves the skeleton as it was.
 */
export function withStartTrigger(
  flow: Record<string, unknown>,
  trigger: NewFlowTrigger | null,
): Record<string, unknown> {
  if (!trigger) return flow;
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, unknown>>) : [];
  return {
    ...flow,
    nodes: nodes.map((n) => {
      if (n.type !== 'start') return n;
      const config = n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? (n.config as Record<string, unknown>) : {};
      return {
        ...n,
        config: {
          ...config,
          triggerType: trigger.triggerType,
          ...(trigger.objectName ? { objectName: trigger.objectName } : {}),
        },
      };
    }),
  };
}

/**
 * objectstack#28567 — what the Automations pillar's "New similar" strip says:
 * the copy the clone door saved, shown on that copy in the package the answer
 * named, or an answer that named no package (nothing opened). `notice` is the
 * door's sentence, and `noticeCode` the code it names it by (objectstack#29727):
 * shown in the console's language for a known code, as sent otherwise.
 */
export type FlowCopiedStrip =
  | { kind: 'landed'; name: string; packageId: string; notice: string; noticeCode?: string }
  | { kind: 'noPackage'; name: string; notice: string; noticeCode?: string };

/** The navigation-state key the copy's landing rides to the copy's pillar on. */
export const FLOW_COPIED_ARRIVAL_STATE = 'flowNewSimilar';

/**
 * The landing a "New similar" navigation carried, kept only when it names
 * THIS package, so a stale history entry of another package shows nothing.
 */
/** objectstack#28572 — `base`'s paired customization package id by the spec's pairing rule, or `null`. For READS only. */
export function pairIdOf(base: string): string | null {
  const pair = customizationPackageId(base);
  return pair.ok ? pair.value : null;
}

export function readFlowCopiedArrival(state: unknown, packageId: string | null): FlowCopiedStrip | null {
  const arrival = (state as Record<string, unknown> | null | undefined)?.[FLOW_COPIED_ARRIVAL_STATE] as
    | Partial<Extract<FlowCopiedStrip, { kind: 'landed' }>>
    | undefined;
  if (!arrival || arrival.kind !== 'landed' || packageId === null || arrival.packageId !== packageId) return null;
  if (typeof arrival.name !== 'string' || arrival.name === '') return null;
  return {
    kind: 'landed',
    name: arrival.name,
    packageId,
    notice: typeof arrival.notice === 'string' ? arrival.notice : '',
    ...(typeof arrival.noticeCode === 'string' ? { noticeCode: arrival.noticeCode } : {}),
  };
}
