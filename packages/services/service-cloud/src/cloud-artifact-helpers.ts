// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared helpers for cloud-artifact-api-plugin.
 */

import { createHash } from 'node:crypto';
import type { IDataDriver } from '@objectstack/spec/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SysProjectRow {
    id: string;
    organization_id?: string;
    hostname?: string;
    database_driver?: string;
    database_url?: string;
    database_auth_token?: string;
    metadata?: Record<string, unknown> | string;
    is_system?: boolean | number;
    visibility?: 'private' | 'unlisted' | 'public';
}

export interface SysCredentialRow {
    id: string;
    project_id: string;
    database_driver?: string;
    database_url?: string;
    database_auth_token?: string;
    /** The encrypted (or, with NoopSecretEncryptor, plaintext) DB secret. */
    secret_ciphertext?: string;
}

export interface SysProjectRevisionRow {
    id: string;
    project_id: string;
    commit_id: string;
    checksum?: string;
    storage_key: string;
    storage_adapter?: string;
    size_bytes?: number;
    built_at?: string;
    built_with?: string;
    published_by?: string;
    published_at?: string;
    note?: string;
    is_current: boolean;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function ok<T>(data: T) { return { success: true, data }; }
export function fail(message: string, _status = 400) { return { success: false, error: message }; }

export function parseMetadata(raw: any): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) ?? {}; } catch { return {}; }
    }
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    return {};
}

export function extractArtifactPaths(metadata: Record<string, unknown>): string[] {
    const out: string[] = [];
    const single = metadata.artifact_path;
    if (typeof single === 'string') out.push(single);
    const list = metadata.artifact_paths;
    if (Array.isArray(list)) {
        for (const p of list) if (typeof p === 'string') out.push(p);
    }
    return out;
}

export function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

/**
 * Known per-category metadata keys recognised by ObjectOS at boot.
 */
export const KNOWN_METADATA_CATEGORIES = new Set([
    'objects', 'fields', 'views', 'apps', 'pages', 'dashboards', 'reports',
    'flows', 'workflows', 'triggers', 'agents', 'tools', 'skills',
    'permissions', 'permissionSets', 'roles', 'profiles', 'translations',
    'datasources', 'datasets', 'actions', 'apis', 'i18n', 'sharingRules',
    'ragPipelines', 'data',
]);

/**
 * Merge metadata blocks from multiple artifact bundles into a single envelope.
 */
export function mergeArtifactMetadata(bundles: any[]): Record<string, any[]> {
    const merged: Record<string, any[]> = {};

    const ingest = (source: Record<string, any>) => {
        for (const [key, value] of Object.entries(source)) {
            if (!Array.isArray(value)) continue;
            if (!KNOWN_METADATA_CATEGORIES.has(key) && key !== 'manifest') {
                if (typeof key !== 'string') continue;
            }
            const bucket = merged[key] ?? (merged[key] = []);
            bucket.push(...value);
        }
    };

    for (const b of bundles) {
        if (!b || typeof b !== 'object') continue;
        const nested = (b as any).metadata;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            ingest(nested);
        }
        ingest(b as Record<string, any>);
    }
    return merged;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

export async function resolveProjectByHost(driver: IDataDriver, host: string): Promise<SysProjectRow | null> {
    if (!host) return null;
    const direct = await (driver.findOne as any)('sys_project', { where: { hostname: host } });
    if (direct) return direct as SysProjectRow;
    const wildcard = await (driver.findOne as any)('sys_project', { where: { hostname: '*' } });
    if (wildcard) return wildcard as SysProjectRow;
    return null;
}

