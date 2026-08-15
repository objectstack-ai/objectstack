// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Translation staleness by recorded source hash (#8765, ruled Option B).
//
// The mechanism is described in `source-hash.ts`. What this file pins is the
// RULING — the three properties that decide whether the implementation ships
// correctly, plus the acceptance criterion the ruling turns on.
//
// ⚠️ Every behavioural claim below runs on a SYNTHETIC bundle, and that is a
// deliberate design constraint rather than a convenience. An assertion over the
// shipped bundles saying "nothing is stale" would go red the moment somebody
// edits a source string without re-translating three locales — which is
// precisely Option C (fail the build until every locale is re-translated), the
// option the ruling rejected for putting a four-locale translation task in
// front of every one-word source edit. Staleness is a SERVING rule here, not a
// gate. The only live-data claims made below are ones a content edit cannot
// trip: the shape of the recorded tables, and the key-set invariance that IS
// the acceptance criterion.

import { describe, it, expect } from 'vitest';
import type { TranslationData } from '@objectstack/spec/system';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import { jaJP } from './ja-JP.js';
import { esES } from './es-ES.js';
import { zhCNSourceHashes } from './zh-CN.source-hashes.js';
import { jaJPSourceHashes } from './ja-JP.source-hashes.js';
import { esESSourceHashes } from './es-ES.source-hashes.js';
import { SetupAppTranslations } from './setup.translation.js';
import {
  collectSourceHashes,
  collectSourceLeaves,
  findStaleLeaves,
  hashSource,
  withSourceFallback,
} from './source-hash.js';

// A source bundle and a translation of it, at one nav leaf per app so the
// per-locale independence claim has something to be independent about.
const source = (widgetTitle: string): TranslationData => ({
  apps: {
    demo: {
      label: 'Demo',
      navigation: { nav_one: { label: 'First' }, nav_two: { label: 'Second' } },
    },
  },
  dashboards: {
    board: { label: 'Board', widgets: { w1: { title: widgetTitle } } },
  },
});

const translated = (): TranslationData => ({
  apps: {
    demo: {
      label: '演示',
      navigation: { nav_one: { label: '第一' }, nav_two: { label: '第二' } },
    },
  },
  dashboards: {
    board: { label: '看板', widgets: { w1: { title: '最近事件' } } },
  },
});

const WIDGET = 'dashboards.board.widgets.w1.title';
const ORIGINAL = 'Recent Audit Events';
const EDITED = 'Event Volume by Action';

/** The served value at a dotted path. */
const served = (data: TranslationData, path: string): unknown =>
  path.split('.').reduce<unknown>(
    (acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined),
    data,
  );

describe('a hash mismatch marks a translation stale, and stale falls back to the source', () => {
  it('serves the translation while the source it was made from is unchanged', () => {
    const recorded = collectSourceHashes(source(ORIGINAL));
    const out = withSourceFallback(translated(), source(ORIGINAL), recorded);

    expect(served(out, WIDGET)).toBe('最近事件');
    expect(findStaleLeaves(translated(), source(ORIGINAL), recorded)).toEqual([]);
  });

  it('serves the SOURCE string once that source string is edited underneath it', () => {
    // The `widget_recent_events` shape verbatim: the widget was converted to an
    // ADR-0021 by-action breakdown, the declared title said so, and all four
    // bundles kept serving the pre-conversion copy under a green build.
    const recorded = collectSourceHashes(source(ORIGINAL));
    const out = withSourceFallback(translated(), source(EDITED), recorded);

    expect(served(out, WIDGET)).toBe(EDITED);

    const stale = findStaleLeaves(translated(), source(EDITED), recorded);
    expect(stale.map((s) => s.path)).toEqual([WIDGET]);
    expect(stale[0]?.recorded).toBe(hashSource(ORIGINAL));
    expect(stale[0]?.current).toBe(hashSource(EDITED));
  });

  it('leaves every OTHER leaf of the same bundle translated', () => {
    // The rule is per-leaf, not per-bundle: one edited source string must not
    // knock a whole locale back to English.
    const out = withSourceFallback(
      translated(),
      source(EDITED),
      collectSourceHashes(source(ORIGINAL)),
    );

    expect(served(out, 'apps.demo.navigation.nav_one.label')).toBe('第一');
    expect(served(out, 'apps.demo.navigation.nav_two.label')).toBe('第二');
    expect(served(out, 'apps.demo.label')).toBe('演示');
    expect(served(out, 'dashboards.board.label')).toBe('看板');
  });

  it('does not mutate the authored bundle it was handed', () => {
    const authored = translated();
    withSourceFallback(authored, source(EDITED), collectSourceHashes(source(ORIGINAL)));
    expect(served(authored, WIDGET)).toBe('最近事件');
  });
});

