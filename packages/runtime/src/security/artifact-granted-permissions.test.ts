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
        // gate nothing on every single-package artifact.
        expect(carriedPackageIds({ manifest: { id: 'com.acme.solo' } })).toEqual(['com.acme.solo']);
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#13457 — absent, `{}`, and consented are THREE states, never two', () => {
    it('ABSENT key registers nothing — an artifact with no consent record is untouched', () => {
        const e = enforcer();
        const binding = registerArtifactGrantedPermissions(artifact(), e);

        expect(binding.declared).toBe(false);
        expect(binding.gated).toEqual([]);
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
        expect(binding.gated).toEqual([]);
        expect(binding.ungated).toEqual(['com.acme.crm', 'com.acme.reports']);
    });

    it('a `{}` ENTRY is a consent record that consented to nothing — registered, and denies', () => {
        const e = enforcer();
        const binding = registerArtifactGrantedPermissions(
            artifact({ grantedPermissions: { 'com.acme.crm': {} } }),
            e,
        );

        expect(binding.gated).toEqual(['com.acme.crm']);
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

    it('a package the map does NOT name stays ungated while its sibling is gated', () => {
        // ⭐ The boot-brick pin, and the reason the walk reads the MAP's keys
        // rather than the package list: a first-party package sharing an
        // artifact with a consent-bearing one must keep loading exactly as it
        // does today.
        const e = enforcer();
        const binding = registerArtifactGrantedPermissions(
            artifact({ grantedPermissions: { 'com.acme.crm': CONSENTED } }),
            e,
        );

        expect(binding.gated).toEqual(['com.acme.crm']);
        expect(binding.ungated).toEqual(['com.acme.reports']);
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
        expect(binding.gated).toEqual([]);
        expect(e.getPluginPermissions('com.acme.ghost')).toBeUndefined();
        expect(
            log.warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('bound to NO package')),
        ).toBe(true);
    });

    it('a map that is not a record at all reads as declared-with-nothing-bound', () => {
        const binding = resolveArtifactGrantBinding(artifact({ grantedPermissions: [] }));
        expect(binding.declared).toBe(true);
        expect(binding.gated).toEqual([]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#13457 — the unattributable-consent case cannot reach this seam', () => {
    // The artifact contract has no spelling for "a consent record exists but
    // cannot be attributed": when a manifest carries no top-level string `id`
    // the producer emits it under NO name, so to a consumer that case is
    // indistinguishable from "no consent record". This pin records WHY the
    // consumer never has to choose a behaviour for it: a package with no usable
    // id is refused BEFORE any grant question, by the platform's own package
    // sorter — and `ManifestSchema.id` is a required `z.string()`, so
    // `ArtifactPackageSchema` refuses the same shape one door earlier.
    it('a `packages[]` entry with no usable id is refused, not silently ungated', () => {
        expect(() => carriedPackageIds({ packages: [{ manifest: { name: '', version: '1.0.0' } }] }))
            .toThrow(/no usable package id|not a package entry/);
    });

    it('an empty-string id is refused too — `\'\'` is not a key anything can be attributed to', () => {
        expect(() => carriedPackageIds({ packages: [{ manifest: body('') }] }))
            .toThrow(/no usable package id|not a package entry/);
    });
});
