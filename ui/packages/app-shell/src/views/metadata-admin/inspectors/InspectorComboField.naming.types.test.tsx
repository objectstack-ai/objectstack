// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `InspectorComboField`'s naming contract is enforced by the TYPE, so it is
 * pinned at compile time (objectui#3997).
 *
 * The atom accepts exactly one of `label` / `ariaLabel` / `id` — never zero,
 * never two. Zero is an anonymous `button[role=combobox]`: assistive tech reads
 * "combobox" with no idea which field it edits. Two is the double-announcement
 * failure objectui#3961/#3978 exists to avoid. Both were authorable before this
 * change, and five of the eleven live call sites had in fact authored zero.
 *
 * The reason this is a TYPE and not a runtime guard is that neither mistake has
 * a runtime symptom the component could detect and report: an unnamed combobox
 * renders, lays out and commits values perfectly. It is only wrong for the users
 * who cannot see it. So the check has to happen at authoring time or not at all.
 *
 * ## Why this file exists separately, and why it is listed
 *
 * The assertions below are its entire point, and
 * `packages/app-shell/tsconfig.test.json` is what makes them a pin rather than a
 * decoration: it compiles every `src/**\/*.test.tsx` in the package and is
 * chained off the package's `type-check` script. SOME such project is
 * load-bearing — the package's build tsconfig excludes `**\/*.test.tsx` and
 * vitest erases types before running, so with none of it a `@ts-expect-error`
 * would be read by NO compiler, failing neither when the error disappears nor
 * when it was never there. This file was drafted that way first and the mutation
 * run said so: making naming optional again produced a completely green
 * `tsc --noEmit`. That is objectui#3009's failure verbatim — assertions that
 * never ran, under a header calling them the real enforcement.
 *
 * What has changed is the SHAPE of that coverage, and it retires one reason this
 * file is separate. A narrow `tsconfig.typetests.json` used to name a handful of
 * files one by one, so the type-level cases were moved here, out of
 * `_shared.labels.test.tsx`, to sit on that list. Coverage is by glob now and
 * BOTH files are compiled (the package graduated in objectui#4040 and the narrow
 * project was retired with it), so the separation is a readability preference
 * today, not a requirement — a directive in either file is checked.
 *
 * The runtime `expect` at the bottom is deliberately thin: the DOM consequences
 * (which element carries the id, what the accessible name resolves to, that the
 * id never lands on the Radix `Popover` root) are pinned in
 * `_shared.labels.test.tsx`, which renders. This file only has to be a file
 * vitest can run without complaining that it holds no tests.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { InspectorComboField, type InspectorComboFieldProps } from './InspectorComboField';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

const OPTIONS = [{ value: 'profile', label: 'Profile' }];
const noop = (_v: string) => {};

/** Everything the combo needs EXCEPT a name. */
type Base = {
  value: string;
  onCommit: (v: string) => void;
  options: Array<{ value: string; label: string }>;
};

describe('InspectorComboField — naming is required, and singular (#3997)', () => {
  it('is pinned at compile time', () => {
    // Guard against the probe lying: were the props `any`, every assignability
    // assertion below would pass while proving nothing.
    type _PropsNotAny = Assert<Equal<IsAny<InspectorComboFieldProps>, false>>;

    // ── the three legal spellings ────────────────────────────────────────────
    // The atom renders the visible label and owns the `htmlFor` ⇄ `id` pair.
    type _LabelIsANaming = Assert<Extends<Base & { label: string }, InspectorComboFieldProps>>;
    // No visible label exists (repeated rows); the trigger names itself.
    type _AriaLabelIsANaming = Assert<Extends<Base & { ariaLabel: string }, InspectorComboFieldProps>>;
    // An external `<Label htmlFor={id}>` owns the naming; the id must reach the
    // trigger or that `for` dangles.
    type _IdIsANaming = Assert<Extends<Base & { id: string }, InspectorComboFieldProps>>;

    // ── zero naming channels is not authorable ───────────────────────────────
    // The regression this file exists for. Five call sites shipped this shape.
    type _AnonymousRejected = Assert<Equal<Extends<Base, InspectorComboFieldProps>, false>>;

    // ── two naming channels is not authorable either ─────────────────────────
    type _LabelPlusAriaRejected = Assert<
      Equal<Extends<Base & { label: string; ariaLabel: string }, InspectorComboFieldProps>, false>
    >;
    type _LabelPlusIdRejected = Assert<
      Equal<Extends<Base & { label: string; id: string }, InspectorComboFieldProps>, false>
    >;
    type _AriaPlusIdRejected = Assert<
      Equal<Extends<Base & { ariaLabel: string; id: string }, InspectorComboFieldProps>, false>
    >;

    // ── the same two rejections as a caller actually writes them ─────────────
    // Assignability above is the contract; JSX is the authoring surface, and
    // excess-property checking makes them differ often enough to pin both.
    const anonymous = (
      // @ts-expect-error objectui#3997 — a combo with no name must not compile.
      <InspectorComboField value="" options={OPTIONS} onCommit={noop} />
    );
    const doublyNamed = (
      // @ts-expect-error objectui#3997 — `label` and `ariaLabel` are exclusive.
      <InspectorComboField label="Group" ariaLabel="Group" value="" options={OPTIONS} onCommit={noop} />
    );

    expect([anonymous, doublyNamed].every(React.isValidElement)).toBe(true);
  });

  it('accepts each legal spelling as a real element', () => {
    // Keeps the three positive cases honest: an over-tight union that rejected a
    // shape a call site needs would fail here rather than only in CI's build.
    const labelled = <InspectorComboField label="Group" value="" options={OPTIONS} onCommit={noop} />;
    const ariaLabelled = <InspectorComboField ariaLabel="Group" value="" options={OPTIONS} onCommit={noop} />;
    const externallyLabelled = (
      <InspectorComboField id="widget-dataset" value="" options={OPTIONS} onCommit={noop} />
    );

    expect([labelled, ariaLabelled, externallyLabelled].every(React.isValidElement)).toBe(true);
  });
});
