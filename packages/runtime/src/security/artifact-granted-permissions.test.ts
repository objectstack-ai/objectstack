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
//
// ⛔ VERB DISCIPLINE (#17147). Every case here reads a permission BAG and
// asserts what it ANSWERS. None of them asserts that anything was refused, and
// none of them could: nothing on this tree queries the registry these entries
// land in — `SecurePluginContext` has no production construction site, and the
// fs/network gates have no caller at all. Two case titles here used to say
// `enforces` and `denies`, and a case title is read as evidence (ADR-0033: an
// AI author reading this file concludes the platform confines plugins and
// writes a manifest expecting it). So: `answers`, `registered`, `bound` — ⛔
// never `enforces`, `denies`, `gates`, `refuses` or `blocks` until the seam
// exists. The measurement that decides when it does is pinned in
// `@objectstack/core`'s `granted-permissions-not-enforced.pin.test.ts`, whose
// negative assertion is repo-wide and covers this file too.

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

    it('a `{}` ENTRY is a consent record that consented to nothing — registered, and its bag answers NO to everything', () => {
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

    it("a CONSENTED entry's bag ANSWERS yes to exactly the consented surface and nothing beside it", () => {
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
// ⚠️ HISTORY, kept because both corrections are load-bearing. An earlier
// revision of this block claimed that case "cannot reach this seam", closed by
// two doors. MEASURED FALSE (#13457 contract review ⑤): the doors refused two
// spellings and the THIRD — `{ id: '', name: 'x' }` — walked through both,
// because `artifactPackageId` is `id || name`. The fixture had hidden it by
// setting id and name to `''` together, and the escape was pinned here rather
// than described.
//
// ⭐ #17534 CLOSED that escape, and this block now pins the closure.
// `ManifestSchema.id` carries `MANIFEST_ID_PATTERN`
// (`packages/spec/src/kernel/manifest.zod.ts`) — the reverse-domain rule the
// registry face has always enforced — so `''` is no longer a valid manifest id
// to the SCHEMA. Every `''` spelling, the bare one and the
// `{ id: '', name: 'x' }` one that used to walk through, is now refused at
// DOOR 1, before `artifactPackageId` is ever consulted. ⇒ the `id || name`
// fallback is unreachable for `''`, and the fail-OPEN residual the last case in
// this block used to pin is GONE — the artifact is refused outright instead.
//
// ⛔ Each door test still pins ITS OWN door. The pre-#13457 spelling asserted
// `/no usable package id|not a package entry/` on BOTH, so either test passed on
// either door: it pinned "refused by some door", never which — an alternation
// that would survive deleting a whole door. Both doors raise the SAME ADR-0112
// code and status, so only the message separates them, and every case below
// asserts its own door's message AND the absence of the other's.
describe('#13457 / #17534 — which unattributable-consent spellings the doors refuse, and at which door', () => {
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
        // `ManifestSchema.id` is REQUIRED, so a missing id is a schema issue
        // and the entry never reaches the id door at all. This case turns on
        // requiredness alone — it predates `MANIFEST_ID_PATTERN` and is
        // unaffected by it, which is why it was already green.
        const err = thrownBy(() => carriedPackageIds({ packages: [{ manifest: { name: '', version: '1.0.0' } }] }));
        envelope(err);
        expect(err.message).toContain('is not a package entry');
        expect(err.message).toContain('manifest.id');
        // ⛔ THIS door, not the other one: the id door never ran.
        expect(err.message).not.toContain('no usable package id');
    });

    it('DOOR 1 (schema) — `\'\'` is refused by `MANIFEST_ID_PATTERN`, so the id door one later never runs', () => {
        // ⭐ #17534 moved this case one door EARLIER, which is why it is a
        // DOOR 1 pin now and was a DOOR 2 pin before. `ManifestSchema.id` used
        // to be a bare `z.string()`, so `''` was a VALID manifest id to the
        // schema and it was `artifactPackageId` that yielded `undefined` for it,
        // one door later. The id now carries the reverse-domain pattern, so the
        // entry never survives the schema at all.
        const err = thrownBy(() => carriedPackageIds({ packages: [{ manifest: body('') }] }));
        envelope(err);
        expect(err.message).toContain('is not a package entry');
        expect(err.message).toContain('manifest.id');
        // The refusal ECHOES the value it refused (#4001), so an author who
        // wrote an empty id is told which key was empty rather than only which
        // rule was broken.
        expect(err.message).toContain("Invalid package id ''");
        // ⛔ THIS door, not the other one: the id door never ran.
        expect(err.message).not.toContain('no usable package id');
    });

    // ⭐ The escape #13457 corrected this block to pin, now CLOSED by #17534.
    // `artifactPackageId` is still `id || name` — ⛔ untouched by that change —
    // but DOOR 1 refuses the entry before the fallback is ever consulted, so an
    // empty id can no longer be carried under a sibling `name`.
    it('`{ id: \'\', name: \'x\' }` is refused at DOOR 1 too — the `id || name` fallback never runs for `\'\'`', () => {
        const err = thrownBy(
            () => carriedPackageIds({ packages: [{ manifest: body('', { id: '', name: 'x' }) }] }),
        );
        // That it THREW is the assertion that it was not carried: before #17534
        // this exact call returned `['x']` and never reached here.
        envelope(err);
        expect(err.message).toContain('is not a package entry');
        expect(err.message).toContain('manifest.id');
        expect(err.message).toContain("Invalid package id ''");
        // ⛔ THIS door, not the other one: the sibling `name` was never
        // consulted, so the id door had nothing to refuse.
        expect(err.message).not.toContain('no usable package id');
    });

    it('so an artifact whose consent record is keyed by `\'\'` never materializes — nothing is registered, and the residual is fail-CLOSED', () => {
        // ⭐ #17534 REVERSED the direction this case pins, and that reversal is
        // why the changeset names it. What it used to pin was a fail-OPEN
        // residual: the `''` key named no carried package, so it was reported
        // `unbound`, the package still loaded with no consent record at all, and
        // nothing was denied. DOOR 1 now refuses the entry, so the whole
        // artifact is refused at materialize time and NO package loads —
        // fail-CLOSED.
        //
        // ⛔ Read the refusal's provenance precisely: it is the artifact PACKAGE
        // door (`resolveArtifactPackageOrder`) refusing a malformed manifest id,
        // NOT the permission seam acquiring teeth. Nothing on this tree queries
        // the registry these entries land in — see this file's header, and
        // `granted-permissions-not-enforced.pin.test.ts` in `@objectstack/core`
        // for the repo-wide measurement, which is still green.
        //
        // ⛔ #17148 is NOT what took this red, and is NOT settled by it. Whether
        // an UNBINDABLE consent record should refuse the artifact is still open,
        // and still open for every key that is unbindable while being a LEGAL
        // id — `{ 'com.acme.ghost': … }`, pinned earlier in this file, still
        // binds to nothing and still only warns. What closed here is narrower:
        // `''` stopped being a legal id at all, so this one spelling can no
        // longer reach the unbindable state.
        const e = enforcer();
        const log = logger();
        const err = thrownBy(() => registerArtifactGrantedPermissions(
            {
                manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app' },
                packages: [{ manifest: body('', { id: '', name: 'x' }) }],
                grantedPermissions: { '': CONSENTED },
            },
            e,
            { logger: log as never },
        ));

        envelope(err);
        expect(err.message).toContain('manifest.id');
        // ⛔ THIS door, not the other one.
        expect(err.message).not.toContain('no usable package id');

        // The "loudly" half of the old title is gone with the residual it
        // described: the refusal itself is the loud part now, and the
        // bound-to-NO-package warning is never reached.
        expect(log.warn).not.toHaveBeenCalled();

        // Through the enforcer's OWN readback — this file's standing discipline:
        // the binding record is what this module says it did, the enforcer is
        // what actually happened. Neither the unattributable key nor the package
        // it failed to name is registered, and unlike the fail-OPEN residual this
        // replaces, the package it would have named did not load either.
        expect(e.getPluginPermissions('')).toBeUndefined();
        expect(e.getPluginPermissions('x')).toBeUndefined();
    });
});
