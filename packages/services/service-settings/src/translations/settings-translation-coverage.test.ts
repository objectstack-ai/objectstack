// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings-translation coverage guard (every shipped non-English locale).
 *
 * Every built-in settings manifest ships English labels inline; the console
 * localizes them by resolving `settings.<namespace>.…` against the shipped
 * translation bundles (see `useSettingsLabel`). When a manifest gains a new
 * group or field but a locale bundle isn't updated, the setting silently
 * renders English under a translated UI (objectui#2851).
 *
 * This test pins each shipped non-English locale to full coverage of every
 * manifest's structural strings — namespace title/description, each group
 * title, each field label, each `info_banner`'s title and text (keyed by
 * the banner's `id` under `settings.<namespace>.banners`), each
 * `action_button`'s label (keyed by the button's `id` under
 * `settings.<namespace>.actions`), and each `map` setting's table headers
 * (`keys.<key>.keyColumn.label`, `keys.<key>.columns.<name>.label`).
 * Dropdown *option* labels are intentionally excluded: several must not be "translated" (the `timezone` option "UTC" is a
 * code; each `locale` option names its language in that language), and
 * option-level parity is filled per-locale on a best-effort basis.
 */

import { describe, it, expect } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { lifecycleSettingsManifest } from '@objectstack/objectql';
import * as manifestsModule from '../manifests/index.js';
import { en, zhCN, jaJP, esES, zhHant, ar, fr, ptBR, ru, de, ko } from './index.js';

// The manifests barrel also exports action handlers and the aggregate array;
// keep only the manifest objects.
const bundledManifests = Object.values(manifestsModule).filter(
  (v): v is SettingsManifest =>
    !!v &&
    typeof v === 'object' &&
    'namespace' in v &&
    Array.isArray((v as SettingsManifest).specifiers),
);

/**
 * Platform manifests another package registers into the same settings hub,
 * whose copy this bundle carries because that package ships no translation
 * bundle of its own. `@objectstack/objectql` registers `lifecycle` (Data
 * Lifecycle) at `kernel:ready`. Each one listed here is held to the same full
 * coverage as a bundled manifest, and its namespace is a declared one for the
 * no-undeclared-copy check below.
 */
const hostedManifests: SettingsManifest[] = [lifecycleSettingsManifest];

/** Every manifest whose `settings.<namespace>.…` copy lives in this bundle. */
const manifests = [...bundledManifests, ...hostedManifests];

const LOCALES: Array<[string, { settings?: Record<string, any> }]> = [
  ['zh-CN', zhCN],
  ['ja-JP', jaJP],
  ['es-ES', esES],
  ['zh-Hant', zhHant],
  ['ar', ar],
  ['fr', fr],
  ['pt-BR', ptBR],
  ['ru', ru],
  ['de', de],
  ['ko', ko],
];

function missingFor(data: { settings?: Record<string, any> }, m: SettingsManifest): string[] {
  const tr = (data.settings ?? {})[m.namespace];
  const missing: string[] = [];
  if (tr?.title == null) missing.push('title');
  if (m.description && tr?.description == null) missing.push('description');
  for (const s of m.specifiers) {
    if (s.type === 'group') {
      if (s.id && tr?.groups?.[s.id]?.title == null) missing.push(`group:${s.id}`);
    } else if (s.type === 'info_banner') {
      // A banner without an `id` has no address in the bundle, so no locale
      // can ever translate it: that is a gap in the manifest, reported here.
      if (!s.id) {
        missing.push('banner without an id');
        continue;
      }
      if (tr?.banners?.[s.id]?.title == null) missing.push(`banner:${s.id}.title`);
      if (tr?.banners?.[s.id]?.text == null) missing.push(`banner:${s.id}.text`);
    } else if (s.type === 'action_button') {
      // Same as a banner: an action button is addressed by its `id`, and one
      // without an id has no place in the bundle for its label.
      if (!s.id) {
        missing.push('action without an id');
        continue;
      }
      if (tr?.actions?.[s.id]?.label == null) missing.push(`action:${s.id}`);
    } else if (s.key) {
      if (tr?.keys?.[s.key]?.label == null) missing.push(`key:${s.key}`);
      // A toggle's turn-off question is the toggle's own copy, so it is held to
      // the label's coverage: an untranslated one asks in English (#30418).
      if (s.confirmOffText !== undefined && tr?.keys?.[s.key]?.confirmOffText == null) {
        missing.push(`key:${s.key}.confirmOffText`);
      }
      // A map's table headers are the map's own copy, held to the label's
      // coverage: an untranslated one heads the table in English (#31453).
      if (s.type === 'map') {
        if (s.keyColumn && tr?.keys?.[s.key]?.keyColumn?.label == null) missing.push(`key:${s.key}.keyColumn`);
        for (const c of s.columns ?? []) {
          if (tr?.keys?.[s.key]?.columns?.[c.name]?.label == null) missing.push(`key:${s.key}.columns.${c.name}`);
        }
      }
    }
  }
  return missing;
}

