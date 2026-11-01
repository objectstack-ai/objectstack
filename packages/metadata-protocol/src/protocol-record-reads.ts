// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 4] The record reads of `ObjectStackProtocolImplementation` —
 * the existence check the write doors run before they touch a row
 * (`assertRecordExists`), the optimistic-concurrency checks
 * (`assertVersionOf`, `assertVersionMatch`), the read made as the calling
 * principal (`readAsCaller`), the cross-object search (`searchAll`) and the
 * write-response strip (`omitInternalWriteFields`) — moved out of
 * `protocol.ts` whole. Two neighbours stay in the class. `probeRecord`, the
 * system-context existence probe between them: its engine call is one of the
 * query-options erasures `scripts/query-options-erasure-baseline.json`
 * grandfathers BY FILE, and that list only ever shrinks, so the site cannot
 * change files unedited. And `getMetaItemCached`: the #9157 pin in
 * `protocol.read-verb-canonical-fold.test.ts` derives the `/meta` verbs that
 * must fold their `type` from the method bodies in `protocol.ts` itself, so
 * its body stays where that pin reads it.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, made as the
 * same principal, refusing exactly where they did with the same codes and
 * messages. The module-level declarations only these bodies read (the OCC
 * version-token reading) moved with them, also unedited. One body has changed
 * since: `assertVersionOf`'s mismatch branch now hands a row the caller's own
 * read does not return to the write door instead of answering it (its
 * docblock in `protocol.ts` says why).
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link RecordReadHost} members that method reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the protocol
 * at call time, so a test double or spy set on the instance is still the one
 * the body reaches, and the moved bodies that call one another do so through
 * the protocol, exactly as before.
 *
 * The fields the bodies read go as GETTERS, so each read happens when the
 * body makes it: tests replace them on a constructed protocol.
 *
 * The other module-level declarations the bodies read stay in `protocol.ts`,
 * where code that did not move reads them too, and are imported from there:
 * the module cycle is evaluation-safe because every one of them is read only
 * inside a function body, never while the two modules are first evaluated.
 * `index.ts` names what it publishes from `protocol.ts` one by one, so the
 * `export` they gained for this keeps them off the published surface, and
 * nothing re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { ConcurrentUpdateError, MalformedVersionTokenError, canonicalVersionInstant } from './protocol.js';
import { recordNotFoundError } from '@objectstack/core';
import { declaredHttpStatus } from '@objectstack/types';
import { collectInternalWriteResponseFields, omitInternalFieldsFromWriteResponse } from './write-response-internal-fields.js';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { canServeApiOperation, resolveSearchFieldResolution } from '@objectstack/spec/data';
import type { EngineQueryOptionsParsed } from '@objectstack/spec/data';
import type { ISecurityService } from '@objectstack/spec/contracts';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import type { I18nLabel } from '@objectstack/spec/ui';

/**
 * [#13576] Guard for the CLIENT-SUPPLIED half of an OCC token — never call
 * this on `current.updated_at`, which is server-computed and must keep its
 * existing "no check" fallback on any falsy normalisation.
 *
 * Detects exactly the RFC-7232 quoted-empty shape (`""`, any surrounding
 * whitespace) and nothing wider: the raw value denotes SOMETHING (it is
 * non-empty once trimmed — the "no token at all" cases, `undefined`/`null`/
 * `''`/whitespace-only, are unaffected and keep opting out of the guard, per
 * the ruling's clause ②), yet {@link normaliseVersionToken} reduces it to
 * nothing. That combination — "the caller supplied a token" AND "it
 * normalises to no token" — has exactly one source in
 * {@link normaliseVersionToken}'s body: the post-quote-strip emptiness check.
 * A garbage-but-nonempty token (`v2`) normalises to a REAL (if opaque) token,
 * so it never matches this predicate and keeps failing toward 409 unchanged.
 */
function assertVersionTokenNotMalformed(expectedVersion: string | undefined): void {
    if (expectedVersion === null || expectedVersion === undefined) return;
    const raw = String(expectedVersion).trim();
    if (!raw) return; // no token at all — unaffected, stays "opt out of the guard"
    if (normaliseVersionToken(expectedVersion) !== null) return; // a real, comparable token
    throw new MalformedVersionTokenError();
}

/**
 * A version token read into the two forms the OCC comparison may need.
 *
 * `token` is the tidied verbatim string — the whole normalisation this seam used
 * to do. `instant` is the canonical absolute-instant spelling, present only when
 * the token really denotes one.
 */
