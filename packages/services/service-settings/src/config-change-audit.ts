// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8145] `config_change` — the settings service's row on the PLATFORM audit
 * ledger (`sys_audit_log`), alongside the settings-specific one it already
 * writes to `sys_setting_audit`.
 *
 * ## What was broken
 *
 * `sys_audit_log.action` declares `config_change`, the shipped `config_changes`
 * list view filters on it, and `settings-service.types.ts` documented the
 * service as emitting `sys_audit_log` rows — while every settings write went to
 * `sys_setting_audit` with `action: 'set'` and nothing else. The filter, the
 * list view and the dashboard widget over that value were therefore empty for
 * the whole life of the enum member (#7675: `PUT /api/settings/branding` then
 * `$filter={"action":"config_change"}` → total 0).
 *
 * ## Dual-write, not reroute — and why (maintainer ruling 2026-08-12 on #7675)
 *
 * The ruling permits either and leaves the choice to the implementation
 * (以实现定契约). Measured, `sys_setting_audit` keeps its rows:
 *
 *  - **It has live consumers.** `docs/qa/platform-checklist/areas/platform-core.json`
 *    asserts a `sys_setting_audit` row per settings write (namespace/key/scope/
 *    `action: 'set'`/`source`/`actor_id`/`new_hash`) as a shipped platform
 *    behaviour, and `manifest.test.ts` pins the object's registration. Measured
 *    across `packages/`, `apps/`, `examples/` **and the `objectui` checkout** —
 *    no other reader, and no settings-audit view in the console.
 *  - **The two rows are not duplicates.** `sys_setting_audit` records what
 *    `sys_audit_log` structurally cannot hold: `namespace`, `key`, `scope`,
 *    `old_hash`/`new_hash`, `source`, `encrypted`, `reason` — a settings-shaped
 *    ledger with no `object_name`/`record_id` analogue. `sys_audit_log` answers
 *    the compliance question ("who changed platform configuration, when") that a
 *    per-namespace table cannot answer across subsystems.
 *  - **A reroute would leave a shipped-but-never-written table**, which is the
 *    exact defect class the ruling condemns (审计面宁窄勿谎), and retiring
 *    `sys_setting_audit` is `packages/platform-objects` surface — a different
 *    seat — plus a stored-row migration this card is not the place to decide.
 *
 * Duplicate-row cost is bounded and deliberately accepted: one extra row per
 * CHANGED KEY per settings write. Settings writes are admin-rate operations, not
 * a hot path — this is nothing like the per-tick/per-chunk writers ADR-0057 D5
 * excluded from auditing (`sys_job_queue`, `sys_upload_session`), and
 * `sys_audit_log` carries its own retention (hot 90d → archive) so the growth is
 * policy-capped.
 *
 * ## Best-effort, by construction
 *
 * `sys_audit_log` belongs to `plugin-audit`, which is OPTIONAL: on a deployment
 * without it the table does not exist and every insert here throws. An audit
 * write must never turn a successful settings write into an error, so the sink
 * swallows and reports — the same posture `settings-service-plugin.ts` takes for
 * `sys_setting_audit`, and the same one `plugin-auth` takes for its own explicit
 * `sys_audit_log` rows.
 *
 * ## [#18368] An UNMOUNTED ledger is a CONFIGURATION, not a fault
 *
 * Swallowing and reporting was the whole answer, and it made the two cases
 * indistinguishable. A host that never mounted `plugin-audit` —
 * `objectstack serve --preset minimal`, an EE host that mounts no `audit`, a
 * hosted tenant kernel — has not FAILED to write the ledger row; it declined to
 * have a ledger. Reporting that as a degradation put a durability complaint on
 * a deployment behaving exactly as composed, and the cost was not one line: the
 * insert this sink never should have attempted reaches `ObjectQL.insert`, whose
 * own terminal `catch` logs `Insert operation failed` — once per settings
 * write, forever, because nothing there is reported-once.
 *
 * So the sink ASKS FIRST. `ledgerMountPoint` probes the engine's registry for
 * `sys_audit_log` before the write; absent, the sink skips at `debug` and the
 * insert is never attempted, so neither channel says anything. Three properties
 * are load-bearing and each is pinned:
 *
 *  - **The probe records nothing and is re-taken on every call.** A memoized
 *    "not mounted" would be a verdict the boot can still contradict
 *    (AGENTS.md → *Startup registry reads*): `plugin-audit` may register
 *    `sys_audit_log` after the settings service binds its engine, and nothing
 *    would ever revisit a cached no.
 *  - **"Cannot tell" is not "absent".** `getSchema` is an ObjectQL member, not
 *    an `IDataEngine` one, so a lean engine double may not carry it at all.
 *    Only an engine that ANSWERS, and answers `undefined`, licenses the skip;
 *    an engine that cannot be asked gets the write attempted, which is this
 *    file's pre-#18368 behaviour.
 *  - **The fault arm got LOUDER, not quieter.** What is left in the `catch`
 *    once the expectation is gone is a mounted ledger whose insert genuinely
 *    failed — the settings write is on disk and claims to be audited while the
 *    compliance row is not, which is AGENTS.md's *durability degradation* to
 *    the letter, so it reports on the `error` channel (falling back to `warn`
 *    only for a sink that has none). Suppressing an expectation is the point;
 *    suppressing a fault would be the same defect one layer down.
 *
 * ## No plaintext, ever
 *
 * The sink receives a DIGEST, never a value — `SettingsService` masks an
 * encrypted key's digest as `<encrypted:…>` before it calls. Nothing on this
 * path can reach the cleartext, so there is no redaction step to forget.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { SettingsAuditSink, SettingsDiagnosticsLogger } from './settings-service.types.js';

