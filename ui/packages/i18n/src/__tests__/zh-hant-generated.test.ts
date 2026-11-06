// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every committed zh-Hant catalogue is exactly what the generator writes from
 * its committed zh-Hans source (objectstack#30511, ruling F of
 * objectstack#29349): the pack, and each pack-shaped lazy namespace's
 * catalogue (`ZH_HANT_TARGETS`).
 *
 * `src/locales/zh-Hant.ts` and `src/namespaces/marketplace/zh-Hant.ts` are not
 * hand-written: `scripts/gen-zh-hant.mjs` converts their `zh-Hans.ts` sources
 * with the rules in `scripts/zh-hant.mjs` (OpenCC `s2twp`, pinned, plus the
 * www.objectos.ai overrides). Two edits can leave a pair out of step, and both
 * are ordinary edits that read as done:
 *
 *   - a zh-Hans string changed and `gen:zh-hant` was not run, so Traditional
 *     readers keep the retired sentence;
 *   - a conversion rule changed and the pack was not regenerated, so the rule
 *     says one word and the pack shows another.
 *
 * Either one reds here, with the command that repairs it. ⛔ The repair is
 * never a hand edit of a `zh-Hant.ts`: the next regeneration would undo it.
 * A rendering that is wrong belongs in `TWP_PHRASE_OVERRIDES` (and in the
 * site's converter, which the rules are copied from).
 *
 * This is a package test, not a `check:*` gate (ruling F adds none).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as converter from '../../scripts/zh-hant.mjs';
import {
  CONVERSION_CASES,
  GATE_ONLY_KEYS,
  GENERATED_HEADER,
  NAMESPACE_GENERATED_HEADER,
  ZH_HANT_TARGETS,
  conversionFailures,
  s2t,
} from '../../scripts/zh-hant.mjs';
import zhHans from '../locales/zh-Hans.js';
import zhHant from '../locales/zh-Hant.js';
import zhHansMarketplace from '../namespaces/marketplace/zh-Hans.js';
import zhHantMarketplace from '../namespaces/marketplace/zh-Hant.js';

// Rooted on THIS FILE, never on `process.cwd()`: the package-scoped and the
// repo-root vitest invocations run in different directories (AGENTS.md).
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string) => readFileSync(path.join(packageRoot, relative), 'utf8');

const regenerate = (target: string) =>
  `run \`pnpm --filter @object-ui/i18n gen:zh-hant\` and commit ${target}`;

describe('every zh-Hant catalogue is generated, and current', () => {
  it('generates the pack and the marketplace namespace catalogue', () => {
    // Counter-probe: an emptied target list would make the cases below vacuous.
    expect(ZH_HANT_TARGETS.map(({ target }) => target)).toEqual([
      'src/locales/zh-Hant.ts',
      'src/namespaces/marketplace/zh-Hant.ts',
    ]);
  });

  it.each(ZH_HANT_TARGETS.map((entry) => [entry.target, entry]))(
    '%s is byte-for-byte what the generator writes from its zh-Hans source',
    (target, { source, generate }) => {
      const committed = read(target);
      const generated = generate(read(source));
      // A boolean first, so a stale catalogue fails with the repair rather than
      // with a 5,000-line diff; the equality below is what a reviewer then reads.
      expect(committed === generated, `${target} is stale: ${regenerate(target)}`).toBe(true);
      expect(committed).toBe(generated);
    },
  );

  it('each opens with the generated marker, so nobody edits it by hand', () => {
    expect(read('src/locales/zh-Hant.ts').startsWith(GENERATED_HEADER)).toBe(true);
    expect(read('src/namespaces/marketplace/zh-Hant.ts').startsWith(NAMESPACE_GENERATED_HEADER)).toBe(true);
    expect(GENERATED_HEADER).toContain('@generated');
    expect(NAMESPACE_GENERATED_HEADER).toContain('@generated');
  });

  it('converts the namespace catalogue rather than copying it', () => {
    expect(zhHansMarketplace.marketplace.refresh).toBe('刷新');
    expect(zhHantMarketplace.marketplace.refresh).toBe(s2t(zhHansMarketplace.marketplace.refresh));
    expect(zhHantMarketplace.marketplace.refresh).not.toBe(zhHansMarketplace.marketplace.refresh);
  });

  it('answers every pinned conversion case', () => {
    // Counter-probe: an empty case list would make this vacuous.
    expect(CONVERSION_CASES.length).toBeGreaterThan(10);
    expect(conversionFailures()).toEqual([]);
  });

  it('converts rather than copies: the probe key is Traditional, and is the converter\'s answer', () => {
    expect(zhHans.common.save).toBe('保存');
    expect(zhHant.common.save).toBe('儲存');
    expect(zhHant.common.save).toBe(s2t(zhHans.common.save));
    // Placeholders are not Han text, so the converter leaves them alone.
    expect(s2t('已选择 {{count}} 条记录')).toContain('{{count}}');
  });

  it('carries none of the gate-only outbound keys, and drops nothing else', () => {
    const ai = zhHant.console.ai as Record<string, unknown>;
    for (const key of GATE_ONLY_KEYS) expect(ai[key], key).toBeUndefined();
    const hansAi = zhHans.console.ai as Record<string, unknown>;
    for (const key of GATE_ONLY_KEYS) expect(typeof hansAi[key], key).toBe('string');
    const dropped = Object.keys(hansAi).filter((key) => !(key in ai));
    expect(dropped.sort()).toEqual([...GATE_ONLY_KEYS].sort());
  });
});

describe('the converter is typed by its declaration twin', () => {
  it('declares exactly the names the module exports', () => {
    const declared = [
      ...read('scripts/zh-hant.d.mts').matchAll(/^export declare (?:const|function) (\w+)/gm),
    ].map((match) => match[1]);
    // Counter-probe: a regex that stopped matching would compare two empty lists.
    expect(declared.length).toBeGreaterThan(5);
    expect(declared.sort()).toEqual(Object.keys(converter).sort());
  });
});
