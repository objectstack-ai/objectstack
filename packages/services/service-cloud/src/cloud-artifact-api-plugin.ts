// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cloud-side Artifact API plugin (P0 + P1).
 *
 * P0: Pluggable storage via IStorageService (fallback to local FS with warning).
 * P1: Version history via sys_project_revision, commit-aware GET, rollback.
 *
 * Endpoints:
 *   GET  /cloud/resolve-hostname?host=...
 *   GET  /cloud/projects/:id/artifact[?commit=...]
 *   POST /cloud/projects/:id/metadata
 *   GET  /cloud/projects/:id/revisions?limit=&cursor=
 *   POST /cloud/projects/:id/revisions/:commit/activate
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve as resolvePath, isAbsolute, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IHttpServer, IDataDriver } from '@objectstack/spec/contracts';
import type { IStorageService } from '@objectstack/spec/contracts';
import {
    ok, fail, parseMetadata, extractArtifactPaths, sha256Hex,
    mergeArtifactMetadata, resolveProjectByHost, readProjectCredentials,
    buildRuntimeBlock,
} from './cloud-artifact-helpers.js';
import type { SysProjectRow } from './cloud-artifact-helpers.js';

type AnyContext = any;

export interface CloudArtifactApiPluginOptions {
    /** Promise resolving to the control-plane driver. */
    controlDriverPromise: Promise<{ driver: IDataDriver; driverName: string; databaseUrl: string }>;
    /** API prefix (default `/api/v1`). */
    apiPrefix?: string;
    /** Filesystem root for relative `artifact_path` values (default `process.cwd()`). */
    artifactRoot?: string;
    /** Bearer token required on requests. */
    apiKey?: string;
    /** Pluggable storage backend. When omitted, tries kernel's `file-storage` service; falls back to local FS. */
    storage?: {
        service?: 'file-storage' | IStorageService;
        keyPrefix?: string;
    };
}

// ---------------------------------------------------------------------------
// Local-FS fallback adapter (mirrors IStorageService subset)
// ---------------------------------------------------------------------------

interface StorageLike {
    upload(key: string, data: Buffer): Promise<void>;
    download(key: string): Promise<Buffer>;
    exists(key: string): Promise<boolean>;
}

function createLocalFsStorage(root: string): StorageLike {
    const abs = (key: string) => resolvePath(root, key);
    return {
        async upload(key, data) {
            const p = abs(key);
            await mkdir(dirname(p), { recursive: true });
            await writeFile(p, data);
        },
        async download(key) {
            return readFile(abs(key));
        },
        async exists(key) {
            try { await readFile(abs(key)); return true; } catch { return false; }
        },
    };
}

// ---------------------------------------------------------------------------
// Legacy local-file reader (for backward-compat artifact_path rows)
// ---------------------------------------------------------------------------