export async function readProjectCredentials(driver: IDataDriver, projectId: string): Promise<SysCredentialRow | null> {
    try {
        const row = await (driver.findOne as any)('sys_project_credential', {
            where: { project_id: projectId },
        });
        return (row ?? null) as SysCredentialRow | null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Publish helper — shared by POST /cloud/projects/:id/metadata and the
// MultiProjectPlugin template seeder. Uploads the artifact bundle to the
// configured storage adapter and inserts/refreshes a sys_project_revision
// row so the next GET /cloud/projects/:id/artifact resolves it.
// ---------------------------------------------------------------------------

export interface PublishProjectRevisionParams {
    /** Control-plane data driver (sys_project / sys_project_revision). */
    driver: IDataDriver;
    /** Storage adapter (R2, S3, local FS) — must implement upload/exists. */
    storage: { upload: (key: string, data: Buffer) => Promise<void>; exists: (key: string) => Promise<boolean> };
    /** Storage adapter name persisted on the revision row. */
    storageAdapter: string;
    /** Storage key prefix (defaults to `artifacts`). */
    keyPrefix?: string;
    /** Project row (id + organization_id are required). */
    project: { id: string; organization_id?: string | null };
    /** Artifact body — already-shaped JSON object (will be JSON-serialised). */
    bundle: any;
    /** Optional commit id override; defaults to the first 16 hex chars of the body hash. */
    commitId?: string;
    /** Branch name for branch-head book-keeping; defaults to `main`. */
    branch?: string;
    /** Optional note attached to the revision. */
    note?: string;
}

export interface PublishProjectRevisionResult {
    commitId: string;
    revisionId: string;
    storageKey: string;
    checksum: string;
    created: boolean;
}

export async function publishProjectRevision(
    params: PublishProjectRevisionParams,
): Promise<PublishProjectRevisionResult> {
    const { driver, storage, storageAdapter, project, bundle, note } = params;
    const keyPrefix = params.keyPrefix ?? 'artifacts';
    const branch = (params.branch ?? 'main').trim() || 'main';

    const bodyStr = JSON.stringify(bundle ?? {});
    const bodyBuf = Buffer.from(bodyStr, 'utf-8');
    const fullHash = sha256Hex(bodyStr);
    const commitId = params.commitId ?? fullHash.slice(0, 16);
    const checksum = (bundle as any)?.checksum && typeof (bundle as any).checksum === 'string'
        ? (bundle as any).checksum
        : fullHash;
    const orgId = project.organization_id ?? null;
    const storageKey = orgId
        ? `${keyPrefix}/orgs/${orgId}/projects/${project.id}/${commitId}.json`
        : `${keyPrefix}/${project.id}/${commitId}.json`;

    if (!(await storage.exists(storageKey))) {
        await storage.upload(storageKey, bodyBuf);
    }

    let created = false;
    let revisionId: string;
    const existing = await (driver.findOne as any)('sys_project_revision', {
        where: { project_id: project.id, commit_id: commitId },
    });
    if (existing) {
        revisionId = existing.id;
        if (!existing.is_current) {
            try {
                const oldCurrent = await (driver.findOne as any)('sys_project_revision', {
                    where: { project_id: project.id, is_current: true },
                });
                if (oldCurrent && oldCurrent.id !== existing.id) {
                    await (driver.update as any)('sys_project_revision', oldCurrent.id, { is_current: false });
                }
            } catch { /* table may not exist yet */ }
            await (driver.update as any)('sys_project_revision', existing.id, { is_current: true });
        }
    } else {
        try {
            const oldCurrent = await (driver.findOne as any)('sys_project_revision', {
                where: { project_id: project.id, is_current: true },
            });
            if (oldCurrent) {
                await (driver.update as any)('sys_project_revision', oldCurrent.id, { is_current: false });
            }
        } catch { /* ok */ }
        const { randomUUID } = await import('node:crypto');
        revisionId = randomUUID();
        await (driver.create as any)('sys_project_revision', {
            id: revisionId,
            project_id: project.id,
            commit_id: commitId,
            checksum,
            storage_key: storageKey,
            storage_adapter: storageAdapter,
            size_bytes: bodyBuf.byteLength,
            built_at: (bundle as any)?.builtAt ?? new Date().toISOString(),
            built_with: (bundle as any)?.builtWith ? JSON.stringify((bundle as any).builtWith) : null,
            published_at: new Date().toISOString(),
            note: note ?? null,
            is_current: true,
            branch,
            is_branch_head: true,
        });
        created = true;
    }

    return { commitId, revisionId, storageKey, checksum, created };
}

export function buildRuntimeBlock(project: SysProjectRow, cred: SysCredentialRow | null) {
    const driver = (cred?.database_driver ?? project.database_driver ?? '').trim();
    const url = (cred?.database_url ?? project.database_url ?? '').trim();
    if (!driver || !url) return undefined;
    const out: Record<string, any> = {
        organizationId: project.organization_id,
        hostname: project.hostname,
        databaseDriver: driver,
        databaseUrl: url,
    };
    const token = cred?.database_auth_token
        ?? cred?.secret_ciphertext
        ?? project.database_auth_token;
    if (token) out.databaseAuthToken = token;
    return out;
}
