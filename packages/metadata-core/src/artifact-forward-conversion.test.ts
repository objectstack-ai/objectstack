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
import { ObjectStackDefinitionSchema, applyConversions, applyConversionsToStoredItem, type ConversionNotice } from '@objectstack/spec';
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
    // "Current" for THIS registry: every retirement it carries is stamped
    // `retiredAfter` 17.4.0 or earlier, so a 17.5.0 floor on a 17.5.0 runtime
    // predates none of them. (A floor at the label that DOES predate one opens
    // the per-entry window instead — the #20390 block below.)
    const def = legacyPermissionDefinition('^17.5.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.5.0' });

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

/**
 * [#20390] The per-entry window — `retiredAfter` (ruling 5865890672, letter A).
 *
 * Between two releases `main` refuses keys the NEXT release retires while its
 * package label still reads the LAST release. A label-only window therefore
 * read an artifact built by that last release as "authored current" and let
 * the strict parse refuse it — the measured cloud re-cut: a 17.4.0-built
 * artifact with dashboard charts and page `assignedProfiles` could not boot on
 * a runtime built from `main` (label 17.4.0, retirements stamped for 17.5.0).
 *
 * The rule: entry E replays when `floor < runtime` OR `floor <= E.retiredAfter`.
 * The runtime label is injected so each leg names the release it models; the
 * registry is always this tree's real one, whose 17.5.0 retirements carry
 * `retiredAfter: '17.4.0'` (pinned against the tarballs in spec's census test).
 */
