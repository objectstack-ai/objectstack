#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * component-surface-parity -- where the FOUR declared surfaces of one
 * registered component type disagree.
 *
 * Run:  node scripts/check-component-surface-parity.mjs   (also `pnpm check:component-surface-parity`)
 *       node scripts/check-component-surface-parity.mjs --list      (every judged type, one line each)
 *       node scripts/check-component-surface-parity.mjs --type TYPE (one type, all four surfaces)
 *
 * Exit: 0 -- ALWAYS, disagreements included. See "REPORT-ONLY" below.
 *       1 -- only when the instrument could not read its own inputs
 *            ({@link ExtractionError}), which is never a pass.
 *
 * ## The authority order, which is a ruling and not this script's opinion
 *
 * objectui#4631, director seat batch #112 item 2, 2026-09-10. Quoted rather
 * than paraphrased because the ordering IS the specification:
 *
 *   spec 的 `ComponentPropsMap`(有声明时)> 渲染器实际读的键(实现)
 *   > TS 接口与注册表 `inputs`(实现的说明书,跟随)
 *
 *   门:`check:component-surface-parity`——TS 接口键集 = spec 键集 ∪ 渲染器读键集;
 *   `inputs` ⊆ 该集合;`defaultProps` 中作为设计器种子而非默认值的行须登记理由。
 *   report-only 起步,零分歧后翻阻断。
 *
 * So the rule this file mechanises, in one line: the TS interface key set is
 * the union of the spec key set and the renderer-read key set, `inputs` is a
 * subset of that union, and a `defaultProps` row that is a DESIGNER SEED rather
 * than a default claim has to say so out loud.
 *
 * ## REPORT-ONLY, and why that is the ruling rather than timidity
 *
 * The ruling's own sequencing is 「report-only 起步,零分歧后翻阻断」 -- start
 * report-only, flip to blocking once the census reads zero. This script
 * therefore exits 0 with findings, and the flip is a separate card measured
 * against the census in the pull request that landed this file. ⛔ Do not
 * change the exit discipline here to "fix" a red pipeline; there is no pipeline
 * wired to it yet, deliberately.
 *
 * ⛔ Repairing a disagreement this script finds is ALSO not this file's job and
 * was out of scope when it was built. The same ruling carries an ordering note
 * (objectui#4631, 2026-09-10T11:0xZ) that governs every repair: 先判协议对不对
 * -- decide whether the PROTOCOL is right first, and where it is not, the spec
 * card goes first. A repair chosen here would be choosing an arm of that
 * ordering by mechanism instead of by ruling.
 *
 * ## The failure mode being measured
 *
 * An author following any ONE of the four surfaces can still render blank, with
 * no error anywhere. `tooltip` was the specimen: `TooltipSchema` declared
 * `children` REQUIRED and the renderer read `schema.trigger`, so the published
 * TypeScript type -- the thing an editor completes from and an AI authoring
 * tool retrieves -- taught a key nothing reads. It type-checked. It rendered
 * nothing. No red tile, no warning, no gate.
 *
 * ## What this gate is NOT, so it is not mistaken for its neighbours
 *
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` reconciles
 * registry `inputs` against the spec's `ComponentPropsMap` -- two of these four
 * surfaces -- from the LIVE registry, by importing the real registration graph.
 * It owns that pair, in both directions, with its own exemption discipline, and
 * this script neither repeats nor contradicts it:
 *
 *   - that test judges `inputs` vs SPEC. This one judges `inputs` vs the UNION
 *     (spec ∪ renderer reads), which is the ruling's accept set and is strictly
 *     wider -- so a key this script passes may still be judged there, and the
 *     test stays the authority on the spec-only direction.
 *   - that test cannot see the two surfaces this one exists for: the TS
 *     interface in `packages/types`, and what the renderer actually READS. A
 *     live registry holds neither.
 *   - it reads a RUNTIME registry, this one reads SOURCE. A lazily registered
 *     block is a stub at runtime; in source its `register()` call is right
 *     there. The two populations therefore differ on purpose.
 *
 * `scripts/check-handler-key-read-sites.mjs` is the same read-site question
 * narrowed to `on*` handler keys and judged against the ZOD arms; it BLOCKS.
 * This script deliberately reuses that gate's extraction primitives (see the
 * import block) rather than growing a fourth copy of "which files ship" and
 * "which registrations exist" -- but it judges every key, not the handler ones,
 * and against the TS interface rather than the zod mirror.
 *
 * `scripts/check-designer-field-key-parity.mjs` is field-definition parity on
 * the metadata designer's write path. Unrelated population, unrelated oracle.
 *
 * ## The four surfaces, and where each is read FROM
 *
 *   1. SPEC      `ComponentPropsMap[fullType]` from the installed
 *                `@objectstack/spec/ui`, read through a dynamic `import()` for
 *                the same provenance reason its sibling states: a
 *                CJS-resolving gate cannot be proven by identity to be reading
 *                the build the app bundles against. An entry that is
 *                `z.never()` DECLARES the type with an empty key set (that is
 *                what `user:profile` means) -- it is not a missing entry.
 *   2. READS     every `schema.<key>` / `<props>.<key>` property access, every
 *                `schema['<key>']` element access and every destructured
 *                binding of `schema`, reachable from the registered component
 *                -- through same-file declarations, one-level aliases, the HOC
 *                spelling, static relative imports inside the package, and the
 *                `<Child schema={…}>` chain. Plus the FRAMEWORK reads, derived
 *                below.
 *   3. INTERFACE the `XSchema` named by the registered component's `schema`
 *                parameter, resolved in `packages/types/src`, unioned along
 *                `extends` / `&` within that package and stopping at
 *                {@link BASE_INTERFACE}.
 *   4. INPUTS    the `inputs: [{ name }]` array of the `register()` meta, plus
 *                its `defaultProps` object, read off the call site.
 *
 * ## The FRAMEWORK read set is DERIVED, never listed
 *
 * `className`, `visible`, `dataSource`, `testId` and their neighbours are read
 * off EVERY schema by the render loop, not by the block's own renderer. Listing
 * them here would be a second copy of a set that moves -- AGENTS.md #9 exactly.
 * They are read out of {@link FRAMEWORK_READ_SOURCE}: its `schema.<key>` /
 * `evaluatedSchema.<key>` accesses, and the binding names of every object
 * destructure of those two. A run whose framework set comes back EMPTY is an
 * {@link ExtractionError}, because an empty one turns every `className` in the
 * tree into a finding -- confidently red over a broken instrument, which is the
 * same defect as a confident green.
 *
 * ## `defaultProps`: one face or two, which is the question the card asked
 *
 * A `defaultProps` row sitting beside a renderer fallback for the same key is a
 * COMPARABLE PAIR. Where the two literals differ the two faces disagree -- but
 * not every disagreement is a defect, and that is the distinction the ruling
 * asked for: `defaultProps` is a designer SEED as much as a default claim. A
 * seed of `''` for a markdown body is useless; a seed is what makes a
 * freshly-dropped component look like something. So a row whose divergence is
 * deliberate must carry a REGISTERED REASON in {@link DESIGNER_SEED_ROWS} --
 * and a registered row whose pair no longer diverges is reported as STALE, so
 * the ledger cannot rot into a permanent allowlist.
 *
 * ## Limits, stated rather than discovered later
 *
 *   - ⛔ DYNAMICALLY TYPED REGISTRATIONS ARE OUTSIDE THE CENSUS, and this is the
 *     largest exclusion in it. A factory that calls
 *     `ComponentRegistry.register(tag, …)` inside a loop registers one component
 *     type per iteration and this reader can name NONE of them -- the key exists
 *     only at run time. The families behind those call sites (`ui:HTML-TAG` from
 *     the html-element and semantic factories, `field:*` from the field-widget
 *     map) are not in the judged count and produce no finding. They are reported
 *     as the `dynamicRegistrations` coverage bucket, with every call site printed
 *     -- because a later card reading "zero" over a population that never
 *     contained them would be reading nothing at all. ⛔ Enumerating the loops by
 *     guessing is worse than naming the exclusion: a half-enumerated family is a
 *     census nobody can reconstruct. objectui#4631 review, F1.
 *   - ⛔ THE SPEC ARM CAN BE INERT, and the run says so when it is. Only a type
 *     with BOTH a `ComponentPropsMap` entry and a resolvable interface can
 *     produce a spec-caused `interface-missing-key`; the counters print that
 *     INTERSECTION beside its two halves, and shout when it is zero. Where it is
 *     zero the spec half only ever widens the accept set -- it suppresses, never
 *     raises. objectui#4631 review, F2.
 *   - `register()` splices `ELEMENT_DATA_SOURCE_INPUT` into `inputs` at RUNTIME
 *     for a block wrapping `ElementDataSourceGate`
 *     (`withElementDataSourceInput`). A source read cannot see it. The key it
 *     splices is `dataSource`, which the framework set already carries, so the
 *     effect is bounded -- but an `inputs` census taken here is the SOURCE one.
 *   - a registration whose component this walk cannot resolve to a body, and an
 *     interface it cannot name or find, are reported as COVERAGE GAPS in their
 *     own buckets and are never silently counted as "no reads" / "no keys". A
 *     zero read set read as truth would report every declared key as extra.
 *   - `schema: any` is not an interface. It is counted as unresolved. Nor is
 *     `schema: BaseSchema`: it resolves, but to an interface with no OWN
 *     members, so such a block can never produce `interface-extra-key`. The
 *     counters name that subset inside the "with a TS interface" number rather
 *     than letting it read as full coverage. objectui#4631 review, F5.
 *   - a rule is only as good as its own coverage gap is guarded. Both interface
 *     rules skip a type whose interface did not resolve, and the `inputs` rule
 *     skips a type whose RENDERER did not resolve, for the identical reason: an
 *     empty read set read as truth reports every declared key as outside the key
 *     set. Those rows stay in the `rendererUnresolved` bucket. objectui#4631
 *     review, F3.
 *   - value TYPES are out of reach here, as they are for every key-name parity
 *     check in this tree: a key in perfect name parity whose declared type is
 *     narrower than the contract passes.
 */

import ts from "typescript";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { isEntrypoint } from "./invoked-as.mjs";
import {
  parseSource,
  populationFiles,
  declarationsIn,
  relativeImportsIn,
  documentCarryingChildren,
} from "./check-handler-key-read-sites.mjs";
// The tree's one answer to "which component keys does this source register"
// (objectui#4894). It is used HERE as an independent cross-check rather than as
// the reader: it returns KEYS, and this gate needs the meta argument and the
// component argument of the same call. A file where the AST walk below sees
// FEWER register calls than that reader counts is an ExtractionError -- which
// is the non-vacuity control for the one number every finding is divided by.
import { findComponentRegistrations } from "./component-registrations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** A gate that cannot read its inputs. Never a pass. */
export class ExtractionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractionError";
  }
}

const fail = (message) => {
  throw new ExtractionError(message);
};

/**
 * The render loop. Its reads belong to EVERY schema, so they are the floor of
 * every type's read set rather than any one block's.
 */
export const FRAMEWORK_READ_SOURCE = "packages/react/src/SchemaRenderer.tsx";

/**
 * The receivers the framework scan treats as "the authored document".
 *
 * Scoped to {@link FRAMEWORK_READ_SOURCE}, where all three name it: the
 * parameter (`schema`), the evaluated copy (`evaluatedSchema`) and the
 * `const node = evaluatedSchema` the styling memo reads `node.className` off.
 * That last one is why the set is not just `schema`: the render loop's
 * `className` read is spelled on `node`, and a framework set missing it turns
 * every `className` in the tree into a finding.
 */
const FRAMEWORK_RECEIVERS = new Set(["schema", "evaluatedSchema", "node"]);

/**
 * The interface every schema type extends. Its members are INHERITED, not own
 * -- and the ruling puts its `body`/`children` twins and its
 * `[key: string]: any` index signature on their OWN card, explicitly not bound
 * to this gate. So they are carried as an inherited set (a key declared there
 * is declared, and never reported as missing) and are never reported as EXTRA,
 * which would be this gate judging that other card.
 */
export const BASE_INTERFACE = "BaseSchema";

/** Where the TS schema interfaces live. */
export const TYPES_SRC = "packages/types/src";

/**
 * The accessor that turns the authored document into an `element:*` config bag.
 *
 * `readProps(schema)` returns `{ ...schema.props, ...schema.properties }` -- the
 * tree's ONE definition of that bag (objectui#6783 converged five copies behind
 * it). So `const props = readProps(schema); props.items` IS a read of an
 * authored key, and a walk that only followed `schema.<key>` would report the
 * whole `element:*` family as reading nothing at all and publishing `inputs`
 * for keys nobody reads -- the largest false-positive class this gate could
 * have shipped.
 *
 * Named rather than derived, and that is the honest limit: a SECOND accessor
 * minted tomorrow is invisible here until it is added. It is one name because
 * objectui#6783 made it one name, and
 * `packages/plugin-detail/src/renderers/record-alert.readProps.ts` is the same
 * spelling of the same thing.
 */
const CONFIG_BAG_READERS = new Set(["readProps"]);

/**
 * `defaultProps` rows whose divergence from the renderer fallback is DELIBERATE
 * -- a designer seed, not a default claim -- keyed `<fullType>.<key>`.
 *
 * ⛔ An entry here is not a repair and does not make the row agree. It records
 * that a human decided the two faces mean different things at that row. A row
 * whose pair no longer diverges is reported STALE by {@link analyze} and the
 * entry must be DELETED rather than kept.
 *
 * Empty on landing, on purpose: populating it would be adjudicating the rows
 * the census finds, which objectui#4631's dispatch put out of scope for the
 * card that built this file. The census in that card's pull request is what a
 * later card ratchets against.
 */
export const DESIGNER_SEED_ROWS = {};

/* ───────────────────────── source-level primitives ───────────────────────── */

const lineOf = (node) =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

const rel = (root, file) => relative(root, file).split(sep).join("/");

/**
 * The name a receiver denotes once every TYPE-ONLY wrapper is peeled off it.
 * `(schema as any).x`, `schema!.x` and `schema.x` emit the same access, so a
 * census that sees one and not the others is not describing the runtime.
 */
function erasedName(expression) {
  let current = expression;
  for (let hop = 0; hop < 8; hop += 1) {
    if (ts.isIdentifier(current)) return current.text;
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return null;
  }
  return null;
}

/** Functions reachable from `node` without crossing another function boundary. */
function outermostFunctions(node) {
  const functions = [];
  const walk = (current) => {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      functions.push(current);
      return;
    }
    ts.forEachChild(current, walk);
  };
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  )
    return [node];
  walk(node);
  return functions;
}

/**
 * The component's OWN props receivers: a plain `(props)` parameter and the
 * `...props` rest of a destructured one, on the outermost functions only.
 *
 * Scoped to the outermost functions for the reason its sibling gate measured:
 * taking every nested arrow's parameters made a `.map((child) => child.onClick)`
 * read as a read of the BOARD's key rather than a menu item's.
 */
function propsReceiverNames(node) {
  const names = new Set();
  for (const fn of outermostFunctions(node)) {
    for (const parameter of fn.parameters) {
      if (ts.isIdentifier(parameter.name)) {
        names.add(parameter.name.text);
        continue;
      }
      if (ts.isObjectBindingPattern(parameter.name)) {
        for (const element of parameter.name.elements) {
          if (element.dotDotDotToken && ts.isIdentifier(element.name))
            names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

/**
 * Locals bound to the authored document's config bag -- `const props =
 * readProps<T>(schema)`. See {@link CONFIG_BAG_READERS}.
 */
function configBagNames(node) {
  const names = new Set();
  const walk = (current) => {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      ts.isCallExpression(current.initializer) &&
      ts.isIdentifier(current.initializer.expression) &&
      CONFIG_BAG_READERS.has(current.initializer.expression.text)
    ) {
      names.add(current.name.text);
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return names;
}

/**
 * Does this renderer forward the props it did NOT name, with a rest spread?
 *
 * `ui:switch` is the specimen: it names `schema.wrapperClass`, `schema.id` and
 * `schema.label`, destructures the designer attributes off `...props`, and hands
 * everything left to `<Switch {...toFormControlDomProps(switchProps)} />`. So
 * `checked` -- declared on `SwitchSchema`, published in `inputs` -- IS honoured,
 * and is read by NO named access anywhere.
 *
 * That is a real shape and a real ambiguity, so it is recorded as a FLAG on the
 * type rather than silently widening the read set (which would hide every
 * genuinely-unread key on the same renderer) or silently ignored (which would
 * report an honoured key as unread). A finding on a type carrying this flag says
 * so in its own text.
 */
function forwardsRestProps(node) {
  const restNames = new Set();
  const collect = (current) => {
    if (ts.isObjectBindingPattern(current)) {
      for (const element of current.elements) {
        if (element.dotDotDotToken && ts.isIdentifier(element.name)) restNames.add(element.name.text);
      }
    }
    ts.forEachChild(current, collect);
  };
  collect(node);
  if (restNames.size === 0) return false;

  let forwarded = false;
  const seek = (current) => {
    if (forwarded) return;
    const names = (expression) => {
      const found = [];
      const inner = (e) => {
        if (ts.isIdentifier(e)) found.push(e.text);
        ts.forEachChild(e, inner);
      };
      inner(expression);
      return found;
    };
    if (ts.isJsxSpreadAttribute(current) || ts.isSpreadAssignment(current) || ts.isSpreadElement(current)) {
      if (names(current.expression).some((name) => restNames.has(name))) forwarded = true;
    }
    ts.forEachChild(current, seek);
  };
  seek(node);
  return forwarded;
}

/** `{ a, b: c, ...rest }` -> the AUTHORED key names (`a`, `b`), rest excluded. */
function bindingKeys(pattern) {
  const keys = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) continue;
    const named = element.propertyName ?? element.name;
    if (ts.isIdentifier(named) || ts.isStringLiteral(named)) keys.push(named.text);
  }
  return keys;
}

/**
 * Every authored key read inside one node, split into two channels because
 * they carry DIFFERENT certainty and the ruling's rule only binds one of them.
 *
 *   named    -- `schema.k`, `schema?.k`, `(schema as any).k`, `schema['k']`,
 *               `const { k } = schema`, `({ schema: { k } })` and the
 *               `readProps(schema)` config bag. Unambiguous: the renderer
 *               names the authored key. This is the channel the TS interface
 *               must cover.
 *   viaProps -- the bindings of the registered component's own destructured
 *               PROPS parameter. `SchemaRenderer` spreads the document's
 *               non-metadata keys as React props, so `PageHeader({ title })`
 *               really is reading an authored key -- but the SAME position
 *               also carries props a parent supplies (`context`, `ref`), and
 *               nothing in the source tells the two apart. So it WIDENS what
 *               `inputs` may publish and what the interface may declare, and
 *               never makes an interface owe a declaration.
 *
 * Collected only where `propsAreDocument` -- i.e. on the registered component
 * itself. A component reached through the `<Child schema={…}>` chain receives
 * props its PARENT chose: counting `DataTableRowActionsMenu({ schema, row, t })`
 * would have billed `row` and `t` to `ui:data-table` as authored keys.
 *
 * @returns {{named: Map<string, number>, viaProps: Map<string, number>}}
 */
export function schemaReadsIn(node, { propsAreDocument = false } = {}) {
  const receivers = new Set(["schema", ...propsReceiverNames(node), ...configBagNames(node)]);
  const named = new Map();
  const viaProps = new Map();
  const note = (key, at) => {
    if (typeof key === "string" && key && !named.has(key)) named.set(key, lineOf(at));
  };
  const noteProps = (key, at) => {
    if (typeof key === "string" && key && !viaProps.has(key)) viaProps.set(key, lineOf(at));
  };

  // A destructured PROPS parameter reads every key it binds, and a destructured
  // `schema:` slot reads every key inside it.
  //
  // The first half is not a convenience: `SchemaRenderer` spreads the document's
  // non-metadata keys as React props, so `PageHeader({ title, subtitle, icon })`
  // is reading three authored keys by name and never writes `schema.` once. A
  // walk blind to it reports the block's own `inputs` as publishing keys nobody
  // reads. It over-counts where a parameter carries something that is NOT an
  // authored key (`context`, `ref`) -- the conservative direction for a
  // report-only census, and stated here rather than discovered.
  for (const fn of outermostFunctions(node)) {
    for (const parameter of fn.parameters) {
      if (!ts.isObjectBindingPattern(parameter.name)) continue;
      if (propsAreDocument) {
        for (const key of bindingKeys(parameter.name)) noteProps(key, parameter);
      }
      for (const element of parameter.name.elements) {
        const named = element.propertyName ?? element.name;
        const isSchemaSlot = ts.isIdentifier(named) && named.text === "schema";
        if (isSchemaSlot && ts.isObjectBindingPattern(element.name)) {
          for (const key of bindingKeys(element.name)) note(key, element);
        }
      }
    }
  }

  const walk = (current) => {
    if (
      ts.isPropertyAccessExpression(current) &&
      receivers.has(erasedName(current.expression))
    ) {
      note(current.name.text, current);
    }
    if (
      ts.isElementAccessExpression(current) &&
      receivers.has(erasedName(current.expression)) &&
      current.argumentExpression &&
      ts.isStringLiteral(current.argumentExpression)
    ) {
      note(current.argumentExpression.text, current);
    }
    // `const { a, b } = schema`
    if (
      ts.isVariableDeclaration(current) &&
      ts.isObjectBindingPattern(current.name) &&
      current.initializer &&
      receivers.has(erasedName(current.initializer))
    ) {
      for (const key of bindingKeys(current.name)) note(key, current);
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return { named, viaProps };
}

/** A literal this gate can compare across two faces, or `null`. */
function literalValue(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return JSON.stringify(node.text);
  if (ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand))
    return `${ts.tokenToString(node.operator)}${node.operand.text}`;
  return null;
}

/**
 * The renderer's own fallback for a key: the right-hand literal of
 * `schema.k || LIT` / `schema.k ?? LIT`, or the default of a destructured
 * `const { k = LIT } = schema`.
 *
 * Only LITERAL fallbacks are comparable -- `schema.k || computeIt()` says
 * nothing a `defaultProps` row can be compared against, and is recorded as
 * "has a fallback, not comparable" rather than as agreement.
 *
 * @returns {Map<string, {literal: string|null, line: number}>}
 */
export function fallbacksIn(node) {
  const receivers = new Set(["schema", ...propsReceiverNames(node), ...configBagNames(node)]);
  const found = new Map();
  const note = (key, literal, at) => {
    if (!key || found.has(key)) return;
    found.set(key, { literal, line: lineOf(at) });
  };

  const keyOfRead = (expression) => {
    if (
      ts.isPropertyAccessExpression(expression) &&
      receivers.has(erasedName(expression.expression))
    )
      return expression.name.text;
    return null;
  };

  const walk = (current) => {
    if (ts.isBinaryExpression(current)) {
      const op = current.operatorToken.kind;
      if (
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        const key = keyOfRead(
          ts.isParenthesizedExpression(current.left) ? current.left.expression : current.left
        );
        if (key) note(key, literalValue(current.right), current);
      }
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isObjectBindingPattern(current.name) &&
      current.initializer &&
      receivers.has(erasedName(current.initializer))
    ) {
      for (const element of current.name.elements) {
        if (!element.initializer) continue;
        const named = element.propertyName ?? element.name;
        if (ts.isIdentifier(named) || ts.isStringLiteral(named))
          note(named.text, literalValue(element.initializer), current);
      }
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
}

/**
 * Top-level declarations by name, keeping the FUNCTION node for a function
 * declaration rather than its body.
 *
 * `declarationsIn` (the sibling gate's) hands back the BODY for that form,
 * which is right for a read walk and wrong for this one: the `schema` parameter
 * whose type names the interface lives on the function, not in the body.
 */
function declarationNodesIn(sourceFile) {
  const declarations = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          declarations.set(declaration.name.text, declaration.initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return declarations;
}

/** `./ObjectKanban` from a file -> that file, when it is in the package walk. */
function resolveRelative(fromFile, specifier, filesInPackage) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  const rewritten = base.replace(/\.(m?js)$/, "");
  if (rewritten !== base) candidates.push(`${rewritten}.tsx`, `${rewritten}.ts`);
  for (const candidate of candidates) if (filesInPackage.has(candidate)) return candidate;
  return null;
}

/* ───────────────────────────── the four surfaces ─────────────────────────── */

/**
 * Every `ComponentRegistry.register('<type>', Component, meta)` call in a file,
 * with the two arguments the sibling reader drops.
 *
 * @returns {Array<{type: string, fullType: string, component: ts.Node, meta: ts.ObjectLiteralExpression|null, line: number}>}
 */
export function registrationSitesIn(sourceFile) {
  const sites = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "register" &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "ComponentRegistry"
      ) {
        const [typeArgument, componentArgument, metaArgument] = node.arguments;
        // A backtick key is a plain literal too, and `component-registrations.mjs`
        // reads all three quote characters (objectui#4894). Accepting only
        // `ts.isStringLiteral` here would drop a real registration AND trip this
        // gate's own cross-check -- correct, but for the wrong reason.
        const readableKey =
          typeArgument &&
          (ts.isStringLiteral(typeArgument) || ts.isNoSubstitutionTemplateLiteral(typeArgument));
        if (readableKey && componentArgument) {
          const meta =
            metaArgument && ts.isObjectLiteralExpression(metaArgument) ? metaArgument : null;
          const namespace = meta ? stringProperty(meta, "namespace") : null;
          sites.push({
            type: typeArgument.text,
            fullType: namespace ? `${namespace}:${typeArgument.text}` : typeArgument.text,
            component: componentArgument,
            meta,
            line: lineOf(node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return sites;
}

/**
 * Every `ComponentRegistry.register(SOMETHING, …)` call whose type argument is
 * not a readable literal -- the factory registrations.
 *
 * `register(tag, Component, …)` inside `for (const tag of TAGS)` registers one
 * component type per iteration, and this reader can name none of them: the key
 * exists only at run time. Enumerating the loop is not mechanical (the list may
 * be imported, filtered, or built from a record), so the honest answer is to
 * report the CALL SITE and the expression it registers under, and to say in the
 * corpus note that these families are outside the census.
 *
 * ⛔ Never resolved by guessing. A census that half-enumerated `TAGS` would be
 * worse than one that names the exclusion: a later ratchet reading "zero" would
 * be reading zero over a population nobody can reconstruct.
 */
export function dynamicRegistrationsIn(sourceFile, root, file) {
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "register" &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "ComponentRegistry"
      ) {
        const [typeArgument] = node.arguments;
        const readable =
          typeArgument &&
          (ts.isStringLiteral(typeArgument) || ts.isNoSubstitutionTemplateLiteral(typeArgument));
        if (typeArgument && !readable) {
          found.push({
            file: root && file ? rel(root, file) : String(file ?? ""),
            line: lineOf(node),
            spelledAs: typeArgument.getText().slice(0, 60),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

function propertyNamed(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    const spelled = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : null;
    if (spelled === name) return property.initializer;
  }
  return null;
}

function stringProperty(objectLiteral, name) {
  const value = propertyNamed(objectLiteral, name);
  if (!value) return null;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  return null;
}

/** The `name:` of every entry of the meta's `inputs` array. */
export function inputNamesIn(meta) {
  if (!meta) return { names: [], unreadable: 0, declared: false };
  const value = propertyNamed(meta, "inputs");
  if (!value) return { names: [], unreadable: 0, declared: false };
  if (!ts.isArrayLiteralExpression(value))
    return { names: [], unreadable: 1, declared: true };
  const names = [];
  let unreadable = 0;
  for (const element of value.elements) {
    if (ts.isSpreadElement(element)) {
      unreadable += 1;
      continue;
    }
    if (!ts.isObjectLiteralExpression(element)) {
      unreadable += 1;
      continue;
    }
    const name = stringProperty(element, "name");
    if (name === null) unreadable += 1;
    else names.push(name);
  }
  return { names, unreadable, declared: true };
}

/** The meta's `defaultProps`, key -> comparable literal (or `null`). */
export function defaultPropsIn(meta) {
  if (!meta) return new Map();
  const value = propertyNamed(meta, "defaultProps");
  if (!value || !ts.isObjectLiteralExpression(value)) return new Map();
  const rows = new Map();
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    const name =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (!name) continue;
    rows.set(name, literalValue(property.initializer));
  }
  return rows;
}

/**
 * The interface named by the registered component's `schema` parameter.
 *
 * Three spellings cover this tree: a destructured parameter typed by a type
 * literal (`({ schema }: { schema: TooltipSchema })`), a named props interface
 * (`(props: CloudAiModelStatusProps)`) whose own `schema` member is read one
 * level further, and no annotation at all.
 *
 * @returns {{name: string|null, reason: string|null}}
 */
function schemaTypeNameOf(fn, localTypes) {
  const nameOfTypeNode = (typeNode) => {
    if (!typeNode) return null;
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName))
      return typeNode.typeName.text;
    // `UIActionSchema & { actionType?: string }` -- the named half is the interface.
    if (ts.isIntersectionTypeNode(typeNode)) {
      for (const member of typeNode.types) {
        const named = nameOfTypeNode(member);
        if (named) return named;
      }
    }
    return null;
  };
  const schemaMemberOf = (typeNode) => {
    if (!typeNode || !ts.isTypeLiteralNode(typeNode)) return null;
    for (const member of typeNode.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue;
      if (member.name.getText() !== "schema") continue;
      return member.type ?? null;
    }
    return null;
  };

  for (const parameter of fn.parameters ?? []) {
    const annotation = parameter.type;
    if (!annotation) continue;
    const inline = schemaMemberOf(annotation);
    if (inline) {
      const named = nameOfTypeNode(inline);
      if (named) return { name: named, reason: null };
      const wide =
        inline.kind === ts.SyntaxKind.AnyKeyword || inline.kind === ts.SyntaxKind.UnknownKeyword;
      return { name: null, reason: wide ? "schema-typed-any" : "schema-type-not-a-named-interface" };
    }
    const named = nameOfTypeNode(annotation);
    if (!named) continue;
    // A named props type declared in the same file: read its `schema` member.
    const local = localTypes.get(named);
    if (local) {
      const member = schemaMemberOf(local);
      const inner = member ? nameOfTypeNode(member) : null;
      if (inner) return { name: inner, reason: null };
    }
    if (/Schema$/.test(named)) return { name: named, reason: null };
  }
  return { name: null, reason: "no-schema-annotation" };
}

/** Type-literal aliases declared in a file, by name -- for the props-type hop. */
function localTypeLiteralsIn(sourceFile) {
  const aliases = new Map();
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name) aliases.set(node.name.text, node.type);
    if (ts.isInterfaceDeclaration(node) && node.name) {
      aliases.set(
        node.name.text,
        ts.factory.createTypeLiteralNode(node.members.filter(ts.isPropertySignature))
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return aliases;
}

/* ───────────────────────── the TS interface index ────────────────────────── */

/**
 * Every schema interface / type alias declared under {@link TYPES_SRC}, with
 * its OWN members, its `never`-typed TOMBSTONES and the names it inherits from.
 *
 * A member typed `never` is a TOMBSTONE, not a declaration: it is how this tree
 * refuses a key BY NAME on the published face (ADR-0049 / ADR-0087). Counting
 * one as a declared key would report every correctly tombstoned key as an EXTRA
 * declaration -- the exact inverse of the truth.
 */
export function readInterfaceIndex(root, dir = TYPES_SRC) {
  const base = resolve(root, dir);
  if (!existsSync(base)) fail(`${dir} does not exist under ${root} -- nothing declares a schema interface.`);
  const index = new Map();
  const files = [];
  const walkDir = (current) => {
    for (const entry of readdirSorted(current)) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        // `zod/` is the runtime MIRROR, not the published interface; `__tests__`
        // is not a declaration site.
        if (entry.name === "zod" || entry.name === "__tests__") continue;
        walkDir(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      files.push(full);
    }
  };
  walkDir(base);

  for (const file of files) {
    const sourceFile = parseSource(readFileSync(file, "utf8"), file);
    const visit = (node) => {
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const own = new Map();
        const tombstones = new Set();
        for (const member of node.members) {
          if (!ts.isPropertySignature(member) || !member.name) continue;
          if (ts.isComputedPropertyName(member.name)) continue;
          const key = member.name.getText().replace(/^['"]|['"]$/g, "");
          if (member.type && member.type.kind === ts.SyntaxKind.NeverKeyword) {
            tombstones.add(key);
            continue;
          }
          own.set(key, lineOf(member));
        }
        const heritage = [];
        for (const clause of node.heritageClauses ?? []) {
          for (const expression of clause.types) {
            if (ts.isIdentifier(expression.expression)) heritage.push(expression.expression.text);
          }
        }
        const indexSignature = node.members.some(ts.isIndexSignatureDeclaration);
        index.set(node.name.text, {
          name: node.name.text,
          file: rel(root, file),
          own,
          tombstones,
          heritage,
          indexSignature,
        });
      }
      if (ts.isTypeAliasDeclaration(node) && node.name && ts.isIntersectionTypeNode(node.type)) {
        const own = new Map();
        const tombstones = new Set();
        const heritage = [];
        let indexSignature = false;
        for (const member of node.type.types) {
          if (ts.isTypeReferenceNode(member) && ts.isIdentifier(member.typeName)) {
            heritage.push(member.typeName.text);
            continue;
          }
          if (!ts.isTypeLiteralNode(member)) continue;
          for (const property of member.members) {
            if (ts.isIndexSignatureDeclaration(property)) {
              indexSignature = true;
              continue;
            }
            if (!ts.isPropertySignature(property) || !property.name) continue;
            const key = property.name.getText().replace(/^['"]|['"]$/g, "");
            if (property.type && property.type.kind === ts.SyntaxKind.NeverKeyword) {
              tombstones.add(key);
              continue;
            }
            own.set(key, lineOf(property));
          }
        }
        index.set(node.name.text, {
          name: node.name.text,
          file: rel(root, file),
          own,
          tombstones,
          heritage,
          indexSignature,
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  if (index.size === 0)
    fail(
      `No schema interface was found under ${dir}. An empty index reports every declared key as\n` +
        "    missing from its own interface, which is a confident RED over a broken instrument."
    );
  return index;
}

function readdirSorted(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One interface's key set: its own members unioned along `extends` / `&` within
 * the index, with {@link BASE_INTERFACE} split out as INHERITED.
 */
export function interfaceKeySet(name, index, seen = new Set()) {
  const own = new Map();
  const tombstones = new Set();
  const inherited = new Set();
  const unresolved = [];
  let indexSignature = false;

  const visit = (current, isRoot) => {
    if (seen.has(current)) return;
    seen.add(current);
    if (current === BASE_INTERFACE) {
      const base = index.get(current);
      if (!base) {
        unresolved.push(current);
        return;
      }
      for (const key of base.own.keys()) inherited.add(key);
      for (const key of base.tombstones) inherited.add(key);
      if (base.indexSignature) indexSignature = true;
      for (const parent of base.heritage) visit(parent, false);
      return;
    }
    const entry = index.get(current);
    if (!entry) {
      unresolved.push(current);
      return;
    }
    for (const [key, line] of entry.own) if (!own.has(key)) own.set(key, { line, from: entry.name, file: entry.file });
    for (const key of entry.tombstones) tombstones.add(key);
    if (entry.indexSignature && !isRoot) indexSignature = true;
    if (entry.indexSignature && isRoot) indexSignature = true;
    for (const parent of entry.heritage) visit(parent, false);
  };

  visit(name, true);
  return { own, tombstones, inherited, unresolved, indexSignature };
}

/* ───────────────────────── framework read derivation ─────────────────────── */

/**
 * The keys the render loop reads off every schema, read out of
 * {@link FRAMEWORK_READ_SOURCE}. Derived, never listed -- see the header.
 */
export function frameworkReads(root, relPath = FRAMEWORK_READ_SOURCE) {
  const file = resolve(root, relPath);
  if (!existsSync(file))
    fail(
      `${relPath} is missing. The framework read set is derived from it, and an EMPTY one\n` +
        "    turns every `className` in the tree into a finding -- a confident red over a broken\n" +
        "    instrument. Point `frameworkReads` at the render loop's new home."
    );
  const sourceFile = parseSource(readFileSync(file, "utf8"), file);
  const keys = new Set();
  const walk = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      FRAMEWORK_RECEIVERS.has(erasedName(node.expression))
    )
      keys.add(node.name.text);
    if (
      ts.isElementAccessExpression(node) &&
      FRAMEWORK_RECEIVERS.has(erasedName(node.expression)) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    )
      keys.add(node.argumentExpression.text);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      FRAMEWORK_RECEIVERS.has(erasedName(node.initializer))
    ) {
      for (const key of bindingKeys(node.name)) keys.add(key);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);

  // The props the render loop INJECTS. `data-obj-id`, `data-obj-type`,
  // `data-testid` and `className` are set by `React.createElement(Component, {…})`
  // here, not authored by anyone -- and several renderers take them by name off
  // their props parameter. Counting one as an authored key would report the
  // render loop's own attribute as a key the block's interface fails to
  // declare. Derived from that call's object literal rather than listed.
  const injected = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "createElement"
    ) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) {
          const named = property.name;
          if (!named) continue;
          if (ts.isIdentifier(named) || ts.isStringLiteral(named)) keys.add(named.text);
        }
      }
    }
    ts.forEachChild(node, injected);
  };
  ts.forEachChild(sourceFile, injected);

  if (keys.size === 0)
    fail(
      `${relPath} yielded no framework read at all. See the note in \`frameworkReads\`:\n` +
        "    an empty set is never a fact here."
    );
  return keys;
}

