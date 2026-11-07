// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12171 — the Studio landing names the overlay axis that exists;
 * objectstack#29489 — and the landing no longer offers that overlay at all.
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
 * objectstack ADR-0146 D11 then closed the package-less write onto a packaged
 * item (403 NOT_OVERRIDABLE, naming the base's `.custom` pair). The landing's
 * two strings now teach the route that is open: Customize or New similar,
 * saved in the package's `.custom` customization package. The permission hint
 * still names the environment overlay, because it says that overlay is refused.
 *
 * ## The population
 *
 * Every designer string table, read through their shared extractor
 * (`readDesignerPairs` in `ui/scripts/check-i18n-dead-keys.mjs`), then narrowed
 * to the tables that carry these keys. No list of locales is kept here: a table
 * added for another language joins the population by itself.
 *
 * ## The pins
 *
 * 1. No value of these keys, in any table that carries them, names the
 *    organization axis.
 * 2. No landing value names the environment overlay, and every landing value
 *    names the route that exists: the `.custom` package and the table's own
 *    Customize label, read from the same table, so the check speaks every
 *    language a table is written in.
 * 3. Lit control on the matchers: the permission hint names the environment
 *    overlay in every table. A table in a language neither pattern speaks
 *    fails here, so pins 1 and 2 cannot pass on it by matching nothing.
 * 4. Lit control on the reader: for every locale the module's own
 *    `SupportedLocale` union declares, the value `t()` serves is the one the
 *    extractor read, so an extractor that read some other table cannot pass.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain-JS gate script, intentionally untyped (`allowJs: false`)
import { readDesignerPairs } from '../../../../../scripts/check-i18n-dead-keys.mjs';
import { t, type SupportedLocale } from '../metadata-admin/i18n';
// The designer's `designer.*` / `perm.*` rows live in `@object-ui/i18n`'s `studio`
// namespace, whose `zh` catalogue is fetched on demand (objectstack#25922).
// Resident before any case, so the zh rows below read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

/** Local annotation, since the import above is untyped — the call site stays checked. */
const readTables: (root: string) => Map<string, Map<string, string>> = readDesignerPairs;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * The two strings `BuilderLanding` renders about a read-only package. The third
 * landing string, the overlay link's tooltip, retired with the link: the
 * landing no longer links into Setup (objectstack ADR-0146 D1, N-28).
 */
const LANDING_KEYS = ['engine.studio.landing.description', 'engine.studio.landing.readonlyHint'] as const;

/** The hint `PermissionMatrixEditor` shows on a set a code package ships: it names the overlay it refuses. */
const PERMISSION_HINT = 'perm.readOnly.artifact.hint';

const KEYS = [...LANDING_KEYS, PERMISSION_HINT] as const;

/** The Customize action's own label, read from each table beside the landing strings. */
const CUSTOMIZE_ACTION = 'engine.studio.customize.action';

/** The customization package a read-only package is paired with (objectstack ADR-0146 D3). */
const CUSTOM_PAIR = /\.custom\b/u;

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

function tablesCarryingKeys(): Array<[string, Map<string, string>]> {
  return [...readTables(REPO_ROOT)].filter(([, table]) => KEYS.some((key) => table.has(key)));
}

describe('the read-only copy names no organization axis, and the landing offers no overlay (objectui#12171, objectstack#29489)', () => {
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

  it('no landing value offers the environment overlay; each names Customize and the .custom package', () => {
    const offenders: string[] = [];
    for (const [name, table] of tablesCarryingKeys()) {
      const customize = table.get(CUSTOMIZE_ACTION);
      if (!customize) {
        offenders.push(`${name} ${CUSTOMIZE_ACTION}: missing`);
        continue;
      }
      for (const key of LANDING_KEYS) {
        const value = table.get(key) ?? '';
        if (ENVIRONMENT_OVERLAY.test(value)) offenders.push(`${name} ${key} offers the overlay: ${value}`);
        if (!CUSTOM_PAIR.test(value)) offenders.push(`${name} ${key} names no .custom package: ${value}`);
        if (!value.includes(customize)) offenders.push(`${name} ${key} names no "${customize}": ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lit control: the permission hint names the environment overlay in every table', () => {
    const silent: string[] = [];
    for (const [name, table] of tablesCarryingKeys()) {
      const value = table.get(PERMISSION_HINT) ?? '';
      if (!ENVIRONMENT_OVERLAY.test(value)) silent.push(`${name}: ${value}`);
    }
    expect(silent).toEqual([]);
  });
});
