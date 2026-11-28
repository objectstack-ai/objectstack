// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12171 — the permission matrix's read-only hint names the overlay
 * axis that exists.
 *
 * `PermissionMatrixEditor` titles its read-only badge on a set a code package
 * ships with `perm.readOnly.artifact.hint`. ADR-0131 D6 (objectstack) retired
 * ADR-0005's per-organization overlay axis, and the hint's parenthetical said
 * "per-org overlay" (zh 「按组织覆盖」). It names the environment overlay — the
 * registry flag `allowEnvironmentOverlay` — because it says that overlay is
 * refused on a packaged item (objectstack ADR-0146 D11).
 *
 * This pin lived in the Studio home's copy test, beside the home's own two
 * strings, until the home was removed (objectstack#36908); the hint is still
 * drawn, so its half moved here.
 *
 * ## The population
 *
 * Every designer string table, read through their shared extractor
 * (`readDesignerPairs` in `ui/scripts/check-i18n-dead-keys.mjs`), narrowed to
 * the tables that carry the key. No list of locales is kept here: a table
 * added for another language joins the population by itself.
 *
 * ## The pins
 *
 * 1. No table's value names the organization axis.
 * 2. Lit control on the matchers: the hint names the environment overlay in
 *    every table. A table in a language neither pattern speaks fails here, so
 *    pin 1 cannot pass on it by matching nothing.
 * 3. Lit control on the reader: for every locale the module's own
 *    `SupportedLocale` union declares, the value `t()` serves is the one the
 *    extractor read, so an extractor that read some other table cannot pass.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain-JS gate script, intentionally untyped (`allowJs: false`)
import { readDesignerPairs } from '../../../../../scripts/check-i18n-dead-keys.mjs';
import { t, type SupportedLocale } from './i18n';
// The designer's `perm.*` rows live in `@object-ui/i18n`'s `studio` namespace,
// whose `zh` catalogue is fetched on demand (objectstack#25922). Resident
// before any case, so the zh rows below read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

/** Local annotation, since the import above is untyped — the call site stays checked. */
const readTables: (root: string) => Map<string, Map<string, string>> = readDesignerPairs;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** The hint `PermissionMatrixEditor` shows on a set a code package ships: it names the overlay it refuses. */
const PERMISSION_HINT = 'perm.readOnly.artifact.hint';

/** The retired axis, in the languages the tables speak: "org", "per-org", "organization", 组织. */
const ORGANIZATION_AXIS = /\borg(?:ani[sz]ation)?s?\b|组织/iu;

/** The overlay axis, in the same languages: refused on a packaged item since objectstack ADR-0146 D11. */
const ENVIRONMENT_OVERLAY = /\benvironment overlay\b|环境覆盖/iu;

/**
 * Every locale the module declares. `satisfies` makes the record complete over
 * `SupportedLocale`, so a locale added to that union fails the type-check here
 * until it is listed.
 */
const DECLARED_LOCALES = { 'en-US': true, 'zh-CN': true, 'zh-Hant': true } satisfies Record<SupportedLocale, true>;

function tablesCarryingHint(): Array<[string, Map<string, string>]> {
  return [...readTables(REPO_ROOT)].filter(([, table]) => table.has(PERMISSION_HINT));
}

describe("the permission matrix's read-only hint names no organization axis (objectui#12171)", () => {
  it('lit control: reads the tables t() serves', () => {
    const read = tablesCarryingHint();
    expect(read.length).toBeGreaterThan(0);
    for (const locale of Object.keys(DECLARED_LOCALES)) {
      const served = t(PERMISSION_HINT, locale);
      expect(served, `${locale} ${PERMISSION_HINT} is missing from the table t() reads`).not.toBe(PERMISSION_HINT);
      expect(
        read.some(([, table]) => table.get(PERMISSION_HINT) === served),
        `${locale} ${PERMISSION_HINT}: the value t() serves is not among the values the extractor read`,
      ).toBe(true);
    }
  });

  it('no table names the organization axis', () => {
    const offenders: string[] = [];
    for (const [name, table] of tablesCarryingHint()) {
      const value = table.get(PERMISSION_HINT) ?? '';
      if (ORGANIZATION_AXIS.test(value)) offenders.push(`${name}: ${value}`);
    }
    expect(offenders).toEqual([]);
  });

  it('lit control: the hint names the environment overlay in every table', () => {
    const silent: string[] = [];
    for (const [name, table] of tablesCarryingHint()) {
      const value = table.get(PERMISSION_HINT) ?? '';
      if (!ENVIRONMENT_OVERLAY.test(value)) silent.push(`${name}: ${value}`);
    }
    expect(silent).toEqual([]);
  });
});
