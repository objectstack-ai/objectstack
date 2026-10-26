/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AnyComponentSchema`'s declaration stays well under TypeScript's
 * serialization ceiling, and every member it lists is named or inline on
 * purpose (objectui#11573).
 *
 * ## The defect these pin
 *
 * `tsc` prints an inferred type in full wherever a declaration uses it, and
 * past its serialization ceiling it refuses with TS7056 ("The inferred type of
 * this node exceeds the maximum length the compiler will serialize").
 * `@object-ui/types` then emits no declarations, and every consumer of
 * `@object-ui/types/zod` fails with TS7016. `AnyComponentSchema` lists every
 * category union, so its declaration printed the SUM of their prints. The
 * `Spec Main Shape Gate` (which compiles this repository against
 * `@objectstack/spec` built from objectstack `main`) went red with exactly that
 * on objectui#11570, and single arms had been named one TS7056 at a time before
 * it. objectui#11573 named the type of every category union instead; the why
 * is the "Why every category union's TYPE is named" section on
 * `AnyComponentSchema` in `../zod/index.zod.ts`.
 *
 * ## The instrument: the compiler's own counter, not a proxy
 *
 * The ceiling is a comparison inside TypeScript's node builder: it adds an
 * estimate to `approximateLength` for every node it prints and, under
 * `NoTruncation` (which declaration emit sets), reports TS7056 once that
 * exceeds `noTruncationMaximumTruncationLength`. Neither number is on the typed
 * public surface. What is reachable at run time is the builder's own
 * `maximumLength` parameter, which `checker.typeToTypeNode` passes straight
 * through: called with declaration emit's flags, the declaration's type and a
 * stated maximum, the builder reports truncation to the tracker exactly when the
 * counter crosses that maximum, so a search over the maximum reads the counter.
 * Both the parameter and the ceiling are internal, so the first assertion below
 * is a lit control: a maximum the declaration cannot fit under MUST report
 * truncation. If a TypeScript upgrade drops or moves the parameter, that control
 * goes red rather than this file going quietly green.
 *
 * ⚠️ The builder caches what it serialized per enclosing node, truncation
 * verdict included, so one search would read its own earlier answers. The
 * tracker answers `trackSymbol` with `true`, which marks the call as having
 * reported a diagnostic, and the builder caches nothing from such a call.
 *
 * ## The margin, and which spec it is read against
 *
 * The pin fails when the reading crosses {@link MARGIN} below the ceiling.
 * It runs under the INSTALLED `@objectstack/spec` (the lockfile's), while the
 * Spec Main Shape Gate compiles against objectstack `main`, which is ahead of
 * it. Before the naming, the two readings of this declaration differed by about
 * one percent of the ceiling, the size of a spec delta, and the gate was the
 * only one to see it; since the naming, the spec's shapes are printed inside
 * the named unions' own declarations, and the readings were equal on both specs
 * when objectui#11573 took them. The margin is a tenth of the ceiling: many times
 * that delta and many times the largest arm ever added inline, so a reading under
 * it here leaves the gate's compile under the ceiling with room to spare. The
 * readings themselves are in objectui#11573's pull request, not here: a figure
 * written into this comment would be derived once and never again.
 *
 * ## What each assertion catches
 *
 *   1. The lit control: the counter is reachable, so the reading can fail.
 *   2. The reading: `AnyComponentSchema`'s declaration under the margin.
 *   3. The enumeration: every member, in source order, as named (and by which
 *      name it prints) or inline. A new member, a member that loses its name,
 *      or a renamed type turns it red until it is classified here.
 *   4. The rule behind the enumeration: a member that is a category union
 *      (a `z.discriminatedUnion` of arms) prints by name. Single arms may stay
 *      inline; the reading in 2 bounds what they cost.
 *   5. The compile-time rows below the suites: each named type IS its union,
 *      so naming moved the printed text and no type a consumer reads.
 */

import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { z } from 'zod';
import { AnyComponentSchema } from '../zod/index.zod.js';
import type { AIComponentZodType } from '../zod/ai.zod.js';
import type { ComplexZodType } from '../zod/complex.zod.js';
import type { CRUDComponentZodType } from '../zod/crud.zod.js';
import type { DataDisplayZodType } from '../zod/data-display.zod.js';
import type { DesignerUnionZodType } from '../zod/designer.zod.js';
import type { DisclosureZodType } from '../zod/disclosure.zod.js';
import type { FeedbackZodType } from '../zod/feedback.zod.js';
import type { FormComponentZodType } from '../zod/form.zod.js';
import type { LayoutZodType } from '../zod/layout.zod.js';
import type { NavigationZodType } from '../zod/navigation.zod.js';
import type { ObjectQLComponentZodType, ObjectQLPublicBlockComponentZodType } from '../zod/objectql.zod.js';
import type { OverlayZodType } from '../zod/overlay.zod.js';
import type { PublicBlockComponentZodType } from '../zod/public-blocks.zod.js';
import type { ReportUnionZodType } from '../zod/reports.zod.js';
import type { ViewComponentZodType } from '../zod/views.zod.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(packageRoot, 'src', 'zod', 'index.zod.ts');

/** TypeScript's own ceiling, read from the compiler rather than restated here. */
const CEILING = (ts as unknown as { noTruncationMaximumTruncationLength: number }).noTruncationMaximumTruncationLength;

/** A tenth of the ceiling; the header says why it covers the gap to the gate's spec. */
const MARGIN = CEILING / 10;

/**
 * Declaration emit's node-builder flags: `MultilineObjectLiterals`,
 * `WriteClassExpressionAsTypeLiteral`, `UseTypeOfFunction`,
 * `UseStructuralFallback`, `AllowEmptyTuple`, `GenerateNamesForShadowedTypeParams`
 * and `NoTruncation`, which is the one that makes a crossing a TS7056.
 */
const DECLARATION_EMIT_FLAGS =
  ts.NodeBuilderFlags.MultilineObjectLiterals
  | ts.NodeBuilderFlags.WriteClassExpressionAsTypeLiteral
  | ts.NodeBuilderFlags.UseTypeOfFunction
  | ts.NodeBuilderFlags.UseStructuralFallback
  | ts.NodeBuilderFlags.AllowEmptyTuple
  | ts.NodeBuilderFlags.GenerateNamesForShadowedTypeParams
  | ts.NodeBuilderFlags.NoTruncation;

/** Declaration emit's internal flag (`AllowUnresolvedNames`); internal, so spelled as its value. */
const DECLARATION_EMIT_INTERNAL_FLAGS = 8;

/** The run-time signature `checker.typeToTypeNode` has beyond its typed three parameters. */
type TypeToTypeNodeAtRunTime = (
  type: ts.Type,
  enclosingDeclaration: ts.Node | undefined,
  flags: ts.NodeBuilderFlags,
  internalFlags: number,
  tracker: { trackSymbol(): boolean; reportTruncationError(): void },
  maximumLength?: number,
) => ts.TypeNode | undefined;

/** The package's own program, its build options, with the installed spec. */
function loadProgram(): ts.Program {
  const configPath = join(packageRoot, 'tsconfig.json');
  const readConfig = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readConfig.error) {
    throw new Error(ts.flattenDiagnosticMessageText(readConfig.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, packageRoot);
  return ts.createProgram([ENTRY], {
    ...parsed.options,
    noEmit: true,
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
  });
}

const program = loadProgram();
const checker = program.getTypeChecker();
const entryFile = program.getSourceFile(ENTRY);
if (!entryFile) throw new Error(`${ENTRY} is not in the program`);
const sourceFile: ts.SourceFile = entryFile;
const typeToTypeNode = checker.typeToTypeNode as unknown as TypeToTypeNodeAtRunTime;

/** Does `type`, printed as declaration emit prints it, fit under `maximumLength`? */
function fitsUnder(type: ts.Type, maximumLength: number): boolean {
  let truncated = false;
  typeToTypeNode(type, sourceFile, DECLARATION_EMIT_FLAGS, DECLARATION_EMIT_INTERNAL_FLAGS, {
    // `true` marks the call as having reported a diagnostic, so the builder
    // caches nothing from it (see the header).
    trackSymbol: () => true,
    reportTruncationError: () => {
      truncated = true;
    },
  }, maximumLength);
  return !truncated;
}

/**
 * The counter's reading: the smallest maximum `type` fits under, to within
 * `precision`, or `Infinity` past the ceiling.
 */
function readCounter(type: ts.Type, precision = 1): number {
  if (!fitsUnder(type, CEILING)) return Number.POSITIVE_INFINITY;
  let truncates = 0;
  let fits = CEILING;
  while (fits - truncates > precision) {
    const mid = Math.floor((truncates + fits) / 2);
    if (fitsUnder(type, mid)) fits = mid;
    else truncates = mid;
  }
  return fits;
}

/** The name a type prints by in `index.zod.ts`, or `undefined` when it prints inline. */
function printedName(type: ts.Type): string | undefined {
  const node = typeToTypeNode(type, sourceFile, DECLARATION_EMIT_FLAGS, DECLARATION_EMIT_INTERNAL_FLAGS, {
    trackSymbol: () => true,
    reportTruncationError: () => {},
  });
  if (node && ts.isTypeReferenceNode(node) && !node.typeArguments) {
    return ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text;
  }
  if (node && ts.isImportTypeNode(node) && !node.typeArguments && node.qualifier) {
    return ts.isIdentifier(node.qualifier) ? node.qualifier.text : node.qualifier.right.text;
  }
  return undefined;
}

/** `AnyComponentSchema`'s declaration, and the members its `z.discriminatedUnion` lists, from the AST. */
function readDeclaration(): { declaration: ts.VariableDeclaration; members: ts.Identifier[] } {
  let declaration: ts.VariableDeclaration | undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const d of statement.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === 'AnyComponentSchema') declaration = d;
    }
  }
  if (!declaration?.initializer) throw new Error('no `AnyComponentSchema` declaration in index.zod.ts');
  let list: ts.ArrayLiteralExpression | undefined;
  const find = (node: ts.Node): void => {
    if (list) return;
    if (
      ts.isCallExpression(node)
      && node.expression.getText(sourceFile) === 'z.discriminatedUnion'
      && node.arguments[1]
      && ts.isArrayLiteralExpression(node.arguments[1])
    ) {
      list = node.arguments[1];
      return;
    }
    ts.forEachChild(node, find);
  };
  find(declaration.initializer);
  if (!list) throw new Error('`AnyComponentSchema` lists no `z.discriminatedUnion` members');
  const members = list.elements.map((element) => {
    if (!ts.isIdentifier(element)) throw new Error(`a member that is not a plain name: ${element.getText(sourceFile)}`);
    return element;
  });
  return { declaration, members };
}

const { declaration, members } = readDeclaration();
const declarationType = checker.getTypeAtLocation(declaration.name);

/** Is the member a category union, that is a `z.discriminatedUnion` of arms? */
function isCategoryUnion(member: ts.Identifier): boolean {
  return checker.getPropertiesOfType(checker.getTypeAtLocation(member)).some((p) => p.getName() === 'options');
}

/** Every member, in source order: its kind, and the name it prints by, or `inline`. */
const table = members.map((member) => ({
  member: member.text,
  kind: isCategoryUnion(member) ? 'category union' : 'arm',
  printsAs: printedName(checker.getTypeAtLocation(member)) ?? 'inline',
}));

/** Read once, here: what the assertions below and their messages report. */
const reading = readCounter(declarationType);

/** What the members printed inline cost, to the nearest thousand, for the failure message. */
function inlineCosts(): string {
  return table
    .filter((row) => row.printsAs === 'inline')
    .map((row) => {
      const member = members.find((m) => m.text === row.member);
      return `${row.member} (${row.kind}): ${member ? readCounter(checker.getTypeAtLocation(member), 1000) : '?'}`;
    })
    .join('; ');
}

describe('`AnyComponentSchema` declaration emit headroom (objectui#11573)', () => {
  it('reads the compiler\'s own counter: a maximum the declaration cannot fit under reports truncation (lit control)', () => {
    expect(CEILING).toBeGreaterThan(0);
    expect(fitsUnder(declarationType, 100)).toBe(false);
    expect(fitsUnder(declarationType, CEILING)).toBe(true);
    // Non-vacuity: the reading is a real search result, strictly inside (100, ceiling].
    expect(reading).toBeGreaterThan(100);
    expect(reading).toBeLessThanOrEqual(CEILING);
  });

  it('stays at least a tenth of the ceiling below it', () => {
    expect(
      reading,
      `AnyComponentSchema's declaration reads ${reading} on the compiler's counter, past ${CEILING - MARGIN} `
      + `(the ceiling ${CEILING} less the margin ${MARGIN}). Members printed inline: ${inlineCosts()}. `
      + 'Name the type of whatever grew, as the category unions are named.',
    ).toBeLessThanOrEqual(CEILING - MARGIN);
  });

  it('lists every member as named, by the name it prints, or inline', () => {
    // The AST walk read the same members the union holds at run time.
    const runtimeOptions = (AnyComponentSchema as unknown as { options: unknown[] }).options;
    expect(members.length).toBe(runtimeOptions.length);
    expect(table).toEqual([
      { member: 'AppComponentSchema', kind: 'arm', printsAs: 'inline' },
      { member: 'AppSchemaRendererNodeSchema', kind: 'arm', printsAs: 'AppSchemaRendererNodeSchemaType' },
      { member: 'LayoutSchema', kind: 'category union', printsAs: 'LayoutZodType' },
      { member: 'PageKindNodeSchema', kind: 'arm', printsAs: 'PageKindNodeSchemaType' },
      { member: 'FormComponentSchema', kind: 'category union', printsAs: 'FormComponentZodType' },
      { member: 'DataDisplaySchema', kind: 'category union', printsAs: 'DataDisplayZodType' },
      { member: 'FeedbackSchema', kind: 'category union', printsAs: 'FeedbackZodType' },
      { member: 'DisclosureSchema', kind: 'category union', printsAs: 'DisclosureZodType' },
      { member: 'OverlaySchema', kind: 'category union', printsAs: 'OverlayZodType' },
      { member: 'NavigationSchema', kind: 'category union', printsAs: 'NavigationZodType' },
      { member: 'ComplexSchema', kind: 'category union', printsAs: 'ComplexZodType' },
      { member: 'ObjectQLComponentSchema', kind: 'category union', printsAs: 'ObjectQLComponentZodType' },
      {
        member: 'ObjectQLPublicBlockComponentSchema',
        kind: 'category union',
        printsAs: 'ObjectQLPublicBlockComponentZodType',
      },
      { member: 'CRUDComponentSchema', kind: 'category union', printsAs: 'CRUDComponentZodType' },
      { member: 'ReportUnionSchema', kind: 'category union', printsAs: 'ReportUnionZodType' },
      { member: 'ViewComponentSchema', kind: 'category union', printsAs: 'ViewComponentZodType' },
      { member: 'AIComponentSchema', kind: 'category union', printsAs: 'AIComponentZodType' },
      { member: 'DesignerUnionSchema', kind: 'category union', printsAs: 'DesignerUnionZodType' },
      { member: 'PublicBlockComponentSchema', kind: 'category union', printsAs: 'PublicBlockComponentZodType' },
      { member: 'RetiredCloudPlanStatusNodeSchema', kind: 'arm', printsAs: 'inline' },
      { member: 'CloudWorkspaceTimezoneNoticeSchema', kind: 'arm', printsAs: 'inline' },
      { member: 'RecordApprovalDecisionBlockSchema', kind: 'arm', printsAs: 'inline' },
      { member: 'RecordApprovalsBlockSchema', kind: 'arm', printsAs: 'inline' },
      { member: 'RecordAttachmentsBlockSchema', kind: 'arm', printsAs: 'inline' },
      { member: 'ProductBlockComponentSchema', kind: 'category union', printsAs: 'ProductBlockComponentZodType' },
    ]);
  });

  it('prints every category union by name', () => {
    expect(table.filter((row) => row.kind === 'category union' && row.printsAs === 'inline')).toEqual([]);
    // Non-vacuity: the kind test finds category unions at all, and an inline arm.
    expect(table.filter((row) => row.kind === 'category union').length).toBeGreaterThan(0);
    expect(table.some((row) => row.kind === 'arm' && row.printsAs === 'inline')).toBe(true);
  });
});

/*
 * Each named type IS its union: an interface that extends the union's inferred
 * type and adds no member, so what a consumer reads through `z.input` /
 * `z.output`, and the union's internals, are those of the discriminated union
 * over its own options. `tsc -p tsconfig.test.json` (the package's
 * `type-check`) is what evaluates these rows.
 */
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The discriminated union over `N`'s own options: what the named type must be. */
type UnionOver<N extends z.ZodDiscriminatedUnion> = z.ZodDiscriminatedUnion<N['options'], 'type'>;
type IsItsUnion<N extends z.ZodDiscriminatedUnion> = [
  Equal<z.input<N>, z.input<UnionOver<N>>>,
  Equal<z.output<N>, z.output<UnionOver<N>>>,
  Equal<N['_zod'], UnionOver<N>['_zod']>,
] extends [true, true, true] ? true : false;
/** The named type is the member `AnyComponentSchema` carries, so its derived types read it. */
type IsCarried<N> = Equal<Extract<(typeof AnyComponentSchema)['options'][number], N>, N>;
/**
 * Both, as one verdict. ⛔ Not `A & B`: `true & false` is `never`, and `never`
 * satisfies `Assert`'s `extends true`, so an intersection would pass a failing row.
 */
type NamesItsUnion<N extends z.ZodDiscriminatedUnion> =
  [IsItsUnion<N>, IsCarried<N>] extends [true, true] ? true : false;

type _Layout = Assert<NamesItsUnion<LayoutZodType>>;
type _FormComponent = Assert<NamesItsUnion<FormComponentZodType>>;
type _DataDisplay = Assert<NamesItsUnion<DataDisplayZodType>>;
type _Feedback = Assert<NamesItsUnion<FeedbackZodType>>;
type _Disclosure = Assert<NamesItsUnion<DisclosureZodType>>;
type _Overlay = Assert<NamesItsUnion<OverlayZodType>>;
type _Navigation = Assert<NamesItsUnion<NavigationZodType>>;
type _Complex = Assert<NamesItsUnion<ComplexZodType>>;
type _ObjectQLComponent = Assert<NamesItsUnion<ObjectQLComponentZodType>>;
type _ObjectQLPublicBlockComponent = Assert<NamesItsUnion<ObjectQLPublicBlockComponentZodType>>;
type _CRUDComponent = Assert<NamesItsUnion<CRUDComponentZodType>>;
type _ReportUnion = Assert<NamesItsUnion<ReportUnionZodType>>;
type _ViewComponent = Assert<NamesItsUnion<ViewComponentZodType>>;
type _AIComponent = Assert<NamesItsUnion<AIComponentZodType>>;
type _DesignerUnion = Assert<NamesItsUnion<DesignerUnionZodType>>;
type _PublicBlockComponent = Assert<NamesItsUnion<PublicBlockComponentZodType>>;

// Lit control: the rows distinguish two unions, so a named type that read another
// union's options, or added to what a consumer reads, could not pass them.
type _ControlAnotherUnionIsNotEqual = Assert<
  Equal<z.input<LayoutZodType>, z.input<UnionOver<FormComponentZodType>>> extends true ? false : true
>;