/**
 * The AMBIENT key set -- keys that belong to every registered type rather than
 * to any one block, so no block's interface owes a declaration for them and no
 * block's `inputs` publishes one illegitimately.
 *
 * Two DERIVED halves, neither listed, because neither alone is the set:
 *
 *   1. {@link BASE_INTERFACE}'s own members -- every schema interface in this
 *      tree extends it, so a key declared there is declared for every type.
 *      `className`, `label`, `testId`, `bind` and their neighbours come from
 *      here.
 *   2. the render loop's own reads ({@link frameworkReads}) -- `properties`,
 *      `dataSource` and `responsiveStyles` are read off the document by
 *      `SchemaRenderer` and are not all on `BaseSchema`.
 *
 * ⛔ This is NOT the gate judging `BaseSchema`. The twins and the index
 * signature are on their own card by the same ruling that ordered this gate,
 * and nothing here reports, widens or narrows them: their names are read only
 * so that a key EVERY type inherits is not billed to one block.
 */
export function ambientKeys(root, interfaces) {
  const keys = new Set(frameworkReads(root));
  const base = interfaces.get(BASE_INTERFACE);
  if (!base)
    fail(
      `\`${BASE_INTERFACE}\` was not found under ${TYPES_SRC}. Every schema interface extends it, so\n` +
        "    without it every inherited key is billed to the block that inherits it."
    );
  for (const key of base.own.keys()) keys.add(key);
  for (const key of base.tombstones) keys.add(key);
  return keys;
}

