// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/spec/meta-spelling` — metadata type-name spelling vocabulary,
 * schema-free (#10096, maintainer ruling 2026-08-20).
 *
 * This entry exists so a browser/client consumer who needs to spell (or fold,
 * or refuse) a metadata type name pays a few hundred bytes instead of linking
 * the zod schema graph — the measured cost of reaching the same symbols
 * through `@objectstack/spec/shared` was +60.1 KB gzipped on a graph that
 * already carried `/ui` and `/kernel`.
 *
 * The standing principle this entry implements (recorded verbatim,
 * untranslated): 「浏览器可达的 spec 导出面必须 schema-free」 — a
 * browser-reachable export surface carries vocabulary (maps, folds, enums,
 * pure predicates) without linking the zod schema/validation machinery.
 *
 * The published surface is TWO deliberately distinct spelling contracts
 * (#8424 — merging them once shipped an authorization bypass; see
 * `./metadata-url-spelling`'s module doc), each also kept on `/shared`
 * (`/shared` keeps its surface; this entry is additive, one declaration
 * re-exported per symbol):
 *
 *  - the **`/meta/:type` URL-spelling contract** — `META_URL_TO_SINGULAR`,
 *    the fold, and the two refusal verdicts. The map is derived at BUILD time
 *    from `PLURAL_TO_SINGULAR` and `DEFAULT_METADATA_TYPE_REGISTRY`
 *    (`gen:meta-url-spelling`), and `check:meta-url-spelling` enforces both
 *    its freshness and the manifest/derived spelling agreement on every CI
 *    lap;
 *  - the **`defineStack()` manifest-collection vocabulary** (#11503) —
 *    `PLURAL_TO_SINGULAR` / `SINGULAR_TO_PLURAL` and their folds, whose keys
 *    are the collection properties an author writes in `defineStack()`. Widened
 *    onto this entry because `@objectstack/core` keys every metadata store on
 *    `pluralToSingular` (#7378 row 2 — the map has ONE owner), and reaching it
 *    through `/shared` put the schema graph on every browser consumer's eager
 *    closure.
 *
 * @module
 */

export {
  META_URL_TO_SINGULAR,
  canonicalMetaUrlType,
  metaUrlSpellingRefusal,
  unrecognisedMetaTypeRefusal,
} from './metadata-url-spelling';

export {
  PLURAL_TO_SINGULAR,
  SINGULAR_TO_PLURAL,
  pluralToSingular,
  singularToPlural,
} from './manifest-collection-spelling';
