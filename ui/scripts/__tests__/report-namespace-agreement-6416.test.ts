/**
 * objectui#6416 — the `plugin-report` component keys must be DECLARED and
 * REGISTERED under the same namespace.
 *
 * `packages/plugin-report/src/index.tsx` registered `report`, `spec-report` and
 * `report-viewer` under namespace `report`. `apps/console/src/register-plugins.ts`
 * declared the lazy stubs for the same three short names under `plugin-report`,
 * and `packages/cli/src/utils/known-schema-types.ts` — generated from both sites
 * by `regenerate-known-schema-types.mjs` — therefore shipped SIX namespaced
 * spellings for THREE components. Three of them (`plugin-report:*`) named
 * nothing: `Registry.register` clears the lazy stub for the type it registers,
 * and that type was `report:report`, so the `plugin-report:*` stubs stayed
 * pending forever and a schema authored with one of them resolved to nothing.
 *
 * That is a declared-but-unenforceable surface in the whitelist itself — the
 * gate handed authors a green light for a key the runtime can never satisfy,
 * the exact failure direction `known-schema-types-derivation-5115.test.ts`
 * exists to keep out of the list.
 *
 * The comparison here is EXTRACTIVE: both halves are re-read from source on
 * every run by `deriveRegistryKeys` — the same derivation that feeds the
 * whitelist and judges documentation snippets — so nothing in this file is a
 * copy that can drift from the registrations it describes. The complementary
 * pin, that the resulting bare keys have one owner in any registration order,
 * is `packages/plugin-report/src/__tests__/report-bare-key-ownership.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; types are inferred from the `.mjs` source by
// `tsconfig.scripts.json` (`allowJs`). See objectui#3494.
import { deriveRegistryKeys } from '../check-doc-component-types.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const derived = deriveRegistryKeys(repoRoot);

/** The namespace the console stubs and the CLI whitelist name. */
const NS = 'plugin-report';
/**
 * The short names this plugin owns: two since objectui#11440 retired the
 * `spec-report` alias of `report` (the third row below holds it gone from both
 * sites).
 */
const SHORT_NAMES = ['report', 'report-viewer'] as const;

/** The short name objectui#11440 retired from both sites. */
const RETIRED_SHORT_NAME = 'spec-report';

const PLUGIN_SITE = 'packages/plugin-report/src/index.tsx';
const CONSOLE_SITE = 'apps/console/src/register-plugins.ts';

/** Sites that claim `key`, with the `:line` suffix stripped. */
function filesClaiming(key: string): string[] {
  const sites: string[] | undefined = derived.keys.get(key);
  return [...new Set((sites ?? []).map((s) => s.replace(/:\d+$/, '')))].sort();
}

/** Every derived key whose short name (the part after the first `:`) is `short`. */
function namespacedSpellingsOf(short: string): string[] {
  return [...derived.keys.keys()]
    .filter((k: string) => k.includes(':') && k.slice(k.indexOf(':') + 1) === short)
    .sort();
}

describe('the derivation this pin trusts', () => {
  it('resolves every registration site — an unresolved one would shrink the universe silently', () => {
    expect(derived.findings).toEqual([]);
  });

  it('is not vacuous: it finds registrations across many files', () => {
    // Guards the failure mode where a moved directory makes the walk empty and
    // every set comparison below passes by comparing nothing to nothing.
    expect(derived.counters.resolved).toBeGreaterThan(100);
    expect(derived.keys.size).toBeGreaterThan(300);
  });
});

describe('plugin-report keys are registered under the namespace their consumers declare', () => {
  it.each(SHORT_NAMES)('"%s" has exactly one namespaced spelling, and it is plugin-report', (short) => {
    expect(
      namespacedSpellingsOf(short),
      `"${short}" resolves to one component, so it must have one namespaced spelling. A second ` +
        'one means the console stubs and the plugin registration disagree, and the whitelist ' +
        'ships a key nothing can satisfy (objectui#6416)',
    ).toEqual([`${NS}:${short}`]);
  });

  it.each(SHORT_NAMES)('"%s" is claimed as `plugin-report:%s` by BOTH the stub and the plugin', (short) => {
    // The bug this pins: `plugin-report:<short>` used to be claimed by the
    // console alone — declared renderable by the whitelist, satisfied by
    // nothing, because the plugin registered `report:<short>` instead.
    expect(filesClaiming(`${NS}:${short}`)).toEqual([CONSOLE_SITE, PLUGIN_SITE].sort());
  });

  it.each(SHORT_NAMES)('bare "%s" is claimed by both sites, so the lazy stub loads the real thing', (short) => {
    // Both sites still claim the bare key — deliberately. They now name the same
    // full type, so `register()` clears the stub it replaces. `skipFallback` on
    // either one would strand the bare spelling, which is the only spelling
    // anything in this repository authors.
    expect(filesClaiming(short)).toEqual([CONSOLE_SITE, PLUGIN_SITE].sort());
  });

  it('the `report:*` namespace is retired entirely', () => {
    expect([...derived.keys.keys()].filter((k: string) => k.startsWith('report:')).sort()).toEqual([]);
  });
});

describe('the retired `spec-report` spelling (objectui#11440)', () => {
  it('no site claims it, bare or namespaced — the plugin and the console stub retired it together', () => {
    expect(filesClaiming(RETIRED_SHORT_NAME)).toEqual([]);
    expect(filesClaiming(`${NS}:${RETIRED_SHORT_NAME}`)).toEqual([]);
    expect(namespacedSpellingsOf(RETIRED_SHORT_NAME)).toEqual([]);
    // Lit control: the spelling it points authors to is still claimed by both sites.
    expect(filesClaiming(`${NS}:report`)).toEqual([CONSOLE_SITE, PLUGIN_SITE].sort());
  });
});