/* ───────────────────────────── the spec surface ──────────────────────────── */

export const SPEC_SPECIFIER = "@objectstack/spec/ui";

/**
 * `ComponentPropsMap`, read through a dynamic `import()` so the schemas this
 * gate judges against are — by identity — the ones the app bundles against.
 */
export async function specKeySets(importSpec = (id) => import(id)) {
  let module;
  try {
    module = await importSpec(SPEC_SPECIFIER);
  } catch (error) {
    fail(`could not import ${SPEC_SPECIFIER}: ${error.message}`);
  }
  const map = module?.ComponentPropsMap;
  if (!map || typeof map !== "object")
    fail(`${SPEC_SPECIFIER} exports no usable \`ComponentPropsMap\` -- nothing to judge against.`);
  const sets = new Map();
  for (const [type, schema] of Object.entries(map)) {
    const shape = schema?.shape ?? schema?._def?.shape;
    const resolved = typeof shape === "function" ? shape() : shape;
    if (resolved && typeof resolved === "object") {
      sets.set(type, { kind: "object", keys: new Set(Object.keys(resolved)) });
      continue;
    }
    // `z.never()` DECLARES the type and accepts no key -- `user:profile`.
    const typeName = schema?._def?.typeName ?? schema?._def?.type;
    if (typeName === "never" || schema?.constructor?.name === "ZodNever") {
      sets.set(type, { kind: "never", keys: new Set() });
      continue;
    }
    sets.set(type, { kind: "unreadable", keys: new Set() });
  }
  if (sets.size === 0)
    fail(`\`ComponentPropsMap\` is empty. An empty spec surface reads every key as spec-undeclared.`);
  return sets;
}

