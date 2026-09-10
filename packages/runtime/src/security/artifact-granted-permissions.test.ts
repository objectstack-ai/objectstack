// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13457 — the artifact→enforcer seam: `EnvironmentArtifactSchema.grantedPermissions`
// reaches `PluginPermissionEnforcer.registerGrantedPermissions` at materialize
// time, keyed per package by the plugin manifest `id`.
//
// The load-bearing half of this file is the THREE-STATE pin. The producer pins
// absent ≠ `{}` in both directions and the reviewer confirmed three separate
// collapses each go red on its side; a consumer that collapses them re-opens a
// decided question, and one of the collapses (registering `undefined` for a
// package the map does not name) BRICKS BOOT, because
// `buildPermissionsFromGrants(undefined)` denies everything and
// `checkPermission` denies an unregistered plugin too. So every state is
// asserted through the enforcer's OWN readback (`getPluginPermissions`), never
// through the binding record alone — the binding record is what this module
// says it did, the enforcer is what actually happened.

import { describe, it, expect, vi } from 'vitest';
import { createPluginPermissionEnforcer } from '@objectstack/core';
import {
    carriedPackageIds,
    registerArtifactGrantedPermissions,
    resolveArtifactGrantBinding,
} from './artifact-granted-permissions.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const enforcer = () => createPluginPermissionEnforcer(logger() as never);

/** A package body as an assembled artifact carries it (ADR-0130 D4). */
const body = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    version: '1.0.0',
    type: 'module',
    ...extra,
});

/** A two-package option-B artifact, plus whatever envelope keys the case needs. */
const artifact = (extra: Record<string, unknown> = {}) => ({
    manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app' },
    packages: [{ manifest: body('com.acme.crm') }, { manifest: body('com.acme.reports') }],
    ...extra,
});

const CONSENTED = { services: ['object'], hooks: ['record.beforeInsert'], network: [], fs: [] };

