#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regenerate `src/locales/zh-Hant.ts` from `src/locales/zh-Hans.ts`.
 *
 *   pnpm --filter @object-ui/i18n gen:zh-hant
 *
 * The zh-Hant pack is not hand-written: it is the zh-Hans pack converted by
 * `./zh-hant.mjs`, so every key, placeholder and plural slot follows zh-Hans
 * exactly. An edit to zh-Hans.ts, or to a conversion rule, is followed by this
 * command in the same change; `src/__tests__/zh-hant-generated.test.ts` fails
 * when the committed pack is not what this command writes.
 *
 * Refuses to write (exit 1) when the conversion no longer answers its pinned
 * cases. Prints every 里 the locative rules did not claim, so a reviewer can
 * tell a genuine 里 from a straddled locative.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateZhHantPack, unresolvedLocatives } from './zh-hant.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../src/locales/zh-Hans.ts');
const TARGET = join(HERE, '../src/locales/zh-Hant.ts');

let generated;
try {
  generated = generateZhHantPack(readFileSync(SOURCE, 'utf8'));
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let current = null;
try {
  current = readFileSync(TARGET, 'utf8');
} catch {
  // First generation: there is no pack yet.
}

if (current === generated) {
  console.log('✓ zh-Hant: src/locales/zh-Hant.ts is already current.');
} else {
  writeFileSync(TARGET, generated, 'utf8');
  console.log('✓ zh-Hant: wrote src/locales/zh-Hant.ts from src/locales/zh-Hans.ts.');
}

const locatives = unresolvedLocatives(generated);
if (locatives.length > 0) {
  console.warn(
    `⚠ zh-Hant: ${locatives.length} 里 the locative rules did not claim. Each is a genuine 里 ` +
      '(add it to GENUINE_LI to quiet this line) or a straddled locative that belongs in ' +
      'LOCATIVE_LI, both in scripts/zh-hant.mjs:',
  );
  for (const context of locatives) console.warn(`    …${context}…`);
}
