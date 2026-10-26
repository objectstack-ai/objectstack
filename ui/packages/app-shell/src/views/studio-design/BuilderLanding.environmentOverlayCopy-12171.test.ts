// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12171 — the Studio landing names the overlay axis that exists.
 *
 * ADR-0131 D6 (objectstack) retired ADR-0005's per-organization overlay axis.
 * The registry flag the landing points at is `allowEnvironmentOverlay`: may an
 * environment overlay an item a package ships. Three landing strings still
 * offered an "org overlay" (zh 「组织覆盖」): the page description, the
 * read-only section's hint, and the tooltip on a read-only card's overlay link.
 * A fourth string, the permission matrix's hint on a set a code package ships
 * (`perm.readOnly.artifact.hint`), said "per-org overlay" (zh 「按组织覆盖」)
 * in its parenthetical; the card's claim amendment added it to this pin.
 *
 * ## The population
 *
 * Every string table the designer module declares, read through the extractor
 * `check:i18n-designer-parity` reads with (`readDesignerPairs`), then narrowed
 * to the tables that carry these keys. No list of locales is kept here: a table
 * added for another language joins the population by itself.
 *
 * ## The pins
 *
 * 1. No value of these keys, in any table that carries them, names the
 *    organization axis.
 * 2. Lit control on the matcher: every one of those values names the
 *    environment overlay. A table in a language neither pattern speaks fails
 *    here, so pin 1 cannot pass on it by matching nothing.
 * 3. Lit control on the reader: for every locale the module's own
 *    `SupportedLocale` union declares, the value `t()` serves is the one the
 *    extractor read, so an extractor that read some other table cannot pass.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain-JS gate script, intentionally untyped (`allowJs: false`)
import { readDesignerPairs } from '../../../../../scripts/check-i18n-designer-table-parity.mjs';
import { t, type SupportedLocale } from '../metadata-admin/i18n';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const readTables: (root: string) => Map<string, Map<string, string>> = readDesignerPairs;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * The keys that name the overlay axis: the three `BuilderLanding` renders, and
 * the hint `PermissionMatrixEditor` shows on a set a code package ships.
 */
const KEYS = [
  'engine.studio.landing.description',
  'engine.studio.landing.readonlyHint',
  'engine.studio.landing.overlayTitle',
  'perm.readOnly.artifact.hint',
] as const;

/** The retired axis, in the languages the tables speak: "org", "per-org", "organization", 组织. */
const ORGANIZATION_AXIS = /\borg(?:ani[sz]ation)?s?\b|组织/iu;

/** The axis that exists, in the same languages. */
const ENVIRONMENT_OVERLAY = /\benvironment overlay\b|环境覆盖/iu;

/**
 * Every locale the module declares. `satisfies` makes the record complete over
 * `SupportedLocale`, so a locale added to that union fails the type-check here
 * until it is listed.
 */
const DECLARED_LOCALES = { 'en-US': true, 'zh-CN': true } satisfies Record<SupportedLocale, true>;

function tablesCarryingKeys(): Array<[string, Map<string, string>]> {
  return [...readTables(REPO_ROOT)].filter(([, table]) => KEYS.some((key) => table.has(key)));
}

describe('the overlay copy names the environment overlay, not the organization axis (objectui#12171)', () => {
  it('reads the tables t() serves', () => {
    const read = tablesCarryingKeys();
    for (const locale of Object.keys(DECLARED_LOCALES)) {
      for (const key of KEYS) {
        const served = t(key, locale);
        expect(served, `${locale} ${key} is missing from the table t() reads`).not.toBe(key);
        expect(
          read.some(([, table]) => table.get(key) === served),
          `${locale} ${key}: the value t() serves is not among the values the extractor read`,
        ).toBe(true);
      }
    }
  });

  it('no value of these keys names the organization axis', () => {
    const offenders: string[] = [];
    for (const [name, table] of tablesCarryingKeys()) {
      for (const key of KEYS) {
        const value = table.get(key);
        if (value === undefined) offenders.push(`${name} ${key}: missing`);
        else if (ORGANIZATION_AXIS.test(value)) offenders.push(`${name} ${key}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every value of these keys names the environment overlay', () => {
    const silent: string[] = [];
    for (const [name, table] of tablesCarryingKeys()) {
      for (const key of KEYS) {
        const value = table.get(key) ?? '';
        if (!ENVIRONMENT_OVERLAY.test(value)) silent.push(`${name} ${key}: ${value}`);
      }
    }
    expect(silent).toEqual([]);
  });
});
