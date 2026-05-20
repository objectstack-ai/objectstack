// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Project lifecycle routes — wraps {@link ProjectProvisioningService} and
 * exposes project status-machine transitions used by the Cloud Control
 * App row actions.
 *
 *   POST /cloud/projects                       — create + provision DB
 *   POST /cloud/projects/:id/suspend           — active → suspended
 *   POST /cloud/projects/:id/resume            — suspended → active
 *   POST /cloud/projects/:id/archive           — * → archived
 *   POST /cloud/projects/:id/set-default       — set is_default true (clears others in org)
 *   POST /cloud/projects/:id/change-plan       — change `plan`
 *   POST /cloud/projects/:id/change-hostname   — change `hostname`
 *
 * Every route is bearer-token gated when `requiredKey` is set.
 */

import { randomUUID } from 'node:crypto';
import type { IHttpServer } from '@objectstack/spec/contracts';
import { fail, ok } from '../cloud-artifact-helpers.js';
import type { RouteDeps } from './types.js';
import { makeCheckAuth, makeGetDriver, controlPlaneUnavailable } from './types.js';
import {
    ProjectProvisioningService,
    createDefaultProjectAdapters,
} from '@objectstack/service-tenant';

type AnyRow = Record<string, any>;

const ALLOWED_PLANS = new Set(['free', 'starter', 'pro', 'enterprise', 'custom']);
const TERMINAL_STATUSES = new Set(['archived', 'failed']);

function readActorIdFromHeaders(req: any): string | undefined {
    const headerVal = req.headers?.['x-actor-id'] ?? req.headers?.['x-user-id'];
    return typeof headerVal === 'string' && headerVal ? headerVal : undefined;
}

function nowIso() { return new Date().toISOString(); }

/**
 * Resolve the new hostname for a change-hostname call.
 *
 * Users (and the Cloud Control UI) typically pass just a subdomain label
 * — e.g. `acme-prod`. The root domain (`objectstack.app` by default,
 * configurable via `OS_ROOT_DOMAIN` / `ROOT_DOMAIN`) is appended
 * automatically so users never have to type `.objectstack.app` themselves.
 *
 * Backward compat: a fully-qualified hostname containing one or more
 * dots is accepted as-is (so direct REST callers can still POST
 * `{"hostname": "api.acme.com"}`). Reads `subdomain` first, then falls
 * back to `hostname`.
 *
 * Returns either `{ ok: true, hostname }` or `{ ok: false, error, status }`
 * suitable for direct response.
 */
function resolveNewHostname(body: AnyRow): { ok: true; hostname: string } | { ok: false; error: string; status: number } {
    const rawSub = String(body?.subdomain ?? '').trim();
    const rawHost = String(body?.hostname ?? '').trim();
    const input = rawSub || rawHost;
    if (!input) return { ok: false, error: 'subdomain or hostname is required', status: 400 };

    const rootDomain =
        (process.env.OS_ROOT_DOMAIN ||
            process.env.ROOT_DOMAIN ||
            (process.env.NODE_ENV === 'production' ? 'objectstack.app' : 'localhost'))
            .toLowerCase()
            .replace(/^\.+|\.+$/g, '');

    // If caller passed a fully-qualified hostname (has at least one dot),
    // treat it as the canonical value. Otherwise append the root domain.
    const hasDot = input.includes('.');
    const hostname = (hasDot ? input : `${input}.${rootDomain}`).toLowerCase();

    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(hostname)) {
        return { ok: false, error: `Hostname '${hostname}' contains invalid characters`, status: 400 };
    }
    return { ok: true, hostname };
}

