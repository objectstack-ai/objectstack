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
 *  - Removal is refused while objects are still bound to the datasource.
 */

import type {
  IDatasourceAdminService,
  DatasourceDraft,
  SecretInput,
  TestConnectionResult,
  DatasourceSummary,
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
  /** Count objects bound to a datasource (removal blocked while > 0). */
  countBoundObjects: (datasource: string) => Promise<number>;
  /** Hot-(re)register a runtime datasource's connection pool after write. */
  registerPool?: (record: StoredDatasource) => Promise<void> | void;
  /** Tear down a runtime datasource's pool on remove. */
  unregisterPool?: (name: string) => Promise<void> | void;
  logger?: Logger;
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

    const summaries: DatasourceSummary[] = [];
    for (const [name, slot] of byName) {
      const effective = slot.code ?? slot.runtime;
      if (!effective) continue;
      summaries.push({
        name,
        label: effective.label,
        driver: effective.driver,
        schemaMode: effective.schemaMode ?? 'managed',
        origin: slot.code ? 'code' : 'runtime',
        active: effective.active ?? true,
        status: 'unvalidated',
        ...(slot.code?.definedIn ? { definedIn: slot.code.definedIn } : {}),
        ...(slot.code && slot.runtime ? { conflictsWithCode: true } : {}),
      });
    }
    return summaries;
  }

  async testConnection(input: DatasourceDraft, secret?: SecretInput): Promise<TestConnectionResult> {
    if (!input?.driver) {
      return { ok: false, error: 'A driver is required to test a connection.' };
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

    if (secret) {
      const prevRef = existing.external?.credentialsRef;
      const credentialsRef = await this.config.writeSecret(secret, { name });
      merged.external = { ...(merged.external ?? {}), credentialsRef };
      if (prevRef && prevRef !== credentialsRef) await this.tryRemoveSecret(prevRef);
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

  // --- internals -----------------------------------------------------------

  private assertValidName(name: string | undefined): void {
    if (!name || !NAME_RE.test(name)) {
      throw new Error(
        `Invalid datasource name '${name ?? ''}': must match /^[a-z_][a-z0-9_]*$/.`,
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
    return {
      name: record.name,
      label: record.label,
      driver: record.driver,
      schemaMode: record.schemaMode ?? 'managed',
      origin: record.origin ?? 'runtime',
      active: record.active ?? true,
      status: 'unvalidated',
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
