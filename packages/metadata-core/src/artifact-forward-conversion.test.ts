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
import { ObjectStackDefinitionSchema, applyConversionsToStoredItem, type ConversionNotice } from '@objectstack/spec';
import {
  applyArtifactForwardConversions,
  parseRangeFloor,
  resolveInstalledSpecVersion,
  type ArtifactConversionNotice,
} from './artifact-forward-conversion.js';

// ── Mirror pin ───────────────────────────────────────────────────────────────
// `ArtifactConversionNotice` is a structural mirror of the spec root's
// `ConversionNotice`, kept so the module's PUBLIC declarations never import
// the ~2MB spec root (the import made every downstream type program load the
// root twice — d.ts and d.mts flavors — and pushed the http-conformance
// TEST_DEBT re-measure over CI's ~4GB tsc heap ceiling; #12772 patch round).
// The TEST may reference the root freely — tests never ship declarations.
// Both assignability directions, so EITHER side drifting reds this suite:
type _SpecToMirror = ConversionNotice extends ArtifactConversionNotice ? true : never;
type _MirrorToSpec = ArtifactConversionNotice extends ConversionNotice ? true : never;
const _mirrorPin: [_SpecToMirror, _MirrorToSpec] = [true, true];
void _mirrorPin;

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

/**
 * ⛔ The artifact door must NOT invent a column constraint (#16693, maintainer
 * ruling 2026-09-08, option A).
 *
 * This is the seam the card measured. `retiredFromLoadPath` does NOT hold a
 * conversion back here — this module replays the chain with `includeRetired:
 * true` on purpose — so a conversion that stamped `storage: { notNull: true }`
 * onto every `required: true` field reached every artifact whose declared
 * `engines.protocol` FLOOR sat below the running spec. `^17.0.0` is the range
 * `create-objectstack` stamps, so that was every scaffolded app, from its first
 * boot: NOT NULL columns nobody asked for, plus a warning instructing the
 * author to write the same tightening into the source — a `destructive`
 * `tighten_not_null` migration on any populated database, prescribed as the
 * remedy for a deprecation notice.
 *
 * ADR-0113 is the protocol: `required` is the write-time contract and NOT a
 * column constraint; `storage.notNull` alone binds the column, and only an
 * author writes it.
 */
describe('the artifact door never stamps a column constraint (ADR-0113, #16693)', () => {
  const requiredFieldDefinition = (protocolRange: string) => ({
    manifest: {
      id: 'app.example.clm', name: 'clm', version: '1.0.0', type: 'app',
      engines: { protocol: protocolRange },
    },
    objects: [{
      name: 'clm_party',
      label: 'Party',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        notes: { type: 'textarea', label: 'Notes' },
      },
    }],
  });

  it('leaves `required: true` alone on an artifact the retired window IS open for', () => {
    const def = requiredFieldDefinition('^17.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.3.0' });

    // ⭐ ANTI-VACUITY, and the whole point of the pin: the window really is
    // open on this input. A green line below because the door skipped this
    // artifact entirely would prove nothing.
    expect(result.verdict).toBe('converted-forward');
    expect(result.authoredFloor).toBe('17.0.0');

    const fields = (result.definition as { objects: { fields: Record<string, { storage?: unknown; required?: boolean }> }[] })
      .objects[0]!.fields;
    expect(fields.name!.required, 'the write contract is untouched').toBe(true);
    expect(fields.name!.storage, 'no NOT NULL is invented for the author').toBeUndefined();
    expect(fields.notes!.storage).toBeUndefined();
    expect(result.notices.map((n) => n.conversionId)).not.toContain('field-required-notnull-explicit');
    // Copy-on-write: nothing was recognized, so the door hands back the same
    // reference it was given.
    expect(result.definition).toBe(def);
  });

  it('keeps an explicitly declared `storage.notNull` — the author\'s own act still binds the column', () => {
    const def = requiredFieldDefinition('^17.0.0') as unknown as {
      objects: { fields: Record<string, Record<string, unknown>> }[];
    };
    def.objects[0]!.fields.name!.storage = { notNull: true };
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.3.0' });
    expect(result.verdict).toBe('converted-forward');
    expect((result.definition as typeof def).objects[0]!.fields.name!.storage).toEqual({ notNull: true });
  });

  /**
   * ⭐ FIRING CONTROL for the two assertions above. They are negatives, so they
   * are worthless unless this instrument can still be made to say YES in the
   * same window — a door that had stopped converting anything at all would make
   * them green for the wrong reason.
   */
  it('still replays other retired conversions in that same window (the instrument fires)', () => {
    const def = legacyPermissionDefinition('^17.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.3.0' });
    expect(result.verdict).toBe('converted-forward');
    expect(result.notices.length).toBeGreaterThan(0);
    // A rewrite actually landed on the same floor the assertions above use:
    // the retired permission bits are gone, and copy-on-write proves it by
    // handing back a DIFFERENT object than it was given.
    const objects = (result.definition as { permissions: { objects: Record<string, Record<string, unknown>> }[] })
      .permissions[0]!.objects;
    expect(objects.crm_ticket!.allowRestore).toBeUndefined();
    expect(objects.crm_ticket!.allowPurge).toBeUndefined();
    expect(objects.crm_ticket!.allowRead, 'only the retired bits move').toBe(true);
    expect(result.definition).not.toBe(def);
  });
});

