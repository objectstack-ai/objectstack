// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `estimateTokens` — the ONE token estimate shared by the platform and the
 * apps built on it, so an embedder that refuses an over-limit input and a
 * knowledge service that sizes its chunks never disagree about how long a
 * text is.
 *
 * It is a conservative upper estimate, not a tokenizer: no provider's
 * vocabulary ships with the platform, and the embedders it talks to
 * (OpenAI, DashScope, BigModel, BGE…) each tokenize differently. It is built
 * to sit at or above OpenAI `cl100k` counts on Chinese, mixed
 * Chinese/English and English-heavy text (long words, numbers, URLs, code).
 *
 * ## Formula
 *
 * Walk the text one code point at a time and add:
 *
 *  - **1.5** for each CJK character or full-width punctuation mark —
 *    CJK Unified Ideographs (and their extensions and compatibility block),
 *    kana, Hangul syllables, the CJK Symbols and Punctuation block
 *    (`U+3000`–`U+303F`) and the Halfwidth and Fullwidth Forms block
 *    (`U+FF00`–`U+FFEF`);
 *  - **ceil(length / 4)** for each run of ASCII letters and digits
 *    (`[A-Za-z0-9]+`): `OpenAI` counts 2, `internationalization` 5, `8192` 1;
 *  - **1** for each other punctuation mark or character (ASCII punctuation,
 *    non-ASCII letters, symbols, emoji);
 *  - **0** for whitespace.
 *
 * Multiply the sum by **1.1** and round up. An empty or all-whitespace text
 * estimates 0.
 *
 * Pure and dependency-free; it reads nothing but its argument.
 */
export function estimateTokens(text: string): number {
  let sum = 0;
  let asciiRun = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isAsciiAlphanumeric(cp)) {
      asciiRun += 1;
      continue;
    }
    sum += asciiRunTokens(asciiRun);
    asciiRun = 0;
    if (isCjkOrFullWidth(cp)) {
      sum += 1.5;
    } else if (!/\s/u.test(ch)) {
      sum += 1;
    }
  }
  sum += asciiRunTokens(asciiRun);
  if (sum === 0) return 0;
  // The epsilon absorbs binary floating-point noise (10 × 1.1 is
  // 11.000000000000002), so an exact product is not rounded up one extra.
  return Math.ceil(sum * TOKEN_ESTIMATE_MARGIN - 1e-9);
}

/**
 * How many ASCII letters and digits one token covers in {@link estimateTokens}:
 * a run of `n` counts `ceil(n / 4)`.
 */
export const ASCII_RUN_CHARS_PER_TOKEN = 4;

/** The safety factor {@link estimateTokens} multiplies its sum by. */
export const TOKEN_ESTIMATE_MARGIN = 1.1;

/** The tokens one run of `length` ASCII letters and digits counts (0 for no run). */
function asciiRunTokens(length: number): number {
  return Math.ceil(length / ASCII_RUN_CHARS_PER_TOKEN);
}

function isAsciiAlphanumeric(cp: number): boolean {
  return (
    (cp >= 0x30 && cp <= 0x39) || // 0-9
    (cp >= 0x41 && cp <= 0x5a) || // A-Z
    (cp >= 0x61 && cp <= 0x7a) // a-z
  );
}

function isCjkOrFullWidth(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) || // CJK Symbols and Punctuation (、。「」【】…)
    (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana, Katakana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xff00 && cp <= 0xffef) || // Halfwidth and Fullwidth Forms (，：；！？（）)
    (cp >= 0x20000 && cp <= 0x3134f) // CJK Unified Ideographs Extensions B–G
  );
}
