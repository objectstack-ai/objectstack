// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reading rules behind Setup › Packaged automation (ADR-0126 §7.4) — which
 * flows the page lists, and how it reads the two responses it depends on.
 *
 * Separate from `PackagedAutomationPage.tsx` because these are not components:
 * the scoping rule is the part of that page most worth testing directly, and
 * it costs a full DOM render to reach through the UI. It runs in the `unit`
 * project from here.
 */

/**
 * One row of `GET /api/v1/automation/_status`.
 *
 * A read projection over what the engine's `getFlowRuntimeStates()` returns —
 * every field optional because older backends answer with fewer of them, and
 * this page must degrade rather than throw. Only `name`, `enabled`, `reason`
 * and `unboundCause` are read.
 */
export interface FlowRuntimeStateRow {
  name?: unknown;
  enabled?: unknown;
  /**
   * `FlowRuntimeState.reason` (`@objectstack/spec` 17.5.0): the platform's one
   * sentence saying WHY an enabled flow is not armed, absent on every other
   * row. `unknown` here like its siblings — only a string is taken.
   */
  reason?: unknown;
  /**
   * `FlowRuntimeState.unboundCause` (objectstack#23842): the contract's closed
   * machine value for WHICH cause `reason` describes, present exactly on the
   * rows that carry `reason` — an enabled flow that declares a trigger the
   * engine has not armed. `unknown` here like its siblings — only a non-empty
   * string is taken.
   */
  unboundCause?: unknown;
  [key: string]: unknown;
}

/** A packaged flow as the page renders it. */
export interface PackagedFlowRow {
  /** Machine name — the key every automation route takes. */
  name: string;
  /** Display name; falls back to the machine name when the item has none. */
  label: string;
  /** Activation state as the engine reports it. */
  enabled: boolean;
  /**
   * The platform's sentence for why the engine has not armed this flow —
   * present only when the runtime row carried a non-empty string `reason`.
   *
   * It is RENDERED, never read: the contract's own words on the field are
   * "Consumers RENDER it; ⛔ do not parse it". A deployment-policy refusal
   * (package-authored scheduled work switched off) and a real binding failure
   * both arrive here, each in the platform's own words, and this page tells
   * them apart only by showing those words (objectui#9217). No sentence is
   * matched, compared or restyled on this side, and none is kept in this repo.
   */
  reason?: string;
  /**
   * The engine's `unboundCause` for this row — present only when the runtime
   * row carried a non-empty string one, which the contract sends exactly when
   * the flow is enabled, declares a trigger, and that trigger is NOT armed on
   * this deployment. Read for its PRESENCE by {@link activationReading}: the
   * flow does not run, whichever cause it is (objectui#13159). No cause is
   * told apart on this page.
   */
  unboundCause?: string;
}

/** What a packaged flow's Activation cell says — see {@link activationReading}. */
export type ActivationReading = 'on' | 'not-running' | 'off';

/**
 * What a packaged flow's Activation cell reads as (objectui#13159).
 *
 * Two facts sit in that cell and are kept apart: the switch shows and writes
 * the activation FLAG (the ADR-0126 §7.2 ledger bit), and this reading says
 * whether the flow RUNS on this deployment. They differ on exactly one kind of
 * row — enabled, but the engine has not armed its declared trigger (a
 * deployment policy that keeps package-authored scheduled work off, a disabled
 * subflow, a missing trigger, a binding failure) — and that row must not read
 * "On", which an admin takes for "running".
 *
 *   - `off` — the flag is off: the flow never runs;
 *   - `not-running` — the flag is on, and the engine reported an
 *     `unboundCause` for the row: its trigger is not armed here;
 *   - `on` — the flag is on and the engine reported no unbound cause: bound to
 *     its trigger, or a flow with no trigger that runs when invoked.
 *
 * The signal is the engine's own classifier field, never the `reason`
 * sentence (which is rendered, ⛔ never parsed) and never re-derived here from
 * `bound` / `triggerType`.
 */
export function activationReading(row: Pick<PackagedFlowRow, 'enabled' | 'unboundCause'>): ActivationReading {
  if (!row.enabled) return 'off';
  return row.unboundCause ? 'not-running' : 'on';
}

