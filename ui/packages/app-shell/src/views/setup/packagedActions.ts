// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reading rules behind the packaged-ACTIONS half of Setup › Packaged
 * automation (ADR-0126 §7.4 page, §8 item 2 charter) — which actions the
 * section lists, and how it reads the two responses it depends on.
 *
 * Separate from `PackagedActionsSection.tsx` for the same reason
 * `packagedFlows.ts` is separate from the page: these are not components, the
 * scoping rule is the part most worth testing directly, and reaching it
 * through the DOM costs a full render. It runs in the `unit` project from here.
 *
 * ## Where each of the two facts comes from
 *
 * A row needs two things the platform keeps in two different places, and the
 * flows half's shape is mirrored exactly — one read for the ARTIFACTS, one for
 * the ACTIVATION STATE, joined here:
 *
 *   1. **Which actions exist, on which object, and did a package ship them.**
 *      Actions are declared in two places and the runtime reads BOTH
 *      (`collectActionDeclarations`, `@objectstack/runtime`'s
 *      `action-execution.ts`): embedded in an object's `actions[]`, and as
 *      standalone `action` metadata items. The two HTTP reads are `GET
 *      /meta/object` and `GET /meta/action`. Listing only the first would leave
 *      an administrator with no off-switch for a packaged standalone action —
 *      the same defect `packagedFlows.ts` names for a filtered-out flow.
 *   2. **Whether it is switched off here.** The `sys_metadata_activation`
 *      ledger, rows carrying `metadata_type: 'action'` (ADR-0126 §4). That
 *      object declares `apiMethods: ['get', 'list']` with the reason stated in
 *      its own source — *"Reads stay open so operability surfaces can answer
 *      'what is disabled here?'"* — so the generic data API list IS the
 *      sanctioned read for this page. ⛔ There is no `_status`-style read door
 *      for actions to mirror the flows half with, and this page does not invent
 *      one: the write door (objectstack#12348) shipped the flip only.
 *
 * ## Absence of a row means ACTIVE
 *
 * Nothing writes a row to say "active by default", so an empty ledger is the
 * ordinary stock-boot state and every action reads armed. That is the ledger's
 * own contract (ADR-0126 §4) and it is why {@link collectPackagedActions} takes
 * a map of the exceptions rather than a state per action.
 *
 * ## What this module deliberately does NOT compute (ADR-0126 §9)
 *
 * ⛔ No clone target — the action-clone half is unchartered (§8 item 2), so
 * nothing here designates, copies or links an artifact to another one. ⛔ No
 * drift, ancestry or base-version fact: the platform does not track that
 * lineage, so a field claiming it would be invented here.
 */

// The provenance predicate is imported, ⛔ not transcribed a second time. Its
// clauses (`_packageId` present, not the `sys_metadata` sentinel, `_provenance`
// not `'org'`) are about a REGISTRY ITEM's origin — they read the two keys the
// registry stamps on every metadata item, and say nothing about flows. Its
// header carries the whole argument for each clause and the cloud#970
// measurement behind the middle one; one definition, cited from both halves of
// this page, cannot drift the way two agreeing copies can.
import { isPackagedFlowItem, readMetadataItems } from './packagedFlows.js';

/**
 * The object segment an OBJECT-LESS action takes, on the wire and on this page.
 *
 * `GLOBAL_ACTION_OBJECT_KEY` in `@objectstack/objectql`'s `action-governance.ts`
 * (a server package, so the value is transcribed rather than imported). The
 * activation door's path is `POST /actions/_activation/:object/:action` with the
 * object segment MANDATORY — *"use `global` for an object-less action"*, the
 * same spelling the invocation door takes — so this is the literal string that
 * goes in the URL, and showing it in the object column is showing what the flip
 * will actually address.
 */
export const GLOBAL_ACTION_OBJECT = 'global';

/** The `sys_metadata_activation` discriminator this section reads. */
export const ACTION_METADATA_TYPE = 'action';

/** A packaged action as the section renders it. */
export interface PackagedActionRow {
  /**
   * The declarative machine name (ADR-0110 D1) — the ledger's row key AND the
   * `:action` segment of the activation door.
   */
  name: string;
  /**
   * The owning object's machine name, or {@link GLOBAL_ACTION_OBJECT}. The
   * `:object` segment of the activation door.
   */
  objectName: string;
  /** Display name; falls back to the machine name when the item has none. */
  label: string;
  /** Activation as the ledger reports it — `true` when no row says otherwise. */
  enabled: boolean;
}

/**
 * The record list out of `GET /data/:object`, wrapped or bare.
 *
 * `FindDataResponse = { object, records, total?, hasMore? }` inside the
 * transport envelope's `data`. The two spellings are the wrapped and bare forms
 * of one response, exactly as `readRuntimeStates` reads the flow half's
 * `_status` — ⛔ not two dialects, and ⛔ not a tolerant alias for a shape the
 * server does not send.
 */
export function readDataRecords(payload: unknown): Array<Record<string, unknown>> {
  const p = payload as
    | { data?: { records?: unknown }; records?: unknown }
    | null
    | undefined;
  const list = p?.data?.records ?? p?.records ?? [];
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

/**
 * Did the ledger answer with a TRUNCATED page?
 *
 * This matters more here than pagination usually does, because of which way the
 * lie points: a missing row reads as ACTIVE, so a dropped page would show an
 * action an administrator switched OFF as armed — a page that quietly
 * contradicts the deployment on the one fact it exists to report. The section
 * therefore treats a truncated read as a load failure and shows nothing, rather
 * than rendering a list it already knows is wrong.
 *
 * Only an explicit `hasMore === true` counts. The field is optional in
 * `FindDataResponse`; a backend that omits it is not asserting truncation, and
 * inventing one from a row count would need a page size this page does not know.
 */
export function ledgerPageTruncated(payload: unknown): boolean {
  const p = payload as { data?: { hasMore?: unknown }; hasMore?: unknown } | null | undefined;
  return (p?.data?.hasMore ?? p?.hasMore) === true;
}

/**
 * The activation EXCEPTIONS — action name → armed — read from
 * `sys_metadata_activation` rows.
 *
 * A clause-for-clause transcription of `ObjectStoreActionActivationStore.list()`
 * (`@objectstack/objectql`'s `action-activation.ts`), which cannot be imported
 * here (a server package). Each clause is the store's, and each one changes
 * what this page shows:
 *
 *   - **`metadata_type === 'action'`.** The ledger is generic (ADR-0126 §4) and
 *     flow rows share the table today. Reading a flow's row as an action's
 *     would switch the wrong artifact's badge.
 *   - **rows carrying an `organization_id` are SKIPPED, not merged.** The
 *     per-org dimension is reserved and unwritten on this line (§5), so a row
 *     with one set was not written by this door. Reading it as install-level
 *     would show one organization's choice as the whole installation's — the
 *     store's own stated reason, arrived at from the read side.
 *   - **`active` is TRUE unless it is explicitly `false` or `0`.** The column
 *     defaults to true, and a driver that round-trips booleans as 0/1
 *     (SQLite/libsql) must not have its `0` read as "armed".
 */
export function readActionActivation(
  records: readonly Record<string, unknown>[],
): Map<string, boolean> {
  const activation = new Map<string, boolean>();
  for (const row of records) {
    if (row?.metadata_type !== ACTION_METADATA_TYPE) continue;
    if (row?.organization_id != null) continue;
    const name = row?.name;
    if (typeof name !== 'string' || !name) continue;
    const active = row?.active;
    activation.set(name, !(active === false || active === 0));
  }
  return activation;
}

/**
 * Owning object of a STANDALONE `action` item.
 *
 * Transcribed from `standaloneActionObjectName` (`@objectstack/runtime`), which
 * is itself kept in lockstep with the engine's registration key: spec
 * `objectName`, bundle-collector `object`, else the `global` wildcard. It has to
 * agree, because the string it returns becomes the `:object` segment of the
 * flip — a different answer here would address a declaration the server cannot
 * resolve, and the door would 404 on an action the page had just listed.
 */
export function standaloneActionObjectName(action: unknown): string {
  const a = action as { objectName?: unknown; object?: unknown } | null | undefined;
  if (typeof a?.objectName === 'string' && a.objectName.length > 0) return a.objectName;
  if (typeof a?.object === 'string' && a.object.length > 0) return a.object;
  return GLOBAL_ACTION_OBJECT;
}

/**
 * Which item answers the "did a package ship this?" question for one action.
 *
 * An action EMBEDDED in an object's `actions[]` is a plain sub-object: the
 * registry stamps `_packageId` / `_provenance` on the ITEM it registers, which
 * is the object, so an embedded action carries neither and its owning object is
 * the only thing that can answer. A STANDALONE `action` item is registered in
 * its own right and answers for itself.
 *
 * This is the read-side twin of how the activation door derives the package it
 * writes into the row — `declaration.action._packageId ?? declaration.obj._packageId`
 * — so the page classifies an action the same way the server does. The test is
 * "does the action carry provenance marks of its own", not "is `_packageId`
 * truthy": an action that carries `_provenance: 'org'` and no package id has
 * answered, and falling through to its packaged owning object would list a
 * tenant-authored action as packaged.
 */
export function packagedActionSource(action: unknown, obj: unknown): unknown {
  const a = action as { _packageId?: unknown; _provenance?: unknown } | null | undefined;
  if (typeof a?._packageId === 'string' || typeof a?._provenance === 'string') return action;
  return obj;
}

/**
 * Join the two declaration sources with the activation ledger, scoped to the
 * PACKAGED actions.
 *
 * The collection order and the dedup rule are transcribed from
 * `collectActionDeclarations` (`@objectstack/runtime`), including the one that
 * is easy to miss: on a `<object>:<action>` key clash the OBJECT-EMBEDDED
 * declaration wins, mirroring the execution layer's artifact-wins rule. Getting
 * that backwards would not just reorder the list — it would show a row whose
 * label and provenance came from a declaration that is not the one the server
 * would resolve and flip.
 *
 * ⚠️ Two objects may declare the SAME action name, and both rows are listed.
 * That is not a bug being papered over: the ledger addresses an action by its
 * machine name alone (§4), so one row would reach both, and the write door
 * refuses the flip with a `409 RESOURCE_CONFLICT` that NAMES the objects.
 * Hiding one row here, or disabling its switch, would replace the server's
 * explanation with a client-side guess about a conflict only the server can
 * describe.
 */
export function collectPackagedActions(
  objectItems: readonly unknown[],
  standaloneItems: readonly unknown[],
  activation: ReadonlyMap<string, boolean>,
): PackagedActionRow[] {
  const rows: PackagedActionRow[] = [];
  const seen = new Set<string>();

  const push = (action: unknown, objectName: string, obj: unknown) => {
    const a = action as { name?: unknown; label?: unknown } | null;
    const name = a?.name;
    if (typeof name !== 'string' || !name) return;
    const key = `${objectName}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!isPackagedFlowItem(packagedActionSource(action, obj))) return;
    const label = a?.label;
    rows.push({
      name,
      objectName,
      label: typeof label === 'string' && label ? label : name,
      enabled: activation.get(name) ?? true,
    });
  };

  const objByName = new Map<string, unknown>();
  for (const raw of objectItems) {
    const obj = raw as { name?: unknown } | null;
    if (typeof obj?.name === 'string' && obj.name) objByName.set(obj.name, raw);
  }

  // 1. Object-embedded declarations first — they win the key clash below.
  for (const raw of objectItems) {
    const obj = raw as { name?: unknown; actions?: unknown } | null;
    const objectName = obj?.name;
    if (typeof objectName !== 'string' || !objectName) continue;
    for (const action of Array.isArray(obj?.actions) ? obj.actions : []) {
      push(action, objectName, raw);
    }
  }

  // 2. Standalone `action` items, skipped where an embedded declaration of the
  //    same `<object>:<action>` key already claimed the slot.
  for (const action of standaloneItems) {
    const objectName = standaloneActionObjectName(action);
    push(action, objectName, objByName.get(objectName));
  }

  return rows.sort(
    (a, b) =>
      a.label.localeCompare(b.label) ||
      a.objectName.localeCompare(b.objectName) ||
      a.name.localeCompare(b.name),
  );
}

// Re-exported so the section reads its two metadata responses through the SAME
// reader the flows half uses for `GET /meta/flow` — one answer to "bare array or
// `{ items }`?", for every `/meta` list this page reads.
export { readMetadataItems };
