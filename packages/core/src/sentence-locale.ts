// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { platformLocaleTagOf, type PlatformLocaleTag } from '@objectstack/spec/system';

/**
 * [ADR-0149 M1] The language a platform-composed sentence in a tool's result
 * is written in: one picker shared by the dataset tools (`nextStep` and
 * `sourceLine` in `@objectstack/service-analytics`) and the MCP record tools
 * (`ifNotRecorded` in `@objectstack/mcp`), so those producers never disagree
 * on the language for the same caller.
 *
 * `locales` is the caller's ladder in order, as a door hands it
 * ({@link userTextLocalesOf}: the request's locale, then the workspace
 * default); `written` is the languages the producer has sentences for. The
 * first code that names one of them decides, else `en`, the floor every
 * producer writes. A code is read through the platform locale table
 * (`platformLocaleTagOf`), whole and then one subtag shorter at a time
 * ({@link platformLocaleNamedBy}), so a language the producer does not write
 * takes the next rung rather than a guess.
 */
export function pickSentenceLocale<T extends PlatformLocaleTag>(
  locales: readonly (string | undefined)[],
  written: readonly T[],
): T | 'en' {
  for (const code of locales) {
    const tag = platformLocaleNamedBy(code);
    if (tag !== undefined && (written as readonly PlatformLocaleTag[]).includes(tag)) return tag as T;
  }
  return 'en';
}

/**
 * The platform locale a code names, or `undefined`: the whole code through
 * `platformLocaleTagOf`, then each shorter prefix one subtag at a time (RFC
 * 4647 lookup: `zh-CN` → `zh-Hans`, `en-GB` → `en`, `zh-Hant-TW` → `zh-Hant`).
 * The first prefix the table names decides, so a Traditional Chinese code is
 * never handed the Simplified sentence.
 */
export function platformLocaleNamedBy(code: string | undefined): PlatformLocaleTag | undefined {
  if (typeof code !== 'string' || code.length === 0) return undefined;
  const subtags = code.split('-');
  for (let n = subtags.length; n > 0; n -= 1) {
    const tag = platformLocaleTagOf(subtags.slice(0, n).join('-'));
    if (tag !== undefined) return tag;
  }
  return undefined;
}
