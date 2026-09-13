// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { bundleRequire } from 'bundle-require';
import { normalizeStackInput, type ConversionNotice } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { GLOBAL_ACTION_OBJECT_KEY } from '@objectstack/objectql';
import { loadConfig, BUNDLE_REQUIRE_EXTERNALS } from '../utils/config.js';
import { computeI18nCoverage, type CoverageIssue } from '../utils/i18n-coverage.js';
import { lintDataModel, runAuthoringRules } from '@objectstack/lint';
import { resolveSduiManifest } from '../utils/sdui-manifest.js';
import { collectAndLintDocs } from '../utils/collect-docs.js';
import { scoreMetadata } from '../lint/score.js';
import { checkHookBodyLowering } from '../lint/hook-body-lowering.js';
import { lowerCallables } from '../utils/lower-callables.js';
import { authoringRuleUnionStack } from '../utils/stack-collections.js';
import { artifactPackages, packageBodyAsStack } from '../utils/artifact-packages.js';
import { runMetadataEval } from '../lint/metadata-eval.js';
import { DEFAULT_METADATA_EVAL_CORPUS } from '../lint/corpus.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  formatConversionNotice,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  isExitSignal,
  errorCodeFields,
  isReportedError,
} from '../utils/format.js';

// ─── Types ──────────────────────────────────────────────────────────

type Severity = 'error' | 'warning' | 'suggestion';

interface LintIssue {
  severity: Severity;
  rule: string;
  message: string;
  path: string;
  fix?: string;
}

// Fold i18n coverage issues into lint issues, separating the platform
// baseline from the user's own metadata. `metadataForm` issues come from
// walking the static platform registries (DEFAULT_METADATA_TYPE_REGISTRY +
// METADATA_FORM_REGISTRY) — ~850 Studio-form keys that the platform packages
// already translate at runtime. On a fresh project they would drown every
// user-authored signal (15.1 third-party eval: 848/848 errors were platform
// noise), so they are hidden unless explicitly requested.
export function foldCoverageIssues(
  coverageIssues: CoverageIssue[],
  includePlatform: boolean,
): { folded: LintIssue[]; hiddenPlatform: number } {
  const folded: LintIssue[] = [];
  let hiddenPlatform = 0;
  for (const c of coverageIssues) {
    if (!includePlatform && c.source === 'metadataForm') {
      hiddenPlatform++;
      continue;
    }
    folded.push({
      severity: c.severity === 'error' ? 'error' : 'warning',
      rule: `i18n/missing-${c.source}`,
      message: c.message,
      path: `translations.${c.locale}.${c.key}`,
    });
  }
  return { folded, hiddenPlatform };
}

// ─── Rules ──────────────────────────────────────────────────────────

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

function checkSnakeCase(value: string, path: string, label: string): LintIssue | null {
  if (!SNAKE_CASE_RE.test(value)) {
    return {
      severity: 'error',
      rule: 'naming/snake-case',
      message: `${label} "${value}" must be snake_case`,
      path,
      fix: value.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().replace(/^_/, '').replace(/-/g, '_'),
    };
  }
  return null;
}

function checkLabelExists(item: any, path: string, kind: string): LintIssue | null {
  if (!item.label) {
    return {
      severity: 'error',
      rule: 'required/label',
      message: `${kind} "${item.name || '?'}" is missing a label`,
      path,
    };
  }
  return null;
}

// A label is not required to be a string. `I18nLabelSchema` (spec
// `ui/i18n.zod`) is `z.union([z.string(), InlineLocaleMapSchema])`, and it is
// the label primitive the whole `ui/` tree imports — so of the four carriers
// this rule is called on, two accept the inline locale map:
// `views[].list.label` / `views[].listViews.*.label` (`ListViewShapeSchema`)
// and `apps[].label` (`AppSchema`). The other two are `z.string()` and reject
// the map at the schema door (`objects[].label`, `objects[].fields.*.label`).
//
// Every call site reaches this function through `any`-typed config walking, so
// the annotation below used to say `string` and be wrong: on a map,
// `label[0]` is `undefined` and `undefined.toUpperCase()` threw. The throw
// escaped `lintConfig` into the command's catch-all, so an author who
// localized an app or list-view label could not lint the project at all —
// every face exited 1 naming no rule, no path and no remedy, on input
// `ObjectStackDefinitionSchema` parses clean.
//
// ⛔ The guard deliberately says NOTHING about a localized label rather than
// resolving the map and case-checking an entry. Case is a property of a
// literal; picking WHICH locale entry a case verdict is taken against is a
// product decision (`resolveI18nLabel` exists, but which entry is
// authoritative for a lint verdict is not this rule's to answer). Widening
// the rule to localized labels is an extension, filed separately; this guard
// is the floor, and it leaves the string branch below byte-identical.
function checkLabelCase(label: unknown, path: string): LintIssue | null {
  if (typeof label !== 'string') return null;
  if (label && label[0] !== label[0].toUpperCase()) {
    return {
      severity: 'warning',
      rule: 'convention/label-case',
      message: `Label "${label}" should start with an uppercase letter`,
      path,
      fix: label.charAt(0).toUpperCase() + label.slice(1),
    };
  }
  return null;
}

// ⚠️ `label` is `unknown`, not `string`: it is read straight off `any`-typed
// config and `ListViewShapeSchema.label` is `I18nLabelSchema`, so the value
// can legitimately be an inline locale map. Annotating it `string` here is
// what let the map reach `checkLabelCase`'s indexing unchecked.
function getViewLabel(view: any, viewPath: string): { label?: unknown; path: string } {
  if (view?.list?.label) {
    return { label: view.list.label, path: `${viewPath}.list.label` };
  }

  const listViews = view?.listViews && typeof view.listViews === 'object' ? view.listViews : {};
  for (const [key, listView] of Object.entries<any>(listViews)) {
    if (listView?.label) {
      return { label: listView.label, path: `${viewPath}.listViews.${key}.label` };
    }
  }

  if (view?.list) {
    return { path: `${viewPath}.list.label` };
  }

  const firstListViewKey = Object.keys(listViews)[0];
  if (firstListViewKey) {
    return { path: `${viewPath}.listViews.${firstListViewKey}.label` };
  }

  return { path: `${viewPath}.list.label` };
}

