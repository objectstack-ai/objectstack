// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_setting` — the declared ROW IDENTITY, delivered at runtime (#8629).
 *
 * ## What is broken
 *
 * `platform-objects`' `sys-setting.object.ts` declares the object's row
 * identity as
 *
 * ```ts
 * { fields: ['namespace', 'key', 'scope', 'user_id'], unique: 'organization' }
 * ```
 *
 * and `SqlDriver.syncDeclaredIndexes` materializes it — measured, on real
 * SQLite, from the shipped declaration — as
 *
 * ```text
 * CREATE UNIQUE INDEX uniq_sys_setting_organization_id_namespace_key_scope_user_id
 *   ON sys_setting (COALESCE(organization_id, '__global__'), namespace, key, scope, user_id)
 * ```
 *
 * The organization key part is NULL-safe (ADR-0120 D3). `user_id` is not — and
 * `user_id` is NULL on every row that is not `scope='user'`, because
 * `SettingsService.set` computes it as `scope === 'user' ? ctx.userId ?? null :
 * null`. SQL UNIQUE treats NULLs as mutually DISTINCT, so the declared row
 * identity is **void on the `tenant` and `global` limbs** — exactly the two that
 * carry organization-level and platform-level configuration. Measured on a real
 * driver before this module existed:
 *
 * ```text
 * scope='tenant', user_id NULL, SAME organization, same (namespace, key)
 *   insert once  → ok
 *   insert again → ok          ← row identity void
 * scope='global', user_id NULL
 *   insert once / insert again → ok, ok    ← two competing platform defaults
 * control — the same rows with a NON-NULL user_id
 *   insert once / insert again → ok, UNIQUE constraint failed
 * ```
 *
 * The control identifies the mechanism: it is the NULL, not the `scope` value.
 * `SettingsService` then resolves a layer with a positional
 * `rows.find(r => r.scope === 'tenant')` and `set()` upserts against
 * `{ namespace, key, scope, user_id }`, so which value an organization gets is
 * unspecified and two rows can disagree indefinitely — on live keys such as
 * `lifecycle.retention_overrides`, which reaches real retention behaviour.
 *
 * ## Why THIS route (maintainer ruling, 2026-08-14)
 *
 * Two routes were recorded on the card: this one — a runtime NULL-safe unique
 * index, the #6417 / PR #6666 paradigm — or extending the declared vocabulary so
 * an author can mark a listed column NULL-safe. The ruling is **Route 1 now**,
 * with the vocabulary route deferred to v18 as the ADR-class long-term form. So
 * this module is deliberately the third instance of a paradigm, not a new one:
 * `overlay-index.ts` and `view-definition-active-index.ts` are its two
 * precedents and it borrows their order, their vocabulary and their reporting
 * contract rather than inventing a variant.
 *
 * ## Why the index REUSES the declared name
 *
 * `syncDeclaredIndexes` skips by name (`if (existing.has(name)) continue`), so
 * claiming {@link SYS_SETTING_IDENTITY_INDEX_NAME} — the name the driver's own
 * `buildIndexName` derives from the declaration — is what makes the fix durable:
 * every later boot sees the slot filled and never re-imposes the NULL-distinct
 * form. Measured on real SQLite: after this migration runs, a second
 * `initObjects` over the same database leaves the tightened definition byte
 * for byte.
 *
 * A differently-named index would be silently undone on the next boot, and
 * dropping the declaration instead would leave drivers that never run this
 * migration with no uniqueness at all — the declaration is the fallback shape.
 *
 * ## Why the drift differ does not fight it back
 *
 * `schema-drift.ts` reconciles a physical index against its declaration, and a
 * name-collision with a definition it did not expect is normally reported as
 * drift with a `recreate_index` remedy — which here would DROP the tightened
 * index and rebuild the NULL-distinct one. It does not, and the reason is
 * structural rather than lucky: `isSyncReproducibleIndex` admits exactly ONE
 * expression key part, `COALESCE(<tenantField>, …)`. This index carries a second
 * one over `user_id`, a non-tenant column, so the index is not sync-reproducible
 * → `isRuntimeManagedIndex` is true → the differ skips it, the same way it skips
 * `idx_sys_metadata_overlay_active`. Measured: `detectManagedDrift()` returns
 * `[]` both immediately after this migration and after a subsequent boot's
 * additive sync.
 *
 * ## The KEY, and why each sentinel is copied rather than chosen
 *
 * Both spellings already exist in this repo; neither is invented here.
 *
 * - `organization_id` → `'__global__'`. ADR-0120 D3's exact form for a tenant
 *   column, and the literal `SqlDriver`'s `GLOBAL_TENANT` /
 *   `organizationKeyPartSql` materializes. It is reproduced (not imported)
 *   because this package must not depend on a driver — so the literal is pinned
 *   by the sibling test, and a silent edit here cannot re-partition the index.
 *   ⚠️ Reproducing it is also what keeps this a pure tightening of the SHIPPED
 *   index rather than a re-keying of it: change this literal and the platform
 *   bucket moves.
 * - `user_id` → `''`. The `ensureOverlayIndex` precedent for a NON-tenant
 *   nullable discriminator (`COALESCE(package_id, '')`), whose comment states
 *   this same NULL-distinct reason. A user id is never the empty string, so the
 *   bucket cannot collide with real data.
 *
 * ⚠️ Storage is NOT touched: the row keeps its NULL, only the INDEX folds it.
 * `WHERE user_id = ''` matches nothing, by design (ADR-0120 D3's invariant).
 *
 * The key COLUMNS are the driver's own normalized order — the tenant column
 * prepended to the declared fields — because an index over a different key order
 * is a different constraint, and this one has to be the declaration's.
 *
 * ## Refuse-to-migrate, never keep-newest (maintainer ruling, 2026-08-14)
 *
 * This is a TIGHTENING, so unlike #8555's relaxation it can fail to build on an
 * installation that has already accumulated the duplicates the void constraint
 * permitted. The ruling on those rows is explicit: **refuse to migrate and list
 * the duplicates for the operator** — never a deterministic keep-one rule,
 * because settings rows are admin-authored configuration and silently
 * discarding one is a data-loss trade not worth saving a manual confirmation.
 *
 * Nothing in this module deletes, rewrites or reorders a row. The refusal is
 * delivered by `partial-index-probe.ts`'s probe-first order — build under a
 * throwaway name first, and only once that has demonstrably succeeded drop the
 * real name and rebuild it — so a conflict leaves the PREVIOUS index in place
 * and the table never spends a moment unprotected. The operator then gets
 * ADR-0120 D4's full disposition in one `error` line: the key that is not
 * enforced, the consequence, and the exact query that lists the offending rows
 * ({@link buildSysSettingDuplicateProbeSql}) so the list does not depend on
 * reaching for `os migrate plan` first.
 *
 * ## Why it probes for the TABLE first
 *
 * `sys_setting` is registered by `service-settings`, an OPTIONAL service, while
 * this migration is armed from the metadata protocol's assembly — so a perfectly
 * ordinary kernel can reach `kernel:ready` with no such table. Issuing DDL at it
 * blind would classify `no such table` as `failed` and log an `error` about a
 * table the deployment never asked for, which is how a real degradation report
 * gets trained out of being read. {@link buildSysSettingPresenceSql} asks first,
 * and its absence is a silent no-op rather than a finding.
 */

import {
    logProblem,
    probeThenReplaceIndex,
    resolveIndexExecForTable,
    type IndexExec,
    type IndexMigrationLogger,
    type PartialIndexStatus,
} from './partial-index-probe.js';

/** The one table this migration touches. */
export const SYS_SETTING_TABLE = 'sys_setting';

/**
 * The index name — deliberately the SAME one `SqlDriver.syncDeclaredIndexes`
 * derives for `sys-setting.object.ts`'s declaration, so the additive sync treats
 * the slot as filled forever after. Measured against the real driver, not
 * assembled from the naming rule.
 *
 * It is exactly 60 characters, which `driver-sql`'s own suite pins as sitting on
 * the `INDEX_NAME_MAX` boundary: one more character anywhere in it and the
 * driver would emit a sha1-suffixed truncation instead, and this constant would
 * silently stop naming the declared index.
 */
export const SYS_SETTING_IDENTITY_INDEX_NAME =
    'uniq_sys_setting_organization_id_namespace_key_scope_user_id';

/**
 * Throwaway name used to prove the NULL-safe form is possible before dropping
 * anything.
 *
 * ⚠️ Deliberately NOT the declared name plus a suffix, which is how both sibling
 * migrations spell theirs. Their declared names leave room; this one is already
 * on the 60-character boundary, so `…_probe` would be 66 — over PostgreSQL's
 * 63-byte identifier limit (silently truncated) and over MySQL's 64 (error
 * 1059, which the failure classifier would read as neither a dialect refusal nor
 * a conflict). A short, independent name has no such edge.
 */
export const SYS_SETTING_IDENTITY_PROBE_INDEX_NAME = 'idx_sys_setting_identity_probe';

/**
 * The index's key COLUMNS, in the driver's own normalized key order: the tenant
 * column prepended to the four the declaration lists (ADR-0120 D1/D3). What
 * #8629 changes is how ONE of them is SPELLED — see
 * {@link SYS_SETTING_NULL_SENTINELS}.
 */
export const SYS_SETTING_IDENTITY_INDEX_COLUMNS = [
    'organization_id',
    'namespace',
    'key',
    'scope',
    'user_id',
] as const;

/**
 * The nullable key columns and the sentinel each one's NULL folds to.
 *
 * A column listed here is materialized as `COALESCE(<column>, '<sentinel>')` so
 * its NULL rows form ONE bucket that is unique among itself, instead of being
 * mutually DISTINCT and therefore unconstrained. Both spellings are copied from
 * an existing in-repo precedent — see the module header for which, and why
 * neither may be edited casually.
 *
 * `namespace`, `key` and `scope` are required and take no sentinel.
 */
export const SYS_SETTING_NULL_SENTINELS: Readonly<Record<string, string>> = {
    organization_id: '__global__',
    user_id: '',
};

/**
 * How ONE identifier is spelled.
 *
 * Every statement this module *executes* uses {@link BARE} — the platform's own
 * spelling, which SQLite and PostgreSQL take verbatim. {@link MYSQL_IDENT} is
 * the single dialect-specific alternative, and it is used only where the reader
 * is known to be MySQL: the `unsupported` arm's operator query (#9434).
 */
type IdentifierQuote = (name: string) => string;

/** Identifiers exactly as declared. What every executed statement here emits. */
const BARE: IdentifierQuote = (name) => name;

/**
 * MySQL's identifier quote — backticks, with an embedded backtick doubled.
 *
 * Deliberately NOT the ANSI `"name"`: MySQL does not run with `ANSI_QUOTES`, so
 * `"name"` there is a STRING LITERAL and not an identifier at all. Measured on
 * a live MySQL 8.0.46 by #9381, whose `quoteIdent` in `seed-tenancy-backfill.ts`
 * this mirrors on purpose — that sibling shipped the ANSI spelling and every one
 * of its statements came back `ER_PARSE_ERROR`.
 *
 * ⚠️ It quotes EVERY identifier handed to it, never only the ones that look
 * reserved. That is #9381's other recorded lesson (its `last_value` was reserved
 * and unquoted while the table beside it was quoted), and it is why this module
 * carries no list of MySQL's reserved words: such a list is version-dependent —
 * MySQL adds reserved words in point releases — and being wrong about a single
 * entry reinstates the whole defect. Quoting everything cannot be wrong about a
 * word, and costs the operator nothing but backticks.
 */
const MYSQL_IDENT: IdentifierQuote = (name) => `\`${name.replace(/`/g, '``')}\``;