/**
 * #17885 — the artifact door must not replay the DEFAULT-FLIP class.
 *
 * `app-hidden-to-unpublished` (#4829, ADR-0045 amended 2026-08-09) rewrites
 * `app.hidden: true` into `app._unpublished: true`. Both keys are live and
 * they mean opposite kinds of thing: `hidden` is navigation presentation and
 * *"never an access gate"* (`ui/app.zod.ts`), while `_unpublished` is the
 * machine-managed publish gate `filterAppForUser` drops the app on for every
 * user without `studio.access` / `setup.access`
 * (`packages/rest/src/rest-server.ts` — untouched by this fix, and correct:
 * the defect is WHO writes `_unpublished`).
 *
 * The entry is `retiredFromLoadPath: true`, which does NOT hold it back here —
 * that flag's jurisdiction is the authoring funnel and nothing else (#16864's
 * determination, landed). So before this fix an artifact declaring
 * `engines.protocol: ^17.0.0` — the range `create-objectstack` stamps — had
 * every `defineApp({ hidden: true })` in it registered as an unpublished app,
 * reproducing the very incident the `_unpublished` split was introduced to
 * end, through the conversion layer.
 *
 * Four legs, and the two controls are what make the first two mean anything:
 * SUBJECT (the window is open and `hidden` survives) · NEGATIVE (a floor the
 * window is shut for) · POSITIVE, twice (a non-retired conversion AND a
 * retired one still fire in the subject's own window — the door is narrowed,
 * not closed) · and the entry itself still firing at the seam it is sound at.
 */
