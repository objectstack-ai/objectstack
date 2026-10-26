// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a retired key's prescription lives once its tombstone has aged out
 * (ADR-0087, amendment 2026-10-26 — #25767, maintainer ruling D2 = A).
 *
 * A retirement kit — the `retiredKey()` tombstone, its `RETIRED_KEYS_BY_MAJOR`
 * / `RETIRED_DEFS_BY_MAJOR` rows, its D3 semantic entry and its D2 conversion
 * — lives ONE protocol major past the one it retired in. After that the key is
 * an ordinary unknown key: the `strictObject` refusal names it, offers the
 * nearest declared spelling, and points HERE, because the prescription that
 * used to ride on the tombstone is now only in the generated upgrade guide
 * (`scripts/build-upgrade-guide.ts`, one page per migrated major). The
 * migration chain's floor rises on the same clock, so `os migrate meta --from
 * N` below the floor refuses with the same link instead of converting.
 *
 * One spelling, shared by the strict refusal (`suggestions.zod.ts`), the floor
 * error (`migrations/chain.ts`) and the CLI's own `--from` examples, so the
 * three doors an author can hit all send them to the same page.
 */
export const PROTOCOL_UPGRADE_GUIDE_URL = 'https://objectstack.ai/docs/protocol-upgrade';

/**
 * The sentence every strict unknown-key refusal carries, after its fix channels
 * and ahead of the history sentence (#5955 order). Static on purpose:
 * it names no major, so the pins on the refusal text do not move once per
 * release, and the page it links indexes every migrated major itself.
 */
export const RETIRED_KEY_UPGRADE_GUIDE_SENTENCE =
  'Keys retired before the previous protocol major are no longer prescribed here — '
  + `see the protocol upgrade guide: ${PROTOCOL_UPGRADE_GUIDE_URL}.`;
