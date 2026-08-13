// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7378] The `IMetadataService` register/read argument contract, enforced —
 * the shared guard every shipped implementation of the contract's CRUD members
 * calls, so the maintainer's three-cell ruling has ONE implementation instead
 * of three re-derivations that can drift.
 *
 * Maintainer ruling, 2026-08-12 (#7378, 裁定人:维护者 huangyiirene), quoted
 * verbatim and untranslated:
 *
 * > 1. **Row 1(key 归属)= (c) 响亮拒绝。** `register(type, name, data)` 中
 * >    `name` 参数与 `data.name` 不一致时,所有实现统一拒绝并报错定位 ——
 * >    不一致几乎必是作者 bug,任一方向的静默解决都可能把条目放错位置。
 * > 2. **Row 2(objects/object 别名)= 所有实现一个答案,与
 * >    `check:meta-type-normalized` 收敛。** 类型名归一化是契约级规则,不是
 * >    各实现自留的民俗。
 * > 3. **Row 3(非对象 data 静默丢弃)= 响亮拒绝(throw)。** 接受后丢失、且
 * >    任何成员都读不回来,无可辩护;拒绝一个实现无法键控的 `data` 与契约
 * >    同样一致。修的是「接受再丢」,不强求「必须存下」。
 *
 * This module hosts rows 1 and 3 ({@link assertMetadataRegisterContract}) and
 * row 2 ({@link canonicalMetadataServiceType}). It lives in `@objectstack/core`
 * because core is the lowest common dependency of the three shipped
 * implementations — `createMemoryMetadata` (this package), `MetadataManager`
 * (`@objectstack/metadata`) and `MetadataFacade` (`@objectstack/objectql`).
 * The contract's own reference double (`packages/spec`) cannot import from
 * here — spec is the dependency root — so its copy of these rules rides the
 * spec-side half of the ruling, tracked on #7378.
 *
 * ## Row 2 — why the fold, and whose direction it is
 *
 * Plural→singular type-name folding is a decided, enforced platform direction,
 * not this module's invention. The owners this converges with, per the ruling's
 * own instruction to read the gate's existing direction first (「实现者先读该
 * 闸门的既有方向再落」):
 *
 *  - `canonicalMetaType` (`metadata-protocol/src/protocol.ts`, #4432)
 *    canonicalizes every `/meta` request type at the protocol boundary via the
 *    same `PLURAL_TO_SINGULAR` map this module reads;
 *  - `check:meta-type-normalized` (`scripts/check-meta-type-normalized.mjs`)
 *    is the CI gate whose whole job is to refuse a DECISION made on the
 *    un-normalized `:type` — its header carries the three authorization
 *    bypasses (#3984, #5881, #6241) that made the direction a rule. Its scan
 *    surface is `packages/rest/src`; what this module converges with is its
 *    DIRECTION: normalize once, at the entry, and let every decision — here,
 *    every store key — read the normalized value;
 *  - Prime Directive #3: metadata type names are canonically **singular**.
 *
 * Before this ruling, `MetadataManager` and `createMemoryMetadata` keyed their
 * type stores on the raw string, so `register('objects', n, d)` landed in a
 * store `get('object', n)` never read — two stores for one type, differing
 * from `MetadataFacade`, whose `SchemaRegistry` reads alias both spellings.
 * One answer now: the store key is the canonical type.
 *
 * ## Rows 1 and 3 — what the refusals close
 *
 * Row 1: a `data.name` that disagrees with the `name` argument was resolved
 * silently in both directions in shipped code — argument-wins
 * (`MetadataManager`, `createMemoryMetadata`) and document-wins (the
 * pre-ruling `MetadataFacade`) — and either way an author's item could be
 * filed under a key the author never wrote. Refusing is the only answer that
 * cannot misplace the item.
 *
 * Row 3: a `data` that is not a plain object cannot be a metadata document.
 * The pre-ruling `MetadataFacade` accepted such a write and filed it under the
 * literal key `undefined` — readable back through no member (silent loss, the
 * #6725 family) — and the interim fix coerced it into a `{ name, content }`
 * box, which collides with `content` being a REAL authorable field on live
 * metadata types (`doc`, `knowledge_document`). The ruling forbids both:
 * refuse, do not coerce into storability. `null` and arrays are refused with
 * primitives — neither can carry the document identity a metadata store keys
 * on, and `{ ...[a, b] }` is `{ 0: a, 1: b }`, the same corruption one shape
 * over.
 *
 * The executable form of all three rows is `METADATA_ROUNDTRIP_CASES`
 * (`@objectstack/spec/contracts`) replayed by
 * `packages/objectql/src/metadata-service-roundtrip-conformance.test.ts`.
 */

// The `/api` import is TYPE-ONLY on purpose — erased at compile time, so this
// module makes no runtime demand on that subpath. This module is loaded by
// every consumer of `@objectstack/core`, and several packages' vitest configs
// alias the bare `@objectstack/spec` specifier to `spec/src/index.ts` (a FILE)
// with per-subpath entries spelled out above it; an alias list matches by
// PREFIX, so any subpath NOT spelled out resolves under the file and dies with
// ENOTDIR at import time (measured: `@objectstack/plugin-hono-server` and
// `@objectstack/driver-memory`, 39 test files dead at load between them). The
// typed literal below keeps the closed-set compile check without the runtime
// import — the `packages/spec/src/contracts/storage-service.ts` pattern.
// `/shared` cannot get the same treatment: `pluralToSingular` is a runtime
// value and its map has ONE owner (#7378 row 2 — copying it here would be the
// per-implementation folk normalization the ruling forbids), so the consumer
// configs carry a `/shared` alias entry instead.
import type { StandardErrorCode } from '@objectstack/spec/api';
import { pluralToSingular } from '@objectstack/spec/shared';

/** The standard catalog's generic argument-validation code, type-checked against the closed set. */
const REGISTER_REFUSAL_CODE: StandardErrorCode = 'VALIDATION_ERROR';

/**
 * The canonical spelling an `IMetadataService` type store is keyed on
 * (#7378 row 2). Folds a plural manifest spelling to the singular metadata
 * type name (`'objects'` → `'object'`, `'views'` → `'view'`, …) through the
 * platform's one plural↔singular map (`PLURAL_TO_SINGULAR`,
 * `@objectstack/spec/shared`); a name with no plural mapping — which includes
 * every canonical singular type — passes through unchanged.
 */
export function canonicalMetadataServiceType(type: string): string {
    return pluralToSingular(type);
}

/**
 * An ADR-0112-enveloped refusal (`code` + `status` on the error), so a caller
 * — and a rejection-class test — can assert the refusal rather than merely
 * "it threw". `VALIDATION_ERROR` is the standard catalog's generic
 * argument-validation code; the ledger's own guidance is to use the standard
 * catalog rather than register a synonym for a generic condition.
 */
function registerRefusal(message: string): Error & { code: string; status: number } {
    const err = new Error(message) as Error & { code: string; status: number };
    err.code = REGISTER_REFUSAL_CODE;
    err.status = 400;
    return err;
}

/**
 * Enforce rows 1 and 3 of the #7378 ruling on a
 * `register(type, name, data)` payload — call it before the first store write,
 * so a refusal writes nothing anywhere.
 *
 * Refuses, with a locating `VALIDATION_ERROR` (status 400):
 *
 *  - **a non-document `data`** (row 3): anything that is not a plain object —
 *    primitives, `null`, arrays. The contract declares `data: unknown`, so
 *    this is a runtime refusal, not a type error;
 *  - **a `data.name` that disagrees with the `name` argument** (row 1), in
 *    either direction. A document with NO `name` of its own is fine — the
 *    argument is the key, and there is no disagreement to refuse.
 *
 * Deliberately NOT called by `registerInMemory`: that optional member is a
 * boot-time seeding primitive outside the ruled surface (the ruling names
 * `register`), and its callers hand it artefacts whose shape source control
 * owns. It shares the row-2 canonical fold — a store key is a store fact, not
 * a per-member choice — just not the refusals.
 */
export function assertMetadataRegisterContract(
    type: string,
    name: string,
    data: unknown,
): asserts data is Record<string, unknown> {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        const shape = data === null ? 'null' : Array.isArray(data) ? 'an array' : `a ${typeof data}`;
        throw registerRefusal(
            `IMetadataService.register('${type}', '${name}'): data is ${shape}, not a metadata document. ` +
                `register() stores plain-object documents only — accepting a value the service cannot key was measured as ` +
                `accept-then-drop on document-keyed stores (#7378 row 3: refuse loudly, never coerce into storability). ` +
                `Wrap the value in a document object whose shape the '${type}' type's schema accepts, or store it under a type that declares one.`,
        );
    }
    const documentName = (data as { name?: unknown }).name;
    if (documentName !== undefined && documentName !== name) {
        throw registerRefusal(
            `IMetadataService.register('${type}', '${name}'): data.name is '${String(documentName)}', which disagrees with the ` +
                `name argument '${name}'. A disagreement is almost always an authoring bug, and resolving it silently in either ` +
                `direction can file the item under a key the caller never wrote (#7378 row 1: refuse loudly, locate the mismatch). ` +
                `Register under one name: pass the intended key as the argument and make data.name match it, or omit data.name.`,
        );
    }
}