/* ──────────────────────────────── the analysis ───────────────────────────── */

/**
 * @param {string} root
 * @param {{importSpec?: Function, seedLedger?: Record<string,string>, ambientKeys?: Set<string>}} [options]
 */
export async function analyze(root = REPO_ROOT, options = {}) {
  const seedLedger = options.seedLedger ?? DESIGNER_SEED_ROWS;
  const spec = await specKeySets(options.importSpec);
  const interfaces = readInterfaceIndex(root);
  const framework = options.ambientKeys ?? ambientKeys(root, interfaces);

  const byPackage = populationFiles(root);
  if (byPackage.size === 0)
    fail(`no package source was found under ${root}/packages -- the population is empty.`);

  // Per package: a parsed index, so a cross-file component resolves.
  const parsedByPackage = new Map();
  for (const [pkg, files] of byPackage) {
    const index = new Map();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      index.set(file, {
        text,
        sourceFile: parseSource(text, file),
      });
    }
    parsedByPackage.set(pkg, index);
  }

  const types = [];
  const coverage = {
    rendererUnresolved: [],
    interfaceUnresolved: [],
    inputsUnreadable: [],
    // F1: `register(variable, …)` -- a real registration whose TYPE this reader
    // cannot name. Named bucket, never a silent pass.
    dynamicRegistrations: [],
  };
  let registrationCount = 0;

  for (const [pkg, index] of parsedByPackage) {
    const filesInPackage = new Set(index.keys());
    for (const [file, { text, sourceFile }] of index) {
      if (!text.includes("ComponentRegistry")) continue;
      const sites = registrationSitesIn(sourceFile);
      // Non-vacuity: the tree's own registration reader must not see MORE calls
      // than this walk did. A silently short AST read is the one failure that
      // looks like a clean census.
      //
      // The `dynamic` term is NOT a tolerance. A `register(tag, …)` call over a
      // list of tags is a real registration this reader cannot name, and every
      // one of them is carried into {@link coverage}.dynamicRegistrations and
      // PRINTED, exactly as the three other coverage buckets are. The earlier
      // shape of this guard added `crossCheck.unreadable.length` to the right
      // and said nothing further, which made the largest exclusion in the census
      // its quietest one: the whole `ui:HTML-TAG` family (37 + 7 tags) and the
      // whole `field:*` family (45 widgets) sat outside a population presented
      // as covering the registered tree. objectui#4631 review, F1.
      const crossCheck = findComponentRegistrations(text);
      const dynamic = dynamicRegistrationsIn(sourceFile, root, file);
      for (const entry of dynamic) coverage.dynamicRegistrations.push(entry);
      if (crossCheck.calls > sites.length + dynamic.length) {
        fail(
          `${rel(root, file)}: scripts/component-registrations.mjs counts ${crossCheck.calls} register call(s),\n` +
            `    this walk read ${sites.length} named and ${dynamic.length} dynamically typed. An under-read\n` +
            "    beyond those is a type dropped from the census in silence."
        );
      }
      for (const site of sites) {
        registrationCount += 1;
        const record = judgeRegistration({
          root,
          pkg,
          file,
          site,
          sourceFile,
          index,
          filesInPackage,
          interfaces,
          spec,
          framework,
        });
        if (record.renderer.unresolved) coverage.rendererUnresolved.push(record);
        if (record.iface.unresolvedReason) coverage.interfaceUnresolved.push(record);
        if (record.inputs.unreadable) coverage.inputsUnreadable.push(record);
        types.push(record);
      }
    }
  }

  if (registrationCount === 0)
    fail(
      `no \`ComponentRegistry.register\` call was found in any package source under ${root}.\n` +
        "    Every finding this gate reports is a set difference, and all of them are empty on an\n" +
        "    empty population -- so zero registrations is reported as a failure, not as a clean run."
    );

  const seedRows = census(types, seedLedger);
  return {
    types,
    coverage,
    counters: {
      registrations: registrationCount,
      judged: types.length,
      withSpec: types.filter((t) => t.spec.declared).length,
      withInterface: types.filter((t) => !t.iface.unresolvedReason).length,
      withRenderer: types.filter((t) => !t.renderer.unresolved).length,
      // F2 (objectui#4631 review). The INTERSECTION, printed beside its two
      // halves, because only a type with BOTH a spec entry and a resolvable
      // interface can produce a spec-caused finding. Where this is 0 the spec
      // arm of `interface-missing-key` never fires and can only ever suppress
      // -- true of this tree today, and invisible in the two halves alone.
      withSpecAndInterface: types.filter((t) => t.spec.declared && !t.iface.unresolvedReason)
        .length,
      // F5. A registration annotated `schema: BaseSchema` resolves to an
      // interface with no OWN members, so it can never produce
      // `interface-extra-key`. Counted inside `withInterface` and named here,
      // because a block with no type of its own is thinner coverage than the
      // bare number suggests.
      withBaseAsItsOwnInterface: types.filter((t) => t.iface.name === BASE_INTERFACE).length,
      ambientKeys: framework.size,
      restSpread: types.filter((t) => t.renderer.forwardsRest).length,
      specEntries: spec.size,
      interfaces: interfaces.size,
      dynamicRegistrationSites: coverage.dynamicRegistrations.length,
    },
    findings: types.flatMap((t) => t.findings),
    ...seedRows,
  };
}

