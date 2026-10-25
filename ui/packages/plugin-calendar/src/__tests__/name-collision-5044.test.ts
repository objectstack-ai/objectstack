/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-calendar` <-> `@object-ui/types` `CalendarEvent`
 * name-collision tripwire (objectui#5044). Sibling of
 * `spec-symbol-4650.test.ts` next door — same package, same verdict shape, a
 * different owner of the contested name.
 *
 * ## What collided
 *
 * Two structurally incompatible PUBLIC exports were both called
 * `CalendarEvent`:
 *
 *   - `@object-ui/types` — the AUTHORING event: `id: string`, `start` / `end`
 *     accepting ISO strings with `end` REQUIRED, plus a `description`. It is
 *     the declared payload of the host-only `onEventClick` callback.
 *   - `@object-ui/plugin-calendar` — the `CalendarView` component's RUNTIME
 *     event: `id: string | number`, `start: Date`, `end?: Date`, no
 *     `description`.
 *
 * Neither is assignable to the other (`id` and `start` each conflict), and IDE
 * auto-import chooses between two identical names by alphabetical order or
 * most-recent use. The wrong choice did not surface as "you imported from the
 * wrong package": it surfaced as a remote `TS2322: Type 'string' is not
 * assignable to type 'Date'` several lines away. That is measured, not
 * predicted — `packages/plugin-calendar/README.md`'s own example stayed
 * uncompilable straight through objectui#5010's import-path fix, because
 * neither name was fabricated and neither path was wrong.
 *
 * ## The ruling this pins (2026-08-19 maintainer ruling on objectui#5044)
 *
 * Option A, following the objectui#4650 precedent: the AUTHORING type keeps the
 * canonical name `CalendarEvent` (it is the spec-side contract name), the
 * RUNTIME type is renamed to `CalendarViewEvent`, and a `@deprecated`
 * `CalendarEvent` alias stays behind on the plugin barrel so existing importers
 * keep compiling. Option B (stop exporting the runtime type) was rejected as
 * breaking with unmeasurable external cost; option C (a docs note) was rejected
 * as leaving the trap armed.
 *
 * So the assertions below are about the PUBLISHED NAME SET and the shapes those
 * names denote. Behaviour does not change in this card and nothing here claims
 * it did — a test that renders a calendar cannot see any of this.
 *
 * ## Legs that do NOT discriminate, and are therefore not written
 *
 *   - Rendering a `CalendarView` with events: green before and after the
 *     rename, under either name. It measures the component, not the name set.
 *   - `typeof CalendarEvent` at runtime: both are TYPES, erased before vitest
 *     ever loads this file. There is no runtime value to probe, which is
 *     exactly why the pins below are compile-time.
 *
 * Compiled by this package's `tsconfig.test.json` (objectui#3181) — without
 * that, every `Assert<...>` below is erased before vitest runs and proves
 * nothing. That config also drops the root `paths`, so `@object-ui/types`
 * resolves through the workspace dependency's BUILT `.d.ts` — the surface a
 * consumer actually imports, not a sibling source tree.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The authoring event, from the package that KEEPS the canonical name.
import type { CalendarEvent as AuthoringCalendarEvent } from '@object-ui/types';
// The runtime event under its new self-describing name, AND the deprecated
// alias under the old one. This import statement is itself the "an importer of
// the old name still compiles" leg: if the alias stopped being a working
// export, this file would not compile.
import type { CalendarViewEvent, CalendarEvent as DeprecatedRuntimeAlias } from '../index';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
/** Is `A` assignable to `B`? Written as a type so a `false` can be asserted. */
type AssignableTo<A, B> = [A] extends [B] ? true : false;

describe('the CalendarEvent name collision stays resolved', () => {
  it('is pinned at compile time', () => {
    // A local type erased to `any` satisfies every assertion below while
    // proving nothing (objectstack#4171 is that failure for other symbols).
    type _RuntimeIsNotAny = Assert<Equal<IsAny<CalendarViewEvent>, false>>;
    type _AuthoringIsNotAny = Assert<Equal<IsAny<AuthoringCalendarEvent>, false>>;

    // 1. The two names now denote two DIFFERENT types. This is the whole card:
    //    one name, one contract.
    type _DistinctExports = Assert<Equal<Equal<AuthoringCalendarEvent, CalendarViewEvent>, false>>;

    // 2. ...and they are incompatible in BOTH directions, which is why sharing
    //    a name was a trap rather than a redundancy. If either of these ever
    //    starts holding, re-triage the pair instead of keeping the rename out
    //    of habit.
    type _RuntimeNotAssignableToAuthoring = Assert<
      Equal<AssignableTo<CalendarViewEvent, AuthoringCalendarEvent>, false>
    >;
    type _AuthoringNotAssignableToRuntime = Assert<
      Equal<AssignableTo<AuthoringCalendarEvent, CalendarViewEvent>, false>
    >;

    // 3. The deprecated alias denotes the SAME type as the new name — the whole
    //    promise it makes to importers that still spell the old one, and what
    //    keeps this rename non-breaking. A type-only stub (`= never`, `= any`,
    //    a re-declaration) would fail here.
    type _AliasIsSameType = Assert<Equal<DeprecatedRuntimeAlias, CalendarViewEvent>>;

    // 4. Each side still has the shape that made them incompatible, so the
    //    assertions above cannot go vacuous by one side quietly changing.
    type _RuntimeStartIsDate = Assert<Equal<CalendarViewEvent['start'], Date>>;
    type _RuntimeIdAcceptsNumber = Assert<Equal<CalendarViewEvent['id'], string | number>>;
    type _AuthoringIdIsString = Assert<Equal<AuthoringCalendarEvent['id'], string>>;
    type _AuthoringStartAcceptsIso = Assert<Equal<AuthoringCalendarEvent['start'], string | Date>>;
    // `description` is the authoring type's own key; the runtime event has no
    // such member. Reading it off the runtime type would be a compile error, so
    // the direction is asserted through `keyof`.
    type _AuthoringHasDescription = Assert<
      Equal<'description' extends keyof AuthoringCalendarEvent ? true : false, true>
    >;
    type _RuntimeHasNoDescription = Assert<
      Equal<'description' extends keyof CalendarViewEvent ? true : false, false>
    >;

    // The `Assert<...>` aliases above are the test. `expect` keeps vitest from
    // reporting an assertion-less test.
    expect(true).toBe(true);
  });

  it('keeps the old name marked deprecated at the export site', () => {
    // The alias is what makes this non-breaking; the `@deprecated` tag is what
    // makes it a FIX rather than a second live spelling. An IDE strikes the
    // deprecated completion through and ranks it last, which is the measurable
    // half of "auto-import stops offering two shapes under one name". Nothing
    // in the type system can see a JSDoc tag, so it is read off the barrel.
    const barrel = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.tsx'),
      'utf8',
    );

    const statement = "export type { CalendarViewEvent as CalendarEvent } from './CalendarView';";
    const at = barrel.indexOf(statement);
    expect(at, `${statement} not found in the barrel`).toBeGreaterThan(-1);

    // The JSDoc block that ends immediately above the alias export, with only
    // whitespace between it and the statement.
    const before = barrel.slice(0, at);
    const blockEnd = before.lastIndexOf('*/');
    expect(blockEnd, 'no JSDoc block precedes the alias export').toBeGreaterThan(-1);
    expect(before.slice(blockEnd + 2).trim()).toBe('');

    const blockStart = before.lastIndexOf('/**', blockEnd);
    const jsdoc = before.slice(blockStart, blockEnd + 2);
    expect(jsdoc).toContain('@deprecated');
    expect(jsdoc).toContain('CalendarViewEvent');
  });

  it('does not re-export the runtime event under the authoring name from `@object-ui/types`', () => {
    // The other half of "which type moved": the AUTHORING type keeps the
    // canonical name. If a future edit inverted this card by renaming the
    // authoring type instead, `@object-ui/types` would stop declaring
    // `CalendarEvent` and this would fail — the compile-time pins above would
    // not, because they read whatever that name resolves to.
    const typesSrc = readFileSync(
      join(uiRoot(), 'packages/types/src/complex.ts'),
      'utf8',
    );
    expect(typesSrc).toContain('export interface CalendarEvent {');
  });
});