describe('[#20390] the per-entry window — an artifact built by the last release boots on unreleased main', () => {
  /** The shape the published 17.4.0 CLI emits for a chart widget and an assigned page. */
  const builtBy174 = (protocolRange: string) => ({
    manifest: {
      id: 'com.example.forward-probe', namespace: 'fwd', name: 'forward_probe', version: '1.0.0', type: 'app',
      engines: { protocol: protocolRange },
    },
    objects: [{
      name: 'fwd_deal', label: 'Deal', sharingModel: 'private',
      fields: { stage: { type: 'text', label: 'Stage' }, amount: { type: 'number', label: 'Amount' } },
    }],
    datasets: [{
      name: 'fwd_deal_metrics', label: 'Deal metrics', object: 'fwd_deal',
      dimensions: [{ name: 'stage', field: 'stage' }],
      measures: [{ name: 'amount', aggregate: 'sum', field: 'amount' }],
    }],
    dashboards: [{
      name: 'fwd_pipeline', label: 'Pipeline',
      widgets: [{
        id: 'amount_by_stage', title: 'Amount by stage', type: 'bar',
        dataset: 'fwd_deal_metrics', dimensions: ['stage'], values: ['amount'],
        chartConfig: {
          type: 'bar',
          xAxis: { field: 'stage', showGridLines: true, logarithmic: false },
          yAxis: [{ field: 'amount', showGridLines: true, logarithmic: false }],
          showLegend: true, showDataLabels: false,
        },
        layout: { x: 0, y: 0, w: 6, h: 4 },
      }],
    }],
    pages: [{
      name: 'fwd_deal_desk', label: 'Deal Desk', type: 'app', template: 'default', regions: [],
      isDefault: false, assignedProfiles: ['sales_manager'], kind: 'full',
    }],
  });

  /** The retired-key sites the 17.5.0 cohort refuses in {@link builtBy174}. */
  const RETIRED_SITES = [
    'dashboards.0.widgets.0.chartConfig.type',
    'dashboards.0.widgets.0.chartConfig.xAxis',
    'dashboards.0.widgets.0.chartConfig.yAxis',
    'pages.0.assignedProfiles',
  ];

  const issuePaths = (value: unknown): string[] => {
    const parsed = ObjectStackDefinitionSchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.')).sort();
  };

  const byConversion = (notices: readonly ArtifactConversionNotice[]) => {
    const counts: Record<string, number> = {};
    for (const n of notices) counts[n.conversionId] = (counts[n.conversionId] ?? 0) + 1;
    return counts;
  };

  it('premise: unconverted, this tree refuses the 17.4.0-built shape at exactly the retired sites', () => {
    expect(issuePaths(builtBy174('^17.4.0'))).toEqual(RETIRED_SITES);
  });

  // Pin (4): the regression case from the card's acceptance.
  it('unreleased main (label 17.4.0), artifact at the last release (^17.4.0): the 17.5.0 retirements replay and the parse passes', () => {
    const def = builtBy174('^17.4.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });

    expect(result.verdict).toBe('converted-retired-after');
    expect(result.authoredFloor).toBe('17.4.0');
    expect(byConversion(result.notices)).toEqual({
      'page-assigned-profiles-removed': 1,
      'dashboard-widget-chart-config-structure-removed': 3,
    });
    expect(result.notices.map((n) => n.path).sort()).toEqual([
      'dashboards[0].widgets[0].chartConfig.type',
      'dashboards[0].widgets[0].chartConfig.xAxis',
      'dashboards[0].widgets[0].chartConfig.yAxis',
      'pages[0].assignedProfiles',
    ]);
    // What the door hands the strict parse now boots.
    expect(issuePaths(result.definition)).toEqual([]);
    // The door names what opened it: each retirement this runtime enforces past
    // the floor, with the release it retired after — never a default flip.
    const replayed = new Map(result.replayedRetirements.map((r) => [r.conversionId, r.retiredAfter]));
    expect(replayed.get('page-assigned-profiles-removed')).toBe('17.4.0');
    expect(replayed.get('dashboard-widget-chart-config-structure-removed')).toBe('17.4.0');
    expect(replayed.has('flow-decision-mode-inclusive-explicit')).toBe(false);
    expect([...new Set(replayed.values())]).toEqual(['17.4.0']);
  });

  // Pin (3): the boundary the per-entry rule must keep.
  it('an artifact whose floor is exactly 17.5.0 on a 17.5.0-labelled runtime is refused, not converted', () => {
    const def = builtBy174('^17.5.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.5.0' });

    expect(result.verdict).toBe('authored-current');
    expect(result.notices).toEqual([]);
    expect(result.replayedRetirements).toEqual([]);
    expect(result.definition).toBe(def);
    // The strict parse the door feeds refuses every retired site, tombstones included.
    expect(issuePaths(result.definition)).toEqual(RETIRED_SITES);
  });

  it('after the release (label 17.5.0) the same ^17.4.0 artifact converts through the label half — the rule reduces to the old one', () => {
    const result = applyArtifactForwardConversions(builtBy174('^17.4.0'), { runtimeSpecVersion: '17.5.0' });
    expect(result.verdict).toBe('converted-forward');
    // The label half names no per-entry reason: the whole chain replays on one.
    expect(result.replayedRetirements).toEqual([]);
    expect(byConversion(result.notices)).toEqual({
      'page-assigned-profiles-removed': 1,
      'dashboard-widget-chart-config-structure-removed': 3,
    });
    expect(issuePaths(result.definition)).toEqual([]);
  });

  /**
   * Inside the open per-entry window, an entry the floor post-dates still
   * refuses: `permission-allow-restore-purge-removed` shipped retired in 17.2.0
   * (`retiredAfter` 17.1.0), so a ^17.4.0 artifact carrying `allowRestore: true`
   * meets its tombstone although the 17.5.0 entries replay beside it. A key
   * retired at V stays a loud refusal for anything authored at >= V.
   */
  it('replays only the entries the floor predates — an older retirement still meets its tombstone', () => {
    const def = {
      ...builtBy174('^17.4.0'),
      permissions: [{ name: 'fwd_agent', label: 'Agent', objects: { fwd_deal: { allowRead: true, allowRestore: true } } }],
    };
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });

    expect(result.verdict).toBe('converted-retired-after');
    expect(result.notices.map((n) => n.conversionId)).not.toContain('permission-allow-restore-purge-removed');
    const grant = (result.definition as typeof def).permissions[0]!.objects.fwd_deal;
    expect(grant.allowRestore, 'the 17.2.0 retirement is not replayed for a 17.4.0 floor').toBe(true);
    expect(issuePaths(result.definition)).toEqual(['permissions.0.objects.fwd_deal.allowRestore']);
  });
});

/**
 * #15429 — the second member of the DEFAULT-FLIP class this door refuses.
 *
 * `flow-decision-mode-inclusive-explicit` writes `mode: 'inclusive'` onto an
 * edge-branched `decision` with two or more conditioned out-edges, so a flow
 * written while every true branch ran keeps that behaviour now that the
 * traversal is exclusive. An omitted `mode` IS the exclusive gateway by the
 * contract on `DecisionConfigSchema`, so the rewrite reinterprets a legal
 * shape — sound only where the source's age is a fact (`os migrate meta
 * --from 17`, the operator's assertion). At this door the trigger is the
 * artifact's declared `engines.protocol` floor, and `^17.0.0` is what
 * `create-objectstack` stamps: an app scaffolded today, authored against the
 * exclusive contract, lands inside the window. Replaying the entry here would
 * hand it an inclusive gateway it never asked for — the #17885 shape, on a
 * key whose omission is the ruled default.
 *
 * Same four legs as the block above: SUBJECT (window open, no `mode`
 * written) · the strict parse the door feeds · NEGATIVE (window shut) ·
 * FIRING CONTROL (the entry WOULD rewrite this very fixture with the window
 * open and no refusal, so the subject leg cannot pass vacuously).
 */
