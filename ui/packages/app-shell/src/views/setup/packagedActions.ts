// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reading rules behind the packaged-action ledger switch (ADR-0126 §8
 * item 2 charter) — how the two responses it depends on are read. Written for
 * Setup › Packaged Actions, which objectstack#34724 (the ADR-0146 D4 amendment
 * of 2026-11-17) retired; Studio's action switch reads through them
 * (`packagedActionLedger.ts`), on a read-only app's vendor actions.
 *
 * Not components, so the rules are tested directly, in the `unit` project.
 *
 * ## Where each fact comes from
 *
 *   1. **Which object an action is addressed under.** Actions are declared in
 *      two places and the runtime reads BOTH (`collectActionDeclarations`,
 *      `@objectstack/runtime`'s `action-execution.ts`): embedded in an object's
 *      `actions[]`, and as standalone `action` metadata items. The flip's
 *      `:object` segment is the owning object, or {@link GLOBAL_ACTION_OBJECT}
 *      ({@link standaloneActionObjectName}).
 *   2. **Whether it is switched off here.** The `sys_metadata_activation`
 *      ledger, rows carrying `metadata_type: 'action'` (ADR-0126 §4). That
 *      object declares `apiMethods: ['get', 'list']` with the reason stated in
 *      its own source — *"Reads stay open so operability surfaces can answer
 *      'what is disabled here?'"* — so the generic data API list IS the
 *      sanctioned read. ⛔ There is no `_status`-style read door for actions
 *      to mirror the flows half with, and none is invented here: the write
 *      door (objectstack#12348) shipped the flip only.
 *
 * ## Absence of a row means ACTIVE
 *
 * Nothing writes a row to say "active by default", so an empty ledger is the
 * ordinary stock-boot state and every action reads armed. That is the ledger's
 * own contract (ADR-0126 §4), and it is why {@link readActionActivation}
 * answers a map of the exceptions rather than a state per action.
 *
 * ## What this module deliberately does NOT compute (ADR-0126 §9)
 *
 * ⛔ No clone target — the action-clone half is unchartered (§8 item 2), so
 * nothing here designates, copies or links an artifact to another one. ⛔ No
 * drift, ancestry or base-version fact: the platform does not track that
 * lineage, so a field claiming it would be invented here.
 */

/**
 * The object segment an OBJECT-LESS action takes, on the wire and on the switch.
 *
 * `GLOBAL_ACTION_OBJECT_KEY` in `@objectstack/objectql`'s `action-governance.ts`
 * (a server package, so the value is transcribed rather than imported). The
 * activation door's path is `POST /actions/_activation/:object/:action` with the
 * object segment MANDATORY — *"use `global` for an object-less action"*, the
 * same spelling the invocation door takes — so this is the literal string that
 * goes in the URL, and the flip addresses exactly this.
 */
export const GLOBAL_ACTION_OBJECT = 'global';

/** The `sys_metadata_activation` discriminator these readers take. */
export const ACTION_METADATA_TYPE = 'action';

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
 * action an administrator switched OFF as armed — a switch that quietly
 * contradicts the deployment on the one fact it exists to report. The switch
 * therefore treats a truncated read as a load failure and shows nothing, rather
 * than rendering a list it already knows is wrong.
 *
 * Only an explicit `hasMore === true` counts. The field is optional in
 * `FindDataResponse`; a backend that omits it is not asserting truncation, and
 * inventing one from a row count would need a page size the reader does not know.
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
 * what the switch shows:
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
 * resolve, and the door would 404 on an action the switch was drawn for.
 */
export function standaloneActionObjectName(action: unknown): string {
  const a = action as { objectName?: unknown; object?: unknown } | null | undefined;
  if (typeof a?.objectName === 'string' && a.objectName.length > 0) return a.objectName;
  if (typeof a?.object === 'string' && a.object.length > 0) return a.object;
  return GLOBAL_ACTION_OBJECT;
}