/**
 * The intra-package duplicate-name advisory (ADR-0048 §3.4), over the
 * declarations of ONE package.
 *
 * ADR-0048 §3.4 retired the per-item CROSS-package throw: package ids are
 * globally unique, so two installed packages shipping the same bare name
 * (e.g. `page/home`) legitimately COEXIST under distinct composite keys and
 * each caller resolves to its own via package-scoped resolution. A bare name
 * is therefore NOT a collision risk and must not warn on its own.
 *
 * What the lint still earns its keep on is the narrow authoring-time hygiene
 * case the ADR explicitly leaves to `os lint`: "an author shipping two
 * `page/home` in one package". Two items of the same (type, name) declared
 * within ONE package's config share a single composite registry key and
 * shadow each other (last-write-wins) — so the legitimate signal is a genuine
 * duplicate `(type, name)` pair within one package, never a unique bare name.
 *
 * ⚠️ [#17821] "Within one package" is the CALLER'S to establish, and this
 * function judges exactly the stack it is handed. It used to be neither: the
 * rule read the ONE flattened array a composed multi-package project carries
 * at its top level (`composeStacks(…, { manifest: 'preserve' })`) while a
 * comment right here asserted "we only see one package's config here". Two
 * packages that each legitimately declared `home` were therefore reported as
 * one package declaring it twice — prescribing a rename of a name that was
 * already correct, with the OTHER package's namespace as the suggested prefix,
 * under a closing sentence saying distinct packages may reuse a name freely.
 * The call site below decides what a package is; this function no longer
 * assumes it.
 *
 * Objects are already prefix-*enforced* (error) in defineStack; views are
 * object-derived; `doc` has its own build lint — so they are excluded here.
 *
 * @param stack      one package's stack — its own collections at the top level
 *                   and its own identity under `manifest`: the shape
 *                   `packageBodyAsStack` builds, or the caller's whole stack
 *                   when that stack IS one package.
 * @param pathPrefix prepended to the emitted `path` AND to the back-pointer
 *                   inside the message, so a finding raised on a multi-package
 *                   artifact resolves in the file the author wrote. Empty —
 *                   today's spelling, byte for byte — when the stack handed in
 *                   is the whole one.
 */
function duplicateNameIssues(stack: any, pathPrefix = ''): LintIssue[] {
  const issues: LintIssue[] = [];
  const ns: string | undefined = stack.manifest?.namespace;

  // Bare-named UI/automation types that share the generic registry namespace.
  // Data-driven so a new bare-named type is one line.
  //
  // `registryKey` maps an item to the key it ACTUALLY occupies at runtime, so
  // the dedup asks "do these two collapse onto one key?" rather than "do they
  // spell the same bare name?". For every type here the two questions coincide
  // — except `actions`, whose engine key is composite (see below).
  const PREFIXED_TYPES: Array<{
    key: string;
    label: string;
    registryKey?: (item: any, name: string) => string;
  }> = [
    { key: 'apps', label: 'App' },
    { key: 'pages', label: 'Page' },
    { key: 'dashboards', label: 'Dashboard' },
    { key: 'flows', label: 'Flow' },
    // An action's engine registration key is `<objectName>:<name>`, NOT the
    // bare name: `standaloneActionOwnerKey` in `@objectstack/objectql` — the
    // single implementation, called directly by the ObjectQL plugin and
    // re-exported by the runtime, whose `standaloneActionObjectName` is now a
    // delegating alias for it — resolves the object half to `objectName`,
    // falling back to the canonical object-less key `GLOBAL_ACTION_OBJECT_KEY`
    // (`'global'`, #3913). So one package legitimately declaring `log_call` on
    // each of five objects occupies five distinct keys and nothing shadows
    // anything — deduping those on the bare name produced 12 fixed false
    // positives per `objectstack lint` run on HotCRM, growing linearly with the
    // object count (#5510), and "just rename one" would have broken the shared
    // i18n keys that shape depends on (#592).
    //
    // `GLOBAL_ACTION_OBJECT_KEY` rather than an inert sentinel like `''` is
    // deliberate: it is the key the engine really registers under, so an action
    // declared on an object actually NAMED `global` and an object-less action
    // of the same name collide for real — and are reported, as they must be.
    // It is spelled as the imported constant rather than a bare `'global'`
    // literal so this reader cannot part from the engine's writer in silence
    // the day the constant moves — the same divergence #14667 removed from the
    // plugin's own copy.
    //
    // Only `objectName` is read. `object`/`entity` are rejected outright by
    // `ActionSchema`'s strict shape with a rename prescription, so they never
    // reach a spec-valid config and a `??` chain here would only fossilize a
    // spelling the contract already refuses (Prime Directive #12).
    {
      key: 'actions',
      label: 'Action',
      registryKey: (item, name) => {
        const objectKey =
          typeof item?.objectName === 'string' && item.objectName
            ? item.objectName
            : GLOBAL_ACTION_OBJECT_KEY;
        return `${objectKey}:${name}`;
      },
    },
    { key: 'reports', label: 'Report' },
    { key: 'datasets', label: 'Dataset' },
  ];

  for (const { key, label, registryKey } of PREFIXED_TYPES) {
    const items: any[] = Array.isArray(stack[key]) ? stack[key] : [];
    // First occurrence of each registry key → its index, so a later duplicate
    // can point back at the original declaration.
    const firstSeen = new Map<string, number>();
    for (let i = 0; i < items.length; i++) {
      const name = items[i]?.name;
      if (typeof name !== 'string' || !name) continue;
      const dedupKey = registryKey ? registryKey(items[i], name) : name;
      const original = firstSeen.get(dedupKey);
      if (original === undefined) {
        firstSeen.set(dedupKey, i);
        continue;
      }
      // Genuine intra-package duplicate: two items landing on ONE registry key
      // in the config of the package this call was handed. They shadow each
      // other. Renaming one with THAT package's namespace prefix (`crm_home` —
      // `ns` is read off the same stack, so it is never a sibling package's)
      // is the simplest fix; any distinct name works.
      const suggestion = ns && !name.startsWith(`${ns}_`) ? `${ns}_${name}` : undefined;
      // An action has a second, usually better remedy than renaming: the two
      // declarations collide only because they agree on `objectName` (or both
      // omit it and fall to `global`), so pointing one at the object it really
      // belongs to separates them while keeping the shared name — the exact
      // move the bare-name dedup used to punish.
      const remedy =
        key === 'actions'
          ? `give one a distinct \`objectName\` (same-named actions on DIFFERENT objects ` +
            `never collide) or rename one${suggestion ? `, e.g. "${suggestion}"` : ''}`
          : `rename one${suggestion ? `, e.g. "${suggestion}"` : ''}`;
      const collapseText =
        key === 'actions'
          ? `Two actions sharing one \`objectName\` (or both object-less) collapse onto ` +
            `the same \`objectName:name\` engine key and shadow each other`
          : `Two items of the same type sharing a bare name within one package ` +
            `shadow each other on the registry key`;
      issues.push({
        severity: 'warning',
        rule: 'naming/namespace-prefix',
        message:
          `${label} "${name}" is declared more than once in this package ` +
          `(also at ${pathPrefix}${key}[${original}].name). ${collapseText} ` +
          `(ADR-0048 §3.4) — ${remedy}. ` +
          `Distinct packages may reuse the same name freely; the namespace prefix ` +
          `is an optional convention, not a collision-avoidance requirement.`,
        path: `${pathPrefix}${key}[${i}].name`,
        ...(suggestion ? { fix: suggestion } : {}),
      });
    }
  }

  return issues;
}

// ─── Lint Engine ────────────────────────────────────────────────────