/** {@link sysSettingIdentityKeyParts}, in a chosen identifier spelling. */
function keyPartsIn(quote: IdentifierQuote): string[] {
    return SYS_SETTING_IDENTITY_INDEX_COLUMNS.map((column) => {
        const sentinel = SYS_SETTING_NULL_SENTINELS[column];
        const ident = quote(column);
        return sentinel === undefined ? ident : `COALESCE(${ident}, '${sentinel}')`;
    });
}

/**
 * The index's key parts, in key order: a bare column, or its NULL-safe
 * `COALESCE` form when {@link SYS_SETTING_NULL_SENTINELS} names one.
 *
 * One builder so the CREATE, the duplicate-listing query the conflict report
 * ships, and the degradation messages can never describe different keys — and,
 * since #9434, so the MySQL-spelled operator query cannot describe a different
 * key either: it is this same array under a different quote.
 */
export function sysSettingIdentityKeyParts(): string[] {
    return keyPartsIn(BARE);
}

/**
 * `CREATE UNIQUE INDEX … ` under the given name, over the NULL-safe key parts.
 *
 * Unrestricted — no `WHERE`. Unlike both sibling migrations this index is not
 * scoped to a subset of rows: `sys_setting` has no lifecycle column and the
 * declaration means every row.
 *
 * Identifiers are bare, as in both precedents. ⚠️ `key` is a RESERVED word in
 * MySQL (it is non-reserved in PostgreSQL and not a keyword at all in SQLite),
 * which is one more reason MySQL takes the degradation path here — it already
 * rejects the unparenthesized `COALESCE` key parts, and has no
 * `DROP INDEX IF EXISTS`. Quoting would not change that verdict, and each
 * dialect spells the quote differently.
 */
