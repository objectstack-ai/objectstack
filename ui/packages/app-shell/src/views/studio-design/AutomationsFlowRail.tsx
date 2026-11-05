// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Automations pillar's flow rail helpers: the runtime and rail states, the
 * status dot and its glyph tables, the flow, definition and object-label reads,
 * the new-flow trigger helpers, `pairIdOf` and the copied-flow arrival reader,
 * moved out of `StudioDesignSurface.tsx` unchanged by objectstack#29988 (slice 4
 * of the move-only split).
 */

import * as React from 'react';
import type { MetadataClient } from '@object-ui/data-objectstack';
import type { FlowRuntimeState as SpecFlowRuntimeState } from '@objectstack/spec/contracts';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { customizationPackageId } from '@objectstack/spec/kernel';
import type { FlowTriggerGlyph } from './flowGrouping.js';
import {
  Zap,
  Clock,
  MousePointerClick,
  CornerDownRight,
  type LucideIcon,
} from 'lucide-react';
import {
  fieldsForNodeType,
  localizeFlowFields,
  type FlowConfigField,
} from '../metadata-admin/inspectors/flow-node-config.js';
import {
  deriveFlowRunStatus,
  describeFlowRunStatus,
  type FlowRunStatus,
  type FlowRunStatusView,
  type FlowRuntimeRow,
} from '../metadata-admin/previews/flow-problems.js';
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
 * A flow's live status in the Automations rail, from the engine's runtime state
 * (persisted `status` is intent; this is what's actually live). Renders nothing
 * for a flow the engine doesn't know yet (never published) — the amber
 * "unpublished draft" chip already covers that case.
 *
 * objectui#12349 — and from the engine's registration verdict, which the flow
 * list serves beside its items. A flow the engine REFUSED has no runtime row,
 * so it used to render nothing here; it now reads "Refused by the engine",
 * titled with the engine's `reason.message`, as sent and never parsed. An
 * `unregistered` flow reads "Not running here". A `registered` verdict, and
 * none at all, leave the row's reading below.
 *
 * The state is the run status `deriveFlowRunStatus` derives, worded by
 * `describeFlowRunStatus` — the derivation the flow header's Status pill and the
 * Problems panel read too (objectui#11779), so the three cannot disagree:
 *   - enabled and bound, or enabled with no declared trigger: "On", titled
 *     "bound to its trigger" / "no trigger (run manually)" — a flow that runs
 *     when invoked is never called "not running";
 *   - enabled, with a declared trigger the engine has not armed: "Not running
 *     here". Its title is the platform's `reason`, verbatim (objectui#11281),
 *     or, from a backend that predates the field, the contract's own reading of
 *     the row: its trigger is not armed here;
 *   - disabled: "Off".
 *
 * objectui#12454 — drawn as a 6 px dot, as the redesign's rail draws it: green
 * for On, grey for Not running here, amber for Refused, a hollow ring for Off
 * (`flowDotClass`). The words are the element's visually hidden text and the
 * row's title (the dot no longer prints them), and the dot's own title is the
 * reason it always carried. The rail's legend names each look.
 * Nothing here is styled as an error: a deployment policy is not a defect.
 */
export function FlowStatusDot({
  state,
  registration,
  locale,
}: {
  state?: FlowRailState;
  /** The engine's verdict on this flow, from the list's `registrations`; absent when none was served. */
  registration?: FlowRegistration;
  locale: string;
}): React.ReactElement | null {
  const reading = flowRailStatus(state, registration, locale);
  if (!reading) return null;
  const { status, view } = reading;
  // objectui#12454 — a 6 px dot; the status words stay the element's text
  // (visually hidden, so a reader and a search still find them) and the hover
  // text stays the reason as it was.
  return (
    <span title={view.title} data-status={status.kind} className="inline-flex h-4 w-3 shrink-0 items-center justify-center">
      <span aria-hidden className={'h-1.5 w-1.5 rounded-full ' + flowDotClass(status)} />
      <span className="sr-only">{view.label}</span>
    </span>
  );
}

/**
 * The rail's reading of one flow: the run status `FlowStatusDot` draws and the
 * row's title names, or `null` when there is nothing to say — a flow the engine
 * does not know yet and holds no verdict on (the amber "unpublished draft" chip
 * already covers that case).
 */
export function flowRailStatus(
  state: FlowRailState | undefined,
  registration: FlowRegistration | undefined,
  locale: string,
): { status: FlowRunStatus; view: FlowRunStatusView } | null {
  const decides = registration?.state === 'refused' || registration?.state === 'unregistered';
  if (!state && !decides) return null;
  const status = deriveFlowRunStatus(state, undefined, registration);
  return { status, view: describeFlowRunStatus(status, locale) };
}

/**
 * The dot's look per run status (objectui#12454): green when the flow runs
 * (bound, or run by hand), grey when this deployment does not run it, amber
 * when the engine refused it, and a hollow ring when it is switched off.
 * Nothing here is styled as an error: a deployment policy is not a defect.
 */
export function flowDotClass(status: FlowRunStatus): string {
  switch (status.kind) {
    case 'on':
    case 'manual':
      return 'bg-emerald-500';
    case 'refused':
      return 'bg-amber-500';
    case 'off':
      return 'border border-muted-foreground/70';
    default:
      return 'bg-muted-foreground/50';
  }
}

/** Each trigger kind's 14 px glyph and its words, in the rail rows and the legend (objectui#12454). */
export const FLOW_GLYPH_ICON: Record<FlowTriggerGlyph, LucideIcon> = {
  record: Zap,
  scheduled: Clock,
  screen: MousePointerClick,
  autolaunched: CornerDownRight,
};
export const FLOW_GLYPH_LABEL_KEY: Record<FlowTriggerGlyph, string> = {
  record: 'engine.studio.auto.kind.record',
  scheduled: 'engine.studio.auto.kind.scheduled',
  screen: 'engine.studio.auto.kind.screen',
  autolaunched: 'engine.studio.auto.kind.autolaunched',
};

/** The React key of the trailing group, whose grouping key is the empty string. */
export const NO_OBJECT_GROUP_KEY = '__no_object__';

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

/**
 * Each flow's definition in the rail's scope, by name (objectui#12454): what
 * the rail's grouping and trigger glyphs read. Read with the drafts overlaid,
 * so a draft-only flow, and a published one whose draft moved its trigger,
 * group as the author's draft has them; a server that refuses that read gives
 * the published list, and a failing list gives none, which groups every flow
 * under "No object" rather than failing the rail.
 */
export async function readFlowDefinitions(client: MetadataClient, packageId: string | null): Promise<Map<string, unknown>> {
  const scope = packageId === null ? {} : { packageId };
  const read = async (): Promise<Array<Record<string, unknown>> | null | undefined> => {
    try {
      return await client.withPreviewDrafts(true).list<Record<string, unknown>>('flow', scope);
    } catch {
      return await client.list<Record<string, unknown>>('flow', scope);
    }
  };
  const definitions = new Map<string, unknown>();
  try {
    for (const flow of (await read()) ?? []) {
      if (flow && typeof flow.name === 'string' && flow.name) definitions.set(flow.name, flow);
    }
  } catch {
    /* no definitions: every flow groups under "No object" */
  }
  return definitions;
}

/**
 * The scope's objects, name → label in the designer locale (objectui#12454):
 * the rail's group headers and their order, and which objects count as the
 * scope's own when a flow is grouped by the data it touches. The package's
 * object list, as the Data rail reads it; unscoped in the package-less scope.
 * A failing read gives an empty index, which `groupFlowsByObject` reads as
 * "every object is the scope's".
 */
export async function readObjectLabels(client: MetadataClient, packageId: string | null, locale: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  try {
    // The package's pending object drafts too, as the Data rail lists them: a
    // flow on an object not published yet is grouped under it, and the header
    // reads its label (the `_drafts` row carries one), not its name. A
    // published object keeps its published label; a failed draft read adds
    // none and leaves the published index whole (an async function, so even
    // a throw before the read is sent rejects into the catch).
    const readDrafts = async (): Promise<Array<{ name?: string | null; label?: I18nLabel | null }>> =>
      (await client.listDrafts(packageId === null ? { type: 'object' } : { packageId, type: 'object' })) ?? [];
    const [objects, drafts] = await Promise.all([
      client.list<Record<string, unknown>>('object', packageId === null ? {} : { packageId }),
      readDrafts().catch(() => []),
    ]);
    for (const object of objects ?? []) {
      if (!object || typeof object.name !== 'string' || !object.name) continue;
      const label = resolveI18nLabel(object.label as I18nLabel | undefined, locale)?.trim();
      labels.set(object.name, label || object.name);
    }
    for (const draft of drafts) {
      if (!draft || typeof draft.name !== 'string' || !draft.name || labels.has(draft.name)) continue;
      labels.set(draft.name, resolveI18nLabel(draft.label ?? undefined, locale)?.trim() || draft.name);
    }
  } catch {
    /* an empty index */
  }
  return labels;
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

/** No navigation order: one shared empty list, so the rail's memo holds across renders. */
export const NO_OBJECT_ORDER: readonly string[] = [];

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