function judgeRegistration(context) {
  const { root, file, site, sourceFile, index, filesInPackage, interfaces, spec, framework } =
    context;

  const renderer = resolveRenderer({ file, site, sourceFile, index, filesInPackage });
  const inputs = inputNamesIn(site.meta);
  const defaults = defaultPropsIn(site.meta);

  const specEntry = spec.get(site.fullType) ?? null;
  const specKeys = specEntry ? specEntry.keys : new Set();

  const ifaceName = renderer.schemaTypeName;
  let iface = {
    name: ifaceName,
    file: null,
    own: new Map(),
    tombstones: new Set(),
    inherited: new Set(),
    indexSignature: false,
    unresolvedReason: null,
  };
  if (!ifaceName) {
    iface.unresolvedReason = renderer.schemaTypeReason ?? "no-schema-annotation";
  } else if (ifaceName === "any" || ifaceName === "unknown") {
    iface.unresolvedReason = "schema-typed-any";
  } else if (!interfaces.has(ifaceName)) {
    iface.unresolvedReason = `interface-not-in-${TYPES_SRC}`;
  } else {
    const resolved = interfaceKeySet(ifaceName, interfaces);
    iface = {
      name: ifaceName,
      file: interfaces.get(ifaceName).file,
      own: resolved.own,
      tombstones: resolved.tombstones,
      inherited: resolved.inherited,
      indexSignature: resolved.indexSignature,
      unresolvedReason: null,
    };
  }

  // The ruling's key set: spec ∪ renderer reads. The framework reads are part
  // of "what the renderer reads" -- the render loop reads them off this very
  // document -- but they belong to no block, so they never make a block's
  // interface owe a declaration.
  const blockReads = new Set([...renderer.reads.keys()].filter((key) => !framework.has(key)));
  const propsChannel = new Set([...renderer.propsReads.keys()].filter((key) => !framework.has(key)));
  // The ruling's set: spec ∪ (what the renderer NAMES). The props channel is
  // not in it -- see `schemaReadsIn` -- but it widens both permissive tests.
  const keySet = new Set([...specKeys, ...blockReads]);
  const acceptSet = new Set([...keySet, ...propsChannel, ...framework]);

  const findings = [];
  const at = `${rel(root, file)}:${site.line}`;
  // See `forwardsRestProps`: on such a renderer "not read" means "not read BY
  // NAME", and the key may still be honoured through the spread.
  const spreadCaveat = renderer.forwardsRest
    ? " (this renderer forwards its unnamed props with a rest spread, so the key may be honoured without a named read)"
    : "";

  if (!iface.unresolvedReason) {
    const declared = new Set([...iface.own.keys(), ...iface.inherited]);
    for (const key of keySet) {
      if (declared.has(key)) continue;
      if (iface.tombstones.has(key)) {
        findings.push({
          kind: "read-of-tombstoned-key",
          type: site.fullType,
          key,
          at,
          detail:
            `\`${iface.name}\` declares \`${key}\` as \`never\` (refused BY NAME), and ` +
            (specKeys.has(key) ? "the spec declares it" : `the renderer reads it at ${renderer.reads.get(key) ?? "?"}`),
        });
        continue;
      }
      findings.push({
        kind: "interface-missing-key",
        type: site.fullType,
        key,
        at,
        // ⛔ deliberately NOT tagged `restSpread`. The caveat is about a key that
        // LOOKS unread and may be honoured through the spread; this finding says
        // the key IS read and the interface fails to declare it, which a spread
        // forward does not soften. Tagging it would inflate the hedged column
        // with rows the instrument is not hedging.
        restSpread: false,
        // F2: which arm of the disjunction actually fired, per finding, so the
        // spec arm's contribution is a measured number rather than an inference
        // from `withSpec`.
        cause: specKeys.has(key) ? (blockReads.has(key) ? "spec+renderer" : "spec") : "renderer",
        detail:
          `\`${iface.name}\` (${iface.file}) does not declare \`${key}\`, which ` +
          [
            specKeys.has(key) ? "the spec declares" : null,
            blockReads.has(key) ? `the renderer reads (line ${renderer.reads.get(key)})` : null,
          ]
            .filter(Boolean)
            .join(" and "),
      });
    }
    for (const [key, where] of iface.own) {
      if (acceptSet.has(key)) continue;
      findings.push({
        kind: "interface-extra-key",
        type: site.fullType,
        key,
        at,
        restSpread: renderer.forwardsRest,
        detail:
          `\`${iface.name}\` (${where.file}) declares \`${key}\`, which neither the spec declares ` +
          `nor the renderer reads${spreadCaveat}`,
      });
    }
  }

  // F3 (objectui#4631 review). Guarded on `renderer.unresolved` exactly as both
  // interface rules are guarded on `iface.unresolvedReason`, and for the same
  // reason this file's header already states: a zero read set read as TRUTH
  // reports every declared key as outside the key set. Measured before the
  // guard: `plugin-list:list-view` and `view:list` wrap their renderer as
  // `elementDataSourceBlock(React.forwardRef(...))`, a double wrap this walk
  // cannot hop, and produced 12 findings over six keys their own package reads
  // by name. The rows stay in the `rendererUnresolved` coverage bucket, which is
  // where an unreadable renderer belongs.
  for (const name of renderer.unresolved ? [] : inputs.names) {
    if (acceptSet.has(name)) continue;
    const onInterface = !iface.unresolvedReason && iface.own.has(name);
    findings.push({
      kind: "input-outside-keyset",
      type: site.fullType,
      key: name,
      at,
      restSpread: renderer.forwardsRest,
      detail:
        `\`inputs\` publishes \`${name}\`, which is outside (spec ∪ renderer reads)` +
        (onInterface ? ` -- it IS on \`${iface.name}\`, so the same root cause is reported above` : "") +
        spreadCaveat,
    });
  }

  const pairs = [];
  for (const [key, declaredLiteral] of defaults) {
    const fallback = renderer.fallbacks.get(key);
    if (!fallback) continue;
    if (declaredLiteral === null || fallback.literal === null) {
      pairs.push({ key, comparable: false, declaredLiteral, fallback: fallback.literal });
      continue;
    }
    pairs.push({
      key,
      comparable: true,
      declaredLiteral,
      fallback: fallback.literal,
      agrees: declaredLiteral === fallback.literal,
    });
  }

  return {
    type: site.fullType,
    bareType: site.type,
    file: rel(root, file),
    line: site.line,
    spec: { declared: specEntry !== null, kind: specEntry?.kind ?? null, keys: specKeys },
    renderer,
    propsChannel,
    iface,
    inputs,
    defaults,
    pairs,
    keySet,
    findings,
  };
}