interface NormalisedVersion {
    /** The token as compared verbatim: trimmed, RFC-7232 quotes stripped. */
    readonly token: string;
    /** Canonical ISO-8601 UTC (`…Z`), or null when the token is opaque. */
    readonly instant: string | null;
}

/**
 * Reads a version token into the forms `assertVersionOf` compares. Strips
 * RFC-7232-style quotes (`"…"`) that an HTTP `If-Match` header may carry, trims
 * whitespace, and returns null for empty / nullish input — a null is the
 * caller's "no token supplied", which opts out of the check.
 *
 * [#13576] This function's OWN contract is deliberately unchanged: `""` still
 * normalises to null here, exactly as #13382 left it (see the load-bearing
 * comment on the post-strip check below) — that is what keeps this a pure,
 * side-effect-free reader that the SERVER-COMPUTED `current.updated_at` call
 * can keep using with its "no check" fallback. The client-facing call sites
 * (`assertVersionOf`, `assertVersionMatch`) now call
 * {@link assertVersionTokenNotMalformed} FIRST, which distinguishes "caller
 * sent nothing" (stays opted out) from "caller sent the quoted-empty tag"
 * (throws 400) before either ever reaches this function's uniform null.
 *
 * ## Why this returns two forms rather than one string (#13382)
 *
 * It used to return `String(v).trim()` alone, and the two sides of the OCC
 * comparison do not agree on how to spell one instant. On Postgres the record's
 * `updated_at` arrives as a JS `Date`, whose `String()` is
 * `"Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)"` — **milliseconds
 * dropped and the process timezone baked in** — while the client echoes back
 * the `"2026-08-30T10:19:25.947Z"` the GET served it. One instant, two
 * spellings, strict string compare: every guarded save on the production
 * default driver answered `409 CONCURRENT_UPDATE`, on records nobody had ever
 * touched. SQLite stores and returns ISO text, so both sides matched by
 * accident and the defect never surfaced in development.
 *
 * So the comparison normalises to ONE representation before comparing — a
 * canonical absolute instant — and falls back to the verbatim token when either
 * side is not an instant. That fallback is what makes the change **strictly
 * widening**: any pair that matched before still matches (their verbatim
 * strings were equal, so they either canonicalise equally or are compared as
 * strings again), so no token a client sends today starts being refused —
 * including a client still echoing a pre-fix 409's `Date.toString()` value.
 * Only pairs denoting the same instant in different spellings change verdict,
 * from conflict to match, which is the defect.
 */
function normaliseVersionToken(v: unknown): NormalisedVersion | null {
    if (v === null || v === undefined) return null;
    let token = String(v).trim();
    if (!token) return null;
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
        token = token.slice(1, -1);
        // ⚠️ The emptiness test runs on BOTH sides of the strip, and the second
        // one is load-bearing: `If-Match: ""` is empty only once the RFC-7232
        // quotes come off. Before this seam returned an object it returned the
        // bare string, so that case handed every caller the falsy `''` and they
        // short-circuited into "no token supplied" — the opt-out was riding
        // implicitly on the empty string's falsiness. An object is always
        // truthy, so without this line an empty entity-tag would stop skipping
        // the check and start earning a 409: an accept-to-refuse flip on a
        // shipped API, which is precisely what this change promises not to do.
        if (!token) return null;
    }
    return { token, instant: canonicalVersionInstant(v, token) };
}

/**
 * Do two version tokens name the same record version?
 *
 * Instants are compared as instants — that is the repair. When either side is
 * opaque the tokens are compared verbatim, which is what this seam has always
 * done and what keeps an opaque host-stamped version working.
 */
function versionTokensAgree(current: NormalisedVersion, expected: NormalisedVersion): boolean {
    if (current.instant !== null && expected.instant !== null) {
        return current.instant === expected.instant;
    }
    return current.token === expected.token;
}

/**
 * Did the caller's own read of a row REFUSE, rather than fault? A refusal
 * declares a client-band status (`4xx`, in either spelling
 * `declaredHttpStatus` reads) — the read door's verdict on this caller, which
 * says nothing about the row. A server-band status, or none at all (a bare
 * driver `Error`), is a fault, and the OCC comparison lets it propagate as
 * raised rather than read it as "the caller reads no row".
 */