export function buildSysSettingIdentityIndexSql(indexName: string): string {
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ` +
        `ON ${SYS_SETTING_TABLE} (${sysSettingIdentityKeyParts().join(', ')})`
    );
}

/**
 * The cheapest statement that answers "does this table exist here?" without
 * writing anything or reading a row. See the module header for why the question
 * has to be asked at all.
 */
export function buildSysSettingPresenceSql(): string {
    return `SELECT 1 FROM ${SYS_SETTING_TABLE} WHERE 1 = 0`;
}

/**
 * The query that lists the rows blocking the tightening — ADR-0120 D4's "name
 * the offending rows", shipped inside the conflict report so an operator has the
 * list from the boot log, without waiting for `os migrate plan`.
 *
 * It GROUPs by exactly the index's own key parts, so what it reports and what
 * the index rejects cannot diverge — the projection and the `GROUP BY` are built
 * from the SAME array, so they cannot drift apart either.
 *
 * ⚠️ Each folded column is projected through its OWN `COALESCE` (aliased
 * `<column>_key`), never bare. The three constructs are ANSI, but a query that
 * projects a bare column while grouping by that column only INSIDE an expression
 * is not: PostgreSQL requires every non-aggregated projection to appear verbatim
 * in `GROUP BY` and rejects the bare form. SQLite accepts it, which is how the
 * sibling migration shipped this broken once (#6772) — and PostgreSQL is one of
 * exactly TWO dialects that can build the index this query explains, so it must
 * be legal on both, not on the lenient one.
 *
 * Folding costs the operator nothing: neither sentinel can occur in real data,
 * so `organization_id_key = '__global__'` reads as "organization_id IS NULL" and
 * `user_id_key = ''` as "user_id IS NULL".
 */
export function buildSysSettingDuplicateProbeSql(): string {
    return duplicateProbeSqlIn(BARE);
}

/**
 * The SAME query, spelled for MySQL — for the one arm whose reader is a MySQL
 * operator and whose server rejects the bare form (#9434).
 *
 * ## Why a second spelling exists at all
 *
 * `key` is a RESERVED word on MySQL, so the bare statement above is not a
 * degraded-but-usable query there — it is `ERROR 1064`, measured on MySQL
 * 8.0.46. The `unsupported` arm is reached *specifically* on MySQL/MariaDB —
 * `classifyIndexFailure`'s dialect arm in `partial-index-probe.ts` stands for
 * exactly the two refusals MySQL raises — so the one remedy that arm offered was
 * a statement its only audience could not run: the operator is told to watch for
 * duplicates and handed a parse error to do it with.
 *
 * ## Why a variant, and not a dialect threaded through the migration
 *
 * Because nothing executes this string. `ensureSysSettingIdentityIndex` takes a
 * bare {@link IndexExec} and has no dialect in hand; giving it one — the route
 * the sibling `seed-tenancy-backfill.ts` had to take, because its statements
 * really do run — would be a new seam through a boot hook, paid for a piece of
 * text the platform prints. The `unsupported` arm already knows its dialect by
 * construction, which is what makes the cheap answer the correct one here
 * (triage adjudication, 2026-08-18).
 *
 * ⚠️ This does NOT extend to {@link buildSysSettingIdentityIndexSql}. That
 * statement's verdict — MySQL refuses it whatever the quoting, for the
 * unparenthesized functional key parts — is unchanged and still stated at its
 * own definition. Quoting rescues the `SELECT`, which MySQL can otherwise run;
 * it rescues nothing about the `CREATE`.
 *
 * ## What stays in the platform's own spelling
 *
 * Only the copy-pasteable STATEMENT is compiled for MySQL. The prose around it
 * keeps naming the table, the columns and the key parts the way the platform
 * declares them — that text is a description of the schema, not something an
 * operator pastes into a client, and re-spelling it per dialect would make the
 * four degradation messages in this module disagree about what the table is
 * called. Executable text is dialect-compiled; prose naming things is not.
 */
export function buildSysSettingDuplicateProbeSqlMysql(): string {
    return duplicateProbeSqlIn(MYSQL_IDENT);
}

/**
 * The duplicate-listing query in a chosen identifier spelling.
 *
 * ONE body, so the two spellings cannot drift into describing different keys —
 * the same reason the projection and the `GROUP BY` are built from one array.
 */
function duplicateProbeSqlIn(quote: IdentifierQuote): string {
    const keyParts = keyPartsIn(quote);
    const projected = SYS_SETTING_IDENTITY_INDEX_COLUMNS.map((column, i) => {
        const keyPart = keyParts[i]!;
        return keyPart === quote(column) ? keyPart : `${keyPart} AS ${quote(`${column}_key`)}`;
    });
    return (
        `SELECT ${projected.join(', ')}, COUNT(*) AS ${quote('duplicate_rows')} ` +
        `FROM ${quote(SYS_SETTING_TABLE)} ` +
        `GROUP BY ${keyParts.join(', ')} HAVING COUNT(*) > 1`
    );
}

/**
 * This migration's status vocabulary: the shared one, plus the composition fact
 * only this table has.
 *
 * `'absent'` — no `sys_setting` table on this kernel, because the optional
 * service that registers it is not composed. A no-op, and deliberately NOT a
 * degradation: nothing was supposed to run.
 */
export type EnsureSysSettingIndexStatus = PartialIndexStatus | 'absent';

export interface EnsureSysSettingIndexResult {
    status: EnsureSysSettingIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
}

/** @see IndexMigrationLogger */
export type EnsureSysSettingIndexLogger = IndexMigrationLogger;

/** Resolve a raw-SQL seam for `sys_setting`. @see resolveIndexExecForTable */
export function resolveSysSettingIndexExec(engine: unknown): IndexExec | undefined {
    return resolveIndexExecForTable(engine, SYS_SETTING_TABLE);
}

/**
 * Is `sys_setting` present on the other end of this seam?
 *
 * A thrown error is read as "not present". That is wider than absence strictly
 * warrants — a permission error lands here too — and it is the right width: on
 * any host where the framework cannot even SELECT from the table, it certainly
 * cannot rebuild its index, and reporting one unactionable finding per boot is
 * how the actionable ones stop being read.
 */
async function tableIsPresent(exec: IndexExec): Promise<boolean> {
    try {
        await exec(buildSysSettingPresenceSql());
        return true;
    } catch {
        return false;
    }
}

/**
 * Replace `sys_setting`'s NULL-distinct declared UNIQUE index with the NULL-safe
 * one the declaration has always described (#8629).
 *
 * Idempotent: re-running rebuilds the same definition, so the resulting schema
 * is byte-identical. Best-effort by design — a boot must never fail because an
 * index could not be tightened, which is why every branch returns a status
 * instead of throwing.
 */
export async function ensureSysSettingIdentityIndex(
    exec: IndexExec | undefined,
    logger?: EnsureSysSettingIndexLogger,
): Promise<EnsureSysSettingIndexResult> {
    if (!exec) return { status: 'no-driver' };
    if (!(await tableIsPresent(exec))) return { status: 'absent' };

    // The probe-first order — prove the NULL-safe form is possible under a
    // throwaway name, and only THEN drop the declared name and rebuild it —
    // lives in `partial-index-probe.ts`. It is what makes "refuse to migrate"
    // mean the table keeps the constraint it already had.
    const outcome = await probeThenReplaceIndex(exec, {
        indexName: SYS_SETTING_IDENTITY_INDEX_NAME,
        probeIndexName: SYS_SETTING_IDENTITY_PROBE_INDEX_NAME,
        buildSql: buildSysSettingIdentityIndexSql,
    });

    if (outcome.status === 'created') return { status: 'created' };

    const detail = outcome.detail ?? '';
    if (outcome.failedAt === 'replace') {
        // Only reachable on a race with another process between the drop and the
        // create — the probe already cleared dialect and data. Say so rather
        // than leaving a table that now has no unique index at all.
        logProblem(
            logger,
            `[metadata-protocol] could not create '${SYS_SETTING_IDENTITY_INDEX_NAME}' on ` +
            `"${SYS_SETTING_TABLE}" after the probe succeeded — the table may currently have NO unique ` +
            `index on (${sysSettingIdentityKeyParts().join(', ')}). Restart to retry (#8629).`,
            detail,
        );
        return { status: 'failed', detail };
    }

    reportDegradation(outcome.status, detail, logger);
    return { status: outcome.status, detail };
}

