// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23027] The conversion reaches every package body of an option-B artifact.
 *
 * A multi-package artifact (ADR-0130 D4, option B) carries its collections in
 * `packages[i].manifest`, not in the definition's own collections. The strict
 * parse gates each body — `ObjectStackDefinitionSchema` and the entry gate
 * `resolveArtifactPackageOrder` applies (`ArtifactPackageSchema`) alike — so a
 * retired key inside a body refused the boot when the conversion walked only
 * the definition's top level. Measured at `os dev -a dist/objectstack.json
 * --fresh`: "`packages[1]` is not a package entry (ADR-0130 D4):
 * manifest.dashboards.0.refreshInterval: `dashboard.refreshInterval` was renamed".
 *
 * The fixture is the shape `os build` writes for a two-package project,
 * measured on `examples/app-multi-package`: the artifact's own `manifest` is
 * its LAST package's manifest, and every collection sits in a body that also
 * carries that package's manifest fields (its own `engines` included).
 *
 * The window's version boundaries are pinned in `artifact-forward-conversion.test.ts`;
 * this file pins the REACH: the same walk, the same entry list and the same
 * window over each body.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_CONVERSIONS,
  ArtifactPackageSchema,
  ObjectStackDefinitionSchema,
  applyConversions,
  type ConversionNotice,
} from '@objectstack/spec';
import { applyArtifactForwardConversions } from './artifact-forward-conversion.js';

const SUBJECT = 'dashboard-refresh-interval-to-refresh-interval-seconds';

/** The door's DEFAULT-FLIP refusals (`DEFAULT_FLIPS_NOT_REPLAYED_HERE`, module-local by design). */
const DOOR_DEFAULT_FLIPS: readonly string[] = ['app-hidden-to-unpublished', 'flow-decision-mode-inclusive-explicit'];

const versionTriple = (v: string): [number, number, number] =>
  v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10)) as [number, number, number];

function compareVersions(a: string, b: string): number {
  const x = versionTriple(a);
  const y = versionTriple(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** The first `x.y.z` past `label` and every `retiredAfter`: a floor no window opens for. */
function currentSurfaceFloor(label: string): string {
  const all = [label, ...ALL_CONVERSIONS.flatMap((c) => (c.retiredFromLoadPath === true ? [c.retiredAfter] : []))];
  const sorted = [...all].sort(compareVersions);
  const [major, minor, patch] = versionTriple(sorted[sorted.length - 1]!);
  return `${major}.${minor}.${patch + 1}`;
}

type Body = Record<string, unknown>;
interface OptionB {
  manifest: Body;
  packages: { manifest: Body }[];
  [key: string]: unknown;
}

const CORE = { id: 'com.example.ob.core', namespace: 'ob', name: 'ob_core', version: '1.0.0', type: 'app' };
const ORDERS = {
  id: 'com.example.ob.orders', namespace: 'ob', name: 'ob_orders', version: '2.0.0', type: 'module',
  dependencies: { 'com.example.ob.core': '^1.0.0' },
};
const engines = (range: string | undefined) => (range === undefined ? {} : { engines: { protocol: range } });

/**
 * An option-B artifact: `orders` first and `core` last, as the example lists
 * them, so the artifact's own manifest is `core`'s. Each body carries its
 * package's manifest fields; `bodyRange` overrides what the bodies declare.
 */
function optionB(
  range: string | undefined,
  core: Body,
  orders: Body = {},
  bodyRange: string | undefined = range,
): OptionB {
  return {
    manifest: { ...CORE, ...engines(range) },
    packages: [
      { manifest: { ...ORDERS, ...engines(bodyRange), ...orders } },
      { manifest: { ...CORE, ...engines(bodyRange), ...core } },
    ],
  };
}

/** A dashboard as an artifact built before the rename carries it. */
const legacyDashboard = (name: string, seconds: number) => ({ name, label: 'Overview', widgets: [], refreshInterval: seconds });

const issuePaths = (value: unknown): string[] => {
  const parsed = ObjectStackDefinitionSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.')).sort();
};

/** What `resolveArtifactPackageOrder`'s entry gate answers for each entry (`[]` = admitted). */
const entryGate = (definition: unknown): string[][] =>
  (definition as OptionB).packages.map((entry) => {
    const parsed = ArtifactPackageSchema.safeParse(entry);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.')).sort();
  });

describe('[#23027] the conversion reaches every package body — ADR-0130 D4 option-B artifacts', () => {
  it('premise: unconverted, the definition parse and the package-entry gate both refuse the body at the retired key', () => {
    const def = optionB('^18', { dashboards: [legacyDashboard('ob_overview', 300)] });
    expect(issuePaths(def)).toEqual(['packages.1.manifest.dashboards.0.refreshInterval']);
    expect(entryGate(def)).toEqual([[], ['manifest.dashboards.0.refreshInterval']]);
  });

  // Pin 1: the option-B dashboard boots, served as `refreshIntervalSeconds: 300`.
  // Three windows that open the subject: undeclared, the major-step half
  // (`^18` on a 17.x label), and the label half (`^18` on 18.0.1).
  const OPEN: readonly [string | undefined, string, string][] = [
    [undefined, '17.7.0', 'converted-undeclared'],
    ['^18', '17.7.0', 'converted-major-step'],
    ['^18', '18.0.1', 'converted-forward'],
  ];
  for (const [range, label, verdict] of OPEN) {
    it(`${range ?? 'no declared range'} on a runtime labelled ${label}: the body converts, the notice names the body, and both gates admit it`, () => {
      const def = optionB(range, { dashboards: [legacyDashboard('ob_overview', 300)] });
      const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: label });
      const out = result.definition as OptionB;

      expect(result.verdict).toBe(verdict);
      expect(out.packages[1]!.manifest.dashboards).toEqual([
        { name: 'ob_overview', label: 'Overview', widgets: [], refreshIntervalSeconds: 300 },
      ]);
      expect(result.notices.map((n) => [n.conversionId, n.path, n.from, n.to])).toEqual([
        [SUBJECT, 'packages[1].manifest.dashboards[0].refreshIntervalSeconds', 'refreshInterval', 'refreshIntervalSeconds'],
      ]);
      // The one place the message quotes the path names the body too.
      expect(result.notices[0]!.message).toContain(' at packages[1].manifest.dashboards[0].refreshIntervalSeconds: ');
      expect(issuePaths(out)).toEqual([]);
      expect(entryGate(out)).toEqual([[], []]);
      // Copy-on-write: the untouched body and the artifact's own manifest keep their references.
      expect(out.packages[0]).toBe(def.packages[0]);
      expect(out.manifest).toBe(def.manifest);
      expect(def.packages[1]!.manifest.dashboards).toEqual([legacyDashboard('ob_overview', 300)]);
    });
  }

  // Pin 2: a multi-package `packages[]` is converted per body.
  it('converts each body on its own, by the whole chain — each notice located under its own package', () => {
    const def = optionB(
      '^18',
      { dashboards: [legacyDashboard('ob_overview', 300)] },
      {
        dashboards: [legacyDashboard('ob_orders_overview', 120)],
        // A second step-18 retirement in the same body: the chain, not one entry.
        objects: [{
          name: 'ob_order', label: 'Order',
          fields: { number: { type: 'text', label: 'Number' } },
          indexes: [{ name: 'ob_order_number', fields: ['number'], unique: true }],
        }],
      },
    );
    def.packages.push({ manifest: { id: 'com.example.ob.clean', name: 'ob_clean', version: '1.0.0', type: 'module' } });
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.7.0' });
    const out = result.definition as OptionB;

    expect(result.verdict).toBe('converted-major-step');
    // Body by body; inside one body, in registry order.
    expect(result.notices.map((n) => `${n.conversionId} at ${n.path}`)).toEqual([
      `${SUBJECT} at packages[0].manifest.dashboards[0].refreshIntervalSeconds`,
      'declared-index-unique-scope at packages[0].manifest.objects[0].indexes[0].unique',
      `${SUBJECT} at packages[1].manifest.dashboards[0].refreshIntervalSeconds`,
    ]);
    expect((out.packages[0]!.manifest.dashboards as Body[])[0]!.refreshIntervalSeconds).toBe(120);
    expect((out.packages[1]!.manifest.dashboards as Body[])[0]!.refreshIntervalSeconds).toBe(300);
    expect(issuePaths(out)).toEqual([]);
    expect(entryGate(out)).toEqual([[], [], []]);
    // The body with nothing to convert comes back by reference.
    expect(out.packages[2]).toBe(def.packages[2]);
  });

  // Pin 3: the definition-collection control stays as it is.
  it('CONTROL — a definition without `packages[]` converts exactly as the primitive does under the same window: same notices, same paths, same messages', () => {
    const def = {
      manifest: { ...CORE },
      dashboards: [legacyDashboard('ob_overview', 300)],
    };
    const primitive: ConversionNotice[] = [];
    const expected = applyConversions(def, {
      includeRetired: true,
      excludeConversionIds: DOOR_DEFAULT_FLIPS,
      onNotice: (n) => primitive.push(n),
    });
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.7.0' });

    expect(result.verdict).toBe('converted-undeclared');
    expect(result.definition).toEqual(expected);
    expect(result.notices).toEqual(primitive);
    expect(result.notices.map((n) => n.path)).toEqual(['dashboards[0].refreshIntervalSeconds']);
  });

  it('CONTROL — an artifact carrying the same definition at its top level AND in a body converts both copies to one answer, each notice at its own site', () => {
    const def = {
      ...optionB(undefined, { dashboards: [legacyDashboard('ob_overview', 300)] }),
      dashboards: [legacyDashboard('ob_overview', 300)],
    };
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.7.0' });
    const out = result.definition as OptionB & { dashboards: Body[] };

    expect(result.notices.map((n) => n.path)).toEqual([
      'dashboards[0].refreshIntervalSeconds',
      'packages[1].manifest.dashboards[0].refreshIntervalSeconds',
    ]);
    expect(out.packages[1]!.manifest.dashboards).toEqual(out.dashboards);
    expect(issuePaths(out)).toEqual([]);
  });

  // The window-closed controls: a body answers to the same window the definition does.
  it('WINDOW SHUT — a floor past every retirement replays nothing in any body: the reference comes back and the strict parse refuses the body', () => {
    const current = currentSurfaceFloor('17.7.0');
    const def = optionB(`^${current}`, { dashboards: [legacyDashboard('ob_overview', 300)] });
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: current });

    expect(result.verdict).toBe('authored-current');
    expect(result.notices).toEqual([]);
    expect(result.definition).toBe(def);
    expect(issuePaths(result.definition)).toEqual(['packages.1.manifest.dashboards.0.refreshInterval']);
  });

  it('WINDOW PER ENTRY — inside an open per-entry window, a body replays the entries the floor predates and keeps a retirement the floor post-dates for its tombstone', () => {
    // `^17.4.0` on a runtime labelled 17.4.0: the 17.5.0 cohort (`retiredAfter`
    // 17.4.0) opens, while the rename (`retiredAfter` 17.3.0) was retired before
    // the artifact's floor and stays a refusal — exactly as at the top level.
    const core = {
      objects: [{
        name: 'ob_deal', label: 'Deal', sharingModel: 'private',
        fields: { stage: { type: 'text', label: 'Stage' }, amount: { type: 'number', label: 'Amount' } },
      }],
      datasets: [{
        name: 'ob_deal_metrics', label: 'Deal metrics', object: 'ob_deal',
        dimensions: [{ name: 'stage', field: 'stage' }],
        measures: [{ name: 'amount', aggregate: 'sum', field: 'amount' }],
      }],
      dashboards: [{
        ...legacyDashboard('ob_pipeline', 300),
        widgets: [{
          id: 'amount_by_stage', title: 'Amount by stage', type: 'bar',
          dataset: 'ob_deal_metrics', dimensions: ['stage'], values: ['amount'],
          chartConfig: { type: 'bar', xAxis: { field: 'stage' }, showLegend: true },
          layout: { x: 0, y: 0, w: 6, h: 4 },
        }],
      }],
    };
    const def = optionB('^17.4.0', core);
    const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.4.0' });

    expect(result.verdict).toBe('converted-retired-after');
    expect(result.notices.map((n) => `${n.conversionId} at ${n.path}`).sort()).toEqual([
      'dashboard-widget-chart-config-structure-removed at packages[1].manifest.dashboards[0].widgets[0].chartConfig.type',
      'dashboard-widget-chart-config-structure-removed at packages[1].manifest.dashboards[0].widgets[0].chartConfig.xAxis',
    ]);
    expect(issuePaths(result.definition)).toEqual(['packages.1.manifest.dashboards.0.refreshInterval']);
  });

  it('the ARTIFACT\'s window governs every body — a body\'s own `engines.protocol` is not read, in either direction', () => {
    const label = '17.7.0';
    const current = currentSurfaceFloor(label);

    // Artifact `^18` (window open), bodies declaring a floor no window opens for: converted.
    const opened = applyArtifactForwardConversions(
      optionB('^18', { dashboards: [legacyDashboard('ob_overview', 300)] }, {}, `^${current}`),
      { runtimeSpecVersion: label },
    );
    expect(opened.verdict).toBe('converted-major-step');
    expect(opened.notices.map((n) => n.path)).toEqual(['packages[1].manifest.dashboards[0].refreshIntervalSeconds']);

    // Artifact past every retirement (window shut), bodies declaring no range at all: unchanged.
    const shut = optionB(`^${current}`, { dashboards: [legacyDashboard('ob_overview', 300)] }, {}, undefined);
    const closed = applyArtifactForwardConversions(shut, { runtimeSpecVersion: label });
    expect(closed.verdict).toBe('authored-current');
    expect(closed.definition).toBe(shut);
  });

  it('never gates: a `packages` that is not an array, and entries or bodies that are not objects, come back exactly as given', () => {
    for (const packages of ['x', null, 3, [null, 'y', 3, { manifest: 'z' }, { manifest: [] }, {}]]) {
      const def = { manifest: { ...CORE }, packages };
      const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.7.0' });
      expect(result.definition, JSON.stringify(packages)).toBe(def);
      expect(result.notices).toEqual([]);
    }
  });

  /**
   * The whole step over a package body, both directions — every retired
   * step-18 entry's own fixture pair carried as `packages[0].manifest` of a
   * `^18` artifact on a runtime labelled 17.7.0 (the major-step half), so no
   * entry is a sample. `artifact-forward-conversion.test.ts` pins the same step
   * over the definition's own collections.
   */
  describe('the whole of step 18 over a package body — every retired entry, both directions', () => {
    const STEP_18 = ALL_CONVERSIONS.filter((c) => c.toMajor === 18 && c.retiredFromLoadPath === true);
    const inBody = (body: Body): OptionB => ({ manifest: { ...CORE, ...engines('^18') }, packages: [{ manifest: body }] });

    it('the step carries the subject', () => {
      expect(STEP_18.map((c) => c.id)).toContain(SUBJECT);
    });

    for (const entry of STEP_18) {
      const flip = DOOR_DEFAULT_FLIPS.includes(entry.id);
      it(`${entry.id}: ${flip ? 'a default flip — never replayed in a body either' : 'built before it, the body converts to its canonical fixture'}`, () => {
        const def = inBody(structuredClone(entry.fixture.before));
        const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.7.0' });
        expect(result.verdict).toBe('converted-major-step');
        if (flip) {
          expect(result.notices.map((n) => n.conversionId)).not.toContain(entry.id);
          expect(result.definition).toBe(def);
          return;
        }
        const out = result.definition as OptionB;
        expect(out.packages[0]!.manifest).toEqual(structuredClone(entry.fixture.after));
        expect(out.manifest).toBe(def.manifest);
        expect(result.notices).toHaveLength(entry.fixture.expectedNotices);
        for (const n of result.notices) {
          expect(n.conversionId).toBe(entry.id);
          expect(n.path.startsWith('packages[0].manifest.'), n.path).toBe(true);
        }
      });
    }

    for (const entry of STEP_18) {
      it(`${entry.id}: built after it, the body comes back by reference with the whole step replayed over it`, () => {
        const def = inBody(structuredClone(entry.fixture.after));
        const result = applyArtifactForwardConversions(def, { runtimeSpecVersion: '17.7.0' });
        expect(result.verdict).toBe('converted-major-step');
        expect(result.notices.map((n) => `${n.conversionId} at ${n.path}`)).toEqual([]);
        expect(result.definition).toBe(def);
      });
    }
  });
});
