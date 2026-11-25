// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `estimateTokens` — the ONE token estimate shared by the platform and the
 * apps built on it, so every reader measures a text's length the same way.
 * `@objectstack/embedder-openai` reads it to refuse an input over a model's
 * limit; knowledge chunking is to read it too (#37098).
 *
 * It is a conservative upper estimate, not a tokenizer: no provider's
 * vocabulary ships with the platform, and the embedders it talks to
 * (OpenAI, DashScope, BigModel, BGE…) each tokenize differently. On the
 * sampled classes — Chinese, mixed Chinese/English, and English-heavy text
 * with long words, numbers, URLs and code — it sits at or above OpenAI
 * `cl100k` counts; on Chinese text it runs about 1.4× those counts.
 *
 * Known residual: text made mostly of random hex or base64 (UUIDs, sha256
 * digests, encoded blobs) estimates BELOW its `cl100k` count — `cl100k`
 * spends about one token per one to one and a half such characters. Emoji
 * and rare ideographs (CJK Extension B and later) may estimate low too.
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
 *  - for each run of ASCII letters and digits (`[A-Za-z0-9]+`), by what it
 *    holds — a tokenizer splits identifiers, figures and words very
 *    differently:
 *     - letters only: **ceil(length / 4)** (`OpenAI` 2, `internationalization` 5);
 *     - digits only: **ceil(length / 3)** (`8192` 2, a 16-digit number 6);
 *     - letters and digits mixed: **ceil(length / 2)** (`v3` 1, a 32-char hex
 *       id 16) — hashes, base64 and UUID segments;
 *  - **1** for each other punctuation mark or character (ASCII punctuation,
 *    non-ASCII letters, symbols, emoji);
 *  - **0** for whitespace, the ideographic space `U+3000` included.
 *
 * Multiply the sum by **1.1** and round up. An empty or all-whitespace text
 * estimates 0.
 *
 * Pure and dependency-free; it reads nothing but its argument.
 */
export function estimateTokens(text: string): number {
  let sum = 0;
  let letters = 0;
  let digits = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isAsciiDigit(cp)) {
      digits += 1;
      continue;
    }
    if (isAsciiLetter(cp)) {
      letters += 1;
      continue;
    }
    sum += asciiRunTokens(letters, digits);
    letters = 0;
    digits = 0;
    // Whitespace first: the ideographic space U+3000 sits inside the CJK
    // Symbols and Punctuation range below, and is whitespace, not a mark.
    if (/\s/u.test(ch)) continue;
    if (isCjkOrFullWidth(cp)) {
      sum += 1.5;
    } else {
      sum += 1;
    }
  }
  sum += asciiRunTokens(letters, digits);
  if (sum === 0) return 0;
  // The epsilon absorbs binary floating-point noise (10 × 1.1 is
  // 11.000000000000002), so an exact product is not rounded up one extra.
  return Math.ceil(sum * TOKEN_ESTIMATE_MARGIN - 1e-9);
}

/**
 * How many characters of one ASCII run count as one token in
 * {@link estimateTokens}, by what the run holds: a run of `n` counts
 * `ceil(n / chars)`.
 */
export const ASCII_RUN_CHARS_PER_TOKEN: Readonly<{
  /** A run of letters only. */
  letters: number;
  /** A run of digits only. */
  digits: number;
  /** A run mixing letters and digits (hashes, base64, UUID segments). */
  mixed: number;
}> = Object.freeze({ letters: 4, digits: 3, mixed: 2 });

/** The safety factor {@link estimateTokens} multiplies its sum by. */
export const TOKEN_ESTIMATE_MARGIN: number = 1.1;

/** The tokens one ASCII run of `letters` letters and `digits` digits counts (0 for no run). */
function asciiRunTokens(letters: number, digits: number): number {
  if (digits === 0) return Math.ceil(letters / ASCII_RUN_CHARS_PER_TOKEN.letters);
  if (letters === 0) return Math.ceil(digits / ASCII_RUN_CHARS_PER_TOKEN.digits);
  return Math.ceil((letters + digits) / ASCII_RUN_CHARS_PER_TOKEN.mixed);
}

function isAsciiDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39; // 0-9
}

function isAsciiLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a); // A-Z, a-z
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