/**
 * The other direction: copy for a group, key, banner or action no manifest declares.
 * Such an entry renders nowhere, so it survives every review as dead text. The four
 * Localization format keys retired by #21958 are the case that named it.
 */
function undeclaredIn(data: { settings?: Record<string, any> }): string[] {
  const byNamespace = new Map(manifests.map((m) => [m.namespace, m]));
  const extra: string[] = [];
  for (const [ns, tr] of Object.entries(data.settings ?? {})) {
    const m = byNamespace.get(ns);
    if (!m) {
      extra.push(`namespace:${ns}`);
      continue;
    }
    const groups = new Set<string>();
    const keys = new Set<string>();
    const confirmsOff = new Set<string>();
    const mapColumns = new Map<string, Set<string>>();
    const banners = new Set<string>();
    const actions = new Set<string>();
    for (const s of m.specifiers) {
      if (s.type === 'group') {
        if (s.id) groups.add(s.id);
      } else if (s.type === 'info_banner') {
        if (s.id) banners.add(s.id);
      } else if (s.type === 'action_button') {
        if (s.id) actions.add(s.id);
      } else if (s.key) {
        keys.add(s.key);
        if (s.confirmOffText !== undefined) confirmsOff.add(s.key);
        if (s.type === 'map') mapColumns.set(s.key, new Set((s.columns ?? []).map((c) => c.name)));
      }
    }
    for (const g of Object.keys(tr?.groups ?? {})) if (!groups.has(g)) extra.push(`${ns}.group:${g}`);
    for (const k of Object.keys(tr?.keys ?? {})) if (!keys.has(k)) extra.push(`${ns}.key:${k}`);
    for (const [k, v] of Object.entries(tr?.keys ?? {})) {
      if (keys.has(k) && (v as { confirmOffText?: unknown })?.confirmOffText != null && !confirmsOff.has(k)) {
        extra.push(`${ns}.key:${k}.confirmOffText`);
      }
      // Headers for a setting that is not a map, or for a column the map does
      // not declare, head no table.
      const entry = v as { keyColumn?: unknown; columns?: Record<string, unknown> };
      if (!keys.has(k)) continue;
      const declared = mapColumns.get(k);
      if (entry?.keyColumn != null && !declared) extra.push(`${ns}.key:${k}.keyColumn`);
      for (const c of Object.keys(entry?.columns ?? {})) {
        if (!declared?.has(c)) extra.push(`${ns}.key:${k}.columns.${c}`);
      }
    }
    for (const b of Object.keys(tr?.banners ?? {})) if (!banners.has(b)) extra.push(`${ns}.banner:${b}`);
    for (const a of Object.keys(tr?.actions ?? {})) if (!actions.has(a)) extra.push(`${ns}.action:${a}`);
  }
  return extra;
}

describe('settings translation coverage', () => {
  it('covers every built-in settings manifest', () => {
    expect(bundledManifests.length).toBeGreaterThanOrEqual(9);
  });

  it('covers the hosted platform manifests by namespace', () => {
    expect(manifests.map((m) => m.namespace)).toContain('lifecycle');
    const namespaces = manifests.map((m) => m.namespace);
    expect(new Set(namespaces).size, 'a namespace is declared twice').toBe(namespaces.length);
  });

  for (const [locale, data] of LOCALES) {
    for (const m of manifests) {
      it(`${locale} covers settings.${m.namespace} (title / groups / keys / banners / actions)`, () => {
        const missing = missingFor(data, m);
        expect(missing, `${locale} missing for ${m.namespace}: ${missing.join(', ')}`).toEqual([]);
      });
    }
  }

  for (const [locale, data] of [['en', en], ...LOCALES] as typeof LOCALES) {
    it(`${locale} carries no copy for a group, key, banner or action no manifest declares`, () => {
      const extra = undeclaredIn(data);
      expect(extra, `${locale} has undeclared settings copy: ${extra.join(', ')}`).toEqual([]);
    });
  }
});

/**
 * A warning reaches the admin as an `info_banner` row with
 * `bannerSeverity: 'warning'` — never as a hand-spelled warning glyph inside a
 * description or help string, where it reads as one more sentence of the
 * subtitle or the field's help. This sweeps every manifest's description, its
 * `helpText` and each specifier's help (`description`), and every locale's
 * copy of them (`description`, group `description`, key `help`).
 */
const WARNING_GLYPH = '⚠';

function manifestHelpStrings(m: SettingsManifest): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (m.description) out.push([`${m.namespace}.description`, m.description]);
  if (m.helpText) out.push([`${m.namespace}.helpText`, m.helpText]);
  for (const s of m.specifiers) {
    if (s.description) out.push([`${m.namespace}.${s.key ?? s.id ?? s.type}.description`, s.description]);
  }
  return out;
}

