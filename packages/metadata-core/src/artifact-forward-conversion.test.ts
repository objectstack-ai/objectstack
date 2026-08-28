// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Versioned artifact forward conversion (#12772) — the policy, both directions.
 *
 * The measured incident: an artifact built by released 17.1.0 tooling carries
 * `allowRestore`/`allowPurge` permission bits (legal when it was built, retired
 * in spec 17.2.0), and the 17.2 runtime's strict parse refuses the boot. The
 * ADR-0087 registry already declares the strip conversion
 * (`permission-allow-restore-purge-removed`, `retiredFromLoadPath: true`);
 * what was missing is a door that opens the retired window for artifacts whose
 * declared `engines.protocol` floor predates the running spec — and ONLY for
 * those. Both directions are pinned here: the amnesty (older floor converts
 * forward) and its boundary (current-or-newer floor does not — the tombstone
 * stays the authority), because an unconditional strip becomes wrong the day
 * the keys return to the spec (roadmap M2, #1883).
 */

import { describe, it, expect } from 'vitest';
import {
  applyArtifactForwardConversions,
  parseRangeFloor,
  resolveInstalledSpecVersion,
} from './artifact-forward-conversion.js';

/** The measured 17.1-built shape: full CRUD plus the two retired lifecycle bits. */
function legacyPermissionDefinition(protocolRange: string | undefined) {
  return {
    manifest: {
      id: 'app.example.crm',
      name: 'crm',
      version: '3.0.0',
      type: 'app',
      ...(protocolRange ? { engines: { protocol: protocolRange } } : {}),
    },
    permissions: [
      {
        name: 'support_agent',
        label: 'Support Agent',
        objects: {
          crm_ticket: {
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: true,
            allowRestore: true,
            allowPurge: false,
          },
          crm_note: { allowRead: true },
        },
      },
    ],
  };
}

describe('applyArtifactForwardConversions — the versioned window (#12772)', () => {
  it('converts a 17.1-authored artifact forward on a 17.2 runtime: retired keys stripped, everything else byte-preserved', () => {
    const def = legacyPermissionDefinition('^17.1.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.2.0' });

    expect(result.verdict).toBe('converted-forward');
    expect(result.authoredFloor).toBe('17.1.0');

    const converted = result.definition as typeof def;
    const grant = converted.permissions[0]!.objects.crm_ticket as Record<string, unknown>;
    expect(grant).not.toHaveProperty('allowRestore');
    expect(grant).not.toHaveProperty('allowPurge');
    // Everything else byte-preserved: same keys, same values, and the
    // untouched sibling object rides through by reference (copy-on-write).
    expect(grant).toEqual({ allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true });
    expect(converted.permissions[0]!.objects.crm_note).toBe(def.permissions[0]!.objects.crm_note);
    expect(converted.manifest).toBe(def.manifest);

    // Loud, not silent: one notice per stripped key.
    const stripNotices = result.notices.filter(
      (n) => n.conversionId === 'permission-allow-restore-purge-removed',
    );
    expect(stripNotices).toHaveLength(2);
    expect(stripNotices.map((n) => n.path)).toEqual([
      'permissions[0].objects.crm_ticket.allowRestore',
      'permissions[0].objects.crm_ticket.allowPurge',
    ]);
  });

  it('REFUSES the amnesty for an artifact authored at the current spec version — no blanket strip', () => {
    const def = legacyPermissionDefinition('^17.2.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.2.0' });

    expect(result.verdict).toBe('authored-current');
    expect(result.notices).toEqual([]);
    // The definition comes back by reference, retired keys still present —
    // the strict parse downstream is what answers, with the tombstone.
    expect(result.definition).toBe(def);
    expect(def.permissions[0]!.objects.crm_ticket).toHaveProperty('allowPurge');
  });

  it('REFUSES the amnesty for an artifact authored at a NEWER spec than the runtime', () => {
    const def = legacyPermissionDefinition('^18.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.2.0' });
    expect(result.verdict).toBe('authored-current');
    expect(result.definition).toBe(def);
  });

  it('treats a bare-major range (`^17`, the init scaffold default) as floor 17.0.0 — older than 17.2, so it converts', () => {
    const def = legacyPermissionDefinition('^17');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.2.0' });
    expect(result.verdict).toBe('converted-forward');
    expect(result.authoredFloor).toBe('17.0.0');
    const grant = (result.definition as typeof def).permissions[0]!.objects.crm_ticket;
    expect(grant).not.toHaveProperty('allowPurge');
  });

  it('replays the full chain for an artifact with NO declared range — the stored-row posture for data of unknown age', () => {
    const def = legacyPermissionDefinition(undefined);
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.2.0' });
    expect(result.verdict).toBe('converted-undeclared');
    expect(result.authoredFloor).toBeNull();
    const grant = (result.definition as typeof def).permissions[0]!.objects.crm_ticket;
    expect(grant).not.toHaveProperty('allowRestore');
  });

  it('closes the window when the runtime spec version cannot be resolved — amnesty needs positive version evidence', () => {
    const def = legacyPermissionDefinition('^17.1.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: null });
    expect(result.verdict).toBe('runtime-version-unknown');
    expect(result.definition).toBe(def);
    expect(def.permissions[0]!.objects.crm_ticket).toHaveProperty('allowPurge');
  });

  it('is idempotent: a definition already canonical for its floor comes back by reference', () => {
    const def = {
      manifest: { id: 'app.example.clean', name: 'clean', version: '1.0.0', type: 'app', engines: { protocol: '^17.1.0' } },
      permissions: [
        { name: 'reader', label: 'Reader', objects: { crm_note: { allowRead: true } } },
      ],
    };
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.2.0' });
    expect(result.verdict).toBe('converted-forward');
    expect(result.notices).toEqual([]);
    // applyConversions is copy-on-write, so "nothing recognized" is provable
    // by identity, not just equality.
    expect(result.definition).toBe(def);
  });

  it('passes non-object input through untouched', () => {
    expect(applyArtifactForwardConversions(null, { runtimeSpecVersion: '17.2.0' }).verdict).toBe('not-an-object');
    expect(applyArtifactForwardConversions([1], { runtimeSpecVersion: '17.2.0' }).verdict).toBe('not-an-object');
  });

  it('defaults the runtime version to the installed @objectstack/spec version', () => {
    const installed = resolveInstalledSpecVersion();
    // In this workspace spec is always resolvable; the default path must find
    // the same answer an explicit resolution finds.
    expect(installed).toMatch(/^\d+\.\d+\.\d+/);
    const def = legacyPermissionDefinition('^0.0.1');
    const result = applyArtifactForwardConversions(def);
    expect(result.runtimeSpecVersion).toBe(installed);
    expect(result.verdict).toBe('converted-forward');
  });
});

describe('parseRangeFloor — the range spellings artifacts actually carry', () => {
  it.each([
    ['^17.1.0', [17, 1, 0]],
    ['^17', [17, 0, 0]],
    ['~17.2.1', [17, 2, 1]],
    ['>=17.1 <18', [17, 1, 0]],
    ['17.1.0', [17, 1, 0]],
    ['v17.1.0', [17, 1, 0]],
  ] as const)('%s → %j', (range, expected) => {
    expect(parseRangeFloor(range)).toEqual(expected);
  });

  it('answers null for unreadable ranges (treated like undeclared by the policy)', () => {
    expect(parseRangeFloor('')).toBeNull();
    expect(parseRangeFloor('latest')).toBeNull();
    expect(parseRangeFloor('x'.repeat(200))).toBeNull();
  });
});
