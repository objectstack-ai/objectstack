// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * URL SPELLING of a metadata type — the `/meta/:type` half of #4432's canonical
 * type key (#7894 · #8424 · #8421).
 *
 * The implementation moved to `src/meta-spelling/metadata-url-spelling.ts`
 * (#10096, maintainer ruling 2026-08-20): the map is now materialized at BUILD
 * time (`gen:meta-url-spelling`) so the contract is schema-free — importable
 * without the kernel registry's zod closure — and published fine-grained as
 * `@objectstack/spec/meta-spelling`. This file keeps the same four symbols on
 * `/shared` (one declaration, re-exported; existing consumers are unaffected).
 *
 * Two things a reader used to find HERE and should look for THERE:
 * - the module doc explaining the three-limb derivation and why this map is
 *   not `PLURAL_TO_SINGULAR`;
 * - `assertMetaUrlSpellingsAgree()`, which no longer runs at module load — its
 *   enforcement home is the build-time `check:meta-url-spelling` gate
 *   (`scripts/build-meta-url-spelling.ts`), per the same ruling (⛔ dropping
 *   the assertion was explicitly forbidden; moving it is what was approved).
 *
 * @module
 */

export {
  META_URL_TO_SINGULAR,
  canonicalMetaUrlType,
  metaUrlSpellingRefusal,
  unrecognisedMetaTypeRefusal,
} from '../meta-spelling/metadata-url-spelling';
