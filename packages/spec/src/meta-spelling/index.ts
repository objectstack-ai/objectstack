// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/spec/meta-spelling` — the `/meta/:type` URL-spelling contract,
 * schema-free (#10096, maintainer ruling 2026-08-20).
 *
 * This entry exists so a browser/client consumer who needs to spell (or fold,
 * or refuse) a `/meta/:type` path segment pays a few hundred bytes instead of
 * linking the zod schema graph — the measured cost of reaching the same four
 * symbols through `@objectstack/spec/shared` was +60.1 KB gzipped on a graph
 * that already carried `/ui` and `/kernel`.
 *
 * The standing principle this entry implements (recorded verbatim,
 * untranslated): 「浏览器可达的 spec 导出面必须 schema-free」 — a
 * browser-reachable export surface carries vocabulary (maps, folds, enums,
 * pure predicates) without linking the zod schema/validation machinery.
 *
 * The published surface is the same four symbols `/shared` carries (#8424 —
 * `/shared` keeps them; this entry is additive, one declaration re-exported):
 * the map, the fold, and the two refusal verdicts. The map is derived at BUILD
 * time from `PLURAL_TO_SINGULAR` and `DEFAULT_METADATA_TYPE_REGISTRY`
 * (`gen:meta-url-spelling`), and `check:meta-url-spelling` enforces both its
 * freshness and the manifest/derived spelling agreement on every CI lap.
 *
 * @module
 */

export {
  META_URL_TO_SINGULAR,
  canonicalMetaUrlType,
  metaUrlSpellingRefusal,
  unrecognisedMetaTypeRefusal,
} from './metadata-url-spelling';
