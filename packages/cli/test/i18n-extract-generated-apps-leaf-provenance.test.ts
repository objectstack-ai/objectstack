// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os i18n extract --no-objects-only --fill=default --source-hashes` emits
// `apps.*` leaves, and since #16872 a predicate judges them (#16872).
//
// ## What this file pins
//
// It began life as a characterization pin recording the GAP (PR #17726): a
// generated `apps` leaf was judged by NO predicate, so a `--fill=default` copy
// left behind by a revised source was served as a superseded draft under a
// green `check:i18n`. Those expectations were written to be flipped, and this
// is the commit that flips them. The run below is still ARMED — same flags,
// same fixture — and every assertion now describes the fixed system.
//
// ## The shape that closed it, and the one that did NOT
//
// ⛔ NOT `GENERATED_SECTIONS + 'apps'`. That would make `collectSourceLeaves`
// and `collectGeneratedLeaves` walk one section — two predicates permanently on
// one path — and would assert `apps` is ALWAYS generated, false for every
// bundle set that ships today. Both constants are asserted UNMOVED below, so
// that shape cannot be reintroduced silently.
//
// ✅ The population follows the RUN, at both ends:
//   - write — `collectFilledFromHashes` takes the sections the run generated;
//     `extractTranslations` passes the sections it actually built.
//   - read  — `findStaleFills` walks the sections the recorded table names,
//     because one run wrote that table and it is the record of what that run
//     emitted.
//
// The widening is safe because the rule is self-discriminating per leaf: a leaf
// someone TRANSLATED matches neither `value === currentSource` nor
// `previous[path] === hash(value)`, so it gets no record however wide the walk
// (pinned below). The section list was the only part that could not tell a fill
// from a translation.

