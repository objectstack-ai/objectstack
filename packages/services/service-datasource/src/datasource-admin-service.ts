// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasourceAdminService — implements {@link IDatasourceAdminService}
 * (ADR-0015 Addendum) on top of injected persistence + secret + driver probe
 * callbacks.
 *
 * Like its federation sibling `ExternalDatasourceService`, this service is
 * intentionally decoupled from the kernel: every side effect (connection probe,
 * metadata read/write, secret write, bound-object count, hot pool (de)register)
 * is injected via {@link DatasourceAdminServiceConfig}, so the lifecycle rules
 * (origin gating, secret indirection, removal safety) are pure and unit-testable.
 *
 * Invariants enforced here, independent of the wiring:
 *  - Code-defined datasources (`origin: 'code'`) are read-only — update/remove
 *    reject them, and create refuses a name a code datasource already owns.
 *  - A runtime datasource never shadows a code one (code wins on collision).
 *  - Credentials never persist in cleartext: the cleartext {@link SecretInput}
 *    transits create/update/test only; create/update write it to the secret
 *    store and persist only the returned `credentialsRef`.
 *  - The read path never SERVES a credential, whatever a stored row holds
 *    (#8081): `getDatasource` redacts driver `config` through
 *    `datasource-config-redaction.ts`. That invariant is about what leaves this
 *    service, and is separate from the one above — rows written before #8078
 *    can and do hold inline cleartext, which is why it is stated on its own
 *    rather than treated as a consequence.
 *  - Removal is refused while objects are still bound to the datasource.
 */

import { validateDriverConfig } from '@objectstack/spec/data';
import { assertDatasourcePoolSupported } from './datasource-pool-support.js';
import { redactDatasourceConfig, restoreRedactedConfig } from './datasource-config-redaction.js';
import { planCredentialMigration } from './datasource-credential-migration.js';
import type {
  IDatasourceAdminService,
  DatasourceDraft,
  SecretInput,
  TestConnectionResult,
  DatasourceSummary,
  CredentialMigrationResult,
} from './contracts/index.js';
import type { Logger } from './logger.js';

/** Datasource name rule (mirrors `DatasourceSchema.name`). */
const NAME_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * A persisted datasource record (subset of `Datasource`). `origin` distinguishes
 * code-defined from runtime; `external.credentialsRef` is the opaque secret
 * handle — never a cleartext credential.
 */
export interface StoredDatasource {
  name: string;
  label?: string;
  driver: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  config?: Record<string, unknown>;
  external?: (Record<string, unknown> & { credentialsRef?: string }) | undefined;
  pool?: Record<string, unknown>;
  active?: boolean;
  /** Force a live connection at boot even when managed + unrouted (ADR-0062 D2(c)). */
  autoConnect?: boolean;
  origin?: 'code' | 'runtime';
  /** Package that defines a code-origin datasource, when known. */
  definedIn?: string;
}

/** What a connection probe needs (cleartext secret is transient, never stored). */
export interface ProbeInput {
  driver: string;
  config: Record<string, unknown>;
  /** Cleartext secret used for this probe only (e.g. password / DSN). */
  secret?: string;
  external?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Injected dependencies. The plugin supplies real implementations backed by the
 * driver registry, `IMetadataService` (runtime store), and the secret store;
 * tests supply fakes.
 */
export interface DatasourceAdminServiceConfig {
  /** Probe a connection live (driver connect + cheap round-trip). */
  probe: (input: ProbeInput) => Promise<TestConnectionResult>;
  /** Read every datasource record (code + runtime). */
  listDatasourceRecords: () => Promise<StoredDatasource[]>;
  /** Read one datasource record by name. */
  getDatasourceRecord: (name: string) => Promise<StoredDatasource | undefined>;
  /** Persist a runtime datasource record into the runtime metadata store. */
  putDatasourceRecord: (record: StoredDatasource) => Promise<void>;
  /** Remove a runtime datasource record from the runtime metadata store. */
  deleteDatasourceRecord: (name: string) => Promise<void>;
  /** Encrypt + store a secret, returning an opaque `credentialsRef`. */
  writeSecret: (input: SecretInput, hint: { name: string }) => Promise<string>;
  /** Best-effort delete of a stored secret by ref (cleanup on remove/rewrap). */
  removeSecret?: (credentialsRef: string) => Promise<void>;
  /**
   * Dereference a `credentialsRef` back to its cleartext — the secret store's
   * READ side (`SecretBinder.resolve`).
   *
   * Optional, and its absence is load-bearing rather than cosmetic: the connect
   * path is FAIL-CLOSED on a `credentialsRef` it cannot resolve (ADR-0062 D3),
   * so a host that can write secrets but not read them back would have every
   * ref-bearing datasource refuse to connect. {@link
   * DatasourceAdminService.migrateCredential} therefore refuses to run at all
   * without it — writing a ref it cannot verify is what would turn a working
   * datasource into a broken one (#8155).
   */
  readSecret?: (credentialsRef: string) => Promise<string | undefined>;
  /** Count objects bound to a datasource (removal blocked while > 0). */
  countBoundObjects: (datasource: string) => Promise<number>;
  /** Hot-(re)register a runtime datasource's connection pool after write. */
  registerPool?: (record: StoredDatasource) => Promise<void> | void;
  /** Tear down a runtime datasource's pool on remove. */
  unregisterPool?: (name: string) => Promise<void> | void;
  /**
   * Last connect verdict per datasource, from `DatasourceConnectionService`
   * (framework#3827). Absent (a host without the connection service) means the
   * list reports `unvalidated` throughout — the pre-#3827 behavior, and honest:
   * with nothing attempting connects there is genuinely no verdict to report.
   */
  connectionStates?: () => ReadonlyArray<{
    name: string;
    availability: 'available' | 'blocked' | 'failed' | 'unattempted';
    reason?: string;
  }>;
  logger?: Logger;
}

/** Map a connection verdict onto the admin list's `status` field. */
function summaryStatus(
  availability: 'available' | 'blocked' | 'failed' | 'unattempted' | undefined,
): DatasourceSummary['status'] {
  switch (availability) {
    case 'available':
      return 'ok';
    case 'blocked':
      return 'blocked';
    case 'failed':
      return 'error';
    // `unattempted` and "no record at all" are the same answer to the only
    // question this field asks: nobody has tried, so nothing is known.
    default:
      return 'unvalidated';
  }
}

/**
 * A copy of `record` whose driver `config` no longer carries `key`.
 *
 * Pure — the caller's stored record object is never mutated, so a concurrent
 * reader (the connect path holds raw records) is unaffected until the write
 * lands.
 */
function withoutConfigKey(record: StoredDatasource, key: string): StoredDatasource {
  const { [key]: _removed, ...config } = (record.config ?? {}) as Record<string, unknown>;
  return { ...record, config };
}

/** Spread `remaining` onto a result only when there is something to report. */
function withRemaining(remaining: string[]): { remaining?: string[] } {
  return remaining.length > 0 ? { remaining } : {};
}

export class DatasourceAdminService implements IDatasourceAdminService {
  constructor(private readonly config: DatasourceAdminServiceConfig) {}

  private get logger(): Logger | undefined {
    return this.config.logger;
  }

  async listDatasources(): Promise<DatasourceSummary[]> {
    const records = await this.config.listDatasourceRecords();

    // Group by name; code wins on collision, and a shadowed runtime row marks
    // the effective (code) entry as conflicting.
    const byName = new Map<string, { code?: StoredDatasource; runtime?: StoredDatasource }>();
    for (const rec of records) {
      const slot = byName.get(rec.name) ?? {};
      if (rec.origin === 'runtime') slot.runtime = rec;
      else slot.code = rec;
      byName.set(rec.name, slot);
    }

    // Last connect verdict per datasource (framework#3827). Without this the
    // `status` below was a constant, so a datasource that died at boot looked
    // exactly like one nobody had tested.
    const states = new Map(
      (this.config.connectionStates?.() ?? []).map((s) => [s.name, s]),
    );

    const summaries: DatasourceSummary[] = [];
    for (const [name, slot] of byName) {
      const effective = slot.code ?? slot.runtime;
      if (!effective) continue;
      const state = states.get(name);
      const status = summaryStatus(state?.availability);
      summaries.push({
        name,
        label: effective.label,
        driver: effective.driver,
        schemaMode: effective.schemaMode ?? 'managed',
        origin: slot.code ? 'code' : 'runtime',
        active: effective.active ?? true,
        status,
        ...(status !== 'ok' && status !== 'unvalidated' && state?.reason
          ? { statusReason: state.reason }
          : {}),
        ...(slot.code?.definedIn ? { definedIn: slot.code.definedIn } : {}),
        ...(slot.code && slot.runtime ? { conflictsWithCode: true } : {}),
      });
    }
    return summaries;
  }

  /**
   * Read one datasource's full detail for editing, with every stored credential
   * redacted out of `config` (#8081).
   *
   * Returns `config`, `origin`, a `hasSecret` flag so the UI can show "leave
   * blank to keep" without ever receiving the `credentialsRef`, and
   * `redactedConfigKeys` naming what was withheld. Returns `undefined` when the
   * name is unknown.
   *
   * ## The claim this comment used to make
   *
   * It said "with the credential stripped", and described `config` as
   * "non-sensitive — credentials live in `sys_secret`, never in config". Both
   * halves were false, and load-bearing: nothing here stripped anything, and
   * `config` was returned verbatim. A datasource row written before #8078
   * carries `config.password` / `config.authToken` in cleartext (that is the
   * whole reason #8078 exists), and this method served it — to every caller of
   * `GET /api/v1/datasources/:name` — under a comment asserting it could not.
   * A safety claim that no code performs is worse than no claim: it is what
   * stops the next reader from looking.
   *
   * What makes the claim true now is {@link redactDatasourceConfig}, which also
   * covers the credential the old sentence could not have described — the one
   * embedded in a `postgresql://user:pass@host` URL, which lives in `config`
   * and is not `config.password`. Refusing such a URL at the WRITE door remains
   * unruled (#7990) and is deliberately untouched here; hiding it on the way
   * out is a separate act and is what this method owes its callers.
   *
   * The stored record is not modified. Cleartext already at rest stays at rest
   * until the migration this card proposes runs — closing the read path is what
   * stops it being SERVED, not what removes it.
   */
  async getDatasource(name: string): Promise<
    | (Pick<StoredDatasource, 'name' | 'label' | 'driver' | 'schemaMode' | 'config' | 'active' | 'definedIn'> & {
        origin: 'code' | 'runtime';
        hasSecret: boolean;
        redactedConfigKeys: string[];
      })
    | undefined
  > {
    const rec = await this.config.getDatasourceRecord(name);
    if (!rec) return undefined;
    const hasSecret = Boolean(rec.external?.credentialsRef);
    const { config, redactedKeys } = redactDatasourceConfig(rec.driver, rec.config);
    return {
      name: rec.name,
      label: rec.label,
      driver: rec.driver,
      schemaMode: rec.schemaMode ?? 'managed',
      config,
      active: rec.active ?? true,
      origin: rec.origin === 'runtime' ? 'runtime' : 'code',
      hasSecret,
      redactedConfigKeys: redactedKeys,
      ...(rec.definedIn ? { definedIn: rec.definedIn } : {}),
    };
  }

  async testConnection(input: DatasourceDraft, secret?: SecretInput): Promise<TestConnectionResult> {
    if (!input?.driver) {
      return { ok: false, error: 'A driver is required to test a connection.' };
    }
    // Checked BEFORE the probe: a misspelled key makes the driver fall back to
    // its own defaults, so the probe would open a connection to localhost and
    // report a green "Connection successful" for a datasource that points
    // somewhere else entirely — the wizard's version of #4410's core bug.
    try {
      this.assertValidConfig(input.driver, input.config);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const queryTimeoutMs = (input.external as { queryTimeoutMs?: number } | undefined)?.queryTimeoutMs;
    try {
      return await this.config.probe({
        driver: input.driver,
        config: input.config ?? {},
        secret: secret?.value,
        external: input.external,
        ...(typeof queryTimeoutMs === 'number' ? { timeoutMs: queryTimeoutMs } : {}),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async createDatasource(input: DatasourceDraft, secret?: SecretInput): Promise<DatasourceSummary> {
    this.assertValidName(input?.name);
    if (!input.driver) throw new Error('A driver is required to create a datasource.');
    this.assertValidConfig(input.driver, input.config);
    // The wizard is a publish door for `pool` too (#5714). Rejected BEFORE the
    // record is persisted: `tryRegisterPool` swallows its failures into a
    // warning, so a datasource saved with an unhonourable pool would sit in the
    // store with the block still in it, exactly as silently as before.
    assertDatasourcePoolSupported({ driver: input.driver, pool: input.pool, name: input.name });

    const existing = await this.config.getDatasourceRecord(input.name);
    if (existing) {
      if (existing.origin === 'code' || existing.origin === undefined) {
        throw new Error(
          `Cannot create datasource '${input.name}': a code-defined datasource owns this name (read-only).`,
        );
      }
      throw new Error(`Datasource '${input.name}' already exists.`);
    }

    const record: StoredDatasource = {
      ...this.toRecord(input),
      origin: 'runtime',
    };

    if (secret) {
      const credentialsRef = await this.config.writeSecret(secret, { name: input.name });
      record.external = { ...(record.external ?? {}), credentialsRef };
    }

    await this.config.putDatasourceRecord(record);
    await this.tryRegisterPool(record);
    return this.toSummary(record);
  }

  async updateDatasource(
    name: string,
    patch: Partial<DatasourceDraft>,
    secret?: SecretInput,
  ): Promise<DatasourceSummary> {
    const existing = await this.config.getDatasourceRecord(name);
    if (!existing) throw new Error(`Datasource '${name}' not found.`);
    if (existing.origin !== 'runtime') {
      throw new Error(`Datasource '${name}' is code-defined and cannot be edited at runtime.`);
    }

    // Merge patch over the existing record; `name`/`origin` are never patched.
    const merged: StoredDatasource = {
      ...existing,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.driver !== undefined ? { driver: patch.driver } : {}),
      ...(patch.schemaMode !== undefined ? { schemaMode: patch.schemaMode } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
      ...(patch.pool !== undefined ? { pool: patch.pool } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      name: existing.name,
      origin: 'runtime',
    };
    if (patch.external !== undefined) {
      // Preserve the existing credentialsRef unless a new secret rewraps it.
      merged.external = { ...patch.external, credentialsRef: existing.external?.credentialsRef };
    }

    // Judged on the MERGED record, but only when this write actually touches
    // the pairing: a new `config`, or a new `driver` that reinterprets the
    // stored one. An edit that renames a datasource or flips `active` must not
    // be blocked by a config it is not touching — a record written before
    // #4410 would otherwise become uneditable, including the `active: false`
    // that takes a misconfigured datasource out of service.
    if (patch.config !== undefined || patch.driver !== undefined) {
      this.assertValidConfig(merged.driver, merged.config);
    }
    // Same judgement, same "only when this write touches the pairing" rule
    // (#5714): a new `pool`, or a new `driver` that reinterprets the stored
    // one. An edit that renames a datasource or flips `active` must not be
    // blocked by a pool block it is not touching — otherwise a record written
    // before this gate becomes uneditable, including the `active: false` that
    // takes it out of service.
    if (patch.pool !== undefined || patch.driver !== undefined) {
      assertDatasourcePoolSupported({ driver: merged.driver, pool: merged.pool, name });
    }

    if (secret) {
      const prevRef = existing.external?.credentialsRef;
      const credentialsRef = await this.config.writeSecret(secret, { name });
      merged.external = { ...(merged.external ?? {}), credentialsRef };
      if (prevRef && prevRef !== credentialsRef) await this.tryRemoveSecret(prevRef);
    }

    // Carry forward the credential material `getDatasource()` redacts (#8081)
    // — AFTER the gate above, and only when this patch is round-tripping the
    // same driver's config back.
    //
    // After, because the two judgements have different subjects. The gate
    // judges what the AUTHOR wrote, and #8078's refusal of an inline credential
    // is aimed at exactly that. This restore replaces material the author never
    // saw, was never offered the chance to write, and is not asking to change;
    // running the gate over it would refuse a legacy row for the contents of
    // its own stored config and make `active: false` — the way a misconfigured
    // datasource is taken out of service — unreachable on the rows most likely
    // to need it. Same shape as the `credentialsRef` preserved a few lines up,
    // which is likewise carried across a patch without being re-judged.
    //
    // Only when the driver is unchanged: a patch that re-points a datasource at
    // a different driver is rewiring the connection, and one driver's stored
    // credential is not evidence about another's.
    //
    // This preserves cleartext already at rest; it does not create any. Getting
    // that cleartext OUT of the store is the migration this card proposes
    // (scope item 3) and is deliberately not attempted here — a write path that
    // quietly dropped a credential the operator still depends on would be the
    // destructive sweep that decision is reserved for.
    if (patch.config !== undefined && merged.driver === existing.driver) {
      merged.config = restoreRedactedConfig(existing.driver, merged.config, existing.config);
    }

    await this.config.putDatasourceRecord(merged);
    await this.tryRegisterPool(merged);
    return this.toSummary(merged);
  }

  async removeDatasource(name: string): Promise<void> {
    const existing = await this.config.getDatasourceRecord(name);
    if (!existing) throw new Error(`Datasource '${name}' not found.`);
    if (existing.origin !== 'runtime') {
      throw new Error(`Datasource '${name}' is code-defined and cannot be removed at runtime.`);
    }

    const bound = await this.config.countBoundObjects(name);
    if (bound > 0) {
      throw new Error(
        `Cannot remove datasource '${name}': ${bound} object(s) are still bound to it.`,
      );
    }

    await this.config.deleteDatasourceRecord(name);
    if (existing.external?.credentialsRef) await this.tryRemoveSecret(existing.external.credentialsRef);
    await this.tryUnregisterPool(name);
  }

  /**
   * Re-home one runtime datasource's stored cleartext credential into
   * `sys_secret` (#8155) — the execution half of
   * {@link planCredentialMigration}.
   *
   * ## Ordering: durable secret first, cleartext removed last
   *
   * The card's hard requirement is that a crash must never leave the row
   * credential-less. The sequence here is bind → **read the secret back** →
   * one record write that adds the ref and drops the inline key together:
   *
   *  - Crash before the record write ⇒ the stored row is untouched and keeps
   *    working on its inline credential.
   *  - Crash after it ⇒ the row references a secret this run has already proved
   *    readable.
   *
   * ⛔ It deliberately does NOT write the ref first in a separate step and drop
   * the key in a second, which is the shape "durably written before" first
   * suggests. Measured reason: the connect path is fail-closed on a
   * `credentialsRef` (`failed-credentials` when it cannot resolve, ADR-0062 D3)
   * and never falls back to `config`, so a row carrying an unverified ref
   * ALONGSIDE its cleartext is not a safe intermediate state — it is a broken
   * datasource with a cleartext credential the connect path will not read. The
   * read-back is what makes the single write safe, and it is a stronger
   * durability proof than a write ordering: it is the same decrypt the connect
   * path will perform.
   *
   * ## Idempotency
   *
   * Compare-before-write, the discipline PR #8114's `headersPatch` established
   * after the orphan accumulation measured on #8103: a row that already
   * references a secret is never bound again. Re-running on a migrated row
   * writes nothing and returns `already-bound`; a row that still holds the
   * inline copy beside an existing ref has the copy dropped, reusing that ref.
   * The only window this cannot close is a process crash between the
   * `sys_secret` insert and the record write — the failure paths unbind the
   * secret they just minted, but a hard crash leaves one orphan row, which is
   * #8103's territory and not re-decided here.
   *
   * ## What it does not touch
   *
   * The live pool is left alone. The credential VALUE is unchanged — only where
   * it is read from moves — and `DatasourceConnectionService.connect()` is
   * idempotent for an already-registered driver, so re-registering would churn
   * a working connection to no effect.
   */
  async migrateCredential(name: string): Promise<CredentialMigrationResult> {
    const existing = await this.config.getDatasourceRecord(name);
    if (!existing) throw new Error(`Datasource '${name}' not found.`);

    const plan = planCredentialMigration(existing);
    if (plan.action === 'refuse') {
      return { name, status: 'refused', reason: plan.reason, remedy: plan.remedy };
    }
    if (plan.action === 'none') {
      return { name, status: plan.status, ...withRemaining(plan.remaining) };
    }

    // The secret store's READ side is a precondition, not a nicety — see
    // `readSecret` on the config type.
    if (!this.config.readSecret) {
      return this.refuse(
        name,
        'This host has no readable secret store wired (the secret binder exposes no `resolve`), so a '
          + 'bound credential could not be verified — and the connect path refuses a `credentialsRef` '
          + 'it cannot resolve, which would take this datasource out of service.',
        'Wire a SecretBinder with `resolve` (CryptoProvider + `sys_secret`) into '
          + 'DatasourceAdminServicePlugin, then run this action again.',
      );
    }

    if (plan.action === 'drop-inline') {
      // Never mint a second secret for a row that already references one. The
      // inline copy is the last cleartext copy, so it is dropped only once the
      // existing ref is proved resolvable.
      const resolved = await this.tryReadSecret(plan.credentialsRef);
      if (resolved == null || resolved === '') {
        return this.refuse(
          name,
          `Datasource '${name}' already references a stored secret, but it could not be resolved or `
            + 'decrypted (a missing `sys_secret` row, or a changed encryption key). Removing the inline '
            + 'credential would leave this datasource with no working credential at all.',
          'Re-enter the credential in the connection form\'s secret field — that rebinds it and '
            + 'replaces the unresolvable reference; the inline copy can then be removed.',
        );
      }
      await this.config.putDatasourceRecord(withoutConfigKey(existing, plan.key));
      this.logger?.info?.(
        `datasource '${name}': dropped inline 'config.${plan.key}' — the credential is already bound`,
      );
      return {
        name,
        status: 'migrated',
        migratedKey: plan.key,
        reusedExistingSecret: true,
        ...withRemaining(plan.remaining),
      };
    }

    const credentialsRef = await this.config.writeSecret({ value: plan.value }, { name });
    const readBack = await this.tryReadSecret(credentialsRef);
    if (readBack !== plan.value) {
      // The secret is not durably readable, so the cleartext stays exactly
      // where it is. Take the unusable row back out rather than leaving the
      // orphan #8103 measured.
      await this.tryRemoveSecret(credentialsRef);
      return this.refuse(
        name,
        `The credential for datasource '${name}' was written to the secret store but did not read back `
          + 'identically, so it is not durably recoverable. Nothing was changed: the stored credential is '
          + 'untouched and the datasource keeps working.',
        'Check the secret store (`sys_secret` writability, the crypto provider\'s key material), then '
          + 'run this action again.',
      );
    }

    const migrated: StoredDatasource = {
      ...withoutConfigKey(existing, plan.key),
      external: { ...(existing.external ?? {}), credentialsRef },
    };
    try {
      await this.config.putDatasourceRecord(migrated);
    } catch (err) {
      // The record still holds the cleartext and still works; the secret we
      // just minted has no referrer, so remove it rather than orphan it.
      await this.tryRemoveSecret(credentialsRef);
      throw err;
    }
    this.logger?.info?.(
      `datasource '${name}': credential re-homed from 'config.${plan.key}' into the secret store`,
    );
    return {
      name,
      status: 'migrated',
      migratedKey: plan.key,
      reusedExistingSecret: false,
      ...withRemaining(plan.remaining),
    };
  }

  // --- internals -----------------------------------------------------------

  /** A refusal that leaves everything at rest exactly as it was. */
  private refuse(name: string, reason: string, remedy: string): CredentialMigrationResult {
    return { name, status: 'refused', reason, remedy };
  }

  /** Read a secret back, treating any failure as "not readable". */
  private async tryReadSecret(credentialsRef: string): Promise<string | undefined> {
    try {
      return await this.config.readSecret?.(credentialsRef);
    } catch (err) {
      this.logger?.warn?.(`readSecret('${credentialsRef}') failed`, err);
      return undefined;
    }
  }

  /**
   * Reject a `config` that does not satisfy its driver's contract (#4410).
   *
   * The wizard is the OTHER authoring surface for a datasource, and it does not
   * reach `DatasourceSchema`: `createDatasource` writes through
   * `metadata.register`, whose validation is a structural `name`/`label` check,
   * not a zod parse. So a `config` typed into the Setup form was accepted here
   * even after the spec gate landed — the same silent acceptance, one door
   * along. Both doors now consult the same registry.
   *
   * A driver the platform ships no contract for passes untouched, matching the
   * spec gate's boundary rather than inventing a stricter one for the UI.
   */
  private assertValidConfig(driver: string, config: unknown): void {
    const result = validateDriverConfig(driver, config);
    if (!result.known || result.issues.length === 0) return;
    const detail = result.issues
      .map((issue) => (issue.path.length ? `config.${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('\n');
    throw new Error(`Invalid configuration for driver '${driver}'.\n${detail}`);
  }

  private assertValidName(name: string | undefined): void {
    if (!name || !NAME_RE.test(name)) {
      throw new Error(
        `Invalid datasource name '${name ?? ''}': must match /^[a-z_][a-z0-9_]*$/.`,
      );
    }
    // Host-owned reserved name (#3826): the runtime declares and connects
    // `default` itself (DefaultDatasourcePlugin); a runtime-created pool under
    // that name would shadow the primary datasource's row and confuse routing.
    if (name === 'default') {
      throw new Error(
        `Datasource name 'default' is reserved for the host's primary datasource. Pick another name.`,
      );
    }
  }

  private toRecord(input: DatasourceDraft): StoredDatasource {
    return {
      name: input.name,
      ...(input.label !== undefined ? { label: input.label } : {}),
      driver: input.driver,
      ...(input.schemaMode !== undefined ? { schemaMode: input.schemaMode } : {}),
      ...(input.config !== undefined ? { config: input.config } : {}),
      ...(input.external !== undefined ? { external: input.external } : {}),
      ...(input.pool !== undefined ? { pool: input.pool } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
  }

  private toSummary(record: StoredDatasource): DatasourceSummary {
    // Returned from create/update, i.e. right after `tryRegisterPool` — so the
    // connect verdict for this write is already recorded and worth reporting:
    // a "Save" that silently failed to open the pool is exactly the case the
    // wizard must not present as success (framework#3827).
    const state = this.config.connectionStates?.().find((s) => s.name === record.name);
    const status = summaryStatus(state?.availability);
    return {
      name: record.name,
      label: record.label,
      driver: record.driver,
      schemaMode: record.schemaMode ?? 'managed',
      origin: record.origin ?? 'runtime',
      active: record.active ?? true,
      status,
      ...(status !== 'ok' && status !== 'unvalidated' && state?.reason
        ? { statusReason: state.reason }
        : {}),
    };
  }

  private async tryRegisterPool(record: StoredDatasource): Promise<void> {
    try {
      await this.config.registerPool?.(record);
    } catch (err) {
      this.logger?.warn(`registerPool('${record.name}') failed`, err);
    }
  }

  private async tryUnregisterPool(name: string): Promise<void> {
    try {
      await this.config.unregisterPool?.(name);
    } catch (err) {
      this.logger?.warn(`unregisterPool('${name}') failed`, err);
    }
  }

  private async tryRemoveSecret(credentialsRef: string): Promise<void> {
    try {
      await this.config.removeSecret?.(credentialsRef);
    } catch (err) {
      this.logger?.warn(`removeSecret('${credentialsRef}') failed`, err);
    }
  }
}