function isCallerReadRefusal(e: unknown): boolean {
    const status = declaredHttpStatus(e);
    return status !== undefined && status < 500;
}

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface RecordReadHost {
    assertVersionOf: ObjectStackProtocolImplementation['assertVersionOf'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    getMetaItems: ObjectStackProtocolImplementation['getMetaItems'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    probeRecord: ObjectStackProtocolImplementation['probeRecord'];
    readAsCaller: ObjectStackProtocolImplementation['readAsCaller'];
}

/** The body of `ObjectStackProtocolImplementation#omitInternalWriteFields`; the method's docblock there is its contract. */
export function omitInternalWriteFields(
    this: Pick<RecordReadHost, 'engine'>,
    object: string, records: unknown): void {
    omitInternalFieldsFromWriteResponse(this.engine.registry?.getObject(object), records);
}

/** The body of `ObjectStackProtocolImplementation#assertRecordExists`; the method's docblock there is its contract. */
export async function assertRecordExists(
    this: Pick<RecordReadHost, 'probeRecord'>,
    object: string, id: string): Promise<void> {
    const current = await this.probeRecord(object, id);
    if (!current) throw recordNotFoundError(object, id);
}

/** The body of `ObjectStackProtocolImplementation#assertVersionOf`; the method's docblock there is its contract. */
export async function assertVersionOf(
    this: Pick<RecordReadHost, 'readAsCaller'>,
    object: string,
    id: string,
    current: any,
    expectedVersion: string | undefined,
    context: EngineQueryOptionsParsed['context'],
): Promise<void> {
    assertVersionTokenNotMalformed(expectedVersion);
    const expected = normaliseVersionToken(expectedVersion);
    if (!expected) return;
    if (!current) return;
    const currentToken = normaliseVersionToken((current as any).updated_at);
    if (!currentToken) return;
    if (!versionTokensAgree(currentToken, expected)) {
        // Publish the CANONICAL spelling, not `String(updated_at)` (#13382).
        // Two reasons, and the second is not optional: it is what
        // `content/docs/api/wire-format.mdx` documents this field to be, and
        // it is the token the client echoes back as its next `If-Match` when
        // the user chooses "Overwrite anyway" — so a 409 whose
        // `currentVersion` is a `Date.toString()` (milliseconds already
        // dropped) hands the client a token that can never match the record
        // it names, turning a resolvable conflict into an unresolvable one.
        const currentVersion = currentToken.instant ?? currentToken.token;
        const expectedVersionText = expected.instant ?? expected.token;
        // A row the caller's own read does not return — absent, or the read
        // refused — is no conflict this gate may report, and no answer of its
        // own either: the comparison is dropped and the write door answers,
        // exactly as it answers the same request without a token. The
        // method's docblock in `protocol.ts` carries the reasoning.
        let visible: unknown;
        try {
            visible = await this.readAsCaller(object, id, context);
        } catch (e) {
            if (!isCallerReadRefusal(e)) throw e;
            return;
        }
        if (!visible) return;
        throw new ConcurrentUpdateError({
            currentVersion,
            currentRecord: visible,
            message: `Record ${object}/${id} was modified by another user (current version ${currentVersion}, expected ${expectedVersionText})`,
        });
    }
}

/** The body of `ObjectStackProtocolImplementation#assertVersionMatch`; the method's docblock there is its contract. */
export async function assertVersionMatch(
    this: Pick<RecordReadHost, 'assertVersionOf' | 'probeRecord'>,
    object: string,
    id: string,
    expectedVersion: string | undefined,
    context: EngineQueryOptionsParsed['context'],
): Promise<void> {
    assertVersionTokenNotMalformed(expectedVersion);
    if (!normaliseVersionToken(expectedVersion)) return;
    const current = await this.probeRecord(object, id);
    await this.assertVersionOf(object, id, current, expectedVersion, context);
}

/** The body of `ObjectStackProtocolImplementation#readAsCaller`; the method's docblock there is its contract. */
export async function readAsCaller(
    this: Pick<RecordReadHost, 'engine'>,
    object: string, id: string, context: EngineQueryOptionsParsed['context']): Promise<any> {
    const opts: EngineQueryOptionsParsed = { where: { id } };
    if (context !== undefined) opts.context = context;
    return this.engine.findOne(object, opts);
}

/** The body of `ObjectStackProtocolImplementation#searchAll`; the method's docblock there is its contract. */
export async function searchAll(
    this: Pick<RecordReadHost, 'engine' | 'getMetaItems' | 'getServicesRegistry'>,
    request: {
    q: string;
    objects?: string[];
    limit?: number;
    perObject?: number;
    context?: any;
}): Promise<{
    query: string;
    hits: Array<{
        object: string;
        id: string;
        title: string;
        snippet?: string;
        record: any;
    }>;
    pages: Array<{
        kind: 'page';
        name: string;
        title: string;
        snippet?: string;
        pageType?: string;
    }>;
    totalObjects: number;
    totalHits: number;
    truncated: boolean;
}> {
    const q = (request.q ?? '').trim();
    if (!q) {
        return { query: '', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false };
    }

    const overallLimit = Math.max(1, Math.min(100, Number(request.limit ?? 20)));
    const perObject = Math.max(1, Math.min(25, Number(request.perObject ?? 5)));
    const objectsFilter = request.objects && request.objects.length
        ? new Set(request.objects)
        : null;

    // [#7643] SNIPPET tokens only, for the RECORD sweep. The engine does
    // its own tokenisation inside the `$search` expansion (same split,
    // same AND-of-terms rule), so these no longer decide what MATCHES on
    // records — they decide where the excerpt is cut. Kept as a separate
    // local rather than fed to the engine: the query text is what the
    // contract carries, and a second pre-tokenised channel is exactly the
    // divergence this card closed. [#13216] `allTerms` (uncapped) is what
    // the PAGE sweep matches on — pages are metadata, not engine rows, so
    // there is no expansion to delegate to, and matching on the capped
    // list would silently drop terms 9+ from the page predicate while the
    // engine still ANDs them for records.
    const allTerms = q.split(/\s+/).filter(Boolean);
    const terms = allTerms.slice(0, 8);

    // One producer of excerpt geometry, shared by record and page hits
    // (#13216): the first term literally contained in `v` anchors a cut of
    // 30 chars before / 90 after, ellipsized at whichever ends truncate.
    const cutExcerpt = (v: string, excerptTerms: string[]): string | undefined => {
        const lc = v.toLowerCase();
        const idx = excerptTerms.map(t => lc.indexOf(t.toLowerCase())).find(i => i >= 0);
        if (idx == null || idx < 0) return undefined;
        const start = Math.max(0, idx - 30);
        const end = Math.min(v.length, idx + 90);
        return (start > 0 ? '…' : '') + v.slice(start, end) + (end < v.length ? '…' : '');
    };

    // [#11754] No `?.` and no `?? []` on this read. The invented empty
    // list made the whole sweep a silent no-op — zero hits,
    // `objectsScanned: 0`, and a successful response — for a host whose
    // registry cannot enumerate at all. `SchemaRegistry.getAllObjects()`
    // walks in-memory Maps and has no throwing path, so what the guards
    // absorbed was only the STRUCTURAL omission (a registry without the
    // method), which never throws and is therefore invisible by
    // construction. A registry that cannot enumerate its objects is
    // never truthfully "no objects" (ADR-0110 D3) — the omission
    // propagates, the same disposition as the engine's own registry
    // sweeps (#9284). `registry` is a declared member of
    // `MetadataHostEngine`, so the cast went with the guards.
    const allObjects = this.engine.registry.getAllObjects();
    const hits: Array<{ object: string; id: string; title: string; snippet?: string; record: any }> = [];
    let objectsScanned = 0;

    // The caller's read admission, asked of the same authority the engine
    // middleware enforces (see the method doc): `canReadObject` for the
    // object, `getQueryableFields` for the fields the search may match on.
    // Only a caller that carries a context is asked about: a context-less
    // in-process call reaches `find` without one, so asking on its behalf
    // would answer a question its reads never pose. No security service,
    // or one without a method, means no pre-filter on that axis — `find`
    // still enforces both, so the absence can only make the answer
    // stricter (a denial propagates, as before), never wider. That is also
    // why an `undefined` ("no answer") from `getQueryableFields` narrows
    // nothing here: this sweep never bypasses the middleware's guards.
    const securityService = request.context !== undefined
        ? this.getServicesRegistry?.().get('security') as Partial<ISecurityService> | undefined
        : undefined;
    const canReadObject = typeof securityService?.canReadObject === 'function'
        ? (object: string) => securityService.canReadObject!(object, request.context)
        : undefined;
    const getQueryableFields = typeof securityService?.getQueryableFields === 'function'
        ? (object: string) => securityService.getQueryableFields!(object, request.context)
        : undefined;

    for (const obj of allObjects) {
        if (hits.length >= overallLimit) break;
        if (!obj?.name) continue;
        if (objectsFilter && !objectsFilter.has(obj.name)) continue;

        // [#22640] The object's declared exposure, asked of the ONE decision
        // every door judges (`canServeApiOperation`, ADR-0049) for the
        // `search` operation. See the method doc. Asked first, so a refused
        // object is never queried, named or counted.
        if (!canServeApiOperation(obj.enable, 'search')) continue;
        // `searchable: false` keeps its own meaning beside the decision, and
        // only because the decision does not cover it everywhere: it answers
        // an object with NO whitelist (`unrestricted`) without reading the
        // flag, which the derivation table folds into `search` only under a
        // whitelist. So this is the opt-out for such an object, not a second
        // exposure rule.
        if (obj.enable?.searchable === false) continue;
        // Skip noisy system tables by name prefix
        if (obj.name.startsWith('sys_audit_log')
            || obj.name.startsWith('sys_activity')
            || obj.name.startsWith('sys_session')
            || obj.name.startsWith('sys_presence')
            || obj.name.startsWith('sys_metadata')
            || obj.name.startsWith('sys_account')) {
            continue;
        }

        const fieldsRaw = obj.fields;
        const fields: Array<{ name: string; type: string; searchable?: boolean }> =
            Array.isArray(fieldsRaw)
                ? fieldsRaw
                : (fieldsRaw && typeof fieldsRaw === 'object'
                    ? Object.entries(fieldsRaw).map(([name, f]: [string, any]) => ({ name, ...(f || {}) }))
                    : []);
        const fieldByName = new Map(fields.map(f => [f.name, f]));
        const hasField = (n: string) => fieldByName.has(n);
        // Resolve title for a record: the declared primary-title pointer →
        // titleFormat → common conventional fields → id. [ADR-0079 D3]
        // `nameField` takes precedence over the deprecated `titleFormat`
        // (the spec's own describe says so), the same order as
        // `resolveDisplayField`, which never consults `titleFormat` at all.
        // The registry's `provisionPrimary` stamps a derived `nameField`
        // at registration, and authorship is not recoverable after that
        // stamp (see `ObjectTitleCompleteness.status`), so a stamped
        // pointer outranks the template too: `titleFormat` titles a row
        // only when the object has no pointer, or its value is empty.
        // titleFormat supports simple `{field}` placeholders (the
        // `template` dialect); unresolved placeholders fall through to the
        // next strategy.
        const titleFormatSource = (obj.titleFormat && (obj.titleFormat.source || obj.titleFormat))
            || undefined;
        // [ADR-0079] `nameField` is the canonical primary-title pointer;
        // `displayNameField` is the deprecated alias (still honored).
        // Reading the alias ALONE made this the one consumer a canonical
        // designation could not reach: `provisionPrimary` — the
        // designation seat the registry runs on every object at
        // registration — stamps `nameField` only
        // (`spec/src/data/display-name.ts`), so an object that declares its
        // title canonically and does not also carry the alias fell through
        // to `String(row.id)` and the palette showed a raw id. Same
        // precedence as `resolveDisplayField`, the #4254 ingress gate, and
        // this function's own search-field resolution below — a fourth
        // spelling here would re-split what those merged.
        const titlePointer = obj.nameField ?? obj.displayNameField;
        const renderTitle = (row: any): string => {
            if (typeof titlePointer === 'string' && hasField(titlePointer)) {
                const v = row[titlePointer];
                if (v != null && String(v).trim()) return String(v);
            }
            if (typeof titleFormatSource === 'string') {
                let allResolved = true;
                const rendered = titleFormatSource.replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key) => {
                    const v = row[key];
                    if (v == null || v === '') { allResolved = false; return ''; }
                    return String(v);
                }).trim();
                if (rendered && allResolved) return rendered;
                if (rendered) return rendered.replace(/\s+-\s+$/, '').replace(/^\s+-\s+/, '').trim() || row.id;
            }
            const candidates = [
                'name', 'full_name', 'title', 'subject', 'label', 'company',
            ].filter(hasField);
            for (const c of candidates) {
                const v = row[c];
                if (v != null && String(v).trim()) return String(v);
            }
            const fn = row.first_name, ln = row.last_name;
            if (fn || ln) return `${fn ?? ''} ${ln ?? ''}`.trim();
            return String(row.id);
        };

        // [#7643] The SAME resolution the engine's `$search` expansion will
        // apply to this object one call down — `@objectstack/spec/data` owns
        // it precisely so the layers that must agree read one function
        // instead of each carrying a copy (#4254 moved it there for the
        // ingress gate; this is the third face). It is consulted here for
        // two things, and NEITHER of them is building the filter:
        //
        //  1. the SKIP below — an object with nothing to scan is passed
        //     over. This is load-bearing, not tidiness: `expandSearchToFilter`
        //     answers an empty field set with `null`, `expandSearchOnAst`
        //     then leaves `where` unset, and a `find` with no `where` returns
        //     the object's FIRST `perObject` rows — a global palette
        //     answering every query with unrelated records. The old code's
        //     equivalent `continue` guarded the same cliff one layer up.
        //  2. the snippet source fields further down, so the excerpt is cut
        //     from a column the search actually scanned.
        //
        // `expandSearchToFilter` itself is deliberately NOT imported: it
        // lives in `@objectstack/objectql`, which DEPENDS on this package,
        // so importing it would close a package cycle. Handing the engine
        // `search` instead of a pre-built `where` routes through it anyway —
        // and leaves ONE producer of search clauses rather than two callers
        // of one helper, which is the stronger form of the same fix.
        //
        // [#24284] …and the cliff in (1) is now a REFUSAL one call down:
        // the engine answers a non-blank term over an empty resolved set
        // with `400 INVALID_FIELD` rather than every row. The skip stays,
        // and it is what keeps the palette `200` — the sweep passes over an
        // object with nothing to scan instead of failing on it, since this
        // method chose the object, not the caller. So the set judged here
        // must be the set the engine resolves: the `internal: true` columns
        // it never scans are left out of it too, through the same flag
        // reader the #22646 ingress gate uses. Without that, an object
        // whose only text column is internal would pass this skip, reach
        // `find`, and fail the whole sweep.
        const internalFields = new Set(collectInternalWriteResponseFields(obj));
        const fieldMetaByName: Record<string, any> = {};
        for (const f of fields) if (f?.name && !internalFields.has(f.name)) fieldMetaByName[f.name] = f;
        const { allowed: declaredSearchFields } = resolveSearchFieldResolution({
            fields: fieldMetaByName,
            searchableFields: obj.searchableFields,
            // [ADR-0079] `nameField` is the canonical primary-title pointer;
            // `displayNameField` is the deprecated alias (still honored).
            // Same precedence as `expandSearchOnAst` and the #4254 gate —
            // a third spelling here would re-split what this card merged.
            displayField: obj.nameField ?? obj.displayNameField,
        });
        if (declaredSearchFields.length === 0) continue;

        // Skip an object the caller may not read — before any query, so
        // nothing about its rows can shape the answer, and before the
        // count, so `totalObjects` covers only what was swept. A throw
        // propagates: an admission that could not be decided fails the
        // search rather than quietly shrinking it.
        if (canReadObject && !(await canReadObject(obj.name))) continue;

        // …and match only on the fields the caller may QUERY. The engine's
        // predicate guard refuses a search whose resolved fields include
        // one hidden from the caller (the filter oracle: row presence would
        // disclose the hidden value), and that 403 failed the whole sweep —
        // `sys_user`'s searchable fields include admin-only columns, so
        // every member's unscoped search hit it. `searchFields` only ever
        // NARROWS the server-resolved set (ADR-0061), so handing the engine
        // the queryable subset searches what the caller could have filtered
        // on themselves through `searchFields`. An object left with no
        // queryable search field is skipped like an unreadable one.
        // An `undefined` answer narrows nothing here: unlike the contract's
        // fallback for consumers without an answer (treat every field with a
        // `maskingRule` as not queryable), this sweep leaves that judgement to
        // the engine's predicate guard on `find`, which can only refuse.
        let searchableFields = declaredSearchFields;
        if (getQueryableFields) {
            const queryable = await getQueryableFields(obj.name);
            if (queryable !== undefined) {
                const allowed = new Set(queryable);
                searchableFields = declaredSearchFields.filter((f) => allowed.has(f));
                if (searchableFields.length === 0) continue;
            }
        }
        const narrowed = searchableFields.length < declaredSearchFields.length;

        objectsScanned++;

        try {
            // `order`, NOT `direction` — see the audit-history query above.
            // Ascending here returned the STALEST `perObject` matches and
            // truncated away the recently-edited records a searcher is most
            // likely to want (#4674). Typed rather than `any` so the
            // contract rejects the wrong key at the call site.
            const opts: EngineQueryOptionsParsed = {
                // [#7643] The bare string IS the ADR-0061 Tier-1 contract
                // ("the client sends only the query text; the server
                // resolves which fields to search from object metadata"),
                // and `search` is a declared `find` option
                // (`EngineQueryOptionsSchema`, `ENGINE_FIND_OPTION_KEYS`) —
                // so this is the engine's published door, not a private one.
                // `searchFields` only when the caller's queryable set is
                // narrower than the declared one (see above): that key only
                // ever NARROWS the resolved set (ADR-0061), and otherwise
                // the palette wants the object's full default reach.
                search: q,
                ...(narrowed ? { searchFields: searchableFields } : {}),
                limit: perObject,
                orderBy: [{ field: 'updated_at', order: 'desc' }],
            };
            if (request.context !== undefined) opts.context = request.context;

            const rows = await this.engine.find(obj.name, opts);
            for (const row of rows || []) {
                if (hits.length >= overallLimit) break;
                const title = renderTitle(row);
                // Build snippet from first searchable field that contains a
                // term. [#7643] `undefined` is a CORRECT answer here, not a
                // miss: a companion (pinyin) hit matches the normalized
                // `__search` blob, so no source column literally contains
                // `hnkj` — the row is a real hit with nothing to excerpt.
                // The companion is never a snippet source itself; it is
                // stripped from rows on the way out (#7642) and its content
                // is machine-normalized text no user typed.
                let snippet: string | undefined;
                for (const f of searchableFields) {
                    const v = row[f];
                    if (typeof v === 'string' && v) {
                        snippet = cutExcerpt(v, terms);
                        if (snippet !== undefined) break;
                    }
                }
                hits.push({
                    object: obj.name,
                    id: row.id,
                    title,
                    snippet,
                    record: row,
                });
            }
        } catch (error) {
            // [#8896] Discriminate by error TYPE. The bare `catch { continue }`
            // this replaces skipped the object on ANY failure while the
            // response below kept reporting `totalObjects`, `totalHits` and
            // `truncated` as though the sweep had been complete — so a
            // caller was handed a partial scan labelled as a whole one, and
            // "not found" was invented for objects that were never read
            // (ADR-0110 D3).
            //
            // Benign: the object is REGISTERED but its table was never
            // provisioned (schema sync not run yet). It can hold no rows, so
            // contributing no hits IS the truth and skipping it is correct —
            // and this case is routine, since the registry lists every
            // declared object whether or not a given deployment provisioned
            // it. Asked through the shared `isMissingTableError` predicate
            // (`@objectstack/metadata/errors`, #4825), never a hand-rolled
            // code test.
            //
            // Everything else propagates: a connection drop, a timeout, a
            // query error or a refused datasource all mean the object's rows
            // may well match and simply were not seen.
            //
            // A permission denial is NOT swallowed here either. The REST
            // door (`enforceAuth`) checks authentication only; the read
            // admission is asked BEFORE this `try`, via the security
            // service's `canReadObject` and `getQueryableFields` (see
            // above), so an object the caller may not read never reaches
            // `find`, and one it may read is searched only on fields it may
            // query. A denial that still arrives here is a verdict those
            // answers did not foresee — a permission subsystem that could
            // not resolve, a delegator that does not exist, a security
            // service without those methods — and the ruling for this
            // family applies to it: a read that could not run must not be
            // answered "there are no matches here". Row-level security
            // narrows `find`'s result set rather than throwing.
            //
            // No new response field and no new error code — the caller
            // receives the read's own failure, envelope intact.
            if (isMissingTableError(error, obj.name)) continue;
            throw error;
        }
    }

    // ── [#13216] Published-page sweep — the palette's page hits ─────────
    //
    // A custom page created and published at runtime renders perfectly and
    // was absent from this door only (#13100 measured it): `searchAll`
    // swept object RECORDS and nothing else, so the artifact an agent just
    // grew into a running app could be reached by direct URL alone.
    //
    // ## The swept set IS the served set — zero new authorization surface
    //
    // Pages are read through {@link getMetaItems} — the SAME verb the REST
    // `GET /meta/page` list door serves — never through a parallel read of
    // the registry or the store. That single decision carries the whole
    // authorization story (the 2026-08-29 ruling's basis, as direction 1
    // established it):
    //
    //  - PUBLISHED only: `getMetaItems` reads `state: 'active'` overlay
    //    rows plus code-registered pages; drafts surface only under
    //    `previewDrafts`, which this sweep never passes.
    //  - Scope: the environment's pages, as every `/meta` read door
    //    answers (ADR-0131 D6: no metadata read is organization-scoped).
    //  - Disabled-package and conversion handling ride along for free —
    //    whatever `getMetaItems` withholds, this sweep never saw.
    //
    // So a page hit surfaces to a caller exactly what `GET /meta/page`
    // already answers that caller — name, label, description — never
    // more, and search is not a second read door. ⚠️ A page has NO audience
    // gate of its own. `page.assignedProfiles` read as one and enforced
    // nothing — no backend consumer on the read door, and none at page
    // render either (measured in objectui: every hit there was a
    // declaration) — so it was removed under ADR-0090 D2 / ADR-0049. The
    // delegation posture this sweep rests on is unaffected: what protects
    // a page is the permission sets on the DATA it shows, and a second
    // enforcement point here would still be a NEW authorization surface,
    // the very thing the ruling's basis excludes.
    //
    // ## Matching and shape
    //
    //  - AND of terms, OR of fields (`name`, every locale value of
    //    `label` / `description`), case-folded — the same term semantics
    //    the engine expansion applies to records, restated here because
    //    metadata is not engine rows and there is no expansion to
    //    delegate to.
    //  - Capped at `perObject`: the page store is swept as one more
    //    container, not competing with records for `limit`.
    //  - SCOPED sweeps skip pages entirely: `?objects=lead` asks for
    //    records of `lead`, and answering pages there would widen a
    //    request the caller deliberately narrowed.
    //  - A failed page read PROPAGATES (#8896's rule one seam over):
    //    `getMetaItems` already discriminates the benign
    //    store-unprovisioned case and raises everything else as a 503, so
    //    this sweep adds no `catch` — a partial scan must not wear a
    //    whole one's answer.
    const pageHits: Array<{ kind: 'page'; name: string; title: string; snippet?: string; pageType?: string }> = [];
    if (!objectsFilter) {
        const served = await this.getMetaItems({ type: 'page' });
        const pageItems: unknown[] = Array.isArray(served) ? served : served.items;
        const localeTexts = (v: unknown): string[] => {
            if (typeof v === 'string') return v ? [v] : [];
            if (v && typeof v === 'object') {
                return Object.values(v).filter((s): s is string => typeof s === 'string' && s !== '');
            }
            return [];
        };
        for (const rawItem of pageItems) {
            if (pageHits.length >= perObject) break;
            const page = rawItem as { name?: unknown; label?: unknown; description?: unknown; type?: unknown } | null;
            if (!page || typeof page.name !== 'string' || !page.name) continue;
            const descTexts = localeTexts(page.description);
            const texts = [page.name.toLowerCase(), ...localeTexts(page.label).map(t => t.toLowerCase()), ...descTexts.map(t => t.toLowerCase())];
            const matched = allTerms.every((t) => {
                const lt = t.toLowerCase();
                return texts.some((x) => x.includes(lt));
            });
            if (!matched) continue;
            // Excerpt from the DESCRIPTION only: a name/label match is
            // already fully visible in the title, so absence is a correct
            // answer there (#7643's rule, restated for metadata).
            let snippet: string | undefined;
            for (const d of descTexts) {
                snippet = cutExcerpt(d, allTerms);
                if (snippet !== undefined) break;
            }
            // Title through the SHARED label resolution (#6765) — the
            // default-locale chain (`en` → any available) rather than a
            // fourth hand-rolled spelling; this route carries no locale.
            const title = resolveI18nLabel(page.label as I18nLabel | undefined, undefined) || page.name;
            pageHits.push({
                kind: 'page',
                name: page.name,
                title,
                ...(snippet !== undefined ? { snippet } : {}),
                ...(typeof page.type === 'string' && page.type ? { pageType: page.type } : {}),
            });
        }
    }

    return {
        query: q,
        hits,
        pages: pageHits,
        totalObjects: objectsScanned,
        totalHits: hits.length,
        truncated: hits.length >= overallLimit,
    };
}