/** The object this service records platform configuration changes against. */
export const CONFIG_CHANGE_OBJECT_NAME = 'sys_setting';

/**
 * The `sys_audit_log.action` value settings writes carry.
 *
 * A declared member of the object's action enum
 * (`plugin-audit/src/objects/sys-audit-log.object.ts`) and the value the shipped
 * `config_changes` list view filters on. Named here rather than spelled inline
 * so the writer and its pins cannot drift from each other.
 */
export const CONFIG_CHANGE_ACTION = 'config_change';

/**
 * The platform audit ledger the mount probe asks about.
 *
 * Module-local on purpose. `CONFIG_CHANGE_ACTION` and
 * `CONFIG_CHANGE_OBJECT_NAME` are published because a host that binds its own
 * engine has to be able to reproduce the ROW; the ledger's own name is not part
 * of that row, and publishing it would widen this module's exported surface for
 * nothing.
 *
 * ⛔ The two pre-existing spellings below — the `organization_id` field probe
 * and the insert itself — are deliberately left INLINE rather than folded onto
 * this constant. They are counted sites in `content/docs/permissions/tenant-audit-census.mdx`
 * ("object name spelled inline" vs "named through a const"), so folding them
 * moves a corpus-scale ratchet and a hand-written prose count in a docs tree
 * this change has no business in. The consolidation is worth doing; it is not
 * worth doing here.
 */
const AUDIT_LEDGER_OBJECT_NAME = 'sys_audit_log';

/**
 * Execution context the ledger row is written under.
 *
 * `sys_audit_log` is `managedBy: 'append-only'` with every field `readonly:
 * true` — a platform-owned table written only by internal system paths. This is
 * the platform recording its own event, after the settings service's capability,
 * lock and validation gates have already passed on the caller's write.
 */
const SYSTEM_CTX = Object.freeze({ isSystem: true });

/** Structural minimum of the logger this module reports through. */
type ConfigChangeLogger = SettingsDiagnosticsLogger & {
  warn?: (message: string) => void;
  /**
   * [#18368] The channel an UNMOUNTED ledger is reported on — a configuration
   * reading, not a degradation, so it must not reach `warn`/`error`.
   *
   * Local to this module and deliberately NOT added to the exported
   * `SettingsDiagnosticsLogger`: that interface is the contract a HOST
   * implements, and this sink is handed `ctx.logger` (the kernel `Logger`,
   * which has `debug`). Optional for the same reason the two above are — a
   * one-line spy stays assignable, and a sink without it simply skips silently,
   * which is the correct outcome for a deployment that never mounted the
   * ledger.
   */
  debug?: (message: string) => void;
};