describe('#13457 — the artifact carries the package ids the grant map is keyed by', () => {
    it('names every package of an option-B artifact, in registration order', () => {
        expect(carriedPackageIds(artifact())).toEqual(['com.acme.crm', 'com.acme.reports']);
    });

    it('names the single package of an artifact with no `packages[]`', () => {
        // The id lives one level down on this shape — the same `bundle.manifest
        // || bundle` unwrap AppPlugin's constructor performs. Reading the
        // artifact's own top level here would return `undefined` and silently
        // register nothing on every single-package artifact.
        expect(carriedPackageIds({ manifest: { id: 'com.acme.solo' } })).toEqual(['com.acme.solo']);
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#13457 — absent, `{}`, and consented are THREE states, never two', () => {
    it('ABSENT key registers nothing — an artifact with no consent record is untouched', () => {
        const e = enforcer();
        const binding = registerArtifactGrantedPermissions(artifact(), e);

        expect(binding.declared).toBe(false);
        expect(binding.registered).toEqual([]);
        // ⭐ The clause-1.3 pin: nothing is registered, so nothing is denied.
        // The collapse this catches — looping over the CARRIED packages and
        // registering `grants[id]` for each — would register `undefined` here
        // and hand back a deny-everything bag for both packages.
        expect(e.getPluginPermissions('com.acme.crm')).toBeUndefined();
        expect(e.getPluginPermissions('com.acme.reports')).toBeUndefined();
    });

    it('DECLARED-BUT-EMPTY map is not absence — it is a consent record naming no package', () => {
        const binding = registerArtifactGrantedPermissions(
            artifact({ grantedPermissions: {} }),
            enforcer(),
        );
        // Same registrations as the absent case (none), a DIFFERENT reading.
        // `declared` is the only thing that separates them, which is why it is
        // on the record at all.
        expect(binding.declared).toBe(true);
        expect(binding.registered).toEqual([]);
        expect(binding.unregistered).toEqual(['com.acme.crm', 'com.acme.reports']);
    });

    it('a `{}` ENTRY is a consent record that consented to nothing — registered, and denies', () => {
        const e = enforcer();
        const binding = registerArtifactGrantedPermissions(
            artifact({ grantedPermissions: { 'com.acme.crm': {} } }),
            e,
        );

        expect(binding.registered).toEqual(['com.acme.crm']);
        const perms = e.getPluginPermissions('com.acme.crm');
        // ⭐ DEFINED — the discriminator against the absent case one test up,
        // where the identical read is `undefined`. Both deny; only one of them
        // is a decision the installer made.
        expect(perms).toBeDefined();
        expect(perms!.canAccessService('object')).toBe(false);
        expect(perms!.canTriggerHook('record.beforeInsert')).toBe(false);
        expect(perms!.canNetworkRequest('https://api.acme.com/x')).toBe(false);
        expect(perms!.canReadFile('/tmp/x')).toBe(false);
    });

    it('a CONSENTED entry enforces exactly the consented surface and nothing beside it', () => {
        const e = enforcer();
        registerArtifactGrantedPermissions(
            artifact({ grantedPermissions: { 'com.acme.crm': CONSENTED } }),
            e,
        );

        const perms = e.getPluginPermissions('com.acme.crm')!;
        expect(perms.canAccessService('object')).toBe(true);
        expect(perms.canAccessService('storage')).toBe(false);
        expect(perms.canTriggerHook('record.beforeInsert')).toBe(true);
        expect(perms.canTriggerHook('record.afterDelete')).toBe(false);
        // `network: []` and `fs: []` are consented-to-nothing, not unconstrained.
        expect(perms.canNetworkRequest('https://api.acme.com/x')).toBe(false);
        expect(perms.canWriteFile('/tmp/x')).toBe(false);
    });

    it('a package the map does NOT name stays unregistered while its sibling is registered', () => {
        // ⭐ The boot-brick pin, and the reason the walk reads the MAP's keys
        // rather than the package list: a first-party package sharing an
        // artifact with a consent-bearing one must keep loading exactly as it
        // does today.
        const e = enforcer();
        const binding = registerArtifactGrantedPermissions(
            artifact({ grantedPermissions: { 'com.acme.crm': CONSENTED } }),
            e,
        );

        expect(binding.registered).toEqual(['com.acme.crm']);
        expect(binding.unregistered).toEqual(['com.acme.reports']);
        expect(e.getPluginPermissions('com.acme.reports')).toBeUndefined();
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#13457 — a consent record that binds to nothing is said out loud', () => {
    it('reports an entry naming a package this artifact does not carry, and does not register it', () => {
        const e = enforcer();
        const log = logger();
        const binding = registerArtifactGrantedPermissions(
            artifact({ grantedPermissions: { 'com.acme.ghost': CONSENTED } }),
            e,
            { logger: log as never },
        );

        expect(binding.unbound).toEqual(['com.acme.ghost']);
        expect(binding.registered).toEqual([]);
        expect(e.getPluginPermissions('com.acme.ghost')).toBeUndefined();
        expect(
            log.warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('bound to NO package')),
        ).toBe(true);
    });

    it('a map that is not a record at all reads as declared-with-nothing-bound', () => {
        const binding = resolveArtifactGrantBinding(artifact({ grantedPermissions: [] }));
        expect(binding.declared).toBe(true);
        expect(binding.registered).toEqual([]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// The artifact contract has no spelling for "a consent record exists but cannot
// be attributed": when a manifest carries no top-level string `id` the producer
// emits it under NO name, so to a consumer that case is indistinguishable from
// "no consent record".
//
// ⚠️ An earlier revision of this block claimed that case "cannot reach this
// seam", closed by two doors. MEASURED FALSE (#13457 contract review ⑤): the
// doors refuse two spellings and the THIRD — `{ id: '', name: 'x' }` — walks
// through both, because `artifactPackageId` is `id || name`. The fixture hid it
// by setting id and name to `''` together. Corrected here, and the case that
// escapes is pinned rather than described.
//
// ⛔ Each door test pins ITS OWN door. The earlier spelling asserted
// `/no usable package id|not a package entry/` on BOTH, so either test passed on
// either door: it pinned "refused by some door", never which — an alternation
// that would survive deleting a whole door. Both doors raise the SAME ADR-0112
// code and status, so only the message separates them.
describe('#13457 — which unattributable-consent spellings the doors refuse, and the one they do not', () => {
    /** The refusal both doors share, so the message assertions carry the rest. */
    const envelope = (err: any) => {
        expect(err).toBeDefined();
        expect(err.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expect(err.status).toBe(422);
    };
    const thrownBy = (fn: () => unknown): any => {
        try { fn(); } catch (e) { return e; }
        return undefined;
    };

    it('DOOR 1 (schema) — no top-level `id` is refused by `ArtifactPackageSchema`, which names `manifest.id`', () => {
        // `ManifestSchema.id` is a required `z.string()`, so the entry never
        // reaches the id door at all.
        const err = thrownBy(() => carriedPackageIds({ packages: [{ manifest: { name: '', version: '1.0.0' } }] }));
        envelope(err);
        expect(err.message).toContain('is not a package entry');
        expect(err.message).toContain('manifest.id');
        // ⛔ THIS door, not the other one: the id door never ran.
        expect(err.message).not.toContain('no usable package id');
    });

    it('DOOR 2 (id) — `\'\'` passes the schema and is refused by `artifactPackageId`, one door later', () => {
        // `z.string()` has no `.min(1)`, so `''` is a VALID manifest id to the
        // schema; it is `artifactPackageId` that yields `undefined` for it.
        const err = thrownBy(() => carriedPackageIds({ packages: [{ manifest: body('') }] }));
        envelope(err);
        expect(err.message).toContain('no usable package id');
        // ⛔ THIS door, not the other one: the schema admitted the entry.
        expect(err.message).not.toContain('is not a package entry');
    });

    // ⭐ The correction: the spelling NEITHER door refuses.
    it('NEITHER door refuses `{ id: \'\', name: \'x\' }` — `artifactPackageId` is `id || name`, so it is carried as `x`', () => {
        expect(carriedPackageIds({ packages: [{ manifest: body('', { id: '', name: 'x' }) }] }))
            .toEqual(['x']);
    });

    it('so a consent record keyed by the unattributable `\'\'` binds to NOTHING — loudly, and fail-OPEN', () => {
        // ⛔ What this pins is that the residual is fail-OPEN, not that it is
        // handled: the `''` key names no carried package, so it is reported as
        // `unbound` and registered nowhere. Nothing is silently DENIED — the
        // package still loads with no consent record at all, exactly as an
        // artifact that never declared one does. Whether an unbindable consent
        // record should instead REFUSE the artifact is an open decision
        // (#17148), and this test is what will go red when it is taken.
        const e = enforcer();
        const log = logger();
        const binding = registerArtifactGrantedPermissions(
            {
                manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app' },
                packages: [{ manifest: body('', { id: '', name: 'x' }) }],
                grantedPermissions: { '': CONSENTED },
            },
            e,
            { logger: log as never },
        );

        expect(binding.carried).toEqual(['x']);
        expect(binding.registered).toEqual([]);
        expect(binding.unbound).toEqual(['']);
        // Through the enforcer's OWN readback: neither the unattributable key
        // nor the package it failed to name is registered, so neither is denied.
        expect(e.getPluginPermissions('')).toBeUndefined();
        expect(e.getPluginPermissions('x')).toBeUndefined();
        expect(
            log.warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('bound to NO package')),
        ).toBe(true);
    });
});