import { describe, it, expect } from 'vitest';
import {
  extractTranslations,
  narrowToCommittedSections,
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

/** Run 2: the source label is revised; merge keeps the existing (stale) fill. */
const revised = () => {
  const first = filled();
  const second = extractTranslations(
    { ...stack(APP_V2), translations: [{ 'zh-CN': first.bundles['zh-CN'] }] } as never,
    {
      locales: ['zh-CN'],
      fill: 'default',
      previousSourceHashes: { 'zh-CN': first.sourceHashes['zh-CN'] },
    },
  );
  return { first, second };
};

describe('the population the rule walks is the one the run emitted', () => {
  it('records a filled `apps` leaf, because the run committed that section', () => {
    const r = filled();
    const bundle = r.bundles['zh-CN'] as Record<string, never>;
    const table = r.sourceHashes['zh-CN'];

    // The section list the COMMAND commits under `kind: 'stack'` is derived
    // from the payload (#16242), and the provenance population now follows it.
    expect(translationModuleSections(r.bundles['zh-CN'], 'stack')).toContain('apps');

    // Both leaves are byte copies of the source — the exact property the
    // generated predicate exists to judge.
    expect((bundle as never as { apps: { kpi: { label: string } } }).apps.kpi.label).toBe(APP_V1);

    expect(table[OBJ_LEAF]).toMatch(/^[0-9a-f]{16}$/); // judged, as before
    expect(table[APP_LEAF]).toMatch(/^[0-9a-f]{16}$/); // judged — this IS #16872
  });

  it('⛔ closes it WITHOUT moving either section constant', () => {
    // The refuted option A would have put 'apps' in both lists at once.
    expect([...GENERATED_SECTIONS]).toEqual(['objects', 'metadataForms']);
    expect([...GENERATED_SECTIONS]).not.toContain('apps');
    expect([...HAND_AUTHORED_SECTIONS]).toEqual(['apps', 'dashboards', 'pages']);
  });

  it('substitutes the current source once the leaf drifts, instead of serving the draft', () => {
    const { second } = revised();
    const b2 = second.bundles['zh-CN'];
    const en2 = second.bundles.en;
    const t2 = second.sourceHashes['zh-CN'];

    const served = b2 as never as { apps: { kpi: { label: string } } };
    expect(served.apps.kpi.label).toBe(APP_V1); // the committed bytes still drift
    expect((en2 as never as { apps: { kpi: { label: string } } }).apps.kpi.label).toBe(APP_V2);

    // The generated predicate now reaches it. `recorded` is passed as undefined
    // so this isolates the GENERATED half: the hand table is not what fixed it.
    expect(findStaleFills(b2, en2, t2).map((f) => f.path)).toContain(APP_LEAF);
    const out = withSourceFallback(b2, en2, undefined, t2) as never as {
      apps: { kpi: { label: string } };
    };
    expect(out.apps.kpi.label).toBe(APP_V2); // the current source is served
  });
});

describe('the widening cannot capture a leaf a human translated', () => {
  it('gives a real translation no record, however wide the population', () => {
    const first = filled();
    const translatedBundle = {
      ...(first.bundles['zh-CN'] as Record<string, unknown>),
      apps: { kpi: { label: '关键绩效指标' } },
    };
    const second = extractTranslations(
      { ...stack(APP_V2), translations: [{ 'zh-CN': translatedBundle }] } as never,
      {
        locales: ['zh-CN'],
        fill: 'default',
        previousSourceHashes: { 'zh-CN': first.sourceHashes['zh-CN'] },
      },
    );
    const t = second.sourceHashes['zh-CN'];

    // Neither `value === currentSource` nor `previous[path] === hash(value)`.
    expect(t[APP_LEAF]).toBeUndefined(); // legacy-trusted, not stale
    expect(
      findStaleFills(second.bundles['zh-CN'], second.bundles.en, t).map((f) => f.path),
    ).not.toContain(APP_LEAF);
    // Positive control drawn from the same table: the object leaf IS recorded,
    // so the absence above is a reading and not a silent empty.
    expect(t[OBJ_LEAF]).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the hand-maintained table keeps its own half', () => {
  it('still owns `apps` through `findStaleLeaves`, judged against ITS digests', () => {
    const { second } = revised();
    const b2 = second.bundles['zh-CN'];
    const en2 = second.bundles.en;
    // A digest a human recorded for the previous source revision.
    const handTable = { [APP_LEAF]: second.sourceHashes['zh-CN'][APP_LEAF] as string };
    expect(findStaleLeaves(b2, en2, handTable).map((f) => f.path)).toContain(APP_LEAF);
  });
});

describe('the nine live `--objects-only` configs do not move', () => {
  it('narrows the run table back to exactly the sections a default run commits', () => {
    const r = filled();
    const table = r.sourceHashes['zh-CN'];
    // The armed run now carries an `apps` record...
    expect(Object.keys(table).some((k) => k.startsWith('apps.'))).toBe(true);

    // ...and the commit layer drops it, because `--objects-only` commits no
    // `apps` bundle for a record to be ABOUT (#12559). This is why closing
    // #16872 moves no committed companion byte in this repository.
    const committed = translationModuleSections(r.bundles['zh-CN'], 'objects');
    expect(committed).toEqual(['objects']);
    const narrowed = narrowToCommittedSections(table, new Set(committed));
    expect(Object.keys(narrowed).some((k) => k.startsWith('apps.'))).toBe(false);
    expect(narrowed[OBJ_LEAF]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('leaves the new population parameter OPTIONAL, so every existing caller is unmoved', () => {
    const r = filled();
    const b = r.bundles['zh-CN'];
    const en = r.bundles.en;
    // Three arguments — the pre-#16872 call shape, still compiling and still
    // defaulting to GENERATED_SECTIONS.
    const legacy = collectFilledFromHashes(b, en, undefined);
    expect(legacy[OBJ_LEAF]).toMatch(/^[0-9a-f]{16}$/);
    expect(legacy[APP_LEAF]).toBeUndefined();
    // Four arguments — the caller that knows what the run built.
    const widened = collectFilledFromHashes(b, en, undefined, Object.keys(b as object));
    expect(widened[APP_LEAF]).toMatch(/^[0-9a-f]{16}$/);
  });
});
