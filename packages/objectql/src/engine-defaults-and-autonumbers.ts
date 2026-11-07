// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Field defaults and autonumbers" section of `ObjectQL`:
 * the bodies of `resolveNowDefault`, `normalizeExpressionDefault`,
 * `buildHookApi`, `resolveOptionDefault`, `applyFieldDefaults`,
 * `defaultFieldEntries`, `applyAutonumbers`, `adoptExplicitAutonumber`,
 * `createWithAutonumberResync`, `isIssuedAutonumberCollision`,
 * `warnAutonumberReadersUnserved`, `seedAutonumber` moved out of `engine.ts`
 * whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link DefaultsAndAutonumbersFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link DefaultsAndAutonumbersHost}:
 * exactly the `ObjectQL` members they read, private ones included. Every stub
 * hands its body, by a `.call`, the same host: `defaultsAndAutonumbersHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { isCurrentUserDefaultToken, isNowDefaultToken, missingFieldValues, parseAutonumberFormat, renderAutonumber, resolveAutonumberFormat } from '@objectstack/spec/data';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/core';
import { withoutVouchedReferences } from '@objectstack/core';
import { isUniqueViolationError, keysetWalk, uniqueViolationColumn } from '@objectstack/types';
import type { KeysetPageQuery } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { envelopeDriverWriteRefusal } from './not-null-refusal-error.js';
import { ExpressionEngine } from '@objectstack/formula';
import type { EvalPermissions } from '@objectstack/formula';
import {
  AUTONUMBER_COLLISION_ATTEMPTS, AUTONUMBER_SEED_PAGE_SIZE, declaredMultiValued, isExpressionDefault,
  readStoredAutonumberCounter, recomputeAutonumberReaders,
} from './engine-top-level.js';
import type { AutonumberReaders, FormulaPlanEntry, IssuedAutonumber } from './engine-top-level.js';
import { ScopedContext } from './engine.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link DefaultsAndAutonumbersFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface DefaultsAndAutonumbersHost {
  adoptExplicitAutonumber: ObjectQL['adoptExplicitAutonumber'];
  applyAutonumbers: ObjectQL['applyAutonumbers'];
  readonly autonumberCounters: ObjectQL['autonumberCounters'];
  readonly autonumberReadersUnservedReported: ObjectQL['autonumberReadersUnservedReported'];
  defaultFieldEntries: ObjectQL['defaultFieldEntries'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQL;
  find: ObjectQL['find'];
  getSchema: ObjectQL['getSchema'];
  isIssuedAutonumberCollision: ObjectQL['isIssuedAutonumberCollision'];
  readonly logger: ObjectQL['logger'];
  normalizeExpressionDefault: ObjectQL['normalizeExpressionDefault'];
  resolveNowDefault: ObjectQL['resolveNowDefault'];
  resolveOptionDefault: ObjectQL['resolveOptionDefault'];
  seedAutonumber: ObjectQL['seedAutonumber'];
  validationMessageContext: ObjectQL['validationMessageContext'];
}

/** The bodies of the "Field defaults and autonumbers" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class DefaultsAndAutonumbersFacet {
  /**
   * Resolve the `NOW()` runtime token into the value the field's declared type
   * actually stores (#4597).
   *
   * The engine — not the driver — owns this resolution, exactly as it owns
   * `current_user`. `NOW()` is the mirror of #4560's crack: `current_user` was
   * known to the engine and not to the DDL, so the DDL stored the token text;
   * `NOW()` was known to the SQL driver and not to the engine, so every
   * non-SQL datasource got the token text instead of a time. Resolving here
   * makes one answer serve every driver.
   *
   * The shapes below are NOT invented: they are the canonical storage forms
   * ADR-0053 already fixed and `SqlDriver.nowColumnDefault` already emits
   * per type. Producing a full instant for a `Field.date` would trade the old
   * cross-driver drift for a new one (SQL would keep collapsing it to a
   * calendar day in `formatInput`, memory/mongodb would not), so the token
   * resolves per declared type:
   *
   * | field type | stored form | matches |
   * |---|---|---|
   * | `date` | `YYYY-MM-DD` (UTC day) | `toDateOnly` / the `date` column DEFAULT |
   * | `time` | `HH:MM:SS[.fff]` (UTC wall clock, `.000` trimmed) | `canonicalTimeOfDay` |
   * | anything else | `YYYY-MM-DDTHH:MM:SS.sssZ` | `canonicalUtcDatetime` |
   *
   * "Anything else" deliberately includes non-temporal fields: a `text` field
   * that opts into `NOW()` gets the instant, which is what the SQL column
   * DEFAULT gives it today.
   *
   * `instant` is the caller's per-insert `now` snapshot when the `NOW()` token
   * is what asked, so two defaulted fields on one record cannot straddle a
   * millisecond boundary.
   *
   * It is NOT only the token's, though (#7373): this is the one place that
   * knows what shape a declared type stores an instant in, so the CEL branch's
   * {@link normalizeExpressionDefault} routes its own `Date` results through
   * the SAME table rather than growing a second copy of it. Hence the
   * parameter is an arbitrary `instant`, not "now" — `daysFromNow(7)` is a
   * week out and takes the identical per-type treatment.
   */
  static resolveNowDefault(fieldType: unknown, instant: Date): string {
    const iso = instant.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
    if (fieldType === 'date') return iso.slice(0, 10);
    if (fieldType === 'time') {
      const timeOfDay = iso.slice(11, 23); // HH:MM:SS.fff
      // Trim a zero-millisecond `.000` so a defaulted row is byte-canonical and
      // still matches an equality filter against `'HH:MM:SS'` — the same trim
      // the SQL driver's time DEFAULT and `canonicalTimeOfDay` apply.
      return timeOfDay.endsWith('.000') ? timeOfDay.slice(0, 8) : timeOfDay;
    }
    return iso;
  }

  /**
   * Put a CEL `defaultValue`'s evaluated result into the storage shape the
   * field's declared type contracts for (#7373).
   *
   * The counterpart the expression branch was missing. `applyFieldDefaults`
   * has three ways to produce a default and, before this, only two of them
   * honoured the stored-value contract: the `NOW()` token routed through
   * {@link resolveNowDefault}, a literal is checked against
   * `valueSchemaFor(def, 'stored')` at AUTHOR time (#7127), and the expression
   * envelope's result was assigned verbatim. But the temporal stdlib returns a
   * JS `Date` — ADR-0053 D1 fixes `today()` / `daysFromNow(n)` / `daysAgo(n)`
   * as UTC-midnight of the reference-tz calendar day, and `now()` as the raw
   * instant — while `valueSchemaFor` says a stored instant is an ISO-8601
   * STRING. So `{ dialect: 'cel', source: 'daysFromNow(7)' }` on a `datetime`
   * put a `Date` object in the column: a value the platform's own
   * `os migrate value-shapes` scan reports as a violation.
   *
   * Why NORMALIZE rather than refuse the `Date` — the two shapes this could
   * have taken, decided on measurement:
   *
   *  - **The drivers already agree with this answer.** Handed a `Date`,
   *    `SqlDriver.formatInput` coerces it through `canonicalUtcDatetime`
   *    (`toISOString()`) and `toDateOnly` (`YYYY-MM-DD`); mongodb's
   *    `storageDatetimeValue` keeps the BSON `Date`, which is what parsing the
   *    ISO string produces anyway, and its `storageDateValue` collapses to the
   *    same `YYYY-MM-DD`. Normalizing here is therefore byte-identical on
   *    every SQL and mongodb-backed store and changes exactly one thing: the
   *    memory driver, which applies its temporal canon to filter comparands
   *    only (`coerceTemporalValue`) and stores writes as handed. That is the
   *    whole defect, and this is the smallest change that closes it.
   *  - **Refusal would single out one writer.** `validateRecord` accepts a
   *    `Date` on `date`/`datetime` from ANY caller by explicit decision
   *    (`if (value instanceof Date) return null`), and temporal types are not
   *    in ADR-0104's strict value-shape block at all. Refusing a `Date` only
   *    when a CEL default produced it would make the rule depend on who wrote
   *    the value rather than on what the value is — and would break the
   *    documented envelope (#7244) on precisely the SQL backends where it
   *    stores correctly today.
   *
   * This is the `NOW()` crack of #4597 / #4560 in its third form: a value the
   * SQL driver silently repaired at the wire and non-SQL datasources did not,
   * so one declaration stored two shapes depending on the datasource. Resolved
   * engine-side, one answer serves every driver; the driver coercions stay as
   * defence in depth for writes that bypass the engine.
   *
   * No day can shift here. ADR-0053 D1's `Date` is UTC-midnight OF the
   * reference-tz calendar day, and {@link resolveNowDefault} reads it back
   * with `toISOString()` — UTC getters, the same `getUTC*` reading the ADR
   * names for the driver filter path. Reading those parts in LOCAL time is the
   * move that would shift a day, and nothing here does it.
   *
   * Non-`Date` results (a string, a number, a bool, a list) pass through
   * untouched: this normalizes temporal FORM, it does not police the contract,
   * and a CEL default is documented as "result type is a runtime concern".
   * An `Invalid Date` passes through too — the same totality the driver
   * canons keep, so a value nothing can interpret is never silently rewritten
   * into a wrong one.
   */
  static normalizeExpressionDefault(this: Pick<DefaultsAndAutonumbersHost, 'resolveNowDefault'>, fieldType: unknown, value: unknown): unknown {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
    return this.resolveNowDefault(fieldType, value);
  }

  /**
   * Build a HookContext.api: a ScopedContext that hooks can use to
   * read/write other objects within the same execution context.
   * Falls back to a system-elevated empty context when no execCtx
   * is supplied (e.g. system-triggered hooks).
   */
  static buildHookApi(this: Pick<DefaultsAndAutonumbersHost, 'facade'>, execCtx?: ExecutionContext): ScopedContext {
    // A reference a service verb vouched for on the write that fired this hook
    // is spent on that write: no context a hook writes through carries it
    // (`withoutVouchedReferences`, @objectstack/core). A context with no mark
    // is handed through as the same object.
    const safeCtx: ExecutionContext = withoutVouchedReferences(execCtx ?? ({ isSystem: true } as any));
    return new ScopedContext(safeCtx, this.facade as unknown as IDataEngine);
  }

  /**
   * The initial value a field's OPTION LIST declares — the option marked
   * `default: true` — or `undefined` when it declares none (#7246).
   *
   * `SelectOption.default` has been authorable and spec-valid since the schema
   * was written, and until this method nothing on the insert path read it: a
   * create that omitted the field stored `null`, not the marked option. The one
   * consumer anywhere was lint's `isNullableField`, which concluded the column
   * was always-valued — a **build-breaking** verdict resting on a declaration
   * the engine did not honour. Enforcing it here is what makes that heuristic
   * true rather than merely asserted.
   *
   * Deliberate decisions, each of which could reasonably have gone the other
   * way:
   *
   *  - **Precedence: `defaultValue` wins.** Not decided here — decided by the
   *    caller, which only reaches this method when `defaultValue == null`. The
   *    field-level key is the more specific declaration (it names a value for
   *    THIS field; the option flag describes the shared option list), and it is
   *    the spelling every other consumer already honours. When both are
   *    declared and disagree, the option flag is inert exactly as it is today.
   *
   *  - **Type-agnostic, like the lint heuristic.** `options` is a field-level
   *    key on `FieldSchema`, not gated on `type: 'select'`, and
   *    `isNullableField` reads it without a type test. Matching that keeps the
   *    two sides honest BY CONSTRUCTION: there is no field the lint calls
   *    always-valued that this method leaves empty.
   *
   *  - **A MULTI-VALUED field assembles an ARRAY.** That field stores an
   *    Array/JSON, so the shape of its default follows the field, not the
   *    number of marked options — one marked option on a multi-select defaults
   *    to a one-element array, never a bare scalar that the driver would then
   *    store with the wrong shape. [#18408] Multi-valued is
   *    {@link declaredMultiValued}, ⛔ not a raw `field.multiple`: the flag is
   *    inert on a type outside the two multi sets and redundant on a
   *    `multiselect` / `checkboxes` / `tags`, which stores an array with or
   *    without it — so reading the flag made this method disagree with the
   *    validator one frame later (`normalizeMultiValueFields` has asked the
   *    predicate all along) and with the column the driver builds.
   *
   *    Refusing (throwing) was rejected: the metadata is
   *    spec-valid, and a runtime throw on spec-valid input is a worse answer
   *    than a well-defined value. Ignoring it was rejected too — it would
   *    preserve, for multi-selects only, precisely the inertness this change
   *    removes, and an author cannot see that carve-out from the schema.
   *
   *  - **Several options marked on a SINGLE-valued field: the FIRST wins.**
   *    There is one slot, so declaration order decides — deterministic, and
   *    the same option a picker preselects when it takes the first match.
   *    Neither the `Field.select` builder nor the schema dedupes the flag, so
   *    this case is reachable; the alternative (throw) again fails a
   *    spec-valid declaration at runtime. Nothing in the shipped corpus marks
   *    more than one.
   *
   *  - **Only the canonical `default` spelling is read.** The authoring
   *    aliases (`isDefault`, `selected`) are normalized by
   *    `SelectOptionSchema`'s alias layer before metadata reaches the engine,
   *    and lint reads the canonical key only. Reading the aliases here would
   *    make the engine honour raw shapes lint calls nullable — the two would
   *    disagree in the direction that produces a false "always-valued".
   */
  static resolveOptionDefault(field: { type?: unknown; options?: unknown; multiple?: unknown }): unknown {
    const options = field.options;
    if (!Array.isArray(options)) return undefined;
    const marked: unknown[] = [];
    for (const o of options) {
      if (!o || typeof o !== 'object') continue;
      if ((o as { default?: unknown }).default !== true) continue;
      const value = (o as { value?: unknown }).value;
      // An option marked default but carrying no value declares nothing this
      // method can apply — skipped rather than stored as `null`, which would
      // be indistinguishable from "no default" downstream.
      if (value === undefined || value === null) continue;
      marked.push(value);
    }
    if (marked.length === 0) return undefined;
    // [#18408] Was `field.multiple === true`. See {@link declaredMultiValued}.
    return declaredMultiValued(field) ? marked : marked[0];
  }

  /**
   * Apply field defaults to an incoming insert payload. Defaults that are
   * Expression envelopes (e.g. `{ dialect: 'cel', source: 'today()' }`,
   * `{ dialect: 'cel', source: 'os.user.id' }`) are evaluated via
   * `ExpressionEngine` against the calling user/org/now snapshot. The
   * `defaultValue` runtime TOKENS (`@objectstack/spec/data`'s
   * `DEFAULT_VALUE_TOKENS` — `current_user` and `NOW()`, the whole family) are
   * resolved here, so one declaration behaves identically on every driver.
   * Static defaults are applied verbatim. Records that already supplied a value
   * for a field are left untouched.
   *
   * "Supplied a value" means the field is present with a non-null value. Both an
   * OMITTED field (`undefined`) and an EXPLICIT `null` are treated as "not
   * supplied" and get the default. This runs on the INSERT path only, where a
   * `null` from a form (an unpicked control serializes to `null`, not omission)
   * unambiguously means "no value"; the UPDATE path never calls this, so a
   * deliberate "set to null" on update is preserved (#2706). Empty string `''`
   * is a real, user-entered value and is left as-is.
   *
   * Implements ROADMAP §M9.9b — `defaultValue` accepts Expression so authors
   * can replace "write a hook to default to today/current-user" with a
   * declarative `defaultValue: cel\`today()\``.
   *
   * A field that declares NO `defaultValue` falls back to the option marked
   * `default: true` ({@link resolveOptionDefault}, #7246) — the select idiom,
   * which until then was authorable, spec-valid, and read by nothing on this
   * path.
   *
   * [#20082] `permissions` is the acting subject's effective object-permission
   * map, which an expression default calling `current_user.can(object, verb)`
   * answers from. This method is synchronous, so the CALLER resolves it — once
   * per write, only for a row that will be defaulted by such an expression
   * ({@link resolveDefaultPermissions}, which also owns what a failed resolution
   * does: it refuses the write before this runs). `undefined` is "no permission
   * data": a `can` default then does not evaluate and takes this method's rule
   * for every expression default that does not — left unset, with the warn below.
   */
  static applyFieldDefaults(this: Pick<DefaultsAndAutonumbersHost, 'defaultFieldEntries' | 'logger' | 'normalizeExpressionDefault' | 'resolveNowDefault' | 'resolveOptionDefault'>, object: string, record: Record<string, unknown>, execCtx?: ExecutionContext, nowSnapshot?: Date, permissions?: EvalPermissions): Record<string, unknown> {
    const fieldEntries = this.defaultFieldEntries(object);
    if (!fieldEntries) return record;
    const out = { ...record };
    const now = nowSnapshot ?? new Date();
    for (const f of fieldEntries) {
      // Apply the default when the field is either OMITTED (`undefined`) or an
      // EXPLICIT `null` — both mean "no value supplied" on insert (#2706). A
      // real value (including `''`) is respected. Insert-only path, so an
      // intentional "set to null" on update is never touched here.
      if (out[f.name] != null) continue;
      if (f.defaultValue == null) {
        // No `defaultValue` — fall back to the option marked `default: true`.
        //
        // Reached ONLY through this branch, which is the whole point of putting
        // it here (#7246): an option's `value` is a plain literal by
        // construction (`SystemIdentifierSchema`), never one of the runtime
        // TOKENS below, so it must not be handed to `isCurrentUserDefaultToken`
        // / `isNowDefaultToken`. An option literally spelled `current_user`
        // stores those twelve characters — it is a picklist value, not an
        // instruction — and that is pinned by test.
        //
        // The `dv == null` gate above is the presence test that decides
        // precedence: `defaultValue: ''` is a REAL default (`'' == null` is
        // false), so it wins and this fallback never fires for it, exactly as
        // `''` supplied by a caller is respected as a real value.
        const fromOption = this.resolveOptionDefault(f);
        if (fromOption !== undefined) out[f.name] = fromOption;
        continue;
      }
      const dv = f.defaultValue;
      if (isExpressionDefault(dv)) {
        const result = ExpressionEngine.evaluate(dv, {
          now,
          timezone: execCtx?.timezone,
          user: execCtx?.userId ? { id: String(execCtx.userId), positions: execCtx?.positions ?? [] } : undefined,
          org: execCtx?.tenantId ? { id: String(execCtx.tenantId) } : undefined,
          permissions,
          record: out,
          extra: { object },
        });
        if (result.ok) {
          // Normalized to the declared type's stored shape, never assigned
          // verbatim: the temporal stdlib returns a `Date` and the contract
          // names an ISO-8601 string (#7373 — {@link normalizeExpressionDefault}).
          out[f.name] = this.normalizeExpressionDefault(f.type, result.value);
        } else {
          this.logger.warn('Failed to evaluate default expression', {
            object, field: f.name, error: result.error,
          });
        }
      } else if (isCurrentUserDefaultToken(dv)) {
        // `current_user` token → the acting user's id at insert time. Declarative
        // counterpart to writing a beforeInsert hook; mirrors the 'NOW()' string
        // convention and is resolved app-side per request (driver-agnostic), so
        // `Field.user({ defaultValue: 'current_user' })` auto-fills the actor.
        // When there is no authenticated user (system/anonymous), leave it unset
        // and let required-validation decide — never stamp a bogus owner.
        //
        // The token spelling comes from `@objectstack/spec/data`
        // (`DEFAULT_VALUE_TOKENS`), the one place the family is declared, so a
        // driver's DDL reads the SAME set when deciding which `defaultValue`s
        // may become a physical column DEFAULT. When the two sides disagreed,
        // SQL emitted `DEFAULT 'current_user'` and the DATABASE overrode the
        // "leave it unset" decision below with a literal non-id (#4560).
        if (execCtx?.userId != null) out[f.name] = String(execCtx.userId);
      } else if (isNowDefaultToken(dv)) {
        // `NOW()` token → the insert-time clock, in the storage shape the
        // field's declared type calls for ({@link resolveNowDefault}).
        //
        // The mirror of the `current_user` crack above (#4597 / #4560): this
        // token was understood by the SQL driver and NOT by the engine, so
        // `out[f.name] = dv` sent the literal string `'NOW()'` to every
        // driver. SQL hid it — `formatInput`'s safety net swapped in a real
        // timestamp before the wire — while memory/mongodb have no such net,
        // so the same declaration behaved differently per datasource. That
        // split surfaced two ways: a validation-visible field was REJECTED by
        // the engine's own write validator ("must be a valid datetime"), and a
        // `readonly`/`system` field — which `validateRecord` then skipped, i.e.
        // the ~100 `created_at`/`updated_at` platform declarations — silently
        // stored the four characters `NOW()`. (Since #21663 a readonly value's
        // shape is judged too, so that literal would now be refused.)
        //
        // Resolved from the caller's `nowSnapshot`, so every defaulted field
        // in one insert (and every row of one batch) carries the SAME instant.
        //
        // The driver's own now-handling is unchanged and stays as defence in
        // depth: `SqlDriver.formatInput`'s safety net (now unreachable from
        // this path) and the native column DEFAULT, which still serves writes
        // that bypass the engine entirely — the same division of labour
        // `current_user` has.
        out[f.name] = this.resolveNowDefault(f.type, now);
      } else {
        out[f.name] = dv;
      }
    }
    return out;
  }

  /**
   * The field entries {@link applyFieldDefaults} walks — one reading of an
   * object's `fields`, shared with {@link resolveDefaultPermissions} so the
   * planner and the evaluator see the same defaults. `undefined` when the object
   * declares no fields, which is `applyFieldDefaults`' early return (it hands
   * the SAME record reference back, and the insert path relies on knowing that).
   */
  static defaultFieldEntries(this: Pick<DefaultsAndAutonumbersHost, 'getSchema'>, object: string): Array<{
    name: string; type?: unknown; defaultValue?: unknown; options?: unknown; multiple?: unknown;
  }> | undefined {
    const fieldsRaw = (this.getSchema(object) as any)?.fields;
    if (!fieldsRaw || typeof fieldsRaw !== 'object') return undefined;
    // `fields` may be a Record<string, Field> (canonical) or an array (legacy).
    return Array.isArray(fieldsRaw)
      ? fieldsRaw
      : Object.entries(fieldsRaw).map(([name, def]) => ({ name, ...(def as object) }));
  }

  /**
   * Generate values for empty `autonumber` fields on insert — ONLY for drivers
   * that do not generate them natively (memory, mongodb). For SQL-backed objects
   * the driver owns a persistent, atomic `_objectstack_sequences` table and
   * advertises `supports.autonumber === true`; the engine then defers entirely
   * and never pre-fills (so the persistent sequence is the single source of
   * truth — see #1603). Required-validation exempts `autonumber` either way, so
   * a `required` record number is never rejected for "missing" — the runtime
   * owns the value, not the client.
   *
   * That ownership is now ENFORCED rather than merely asserted (#5503): the
   * insert path strips a caller-supplied value before this runs, so the "respect
   * explicit value" skip below is reached only by writers the strip exempts —
   * `isSystem` (seed replay, migration) and an opt-in historical import
   * (`preserveAudit`), plus values a `beforeInsert` hook computed server-side.
   * For every other caller the slot arrives empty and the sequence issues the
   * number. Do NOT "fix" a forged value here by overwriting it: the strip must
   * stay upstream of this method, because a driver with
   * `supports.autonumber === true` returns above without ever entering the loop.
   *
   * In the fallback path the next value is `max(existing) + 1`, seeded once per
   * `object.field.<scope>` from the store then incremented in memory (monotonic
   * within the process, resilient to deletions). The shared `autonumberFormat`
   * renderer is honored end-to-end, so date tokens (`AD{YYYYMMDD}{0000}`), field
   * interpolation (`{island_zone}{000}`) and per-scope reset behave identically
   * to the SQL driver's persistent sequence (#1603). NOTE: this in-memory seeding
   * is single-instance.
   *
   * # A format-LESS field renders through the contract default, not bare (#6555)
   *
   * "Identically to the SQL driver" was true of every DECLARED format and false
   * of the one case nobody declares: with no format at all this method used to
   * hand `parseAutonumberFormat` the empty string, whose empty token list
   * `renderAutonumber` renders through its no-slot branch as a BARE counter —
   * `1`, `2`, …. The SQL driver substituted `'{0000}'` in the same case and
   * issued `0001`, `0002`, …. One metadata document, two number shapes, decided
   * by which driver happened to serve it; the counter VALUE always agreed
   * (#6468 pinned that), so what forked was rendering width alone.
   *
   * The maintainer ruling of 2026-08-08 (#6555, route 3) puts the default in the
   * contract instead of in either fallback, and this method now reads it:
   * {@link resolveAutonumberFormat} answers the canonical `autonumberFormat`,
   * then the `format` shorthand (#1603), then `DEFAULT_AUTONUMBER_FORMAT`
   * (`{0000}`). Two consequences, both deliberate:
   *
   *   - A format-less field on this path now issues `0001` where it issued `1`.
   *     `{0000}` was chosen because it is the shape SQL deployments already
   *     store, so the flip lands on engine-fallback deployments only.
   *   - "Declared" is now a NON-EMPTY string (the SQL driver's long-standing
   *     truthiness rule) rather than the `??` this method used, so
   *     `autonumberFormat: ''` resolves to the default too instead of rendering
   *     bare — and an empty canonical key no longer masks a declared `format`
   *     shorthand. The bare counter is still reachable, by declaring a format
   *     with no `{0..0}` slot (`'PRE-'` → `PRE-1`).
   *
   * Seeding is untouched by all of this: `{0000}` renders prefix `''` and suffix
   * `''`, so {@link readStoredAutonumberCounter} stays on its UNANCHORED legacy
   * branch and reads already-stored bare values exactly as before.
   *
   * # Keeping the seeded counter in sync (#6806)
   *
   * Seeding "once per counter key" is only the truth while the engine is the
   * ONLY writer of the field. It is not: the `continue` below is reached by
   * every exempt writer (`isSystem` seed replay, a `preserveAudit` historical
   * import, a `beforeInsert` hook stamp), and each of those persists a record
   * number the counter never saw. The counter then keeps issuing from where the
   * one-time seed left it — below the store's real max — and every number it
   * issues up to that max is a duplicate business identifier. Two resyncs
   * close that, from opposite ends:
   *
   *   - **Adopt, here.** An exempt value passes through this very loop, so the
   *     counter can be lifted from it for FREE — one string parse, no query.
   *     {@link adoptExplicitAutonumber} does it, which makes the warm in-memory
   *     counter converge on what a cold re-seed of the same store would answer.
   *     This is the whole fix for in-process drift, and it costs nothing on the
   *     generating path (a caller-supplied value never reaches this method
   *     unless the writer is exempt).
   *   - **Re-seed on collision**, at the write. Adoption cannot see a writer
   *     outside this process (another instance, a direct driver write, a
   *     restore). Those surface as a unique-constraint failure on the create,
   *     and {@link createWithAutonumberResync} answers it by dropping the stale
   *     counter, re-seeding from the store and re-issuing — bounded. It costs
   *     nothing until a collision actually happens.
   *
   * Both are required and neither subsumes the other: adoption covers drift the
   * engine can observe but the store cannot report, collision-resync covers
   * drift the store reports but the engine could not observe.
   *
   * @returns the autonumbers this call ISSUED, in field order — the input
   * {@link createWithAutonumberResync} needs to decide whether a unique
   * violation is one of its own numbers. An adopted (caller-supplied) value is
   * deliberately NOT listed: it is not the engine's to re-issue.
   */
  static async applyAutonumbers(this: Pick<DefaultsAndAutonumbersHost, 'adoptExplicitAutonumber' | 'autonumberCounters' | 'getSchema' | 'seedAutonumber'>, object: string, record: Record<string, unknown>, execCtx?: ExecutionContext, driverOwnsAutonumber?: boolean): Promise<IssuedAutonumber[]> {
    if (driverOwnsAutonumber) return []; // driver generates persistently in create()
    const fields = (this.getSchema(object) as any)?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
    const now = new Date();
    const timezone = execCtx?.timezone;
    const issued: IssuedAutonumber[] = [];
    for (const [name, def] of Object.entries(fields)) {
      if ((def as any)?.type !== 'autonumber') continue;
      // The contract answers "which format?" — canonical `autonumberFormat`,
      // then the `format` shorthand (#1603), then the declared default
      // `{0000}`. One resolver, shared with the SQL driver, so a format-less
      // field cannot render two shapes again (#6555; see the docstring above).
      // `fmt` is kept only for the diagnostic below, which now names the format
      // actually rendered with rather than `undefined`.
      const fmt = resolveAutonumberFormat(def as never);
      const tokens = parseAutonumberFormat(fmt);
      const current = record[name];
      // Respect an explicit value — reachable only for an EXEMPT writer now
      // (isSystem / preserveAudit / a hook stamp): #5503's strip removed every
      // other caller's value before this method was called. Respecting it is
      // unchanged; what is new is that the counter LEARNS from it (#6806).
      if (current != null && current !== '') {
        this.adoptExplicitAutonumber(object, name, tokens, record, String(current), now, timezone);
        continue;
      }
      // Refuse to generate when an interpolated `{field}` is empty — it would
      // render to an empty prefix and merge this record into the wrong counter
      // scope. Mirror the SQL driver so both paths fail identically (#1603).
      const missing = missingFieldValues(tokens, record);
      if (missing.length > 0) {
        throw new Error(
          `Cannot generate autonumber "${object}.${name}" (format "${fmt}"): ` +
            `referenced field(s) [${missing.join(', ')}] are empty on the record. ` +
            `Fields interpolated into an autonumber format must be set before the record is created.`,
        );
      }
      // The counter scope is the rendered prefix (date/field tokens before the
      // sequence slot); it is independent of the counter value, so a throwaway
      // render with seq 0 yields the scope and the literal prefix to seed from.
      const probe = renderAutonumber({ tokens, seq: 0, record, now, timezone });
      const counterKey = `${object}.${name}.${probe.scope}`;
      let next = this.autonumberCounters.get(counterKey);
      if (next == null) next = await this.seedAutonumber(object, name, probe.prefix, probe.suffix, execCtx);
      next += 1;
      this.autonumberCounters.set(counterKey, next);
      record[name] = renderAutonumber({ tokens, seq: next, record, now, timezone }).value;
      issued.push({ field: name, counterKey });
    }
    return issued;
  }

  /**
   * Lift the in-memory counter to a record number an EXEMPT writer supplied
   * (#6806) — the free half of the resync, and the one that closes the shape
   * #5495's PROBE1 measured on a warm database.
   *
   * The value is parsed with {@link readStoredAutonumberCounter}, i.e. by
   * exactly the anchoring rules #6468 gave the seeding scan, against the
   * prefix/suffix this record's own format renders. So adopting is the same reading a cold re-seed
   * would perform over the same row — which is the invariant to hold on to: a
   * warm counter must answer what a restart would answer.
   *
   * Four deliberate refusals, each one a way this could do harm:
   *
   *   - **Never throws.** An exempt write is not the engine's to reject, and it
   *     was not rejected before this method existed. A format whose `{field}`
   *     interpolation is empty, or a value that parses to nothing, simply
   *     teaches the counter nothing.
   *   - **Only LIFTS a counter that is already seeded.** With no seed in hand,
   *     writing this value in would SKIP the seeding scan and answer from one
   *     row — below the real max whenever the store holds a higher number, i.e.
   *     the duplicate-number defect itself. Doing nothing is correct: the row is
   *     persisted, so the first generating insert's own scan reads it.
   *   - **Never lowers.** A counter that has already issued numbers must not go
   *     back over them; the max is a floor that only rises.
   *   - **Only within this record's scope.** The reading returns `undefined`
   *     for a value that does not carry the rendered prefix, so a
   *     historical import into last month's date scope cannot lift THIS
   *     month's counter. Its own scope's counter is left untouched, which is
   *     harmless: a scope is derived from the write instant, so a past scope's
   *     counter is not one a subsequent generating insert can reach.
   *
   * Adoption runs BEFORE the driver write, so an exempt insert that then fails
   * leaves the counter lifted over a number nobody took — a gap. Gaps are
   * already the documented cost of this path (a failed attempt consumes its
   * value; the counter is "resilient to deletions"), and the direction is the
   * safe one: a gap is a cosmetic surprise, a duplicate is a corrupted business
   * identifier.
   */
  static adoptExplicitAutonumber(this: Pick<DefaultsAndAutonumbersHost, 'autonumberCounters' | 'logger'>, object: string, field: string, tokens: ReturnType<typeof parseAutonumberFormat>, record: Record<string, unknown>, value: string, now: Date, timezone?: string): void {
    let probe: ReturnType<typeof renderAutonumber>;
    try {
      // An empty `{field}` would render an empty prefix and point at the wrong
      // counter — the same hazard the generating branch throws on. Here it is a
      // reason to learn nothing, never a reason to fail the caller's write.
      if (missingFieldValues(tokens, record).length > 0) return;
      probe = renderAutonumber({ tokens, seq: 0, record, now, timezone });
    } catch {
      return;
    }
    const counterKey = `${object}.${field}.${probe.scope}`;
    const seeded = this.autonumberCounters.get(counterKey);
    if (seeded == null) return; // not seeded yet — the first seed scan will read this row
    const supplied = readStoredAutonumberCounter(value, probe.prefix, probe.suffix);
    if (supplied == null || supplied <= seeded) return;
    this.autonumberCounters.set(counterKey, supplied);
    this.logger.debug('Autonumber counter lifted to an externally supplied value', {
      object, field, counterKey, from: seeded, to: supplied,
    });
  }

  /**
   * Create ONE record, re-seeding and re-issuing when the driver rejects an
   * autonumber the engine itself issued as a duplicate (#6806).
   *
   * # What this is for
   *
   * A counter that sits below the store's real max — because a writer outside
   * this process took numbers the engine could not observe — collides on every
   * insert until it has walked past that max one number at a time. Before this,
   * each of those inserts failed with the driver's raw error AND advanced the
   * counter, so a warm-database storm burned a number per failed create and
   * never converged on its own (#5495's PROBE3). Dropping the counter on the
   * collision is what converges it: the re-seed reads the true max back, and
   * the next attempt is issued from it.
   *
   * # Which failures qualify
   *
   *   - The engine must have ISSUED an autonumber on this row. A row whose
   *     numbers all came from an exempt writer has nothing here to re-issue.
   *   - The error must be a unique violation, per `isUniqueViolationError`
   *     (#6250) — never a word-list of this method's own.
   *   - When the dialect names the conflicting COLUMN (`uniqueViolationColumn`,
   *     #6544), it must be one of the fields the engine issued. A conflict on
   *     some other unique field is the caller's business error and is NOT
   *     re-issued, exactly as #5495's disposition ruled («非本字段的冲突原样上抛»);
   *     since #14095 it leaves the door as the `DUPLICATE_RECORD` envelope
   *     (`DuplicateRecordError`) carrying that same driver error as `cause` —
   *     the disposition is about not RE-ISSUING, and the envelope changes
   *     nothing about which failures qualify.
   *     When the dialect names no determinable column the attribution falls back
   *     to "the engine issued a number on this row, and the row was refused as a
   *     duplicate" — deliberately, because `uniqueViolationColumn` answers
   *     `undefined` for every index-named dialect, which includes MongoDB's
   *     `E11000 ... index: doc_no_1`, i.e. the ONE fallback driver that can
   *     raise this at all. Requiring a named column would make the resync
   *     unreachable on exactly the driver that needs it. The cost of the
   *     fallback is a wasted re-issue when an unrelated unique field is what
   *     actually conflicted: the second attempt fails the same way, and the
   *     original error is what the caller finally sees.
   *
   * # ⚠ The guarantee is STORAGE-DEPENDENT — say so, do not imply otherwise
   *
   * This whole branch is triggered by the storage layer REJECTING the duplicate,
   * so it reaches only drivers that (1) take this fallback path at all and
   * (2) enforce uniqueness. Measured across all five in-repo drivers:
   *
   * | driver | `supports.autonumber` | fallback path? | uniqueness on the column | a collision appears as |
   * |:---|:---|:---|:---|:---|
   * | driver-memory | `supports = {}` | **yes** | field-level `unique`, since commit 56c093c4d (ADR-0120 D1/D3 scoping) | `UNIQUE_VIOLATION` / 409 → re-seed + re-issue, here |
   * | driver-mongodb | absent (`{ batchSchemaSync: true }`) | **yes** | single-field unique index when the field declares `unique` | `E11000 duplicate key` → re-seed + re-issue, here |
   * | driver-sql | `autonumber: true` | no | — | — (but see #25073 below) |
   * | driver-sqlite-wasm | inherited (`extends SqlDriver`, no `supports` override) | no | — | — (inherited) |
   * | driver-turso | inherited (`...super.supports`) | no | — | — (inherited) |
   *
   * # Numbers the DRIVER issued ahead of the write (#25073)
   *
   * For an object whose stored `expression` reads its record number, a driver
   * that owns its counter issues the number through
   * `IDataDriver.issueAutonumbers` before this method runs, and the row
   * arrives here carrying it (`driverIssued`). The driver's own retry inside
   * `create()` cannot answer a collision on it any more — it reserved
   * nothing — and must not: a number re-issued there would leave the stored
   * expression computed from the old one. So the retry is this loop's, the
   * same loop the fallback drivers use. The member decides whether the error
   * is a collision on its numbers (never a duplicate the caller typed, never
   * inside a caller's transaction) and re-seeds the stale counter; this loop
   * then issues again, recomputes the readers and writes again, under the
   * same {@link AUTONUMBER_COLLISION_ATTEMPTS} bound.
   *
   * So the retry protects the TWO fallback backends — and it protected only one
   * of them until commit 56c093c4d, because `driver-memory` enforced no uniqueness at all
   * and had nothing to reject with. Which driver ISSUES the number is a
   * separate question and is unmoved by that: it is the reading the repo
   * already ruled and gates, in
   * `scripts/driver-memory-census.ledger.json`'s disposition for
   * `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`
   * (axis `ruled-permanent`, «#6664 A, maintainer 2026-08-08 — inherits #5704
   * Q2 = B»), which states it as: "InMemoryDriver declares `supports = {}`, so
   * the ENGINE's autonumber seeding owns the counter. No SQL backend can stand
   * in — SqlDriver advertises the capability and its own sequence bootstrap
   * answers instead". This comment cites that ruling rather than restating it:
   * a second answer to "who owns the autonumber counter" is the same
   * one-contract-two-numbers defect this lane keeps closing (#6832).
   *
   * ⚠️ **This paragraph used to record a live defect; commit 56c093c4d closed it, and the
   * ⛔ below is why the closure went where it did.** `InMemoryDriver.create` was
   * a `table.push()` storing no constraints of any kind (#4065's WEAK-oracle
   * docstring), so an out-of-process duplicate raised nothing for this method to
   * catch and the number landed twice in the rendered field with no error
   * anywhere. Since commit 56c093c4d that driver enforces field-level `unique`
   * (`driver-memory`'s `memory-unique-constraint.ts`, with `driver-sql`'s
   * ADR-0120 D1/D3 scoping) and refuses the collision in the ADR-0112 envelope,
   * which `isUniqueViolationError` reads — so the branch below is reachable
   * there and the number converges instead of duplicating.
   *
   * What covers driver-memory in ADDITION is the other half of this resync —
   * {@link adoptExplicitAutonumber} — which needs no constraint at all because it
   * never waits for a rejection. Between them: drift the engine can observe is
   * fixed on every driver; drift only the store can report is fixed wherever the
   * store reports it.
   *
   * ⛔ The remedy for the silent-duplicate row is uniqueness enforcement in the
   * driver, NOT a pre-issue existence probe here: a probe costs a query on every
   * insert (the cost this resync was designed to avoid) and is still racy, so it
   * would trade a silent duplicate for a rarer silent duplicate at double the
   * read cost. That argument is UNCHANGED by commit 56c093c4d and is not a historical
   * note — it is the standing reason no probe is added here, and it is what the
   * driver-side fix was chosen over. (`packages/drivers/**` was under the #5499
   * investment freeze when this comment was first written, which is why the work
   * was deferred rather than misplaced; the freeze lifted on 2026-08-11 and the
   * remedy landed where it always belonged, in the driver.)
   *
   * # And when it does not converge
   *
   * After {@link AUTONUMBER_COLLISION_ATTEMPTS} the write fails with a named
   * engine error (`code: 'ERR_AUTONUMBER_COLLISION'`) carrying the driver's
   * error as `cause`. The raw driver error is deliberately NOT the contract
   * here: "your record number collided three times after re-seeding" is an
   * engine-level condition a caller can act on, and the driver's prose is
   * preserved rather than replaced.
   */
  static async createWithAutonumberResync(this: Pick<DefaultsAndAutonumbersHost, 'applyAutonumbers' | 'autonumberCounters' | 'getSchema' | 'isIssuedAutonumberCollision' | 'logger' | 'validationMessageContext'>, driver: any, object: string, row: Record<string, unknown>, driverOptions: any, issued: IssuedAutonumber[], execCtx: ExecutionContext | undefined, driverOwnsAutonumber: boolean, driverIssued: string[] = [], readers?: AutonumberReaders): Promise<any> {
    // [#25073] Who issued this row's numbers decides who judges a collision on
    // them: the driver, through the member that issued them, or this engine.
    const byDriver = driverIssued.length > 0;
    let attempt = 1;
    for (;;) {
      try {
        return await driver.create(object, row, driverOptions);
      } catch (error) {
        // [#14095] Not OUR collision to re-issue — so this is where a driver's
        // refusal leaves the single-row door, and where it stops being the
        // driver's error. `envelopeUniqueViolation` returns everything that is
        // not a unique violation untouched (a deadlock, a NOT NULL, an
        // unreachable store), so only the recognised conflict changes shape.
        // [#24768] …and a NOT NULL refusal on a declared field becomes the
        // validator's own `ValidationError` (`envelopeDriverWriteRefusal`).
        // [#25073] On a driver-issued number the member answers instead, and
        // in answering re-seeds the counter it proved stale.
        const collided: string[] = byDriver
          ? ((await driver.issueAutonumbers(object, [row], driverOptions, error)) as string[][] | undefined)?.[0] ?? []
          : this.isIssuedAutonumberCollision(error, issued) ? issued.map((one) => one.field) : [];
        if (collided.length === 0) {
          throw envelopeDriverWriteRefusal(error, object, this.getSchema(object), 'insert', this.validationMessageContext(object, execCtx));
        }
        // Whatever happens next, the stale counter must not survive this call:
        // leaving it in place is what turned one collision into a storm.
        for (const one of issued) this.autonumberCounters.delete(one.counterKey);
        if (attempt >= AUTONUMBER_COLLISION_ATTEMPTS) {
          const fields = collided.join(', ');
          throw Object.assign(
            new Error(
              `Autonumber collision on '${object}' field(s) [${fields}]: the record number was ` +
                `re-seeded from the store and re-issued ${AUTONUMBER_COLLISION_ATTEMPTS} times and the ` +
                `driver rejected each one as a duplicate. No record was written.`,
            ),
            { code: 'ERR_AUTONUMBER_COLLISION', cause: error },
          );
        }
        attempt += 1;
        this.logger.warn('Autonumber collided — re-seeding the counter and re-issuing', {
          object, fields: collided, attempt,
        });
        let renumbered: boolean;
        if (byDriver) {
          // [#25073] The member emptied the slots it proved stale; issue them again.
          renumbered = (((await driver.issueAutonumbers(object, [row], driverOptions)) as string[][] | undefined)?.[0] ?? []).length > 0;
        } else {
          // Clear the slots so `applyAutonumbers` treats them as empty again —
          // leaving the burned value in place would read as an exempt writer's
          // and be adopted rather than re-issued.
          for (const one of issued) delete row[one.field];
          issued = await this.applyAutonumbers(object, row, execCtx, driverOwnsAutonumber);
          renumbered = issued.length > 0;
        }
        // [#25073] A new number is a new input to every stored field that reads it.
        await recomputeAutonumberReaders(readers, [row]);
        // Nothing left to re-issue (the field vanished from the schema
        // mid-flight) — the next failure is the caller's to see, enveloped on
        // the same terms as the exit above (#14095): this call is OUTSIDE the
        // loop's own `try`, so its rejection is a second driver-error exit and
        // not a path the branch above covers.
        if (!renumbered) {
          try {
            return await driver.create(object, row, driverOptions);
          } catch (retryError) {
            throw envelopeDriverWriteRefusal(retryError, object, this.getSchema(object), 'insert', this.validationMessageContext(object, execCtx));
          }
        }
      }
    }
  }

  /**
   * Whether `error` is a unique violation attributable to one of the
   * autonumbers this insert issued (#6806). See
   * {@link createWithAutonumberResync} for why an unnamed column counts as
   * attributable and a differently-named one does not.
   */
  static isIssuedAutonumberCollision(error: unknown, issued: IssuedAutonumber[]): boolean {
    if (issued.length === 0) return false;
    if (!isUniqueViolationError(error)) return false;
    const column = uniqueViolationColumn(error);
    if (column === undefined) return true;
    return issued.some((one) => one.field === column);
  }

  /**
   * [#25073] A driver that owns the record-number counter
   * (`supports.autonumber`) but cannot issue a number ahead of the write
   * (no `IDataDriver.issueAutonumbers`) still fills it inside `create()`, so a
   * stored field whose `expression` reads it is stored as computed WITHOUT
   * it, and every insert looks successful. That is a stored value that is
   * not what its declaration says (AGENTS.md, degradation log levels: `error`),
   * said once per object per engine instance, with the remedy.
   */
  static warnAutonumberReadersUnserved(this: Pick<DefaultsAndAutonumbersHost, 'autonumberReadersUnservedReported' | 'logger'>, object: string, plan: readonly FormulaPlanEntry[], driver: unknown): void {
    if (this.autonumberReadersUnservedReported.has(object)) return;
    this.autonumberReadersUnservedReported.add(object);
    const fields = plan.map((entry) => entry.name);
    const driverName = (driver as { name?: unknown } | null)?.name;
    this.logger.error(
      `Stored field(s) [${fields.join(', ')}] on '${object}' read a record number that driver ` +
        `'${String(driverName ?? 'unknown')}' issues only inside create(), so every insert stores them computed ` +
        'WITHOUT the number while the write reports success; an update by id recomputes them later. ' +
        'Use a driver that implements IDataDriver.issueAutonumbers (driver-sql and the drivers built on it do), ' +
        'or keep the record number out of the stored expression. Reported once per object.',
      undefined,
      { object, fields, driver: driverName },
    );
  }

  /**
   * Seed the autonumber counter from the current max in store, scoped to
   * `prefix`. With a non-empty prefix (date/field formats) only rows in the
   * same scope count.
   *
   * # Locating the counter inside a stored value (#6468)
   *
   * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, and
   * `suffix` is a DECLARED return value: every token after the `{0..0}` slot
   * renders behind the counter (`{000}-{YYYY}` → `001-2026`). So the counter is
   * NOT "the digits at the end of the string" — reading it that way took the
   * year for the counter and seeded `2026` against a true counter of `1`, which
   * jumps the next issued number to `2027-2026` and burns the band in between.
   *
   * Both the rendered `prefix` and the rendered `suffix` therefore come in from
   * the caller (they are `renderAutonumber`'s own output — this method does not
   * re-derive any format understanding of its own, and neither does the SQL
   * driver's `scanMaxNumericTail`, which is handed the same two strings):
   *
   *   - **Either one declared ⇒ the slot is ANCHORED**: the counter is the digit
   *     run at the START of what follows the prefix, after removing the declared
   *     suffix when this row carries it. That half is spec's
   *     `readAutonumberCounter` — the declared inverse of `renderAutonumber`,
   *     which the SQL driver's scan calls too, so one edit moves both sides
   *     (#6560).
   *   - **Neither declared ⇒ UNANCHORED**: the legacy reading is kept — the LAST
   *     digit run of the whole value. A format with no `{0..0}` slot renders a
   *     bare trailing counter, and values predating any format have no anchor to
   *     read from, so this stays exactly as it was. The SQL driver's legacy
   *     reading of this case differs on purpose, which is why it stays per-side.
   *
   * The two together are {@link readStoredAutonumberCounter}, module-level
   * rather than inline, because #6806's resync must read an exempt writer's
   * supplied value by exactly these rules.
   *
   * The suffix is *stripped when it matches*, never *required* to match: a
   * dynamic suffix renders differently per row (`{000}-{YYYY}` is `-2025` on
   * last year's rows) while the counter scope is the rendered PREFIX — here `''`
   * — so those rows share this very counter and must still be counted. Skipping
   * them would seed BELOW the real max, which is the duplicate-record-number
   * harm #6249 fixed on the scan side. Reading the leading digit run gets them
   * right regardless; the strip only adds precision when a suffix begins with a
   * digit (`{0000}{YYYY}`, whose values are ambiguous by construction — the
   * compile lint nudges authors to a delimiter).
   *
   * # Why this walks every row in the scope (#6249)
   *
   * The seed used to be one `find` with `limit: 5000`, no `orderBy` and no
   * filter: the max of an ARBITRARY 5000-row window (on SQL, typically the
   * oldest 5000 rows), which for any object past that size — or any scope
   * whose rows sit outside the window because other scopes filled it — seeds
   * BELOW the real MAX. The counter then issues numbers from an already-taken
   * band, and on a `unique` record-number field that is a duplicate business
   * identifier: a value written wrong, which no retry and no restart repairs
   * (the same class of harm as the read-outage half fixed in #5979/#6114).
   *
   * The scan is therefore complete rather than windowed, in the shape the
   * SQL driver's own seeding already uses (`scanMaxNumericTail` pushes
   * `like 'prefix%'` down with NO limit). Two deliberate choices:
   *
   *   - **The numeric max is computed here, never delegated to an ORDER BY or
   *     an aggregate `max`.** Both of those rank the stored value as TEXT, and
   *     lexicographic order equals numeric order only when every value in the
   *     scope is zero-padded to one fixed width — which the format language
   *     does not guarantee (`{0}` pads to nothing, and any width OVERFLOWS
   *     once the counter passes it, putting `CASE-99999` above `CASE-100000`).
   *     The empty-prefix legacy path, which reads the LAST digit run of the
   *     whole value, has no lexicographic reading at all. Parsing every value
   *     keeps one code path correct for every format instead of a fast path
   *     guarded by assumptions a format author can silently break.
   *   - **Seek pagination, not `offset`** — `keysetWalk`'s own rationale
   *     (#4363): an offset walk cannot promise it visited every row, and a
   *     row it skips is exactly a number this seed must not miss.
   *
   * `prefix` is pushed down as `$startsWith` so a date/`{field}` scope reads
   * its own rows instead of paging through every other scope's. The JS-side
   * `startsWith` re-check below is kept as the authority: a driver whose
   * matching is LOOSER (a case-insensitive `LIKE`) must not be able to inflate
   * the max with another scope's rows.
   */
  static async seedAutonumber(this: Pick<DefaultsAndAutonumbersHost, 'find'>, object: string, field: string, prefix: string, suffix: string, execCtx?: ExecutionContext): Promise<number> {
    try {
      // Canonical `fields`, not the wire spelling `select` — this call sat on
      // the exact #4371 silent drop (the projection never applied; the scan
      // worked only because an unprojected row still carries `field`), and the
      // catch below would have swallowed the guard's rejection into "seed
      // from 0", i.e. duplicate autonumbers.
      const walk = keysetWalk<Record<string, unknown>>(
        (q: KeysetPageQuery) => this.find(object, {
          // The walk spells its `where` `unknown` (this scan's filter AND-ed
          // with the seek predicate); it is read as the engine's `where` slot.
          ...(q as Omit<KeysetPageQuery, 'where'> & { where?: EngineQueryOptions['where'] }),
          fields: ['id', field],
          context: execCtx,
        }),
        {
          where: prefix ? { [field]: { $startsWith: prefix } } : undefined,
          pageSize: AUTONUMBER_SEED_PAGE_SIZE,
        },
      );
      let max = 0;
      for await (const page of walk.pages()) {
        for (const r of page) {
          const v = r?.[field];
          if (v == null) continue;
          // The reading itself lives in `readStoredAutonumberCounter` (the
          // section above describes it) because #6806's adopt-on-exempt-write
          // resync must read a supplied value by the SAME rules this scan reads
          // a stored one — two copies of it would drift into two different
          // answers for one row, which is a duplicate record number. Its
          // anchored half is spec's `readAutonumberCounter`, the one the SQL
          // driver's own scan calls (#6560).
          const counter = readStoredAutonumberCounter(String(v), prefix, suffix);
          if (counter != null) max = Math.max(max, counter);
        }
      }
      // The walk is unbounded (no `max`), so truncation here means the scan
      // could not COMPLETE: a row carried no `id` to seek past, or the reader
      // never applied the seek predicate. Either way rows were left unread, and
      // the max over what was read is a floor, not the max. Answering with it
      // is the "seed below the real MAX" defect this method was fixed for, so
      // it fails loudly instead — the same disposition #6114 gave the read
      // outage: allocate nothing, write nothing.
      if (walk.truncated) {
        throw new Error(
          `Cannot seed the autonumber counter for "${object}.${field}": the seeding scan ` +
            `could not visit every stored row (it stopped after ${walk.scanned} rows without ` +
            `reaching the end). Seeding from a partial scan would issue record numbers that ` +
            `collide with existing ones, so no number was allocated.`,
        );
      }
      return max;
    } catch (error) {
      // [#5979] Discriminate by error TYPE. Seeding from 0 is the truth for
      // exactly ONE failure reason — the table has not been provisioned, so
      // there are genuinely no rows and number 1 collides with nothing.
      if (isMissingTableError(error, object)) return 0;
      // Every other failure (connection drop, timeout, permission denial,
      // query error) means the rows may well exist and simply were not seen.
      // Answering 0 there restarts the sequence at 1 against a table already
      // holding N rows and issues autonumbers that COLLIDE with existing ones
      // — a value written wrong, which no retry and no restart repairs. So the
      // read failure propagates and the caller allocates nothing: the write
      // fails loudly instead of succeeding with a forged business identifier.
      // This is the hazard the #4371 comment above the read already named.
      throw error;
    }
  }
}