/**
 * Whether the registered `sys_audit_log` schema declares `field`.
 *
 * `organization_id` is auto-injected by the SchemaRegistry ONLY in multi-tenant
 * mode, so it is present on some deployments and absent on others.
 * Unconditionally stamping it made every audit INSERT fail on a single-tenant
 * stack ("table sys_audit_log has no column named organization_id"); never
 * stamping it makes the SecurityPlugin's RLS predicate
 * (`organization_id = current_user.organization_id`) hide every row from
 * non-platform-admin readers on a multi-tenant one — which would leave the
 * `config_changes` view exactly as empty as the defect this card fixes, one
 * layer further down. `plugin-audit`'s own writer resolves it the same way, off
 * the same lazily-read schema.
 *
 * Best-effort: an engine that exposes no `getSchema` simply skips the stamp,
 * which is the pre-#8145 behaviour of every other explicit `sys_audit_log`
 * writer in the repo.
 */
function makeFieldProbe(engine: IDataEngine): (field: string) => boolean {
  let fields: Set<string> | null | undefined;
  return (field: string): boolean => {
    if (fields === undefined) {
      fields = null;
      try {
        // `getSchema` is not on `IDataEngine`; it is an ObjectQL member every
        // real engine carries. Guarded rather than declared, so a lean engine
        // double stays assignable.
        const schema: any = (engine as any).getSchema?.('sys_audit_log');
        const declared = schema?.fields;
        if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
          fields = new Set<string>(Object.keys(declared));
        } else if (Array.isArray(declared)) {
          fields = new Set<string>(declared.map((f: any) => f?.name).filter(Boolean));
        }
      } catch {
        /* best-effort — absence just means we skip the stamp */
      }
    }
    return fields != null && fields.has(field);
  };
}

/**
 * [#18368] Is the platform audit ledger MOUNTED on this deployment?
 *
 * Three answers, and the third is the one a two-valued predicate would have
 * lost:
 *
 *  - `true`  — the engine answered and `sys_audit_log` is registered. Write.
 *  - `false` — the engine answered and it is not. This host declined to have a
 *              ledger; skip, and say so on `debug` only.
 *  - `undefined` — the engine could not be ASKED. `getSchema` is an ObjectQL
 *              member, not an `IDataEngine` one (the same guarded reach
 *              {@link makeFieldProbe} documents), so a lean engine double may
 *              not carry it, and a host engine may throw out of it. ⛔ Never
 *              read as "absent": an unanswerable probe must leave the write
 *              attempted, which is this file's pre-#18368 behaviour, so a fault
 *              on such an engine stays reported exactly as it was.
 *
 * ⛔ Records nothing, and is re-taken on EVERY call. A memo would turn "not
 * registered yet" into a verdict the same boot can contradict — `plugin-audit`
 * registers `sys_audit_log` from its own lifecycle, which may run after the
 * settings service binds its engine, and nothing would ever revisit a cached
 * no (AGENTS.md → *Startup registry reads*). A settings write is an admin-rate
 * operation, so the per-call registry lookup costs nothing worth memoizing.
 */