describe('the artifact door never turns an authored `hidden: true` into an unpublished app (#17885, #4829)', () => {
  /** One authored `hidden: true` app, plus a `jsx` page as the live non-retired control. */
  const hiddenAppDefinition = (protocolRange: string) => ({
    manifest: {
      id: 'app.example.hr', name: 'hr', version: '1.0.0', type: 'app',
      engines: { protocol: protocolRange },
    },
    apps: [{ name: 'account', label: 'Account', hidden: true, navigation: [] }],
  });

  it('leaves `hidden: true` alone on an artifact the retired window IS open for', () => {
    const def = hiddenAppDefinition('^17.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });

    // ⭐ ANTI-VACUITY: the window really is open on this input. A green line
    // below because the door skipped the artifact would prove nothing.
    expect(result.verdict).toBe('converted-forward');
    expect(result.authoredFloor).toBe('17.0.0');

    const app = (result.definition as { apps: Record<string, unknown>[] }).apps[0]!;
    expect(app.hidden, 'the authored navigation choice is untouched').toBe(true);
    expect(app._unpublished, 'no publish gate is invented for the author').toBeUndefined();
    expect(result.notices.map((n) => n.conversionId)).not.toContain('app-hidden-to-unpublished');
    // Copy-on-write: nothing was recognized, so the same reference comes back.
    expect(result.definition).toBe(def);
  });

  /**
   * ⭐⭐ The assertion that actually matters: the door's output is fed to
   * `ObjectStackDefinitionSchema.parse` in `MetadataPlugin._parseAndRegisterArtifact`,
   * and THAT object is what reaches registration and then `filterAppForUser`.
   * A pin on the conversion's return value alone would not have caught a strict
   * parse that re-introduced the key.
   */
  it('registers `hidden: true` — asserted AFTER the strict parse the door feeds', () => {
    const def = hiddenAppDefinition('^17.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });
    expect(result.verdict).toBe('converted-forward');

    const parsed = ObjectStackDefinitionSchema.parse(result.definition) as {
      apps?: { name: string; hidden?: boolean; _unpublished?: boolean }[];
    };
    const registered = parsed.apps!.find((a) => a.name === 'account')!;
    expect(registered.hidden, 'what registration receives').toBe(true);
    expect(registered._unpublished, 'what `filterAppForUser` withholds on').toBeUndefined();
  });

  /**
   * ⭐ NEGATIVE CONTROL — the instrument can answer "no" for the other reason.
   * A floor at or above the runtime shuts the window outright, so `hidden`
   * surviving here says nothing about the fix; it says the leg above was read
   * on an input where the window was genuinely open.
   */
  it('floor ^99.0.0 — the window is shut and nothing is replayed at all', () => {
    const def = hiddenAppDefinition('^99.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });
    expect(result.verdict).toBe('authored-current');
    expect(result.notices).toEqual([]);
    expect((result.definition as { apps: Record<string, unknown>[] }).apps[0]!.hidden).toBe(true);
  });

  /**
   * ⭐ FIRING CONTROL 1 — a NON-RETIRED conversion still fires in the subject's
   * own window. `page-kind-jsx-to-html` (ADR-0080) is not retired, so a door
   * that had stopped converting anything would fail here.
   */
  it('still applies a non-retired conversion in that same window', () => {
    const def = {
      ...hiddenAppDefinition('^17.0.0'),
      pages: [{ name: 'landing', kind: 'jsx', source: '<div>hi</div>' }],
    };
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });
    expect(result.verdict).toBe('converted-forward');
    expect(result.notices.map((n) => n.conversionId)).toContain('page-kind-jsx-to-html');
    expect((result.definition as { pages: Record<string, unknown>[] }).pages[0]!.kind).toBe('html');
    // …and the app in the SAME artifact still keeps its authored key.
    expect((result.definition as { apps: Record<string, unknown>[] }).apps[0]!.hidden).toBe(true);
  });

  /**
   * ⭐ FIRING CONTROL 2 — and the RETIRED window is still open, which is the
   * control this particular fix could plausibly have broken. Closing the
   * retired window wholesale would fix #17885 and re-break #12772: an artifact
   * built by 17.1.0 tooling would again be refused at the tombstone.
   */
  it('still replays RETIRED conversions in that same window (#12772 is not reversed)', () => {
    const def = legacyPermissionDefinition('^17.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });
    expect(result.verdict).toBe('converted-forward');
    const objects = (result.definition as { permissions: { objects: Record<string, Record<string, unknown>> }[] })
      .permissions[0]!.objects;
    expect(objects.crm_ticket!.allowRestore).toBeUndefined();
    expect(objects.crm_ticket!.allowPurge).toBeUndefined();
    expect(result.notices.length).toBeGreaterThan(0);
  });

  /**
   * ⭐ SEAM SCOPE — the entry is refused by THIS DOOR, not removed from the
   * chain. The stored-row seam, where a `hidden: true` row can only have come
   * from the pre-split materialization path, still carries the population
   * across. A fix that had neutered the entry would go green on every leg
   * above and silently strand those rows.
   */
  it('leaves the entry firing at the stored-row seam it is sound at', () => {
    const row = applyConversionsToStoredItem('app', {
      name: 'production_management', label: 'Production', hidden: true, navigation: [],
    }) as Record<string, unknown>;
    expect(row._unpublished, 'the stored-row seam still converts').toBe(true);
    expect(row.hidden).toBeUndefined();
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
