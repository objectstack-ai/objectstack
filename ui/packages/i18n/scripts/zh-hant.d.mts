// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Declaration twin of `zh-hant.mjs`, so the package's TypeScript tests (compiled
// with `allowJs: false`) import the converter typed, with no `@ts-expect-error`
// and no local annotation. `src/__tests__/zh-hant-generated.test.ts` pins that
// the names declared here are exactly the names the module exports.

/** `s2twp` phrase rules shadowed at the head of its TWPhrases group. */
export declare const TWP_PHRASE_OVERRIDES: ReadonlyArray<readonly [string, string]>;

/** Simplified phrases OpenCC's segmentation cuts across a word boundary, and their conversion. */
export declare const STRADDLE_OVERRIDES: ReadonlyArray<readonly [string, string]>;

/** The locative 里 → 裡 repairs, behind a listed word only. */
export declare const LOCATIVE_LI: ReadonlyArray<readonly [RegExp, string]>;

/** 里 that is genuinely 里. */
export declare const GENUINE_LI: RegExp;

/** Simplified (mainland) → Traditional (Taiwan, phrase conversion). */
export declare function s2t(text: string): string;

/** Every 里 in converted text that the locative rules did not claim. */
export declare function unresolvedLocatives(text: string): string[];

/** The conversion's pinned cases: input → expected output. */
export declare const CONVERSION_CASES: ReadonlyArray<readonly [string, string]>;

/** The pinned cases the converter does not answer as pinned. */
export declare function conversionFailures(): Array<{ input: string; expected: string; actual: string }>;

/** The `console.ai.*` outbound leaves the generated pack does not carry. */
export declare const GATE_ONLY_KEYS: ReadonlyArray<string>;

/** The header the generated pack opens with. */
export declare const GENERATED_HEADER: string;

/** The zh-Hant pack source, generated from the zh-Hans pack source. */
export declare function generateZhHantPack(zhHansSource: string): string;
