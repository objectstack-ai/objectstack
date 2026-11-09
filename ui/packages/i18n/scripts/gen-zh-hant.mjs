#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regenerate every zh-Hant catalogue from its zh-Hans source: the pack
 * (`src/locales/zh-Hant.ts` from `src/locales/zh-Hans.ts`) and each pack-shaped
 * lazy namespace's (`src/namespaces/<ns>/zh-Hant.ts`), the list `ZH_HANT_TARGETS`
 * in `./zh-hant.mjs` holds.
 *
 *   pnpm --filter @object-ui/i18n gen:zh-hant
 *
 * The zh-Hant catalogues are not hand-written: each is its zh-Hans source
 * converted by `./zh-hant.mjs`, so every key, placeholder and plural slot
 * follows zh-Hans exactly. An edit to a zh-Hans catalogue, or to a conversion
 * rule, is followed by this command in the same change;
 * `src/__tests__/zh-hant-generated.test.ts` fails when a committed catalogue is
 * not what this command writes.
 *
 * Refuses to write (exit 1) when the conversion no longer answers its pinned
 * cases. Prints every 里 the locative rules did not claim, so a reviewer can
 * tell a genuine 里 from a straddled locative.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZH_HANT_TARGETS, unresolvedLocatives } from './zh-hant.mjs';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const { source, target, generate } of ZH_HANT_TARGETS) {
  let generated;
  try {
    generated = generate(readFileSync(join(PACKAGE_ROOT, source), 'utf8'));
  } catch (error) {
    console.error(`✗ ${source}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  let current = null;
  try {
    current = readFileSync(join(PACKAGE_ROOT, target), 'utf8');
  } catch {
    // First generation: there is no catalogue yet.
  }

  if (current === generated) {
    console.log(`✓ zh-Hant: ${target} is already current.`);
  } else {
    writeFileSync(join(PACKAGE_ROOT, target), generated, 'utf8');
    console.log(`✓ zh-Hant: wrote ${target} from ${source}.`);
  }

  const locatives = unresolvedLocatives(generated);
  if (locatives.length > 0) {
    console.warn(
      `⚠ zh-Hant: ${locatives.length} 里 in ${target} the locative rules did not claim. Each is a ` +
        'genuine 里 (add it to GENUINE_LI to quiet this line) or a straddled locative that belongs ' +
        'in LOCATIVE_LI, both in scripts/zh-hant.mjs:',
    );
    for (const context of locatives) console.warn(`    …${context}…`);
  }
}