export function registerProjectLifecycleRoutes(server: IHttpServer, deps: RouteDeps): void {
    const { prefix, requiredKey, controlDriverPromise, getCallerUserId, getCallerActiveOrgId } = deps;
    const checkAuth = makeCheckAuth(requiredKey, getCallerUserId);
    const getDriver = makeGetDriver(controlDriverPromise);

    const resolveActorId = async (req: any): Promise<string | undefined> => {
        const sessionUserId = getCallerUserId ? await getCallerUserId(req) : undefined;
        return sessionUserId ?? readActorIdFromHeaders(req);
    };
    const resolveActiveOrgId = async (req: any): Promise<string | undefined> => {
        const fromSession = getCallerActiveOrgId ? await getCallerActiveOrgId(req) : undefined;
        if (fromSession) return fromSession;
        const headerOrg = req.headers?.['x-organization-id'];
        return typeof headerOrg === 'string' && headerOrg ? headerOrg : undefined;
    };

    // Lazy provisioning service — built once per process.
    let provisioningSvc: ProjectProvisioningService | null = null;
    const getProvisioningService = async (): Promise<ProjectProvisioningService | null> => {
        if (provisioningSvc) return provisioningSvc;
        const driver = await getDriver();
        if (!driver) return null;
        provisioningSvc = new ProjectProvisioningService({
            controlPlaneDriver: driver as any,
            adapters: createDefaultProjectAdapters(),
            defaultDriver: (process.env.OS_DEFAULT_PROJECT_DRIVER as any) ?? 'memory',
        });
        return provisioningSvc;
    };

    const loadProject = async (id: string): Promise<AnyRow | null> => {
        const driver = await getDriver();
        if (!driver) return null;
        try {
            return (await (driver.findOne as any)('sys_project', { where: { id } })) as AnyRow | null;
        } catch {
            return null;
        }
    };

    const patchProject = async (id: string, patch: AnyRow): Promise<boolean> => {
        const driver = await getDriver();
        if (!driver) return false;
        try {
            await (driver.update as any)('sys_project', id, { ...patch, updated_at: nowIso() });
            return true;
        } catch (err: any) {
            console.error('[ProjectLifecycle] update failed:', err?.message ?? err);
            return false;
        }
    };

    // ── POST /cloud/projects ─────────────────────────────────────────
    server.post(`${prefix}/cloud/projects`, async (req: any, res: any) => {
        const auth = await checkAuth(req); if (!auth.ok) return res.status(auth.status).json(auth.body);
        const svc = await getProvisioningService();
        if (!svc) return controlPlaneUnavailable(res);

        const body = (req.body ?? {}) as AnyRow;
        const displayName = String(body.displayName ?? body.display_name ?? '').trim();
        if (!displayName) return res.status(400).json(fail('displayName is required', 400));

        // organizationId — accept from body, or fall back to the actor's
        // active organization context (resolved via better-auth session).
        let organizationId =
            (typeof body.organizationId === 'string' && body.organizationId) ||
            (typeof body.organization_id === 'string' && body.organization_id) ||
            '';
        organizationId = organizationId.trim();
        if (!organizationId) {
            const fromSession = await resolveActiveOrgId(req);
            if (fromSession) organizationId = fromSession;
        }

        if (!organizationId) {
            // Last resort: pick the actor's first organization membership.
            const actorId = await resolveActorId(req);
            const driver = await getDriver();
            if (actorId && driver) {
                try {
                    const member = await (driver.findOne as any)('sys_member', { where: { user_id: actorId } });
                    if (member?.organization_id) organizationId = String(member.organization_id);
                } catch { /* sys_member may not exist */ }
            }
        }
        if (!organizationId) return res.status(400).json(fail('organizationId is required (no active organization in session)', 400));

        const createdBy = await resolveActorId(req);
        if (!createdBy) return res.status(401).json(fail('Authenticated user required to create projects', 401));

        try {
            const result = await svc.provisionProject({
                organizationId,
                displayName,
                driver: body.driver,
                plan: body.plan,
                storageLimitMb: body.storageLimitMb != null && body.storageLimitMb !== ''
                    ? Number(body.storageLimitMb)
                    : undefined,
                isDefault: Boolean(body.isDefault),
                createdBy,
                hostname: body.hostname || undefined,
                visibility: body.visibility,
                metadata: body.metadata,
            });
            return res.status(201).json(ok({
                project: result.project,
                warnings: result.warnings,
                durationMs: result.durationMs,
            }));
        } catch (err: any) {
            const msg = err?.message ?? String(err);
            const status = /already has a default project/i.test(msg) ? 409 : 400;
            return res.status(status).json(fail(msg, status));
        }
    });

    // Helper: build a status-transition endpoint.
    const transition = (
        urlSuffix: string,
        fromStatuses: string[] | null,
        patch: (req: any, project: AnyRow) => AnyRow | Promise<AnyRow>,
    ) => {
        server.post(`${prefix}/cloud/projects/:id/${urlSuffix}`, async (req: any, res: any) => {
            const auth = await checkAuth(req); if (!auth.ok) return res.status(auth.status).json(auth.body);
            const projectId = String(req.params?.id ?? '').trim();
            if (!projectId) return res.status(400).json(fail('project id required'));

            const project = await loadProject(projectId);
            if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));

            if (fromStatuses && !fromStatuses.includes(project.status)) {
                return res.status(409).json(fail(
                    `Cannot ${urlSuffix} project in status '${project.status}'. Expected one of: ${fromStatuses.join(', ')}`,
                    409,
                ));
            }

            try {
                const patchObj = await patch(req, project);
                const ok2 = await patchProject(projectId, patchObj);
                if (!ok2) return res.status(500).json(fail('Failed to persist update', 500));
                return res.json(ok({ projectId, ...patchObj }));
            } catch (err: any) {
                return res.status(400).json(fail(err?.message ?? 'transition failed', 400));
            }
        });
    };

    // ── status transitions ──
    transition('suspend', ['active', 'provisioning'], () => ({ status: 'suspended' }));
    transition('resume', ['suspended'], () => ({ status: 'active' }));
    transition('archive', null, (req) => {
        const reason = String(req.body?.reason ?? '').trim();
        const existing: any = {};
        try {
            const cur = JSON.parse(req.body?._currentMetadata ?? '{}');
            Object.assign(existing, cur);
        } catch { /* ignore */ }
        if (reason) existing.archive_reason = reason;
        existing.archived_at = nowIso();
        return { status: 'archived', metadata: JSON.stringify(existing) };
    });

    // ── set-default: clears other defaults in same org ──
    server.post(`${prefix}/cloud/projects/:id/set-default`, async (req: any, res: any) => {
        const auth = await checkAuth(req); if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));

        const project = await loadProject(projectId);
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));

        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);

        try {
            const peers = await (driver.find as any)('sys_project', {
                where: { organization_id: project.organization_id, is_default: true },
            });
            for (const peer of (peers ?? [])) {
                if (peer.id !== projectId) {
                    await (driver.update as any)('sys_project', peer.id, { is_default: false, updated_at: nowIso() });
                }
            }
            const success = await patchProject(projectId, { is_default: true });
            if (!success) return res.status(500).json(fail('Failed to persist update', 500));
            return res.json(ok({ projectId, is_default: true }));
        } catch (err: any) {
            return res.status(400).json(fail(err?.message ?? 'set-default failed', 400));
        }
    });

    // ── change-plan ──
    server.post(`${prefix}/cloud/projects/:id/change-plan`, async (req: any, res: any) => {
        const auth = await checkAuth(req); if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));
        const plan = String(req.body?.plan ?? '').trim();
        if (!ALLOWED_PLANS.has(plan)) return res.status(400).json(fail(`Invalid plan '${plan}'`, 400));

        const project = await loadProject(projectId);
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));
        if (TERMINAL_STATUSES.has(project.status)) {
            return res.status(409).json(fail(`Cannot change plan on ${project.status} project`, 409));
        }

        const success = await patchProject(projectId, { plan });
        if (!success) return res.status(500).json(fail('Failed to persist update', 500));
        return res.json(ok({ projectId, plan }));
    });

    // ── change-hostname ──
    server.post(`${prefix}/cloud/projects/:id/change-hostname`, async (req: any, res: any) => {
        const auth = await checkAuth(req); if (!auth.ok) return res.status(auth.status).json(auth.body);
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));
        const resolved = resolveNewHostname(req.body ?? {});
        if (!resolved.ok) return res.status(resolved.status).json(fail(resolved.error, resolved.status));
        const hostname = resolved.hostname;

        const project = await loadProject(projectId);
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));

        const driver = await getDriver();
        if (driver) {
            try {
                const conflict = await (driver.findOne as any)('sys_project', { where: { hostname } });
                if (conflict && conflict.id !== projectId) {
                    return res.status(409).json(fail(`Hostname '${hostname}' is already in use`, 409));
                }
            } catch { /* ignore */ }
        }

        const success = await patchProject(projectId, { hostname, console_url: `https://${hostname}/_console`, api_base_url: `https://${hostname}/api/v1` });
        if (!success) return res.status(500).json(fail('Failed to persist update', 500));
        return res.json(ok({ projectId, hostname }));
    });

    // ────────────────────────────────────────────────────────────────────
    // Generic "script" action dispatcher.
    //
    // `@object-ui/app-shell`'s RecordDetailView ignores `action.target` for
    // `type:'api'` actions (it routes hardcoded `opportunity_*` cases and
    // falls through to a no-op `dataSource.update`). `type:'script'`
    // actions, however, POST to `/api/v1/actions/{object}/{name}` with body
    // `{ recordId, params }` on both list and detail surfaces.
    //
    // We expose a single dispatcher for `sys_project` that proxies the
    // status-machine routes above. Each branch reuses the same handlers via
    // a synthetic request rewrite (sets req.params.id / req.body) so all
    // validation lives in one place.
    // ──────────────────────────────────────────────────────────────────��─
    type ActionImpl = (req: any, res: any) => Promise<any> | any;
    const actionDispatch: Record<string, ActionImpl> = {};

    const dispatchTransition = async (
        req: any, res: any,
        urlSuffix: string,
        fromStatuses: string[] | null,
        patch: (req: any, project: AnyRow) => AnyRow | Promise<AnyRow>,
    ) => {
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));
        const project = await loadProject(projectId);
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));
        if (fromStatuses && !fromStatuses.includes(project.status)) {
            return res.status(409).json(fail(
                `Cannot ${urlSuffix} project in status '${project.status}'. Expected one of: ${fromStatuses.join(', ')}`,
                409,
            ));
        }
        try {
            const patchObj = await patch(req, project);
            const ok2 = await patchProject(projectId, patchObj);
            if (!ok2) return res.status(500).json(fail('Failed to persist update', 500));
            return res.json(ok({ projectId, ...patchObj }));
        } catch (err: any) {
            return res.status(400).json(fail(err?.message ?? 'transition failed', 400));
        }
    };

    actionDispatch.suspend_project = (req, res) =>
        dispatchTransition(req, res, 'suspend', ['active', 'provisioning'], () => ({ status: 'suspended' }));
    actionDispatch.resume_project = (req, res) =>
        dispatchTransition(req, res, 'resume', ['suspended'], () => ({ status: 'active' }));
    actionDispatch.archive_project = (req, res) =>
        dispatchTransition(req, res, 'archive', null, (r) => {
            const reason = String(r.body?.reason ?? '').trim();
            const existing: any = {};
            if (reason) existing.archive_reason = reason;
            existing.archived_at = nowIso();
            return { status: 'archived', metadata: JSON.stringify(existing) };
        });

    actionDispatch.set_default_project = async (req, res) => {
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));
        const project = await loadProject(projectId);
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));
        const driver = await getDriver();
        if (!driver) return controlPlaneUnavailable(res);
        try {
            const peers = await (driver.find as any)('sys_project', {
                where: { organization_id: project.organization_id, is_default: true },
            });
            for (const peer of (peers ?? [])) {
                if (peer.id !== projectId) {
                    await (driver.update as any)('sys_project', peer.id, { is_default: false, updated_at: nowIso() });
                }
            }
            const success = await patchProject(projectId, { is_default: true });
            if (!success) return res.status(500).json(fail('Failed to persist update', 500));
            return res.json(ok({ projectId, is_default: true }));
        } catch (err: any) {
            return res.status(400).json(fail(err?.message ?? 'set-default failed', 400));
        }
    };

    actionDispatch.change_plan = async (req, res) => {
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));
        const plan = String(req.body?.plan ?? '').trim();
        if (!ALLOWED_PLANS.has(plan)) return res.status(400).json(fail(`Invalid plan '${plan}'`, 400));
        const project = await loadProject(projectId);
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));
        if (TERMINAL_STATUSES.has(project.status)) {
            return res.status(409).json(fail(`Cannot change plan on ${project.status} project`, 409));
        }
        const success = await patchProject(projectId, { plan });
        if (!success) return res.status(500).json(fail('Failed to persist update', 500));
        return res.json(ok({ projectId, plan }));
    };

    actionDispatch.change_hostname = async (req, res) => {
        const projectId = String(req.params?.id ?? '').trim();
        if (!projectId) return res.status(400).json(fail('project id required'));
        const resolved = resolveNewHostname(req.body ?? {});
        if (!resolved.ok) return res.status(resolved.status).json(fail(resolved.error, resolved.status));
        const hostname = resolved.hostname;
        const project = await loadProject(projectId);
        if (!project) return res.status(404).json(fail(`Project '${projectId}' not found`, 404));
        const driver = await getDriver();
        if (driver) {
            try {
                const conflict = await (driver.findOne as any)('sys_project', { where: { hostname } });
                if (conflict && conflict.id !== projectId) {
                    return res.status(409).json(fail(`Hostname '${hostname}' is already in use`, 409));
                }
            } catch { /* ignore */ }
        }
        const success = await patchProject(projectId, { hostname, console_url: `https://${hostname}/_console`, api_base_url: `https://${hostname}/api/v1` });
        if (!success) return res.status(500).json(fail('Failed to persist update', 500));
        return res.json(ok({ projectId, hostname }));
    };

    server.post(`${prefix}/actions/sys_project/:actionName`, async (req: any, res: any) => {
        const auth = await checkAuth(req); if (!auth.ok) return res.status(auth.status).json(auth.body);
        const actionName = String(req.params?.actionName ?? '').trim();
        const impl = actionDispatch[actionName];
        if (!impl) return res.status(404).json(fail(`Unknown sys_project action '${actionName}'`, 404));

        // app-shell sends `{ recordId, params }`. Rewrite to the shape the
        // existing transition handlers expect (req.params.id + req.body
        // carrying the params).
        const body = (req.body ?? {}) as AnyRow;
        const recordId = String(body.recordId ?? body.record_id ?? '').trim();
        if (!recordId) return res.status(400).json(fail('recordId is required', 400));
        const params = (body.params && typeof body.params === 'object') ? body.params : {};

        // Mutate req in place (handlers read req.params.id / req.body.*).
        req.params = { ...(req.params ?? {}), id: recordId };
        req.body = { ...params };

        return impl(req, res);
    });

    // Reference the randomUUID import (silences unused warnings) — used by
    // adapter fallbacks elsewhere in the file in the future.
    void randomUUID;
}