/**
 * Is this `flow` metadata item shipped by a CODE PACKAGE?
 *
 * A clause-for-clause transcription of `isCodeArtifactBody`
 * (`@objectstack/objectql` `registry.ts`, ADR-0029 D9.6) — the server's own
 * answer to "does a code package ship this name?". It cannot be imported here
 * (objectql is a server package), and the shortened variants already present
 * in this repo are wrong in exactly the direction that matters on this page:
 *
 *   - **truthy `_packageId` is not enough.** A TENANT-authored overlay bound
 *     to a package carries a real package id too — on the save path and on the
 *     boot-time rehydration of `sys_metadata` alike. cloud#970 measured a
 *     Studio-authored artifact reading back as a code artifact after a kernel
 *     rebuild, which is the same misread this page would make.
 *   - **`_packageId === 'sys_metadata'`** is the sentinel for an overlay bound
 *     to no package at all — runtime-authored, never packaged.
 *   - **`_provenance`** is the axis that actually separates the two (ADR-0010:
 *     `'package'` for loader-introduced items, `'org'` for tenant-authored).
 *
 * Erring either way is a real defect, not cosmetics: a tenant's own flow shown
 * on that page offers an install-wide switch for something Studio owns, and a
 * packaged flow filtered out leaves an admin with no off-switch at all.
 */
export function isPackagedFlowItem(item: unknown): boolean {
  const it = item as { _packageId?: unknown; _provenance?: unknown } | null | undefined;
  const packageId = it?._packageId;
  if (typeof packageId !== 'string' || !packageId || packageId === 'sys_metadata') return false;
  return it?._provenance !== 'org';
}

/**
 * Join the engine's runtime states with the `flow` metadata list, scoped to
 * the packaged ones.
 *
 * The runtime list is the SPINE — it holds every flow the engine can actually
 * toggle or clone — and the metadata list answers two things it does not
 * carry: whether a package shipped the flow, and the flow's display label.
 * A packaged flow that the engine never registered is therefore not listed:
 * both actions the page offers go through the engine, and a row with two dead
 * controls tells an admin less than no row.
 */
export function joinPackagedFlows(
  runtime: readonly FlowRuntimeStateRow[],
  metaItems: readonly unknown[],
): PackagedFlowRow[] {
  const packaged = new Map<string, Record<string, unknown>>();
  for (const raw of metaItems) {
    const item = raw as Record<string, unknown> | null;
    const name = item?.name;
    if (typeof name !== 'string' || !name) continue;
    if (!isPackagedFlowItem(item)) continue;
    packaged.set(name, item as Record<string, unknown>);
  }

  const rows: PackagedFlowRow[] = [];
  for (const state of runtime) {
    const name = state?.name;
    if (typeof name !== 'string' || !name) continue;
    const item = packaged.get(name);
    if (!item) continue;
    const label = item.label;
    const reason = state.reason;
    const unboundCause = state.unboundCause;
    rows.push({
      name,
      label: typeof label === 'string' && label ? label : name,
      // `enabled` is TRUE unless the engine says otherwise: an older backend
      // that omits the field has no ledger to disable anything with.
      enabled: state.enabled !== false,
      // Absent, not `undefined`-valued, the way the engine omits it: a row
      // with nothing to explain renders exactly as it did before the field
      // existed, and so does every older backend that never sends one.
      ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
      // Absent the same way, and for the same reason: a backend that predates
      // the field (objectstack#23842) reads exactly as it did before.
      ...(typeof unboundCause === 'string' && unboundCause.length > 0 ? { unboundCause } : {}),
    });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
}

/**
 * The `data` object of a transport envelope, or `{}`.
 *
 * A parsed HTTP body is never a value the type system has vouched for, so it
 * arrives as `unknown` and is narrowed here once rather than cast at each read.
 */
export function envelopeData(json: unknown): Record<string, unknown> {
  const data = (json as { data?: unknown } | null | undefined)?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

/**
 * Did the transport envelope itself report a refusal under a 2xx?
 *
 * `!res.ok` is the usual signal; this is the other one, and both mean the
 * request was refused before anything changed.
 */
export function envelopeRefused(json: unknown): boolean {
  return (json as { success?: unknown } | null | undefined)?.success === false;
}

/** The runtime-state list out of `GET /automation/_status`, wrapped or bare. */
export function readRuntimeStates(payload: unknown): FlowRuntimeStateRow[] {
  const p = payload as
    | { data?: { flows?: unknown }; flows?: unknown }
    | null
    | undefined;
  const list = p?.data?.flows ?? p?.flows ?? [];
  return Array.isArray(list) ? (list as FlowRuntimeStateRow[]) : [];
}

/** The `flow` metadata list — bare array or `{ items }`, as this route answers. */
export function readMetadataItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const items = (payload as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? items : [];
}
