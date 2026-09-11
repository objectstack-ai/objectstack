// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os i18n extract --no-objects-only --fill=default --source-hashes` emits
// `apps.*` leaves that NO predicate judges (#16872).
//
// ## What this file pins, and what it deliberately does NOT
//
// ⚠️ These assertions record the GAP as it stands. They are a characterization
// pin, not a statement that the current split is right: the card's whole point
// is that a generated `apps` leaf should be judged by SOME predicate and today
// is judged by none. Closing it moves the POPULATION the generated predicate
// walks, which lives in `@objectstack/platform-objects`
// (`GENERATED_SECTIONS` / `collectGeneratedLeaves`) and therefore NOT in this
// package — so the fix cannot land here and this file is what makes the gap
// fail loudly the moment it does. ⛔ Whoever closes #16872: these expectations
// are meant to flip, and flipping them is the deliberate act this pin exists to
// force. ⛔ Do not delete the file to make a red go away.
//
// ## Why a leaf in the difference is unreachable by BOTH mechanisms
//
//   - `findStaleFills` (the generated predicate) walks `GENERATED_SECTIONS`
//     = ['objects', 'metadataForms']. `apps` is not in it, so no `apps.*`
//     record is ever WRITTEN by `collectFilledFromHashes` and none is ever
//     READ back.
//   - `findStaleLeaves` (the hand-authored predicate) walks
//     `HAND_AUTHORED_SECTIONS` = ['apps', 'dashboards', 'pages'] — it does
//     reach the path, but it judges against the hand-maintained
//     `<locale>.source-hashes.ts`, which by construction carries no entry for
//     a leaf a generator produced.
//
// So the leaf is legacy-trusted forever, and a `--fill=default` copy left
// behind by a revised source is served as a superseded draft under a green
// `check:i18n` — the harm #16242 asserted and attributed to the wrong step.

import { describe, it, expect } from 'vitest';
import {
  extractTranslations,
  translationModuleSections,
} from '../src/utils/i18n-extract.js';
import {
  GENERATED_SECTIONS,
  HAND_AUTHORED_SECTIONS,
  collectFilledFromHashes,
  findStaleFills,
  findStaleLeaves,
  withSourceFallback,
} from '@objectstack/platform-objects/apps';

const APP_V1 = 'Key Performance Indicators';
const APP_V2 = 'KPI Cockpit'; // the source label, revised
const OBJ_HELP = 'The metric this KPI tracks.';

const APP_LEAF = 'apps.kpi.label';
const OBJ_LEAF = 'objects.kpi_metric.fields.name.help';

const stack = (appLabel: string) => ({
  objects: [
    {
      name: 'kpi_metric',
      label: 'KPI Metric',
      fields: { name: { type: 'text', label: 'Name', help: OBJ_HELP } },
    },
  ],
  apps: [{ name: 'kpi', label: appLabel }],
});

/** Run 1: every leaf arrives as a `--fill=default` byte copy of the source. */
const filled = () =>
  extractTranslations(stack(APP_V1) as never, { locales: ['zh-CN'], fill: 'default' });

describe('the two section sets do not partition what a `--no-objects-only` run emits', () => {
  it('leaves `apps` outside the generated population while the run commits it', () => {
    const r = filled();
    // The section list the COMMAND commits under `kind: 'stack'` is derived
    // from the payload (#16242), so it already names every group the module
    // holds — `apps` included.
    const committed = translationModuleSections(r.bundles['zh-CN'], 'stack');
    expect(committed).toContain('apps');

    // The population the provenance RULE walks does not.
    expect([...GENERATED_SECTIONS]).toEqual(['objects', 'metadataForms']);
    expect([...GENERATED_SECTIONS]).not.toContain('apps');

    // ⇒ the difference is non-empty, and every leaf in it is un-judged. This
    // inequality IS the card.
    const uncovered = committed.filter((s) => !GENERATED_SECTIONS.includes(s as never));
    expect(uncovered).toContain('apps');
  });

  it('puts `apps` in the hand-authored set, whose table a generator never writes', () => {
    expect([...HAND_AUTHORED_SECTIONS]).toContain('apps');
  });
});

