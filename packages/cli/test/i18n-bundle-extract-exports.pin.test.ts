// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The translatable-key walk moved to `@objectstack/lint` (`i18n-walk.ts`) so a
 * browser can run it; the CLI's extractor module kept everything else and
 * re-exports the walk. This pins that the module still offers exactly what
 * `utils/i18n-extract.ts` offered before the move, and that the walk names are
 * lint's own functions, not a second copy that could drift from them.
 */

import { describe, it, expect } from 'vitest';
import * as lint from '@objectstack/lint';
import * as bundleExtract from '../src/utils/i18n-bundle-extract.js';
import type {
  ExpectedEntry,
  ExpectedEntryOptions,
  ExtractOptions,
  ExtractResult,
  FillStrategy,
  TranslationModuleKind,
} from '../src/utils/i18n-bundle-extract.js';

/** The runtime exports of `packages/cli/src/utils/i18n-extract.ts` before the move. */
const RUNTIME_EXPORTS_BEFORE_THE_MOVE = [
  'authorWarnedTranslationGroups',
  'collectExpectedEntries',
  'countTranslationLeaves',
  'extractTranslations',
  'humanizeFieldPath',
  'narrowToCommittedSections',
  'parseSourceHashModule',
  'renderSourceHashModule',
  'renderTranslationModule',
  'stackAuthoredSubtree',
  'translationModulePayload',
  'translationModuleSections',
];

// The type exports, held by type-check: removing one fails `typecheck`.
type TypeExportsBeforeTheMove = [
  ExpectedEntry,
  ExpectedEntryOptions,
  ExtractOptions,
  ExtractResult,
  FillStrategy,
  TranslationModuleKind,
];

describe('the CLI extractor module after the walk moved to @objectstack/lint', () => {
  it('exports exactly the runtime names it exported before', () => {
    expect(Object.keys(bundleExtract).sort()).toEqual(RUNTIME_EXPORTS_BEFORE_THE_MOVE);
  });

  it("re-exports lint's walk functions themselves", () => {
    expect(bundleExtract.collectExpectedEntries).toBe(lint.collectExpectedEntries);
    expect(bundleExtract.authorWarnedTranslationGroups).toBe(lint.authorWarnedTranslationGroups);
    expect(bundleExtract.humanizeFieldPath).toBe(lint.humanizeFieldPath);
  });

  it('still offers its type exports, with the extract options extending the walk options', () => {
    const none: TypeExportsBeforeTheMove | undefined = undefined;
    const options: ExtractOptions = { warnedGroups: new Set<string>() };
    const walkOptions: ExpectedEntryOptions = options;
    expect(none).toBeUndefined();
    expect(walkOptions.warnedGroups?.size).toBe(0);
  });
});
