/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8885 Part 2: `ObjectChartBlock`, the registry shell around
 * `ObjectChart`, gets a declared props type instead of `(props: any)`.
 *
 * Ruling 5810232641 (maintainer 「同意」), following the objectui#7912 /
 * objectui#7483 direction: a published component signature is never bare
 * `any`. The shell receives the node BEFORE `ElementDataSourceGate`, so its
 * `schema` is the registry renderer's raw node input, `BaseSchema`, and ⛔ not
 * the post-gate `ObjectChartSchema`. Every other prop is `ObjectChart`'s own,
 * so the type is closed.
 *
 * ## Why this pin is compile-time
 *
 * Nothing renders differently. What moved is the ACCEPT SET of a published
 * signature, and `tsconfig.test.json` compiles this file, so every statement
 * below is enforcement: a `@ts-expect-error` whose refusal stops happening
 * fails the build with TS2578. The shell is taken as a TYPE (`import type` plus
 * `declare const`), so no module side effect runs here and nothing below is
 * ever rendered. The probes live in a function that is never called.
 *
 * ## The ceiling, stated rather than assumed
 *
 * A closed PROPS type refuses a misspelled prop NAME. It did not refuse a
 * misspelled key INSIDE the node while `BaseSchema` carried
 * `[key: string]: any`; objectui#8347 removed it, and the counter-probe at the
 * bottom that kept that visible is flipped (see its note).
 */

import { describe, it, expect } from 'vitest';
import type * as ObjectChartModule from '../ObjectChart';
import type { ObjectChartProps } from '../ObjectChart';
import type { BaseSchema, ObjectChartSchema } from '@object-ui/types';

declare const ObjectChartBlock: typeof ObjectChartModule.ObjectChartBlock;
declare const adapter: unknown;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;

/** What the published shell declares it accepts. */
type ShellProps = Parameters<typeof ObjectChartModule.ObjectChartBlock>[0];

// ── The any-guard: the regression this card exists to stop ─────────────────
export type assertionShellParamIsNotAny = Expect<Equal<IsAny<ShellProps>, false>>;
export type assertionShellSchemaIsNotAny = Expect<Equal<IsAny<ShellProps['schema']>, false>>;

// ── The ruling's letter: pre-gate `BaseSchema`, never the post-gate type ────
export type assertionSchemaIsTheRawNode = Expect<Equal<ShellProps['schema'], BaseSchema>>;
export type assertionSchemaIsNotPostGate = Expect<Equal<Equal<ShellProps['schema'], ObjectChartSchema>, false>>;
/** The rest is `ObjectChart`'s own props, nothing more and nothing less. */
export type assertionRestIsObjectChartProps = Expect<
  Equal<Omit<ShellProps, 'schema'>, Omit<ObjectChartProps, 'schema'>>
>;

// ── The helpers can FAIL, so a vacuous `Equal` / `IsAny` cannot pass this file ─
export type assertionEqualCanFail = Expect<Equal<Equal<BaseSchema, ObjectChartSchema>, false>>;
export type assertionAnyProbeCanFire = Expect<Equal<IsAny<any>, true>>;

/*
 * The control nodes, each typed by the declaration its keys belong to, so a
 * control states what it is rather than riding `BaseSchema`'s passthrough
 * (objectui#11355). Each is handed to the shell's pre-gate `BaseSchema` prop as
 * a typed value, which is the claim the controls make: these nodes are legal
 * input to the shell.
 */
/** The `chart` alias registration hands this same shell an `object-chart` node under the alias tag. */
type ChartAliasNode = Omit<ObjectChartSchema, 'type'> & { type: 'chart' };
const chartAliasNode: ChartAliasNode = { type: 'chart', objectName: 'opportunity', chartType: 'bar' };
/** Only the spec's per-element binding; `ObjectChartSchema.dataSource` is that binding, by reference. */
const boundNode: ObjectChartSchema = { type: 'object-chart', dataSource: { object: 'opportunity', view: 'all' } };
const objectChartNode: ObjectChartSchema = { type: 'object-chart', objectName: 'opportunity', chartType: 'bar' };

/** Never called: compiled by `tsc -p tsconfig.test.json`, never rendered. */
const probes = () => (
  <>
    {/* P1: a misspelled prop NAME (`dataSource` spelled `dataSorce`). */}
    {/* @ts-expect-error — the props type is closed, so the misspelling is an excess property, not an `any` passed through. */}
    <ObjectChartBlock schema={{ type: 'object-chart' }} dataSorce={adapter} />
    {/* P2: `schema` itself misspelled, so the required prop is missing. */}
    {/* @ts-expect-error — `schema` is required. */}
    <ObjectChartBlock schem={{ type: 'object-chart' }} />
    {/* P3: a string where the node belongs. */}
    {/* @ts-expect-error — `schema` is a node (`BaseSchema`); a bare string is not one. */}
    <ObjectChartBlock schema="object-chart" />
    {/* P4: a node without `type`. */}
    {/* @ts-expect-error — `type` is required on every node; it is the registry key. */}
    <ObjectChartBlock schema={{ objectName: 'opportunity' }} />

    {/* C1 control: the `chart` alias registration's node. Refused by the
        post-gate `ObjectChartSchema` (whose `type` is the literal
        'object-chart'), and it must compile here: `index.tsx` registers this
        same shell under `chart`. */}
    <ObjectChartBlock schema={chartAliasNode} />
    {/* C2 control: a pre-gate node that carries only the spec's binding. The
        gate maps `dataSource.object` onto `objectName`, so the node is legal
        input before it has any `objectName` or `chartType` of its own. */}
    <ObjectChartBlock schema={boundNode} />
    {/* C3 control: `ObjectChart`'s own props still pass straight through the shell. */}
    <ObjectChartBlock
      schema={objectChartNode}
      dataSource={adapter}
      onSegmentClick={() => undefined}
    />

    {/* This row was the CEILING: a misspelled key INSIDE the node compiled
        through `BaseSchema`'s index signature. objectui#8347 removed it, so a
        fresh literal at the shell's pre-gate `BaseSchema` prop is excess-checked
        against `BaseSchema` itself: the misspelling is refused, and so would a
        correctly spelled `objectName` be. Hand the shell a typed node, as the
        controls above do. */}
    {/* @ts-expect-error — `objectNme` is no `BaseSchema` member, and the pre-gate prop is `BaseSchema` */}
    <ObjectChartBlock schema={{ type: 'object-chart', objectNme: 'opportunity' }} />
  </>
);

describe('ObjectChartBlock props: the pre-gate node, closed (objectui#8885)', () => {
  it('is a compile-time pin; the probes type-check under tsconfig.test.json and are never rendered', () => {
    expect(typeof probes).toBe('function');
  });
});