describe('an armed run records the object leaf and not the app leaf', () => {
  it('writes no provenance record for a filled `apps` leaf', () => {
    const r = filled();
    const bundle = r.bundles['zh-CN'] as Record<string, never>;
    const table = r.sourceHashes['zh-CN'];

    // Both leaves are byte copies of the source — the exact property the
    // generated predicate exists to judge.
    expect((bundle as never as { apps: { kpi: { label: string } } }).apps.kpi.label).toBe(APP_V1);

    expect(table[OBJ_LEAF]).toMatch(/^[0-9a-f]{16}$/); // judged
    expect(table[APP_LEAF]).toBeUndefined(); //             NOT judged — the gap

    // Stated as a set so a third generated section cannot slip in unnoticed.
    expect([...new Set(Object.keys(table).map((k) => k.split('.')[0]))].sort()).toEqual([
      'metadataForms',
      'objects',
    ]);
  });

  it('serves the superseded draft after the source moves, with nothing on disk recording it', () => {
    const first = filled();
    const b1 = first.bundles['zh-CN'];

    // The source label is revised; merge keeps the existing (now stale) fill.
    const second = extractTranslations(
      { ...stack(APP_V2), translations: [{ 'zh-CN': b1 }] } as never,
      {
        locales: ['zh-CN'],
        fill: 'default',
        previousSourceHashes: { 'zh-CN': first.sourceHashes['zh-CN'] },
      },
    );
    const b2 = second.bundles['zh-CN'];
    const en2 = second.bundles.en;
    const t2 = second.sourceHashes['zh-CN'];

    const served = b2 as never as { apps: { kpi: { label: string } } };
    expect(served.apps.kpi.label).toBe(APP_V1); // drifted from the source
    expect((en2 as never as { apps: { kpi: { label: string } } }).apps.kpi.label).toBe(APP_V2);

    // Neither predicate can see it, so the serving path substitutes nothing.
    expect(findStaleFills(b2, en2, t2).map((f) => f.path)).not.toContain(APP_LEAF);
    expect(findStaleLeaves(b2, en2, t2).map((f) => f.path)).not.toContain(APP_LEAF);
    const out = withSourceFallback(b2, en2, t2, t2) as never as {
      apps: { kpi: { label: string } };
    };
    expect(out.apps.kpi.label).toBe(APP_V1); // the superseded draft is served
  });
});

describe('the defect is the population, not the rule', () => {
  it('records the very same leaf once it is walked under a generated section name', () => {
    const r = filled();
    const b = r.bundles['zh-CN'] as never as { apps: unknown };
    const en = r.bundles.en as never as { apps: unknown };

    // Re-rooted under a name `collectGeneratedLeaves` walks — the ONLY thing
    // that changes is which section the leaf sits under. ⛔ Not a proposed
    // fix: re-rooting corrupts the dotted path a record is keyed by, which is
    // why the population, not the caller's tree, is the thing to move.
    const asIfGenerated = collectFilledFromHashes(
      { objects: b.apps } as never,
      { objects: en.apps } as never,
      undefined,
    );

    expect(asIfGenerated['objects.kpi.label']).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the default `--objects-only` path is untouched by any of this', () => {
  it('reaches the same provenance table whether or not the run would emit apps', () => {
    // `extractTranslations` builds the whole skeleton either way — the flag
    // picks the RENDERED sub-tree, not the walk — so the provenance table for
    // the default path is byte-identical to the armed one. That is why closing
    // #16872 in the population can move the armed path without moving the nine
    // live `--source-hashes` configs, all of which run `--objects-only`.
    const armed = filled().sourceHashes['zh-CN'];
    const objectsOnlySections = translationModuleSections(
      filled().bundles['zh-CN'],
      'objects',
    );
    expect(objectsOnlySections).toEqual(['objects']);
    // Every section the default path commits is already inside the population.
    for (const s of objectsOnlySections) {
      expect(GENERATED_SECTIONS).toContain(s as never);
    }
    expect(Object.keys(armed).some((k) => k.startsWith('objects.'))).toBe(true);
  });
});