/**
 * Every key reachable from one registration, plus the interface its `schema`
 * parameter names.
 *
 * `register('kanban', ObjectKanbanRenderer, …)` hands over a NAME, not a body:
 * a walk that starts at the identifier finds nothing at all, and "nothing" here
 * would report every declared key as extra.
 */
function resolveRenderer({ file, site, sourceFile, index, filesInPackage }) {
  const reads = new Map();
  const propsReads = new Map();
  const fallbacks = new Map();
  let schemaTypeName = null;
  let schemaTypeReason = null;
  let resolvedAny = false;
  let forwardsRest = false;

  const visited = new Set();
  const queue = [];

  const declarationsCache = new Map();
  const nodesCache = new Map();
  const typesCache = new Map();
  const importsCache = new Map();
  const readWalkCache = new Map();
  const forFile = (target) => {
    const entry = index.get(target);
    if (!entry) return null;
    if (!declarationsCache.has(target)) {
      declarationsCache.set(target, declarationsIn(entry.sourceFile));
      nodesCache.set(target, declarationNodesIn(entry.sourceFile));
      typesCache.set(target, localTypeLiteralsIn(entry.sourceFile));
      importsCache.set(target, relativeImportsIn(entry.sourceFile));
    }
    return {
      bodies: declarationsCache.get(target),
      nodes: nodesCache.get(target),
      types: typesCache.get(target),
      imports: importsCache.get(target),
    };
  };
  void readWalkCache;
  void sourceFile;

  const enqueueName = (fromFile, name, hops = 0, ownChain = false) => {
    if (hops > 4) return;
    const key = `${fromFile}::${name}`;
    if (visited.has(key)) return;
    visited.add(key);
    const local = forFile(fromFile);
    if (!local) return;
    const declared = local.nodes.get(name);
    if (declared) {
      enqueueNode(fromFile, declared, hops, ownChain);
      return;
    }
    const specifier = local.imports.get(name);
    if (!specifier) return;
    const target = resolveRelative(fromFile, specifier, filesInPackage);
    if (target) enqueueName(target, name, hops + 1, ownChain);
  };

  const enqueueNode = (fromFile, node, hops = 0, ownChain = false) => {
    if (hops > 4) return;
    let current = node;
    for (let peel = 0; peel < 4; peel += 1) {
      if (
        ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isSatisfiesExpression(current)
      ) {
        current = current.expression;
        continue;
      }
      break;
    }
    if (ts.isIdentifier(current)) {
      enqueueName(fromFile, current.text, hops + 1, ownChain);
      return;
    }
    // `withFieldCarrier(ColorField)` / `elementDataSourceBlock(Impl, …)` -- the
    // HOC spelling. The component is an argument; keep reading each candidate.
    if (ts.isCallExpression(current)) {
      for (const argument of current.arguments) enqueueNode(fromFile, argument, hops + 1, ownChain);
      return;
    }
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      queue.push({ file: fromFile, node: current, own: ownChain });
    }
  };

  // `ownChain` stays true through an alias, an HOC argument and a static
  // relative import -- all of which are still the REGISTERED component -- and
  // is cleared by a `<Child schema={…}>` hop, which is not.
  enqueueNode(file, site.component, 0, true);

  while (queue.length) {
    const { file: currentFile, node, own } = queue.shift();
    const local = forFile(currentFile);
    if (!local) continue;
    resolvedAny = true;

    if (!schemaTypeName) {
      const named = schemaTypeNameOf(node, local.types);
      if (named.name) schemaTypeName = named.name;
      else if (!schemaTypeReason) schemaTypeReason = named.reason;
    }

    if (forwardsRestProps(node)) forwardsRest = true;
    const found = schemaReadsIn(node, { propsAreDocument: own });
    for (const [key, line] of found.named) if (!reads.has(key)) reads.set(key, line);
    for (const [key, line] of found.viaProps) if (!propsReads.has(key)) propsReads.set(key, line);
    for (const [key, value] of fallbacksIn(node)) if (!fallbacks.has(key)) fallbacks.set(key, value);

    for (const name of documentCarryingChildren(node)) enqueueName(currentFile, name, 1, false);
  }

  return {
    reads,
    propsReads,
    fallbacks,
    schemaTypeName,
    schemaTypeReason,
    forwardsRest,
    unresolved: resolvedAny ? null : "component-body-not-reachable",
  };
}