async function readArtifactFile(absPath: string): Promise<any | null> {
    try {
        const raw = await readFile(absPath, 'utf-8');
        return JSON.parse(raw);
    } catch (err: any) {
        console.warn(`[CloudArtifactAPI] Failed to read artifact '${absPath}': ${err?.message ?? err}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createCloudArtifactApiPlugin(options: CloudArtifactApiPluginOptions): any {
    const prefix = options.apiPrefix ?? '/api/v1';
    const artifactRoot = options.artifactRoot ?? process.env.OS_PROJECT_ARTIFACT_ROOT ?? process.cwd();
    const requiredKey = options.apiKey ?? process.env.OS_CLOUD_API_KEY;
    const keyPrefix = options.storage?.keyPrefix ?? 'artifacts';

    return {
        name: 'com.objectstack.cloud.artifact-api',
        version: '2.0.0',
        init: async (_ctx: AnyContext) => {},
        start: async (ctx: AnyContext) => {
            let server: IHttpServer | undefined;
            try { server = ctx.getService('http.server') as IHttpServer | undefined; } catch { return; }
            if (!server) return;

            // --- Resolve storage backend ---
            let storage: StorageLike | null = null;
            let storageAdapterName = 'local-fs';

            // 1. Explicit IStorageService instance
            if (options.storage?.service && typeof options.storage.service !== 'string') {
                storage = options.storage.service as unknown as StorageLike;
                storageAdapterName = 'file-storage:custom';
            }
            // 2. Kernel's file-storage service
            if (!storage) {
                try {
                    const svc = ctx.getService('file-storage') as IStorageService | undefined;
                    if (svc && typeof svc.upload === 'function') {
                        storage = svc as unknown as StorageLike;
                        storageAdapterName = 'file-storage';
                    }
                } catch { /* not registered */ }
            }
            // 3. Fallback to local filesystem
            if (!storage) {
                console.warn(
                    '[CloudArtifactAPI] No IStorageService registered (file-storage). ' +
                    'Falling back to local filesystem at ' + artifactRoot + '. ' +
                    'Register StorageServicePlugin for S3/production deployments.',
                );
                storage = createLocalFsStorage(artifactRoot);
                storageAdapterName = 'local-fs';
            }

            // --- Helpers ---
            const checkAuth = (req: any): { ok: true } | { ok: false; status: number; body: any } => {
                if (!requiredKey) return { ok: true };
                const header = (req.headers?.authorization ?? req.headers?.Authorization ?? '') as string;
                const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
                if (token === requiredKey) return { ok: true };
                return { ok: false, status: 401, body: { success: false, error: 'Unauthorized' } };
            };

            const getDriver = async (): Promise<IDataDriver | null> => {
                try {
                    const { driver } = await options.controlDriverPromise;
                    return driver ?? null;
                } catch (err: any) {
                    console.error('[CloudArtifactAPI] control driver unavailable:', err?.message ?? err);
                    return null;
                }
            };

            // Storage key shape:
            //   ${keyPrefix}/orgs/${orgId}/projects/${projectId}/${commitId}.json
            //
            // Org-first prefixing makes per-tenant cleanup, billing, IAM
            // bucket policies (e.g. allow read-only on `orgs/<id>/*`),
            // and data-export much easier in a multi-tenant cloud.
            //
            // Falls back to the legacy `${keyPrefix}/${projectId}/${commitId}.json`
            // shape when the project has no organization_id (single-tenant
            // installs / very old data); the GET path always reads the
            // exact key from `sys_project_revision.storage_key` so historical
            // rows keep working regardless of layout.
            const storageKey = (orgId: string | null | undefined, projectId: string, commitId: string) =>
                orgId
                    ? `${keyPrefix}/orgs/${orgId}/projects/${projectId}/${commitId}.json`
                    : `${keyPrefix}/${projectId}/${commitId}.json`;

            // ================================================================
            // GET /cloud/resolve-hostname?host=...
            // ================================================================
            server.get(`${prefix}/cloud/resolve-hostname`, async (req: any, res: any) => {
                const auth = checkAuth(req);
                if (!auth.ok) return res.status(auth.status).json(auth.body);
                const host = String(req.query?.host ?? req.query?.hostname ?? '').trim();
                if (!host) return res.status(400).json(fail('host query parameter is required'));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const project = await resolveProjectByHost(driver, host);
                if (!project) return res.status(404).json(fail(`No project bound to hostname '${host}'`, 404));

                const cred = await readProjectCredentials(driver, project.id);
                const runtime = buildRuntimeBlock(project, cred);
                return res.json(ok({ projectId: project.id, organizationId: project.organization_id, runtime }));
            });

            // ================================================================
            // GET /cloud/projects/:id/artifact[?commit=...]
            // ================================================================
            server.get(`${prefix}/cloud/projects/:id/artifact`, async (req: any, res: any) => {
                const auth = checkAuth(req);
                if (!auth.ok) return res.status(auth.status).json(auth.body);
                const projectId = String(req.params?.id ?? '').trim();
                if (!projectId) return res.status(400).json(fail('project id required'));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const project = (await (driver.findOne as any)('sys_project', { where: { id: projectId } })) as SysProjectRow | null;
                if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));

                const requestedCommit = String(req.query?.commit ?? '').trim();

                // --- Try loading from storage via revision table (P1 path) ---
                let revisionBundle: any | null = null;
                let revisionRow: any = null;
                try {
                    let rev: any = null;
                    if (requestedCommit) {
                        rev = await (driver.findOne as any)('sys_project_revision', {
                            where: { project_id: projectId, commit_id: requestedCommit },
                        });
                        if (!rev) return res.status(404).json(fail(`Revision '${requestedCommit}' not found for project '${projectId}'`, 404));
                    } else {
                        rev = await (driver.findOne as any)('sys_project_revision', {
                            where: { project_id: projectId, is_current: true },
                        });
                    }
                    if (rev?.storage_key) {
                        const exists = await storage!.exists(rev.storage_key);
                        if (exists) {
                            const buf = await storage!.download(rev.storage_key);
                            revisionBundle = JSON.parse(buf.toString('utf-8'));
                            revisionRow = rev;
                        }
                    }
                } catch (err: any) {
                    // Revision table may not exist yet (pre-migration); fall through to legacy path.
                    console.warn('[CloudArtifactAPI] revision lookup failed, falling through to legacy path:', err?.message);
                }

                // --- Legacy path: read from artifact_path on disk ---
                const bundles: any[] = [];
                if (revisionBundle) {
                    bundles.push(revisionBundle);
                } else {
                    const metadata = parseMetadata(project.metadata);
                    const paths = extractArtifactPaths(metadata);
                    for (const p of paths) {
                        const abs = isAbsolute(p) ? p : resolvePath(artifactRoot, p);
                        const bundle = await readArtifactFile(abs);
                        if (bundle) bundles.push(bundle);
                    }
                }

                const cred = await readProjectCredentials(driver, project.id);
                const runtime = buildRuntimeBlock(project, cred);

                const first = bundles[0] ?? {};
                const mergedMetadata = mergeArtifactMetadata(bundles);
                const functions = bundles.flatMap((b) => Array.isArray(b?.functions) ? b.functions : []);
                const manifest = first.manifest ?? { plugins: [], drivers: [], engines: {} };
                // Prefer revision row's identity (authoritative for published artifacts);
                // fall back to bundle's own commitId; finally synthesize from content.
                const commitId = revisionRow?.commit_id
                    ?? first.commitId
                    ?? sha256Hex(JSON.stringify(mergedMetadata) + ':' + JSON.stringify(functions)).slice(0, 16);
                // checksum: ProjectArtifactSchema requires a 64-char hex string.
                const computedChecksumHex = sha256Hex(JSON.stringify({ mergedMetadata, functions, manifest }));
                const firstChecksum = typeof first.checksum === 'string'
                    ? first.checksum
                    : (first.checksum?.value ?? undefined);
                const checksum = revisionRow?.checksum ?? firstChecksum ?? computedChecksumHex;

                const envelope = {
                    schemaVersion: '0.1',
                    projectId: project.id,
                    commitId,
                    checksum,
                    metadata: mergedMetadata,
                    functions,
                    manifest,
                    builtAt: first.builtAt ?? new Date().toISOString(),
                    builtWith: first.builtWith,
                    runtime,
                };
                return res.json(ok(envelope));
            });

            // ================================================================
            // POST /cloud/projects/:id/metadata
            // ================================================================
            server.post(`${prefix}/cloud/projects/:id/metadata`, async (req: any, res: any) => {
                const auth = checkAuth(req);
                if (!auth.ok) return res.status(auth.status).json(auth.body);
                const projectId = String(req.params?.id ?? '').trim();
                if (!projectId) return res.status(400).json(fail('project id required'));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const project = (await (driver.findOne as any)('sys_project', { where: { id: projectId } })) as SysProjectRow | null;
                if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));

                const body = req.body ?? {};
                if (typeof body !== 'object' || Array.isArray(body)) {
                    return res.status(400).json(fail('Request body must be a JSON object'));
                }

                const bodyStr = JSON.stringify(body);
                const bodyBuf = Buffer.from(bodyStr, 'utf-8');
                const fullHash = sha256Hex(bodyStr);
                const commitId = (body as any).commitId ?? fullHash.slice(0, 16);
                // ProjectArtifactSchema demands a 64-char hex string for checksum.
                const incomingChecksum = (body as any).checksum;
                const checksum = typeof incomingChecksum === 'string'
                    ? incomingChecksum
                    : (incomingChecksum?.value ?? fullHash);
                const key = storageKey(project.organization_id, projectId, commitId);

                // 1. Upload to storage (content-addressable: skip if same key exists)
                try {
                    const exists = await storage!.exists(key);
                    if (!exists) {
                        await storage!.upload(key, bodyBuf);
                    }
                } catch (err: any) {
                    console.error('[CloudArtifactAPI] Failed to upload artifact:', err?.message ?? err);
                    return res.status(500).json(fail('Failed to persist artifact', 500));
                }

                // 2. Insert revision row + flip is_current
                let revisionCreated = false;
                try {
                    // Check if revision already exists for this commit
                    const existing = await (driver.findOne as any)('sys_project_revision', {
                        where: { project_id: projectId, commit_id: commitId },
                    });

                    if (!existing) {
                        // Flip old current → false
                        try {
                            const oldCurrent = await (driver.findOne as any)('sys_project_revision', {
                                where: { project_id: projectId, is_current: true },
                            });
                            if (oldCurrent) {
                                await (driver.update as any)('sys_project_revision', oldCurrent.id, { is_current: false });
                            }
                        } catch { /* table may not exist yet */ }

                        await (driver.create as any)('sys_project_revision', {
                            id: randomUUID(),
                            project_id: projectId,
                            commit_id: commitId,
                            checksum: typeof checksum === 'string' ? checksum : fullHash,
                            storage_key: key,
                            storage_adapter: storageAdapterName,
                            size_bytes: bodyBuf.byteLength,
                            built_at: (body as any).builtAt ?? new Date().toISOString(),
                            built_with: (body as any).builtWith ? JSON.stringify((body as any).builtWith) : null,
                            published_at: new Date().toISOString(),
                            note: (body as any).note ?? (req.query?.note ? String(req.query.note) : null),
                            is_current: true,
                        });
                        revisionCreated = true;
                    } else {
                        // Re-publish same commit: just ensure it's current
                        if (!existing.is_current) {
                            try {
                                const oldCurrent = await (driver.findOne as any)('sys_project_revision', {
                                    where: { project_id: projectId, is_current: true },
                                });
                                if (oldCurrent && oldCurrent.id !== existing.id) {
                                    await (driver.update as any)('sys_project_revision', oldCurrent.id, { is_current: false });
                                }
                            } catch { /* ok */ }
                            await (driver.update as any)('sys_project_revision', existing.id, { is_current: true });
                        }
                        revisionCreated = false;
                    }
                } catch (err: any) {
                    // Non-fatal: revision table may not be migrated yet.
                    console.warn('[CloudArtifactAPI] Failed to write revision row (table may not exist yet):', err?.message);
                }

                // 3. Update sys_project.metadata.current_commit_id (and legacy artifact_path)
                const existingMeta = parseMetadata(project.metadata);
                const updatedMeta = { ...existingMeta, current_commit_id: commitId, artifact_storage_key: key };
                try {
                    await (driver.update as any)('sys_project', projectId, { metadata: JSON.stringify(updatedMeta) });
                } catch (err: any) {
                    console.error('[CloudArtifactAPI] Failed to update project metadata:', err?.message ?? err);
                }

                return res.json(ok({
                    projectId,
                    commitId,
                    checksum,
                    storageKey: key,
                    revisionCreated,
                }));
            });

            // ================================================================
            // GET /cloud/projects/:id/revisions?limit=&cursor=
            // ================================================================
            server.get(`${prefix}/cloud/projects/:id/revisions`, async (req: any, res: any) => {
                const auth = checkAuth(req);
                if (!auth.ok) return res.status(auth.status).json(auth.body);
                const projectId = String(req.params?.id ?? '').trim();
                if (!projectId) return res.status(400).json(fail('project id required'));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '20', 10) || 20, 1), 100);
                const cursor = String(req.query?.cursor ?? '').trim();

                try {
                    const query: any = {
                        where: { project_id: projectId },
                        orderBy: [{ field: 'published_at', direction: 'desc' }],
                        limit: limit + 1,
                    };
                    if (cursor) {
                        query.where.published_at = { $lt: cursor };
                    }
                    const rows = await (driver.find as any)('sys_project_revision', query);
                    const hasMore = rows.length > limit;
                    const items = hasMore ? rows.slice(0, limit) : rows;
                    const nextCursor = hasMore ? items[items.length - 1]?.published_at : undefined;

                    return res.json(ok({
                        items: items.map((r: any) => ({
                            commitId: r.commit_id,
                            checksum: r.checksum,
                            storageKey: r.storage_key,
                            sizeBytes: r.size_bytes,
                            builtAt: r.built_at,
                            publishedAt: r.published_at,
                            publishedBy: r.published_by,
                            note: r.note,
                            isCurrent: !!r.is_current,
                        })),
                        nextCursor,
                    }));
                } catch (err: any) {
                    console.error('[CloudArtifactAPI] Failed to list revisions:', err?.message ?? err);
                    return res.status(500).json(fail('Failed to list revisions', 500));
                }
            });

            // ================================================================
            // POST /cloud/projects/:id/revisions/:commit/activate
            // ================================================================
            server.post(`${prefix}/cloud/projects/:id/revisions/:commit/activate`, async (req: any, res: any) => {
                const auth = checkAuth(req);
                if (!auth.ok) return res.status(auth.status).json(auth.body);
                const projectId = String(req.params?.id ?? '').trim();
                const commitId = String(req.params?.commit ?? '').trim();
                if (!projectId || !commitId) return res.status(400).json(fail('project id and commit id required'));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                try {
                    // Accept full commit id or a 12+ char prefix (matches the
                    // 12-char display in the Studio recent-revisions list).
                    let target = await (driver.findOne as any)('sys_project_revision', {
                        where: { project_id: projectId, commit_id: commitId },
                    });
                    if (!target && commitId.length >= 8) {
                        const candidates = await (driver.find as any)('sys_project_revision', {
                            where: { project_id: projectId, commit_id: { $like: `${commitId}%` } },
                            limit: 2,
                        });
                        if (Array.isArray(candidates) && candidates.length === 1) {
                            target = candidates[0];
                        } else if (Array.isArray(candidates) && candidates.length > 1) {
                            return res.status(409).json(fail(`Commit prefix '${commitId}' is ambiguous (${candidates.length} matches)`, 409));
                        }
                    }
                    if (!target) return res.status(404).json(fail(`Revision '${commitId}' not found`, 404));

                    // Flip old current → false
                    const oldCurrent = await (driver.findOne as any)('sys_project_revision', {
                        where: { project_id: projectId, is_current: true },
                    });
                    if (oldCurrent && oldCurrent.id !== target.id) {
                        await (driver.update as any)('sys_project_revision', oldCurrent.id, { is_current: false });
                    }

                    // Set target as current
                    await (driver.update as any)('sys_project_revision', target.id, { is_current: true });

                    // Update sys_project.metadata.current_commit_id
                    const project = await (driver.findOne as any)('sys_project', { where: { id: projectId } });
                    if (project) {
                        const meta = parseMetadata(project.metadata);
                        meta.current_commit_id = target.commit_id;
                        meta.artifact_storage_key = target.storage_key;
                        await (driver.update as any)('sys_project', projectId, { metadata: JSON.stringify(meta) });
                    }

                    return res.json(ok({
                        projectId,
                        commitId: target.commit_id,
                        activated: true,
                        previousCommitId: oldCurrent?.commit_id ?? null,
                    }));
                } catch (err: any) {
                    console.error('[CloudArtifactAPI] Failed to activate revision:', err?.message ?? err);
                    return res.status(500).json(fail('Failed to activate revision', 500));
                }
            });

            // ================================================================
            // POST /cloud/projects/:id/revisions/prune
            //   body: { keepN?: number, keepDays?: number }   (defaults: 50, 30)
            // Removes old revision rows + their object-storage keys.
            // The current revision is ALWAYS preserved.
            // ================================================================
            server.post(`${prefix}/cloud/projects/:id/revisions/prune`, async (req: any, res: any) => {
                const auth = checkAuth(req);
                if (!auth.ok) return res.status(auth.status).json(auth.body);
                const projectId = String(req.params?.id ?? '').trim();
                if (!projectId) return res.status(400).json(fail('project id required'));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const body = (req.body ?? {}) as { keepN?: number; keepDays?: number };
                const keepN = Math.max(1, Math.min(1000, Number(body.keepN ?? 50)));
                const keepDays = Math.max(0, Math.min(3650, Number(body.keepDays ?? 30)));
                const cutoffIso = keepDays > 0
                    ? new Date(Date.now() - keepDays * 86_400_000).toISOString()
                    : null;

                try {
                    // Fetch all revisions for this project, newest first.
                    const all = (await (driver.find as any)('sys_project_revision', {
                        where: { project_id: projectId },
                        orderBy: [{ field: 'published_at', direction: 'desc' }],
                        limit: 10_000,
                    })) as any[];

                    // Decide what to KEEP:
                    //   - the current revision (always)
                    //   - the most recent `keepN` rows
                    //   - anything published within the last `keepDays`
                    const keepIds = new Set<string>();
                    const recent = all.slice(0, keepN);
                    for (const r of recent) keepIds.add(r.id);
                    for (const r of all) {
                        if (r.is_current) keepIds.add(r.id);
                        if (cutoffIso && r.published_at && r.published_at >= cutoffIso) {
                            keepIds.add(r.id);
                        }
                    }

                    const toDelete = all.filter((r) => !keepIds.has(r.id));
                    let deletedRows = 0;
                    let deletedKeys = 0;
                    let storageErrors = 0;

                    for (const r of toDelete) {
                        // Best-effort storage delete; rows still go away even if
                        // the bucket call fails so the table doesn't grow forever.
                        if (r.storage_key && storage) {
                            try {
                                await storage.delete(r.storage_key);
                                deletedKeys++;
                            } catch (storageErr: any) {
                                storageErrors++;
                                console.warn('[CloudArtifactAPI] Failed to delete artifact', r.storage_key, storageErr?.message);
                            }
                        }
                        try {
                            await (driver.delete as any)('sys_project_revision', r.id);
                            deletedRows++;
                        } catch (delErr: any) {
                            console.warn('[CloudArtifactAPI] Failed to delete revision row', r.id, delErr?.message);
                        }
                    }

                    return res.json(ok({
                        projectId,
                        scanned: all.length,
                        kept: keepIds.size,
                        deletedRows,
                        deletedKeys,
                        storageErrors,
                        keepN,
                        keepDays,
                    }));
                } catch (err: any) {
                    console.error('[CloudArtifactAPI] Failed to prune revisions:', err?.message ?? err);
                    return res.status(500).json(fail('Failed to prune revisions', 500));
                }
            });

            // ================================================================
            // PUBLIC API — /pub/v1/projects/:id/*
            // ----------------------------------------------------------------
            // Unauthenticated routes that respect sys_project.visibility:
            //   - private  → 404 (looks like the project doesn't exist)
            //   - unlisted → must include ?commit=<id> (no enumeration)
            //   - public   → free read
            //
            // Responses are content-addressable and immutable per commitId, so
            // we set strong caching headers — a CDN in front of this server
            // (Cloudflare, CloudFront, …) can serve everything from the edge.
            // ================================================================

            const publicPrefix = `${prefix}/pub/v1/projects/:id`;

            const checkVisibility = (
                project: SysProjectRow,
                requestedCommit: string,
            ): { ok: true } | { ok: false; status: number; body: any } => {
                const visibility = project.visibility ?? 'private';
                if (visibility === 'private') {
                    // Don't reveal existence of private projects.
                    return { ok: false, status: 404, body: fail('not found', 404) };
                }
                if (visibility === 'unlisted' && !requestedCommit) {
                    // Refuse enumeration; force callers to know the exact commit.
                    return { ok: false, status: 404, body: fail('not found', 404) };
                }
                return { ok: true };
            };

            // GET /pub/v1/projects/:id/manifest.json — lightweight project info
            server.get(`${publicPrefix}/manifest.json`, async (req: any, res: any) => {
                const projectId = String(req.params?.id ?? '').trim();
                if (!projectId) return res.status(404).json(fail('not found', 404));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const project = (await (driver.findOne as any)('sys_project', { where: { id: projectId } })) as SysProjectRow | null;
                if (!project) return res.status(404).json(fail('not found', 404));

                // For manifest we treat unlisted as private (no enumeration).
                if ((project.visibility ?? 'private') !== 'public') {
                    return res.status(404).json(fail('not found', 404));
                }

                const current = await (driver.findOne as any)('sys_project_revision', {
                    where: { project_id: projectId, is_current: true },
                });

                if (typeof res.set === 'function') {
                    res.set('Cache-Control', 'public, max-age=60');
                }
                return res.json(ok({
                    projectId: project.id,
                    organizationId: project.organization_id,
                    displayName: (project as any).display_name ?? null,
                    visibility: project.visibility,
                    currentCommitId: current?.commit_id ?? null,
                    currentChecksum: current?.checksum ?? null,
                    builtAt: current?.built_at ?? null,
                }));
            });

            // GET /pub/v1/projects/:id/artifact[?commit=...]
            server.get(`${publicPrefix}/artifact`, async (req: any, res: any) => {
                const projectId = String(req.params?.id ?? '').trim();
                if (!projectId) return res.status(404).json(fail('not found', 404));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const project = (await (driver.findOne as any)('sys_project', { where: { id: projectId } })) as SysProjectRow | null;
                if (!project) return res.status(404).json(fail('not found', 404));

                const requestedCommit = String(req.query?.commit ?? '').trim();
                const vis = checkVisibility(project, requestedCommit);
                if (!vis.ok) return res.status(vis.status).json(vis.body);

                let rev: any = null;
                try {
                    if (requestedCommit) {
                        rev = await (driver.findOne as any)('sys_project_revision', {
                            where: { project_id: projectId, commit_id: requestedCommit },
                        });
                    } else {
                        rev = await (driver.findOne as any)('sys_project_revision', {
                            where: { project_id: projectId, is_current: true },
                        });
                    }
                } catch { /* no revision table yet */ }

                if (!rev?.storage_key) return res.status(404).json(fail('not found', 404));

                const exists = await storage!.exists(rev.storage_key);
                if (!exists) return res.status(404).json(fail('not found', 404));

                // Optional: skip the proxy and redirect the caller to a short-lived
                // signed URL (S3 / R2). This offloads bandwidth from the control
                // plane. Triggered by `?redirect=1` and only when the configured
                // storage adapter supports `getSignedUrl`.
                const wantRedirect = req.query?.redirect === '1' || req.query?.redirect === 'true';
                if (wantRedirect && typeof storage!.getSignedUrl === 'function') {
                    try {
                        const signed = await storage!.getSignedUrl(rev.storage_key, 300);
                        if (signed) {
                            if (typeof res.set === 'function') {
                                res.set('Cache-Control', 'private, max-age=60');
                                res.set('X-Commit-Id', rev.commit_id);
                            }
                            return res.redirect(302, signed);
                        }
                    } catch (signErr: any) {
                        console.warn('[CloudArtifactAPI] getSignedUrl failed, falling back to inline:', signErr?.message);
                    }
                }

                const buf = await storage!.download(rev.storage_key);
                const body = JSON.parse(buf.toString('utf-8'));

                // Always emit a consistent envelope, even if the stored bundle
                // is "bare" (no top-level commitId/checksum). The revision row
                // is authoritative for identity.
                const envelope = {
                    schemaVersion: body.schemaVersion ?? '0.1',
                    projectId: project.id,
                    commitId: rev.commit_id,
                    checksum: rev.checksum,
                    metadata: body.metadata ?? body,
                    functions: Array.isArray(body.functions) ? body.functions : [],
                    manifest: body.manifest ?? { plugins: [], drivers: [], engines: {} },
                    builtAt: rev.built_at ?? body.builtAt ?? null,
                };

                if (typeof res.set === 'function') {
                    // commitId is a content-hash → safe to cache forever.
                    res.set('Cache-Control', 'public, max-age=31536000, immutable');
                    res.set('ETag', `"${rev.commit_id}"`);
                    res.set('X-Commit-Id', rev.commit_id);
                }
                return res.json(ok(envelope));
            });

            // GET /pub/v1/projects/:id/revisions — public history (only for `public`)
            server.get(`${publicPrefix}/revisions`, async (req: any, res: any) => {
                const projectId = String(req.params?.id ?? '').trim();
                if (!projectId) return res.status(404).json(fail('not found', 404));

                const driver = await getDriver();
                if (!driver) return res.status(503).json(fail('control plane unavailable', 503));

                const project = (await (driver.findOne as any)('sys_project', { where: { id: projectId } })) as SysProjectRow | null;
                if (!project) return res.status(404).json(fail('not found', 404));

                // Listing reveals history → only allow on `public`.
                if ((project.visibility ?? 'private') !== 'public') {
                    return res.status(404).json(fail('not found', 404));
                }

                const limit = Math.min(Math.max(Number(req.query?.limit ?? 20), 1), 100);
                let rows: any[] = [];
                try {
                    rows = (await (driver.find as any)('sys_project_revision', {
                        where: { project_id: projectId },
                        orderBy: [{ field: 'published_at', direction: 'desc' }],
                        limit,
                    })) ?? [];
                } catch { /* no revision table */ }

                if (typeof res.set === 'function') {
                    res.set('Cache-Control', 'public, max-age=30');
                }
                return res.json(ok({
                    items: rows.map((r) => ({
                        commitId: r.commit_id,
                        checksum: r.checksum,
                        sizeBytes: r.size_bytes,
                        builtAt: r.built_at,
                        publishedAt: r.published_at,
                        note: r.note,
                        isCurrent: !!r.is_current,
                    })),
                }));
            });
        },
        stop: async (_ctx: AnyContext) => {},
    };
}
