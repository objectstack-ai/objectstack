// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 「工作区」 is retired from what a reader sees on the Setup settings pages.
 *
 * The maintainer's ruling (cloud ruling record 6229029648): one noun, 「组织」,
 * for the thing members and billing belong to, and 「环境」 for the running
 * instance. "Workspace" named both, so it names neither.
 *
 * ## Which noun a string takes — the manifest's own `scope` decides
 *
 * The same manifests are read on the control plane and in a tenant
 * environment, and nothing in a manifest tells the two planes apart. Nothing
 * has to: the noun follows the storage `scope` the manifest already declares,
 * and that scope means the same thing on both planes, because one
 * `SettingsService` stores both.
 *
 *  - `tenant` — one row per ORGANIZATION (`sys_setting`'s identity is
 *    `(organization_id, namespace, key, scope, user_id)`;
 *    `settings-organization-isolation.pin.test.ts`). Branding, company and
 *    feature flags say "organization".
 *  - `global` — one row for the running instance. Mail and SMS say
 *    "environment", the noun the auth page's audience copy already uses.
 *
 * ## What is pinned
 *
 * Every user-facing STRING of every built-in manifest, and every VALUE of
 * every shipped locale bundle, is free of the retired noun in all four
 * locales' spellings. Keys are not copy and keep their spelling: the storage
 * key `workspace_name`, the `OS_BRANDING_WORKSPACE_NAME` override derived from
 * it, and the hub `category` value (see {@link NOT_COPY}).
 */

import { describe, it, expect } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import * as manifestsModule from './manifests/index.js';
import { builtinSettingsManifests } from './manifests/index.js';
import { en, zhCN, jaJP, esES } from './translations/index.js';

const manifests = Object.values(manifestsModule).filter(
  (v): v is SettingsManifest =>
    !!v &&
    typeof v === 'object' &&
    'namespace' in v &&
    Array.isArray((v as SettingsManifest).specifiers),
);

const BUNDLES: Array<[string, object]> = [
  ['en', en],
  ['zh-CN', zhCN],
  ['ja-JP', jaJP],
  ['es-ES', esES],
];

/**
 * The retired noun, one spelling per locale. The English one matches the WORD
 * only: a neighbouring letter, digit or underscore makes it part of an
 * identifier, so `workspace_name` and `OS_BRANDING_WORKSPACE_NAME` named in
 * prose are keys, not the noun.
 */
const RETIRED: ReadonlyArray<readonly [string, RegExp]> = [
  ['workspace', /(?<![A-Za-z0-9_])workspaces?(?![A-Za-z0-9_])/i],
  ['工作区', /工作区/],
  ['ワークスペース', /ワークスペース/],
  ['espacio de trabajo', /espacios? de trabajo/i],
];

function retiredIn(text: string): string[] {
  return RETIRED.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/**
 * Manifest properties a machine reads, never a person: identifiers, storage
 * keys, stored values, permissions, expressions and handler wiring. Every
 * OTHER string in a manifest is walked, so a copy field added later is covered
 * without editing this list.
 *
 * `category` is here because it is a lookup KEY, not copy: the console reads
 * `console.settingsHub.categories.<category>` and translates the section
 * header itself, in its own bundles. Renaming the value would move the
 * console's key, not this package's copy.
 */
const NOT_COPY: ReadonlySet<string> = new Set([
  'namespace', 'key', 'id', 'childNamespace', 'replacedBy', 'category',
  'value', 'default', 'icon', 'type', 'scope', 'availableScopes',
  'readPermission', 'writePermission', 'featureFlag', 'visible', 'pattern',
  'valueDomain', 'bannerSeverity',
  // handler wiring (`action_button`); its `confirmText` stays copy.
  'kind', 'method', 'url', 'body', 'name', 'params', 'target',
]);

/** Every string under `node`, with its path; `skip` names properties not descended. */
function stringsUnder(node: unknown, path: string, skip: ReadonlySet<string>): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => stringsUnder(v, `${path}.${i}`, skip));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => (skip.has(k) ? [] : stringsUnder(v, `${path}.${k}`, skip)));
  }
  return [];
}

const NOTHING: ReadonlySet<string> = new Set();

describe('the retired noun: no settings manifest or bundle says workspace / 工作区', () => {
  it('the detector flags the noun in each locale and passes identifiers', () => {
    for (const noun of ['Workspace name', 'for this workspace.', 'Workspaces', '此工作区', 'このワークスペース', 'este espacio de trabajo']) {
      expect(retiredIn(noun), noun).not.toEqual([]);
    }
    for (const key of ['workspace_name', '`workspace_name`', 'OS_BRANDING_WORKSPACE_NAME', 'Organization name', '组织名称', '環境']) {
      expect(retiredIn(key), key).toEqual([]);
    }
  });

  it('walks every built-in manifest', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(10);
    for (const m of builtinSettingsManifests) expect(manifests).toContain(m);
  });

  for (const m of manifests) {
    it(`settings.${m.namespace}: no user-facing manifest string carries it`, () => {
      const strings = stringsUnder(m, m.namespace, NOT_COPY);
      const seen = new Set(strings.map(([p]) => p));
      // Non-vacuity: the walk reaches the manifest's label and every
      // specifier's label and option labels, so NOT_COPY swallowed no copy.
      expect(seen.has(`${m.namespace}.label`)).toBe(true);
      m.specifiers.forEach((s, i) => {
        if (typeof s.label === 'string') expect(seen.has(`${m.namespace}.specifiers.${i}.label`)).toBe(true);
        (s.options ?? []).forEach((o, j) => {
          if (typeof o.label === 'string') {
            expect(seen.has(`${m.namespace}.specifiers.${i}.options.${j}.label`)).toBe(true);
          }
        });
      });
      const hits = strings.flatMap(([p, v]) => retiredIn(v).map((noun) => `${p} (${noun}): ${v}`));
      expect(hits, `the retired noun in manifest copy:\n${hits.join('\n')}`).toEqual([]);
    });
  }

  for (const [locale, data] of BUNDLES) {
    it(`${locale}: no bundle value carries it`, () => {
      const strings = stringsUnder(data, locale, NOTHING);
      // Non-vacuity: values are walked by their path, keys never as text —
      // the storage key `workspace_name` is a path segment here, not a value.
      expect(strings.length).toBeGreaterThan(100);
      expect(strings.map(([p]) => p)).toContain(`${locale}.settings.branding.keys.workspace_name.label`);
      const hits = strings.flatMap(([p, v]) => retiredIn(v).map((noun) => `${p} (${noun}): ${v}`));
      expect(hits, `the retired noun in ${locale} copy:\n${hits.join('\n')}`).toEqual([]);
    });
  }
});