export interface LintConfigOptions {
  /**
   * ADR-0080 SDUI component manifest, when the project ships one. Present, the
   * JSX gate does full component/prop validation; absent, it stays parse-level.
   * The `os lint` command resolves it; `scoreMetadata` deliberately does not —
   * the scorer is a pure function of a stack and must not read the filesystem.
   *
   * ⚠️ That sentence is about the FILESYSTEM and about nothing else. It is not
   * a decision about WHICH stack the scorer judges: the stack it is handed is
   * still resolved to the collections the author declared, in either ADR-0130
   * D4 shape, by the fold at `lintConfig`'s entry below. ⛔ Do not read it as a
   * warrant for the scorer seeing an unfolded stack.
   */
  sduiManifest?: unknown;
}

/**
 * `os lint`'s whole rubric: the hand-written checks below plus the shared
 * author-time rule registry (#4409), over the stack the author DECLARED.
 *
 * ## Why the fold is here, at the entry, and not at the registry call alone
 *
 * #17069 taught the registry call inside this function to resolve `packages[]`
 * and scoped itself the way `compile.ts` scopes it, writing down exactly what
 * it left behind: "the hand-written checks above and `scoreMetadata` (which
 * reaches `lintConfig` through `lint/score.js`) keep reading the caller's own
 * stack". This is the other half of that staged change, not a reversal of it.
 *
 * The half it left was the sharper one. Under ADR-0130 D4 / option B every
 * definition lives in `packages[]` and the top level carries none, so the
 * hand-written family read an EMPTY stack: a project with a lower-case object
 * label and no name field got `✓ All checks passed`, while the byte-identical
 * top-level spelling of the same metadata got `convention/label-case` and
 * `object/missing-name-field`. `scoreMetadata` reaches this same function, so
 * an option-B project's metadata-quality rubric was computed over nothing and
 * published `100/100 (A)` — the #15658 shape ("the linter found nothing" and
 * "the linter never ran" collapsed into the better-looking one) arriving
 * through the INPUT this time rather than through a swallowed crash.
 *
 * ## Why {@link authoringRuleUnionStack} and not a second fold
 *
 * `stack-collections.ts` is the ONE place this package resolves a
 * package-owned collection, and its rule is present-wins: a key the top level
 * already carries wins, because in today's additive shape that array already
 * IS the union. A stack that carries its collections comes back BY IDENTITY,
 * so every single-package project lints byte-identically to before. A second
 * fold written here could not have that property without re-deriving it, and
 * two folds that disagree is a worse defect than the one being removed.
 *
 * ## What this does NOT decide
 *
 * It does not choose between a per-project and a per-package metadata score.
 * `scoreMetadata` already scores the whole project and always has: its schema
 * half parses the artifact whole and reports `packages.0.manifest.objects.0:
 * …` on an option-B stack today, with no fold anywhere, and on today's
 * additive multi-package shape its lint half already reads the flattened union
 * across every package. This fold makes the option-B shape agree with the
 * additive one — the same thing computed, over a stack that is no longer
 * empty — and raises no new scoping question.
 */