/**
 * The `defaultProps` census, and the seed ledger judged against it in both
 * directions -- a divergence with no registered reason, and a registered reason
 * whose row no longer diverges.
 */
function census(types, seedLedger) {
  let comparable = 0;
  let agreeing = 0;
  const divergences = [];
  const seenRows = new Set();
  for (const record of types) {
    for (const pair of record.pairs) {
      if (!pair.comparable) continue;
      comparable += 1;
      if (pair.agrees) continue;
      const row = `${record.type}.${pair.key}`;
      seenRows.add(row);
      divergences.push({
        row,
        type: record.type,
        key: pair.key,
        file: record.file,
        defaultProps: pair.declaredLiteral,
        fallback: pair.fallback,
        reason: seedLedger[row] ?? null,
      });
    }
    agreeing += record.pairs.filter((p) => p.comparable && p.agrees).length;
  }
  const staleSeeds = Object.keys(seedLedger).filter((row) => !seenRows.has(row));
  return {
    census: {
      comparablePairs: comparable,
      agreeing,
      divergences: divergences.length,
      unregistered: divergences.filter((d) => d.reason === null).length,
    },
    divergences,
    staleSeeds,
  };
}

/* ────────────────────────────────── the CLI ──────────────────────────────── */

const KIND_HEADINGS = {
  "interface-missing-key":
    "TS interface does NOT declare a key the spec declares or the renderer reads",
  "interface-extra-key":
    "TS interface declares a key neither the spec declares nor the renderer reads",
  "input-outside-keyset": "registry `inputs` publishes a key outside (spec ∪ renderer reads)",
  "read-of-tombstoned-key": "a key the interface REFUSES by name is still on a live surface",
};

