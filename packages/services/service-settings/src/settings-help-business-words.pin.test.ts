// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Settings help is written for the administrator who reads it under
 * the field, not for the engineer who wired it (#27853).
 *
 * Authentication, Feature Flags and Mail used to explain themselves in machine
 * values: the option keys `invite_only` / `email_domain` / `open` instead of
 * the option labels the page shows, env var names
 * (`OS_AUTH_REQUIRE_EMAIL_VERIFICATION`, `OS_FEATURE_FLAGS_AI_ENABLED`,
 * `GOOGLE_CLIENT_ID`), stack-config paths, error codes and object API names.
 * The technical detail lives in the deployment docs; the help names the
 * effect in business words.
 *
 * The sweep reads every string an administrator is shown for those three
 * namespaces — the manifest literals (the English fallback) and each shipped
 * locale's copy — and refuses the four shapes that only a developer can read.
 * It pins SHAPES, never wording: a rewrite that stays in business words keeps
 * it green.
 */

import { describe, it, expect } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { authSettingsManifest } from './manifests/auth.manifest.js';
import { featureFlagsSettingsManifest } from './manifests/feature-flags.manifest.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import { en, zhCN, jaJP, esES } from './translations/index.js';

const MANIFESTS: SettingsManifest[] = [
  authSettingsManifest,
  featureFlagsSettingsManifest,
  mailSettingsManifest,
];

const LOCALES: Array<[string, { settings?: Record<string, any>; settingsCommon?: Record<string, any> }]> = [
  ['en', en],
  ['zh-CN', zhCN],
  ['ja-JP', jaJP],
  ['es-ES', esES],
];

/** The developer-only shapes, each named for what it is. */
const DEVELOPER_SHAPES: Array<[string, RegExp]> = [
  // OS_AUTH_REQUIRE_EMAIL_VERIFICATION, GOOGLE_CLIENT_ID, API_KEY_INACTIVE.
  ['env var or error code', /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/],
  // invite_only, sys_email, sys_job_queue, member_default.
  ['enum key or object API name', /\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b/],
  // emailAndPassword.requireEmailVerification, server.trustProxy, defineStack.
  ['camelCase code identifier', /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/],
  // defineWebhook(), embed(), defineStack({ webhooks }).
  ['code call', /\b[A-Za-z_$][\w$]*\(\s*[\w{}\s,]*\)/],
  // Inline code spans.
  ['code span', /`/],
];

function shapesIn(text: string): string[] {
  return DEVELOPER_SHAPES.filter(([, re]) => re.test(text)).map(
    ([name, re]) => `${name}: ${text.match(re)?.[0]}`,
  );
}

/** Every literal the manifest itself shows: the English fallback. */
function manifestStrings(m: SettingsManifest): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (m.description) out.push([`${m.namespace}.description`, m.description]);
  if (m.helpText) out.push([`${m.namespace}.helpText`, m.helpText]);
  for (const s of m.specifiers as any[]) {
    const at = `${m.namespace}.${s.key ?? s.id ?? s.type}`;
    if (typeof s.description === 'string') out.push([`${at}.description`, s.description]);
    if (typeof s.bannerText === 'string') out.push([`${at}.bannerText`, s.bannerText]);
  }
  return out;
}

/** Every help-shaped string a locale pack carries for one namespace. */
function packStrings(tr: Record<string, any> | undefined, ns: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!tr) return out;
  if (typeof tr.description === 'string') out.push([`${ns}.description`, tr.description]);
  for (const [id, g] of Object.entries<any>(tr.groups ?? {})) {
    if (typeof g?.description === 'string') out.push([`${ns}.groups.${id}.description`, g.description]);
  }
  for (const [key, k] of Object.entries<any>(tr.keys ?? {})) {
    if (typeof k?.help === 'string') out.push([`${ns}.keys.${key}.help`, k.help]);
  }
  for (const [id, b] of Object.entries<any>(tr.banners ?? {})) {
    if (typeof b?.text === 'string') out.push([`${ns}.banners.${id}.text`, b.text]);
  }
  return out;
}

describe('Settings help is in business words (#27853)', () => {
  it('the sweep has teeth: each shape catches the string it was written for', () => {
    // Every shape is exercised by a string the old help carried, so a regex
    // that stops matching anything goes red here instead of passing quietly.
    expect(shapesIn('OS_AUTH_REQUIRE_EMAIL_VERIFICATION=false')).not.toEqual([]);
    expect(shapesIn('under invite_only, only')).not.toEqual([]);
    expect(shapesIn('emailAndPassword.requireEmailVerification: false')).not.toEqual([]);
    expect(shapesIn('declared via defineWebhook() is read')).not.toEqual([]);
    expect(shapesIn('Pin via env vars (e.g. `X`)')).not.toEqual([]);
    expect(shapesIn('Invitation only closes self-registration (SCIM, e.g. smtp.example.com).')).toEqual([]);
  });

  for (const m of MANIFESTS) {
    it(`${m.namespace}: the manifest's own help carries no developer-only value`, () => {
      const hits = manifestStrings(m)
        .map(([at, text]) => [at, shapesIn(text)] as const)
        .filter(([, found]) => found.length > 0)
        .map(([at, found]) => `${at} → ${found.join('; ')}`);
      expect(hits).toEqual([]);
    });

    for (const [locale, data] of LOCALES) {
      it(`${m.namespace}: the ${locale} pack carries no developer-only value`, () => {
        const hits = packStrings(data.settings?.[m.namespace], m.namespace)
          .map(([at, text]) => [at, shapesIn(text)] as const)
          .filter(([, found]) => found.length > 0)
          .map(([at, found]) => `${at} → ${found.join('; ')}`);
        expect(hits).toEqual([]);
      });
    }
  }

  for (const [locale, data] of LOCALES) {
    it(`${locale}: the inherited-value badge does not name the layer "tenant"`, () => {
      const label = data.settingsCommon?.sourceLabels?.tenant;
      expect(typeof label).toBe('string');
      expect(label).not.toMatch(/tenant|租户|テナント|inquilino/i);
    });
  }
});