export function lintConfig(config: any, opts: LintConfigOptions = {}): LintIssue[] {
  // The stack as DECLARED, whichever ADR-0130 D4 shape it arrived in. ⛔ Never
  // read `config.KEY` below this line — a check that skipped the fold is
  // exactly the defect #17528 removed, and it would be invisible in every
  // other check, because the run still exits 0 and still prints a score.
  const stack: any = authoringRuleUnionStack(config as Record<string, unknown>);

  const issues: LintIssue[] = [];

  const push = (issue: LintIssue | null) => {
    if (issue) issues.push(issue);
  };

  // ── Objects ──
  const objects: any[] = Array.isArray(stack.objects) ? stack.objects : [];

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const objPath = `objects[${i}]`;

    // Object name must be snake_case
    if (obj.name) {
      push(checkSnakeCase(obj.name, `${objPath}.name`, 'Object name'));
    }

    // Object must have label
    push(checkLabelExists(obj, `${objPath}.label`, 'Object'));

    // Object label conventions
    if (obj.label) {
      push(checkLabelCase(obj.label, `${objPath}.label`));
    }

    // Fields
    if (obj.fields && typeof obj.fields === 'object') {
      const fieldNames = Object.keys(obj.fields);

      if (fieldNames.length === 0) {
        issues.push({
          severity: 'warning',
          rule: 'structure/empty-fields',
          message: `Object "${obj.name || '?'}" has an empty fields map`,
          path: `${objPath}.fields`,
        });
      }

      for (const fieldName of fieldNames) {
        const field = obj.fields[fieldName];
        const fieldPath = `${objPath}.fields.${fieldName}`;

        // Field key must be snake_case
        push(checkSnakeCase(fieldName, fieldPath, 'Field name'));

        // Field must have label
        if (field && typeof field === 'object') {
          push(checkLabelExists({ ...field, name: fieldName }, `${fieldPath}.label`, 'Field'));
          if (field.label) {
            push(checkLabelCase(field.label, `${fieldPath}.label`));
          }
        }
      }
    } else if (!obj.fields) {
      issues.push({
        severity: 'error',
        rule: 'structure/no-fields',
        message: `Object "${obj.name || '?'}" has no fields defined`,
        path: `${objPath}.fields`,
      });
    }
  }

  // ── Views ──
  const views: any[] = Array.isArray(stack.views) ? stack.views : [];
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const viewPath = `views[${i}]`;
    if (view.name) {
      push(checkSnakeCase(view.name, `${viewPath}.name`, 'View name'));
    }
    const viewLabel = getViewLabel(view, viewPath);
    push(checkLabelExists({ label: viewLabel.label, name: view.name }, viewLabel.path, 'View'));
    if (viewLabel.label) {
      push(checkLabelCase(viewLabel.label, viewLabel.path));
    }
  }

  // ── Apps ──
  const apps: any[] = Array.isArray(stack.apps) ? stack.apps : [];
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    const appPath = `apps[${i}]`;
    if (app.name) {
      push(checkSnakeCase(app.name, `${appPath}.name`, 'App name'));
    }
    push(checkLabelExists(app, `${appPath}.label`, 'App'));
    if (app.label) {
      push(checkLabelCase(app.label, `${appPath}.label`));
    }
  }

  // ── Flows ──
  const flows: any[] = Array.isArray(stack.flows) ? stack.flows : [];
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i];
    const flowPath = `flows[${i}]`;
    if (flow.name) {
      push(checkSnakeCase(flow.name, `${flowPath}.name`, 'Flow name'));
    }
  }

  // ── Agents ──
  const agents: any[] = Array.isArray(stack.agents) ? stack.agents : [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const agentPath = `agents[${i}]`;
    if (agent.name) {
      push(checkSnakeCase(agent.name, `${agentPath}.name`, 'Agent name'));
    }
  }

  // ── Intra-package duplicate-name advisory (ADR-0048 §3.4) ──
  //
  // [#17821 / ADR-0130 D4-D5] An artifact registers PER PACKAGE, so the
  // advisory is evaluated per package — the shape `compile.ts` step 3b-ii
  // already runs the author-time rule table in, reached through the same two
  // seams (`artifactPackages`, `packageBodyAsStack`) rather than a second copy
  // of them.
  //
  // ⛔ This is NOT "skip the site per package" — `compile.ts`' own fence, and
  // it binds here too. Every finding the advisory exists to raise is still
  // raised, on the package that owns it; what changed is that a name is judged
  // against ITS OWN package's declarations instead of against the union of
  // every package's. The defect was missing attribution, never the signal.
  //
  // Fewer than two packages ⇒ the existing read already IS the per-package
  // read, so it is kept verbatim: a stack with no `packages[]` is one package
  // by definition, and with exactly one the top level carries that package's
  // collections and nothing else, in its own order. Keeping it also keeps a
  // hand-written top-level declaration that no package entry carries inside
  // the advisory's reach, and keeps every finding's `path` in the same
  // coordinates the rest of this function reports in.
  //
  // With two or more, the flattened top level MIXES packages and the
  // per-package index is the only true one — so the path is written whole
  // (`packages[1].manifest.apps[1].name`), which resolves in both ADR-0130 D4
  // shapes, rather than as a bare `apps[1]` that in the additive shape points
  // at a different item than the one being reported.
  //
  // ⚠️ The boundary, stated rather than implied: with two or more packages a
  // top-level declaration that no package entry carries is outside every
  // registration unit and is judged by neither leg. `composeStacks` cannot
  // emit that shape — the flattened top level is exactly the union of the
  // packages it composed.
  const packageEntries = artifactPackages(stack);
  if (packageEntries.length > 1) {
    for (const pkg of packageEntries) {
      issues.push(...duplicateNameIssues(
        packageBodyAsStack(pkg.body, stack.packages),
        `packages[${pkg.index}].manifest.`,
      ));
    }
  } else {
    issues.push(...duplicateNameIssues(stack));
  }

  // ── Protocol compatibility range (ADR-0087 D1) ──
  // The `engines.protocol` handshake is only as good as its coverage: a package
  // that declares no range is grandfathered at install/load (warn-only), so the
  // mismatch it would have caught surfaces as a deep crash instead. This nudge
  // is the ratchet that closes grandfathering — scaffolds stamp the range for
  // new packages; lint flags existing ones that never declared it.
  // Scoped to configs that declare a manifest — a bare metadata fragment (no
  // package identity) has nowhere to hang an engines range.
  {
    const manifest = stack.manifest as Record<string, any> | undefined;
    const hasRange =
      typeof manifest?.engines?.protocol === 'string' ||
      typeof manifest?.engines?.platform === 'string' ||
      typeof manifest?.engine?.objectstack === 'string';
    if (manifest && !hasRange) {
      issues.push({
        severity: 'warning',
        rule: 'protocol/missing-engines-range',
        message:
          'Package declares no `engines.protocol` range — a protocol-incompatible runtime ' +
          'cannot refuse it at the boundary (ADR-0087 D1) and it loads unchecked (grandfathered).',
        path: 'manifest.engines.protocol',
        fix: `engines: { protocol: '^${PROTOCOL_MAJOR}' }`,
      });
    }
  }

  // ── Hook/action bodies that cannot be lowered to metadata (#13651) ──
  // `os build` catches every extraction refusal, warns, and bundles the closure
  // at exit 0 — so an app can stop being shippable as pure metadata with nothing
  // red anywhere. This rule is the "no" to that recorded array. It runs the SAME
  // `extractHookBody` the build runs, so the two cannot disagree, and it splits
  // the accidental class (an `error`, which a gate can fail on) from the
  // structural one (a `warning`, because bundling is its designed answer). It
  // does NOT move what `os build` accepts; see the rule module's header.
  //
  // Reads FUNCTION values, so it must run on the normalized input before any
  // Zod parse — which is where `lintConfig` already sits.
  issues.push(...checkHookBodyLowering(stack as Record<string, unknown>));

  // ── Data-model best practices (relationships / master-detail / roll-ups) ──
  // Cross-object rules that encode the conventions in ADR-0035 and the
  // objectstack-data/-ui skills. These double as the eval rubric (see score.ts).
  issues.push(...lintDataModel(objects));

  // ── The author-time rule registry (#4409) ──
  // Everything above this line is `os lint`'s OWN rubric: naming, labels,
  // structure, data-model conventions. Its `error` severity is a lint verdict,
  // not a publish gate — `os build` has never rejected a camelCase object name.
  //
  // Everything below comes from the table the three authoring commands share.
  // `os lint` used to hand-wire its own subset of it, and the subsets disagreed:
  // it ran `validateApprovalApprovers` (which gates) that neither other command
  // ran, and missed six gating rules that both of them ran — so it returned
  // clean for stacks `os build` rejects AND rejected stacks `os build` ships.
  // A pre-flight that disagrees with the gate in both directions is worse than
  // no pre-flight: the only rational responses are to re-verify everything or
  // to stop trusting it.
  //
  // The registry is `os lint`'s single call site into that set. Adding a rule
  // there reaches this command with no edit here. Do NOT import a rule directly.
  //
  // `os lint` does not Zod-parse (a schema error is `os validate`'s verdict to
  // give), so the registry runs both stack tiers against the normalized input —
  // which is what this command already did for the reference-integrity suite
  // and the security linter.
  //
  // ── The `parsed` tier is handed the LOWERED view (#16095) ──
  // A hook authored as an inline `handler` function carries no `body`, and the
  // `hook-body-*` / `hook-api-update-readonly-*` family opens on
  // `body.language === 'js'` — so on the un-lowered stack the whole family
  // returned before reading anything, while the reference app authors 39 of
  // 39 hooks that way. `os build` never had that gap: it runs `lowerCallables`
  // BEFORE its parse and judges the lowered stack, so the same rules fire
  // there. This is the same call on the same normalized input, so what the
  // family sees here cannot drift from what `os build` sees (the parity
  // `checkHookBodyLowering` above already claims for the refusal side).
  //
  // What this changes and what it does not:
  //   - `parsed`-tier rules see `body: { language: 'js', source }` on every
  //     hook/action whose handler extracts, and `handler: '<ref>'` in place of
  //     the function — exactly the stack `os build` parses. Still unparsed:
  //     no defaults are filled, which is the standing condition of this tier
  //     under `os lint` and one every rule already tolerates.
  //   - `normalized`-tier rules keep the un-lowered input, as they do in `os
  //     build` (which hands them `normalized`, not `lowering.lowered`).
  //   - `lowerCallables` returns a NEW top-level object and re-maps the slots
  //     it touches (`hooks`, `objects[*].actions`, `actions`, `functions`,
  //     `packages[*].manifest`); the caller's stack is never mutated, so the
  //     function-reading rule above and `scoreMetadata` keep their live
  //     callables. A handler the extractor refuses is left with no `body` —
  //     the family stays silent on it and `checkHookBodyLowering` is what
  //     reports it, so no verdict is ever given about a body that was not
  //     produced. Nothing here touches what `os build` accepts (#13838).
  //
  // ── Both tiers are handed the UNION-FOLDED stack (ADR-0130 D4, #17069) ──
  // Under option B every definition lives in `packages[]` and the top level
  // carries none, so both tiers above were handed an EMPTY stack: the whole
  // table reported nothing and `os lint` returned no finding of any severity
  // for a project `os build` refuses. `authoringRuleUnionStack` is the one
  // helper `compile.ts` calls for its union run — the same fold, not a second
  // one — and it fills only the collections the top level does not carry, so
  // a stack that still carries them comes back BY IDENTITY and every
  // single-package project lints exactly as before.
  //
  // ⭐ #17069 scoped its fold to THIS CALL, as `compile.ts` scopes its own, and
  // named the two things it deliberately left reading the caller's own stack:
  // "the hand-written checks above and `scoreMetadata`". #17528 is the other
  // half of that staged change — the fold now happens ONCE, at this function's
  // entry, so every check in it and every caller of it (the `os lint` command
  // and `scoreMetadata`) judge one stack. ⛔ There is still exactly one fold
  // and one helper: `lowerCallables` shallow-clones the top level it is handed,
  // so `lowered` already carries the folded collections and re-folding it here
  // would be a second call that could only ever return by identity.
  const { lowered, loweredHookRefs } = lowerCallables(stack as Record<string, unknown>);
  for (const f of runAuthoringRules('lint', {
    normalized: stack,
    parsed: lowered,
    sduiManifest: opts.sduiManifest,
    // [#16546] Same ref set `os build` computes from the same normalized
    // input — what lets `validateReadonlyHookWrites` / `validateHookBodyWrites`
    // report `hooks[i].handler` here byte-identically to `os build`.
    loweredHookRefs,
  })) {
    issues.push({
      severity: f.severity === 'info' ? 'suggestion' : f.severity,
      rule: f.rule,
      message: `${f.where}: ${f.message}`,
      path: f.path,
      fix: f.hint,
    });
  }

  return issues;
}

