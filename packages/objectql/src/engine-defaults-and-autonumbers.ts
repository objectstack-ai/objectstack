// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Field defaults and autonumbers" section of `ObjectQL`:
 * the bodies of `resolveNowDefault`, `resolveOptionDefault`,
 * `applyFieldDefaults`, `defaultFieldEntries`, `applyAutonumbers`,
 * `adoptExplicitAutonumber`, `isIssuedAutonumberCollision`,
 * `warnAutonumberReadersUnserved`, `seedAutonumber` moved out of `engine.ts`
 * whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link DefaultsAndAutonumbersHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { isCurrentUserDefaultToken, isNowDefaultToken, missingFieldValues, parseAutonumberFormat, renderAutonumber, resolveAutonumberFormat } from '@objectstack/spec/data';
import { isUniqueViolationError, keysetWalk, uniqueViolationColumn } from '@objectstack/types';
import type { KeysetPageQuery } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { ExpressionEngine } from '@objectstack/formula';
import type { EvalPermissions } from '@objectstack/formula';
import {
  AUTONUMBER_SEED_PAGE_SIZE, declaredMultiValued, isExpressionDefault, readStoredAutonumberCounter,
} from './engine-top-level.js';
import type { FormulaPlanEntry, IssuedAutonumber } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface DefaultsAndAutonumbersHost {
  adoptExplicitAutonumber: ObjectQL['adoptExplicitAutonumber'];
  readonly autonumberCounters: ObjectQL['autonumberCounters'];
  readonly autonumberReadersUnservedReported: ObjectQL['autonumberReadersUnservedReported'];
  defaultFieldEntries: ObjectQL['defaultFieldEntries'];
  find: ObjectQL['find'];
  getSchema: ObjectQL['getSchema'];
  readonly logger: ObjectQL['logger'];
  normalizeExpressionDefault: ObjectQL['normalizeExpressionDefault'];
  resolveNowDefault: ObjectQL['resolveNowDefault'];
  resolveOptionDefault: ObjectQL['resolveOptionDefault'];
  seedAutonumber: ObjectQL['seedAutonumber'];
}

/** The body of `ObjectQL#resolveNowDefault`; the method's docblock there is its contract. */
export function resolveNowDefault(fieldType: unknown, instant: Date): string {
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

/** The body of `ObjectQL#resolveOptionDefault`; the method's docblock there is its contract. */
export function resolveOptionDefault(field: { type?: unknown; options?: unknown; multiple?: unknown }): unknown {
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

/** The body of `ObjectQL#applyFieldDefaults`; the method's docblock there is its contract. */
export function applyFieldDefaults(this: Pick<DefaultsAndAutonumbersHost, 'defaultFieldEntries' | 'logger' | 'normalizeExpressionDefault' | 'resolveNowDefault' | 'resolveOptionDefault'>, object: string, record: Record<string, unknown>, execCtx?: ExecutionContext, nowSnapshot?: Date, permissions?: EvalPermissions): Record<string, unknown> {
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

/** The body of `ObjectQL#defaultFieldEntries`; the method's docblock there is its contract. */
export function defaultFieldEntries(this: Pick<DefaultsAndAutonumbersHost, 'getSchema'>, object: string): Array<{
    name: string; type?: unknown; defaultValue?: unknown; options?: unknown; multiple?: unknown;
  }> | undefined {
    const fieldsRaw = (this.getSchema(object) as any)?.fields;
    if (!fieldsRaw || typeof fieldsRaw !== 'object') return undefined;
    // `fields` may be a Record<string, Field> (canonical) or an array (legacy).
    return Array.isArray(fieldsRaw)
      ? fieldsRaw
      : Object.entries(fieldsRaw).map(([name, def]) => ({ name, ...(def as object) }));
  }

/** The body of `ObjectQL#applyAutonumbers`; the method's docblock there is its contract. */
export async function applyAutonumbers(this: Pick<DefaultsAndAutonumbersHost, 'adoptExplicitAutonumber' | 'autonumberCounters' | 'getSchema' | 'seedAutonumber'>, object: string, record: Record<string, unknown>, execCtx?: ExecutionContext, driverOwnsAutonumber?: boolean): Promise<IssuedAutonumber[]> {
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

/** The body of `ObjectQL#adoptExplicitAutonumber`; the method's docblock there is its contract. */
export function adoptExplicitAutonumber(this: Pick<DefaultsAndAutonumbersHost, 'autonumberCounters' | 'logger'>, object: string, field: string, tokens: ReturnType<typeof parseAutonumberFormat>, record: Record<string, unknown>, value: string, now: Date, timezone?: string): void {
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

/** The body of `ObjectQL#isIssuedAutonumberCollision`; the method's docblock there is its contract. */
export function isIssuedAutonumberCollision(error: unknown, issued: IssuedAutonumber[]): boolean {
    if (issued.length === 0) return false;
    if (!isUniqueViolationError(error)) return false;
    const column = uniqueViolationColumn(error);
    if (column === undefined) return true;
    return issued.some((one) => one.field === column);
  }

/** The body of `ObjectQL#warnAutonumberReadersUnserved`; the method's docblock there is its contract. */
export function warnAutonumberReadersUnserved(this: Pick<DefaultsAndAutonumbersHost, 'autonumberReadersUnservedReported' | 'logger'>, object: string, plan: readonly FormulaPlanEntry[], driver: unknown): void {
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

/** The body of `ObjectQL#seedAutonumber`; the method's docblock there is its contract. */
export async function seedAutonumber(this: Pick<DefaultsAndAutonumbersHost, 'find'>, object: string, field: string, prefix: string, suffix: string, execCtx?: ExecutionContext): Promise<number> {
    try {
      // Canonical `fields`, not the wire spelling `select` — this call sat on
      // the exact #4371 silent drop (the projection never applied; the scan
      // worked only because an unprojected row still carries `field`), and the
      // catch below would have swallowed the guard's rejection into "seed
      // from 0", i.e. duplicate autonumbers.
      const walk = keysetWalk<Record<string, unknown>>(
        (q: KeysetPageQuery) => this.find(object, {
          ...q,
          fields: ['id', field],
          context: execCtx,
        } as any),
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
