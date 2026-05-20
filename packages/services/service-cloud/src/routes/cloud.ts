// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Authenticated `/cloud/*` artifact routes.
 *
 *   GET  /cloud/resolve-hostname?host=...
 *   GET  /cloud/projects/:id/artifact[?commit=...]
 *   POST /cloud/projects/:id/metadata
 *   GET  /cloud/projects/:id/revisions?limit=&cursor=
 *   POST /cloud/projects/:id/revisions/:commit/activate
 *   POST /cloud/projects/:id/revisions/prune
 *
 * Every route is bearer-token gated (when `requiredKey` is set).
 */

import { resolve as resolvePath, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IHttpServer } from '@objectstack/spec/contracts';
import {
    ok, fail, parseMetadata, extractArtifactPaths, sha256Hex,
    mergeArtifactMetadata, resolveProjectByHost, readProjectCredentials,
    buildRuntimeBlock,
} from '../cloud-artifact-helpers.js';
import type { SysProjectRow } from '../cloud-artifact-helpers.js';
import { buildStorageKey, readLegacyArtifactFile } from './storage.js';
import type { RouteDeps } from './types.js';
import { makeCheckAuth, makeGetDriver, controlPlaneUnavailable } from './types.js';
import { normalizeBranch, setBranchHead, DEFAULT_BRANCH } from './branches.js';

