// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objectstack serve` constructs `AuthPlugin` itself, so it decides whether
// `plugin-auth`'s `sys_organization` default record page registers. One default
// record page per object per deployment (ruling A on objectstack#23015, record
// 6134056653): when the app this boot serves declares its own default record
// page for `sys_organization`, `serve` passes
// `registerOrganizationRecordPage: false`, from the one predicate `DevPlugin`
// asks too (`stackDeclaresOrganizationRecordPage`, `@objectstack/core`).
//
// The construction is read from `serve.ts` with comments masked, as
// `serve-auth-app-name.contract.test.ts` reads it: `AuthPlugin` is imported
// through a variable specifier, so the type checker cannot see the literal and
// only a booted CLI could. The booted half — an app with its own page boots and
// its page is the single default; without it, plugin-auth's page serves — is
// `test/serve-organization-record-page.e2e.test.ts`, over a real `os serve`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stackDeclaresOrganizationRecordPage } from '@objectstack/core';
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const SERVE_SOURCE = maskComments(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'serve.ts'), 'utf8'),
);

/** The argument text of every `new AuthPlugin(` call. */
function authPluginConstructions(source: string): string[] {
  const out: string[] = [];
  const needle = 'new AuthPlugin(';
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
    const open = i + needle.length - 1;
    let depth = 0;
    for (let j = open; j < source.length; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')' && --depth === 0) {
        out.push(source.slice(open + 1, j));
        break;
      }
    }
  }
  return out;
}

const normalise = (text: string) => text.replace(/\s+/g, '');

describe('serve constructs AuthPlugin with the organization page derived from the served app', () => {
  it('passes registerOrganizationRecordPage from the shared predicate, over this boot\'s config and plugins', () => {
    const constructions = authPluginConstructions(SERVE_SOURCE);
    // Absence must be loud: a scan that finds no construction proves nothing.
    expect(constructions.length, 'serve.ts must construct AuthPlugin exactly once').toBe(1);
    expect(normalise(constructions[0])).toContain(
      'registerOrganizationRecordPage:!stackDeclaresOrganizationRecordPage(config,plugins)',
    );
  });

  it('the predicate reads the app wrap serve appends (an AppPlugin carrying the config as its bundle)', () => {
    const page = { name: 'host_org', type: 'record', object: 'sys_organization', isDefault: true, regions: [] };
    // serve's step 3 appends `new AppPlugin(config)`; a config boot's bundle
    // arrives the same way from `createStandaloneStack`. Either one is read.
    expect(stackDeclaresOrganizationRecordPage({}, [{ name: 'plugin.app.host', bundle: { pages: [page] } }])).toBe(true);
    expect(stackDeclaresOrganizationRecordPage({ pages: [page] }, [])).toBe(true);
    // Control: the same composition with the page not the default.
    expect(stackDeclaresOrganizationRecordPage({ pages: [{ ...page, isDefault: false }] }, [])).toBe(false);
  });
});