// ─── Command ────────────────────────────────────────────────────────

export default class Lint extends Command {
  static override description = 'Check ObjectStack configuration for style and convention issues';

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON' }),
    fix: Flags.boolean({ description: 'Show what would be fixed (dry-run)' }),
    strict: Flags.boolean({
      description:
        'Fail the run (exit 1) on warning-severity findings too, exactly as an error does; suggestions stay advisory. Without it only errors fail',
    }),
    score: Flags.boolean({
      description: 'Print a 0–100 metadata-quality score (the lint rubric) for this project',
    }),
    eval: Flags.boolean({
      description: 'Run the metadata-generation eval over the bundled golden corpus and report scores',
    }),
    generator: Flags.string({
      description: 'Path to a module that default-exports (prompt, id) => stack; enables live eval (scores generated output instead of fixtures). Requires --eval.',
    }),
    'eval-min': Flags.integer({
      description: 'Minimum passing score per eval case',
      default: 75,
    }),
    'skip-i18n': Flags.boolean({ description: 'Skip translation coverage checks' }),
    'include-platform': Flags.boolean({
      description:
        'Also report i18n coverage for platform built-in metadata forms (hidden by default — the platform packages ship those translations)',
    }),
    'i18n-strict': Flags.boolean({
      description: 'Treat missing translations in non-default locales as errors',
    }),
    'default-locale': Flags.string({
      description:
        "Default locale for i18n coverage (must be 100% translated). Defaults to the config's i18n.defaultLocale, else 'en'.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Lint);
    const configPath = args.config;
    const timer = createTimer();

    // ── `--generator` means nothing without `--eval` — refuse, don't ignore ──
    //
    // [#15550] The flag's own description ends "Requires --eval." and nothing
    // checked it. Driven on this entry before this change, from a lint-clean
    // project, with a generator that writes a marker file at TOP-LEVEL
    // evaluation so "was it loaded?" is answered by the filesystem rather than
    // by reading the control flow:
    //
    //     os lint --generator ./gen-marker.mjs            exit 0 · All checks passed · marker ABSENT
    //     os lint --generator ./does-not-exist.mjs        exit 0 · All checks passed
    //     os lint --json --generator ./does-not-exist.mjs exit 0 · {"passed":true,…}
    //
    // ⇒ accepted by the parser, never loaded, and not named once on either
    // face — a path that does not exist passes too. `flags.generator` is read
    // at exactly three sites, all inside `runEval`, which `run()` reaches only
    // when `flags.eval` is set, so outside eval mode the flag reaches no code
    // at all.
    //
    // That is Prime Directive #10's declared-≠-enforced shape landing on the
    // person least able to diagnose it: a successful-looking run whose
    // generator was never called, saying nothing. The direction is #12 — refuse
    // the off-contract invocation loudly at the boundary. The alternative
    // repair, deleting "Requires --eval." from the description, was rejected
    // for the reason that sentence exists: nothing outside eval mode reads this
    // flag, so dropping the claim documents a no-op flag instead of removing
    // one, and blesses the silent acceptance rather than ending it.
    //
    // ⛔ NOT oclif's `dependsOn: ['eval']` — and the reason is BLAST RADIUS,
    // not an inability to answer inside this command's envelope.
    //
    // Bare `dependsOn` refuses in the PARSER, before the command runs, so its
    // refusal is oclif's: exit 2, and under `--json` an EMPTY STDOUT. (The
    // stack trace that accompanies it on `bin/run-dev.js` is a DEV-ENTRY
    // artefact of `settings.debug`; the shipped `bin/run.js` prints oclif's
    // pretty message with no stack. Don't generalise the dev entry's output.)
    //
    // ⚠️ That much CAN be brought inside the envelope: a `catch()` override on
    // the parse was measured answering exit 1 with `{error}` on the `--json`
    // face and an empty stderr. So "the framework spelling cannot be
    // enveloped" is FALSE, and ⛔ nobody should re-derive this choice from it.
    //
    // The real objection is scope. That override re-shapes EVERY parse error on
    // this command, not the one precondition this card is about: every unknown
    // flag and every bad value would move from exit 2 / stderr to exit 1 /
    // stdout, and would carry oclif's own prose plus its `--help` hint inside
    // the JSON `error` string — a wide, uncommissioned change to the very
    // `--json` envelope #15549/#16044 had just repaired one exit over. A guard
    // here moves ONE invocation class and leaves every other parse error
    // exactly as it was, while keeping the envelope this command already
    // answers with: the human message on `error`, exit 1, both faces.
    //
    // ⛔ Nor the raw-argv guard `os migrate meta` uses for its stored-only
    // flags. That one exists because oclif reads a `default: false` boolean and
    // an `env`-backed string as "provided"; `--generator` has neither a default
    // nor an `env`, so `!== undefined` already means the operator typed it.
    //
    // ⛔ Nothing is minted: no `code` is attached. This refusal has no producer
    // error to pass one through, and ADR-0112's ledger is the authority on who
    // may mint one — the same restraint the generator-load exit below keeps.
    if (flags.generator !== undefined && !flags.eval) {
      const message =
        '--generator only applies to `os lint --eval` (the metadata-generation eval). '
        + 'Without --eval this command lints the current project and never loads the generator. '
        + 'Re-run as `os lint --eval --generator <module>`.';
      if (flags.json) await emitJson({ error: message }, 0, { compact: true });
      else printError(message);
      process.exit(1);
    }

    // ── Eval mode — score generated metadata against the convention rubric ──
    // Short-circuits the project lint: this evaluates a generation corpus, not
    // the current config.
    if (flags.eval) {
      await this.runEval(flags, timer);
      return;
    }

    if (!flags.json) {
      printHeader('Lint');
      printStep('Loading configuration...');
    }

    // [#12297] The ADR-0087 D2 conversion notices this command raises.
    //
    // ⛔ This is the #3782 PARITY class, NOT the "computed, then dropped"
    // family (#11643 / #11391 / #11772 / #12047 / #12125). Nothing was computed
    // and discarded here: `normalizeStackInput` was called with no options
    // object at all, so no sink existed and the notices were never PRODUCED —
    // in either face. `os lint` is the third of the three authoring commands
    // the #4409 registry holds to one bar, and it was the only one telling an
    // author nothing about a conversion its own load path had just applied.
    // That is the exact gap `os build` was in before #11772 / PR #12079.
    //
    // It bites harder than it reads: a conversion notice is the one advisory
    // class carrying an EXPIRY — `retiresIn` names the protocol major where the
    // old shape stops loading — and an author whose only authoring gate is
    // `os lint` got no signal at all until the conversion retired and their
    // metadata stopped loading.
    //
    // Declared above the `try` so the catch-all exit can read it, under the
    // maintainer's 2026-08-25 ruling (#11772/#12047, applied to this field by
    // #12125): every failure exit carries the lists the run has ALREADY
    // COMPUTED, so the field means the same thing on every exit. The CALL that
    // fills it stays below, at the step that owns it — a throw in `loadConfig`,
    // above it, reports `[]` honestly.
    //
    // ⛔ NOT FOLDED INTO `issues`. Whether an auto-converted key should become
    // a `LintIssue` — or, on the sibling commands, whether `warnings` and
    // `conversions` should become one field — is an open question raised on
    // #12125, left unsettled by the ruling there and explicitly withheld by
    // that card's implementer. This change had no authority to settle it, so it
    // mirrors the shipped sibling shape rather than merging: `issues` keeps
    // meaning "something to fix", the notice keeps its structured
    // `conversionId`/`surface`/`from`/`to`/`retiresIn` fields, and the
    // `total`/`errors`/`warnings` counts keep counting exactly what they
    // counted before.
    const conversionNotices: ConversionNotice[] = [];

    try {
      const { config, absolutePath } = await loadConfig(configPath);

      if (!flags.json) {
        printInfo(`Config: ${chalk.white(absolutePath)}`);
      }

      // The ADR-0087 D2 conversion layer runs here, inside `normalizeStackInput`
      // — it always did. Passing the sink is what makes the rewrites SAYABLE.
      const normalized = normalizeStackInput(config as Record<string, unknown>, {
        onConversionNotice: (n) => conversionNotices.push(n),
      });
      // The human face, mirroring the #11772 repair in `compile.ts` verbatim —
      // same wording, so an author who runs two of the three commands over one
      // tree is told the same thing in the same words.
      if (conversionNotices.length > 0 && !flags.json) {
        console.log('');
        for (const n of conversionNotices) {
          printWarning(formatConversionNotice(n));
        }
      }
      const issues = lintConfig(normalized, { sduiManifest: resolveSduiManifest() });

      // ── Package docs (ADR-0046) ── collected src/docs/*.md + inline docs:
      // flatness, namespace-prefixed names, MDX/image ban, link resolution.
      const docsResult = collectAndLintDocs(absolutePath, normalized as Record<string, unknown>);
      for (const d of docsResult.issues) {
        issues.push({ severity: d.severity, rule: d.rule, message: d.message, path: d.path });
      }

      // ── Translation coverage ──
      // No locale is forced here: `computeI18nCoverage` falls back to the
      // stack's own `i18n` block and, failing that, to the locales its bundles
      // already cover. A project that ships neither is checked against its
      // default locale alone, which its inline labels already satisfy — so this
      // stays silent for projects that do not translate.
      let hiddenPlatform = 0;
      if (!flags['skip-i18n']) {
        const coverage = computeI18nCoverage(normalized, {
          defaultLocale: flags['default-locale'],
          strict: flags['i18n-strict'],
        });
        const { folded, hiddenPlatform: hidden } = foldCoverageIssues(
          coverage.issues,
          flags['include-platform'] ?? false,
        );
        hiddenPlatform = hidden;
        issues.push(...folded);
      }

      // Metadata-quality score (the lint rubric expressed as 0–100).
      const score = flags.score ? scoreMetadata(normalized) : null;

      // ── Verdict ──
      // Only an `error` fails a run by default. `--strict` (#15935) makes a
      // `warning` fail it too — so an app can rely on the warning-level rules
      // this registry ships as its gate instead of re-implementing them
      // locally at error level — while a `suggestion` stays advisory under
      // both. `failing` is the ONE count the exit code is read from, computed
      // here, above the two faces, so `--json` and the console cannot disagree
      // about it. ⛔ The default is deliberately unchanged: promoting warnings
      // for every app is a separate decision, not this flag's.
      const strict = flags.strict ?? false;
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      const suggestions = issues.filter((i) => i.severity === 'suggestion');
      const failing = errors.length + (strict ? warnings.length : 0);

      // ── JSON output ──
      if (flags.json) {
        await emitJson({
          passed: failing === 0,
          total: issues.length,
          errors: errors.length,
          warnings: warnings.length,
          suggestions: suggestions.length,
          // [#15935] The verdict, readable without re-deriving it from the
          // counts: `strict` says whether the flag was in effect, `failing`
          // is the count the exit code was read from — `errors`, or
          // `errors + warnings` under `--strict` — and `passed` is
          // `failing === 0`, the same statement the exit code makes. Both
          // keys are unconditionally present so a gate keying off them never
          // has to distinguish "not strict" from "this build does not say".
          strict,
          failing,
          ...(hiddenPlatform > 0 ? { hiddenPlatform } : {}),
          ...(score ? { score: score.score, grade: score.grade } : {}),
          issues,
          // [#12297] The notices computed at `normalizeStackInput` above. Its
          // own key, unconditionally present — the same `conversions` key
          // `os validate --json` and `os build --json` publish, carrying the
          // same structured notice objects, so one consumer reads all three
          // authoring commands the same way. `[]` when nothing converted, never
          // absent: a machine consumer keying off presence must not have to
          // distinguish "did not convert" from "this command does not tell me".
          conversions: conversionNotices,
          duration: timer.elapsed(),
        }, failing > 0 ? 1 : 0);
        return;
      }

      console.log('');

      const printHiddenPlatform = () => {
        if (hiddenPlatform > 0) {
          console.log(
            chalk.dim(
              `  platform built-ins: ${hiddenPlatform} i18n issue(s) hidden — rerun with --include-platform to audit them`,
            ),
          );
        }
      };

      if (issues.length === 0) {
        printSuccess(`All checks passed ${chalk.dim(`(${timer.display()})`)}`);
        printHiddenPlatform();
        if (score) this.printScore(score);
        console.log('');
        return;
      }

      const printIssue = (issue: LintIssue) => {
        const color =
          issue.severity === 'error' ? chalk.red :
          issue.severity === 'warning' ? chalk.yellow :
          chalk.blue;
        const icon =
          issue.severity === 'error' ? '✗' :
          issue.severity === 'warning' ? '⚠' :
          'ℹ';

        console.log(`  ${color(icon)} ${color(issue.message)}`);
        console.log(chalk.dim(`    ${issue.rule}  at ${issue.path}`));
        if (flags.fix && issue.fix) {
          console.log(chalk.green(`    → fix: ${issue.fix}`));
        }
      };

      if (errors.length > 0) {
        console.log(chalk.bold.red(`  Errors (${errors.length})`));
        errors.forEach(printIssue);
        console.log('');
      }

      if (warnings.length > 0) {
        console.log(chalk.bold.yellow(`  Warnings (${warnings.length})`));
        warnings.forEach(printIssue);
        console.log('');
      }

      if (suggestions.length > 0) {
        console.log(chalk.bold.blue(`  Suggestions (${suggestions.length})`));
        suggestions.forEach(printIssue);
        console.log('');
      }

      // Summary
      const parts: string[] = [];
      if (errors.length > 0) parts.push(chalk.red(`${errors.length} error(s)`));
      if (warnings.length > 0) parts.push(chalk.yellow(`${warnings.length} warning(s)`));
      if (suggestions.length > 0) parts.push(chalk.blue(`${suggestions.length} suggestion(s)`));
      console.log(`  ${parts.join(', ')} ${chalk.dim(`(${timer.display()})`)}`);
      printHiddenPlatform();

      if (score) this.printScore(score);

      if (flags.fix) {
        console.log('');
        printInfo('Dry-run mode: no files were modified.');
      }

      // A run that fails ONLY because of `--strict` says so, naming the count
      // and the flag: the summary line above reads identically with and
      // without the flag, and exit 1 under a heading that says "Warnings" is
      // otherwise a verdict with no stated reason.
      if (strict && warnings.length > 0) {
        console.log('');
        printError(
          `${warnings.length} warning(s) fail this run under --strict (a warning is advisory without the flag)`,
        );
      }

      console.log('');

      if (failing > 0) process.exit(1);

    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        // [#12297] Whatever the run had reached before the throw, under the
        // same 2026-08-25 ruling: `[]` for a throw in `loadConfig` — the
        // normalize step never ran — and the notices in hand for any later one.
        // Wiring the producer without this exit would ship a fresh instance of
        // the #12125 defect one command over, on the day it was closed.
        await emitJson(
          { error: error.message, ...errorCodeFields(error), conversions: conversionNotices },
          0,
          { compact: true },
        );
        process.exit(1);
      }
      // [#15547] `resolveConfigPath()` already wrote its refusal and hint
      // lines to stderr before throwing; printing the sentence again here
      // would put a second copy on stdout.
      if (!isReportedError(error)) {
        console.log('');
        printError(error.message || String(error));
      }
      process.exit(1);
    }
  }