describe('a missing hash is legacy-trusted, not stale', () => {
  // The single highest-risk line in the ruling: reading "no recorded hash" as
  // "unverified ⇒ stale" would have degraded every translation that predates
  // this mechanism on the day it landed.
  it('serves a translation that has no recorded hash at all', () => {
    const out = withSourceFallback(translated(), source(EDITED), {});
    expect(served(out, WIDGET)).toBe('最近事件');
    expect(findStaleLeaves(translated(), source(EDITED), {})).toEqual([]);
  });

  it('serves the leaves a PARTIAL table omits, while still judging the ones it records', () => {
    const recorded = { [WIDGET]: hashSource(ORIGINAL) };
    const out = withSourceFallback(
      translated(),
      { ...source(EDITED), apps: { demo: { label: 'Demo EDITED', navigation: { nav_one: { label: 'First EDITED' }, nav_two: { label: 'Second' } } } } },
      recorded,
    );

    // Recorded and mismatched ⇒ falls back.
    expect(served(out, WIDGET)).toBe(EDITED);
    // Unrecorded ⇒ trusted, even though its source moved too.
    expect(served(out, 'apps.demo.navigation.nav_one.label')).toBe('第一');
  });
});

describe('updating one translation recovers that locale alone', () => {
  // The half of the ruling a naive implementation gets wrong: recovery has to
  // be expressible per locale, which is why the recorded hashes are per-locale
  // tables rather than one shared table.
  it('re-recording zh-CN leaves ja-JP falling back', () => {
    const staleTable = collectSourceHashes(source(ORIGINAL));
    const freshTable = collectSourceHashes(source(EDITED));

    const zh = withSourceFallback(
      { dashboards: { board: { widgets: { w1: { title: '按操作统计的事件量' } } } } },
      source(EDITED),
      freshTable, // re-translated: value AND hash updated together
    );
    const ja = withSourceFallback(
      { dashboards: { board: { widgets: { w1: { title: '最近の監査イベント' } } } } },
      source(EDITED),
      staleTable, // untouched since the source moved
    );

    expect(served(zh, WIDGET)).toBe('按操作统计的事件量');
    expect(served(ja, WIDGET)).toBe(EDITED);
  });

  it('a hand-refreshed hash silences the mismatch — which is why the header forbids it', () => {
    // Recording the CURRENT source hash against an OLD translation is the one
    // way to defeat this mechanism by hand. It is legal — nothing can detect
    // it, since a hash records a claim about provenance — so this pins the
    // consequence rather than preventing it: the stale text is served again.
    // The `<locale>.source-hashes.ts` header says so in as many words.
    const out = withSourceFallback(translated(), source(EDITED), collectSourceHashes(source(EDITED)));
    expect(served(out, WIDGET)).toBe('最近事件');
  });
});

describe('the shipped bundles', () => {
  const LOCALES = [
    ['zh-CN', zhCN, zhCNSourceHashes],
    ['ja-JP', jaJP, jaJPSourceHashes],
    ['es-ES', esES, esESSourceHashes],
  ] as const;

  // ⭐ The acceptance criterion, applied to the real data: B introduces NO new
  // visible state. It swaps a value for the source string — the same string the
  // locale chain already renders for an untranslated key — and touches no key
  // set. A content edit cannot trip this; only a bug in the mechanism can,
  // which is what makes it safe to assert over live data at all.
  for (const [locale, authored] of LOCALES) {
    it(`${locale} — the served bundle carries exactly the authored key set`, () => {
      const servedData = (SetupAppTranslations as Record<string, TranslationData>)[locale];
      expect([...collectSourceLeaves(servedData).keys()].sort())
        .toEqual([...collectSourceLeaves(authored).keys()].sort());
    });
  }

  for (const [locale, , recorded] of LOCALES) {
    it(`${locale} — every recorded hash is a well-formed digest`, () => {
      const malformed = Object.entries(recorded)
        .filter(([, digest]) => !/^[0-9a-f]{16}$/.test(digest))
        .map(([path]) => path);
      expect(malformed, `malformed digests in ${locale}.source-hashes.ts`).toEqual([]);
    });
  }

  it('records hashes only for paths the source actually declares', () => {
    // An entry for a path `en.ts` does not carry could never match anything and
    // would sit in the table forever reading as coverage. This judges the
    // TABLE, not the translations, so re-translation never trips it.
    const sourcePaths = new Set(collectSourceLeaves(en).keys());
    for (const [locale, , recorded] of LOCALES) {
      const orphans = Object.keys(recorded).filter((path) => !sourcePaths.has(path));
      expect(orphans, `${locale}.source-hashes.ts records paths absent from en.ts`).toEqual([]);
    }
  });

  // ⛔ Deliberately NOT asserted here: that the three tables agree with each
  // other, and that no shipped leaf is currently stale. Both read as tempting
  // consistency checks and both are Option C wearing a different hat — the
  // first goes red on exactly the per-locale recovery the ruling requires
  // (zh-CN re-translated, ja-JP not yet, so their recorded digests differ ON
  // PURPOSE), and the second goes red on any un-re-translated source edit.
  // Staleness degrades what is served; it does not stop a build.
});