function ledgerIsMounted(engine: IDataEngine): boolean | undefined {
  const getSchema = (engine as any)?.getSchema;
  if (typeof getSchema !== 'function') return undefined;
  try {
    // Property-access call, so the engine stays the receiver.
    return (engine as any).getSchema(AUDIT_LEDGER_OBJECT_NAME) != null;
  } catch {
    // An engine that throws out of its own registry has not told us the ledger
    // is absent — it has told us nothing.
    return undefined;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Build the `SettingsAuditSink` that records every successful settings write on
 * `sys_audit_log` as a `config_change` row.
 *
 * Exported (rather than left private on the plugin) for the same reason
 * `wrapEngineAsSettingsEngine` is: the row shape is the contract this card
 * makes true, and a pin that reconstructs it by hand would be pinning the test's
 * copy instead of the writer's.
 */
export function buildConfigChangeAuditSink(
  engine: IDataEngine,
  logger?: ConfigChangeLogger,
): SettingsAuditSink {
  const eng: any = engine;
  const declares = makeFieldProbe(engine);
  let failureReported = false;

  return {
    record: async (entry) => {
      // [#18368] Ask before writing. An unmounted ledger is a CONFIGURATION:
      // attempting the insert would throw, and the throw would be reported as a
      // degradation here AND logged per-write by `ObjectQL.insert`'s own
      // terminal catch one frame down. Only an engine that ANSWERS "not
      // registered" licenses the skip — see `ledgerIsMounted`.
      if (ledgerIsMounted(engine) === false) {
        try {
          logger?.debug?.(
            'SettingsServicePlugin: no `sys_audit_log` on this deployment — the `config_change` ' +
              'ledger row was SKIPPED, not failed. The platform audit ledger is owned by the ' +
              'OPTIONAL `@objectstack/plugin-audit`; a host that does not mount it has no ' +
              'compliance ledger to write to, which is a composition choice and not a fault. ' +
              'The settings write itself landed, and `sys_setting_audit` still carries the ' +
              'settings-specific trail. Mount `@objectstack/plugin-audit` to populate the ' +
              '`config_changes` list view.',
          );
        } catch {
          /* logging must never break the audited write */
        }
        return;
      }
      try {
        const actor = entry.actor ?? entry.userId ?? null;
        const isReset = entry.action === 'reset';
        const row: Record<string, unknown> = {
          action: CONFIG_CHANGE_ACTION,
          // A strict `sys_user` lookup — only a real user id may land here.
          user_id: entry.userId ?? null,
          // The first-class principal label (ADR-0014 D2): a user id, a service
          // principal, or null for an in-process/boot write.
          actor,
          object_name: CONFIG_CHANGE_OBJECT_NAME,
          // A settings write has no single record id: `sys_setting` is keyed on
          // the composite `(namespace, key, scope, user_id)`. Null is the honest
          // answer and the shape `plugin-auth`'s run-level `import` row already
          // uses; WHICH setting changed is in `metadata` and `new_value`.
          record_id: null,
          // The digest, never the value — see the module header. A reset has no
          // new state to describe.
          new_value: isReset
            ? null
            : safeStringify({
                namespace: entry.namespace,
                key: entry.key,
                scope: entry.scope,
                digest: entry.valueDigest,
              }),
          tenant_id: entry.tenantId ?? null,
          metadata: safeStringify({
            event: isReset ? 'settings.reset' : 'settings.set',
            namespace: entry.namespace,
            key: entry.key,
            scope: entry.scope,
            encrypted: entry.encrypted,
            ...(entry.requestId ? { requestId: entry.requestId } : {}),
          }),
        };
        if (declares('organization_id')) row.organization_id = entry.tenantId ?? null;

        await eng.insert('sys_audit_log', row, { context: SYSTEM_CTX });
      } catch (err: any) {
        // Reported once per process, not once per settings write: a failure here
        // is systemic (the ledger is mounted but unreachable — DDL never ran,
        // the connection is down, the row was refused), so a line per write
        // would train a reader to skim the channel.
        if (failureReported) return;
        failureReported = true;
        const detail = String(err?.message ?? err);
        const message =
          'SettingsServicePlugin: config_change audit row NOT written — the settings write itself ' +
          'SUCCEEDED and is on disk, only its `sys_audit_log` entry is missing, and nothing retries it. ' +
          'The `config_changes` list view and any `action: "config_change"` filter will under-report ' +
          'until this is fixed (reported once per process). Cause: ' +
          detail +
          '. Fix: `sys_audit_log` IS registered on this deployment but the insert failed, so this is ' +
          'not the un-mounted case — confirm the table was provisioned (schema sync) and the ledger ' +
          'datasource is reachable. `sys_setting_audit` still carries the settings-specific trail.';
        try {
          // [#18368] The durability channel. The expectation — a host that
          // never mounted the ledger — is skipped above and never reaches here,
          // so what is left is AGENTS.md's durability degradation: a write that
          // claims to be audited is not, and the system keeps looking healthy.
          // ⛔ Not `(logger.error ?? logger.warn)(…)`: that spelling calls the
          // bare function, losing the receiver a class-based `Logger` needs.
          if (logger?.error) logger.error(message);
          else if (logger?.warn) logger.warn(message);
        } catch {
          /* logging must never break the audited write */
        }
      }
    },
  };
}