async function main() {
  let result;
  try {
    result = await analyze();
  } catch (error) {
    if (error instanceof ExtractionError) {
      console.error("component-surface-parity: EXTRACTION FAILED\n");
      console.error(`    ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const { types, counters, findings, coverage, census: numbers, divergences, staleSeeds } = result;

  console.log("component-surface-parity: REPORT-ONLY (objectui#4631) -- exits 0 with findings.\n");
  console.log(`  registrations judged     ${counters.judged}`);
  console.log(`  ... with a spec entry    ${counters.withSpec}  (of ${counters.specEntries} ComponentPropsMap entries)`);
  console.log(`  ... with a TS interface  ${counters.withInterface}  (index: ${counters.interfaces} declarations under ${TYPES_SRC})`);
  console.log(
    `      of which annotated \`${BASE_INTERFACE}\` itself: ${counters.withBaseAsItsOwnInterface}  ` +
      "(no OWN members, so they can never produce interface-extra-key)"
  );
  console.log(`  ... with a resolved body ${counters.withRenderer}`);
  console.log(
    `  spec AND interface       ${counters.withSpecAndInterface}  ` +
      "<- only these can produce a SPEC-caused finding" +
      (counters.withSpecAndInterface === 0
        ? "\n      = 0: the spec arm of `interface-missing-key` fires on NOTHING in this tree today.\n" +
          "      Every spec-declared type resolves to no interface, so the spec half can only\n" +
          "      SUPPRESS a finding (it widens the accept set), never raise one. The authority\n" +
          "      order is mechanised and pinned by the suite; it is not doing work on THIS corpus."
        : "")
  );
  console.log(
    `  ambient key set          ${counters.ambientKeys} keys, derived from \`${BASE_INTERFACE}\` + ${FRAMEWORK_READ_SOURCE}`
  );
  console.log(`  rest-spread renderers    ${counters.restSpread}  (see \`forwardsRestProps\`)`);

  if (process.argv.includes("--type")) {
    const wanted = process.argv[process.argv.indexOf("--type") + 1];
    for (const record of types.filter((t) => t.type === wanted)) printType(record);
    process.exit(0);
  }

  if (process.argv.includes("--list")) {
    console.log("");
    for (const record of [...types].sort((a, b) => a.type.localeCompare(b.type))) {
      console.log(
        `  ${record.type.padEnd(28)} spec ${String(record.spec.declared ? record.spec.keys.size : "-").padStart(3)}` +
          `  reads ${String(record.renderer.reads.size).padStart(3)}` +
          `  iface ${String(record.iface.unresolvedReason ? "-" : record.iface.own.size).padStart(3)}` +
          `  inputs ${String(record.inputs.names.length).padStart(3)}` +
          `  findings ${String(record.findings.length).padStart(3)}  ${record.file}`
      );
    }
  }

  const byKind = new Map();
  for (const finding of findings) {
    if (!byKind.has(finding.kind)) byKind.set(finding.kind, []);
    byKind.get(finding.kind).push(finding);
  }
  console.log("\n  Disagreements, by kind -- split by the caveat the findings themselves carry:");
  console.log(
    `    ${"".padEnd(26)} ${"total".padStart(5)} ${"named-read".padStart(11)} ${"rest-spread".padStart(12)}`
  );
  for (const kind of Object.keys(KIND_HEADINGS)) {
    const list = byKind.get(kind) ?? [];
    const spread = list.filter((finding) => finding.restSpread).length;
    console.log(
      `    ${kind.padEnd(26)} ${String(list.length).padStart(5)} ${String(list.length - spread).padStart(11)} ${String(spread).padStart(12)}`
    );
  }
  const spreadTotal = findings.filter((finding) => finding.restSpread).length;
  console.log(
    `    ${"TOTAL".padEnd(26)} ${String(findings.length).padStart(5)} ${String(findings.length - spreadTotal).padStart(11)} ${String(spreadTotal).padStart(12)}`
  );
  console.log(
    "    rest-spread = this instrument does NOT claim the row is a defect: the renderer forwards\n" +
      "    its unnamed props, so the key may be honoured without a named read. ⛔ Quote the total\n" +
      "    without this split and you are quoting rows the gate itself hedges (objectui#4631 review F4)."
  );
  const byCause = new Map();
  for (const finding of byKind.get("interface-missing-key") ?? []) {
    byCause.set(finding.cause, (byCause.get(finding.cause) ?? 0) + 1);
  }
  console.log(
    `    interface-missing-key by cause: ` +
      ["spec", "spec+renderer", "renderer"].map((c) => `${c}=${byCause.get(c) ?? 0}`).join("  ")
  );
  for (const [kind, list] of byKind) {
    console.log(`\n  ${kind} -- ${KIND_HEADINGS[kind] ?? ""}`);
    for (const finding of list.slice(0, 200)) {
      console.log(`    ${finding.type}.${finding.key}  (${finding.at})`);
      console.log(`        ${finding.detail}`);
    }
    if (list.length > 200) console.log(`    ... and ${list.length - 200} more`);
  }

  console.log("\n  `defaultProps` vs renderer fallback:");
  console.log(`    ${numbers.comparablePairs} comparable pair(s), ${numbers.agreeing} agreeing, ${numbers.divergences} diverging`);
  console.log(`    ${numbers.unregistered} divergence(s) carry no registered designer-seed reason`);
  for (const divergence of divergences) {
    console.log(
      `      ${divergence.row.padEnd(34)} defaultProps ${String(divergence.defaultProps).padEnd(12)} fallback ${divergence.fallback}` +
        (divergence.reason ? `  [seed: ${divergence.reason}]` : "")
    );
  }
  if (staleSeeds.length) {
    console.log("\n  STALE designer-seed rows (the pair no longer diverges -- delete the entry):");
    for (const row of staleSeeds) console.log(`      ${row}`);
  }

  console.log("\n  Coverage gaps -- reported, never counted as agreement:");
  console.log(`    ${coverage.rendererUnresolved.length} registration(s) whose component body this walk could not reach`);
  console.log("        (the `inputs` rule is SKIPPED for these -- see the F3 note at its loop)");
  console.log(`    ${coverage.interfaceUnresolved.length} registration(s) with no resolvable TS schema interface`);
  console.log(`    ${coverage.inputsUnreadable.length} registration(s) with an \`inputs\` entry this reader cannot name`);
  console.log(
    `    ${coverage.dynamicRegistrations.length} DYNAMICALLY TYPED registration call site(s) -- \`register(variable, …)\`.`
  );
  for (const entry of coverage.dynamicRegistrations) {
    console.log(`        ${entry.file}:${entry.line}  registers under \`${entry.spelledAs}\``);
  }
  if (coverage.dynamicRegistrations.length) {
    console.log(
      "        Each is a FACTORY: one component type per loop iteration, none of them nameable\n" +
        "        from source. The families behind these sites (the `ui:HTML-TAG` blocks and the\n" +
        "        `field:*` widgets) are OUTSIDE every number above -- they are not in the judged\n" +
        "        count and not in any finding. ⛔ A census read as covering the registered tree is\n" +
        "        reading a population that never contained them (objectui#4631 review F1)."
    );
  }

  console.log(
    "\ncomponent-surface-parity: REPORT-ONLY -- exit 0. The ruling's sequencing is\n" +
      "  「report-only 起步,零分歧后翻阻断」; flipping this to blocking is a separate card on a\n" +
      "  measured zero, and repairing any row above is governed by that ruling's ordering note."
  );
}

if (isEntrypoint(import.meta.url)) {
  await main();
}

function printType(record) {
  console.log(`\n  ${record.type}  (${record.file}:${record.line})`);
  console.log(`    spec      ${record.spec.declared ? [...record.spec.keys].sort().join(", ") || "(empty)" : "(no ComponentPropsMap entry)"}`);
  console.log(`    reads     ${[...record.renderer.reads.keys()].sort().join(", ") || "(none)"}`);
  console.log(
    `    interface ${record.iface.unresolvedReason ? `(unresolved: ${record.iface.unresolvedReason})` : `${record.iface.name}: ${[...record.iface.own.keys()].sort().join(", ")}`}`
  );
  console.log(`    inputs    ${record.inputs.names.join(", ") || "(none)"}`);
  for (const finding of record.findings) console.log(`    ! ${finding.kind}: ${finding.key}`);
}