function bundleHelpStrings(data: { settings?: Record<string, any> }): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [ns, tr] of Object.entries(data.settings ?? {})) {
    if (typeof tr?.description === 'string') out.push([`${ns}.description`, tr.description]);
    for (const [g, gt] of Object.entries<any>(tr?.groups ?? {})) {
      if (typeof gt?.description === 'string') out.push([`${ns}.groups.${g}.description`, gt.description]);
    }
    for (const [k, kt] of Object.entries<any>(tr?.keys ?? {})) {
      if (typeof kt?.help === 'string') out.push([`${ns}.keys.${k}.help`, kt.help]);
    }
  }
  return out;
}

describe('warnings live in info_banner rows, not in description or help strings', () => {
  it('no manifest description, helpText or specifier help carries the warning glyph', () => {
    const strings = manifests.flatMap(manifestHelpStrings);
    // Non-vacuity: the sweep reads real strings, not an empty set.
    expect(strings.length).toBeGreaterThan(50);
    const hits = strings.filter(([, v]) => v.includes(WARNING_GLYPH)).map(([path]) => path);
    expect(hits, `warning glyph in manifest help strings: ${hits.join(', ')}`).toEqual([]);
  });

  for (const [locale, data] of [['en', en], ...LOCALES] as typeof LOCALES) {
    it(`${locale} carries the warning glyph in no description or help copy`, () => {
      const strings = bundleHelpStrings(data);
      expect(strings.length).toBeGreaterThan(50);
      const hits = strings.filter(([, v]) => v.includes(WARNING_GLYPH)).map(([path]) => path);
      expect(hits, `${locale} has the warning glyph in: ${hits.join(', ')}`).toEqual([]);
    });
  }
});

/**
 * Inside a Chinese sentence the punctuation is full-width: `，；：（）`, not the
 * ASCII `, ; : ( )`. The zh-CN `settings.auth` copy mixed the two, so an admin
 * read 「认证限流:最大请求数」 beside 「新用户的成员归属」 on one page.
 *
 * The rule is read off the characters around each mark, so ASCII stays where
 * it belongs: a mark whose nearest non-space neighbours are both non-CJK (the
 * `.` and `/` of `203.0.113.0/24`, a comma inside an English product name) is
 * left alone, and code spans and `{{placeholders}}` are not read at all. A
 * paren pair is Chinese when either side of it touches CJK or it encloses CJK.
 */
const CJK = /[　-〿㐀-鿿＀-￯—]/;
const HALF_WIDTH_MARKS = new Set([',', ';', ':', '(', ')']);

function nearestNonSpace(s: string, from: number, step: 1 | -1): string {
  for (let i = from + step; i >= 0 && i < s.length; i += step) if (s[i] !== ' ') return s[i];
  return '';
}

/** Each half-width mark inside Chinese prose in `text`, as `index:mark`. */
function halfWidthMarksInChinese(text: string): string[] {
  // Blank code spans and placeholders to spaces, keeping every other index.
  const s = text.replace(/`[^`]*`|\{\{[^}]*\}\}|\{[^}]*\}/g, (m) => ' '.repeat(m.length));
  const hits = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!HALF_WIDTH_MARKS.has(c)) continue;
    if (CJK.test(nearestNonSpace(s, i, -1)) || CJK.test(nearestNonSpace(s, i, 1))) hits.add(i);
    if (c === '(') open.push(i);
    if (c === ')' && open.length > 0) {
      const o = open.pop()!;
      if (CJK.test(s.slice(o + 1, i))) hits.add(o).add(i);
    }
  }
  return [...hits].sort((a, b) => a - b).map((i) => `${i}:${s[i]}`);
}

function stringsUnder(node: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) stringsUnder(v, `${path}.${k}`, out);
  }
  return out;
}

describe('zh-CN settings.auth uses full-width punctuation inside Chinese sentences', () => {
  it('the rule flags a half-width mark in Chinese prose and leaves codes, paths and placeholders', () => {
    expect(halfWidthMarksInChinese('认证限流:最大请求数')).toEqual(['4::']);
    expect(halfWidthMarksInChinese('要求成员使用身份验证器应用(TOTP)保护账户。')).toEqual(['12:(', '17:)']);
    expect(halfWidthMarksInChinese('裸域名,每行一个')).toEqual(['3:,']);
    expect(halfWidthMarksInChinese('例如 203.0.113.0/24。Auth Token')).toEqual([]);
    expect(halfWidthMarksInChinese('设置 `auth:mfa` 与 {{count}}, 共计')).toEqual([]);
  });

  it('no zh-CN settings.auth string carries a half-width , ; : ( ) inside Chinese prose', () => {
    const strings = stringsUnder(zhCN.settings?.auth, 'settings.auth', []);
    // Non-vacuity: the sweep reads the namespace, not an empty set.
    expect(strings.length).toBeGreaterThan(60);
    const hits = strings
      .map(([path, v]) => [path, halfWidthMarksInChinese(v)] as const)
      .filter(([, marks]) => marks.length > 0)
      .map(([path, marks]) => `${path} @ ${marks.join(' ')}`);
    expect(hits, `half-width punctuation in zh-CN Chinese copy:\n${hits.join('\n')}`).toEqual([]);
  });
});