  private printScore(score: ReturnType<typeof scoreMetadata>): void {
    const gColor =
      score.grade === 'A' ? chalk.green :
      score.grade === 'B' ? chalk.cyan :
      score.grade === 'C' ? chalk.yellow :
      chalk.red;
    console.log('');
    console.log(`  ${chalk.bold('Metadata quality:')} ${gColor(`${score.score}/100  (${score.grade})`)}`);
    const c = score.counts;
    console.log(
      chalk.dim(
        `    ${c.schemaErrors} schema · ${c.errors} error(s) · ${c.warnings} warning(s) · ${c.suggestions} suggestion(s)`,
      ),
    );
  }

  /**
   * Eval mode (`--eval`): run the metadata-generation rubric over the bundled
   * golden corpus (offline), or — when `--generator <module>` is supplied —
   * over the stacks that module produces for each prompt (live).
   */
  private async runEval(flags: any, timer: ReturnType<typeof createTimer>): Promise<void> {
    let generate: ((prompt: string, id: string) => unknown | Promise<unknown>) | undefined;

    // [#16161] `!== undefined`, not truthiness — the SAME test the
    // `--generator` precondition guard in `run()` above uses, so one flag has
    // one rule for "the operator typed it".
    //
    // Driven on this entry before this change, from the probe project below,
    // with a generator that writes a marker file at TOP-LEVEL evaluation:
    //
    //     os lint --eval --generator ""   exit 0 · Mode: offline · 5/5 passed · marker ABSENT
    //     os lint --eval                  exit 0 · Mode: offline · 5/5 passed · marker ABSENT
    //
    // Normalise the elapsed-time token and those two stdouts were BYTE-IDENTICAL
    // (one sha256 across both entries, `bin/run-dev.js` and `bin/run.js`);
    // stderr was 0 bytes in all four runs and the `--json` face differed only in
    // `duration`. So the empty string was not merely ineffective — it was
    // indistinguishable from not passing the flag, on every channel this command
    // has, while the report said `Mode: offline` to an operator who had asked for
    // a live run. The classic way to type it is `--generator "$GEN"` with `GEN`
    // unset in a script.
    //
    // ⛔ The opposite rule — empty means "not passed" — is not open here. #15550
    // settled it for the non-eval side one guard up, and the two sides read one
    // flag; splitting them would put two spellings of `--generator` under two
    // rules. Reversing it is a decision, not a patch.
    //
    // ⛔ No new refusal shape is invented for the empty case. Once the load is
    // attempted, an unresolvable path answers the way an unresolvable path
    // already answers here — the `catch` below, exit 1, `Failed to load
    // generator ""` on both faces. That is the same envelope
    // `--generator ./does-not-exist.mjs --eval` has answered with all along; an
    // empty string is a path that names no module, not a separate error class.
    if (flags.generator !== undefined) {
      try {
        const { mod } = await bundleRequire({
          filepath: flags.generator,
          external: BUNDLE_REQUIRE_EXTERNALS,
          // [#16358] Under `--json` this call site had TWO channels, and only
          // one of them was ours. esbuild's own logger writes straight to
          // stderr from inside the bundle, BEFORE anything throws, so the
          // `catch` below — which does produce a correct one-key `{error}`
          // document on stdout — never gets the chance to suppress it.
          // Measured on this entry at 7f96e1417e, both doors:
          //
          //   os lint --eval --json --generator /tmp/os16358/nope.mjs
          //     exit 1 · stdout 143 B (well-formed `{error}`) · stderr 55 B
          //     `✘ [ERROR] Could not resolve "/tmp/os16358/nope.mjs"`
          //   os lint --eval --json --generator ./warns-but-loads.mjs
          //     exit 0 · stdout 3158 B (the eval report) · stderr 340 B
          //     `▲ [WARNING] The "typeof" operator will never evaluate to …`
          //
          // ⇒ the leak is NOT confined to the failure branch. `--json` is a
          // machine face; anything on stderr is a human-channel emission the
          // caller did not ask for, and both of those are an internal
          // bundler's diagnostic rather than an ObjectStack refusal.
          //
          // ⛔ NOTHING is lost from the refusal. esbuild still THROWS its
          // `BuildFailure` with `errors` populated — `logLevel` governs only
          // whether esbuild PRINTS — and that message is already the tail of
          // the `{error}` string the `catch` builds:
          // `… Build failed with 1 error:\nerror: Could not resolve "…"`.
          // Silencing the logger must not silence the refusal, and it does
          // not; `test/lint-eval-generator-load-envelope.e2e.test.ts` pins
          // both halves on the same run.
          //
          // ⚠️ WHAT THIS DOES SUPPRESS, stated rather than shipped quietly:
          // under `--json`, an esbuild WARNING on a generator that loads fine
          // (the second run above) reached stderr before and now reaches
          // nothing — a warning is not thrown, so no `catch` carries it onto
          // stdout. That is inside the defect, not beyond it: the property
          // the sibling pin's comment states is about the `--json` face as a
          // whole, not about its error branch.
          //
          // ⛔ The human face is NOT touched, and is not touched BY
          // CONSTRUCTION rather than by restating a default: when `--json` is
          // absent this passes no `esbuildOptions` at all, so bundle-require's
          // own esbuild defaults apply exactly as before. A `logLevel:
          // 'warning'` written out here would be me copying a default I would
          // then own.
          //
          // ⛔ Scope is this ONE call site. The other `bundleRequire` callers
          // in this package (`utils/config.ts`, `utils/scaffold-validate.ts`,
          // `commands/serve.ts`) keep their diagnostics; a global esbuild
          // silence would trade one under-read for a larger one.
          //
          // Why `logLevel` and not the two alternatives the card left open:
          // esbuild's JS API exposes no logger hook to install (its whole
          // logging surface is `logLevel` plus the `errors`/`warnings` arrays
          // on the result), and capturing `process.stderr.write` around an
          // await is a process-global monkey-patch that would swallow
          // concurrent writes that are not esbuild's.
          ...(flags.json ? { esbuildOptions: { logLevel: 'silent' as const } } : {}),
        });
        const fn = (mod as any).default ?? (mod as any).generate;
        if (typeof fn !== 'function') {
          throw new Error('module must default-export a function (prompt, id) => stack');
        }
        generate = fn;
      } catch (error: any) {
        // [#16359] Our separator `": "` already carries the ONE space between
        // the quoted value and the reason; the detail must not bring a second.
        // `bundle-require` composes its own refusal as
        // `${filepath} is not a valid JS file`, so an EMPTY filepath
        // contributes no characters and that fragment arrives with a LEADING
        // space, which lands against ours. Re-driven at 923caede80 through
        // `od -c`, both faces, `bin/run-dev.js`, `NO_COLOR=1`:
        //
        //   os lint --eval        --generator ""   -> `generator "":  is not a valid JS file`
        //   os lint --eval --json --generator ""   -> the same two spaces inside `{error}`
        //   os lint --eval [--json] --generator <unresolvable path>  -> ONE space
        //
        // ⛔ This is NOT a branch on the empty value. #16161 ruled that the
        // empty string must answer through the door an unresolvable path
        // already answers through, and a bespoke message for it would be the
        // second refusal shape that card exists to avoid. The normalisation
        // below reads the SEAM and never `flags.generator`, and applies to
        // every detail alike — so both inputs still reach this one `catch`,
        // this one composition, this one envelope and this one exit code, and
        // every detail that does not open with a space is byte-identical.
        //
        // Leading SPACES only, deliberately not `trimStart()`: a detail that
        // opens with a newline is a different shape (our space then a line
        // break), not a doubled separator, and stays exactly as it prints
        // today. `test/lint-eval-generator-refusal-separator.test.ts` pins the
        // bytes on both faces, with the unresolvable path as the control.
        const detail = `${error?.message || error}`.replace(/^ +/, '');
        const msg = `Failed to load generator "${flags.generator}": ${detail}`;
        // [#15549] The ADR-0112 carriers, spread from the SAME helper the
        // project-lint catch-all in `run()` uses — not a second shape invented
        // here. Before this, the `catch` built `msg` and DISCARDED `error`, so
        // a machine consumer that reads `code` to branch got a real code from
        // project-lint mode and `undefined` from eval mode, on one command.
        //
        // ⛔ Nothing is MINTED. `errorCodeFields` passes a producer's code
        // through and returns `{}` otherwise — ADR-0112's ledger is the
        // authority on who may mint one — so this exit stays polymorphic in
        // exactly the way its sibling is: the hand-thrown "must default-export
        // a function" above carries neither key and still gets neither.
        //
        // The keys are REACHABLE here, which is what makes this a repair and
        // not a formality. Measured against `bundleRequire` on this entry: a
        // generator whose TOP-LEVEL EVALUATION throws propagates that error
        // intact, so `code: "ENOENT"` (a file the module read at import) and a
        // full `code` + `httpStatus` pair (an SDK refusal at import) both
        // arrive here — and both were being dropped. esbuild's own
        // `BuildFailure` — the unresolvable-path and syntax-error cases —
        // carries neither key, and still correctly emits a bare `{error}`.
        //
        // ⛔ `conversions` is NOT added alongside them: that key on the
        // `--eval` exits is a different card, fenced by #14015 with its own
        // review gate. This changes the carriers only.
        if (flags.json) await emitJson({ error: msg, ...errorCodeFields(error) }, 0, { compact: true });
        else printError(msg);
        process.exit(1);
      }
    }

    const report = await runMetadataEval(DEFAULT_METADATA_EVAL_CORPUS, {
      ...(generate ? { generate } : {}),
      minScore: flags['eval-min'],
    });

    if (flags.json) {
      await emitJson({ ...report, duration: timer.elapsed() });
      if (!report.ok) process.exit(1);
      return;
    }

    printHeader('Metadata Generation Eval');
    printInfo(`Mode: ${chalk.white(report.mode)}  ·  cases: ${report.total}  ·  pass bar: ${flags['eval-min']}`);
    console.log('');

    for (const r of report.results) {
      const ok = r.passed;
      const color = ok ? chalk.green : chalk.red;
      const icon = ok ? '✓' : '✗';
      console.log(`  ${color(icon)} ${chalk.bold(r.id)}  ${color(`${r.score.score}/100 (${r.score.grade})`)}`);
      if (r.generationError) {
        console.log(chalk.red(`    generation error: ${r.generationError}`));
      } else if (!ok) {
        const c = r.score.counts;
        console.log(chalk.dim(`    ${c.schemaErrors} schema · ${c.errors} error(s) · ${c.warnings} warning(s)`));
        const firstReal = r.score.issues.find((i) => i.severity !== 'suggestion') || r.score.issues[0];
        if (firstReal) console.log(chalk.dim(`    e.g. ${firstReal.rule}: ${firstReal.message}`));
      }
    }

    console.log('');
    const summaryColor = report.ok ? chalk.green : chalk.red;
    console.log(
      `  ${summaryColor(`${report.passed}/${report.total} passed`)} · mean ${report.meanScore}/100 ${chalk.dim(`(${timer.display()})`)}`,
    );
    console.log('');

    if (!report.ok) process.exit(1);
  }
}
