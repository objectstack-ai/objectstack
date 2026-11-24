// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11801 — zh-CN names a Studio pillar by its tab label, never 支柱.
 *
 * 支柱 is a literal rendering of the code word "pillar" that no tab shows. No
 * zh value in the designer string tables may contain it. Read through the
 * designer tables' shared extractor (`readDesignerPairs` in
 * `ui/scripts/check-i18n-dead-keys.mjs`), so the population is the whole table
 * rather than a list of keys this file would have to keep. Its lit control:
 * the extractor's zh value for `engine.studio.menu.orgFlows` (objectstack#36899
 * retired the pillar names with the top nav) must be the one
 * `t()` serves, so an extractor that read nothing cannot pass for "no 支柱".
 *
 * Moved out of `StudioDesignSurface.railLabels.test.tsx` when objectstack#36502
 * retired the Interfaces pillar, whose render pins of the same card went with it.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-JS gate script, intentionally untyped (`allowJs: false`)
import { readDesignerPairs } from '../../../../../scripts/check-i18n-dead-keys.mjs';
import { t } from '../metadata-admin/i18n';
// The zh rows live in `@object-ui/i18n`'s `studio` namespace, whose `zh`
// catalogue is fetched on demand (objectstack#25922).
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

/** Local annotation, since the import above is untyped — the call site stays checked. */
const readTables: (root: string) => Map<string, Map<string, string>> = readDesignerPairs;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('zh-CN names a pillar by its tab label (objectui#11801)', () => {
  it('no zh value in the designer string tables says 支柱', () => {
    const ZH_ORG_FLOWS = t('engine.studio.menu.orgFlows', 'zh-CN');
    const tables = readTables(REPO_ROOT);
    const zh = tables.get('ENGINE_STRINGS_ZH');
    // Lit control: the extractor reads the table `t()` serves.
    expect(zh?.get('engine.studio.menu.orgFlows')).toBe(ZH_ORG_FLOWS);
    expect(ZH_ORG_FLOWS).toBe('组织级流程');

    const offenders: string[] = [];
    for (const [name, table] of tables) {
      if (!name.endsWith('_ZH')) continue;
      for (const [key, value] of table) if (value.includes('支柱')) offenders.push(`${name} ${key}`);
    }
    expect(offenders).toEqual([]);
  });
});