describe('the artifact door never writes `mode: inclusive` onto an authored exclusive decision (#15429)', () => {
  /** One edge-branched decision with two conditioned out-edges and no `mode` — the shape the entry rewrites. */
  const twoBranchDecisionDefinition = (protocolRange: string) => ({
    manifest: {
      id: 'app.example.leads', name: 'leads', version: '1.0.0', type: 'app',
      engines: { protocol: protocolRange },
    },
    flows: [{
      name: 'lead_verdict',
      label: 'Lead verdict',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'verdict', type: 'decision', label: 'Verdict?' },
        { id: 'refuse', type: 'end', label: 'Refuse' },
        { id: 'convert', type: 'end', label: 'Convert' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'verdict' },
        { id: 'e2', source: 'verdict', target: 'refuse', condition: "lead.status != 'suspected'", label: 'Refuse' },
        { id: 'e3', source: 'verdict', target: 'convert', condition: "lead.status == 'confirmed'", label: 'Convert' },
      ],
    }],
  });
  const ID = 'flow-decision-mode-inclusive-explicit';
  const verdictNodeOf = (definition: unknown) =>
    (definition as { flows: { nodes: { id: string; config?: Record<string, unknown> }[] }[] })
      .flows[0]!.nodes.find((n) => n.id === 'verdict')!;

  it('leaves the decision without `mode` on an artifact the retired window IS open for', () => {
    const def = twoBranchDecisionDefinition('^17.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });

    // ⭐ ANTI-VACUITY: the window really is open on this input.
    expect(result.verdict).toBe('converted-forward');
    expect(result.authoredFloor).toBe('17.0.0');

    const verdict = verdictNodeOf(result.definition);
    expect(verdict.config, 'the authored exclusive gateway is untouched').toBeUndefined();
    expect(result.notices.map((n) => n.conversionId)).not.toContain(ID);
    // Copy-on-write: nothing was recognized, so the same reference comes back.
    expect(result.definition).toBe(def);
  });

  it('registers the decision without `mode` — asserted AFTER the strict parse the door feeds', () => {
    const def = twoBranchDecisionDefinition('^17.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });
    expect(result.verdict).toBe('converted-forward');

    const parsed = ObjectStackDefinitionSchema.parse(result.definition);
    const registered = verdictNodeOf(parsed);
    expect(Object.keys(registered.config ?? {}), 'what registration receives').not.toContain('mode');
  });

  /**
   * [#20390] The per-entry window does not reopen it either. The entry is
   * stamped `retiredAfter: '17.4.0'`, so a ^17.4.0 floor on a runtime still
   * labelled 17.4.0 is inside ITS per-entry window — and the door's refusal
   * list is still read first, before any version is.
   */
  it('stays refused inside the per-entry window too — the refusal list is read before retiredAfter', () => {
    const def = twoBranchDecisionDefinition('^17.4.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });

    // ⭐ ANTI-VACUITY: the per-entry window really is open on this input.
    expect(result.verdict).toBe('converted-retired-after');
    expect(verdictNodeOf(result.definition).config).toBeUndefined();
    expect(result.notices.map((n) => n.conversionId)).not.toContain(ID);
  });

  it('floor ^99.0.0 — the window is shut and nothing is replayed at all', () => {
    const def = twoBranchDecisionDefinition('^99.0.0');
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });
    expect(result.verdict).toBe('authored-current');
    expect(result.notices).toEqual([]);
    expect(verdictNodeOf(result.definition).config).toBeUndefined();
  });

  /**
   * ⭐ FIRING CONTROL — the entry WOULD rewrite this exact fixture: the same
   * bytes through the primitive with the retired window open and no refusal
   * come back inclusive, with the entry's own notice. A door that had merely
   * stopped recognizing the shape, or a fixture the entry never matched, would
   * go green above and prove nothing; this leg is what makes the subject a
   * reading of the refusal.
   */
  it('FIRING CONTROL — without the refusal, the same fixture IS rewritten to `mode: inclusive`', () => {
    const notices: ConversionNotice[] = [];
    const rewritten = applyConversions(twoBranchDecisionDefinition('^17.0.0'), {
      includeRetired: true,
      onNotice: (n) => notices.push(n),
    });
    expect(verdictNodeOf(rewritten).config).toEqual({ mode: 'inclusive' });
    expect(notices.map((n) => n.conversionId)).toContain(ID);
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