export function registerCloudRoutes(server: IHttpServer, deps: RouteDeps): void {
    const {
        prefix, artifactRoot, keyPrefix, storage, storageAdapterName,
        requiredKey, controlDriverPromise, getCallerUserId,
    } = deps;

    const checkAuth = makeCheckAuth(requiredKey, getCallerUserId);
    const getDriver = makeGetDriver(controlDriverPromise);
    const keyFor = (orgId: string | null | undefined, projectId: string, commitId: string) =>
        buildStorageKey(keyPrefix, orgId, projectId, commitId);

    // ================================================================
    // GET /cloud/resolve-hostname?host=...
    // ================================================================
    server.get(`${prefix}/cloud/resolve-hostname`, async (req: any, res: any) => {
        const auth = await checkAuth(req);
        if (!auth.ok) return res.status(auth.status).json(auth.body);
        const host = String(req.query?.host ?? req.query?.hostname ?? '').trim();
        if (!host) return res.status(400).json(fail('host query parameter is required'));

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        const project = await resolveProjectByHost(driver, host);
        if (!project) return res.status(404).json(fail(`No project bound to hostname '${host}'`, 404));

        const cred = await readProjectCredentials(driver, project.id);
        const runtime = buildRuntimeBlock(project, cred);
        return res.json(ok({ projectId: project.id, organizationId: project.organization_id, runtime }));
    });

    // ================================================================
    // GET /cloud/projects-by-short-id/:short
    // Resolve a project's UUID prefix (>= 8 hex chars, dashes stripped)
    // to its full id. Used by the preview runtime, which encodes project
    // ids as 8-hex subdomains. Returns 404 on no match, 409 on ambiguity.
    //
    // The URL deliberately sits at `projects-by-short-id` (NOT
    // `projects/by-short-id`) so it never collides with the catch-all
    // `:id` param of `/cloud/projects/:id/...` routes — those would
    // shadow this one in registration-order matchers.
    // ================================================================
    server.get(`${prefix}/cloud/projects-by-short-id/:short`, async (req: any, res: any) => {
        const auth = await checkAuth(req);
        if (!auth.ok) return res.status(auth.status).json(auth.body);
        const raw = String(req.params?.short ?? '').trim().toLowerCase();
        if (!/^[0-9a-f]{8,32}$/.test(raw)) {
            return res.status(400).json(fail('short id must be 8-32 lowercase hex chars (no dashes)'));
        }

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        try {
            // The short id is a UUID prefix without dashes; the stored
            // `sys_project.id` is a canonical UUID *with* dashes. The first
            // 8 hex chars of the UUID are always the bytes before the first
            // dash. Most drivers expose `$contains` (LIKE %x%); we use that
            // to over-fetch a small candidate set, then post-filter to an
            // exact prefix match. UUIDs make collisions on 8 hex chars rare,
            // and we cap the candidate scan at 16 rows.
            const headHex = raw.slice(0, 8);
            const candidates = (await (driver.find as any)('sys_environment', {
                where: { id: { $contains: headHex } },
                limit: 16,
            })) as Array<{ id: string; organization_id?: string }>;
            const matches = candidates.filter((p) => p.id.replace(/-/g, '').toLowerCase().startsWith(raw));
            if (matches.length === 0) {
                return res.status(404).json(fail(`No project matches short id '${raw}'`, 404));
            }
            if (matches.length > 1) {
                return res.status(409).json(fail(
                    `Short id '${raw}' is ambiguous (matches ${matches.length} projects)`,
                    409,
                ));
            }
            const p = matches[0];
            return res.json(ok({ projectId: p.id, organizationId: p.organization_id }));
        } catch (err: any) {
            console.error('[CloudArtifactAPI] by-short-id lookup failed:', err?.message ?? err);
            return res.status(500).json(fail('lookup failed', 500));
        }
    });

    // ================================================================
    // GET /cloud/projects/:id/artifact[?commit=...]
    // ================================================================
    server.get(`${prefix}/cloud/projects/:id/artifact`, async (req: any, res: any) => {
        const auth = await checkAuth(req);
        if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        const project = (await (driver.findOne as any)('sys_environment', { where: { id: projectId } })) as SysProjectRow | null;
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));

        const requestedCommit = String(req.query?.commit ?? '').trim();

        // --- Try loading from storage via revision table (P1 path) ---
        let revisionBundle: any | null = null;
        let revisionRow: any = null;
        try {
            let rev: any = null;
            if (requestedCommit) {
                rev = await (driver.findOne as any)('sys_project_revision_DEPRECATED', {
                    where: { environment_id: projectId, commit_id: requestedCommit },
                });
                if (!rev) return res.status(404).json(fail(`Revision '${requestedCommit}' not found for project '${projectId}'`, 404));
            } else {
                rev = await (driver.findOne as any)('sys_project_revision_DEPRECATED', {
                    where: { environment_id: projectId, is_current: true },
                });
            }
            if (rev?.storage_key) {
                const exists = await storage.exists(rev.storage_key);
                if (exists) {
                    const buf = await storage.download(rev.storage_key);
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
                const bundle = await readLegacyArtifactFile(abs);
                if (bundle) bundles.push(bundle);
            }
        }

        // --- Marketplace installs: append every enabled sys_package_installation
        //     row's manifest_json bundle so the runtime kernel registers them
        //     as additional packages. Without this, packages installed via
        //     `POST /cloud/packages/:id/install` would write a row but never
        //     reach the env runtime.
        try {
            const installs: any[] = await (async () => {
                const r: any = await (driver.find as any)('sys_package_installation', {
                    where: { environment_id: projectId },
                    limit: 1000,
                });
                if (Array.isArray(r)) return r;
                if (Array.isArray(r?.records)) return r.records;
                if (Array.isArray(r?.value)) return r.value;
                return [];
            })();
            for (const inst of installs) {
                if (!inst) continue;
                if (inst.enabled === false || inst.enabled === 0) continue;
                if (!inst.package_version_id) continue;
                const ver: any = await (driver.findOne as any)('sys_package_version', { where: { id: inst.package_version_id } });
                if (!ver?.manifest_json) continue;
                let manifest: any = null;
                try {
                    manifest = typeof ver.manifest_json === 'string'
                        ? JSON.parse(ver.manifest_json)
                        : ver.manifest_json;
                } catch {
                    continue;
                }
                if (!manifest || typeof manifest !== 'object') continue;
                // Wrap as a bundle-shaped object so mergeArtifactMetadata
                // ingests its arrays (`objects`, `apps`, `views`, etc.).
                bundles.push({ metadata: manifest, manifest });
            }
        } catch (err: any) {
            console.warn('[CloudArtifactAPI] installed-bundle merge failed:', err?.message ?? err);
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
        const auth = await checkAuth(req);
        if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        const project = (await (driver.findOne as any)('sys_environment', { where: { id: projectId } })) as SysProjectRow | null;
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
        const key = keyFor(project.organization_id, projectId, commitId);

        // Branch — query string takes precedence over body so that the CLI
        // can pass `?branch=foo` even when streaming a raw artifact body.
        let branch: string;
        try {
            branch = normalizeBranch(req.query?.branch ?? (body as any).branch);
        } catch (err: any) {
            return res.status(400).json(fail(err?.message ?? 'invalid branch', 400));
        }

        // 1. Upload to storage (content-addressable: skip if same key exists)
        try {
            const exists = await storage.exists(key);
            if (!exists) {
                await storage.upload(key, bodyBuf);
            }
        } catch (err: any) {
            console.error('[CloudArtifactAPI] Failed to upload artifact:', err?.message ?? err);
            return res.status(500).json(fail('Failed to persist artifact', 500));
        }

        // 2. Insert revision row + flip is_current + flip is_branch_head
        let revisionCreated = false;
        let revisionId: string | null = null;
        try {
            const existing = await (driver.findOne as any)('sys_project_revision_DEPRECATED', {
                where: { environment_id: projectId, commit_id: commitId },
            });

            if (!existing) {
                try {
                    const oldCurrent = await (driver.findOne as any)('sys_project_revision_DEPRECATED', {
                        where: { environment_id: projectId, is_current: true },
                    });
                    if (oldCurrent) {
                        await (driver.update as any)('sys_project_revision_DEPRECATED', oldCurrent.id, { is_current: false });
                    }
                } catch { /* table may not exist yet */ }

                revisionId = randomUUID();
                await (driver.create as any)('sys_project_revision_DEPRECATED', {
                    id: revisionId,
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
                    branch,
                    is_branch_head: true,
                });
                revisionCreated = true;
            } else {
                revisionId = existing.id;
                // Re-publish same commit: ensure it's current AND that branch head reflects this push
                if (!existing.is_current) {
                    try {
                        const oldCurrent = await (driver.findOne as any)('sys_project_revision_DEPRECATED', {
                            where: { environment_id: projectId, is_current: true },
                        });
                        if (oldCurrent && oldCurrent.id !== existing.id) {
                            await (driver.update as any)('sys_project_revision_DEPRECATED', oldCurrent.id, { is_current: false });
                        }
                    } catch { /* ok */ }
                    await (driver.update as any)('sys_project_revision_DEPRECATED', existing.id, { is_current: true });
                }
            }

            // Always (re-)apply branch head pointer so that re-publishing the
            // same commit on a different branch correctly moves the head.
            if (revisionId) {
                await setBranchHead(driver, projectId, branch, revisionId);
            }
        } catch (err: any) {
            console.warn('[CloudArtifactAPI] Failed to write revision row (table may not exist yet):', err?.message);
        }

        // 3. Update sys_project.metadata.current_commit_id (and legacy artifact_path)
        const existingMeta = parseMetadata(project.metadata);
        const updatedMeta = { ...existingMeta, current_commit_id: commitId, artifact_storage_key: key };
        try {
            await (driver.update as any)('sys_environment', projectId, { metadata: JSON.stringify(updatedMeta) });
        } catch (err: any) {
            console.error('[CloudArtifactAPI] Failed to update project metadata:', err?.message ?? err);
        }

        return res.json(ok({
            projectId,
            commitId,
            checksum,
            storageKey: key,
            revisionCreated,
            branch,
        }));
    });

    // ================================================================
    // GET /cloud/projects/:id/revisions?limit=&cursor=
    // ================================================================
    server.get(`${prefix}/cloud/projects/:id/revisions`, async (req: any, res: any) => {
        const auth = await checkAuth(req);
        if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '20', 10) || 20, 1), 100);
        const cursor = String(req.query?.cursor ?? '').trim();
        const branchFilterRaw = req.query?.branch;
        let branchFilter: string | null = null;
        if (branchFilterRaw !== undefined && branchFilterRaw !== null && String(branchFilterRaw).trim() !== '') {
            try {
                branchFilter = normalizeBranch(branchFilterRaw);
            } catch (err: any) {
                return res.status(400).json(fail(err?.message ?? 'invalid branch filter', 400));
            }
        }

        try {
            const query: any = {
                where: { environment_id: projectId },
                orderBy: [{ field: 'published_at', direction: 'desc' }],
                limit: limit + 1,
            };
            if (cursor) {
                query.where.published_at = { $lt: cursor };
            }
            if (branchFilter) {
                // Match either explicit branch value or NULL (treated as default)
                if (branchFilter === DEFAULT_BRANCH) {
                    query.where.$or = [{ branch: branchFilter }, { branch: null }];
                } else {
                    query.where.branch = branchFilter;
                }
            }
            const rows = await (driver.find as any)('sys_project_revision_DEPRECATED', query);
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
                    branch: (r.branch && String(r.branch).trim()) || DEFAULT_BRANCH,
                    isBranchHead: !!r.is_branch_head,
                })),
                nextCursor,
                branch: branchFilter,
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
        const auth = await checkAuth(req);
        if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        const commitId = String(req.params?.commit ?? '').trim();
        if (!projectId || !commitId) return res.status(400).json(fail('project id and commit id required'));

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        try {
            // Accept full commit id or a 8+ char prefix (matches the
            // 12-char display in the Studio recent-revisions list).
            let target = await (driver.findOne as any)('sys_project_revision_DEPRECATED', {
                where: { environment_id: projectId, commit_id: commitId },
            });
            if (!target && commitId.length >= 8) {
                const candidates = await (driver.find as any)('sys_project_revision_DEPRECATED', {
                    where: { environment_id: projectId, commit_id: { $like: `${commitId}%` } },
                    limit: 2,
                });
                if (Array.isArray(candidates) && candidates.length === 1) {
                    target = candidates[0];
                } else if (Array.isArray(candidates) && candidates.length > 1) {
                    return res.status(409).json(fail(`Commit prefix '${commitId}' is ambiguous (${candidates.length} matches)`, 409));
                }
            }
            if (!target) return res.status(404).json(fail(`Revision '${commitId}' not found`, 404));

            const oldCurrent = await (driver.findOne as any)('sys_project_revision_DEPRECATED', {
                where: { environment_id: projectId, is_current: true },
            });
            if (oldCurrent && oldCurrent.id !== target.id) {
                await (driver.update as any)('sys_project_revision_DEPRECATED', oldCurrent.id, { is_current: false });
            }

            await (driver.update as any)('sys_project_revision_DEPRECATED', target.id, { is_current: true });

            const project = await (driver.findOne as any)('sys_environment', { where: { id: projectId } });
            if (project) {
                const meta = parseMetadata(project.metadata);
                meta.current_commit_id = target.commit_id;
                meta.artifact_storage_key = target.storage_key;
                await (driver.update as any)('sys_environment', projectId, { metadata: JSON.stringify(meta) });
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
        const auth = await checkAuth(req);
        if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        const body = (req.body ?? {}) as { keepN?: number; keepDays?: number };
        const keepN = Math.max(1, Math.min(1000, Number(body.keepN ?? 50)));
        const keepDays = Math.max(0, Math.min(3650, Number(body.keepDays ?? 30)));
        const cutoffIso = keepDays > 0
            ? new Date(Date.now() - keepDays * 86_400_000).toISOString()
            : null;

        try {
            const all = (await (driver.find as any)('sys_project_revision_DEPRECATED', {
                where: { environment_id: projectId },
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
                if (r.storage_key && typeof storage.delete === 'function') {
                    try {
                        await storage.delete(r.storage_key);
                        deletedKeys++;
                    } catch (storageErr: any) {
                        storageErrors++;
                        console.warn('[CloudArtifactAPI] Failed to delete artifact', r.storage_key, storageErr?.message);
                    }
                }
                try {
                    await (driver.delete as any)('sys_project_revision_DEPRECATED', r.id);
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
}
