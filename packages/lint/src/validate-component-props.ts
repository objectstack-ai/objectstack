// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0078] The SDUI component-props gate (#5068) — the parse
 * `ComponentPropsMap` never had.
 *
 * ## What was missing
 *
 * `PageComponent.properties` is `z.record(z.string(), z.unknown())`: an open
 * bag. `PageComponentSchema` has been `.strict()` since ADR-0089 D3a, but
 * strictness does not RECURSE — it closes the component node's own keys and
 * leaves everything under `properties` unjudged. The typed prop schemas exist
 * (`ComponentPropsMap`, `@objectstack/spec/ui`) and #4001 批 17 measured that
 * **nothing parses them**: BFS-unreachable from all 24 metadata roots, zero
 * production `.parse()` in `objectstack` / `objectui` / `cloud`, and — through
 * the live `definePage()` door — an undeclared key written inside `properties`
 * parses clean and is RETAINED, while the same key one level out is rejected.
 * That is the `no gate` class: carrier live, parse absent.
 *
 * It is not harmless. objectui's `SchemaRenderer` hoists `properties` onto the
 * node and spreads every key not on its fixed deny-list straight into the React
 * component, so a misspelled key is neither rejected nor dropped — it reaches
 * the renderer and is ignored there. The author gets a success receipt for
 * configuration that does nothing, which is the exact shape ADR-0078 exists to
 * eliminate.
 *
 * ## What this rule does
 *
 * It dispatches on the component's `type` and judges `properties` against that
 * type's props schema — the maintainer's ruling on #5068 (direction A: gate at
 * the carrier's own authoring door, not by reshaping the `page` protocol).
 * Two verdicts, from one dispatch:
 *
 * - **`component-props-unknown-key`** — a key the props schema does not
 *   declare, at the props bag's own level or at any strip-mode object below it.
 *   Reported through `lintUnknownKeysAgainstSchema` (`@objectstack/spec`), the
 *   same walker `lintUnknownAuthoringKeys` runs on every metadata collection —
 *   so the posture rules (strip reports, strict stays silent because the parse
 *   is loud on its own, passthrough stays silent because the key survives) and
 *   the rename suggestions are single-source, never re-derived here.
 * - **`component-props-invalid`** — a value the props schema rejects: a wrong
 *   type, a missing required key, a value outside a declared enum.
 *
 * A schema that is STRIP today reports its unknown keys through the walker; one
 * that a later `strictObject` batch closes reports them through `safeParse` as
 * `unrecognized_keys` instead. Both are routed to the SAME rule id below, so
 * the ratchet moves coverage between the halves without moving it out of the
 * author's view — and without this file needing to know which posture the spec
 * is at.
 *
 * ## Why WARNING, and only warning, in this PR
 *
 * Wiring the parse is the precondition for enforcement, not the enforcement
 * (the #5020 lesson, one surface over). The corpus this landed on carries live
 * violations that are open contract questions, not authoring mistakes:
 * `I18nLabelSchema` is a plain `z.string()` while three published platform
 * pages author inline `{ en, 'zh-CN', … }` maps that objectui resolves
 * (#5728), and the record picker declared a required `displayField` that no
 * renderer reads while honouring an undeclared `labelField` (#5775). Gating
 * those would fail the platform's own pages to enforce declarations the
 * platform does not itself keep. So every finding here is advisory, the
 * warning-period inventory is the acceptance baseline for the error upgrade,
 * and the upgrade is its own step once the inventory is empty.
 *
 * #5775 settled most of the spec side of that inventory — four keys nothing read
 * are tombstoned with ADR-0087 conversions. Its stronger claim, that every key
 * the renderers honour is now declared, was **incomplete**: #6776 re-counted
 * against objectui `origin/main` and found five more author-facing props the
 * renderers read and this map did not declare — `page:header`'s
 * `recordChrome` / `showStar` / `showCopyId`, `page:accordion.variant`, and the
 * tab strip's visual style, which the spec did declare but under a spelling
 * (`page:tabs.type`) that collides with a page component's own dispatch key and
 * is therefore unauthorable in the flat and JSX carriers. #6776 declares the
 * four and renames the fifth to the `tabStyle` every carrier can express. Both
 * cards are named here rather than only in a changelog because THIS comment is
 * the inventory the error upgrade is measured against, and a count that reports
 * itself complete while it is not is how the second half went unnoticed for a
 * release.
 *
 * What stands between this rule and `error` is now #5728 and two page rewrites
 * (`page:card.visible` → the ADR-0089 component-level `visibleWhen`; #5776's tab
 * `key` → `value`), not the props map.
 *
 * ## Unregistered types are SKIPPED — a required semantic, not leniency
 *
 * `PageComponentSchema.type` is `z.union([PageComponentType, z.string()])`, an
 * open union by design: the example corpus alone authors `flex`, `grid`,
 * `object-chart` and `record:line_items` — nodes whose props schema
 * `ComponentPropsMap` simply does not carry (SDUI blocks live in objectui's
 * registry and in the ADR-0080 manifest). Judging those against an absent
 * schema would report every one of them as broken.
 * `validate-page-field-bindings` skips unknown types for the same reason and
 * says so in its own header.
 *
 * ⚠️ The skip is also the silent-failure direction, which is why the list
 * above keeps shrinking: earlier editions of this sentence named the
 * `object-*` family (#7751 declared six rows), then `record:reference_rail`
 * (#8691), then `record:quick_actions` and `record:alert` (#8744, with
 * `record:history` and `record:discussion`) — each a type with a registered
 * renderer whose authored keys this skip was quietly waving through. A type
 * both registered in objectui AND absent from the map is a gap to measure
 * (see #8691's method), not a state to preserve; `object-chart`'s absence is
 * the recorded deliberate one (#7751).
 */

import { ComponentPropsMap } from '@objectstack/spec/ui';
import { lintUnknownKeysAgainstSchema } from '@objectstack/spec';
import { walkPageComponents, type AnyRec } from './page-walk.js';
import { describeIssue, type LintZodIssue } from './zod-issue-format.js';

/** A key authored in `properties` that the type's props schema does not declare. */
export const COMPONENT_PROPS_UNKNOWN_KEY = 'component-props-unknown-key';
/** A value in `properties` that the type's props schema rejects. */
export const COMPONENT_PROPS_INVALID = 'component-props-invalid';

/**
 * Advisory on every finding this rule emits — see the module header. The type
 * is a single literal rather than a union so the tier claim in
 * `authoring-rules.ts` is provable from this file's source, which is exactly
 * what `authoring-rule-wiring.test.ts` reads it for.
 */
export type ComponentPropsSeverity = 'warning';

export interface ComponentPropsFinding {
  severity: ComponentPropsSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `page "task_detail" · record:highlights`. */
  where: string;
  /** Config path, e.g. `pages[0].regions[1].components[0].properties.titel`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/** A zod schema, as much of one as this file reads. */
interface PropsSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues: ReadonlyArray<LintZodIssue> } };
}

const PROPS_SCHEMAS = ComponentPropsMap as unknown as Record<string, PropsSchema>;

/**
 * The one prop whose absence this rule does NOT report when the component
 * carries a per-element `dataSource`.
 *
 * `ElementDataSourceSchema` is declared on the component node as the binding
 * that "overrides page-level object context", and objectui's element renderers
 * read it FIRST (`const object = ds.object ?? props.object`) — the same
 * precedence `page-walk.ts` encodes for every rule built on it. The props
 * schemas declare `object` as required because it is the flat shorthand; a
 * component that binds through the richer sibling has not omitted anything.
 * Reporting it would be the rule judging one half of a two-key contract, which
 * is a wrong verdict rather than a strict one — the showcase's
 * `element:record_picker` (`dataSource: { object: 'showcase_project', limit: 50 }`)
 * is the live specimen.
 */
const DATASOURCE_SUPPLIED_PROP = 'object';

/**
 * Is this issue "the required `object` prop is missing", on a component whose
 * `dataSource` supplies it?
 */
function suppliedByDataSource(issue: LintZodIssue, component: AnyRec): boolean {
  if (issue.path.length !== 1 || issue.path[0] !== DATASOURCE_SUPPLIED_PROP) return false;
  const dataSource = isRec(component.dataSource) ? component.dataSource : undefined;
  return strName(dataSource?.object) !== undefined;
}

/**
 * The `unrecognized_keys` issue hiding inside a collapsed `invalid_union`, when
 * exactly one arm produced one and produced nothing else.
 *
 * Why this is needed at all: zod 4 does not surface arm failures. A union
 * reports as ONE `invalid_union` whose message is the bare `"Invalid input"`,
 * with each arm's issues tucked inside `issue.errors`. `describeIssue` already
 * unpacks that for the human message (#5583), so the named surface and the
 * rename DO reach the author — but the finding was still filed as a value
 * verdict, so a strict union arm and a strict object reported the same fact
 * under two different rule ids with two different hints. #4001 batch A closed
 * `RecordHighlightsField`'s object arm and `record:related_list`'s sort-entry
 * arm, which made that split load-bearing rather than theoretical.
 *
 * ⚠️ The one-arm condition is the whole correctness of this. A union arm
 * rejecting a key does NOT mean the author meant that arm — `fields: ['status']`
 * is a perfectly good `record:highlights` entry through the STRING arm. So the
 * rename is only claimed when every other arm rejected the value for a
 * different reason (a type mismatch: it is an object, they wanted a string) and
 * exactly one arm got far enough to judge keys. Anything else — two arms both
 * complaining about keys, or one arm complaining about both a key and a value —
 * falls through to the ordinary value verdict, where `describeIssue` still
 * prints every arm's own message. Guessing which arm was meant is the failure
 * mode this rule exists to prevent, not one to introduce here.
 */
function unrecognizedKeysFromUnionArm(issue: LintZodIssue): LintZodIssue | undefined {
  if (issue.code !== 'invalid_union') return undefined;
  const arms = issue.errors;
  if (!arms || arms.length === 0) return undefined;
  let found: LintZodIssue | undefined;
  for (const arm of arms) {
    const keyIssues = arm.filter((inner) => inner.code === 'unrecognized_keys');
    if (keyIssues.length === 0) continue;
    // This arm judged keys — it must have judged ONLY keys, and be the only
    // such arm, or we cannot say which shape the author was reaching for.
    if (keyIssues.length !== arm.length || found) return undefined;
    found = keyIssues[0];
  }
  return found;
}

export function validateComponentProps(stack: AnyRec): ComponentPropsFinding[] {
  const findings: ComponentPropsFinding[] = [];
  if (!isRec(stack)) return findings;

  const pages = asArray(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!isRec(page)) continue;
    const pageName = strName(page.name) ?? `#${pi}`;

    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = strName(component.type);
      if (!type) continue;
      // Unregistered type — skipped silently. See the module header: `type` is
      // an open union and the majority of authored nodes are SDUI blocks this
      // map does not carry.
      const schema = PROPS_SCHEMAS[type];
      if (!schema) continue;
      const props = isRec(component.properties) ? component.properties : undefined;
      if (!props) continue;

      const where = `page "${pageName}" · ${type}`;
      const base = `${path}.properties`;

      // ── Undeclared keys ──────────────────────────────────────────────
      // The walker descends: `RecordHighlightsProps.fields[]` is a UNION whose
      // object arm is where `readonly` lives (#5176/#5607), one layer below the
      // props bag, and the authorable-surface walk that runs one level deep
      // does not reach it. This one does, and `validate-component-props.test.ts`
      // pins both directions of that.
      for (const f of lintUnknownKeysAgainstSchema(schema, props, type, base)) {
        findings.push({
          severity: 'warning',
          rule: COMPONENT_PROPS_UNKNOWN_KEY,
          where,
          path: f.path,
          message:
            `\`${f.key}\` is not a prop \`${type}\` declares (ComponentPropsMap, @objectstack/spec/ui), ` +
            'so nothing verifies it: `properties` is an untyped bag, the renderer spreads whatever it ' +
            'carries, and a key it does not read is ignored in silence.' +
            (f.suggestion ? ` Did you mean \`${f.suggestion}\`?` : ''),
          hint:
            f.guidance ??
            (f.suggestion
              ? `Rename \`${f.key}\` → \`${f.suggestion}\`.`
              : `Remove \`${f.key}\`, or — if the component really does honour it — declare it on ` +
                `\`${type}\`'s props schema so the declaration and the renderer agree.`),
        });
      }

      // ── Value verdicts ───────────────────────────────────────────────
      const parsed = schema.safeParse(props);
      if (parsed.success) continue;
      for (const issue of parsed.error?.issues ?? []) {
        if (suppliedByDataSource(issue, component)) continue;
        const at = issue.path.length ? `${base}.${issue.path.join('.')}` : base;
        // A strict UNION ARM reports the same fact one layer in — see
        // `unrecognizedKeysFromUnionArm`. Routed to the unknown-key rule id
        // rather than left as a value verdict, so a closed arm and a closed
        // object are one diagnostic for the author.
        const armIssue = unrecognizedKeysFromUnionArm(issue);
        if (armIssue) {
          for (const key of armIssue.keys ?? []) {
            findings.push({
              severity: 'warning',
              rule: COMPONENT_PROPS_UNKNOWN_KEY,
              where,
              path: `${at}.${key}`,
              message: `\`${key}\` is not a prop \`${type}\` declares (ComponentPropsMap, @objectstack/spec/ui): ${armIssue.message}`,
              hint: `Remove \`${key}\`, or declare it on \`${type}\`'s props schema if the component honours it.`,
            });
          }
          continue;
        }
        // A strict props schema reports its undeclared keys HERE instead of
        // through the walker above. Same fact, same rule id — see the header.
        if (issue.code === 'unrecognized_keys') {
          for (const key of issue.keys ?? []) {
            findings.push({
              severity: 'warning',
              rule: COMPONENT_PROPS_UNKNOWN_KEY,
              where,
              path: `${at}.${key}`,
              message: `\`${key}\` is not a prop \`${type}\` declares (ComponentPropsMap, @objectstack/spec/ui): ${issue.message}`,
              hint: `Remove \`${key}\`, or declare it on \`${type}\`'s props schema if the component honours it.`,
            });
          }
          continue;
        }
        findings.push({
          severity: 'warning',
          rule: COMPONENT_PROPS_INVALID,
          where,
          path: at,
          message: `${at.slice(base.length + 1) || 'properties'}: ${describeIssue(issue, props)}`,
          hint:
            `\`${type}\`'s props are declared by ComponentPropsMap (@objectstack/spec/ui) — the ` +
            'rejection above carries the fix. Advisory for now: the props bag is not parsed on the ' +
            'storage path either, so nothing rejects this today (objectstack#5068).',
        });
      }
    }
  }

  return findings;
}
