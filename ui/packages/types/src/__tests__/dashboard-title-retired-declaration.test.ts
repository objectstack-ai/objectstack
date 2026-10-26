/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — dashboard-ROOT `DashboardComponentSchema.title` (objectui#7623).
 *
 * `title` was declared on objectui's own dashboard component type under the comment
 * "Dashboard title displayed in the header". objectui#7509 (PR #7622) retired all
 * five dashboard-root `title` read arms under ADR-0049, so the key became declared,
 * documented as rendering, and inert — the enforce-or-remove candidate this card
 * removes. The header text is the spec-canonical `label` on `BaseSchema`;
 * `plugin-dashboard` has no dashboard-root `title` read site left (pinned by that
 * package's `__tests__/dashboardAuthoredInputs.test.tsx`).
 *
 * ## Why this pin has ONE half, where objectui#5830's `aria` pin has two
 *
 * `dashboard-aria-retired-contract-twins.test.ts` is the model — same interface,
 * same removal shape — and its SECOND half asserts that the Zod twin refuses the
 * retired key BY NAME, because the spec turned `dashboard.aria` into a tombstone
 * that objectui inherits by reference through `SpecDashboardFields`.
 *
 * ⛔ That half does NOT transfer here, and writing it would be a fabrication.
 * `@objectstack/spec`'s strict `DashboardSchema` refuses a root `title` as an
 * UNRECOGNIZED key — there is no named removal message to inherit — and objectui's
 * twin (`zod/complex.zod.ts`) extends `.passthrough()` `BaseSchema`, so this
 * deletion changes no parse verdict at all. The spec's own refusal is already
 * measured where it belongs, against the spec schema:
 * `plugin-dashboard/src/__tests__/dashboardAuthoredInputs.test.tsx` asserts
 * `unrecognizedKeys(specVerdict({ title })).toContain('title')`. Ruled at dispatch
 * (2026-09-04): ship the key-set half only; do not invent a tombstone.
 *
 * ## The trap: why this is a key-set probe and NOT `@ts-expect-error`
 *
 * ⚠️ When this was written `BaseSchema` carried `[key: string]: any`, so an
 * authored `title:` on a dashboard literal STILL COMPILED after the member was gone
 * — it fell to the index signature, and a `@ts-expect-error` pin on an authored
 * literal could not stick. objectui#8347 removed that signature, so the literal is
 * refused now too; the key-set probe stays the pin because it reads the
 * DECLARATION, which an excess-key refusal on a literal cannot tell apart from a
 * `?: never` tombstone. The pinnable effect is that `title` stops being a DECLARED
 * member. The probe below
 * extracts the interface's literal key set — the index signature is filtered out by
 * `string extends K` — and asserts `title` is out while its neighbours stay in.
 * Real enforcement because `packages/types/tsconfig.test.json` is chained from this
 * package's `type-check` script (objectui#3009).
 */

import { describe, it, expect } from 'vitest';
import type { DashboardComponentSchema, DashboardWidgetSchema } from '../complex';

// Literal (declared) keys of T: `string extends K` is true only for the index
// signature's key, so mapping it to `never` leaves exactly the authored members.
type DeclaredKeys<T> = { [K in keyof T as string extends K ? never : K]: T[K] };
type Declared = keyof DeclaredKeys<DashboardComponentSchema>;
type WidgetDeclared = keyof DeclaredKeys<DashboardWidgetSchema>;

describe('the TS interface no longer declares a dashboard-root `title` (objectui#7623)', () => {
  it('`title` is not a declared member; the neighbours it stood beside still are', () => {
    // Type-level pin, erased at runtime: if the member came back, the first
    // annotation would collapse to `false` and this file would fail `type-check`.
    // (Reverse-verified at the PR: with the member restored, `tsc -p
    // tsconfig.test.json` goes red on exactly this line.)
    const titleNotDeclared: 'title' extends Declared ? false : true = true;
    // Positive controls through the same extraction: a probe that saw no members at
    // all would also report `title` absent. `columns` and `widgets` are what the
    // member was declared between; `header` owns the header block whose rendering
    // the deleted doc comment claimed.
    const columnsDeclared: 'columns' extends Declared ? true : false = true;
    const widgetsDeclared: 'widgets' extends Declared ? true : false = true;
    const headerDeclared: 'header' extends Declared ? true : false = true;
    expect(titleNotDeclared && columnsDeclared && widgetsDeclared && headerDeclared).toBe(true);
  });

  it('the WIDGET-level `title` is a different receiver and stays DECLARED', () => {
    // ⛔ Not the same key. `DashboardWidgetSchema.title` is the spec's `I18nLabel`,
    // live and read (`DashboardRenderer.tsx`, `DashboardGridLayout.tsx`,
    // `DashboardWithConfig.tsx`). Without this leg the pin above cannot tell the two
    // apart: a sweep that deleted BOTH spellings would still read green.
    const widgetTitleDeclared: 'title' extends WidgetDeclared ? true : false = true;
    const widgetIdDeclared: 'id' extends WidgetDeclared ? true : false = true;
    // Negative control on the widget extraction itself — it discriminates rather
    // than answering `true` for everything (which is what a key set degenerated to
    // bare `string` would do).
    const widgetNonKeyAbsent: 'objectui7623NotAKey' extends WidgetDeclared ? false : true = true;
    expect(widgetTitleDeclared && widgetIdDeclared && widgetNonKeyAbsent).toBe(true);
  });
});