/**
 * Say what is NOT enforced and what fixes it — ADR-0120 D4's wording contract,
 * which `SqlDriver.createNullSafeUniqueIndex` already follows for the same class
 * of event. Never fails the boot: from the outside everything else looks normal,
 * so silence here is what makes the gap expensive.
 *
 * Every arm is `error`, on the AGENTS.md judgment question rather than by
 * default: after this degradation the platform still looks healthy while a row
 * identity it states it enforces is void on the `tenant` and `global` limbs —
 * duplicate configuration rows accumulate, `SettingsService` resolves whichever
 * one the engine reached first, and an admin cannot see why the effective value
 * is not the one they set. That is the durability arm, not the
 * reduced-functionality arm.
 */
function reportDegradation(
    status: PartialIndexStatus,
    detail: string,
    logger?: EnsureSysSettingIndexLogger,
): void {
    const columns = SYS_SETTING_IDENTITY_INDEX_COLUMNS.join(', ');
    const keyParts = sysSettingIdentityKeyParts().join(', ');
    // The bare spelling, for the arms whose reader is NOT known to be MySQL.
    // `conflict` is the live one: it means real rows blocked a build that the
    // server was willing to attempt, which only SQLite and PostgreSQL ever are —
    // MySQL never gets that far, it refuses the statement and lands in
    // `unsupported` above, which prints the MySQL spelling instead (#9434).
    const duplicateQuery = buildSysSettingDuplicateProbeSql();

    if (status === 'unsupported') {
        // Expected on MySQL/MariaDB: no functional key parts before 8.0.13, and
        // this statement does not parenthesize them for the versions that have
        // them (`key` is a reserved word there besides). The outcome is exactly
        // ADR-0120 D3's degradation — the previous index stays in force —
        // reached by keeping it rather than by rebuilding it, which is also
        // `createNullSafeUniqueIndex`'s handling of the same refusal.
        //
        // The remedy query is the MySQL-spelled one (#9434). This arm's reader
        // is a MySQL/MariaDB operator by construction, and the bare form is not
        // merely unidiomatic there — `key` is reserved, so it is ERROR 1064.
        // Handing that operator a statement their server cannot parse is handing
        // them nothing, in the one arm that has no other remedy to offer.
        logProblem(
            logger,
            `[metadata-protocol] this database cannot build the NULL-safe row-identity index — ` +
            `'${SYS_SETTING_IDENTITY_INDEX_NAME}' on "${SYS_SETTING_TABLE}" stays NULL-distinct on user_id ` +
            `over (${columns}). The system keeps looking healthy while the declared row identity is void on ` +
            `every row that is not scope='user' — user_id is NULL there — so two tenant-scope rows for one ` +
            `(namespace, key) in ONE organization, or two platform defaults on the global layer, can coexist ` +
            `and SettingsService has no defined answer for which one wins (#8629). MySQL/MariaDB before ` +
            `8.0.13 has no functional key parts, so there is no in-dialect fix: run this platform on ` +
            `SQLite/PostgreSQL for the guarantee, and meanwhile watch for duplicates with this MySQL ` +
            `statement: ${buildSysSettingDuplicateProbeSqlMysql()}`,
            detail,
        );
        return;
    }

    if (status === 'conflict') {
        // The live path this card's ceremony is FOR: the NULL-safe key is a
        // tightening, so rows the previous index admitted block the build. The
        // maintainer's ruling is refuse-to-migrate — no row is touched, the
        // previous index is left in place, the operator gets the list and makes
        // the call. Never keep-newest.
        logProblem(
            logger,
            `[metadata-protocol] cannot tighten '${SYS_SETTING_IDENTITY_INDEX_NAME}' on ` +
            `"${SYS_SETTING_TABLE}" — existing rows violate (${keyParts}). The previous index is left in ` +
            `place, so (${columns}) is enforced only as far as it was before, and the NULL-safe key is NOT ` +
            `enforced until the duplicates are resolved: settings rows are admin-authored configuration, so ` +
            `no row is discarded automatically and this migration will keep refusing until an operator ` +
            `decides which row survives. List them with: ${duplicateQuery} — or run "os migrate plan" — ` +
            `then restart (ADR-0120 D4, #8629).`,
            detail,
        );
        return;
    }

    // The catch-all ('failed'), raised alongside the dialect arm above and for
    // the same reason. Leaving it quieter would report the case we UNDERSTAND (a
    // named dialect limitation) more loudly than the one we do not, while the
    // consequence is identical: the DDL did not run, the NULL-safe key is not in
    // force, and nothing else looks wrong.
    logProblem(
        logger,
        `[metadata-protocol] could not rebuild '${SYS_SETTING_IDENTITY_INDEX_NAME}' on ` +
        `"${SYS_SETTING_TABLE}" as the NULL-safe row-identity index; the existing index is unchanged, so ` +
        `duplicate tenant-scope and global-scope settings rows can still be created while everything else ` +
        `looks healthy. Fix the cause below and restart (#8629).`,
        detail,
    );
}
