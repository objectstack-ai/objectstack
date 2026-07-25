// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { bundleRequire } from 'bundle-require';
import { normalizeStackInput } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { loadConfig, BUNDLE_REQUIRE_EXTERNALS } from '../utils/config.js';
import { computeI18nCoverage, type CoverageIssue } from '../utils/i18n-coverage.js';
import { lintDataModel } from '../lint/data-model-rules.js';
import { validateWidgetBindings } from '@objectstack/lint';
import { validateRecordTitle, validateSemanticRoles, validateCapabilityReferences, validateSecurityPosture, validateApprovalApprovers, validateSeedReplaySafety, validateSeedStateMachine } from '@objectstack/lint';
import { collectAndLintDocs } from '../utils/collect-docs.js';
import { scoreMetadata } from '../lint/score.js';
import { runMetadataEval } from '../lint/metadata-eval.js';
import { DEFAULT_METADATA_EVAL_CORPUS } from '../lint/corpus.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
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

function checkLabelCase(label: string, path: string): LintIssue | null {
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

function getViewLabel(view: any, viewPath: string): { label?: string; path: string } {
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

// ─── Lint Engine ────────────────────────────────────────────────────

export function lintConfig(config: any): LintIssue[] {
  const issues: LintIssue[] = [];

  const push = (issue: LintIssue | null) => {
    if (issue) issues.push(issue);
  };

  // ── Objects ──
  const objects: any[] = Array.isArray(config.objects) ? config.objects : [];

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
  const views: any[] = Array.isArray(config.views) ? config.views : [];
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
  const apps: any[] = Array.isArray(config.apps) ? config.apps : [];
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
  const flows: any[] = Array.isArray(config.flows) ? config.flows : [];
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i];
    const flowPath = `flows[${i}]`;
    if (flow.name) {
      push(checkSnakeCase(flow.name, `${flowPath}.name`, 'Flow name'));
    }
  }

  // ── Agents ──
  const agents: any[] = Array.isArray(config.agents) ? config.agents : [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const agentPath = `agents[${i}]`;
    if (agent.name) {
      push(checkSnakeCase(agent.name, `${agentPath}.name`, 'Agent name'));
    }
  }

  // ── Intra-package duplicate-name advisory (ADR-0048 §3.4) ──
  // ADR-0048 §3.4 retired the per-item CROSS-package throw: package ids are
  // globally unique, so two installed packages shipping the same bare name
  // (e.g. `page/home`) legitimately COEXIST under distinct composite keys and
  // each caller resolves to its own via package-scoped resolution. A bare name
  // is therefore NOT a collision risk and must not warn on its own.
  //
  // What the lint still earns its keep on is the narrow authoring-time hygiene
  // case the ADR explicitly leaves to `os lint`: "an author shipping two
  // `page/home` in one package". Two items of the same (type, name) declared
  // within ONE package's config share a single composite registry key and
  // shadow each other (last-write-wins). We only see one package's config here,
  // so the legitimate signal is a genuine duplicate `(type, name)` pair within
  // it — never a unique bare name.
  //
  // Objects are already prefix-*enforced* (error) in defineStack; views are
  // object-derived; `doc` has its own build lint — so they are excluded here.
  const ns: string | undefined = config.manifest?.namespace;

  // Bare-named UI/automation types that share the generic registry namespace.
  // Data-driven so a new bare-named type is one line.
  const PREFIXED_TYPES: Array<{ key: string; label: string }> = [
    { key: 'apps', label: 'App' },
    { key: 'pages', label: 'Page' },
    { key: 'dashboards', label: 'Dashboard' },
    { key: 'flows', label: 'Flow' },
    { key: 'actions', label: 'Action' },
    { key: 'reports', label: 'Report' },
    { key: 'datasets', label: 'Dataset' },
  ];

  for (const { key, label } of PREFIXED_TYPES) {
    const items: any[] = Array.isArray(config[key]) ? config[key] : [];
    // First occurrence of each name → its index, so a later duplicate can point
    // back at the original declaration.
    const firstSeen = new Map<string, number>();
    for (let i = 0; i < items.length; i++) {
      const name = items[i]?.name;
      if (typeof name !== 'string' || !name) continue;
      const original = firstSeen.get(name);
      if (original === undefined) {
        firstSeen.set(name, i);
        continue;
      }
      // Genuine intra-package duplicate: two items of the same (type, name)
      // declared in this package's config. They collapse onto one registry key
      // and shadow each other. Renaming one with the package namespace prefix
      // (`crm_home`) is the simplest fix; any distinct name works.
      const suggestion = ns && !name.startsWith(`${ns}_`) ? `${ns}_${name}` : undefined;
      issues.push({
        severity: 'warning',
        rule: 'naming/namespace-prefix',
        message:
          `${label} "${name}" is declared more than once in this package ` +
          `(also at ${key}[${original}].name). Two items of the same type sharing ` +
          `a bare name within one package shadow each other on the registry key ` +
          `(ADR-0048 §3.4) — rename one${suggestion ? `, e.g. "${suggestion}"` : ''}. ` +
          `Distinct packages may reuse the same name freely; the namespace prefix ` +
          `is an optional convention, not a collision-avoidance requirement.`,
        path: `${key}[${i}].name`,
        ...(suggestion ? { fix: suggestion } : {}),
      });
    }
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
    const manifest = config.manifest as Record<string, any> | undefined;
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

  // ── Data-model best practices (relationships / master-detail / roll-ups) ──
  // Cross-object rules that encode the conventions in ADR-0035 and the
  // objectstack-data/-ui skills. These double as the eval rubric (see score.ts).
  issues.push(...lintDataModel(objects));

  // ── Dashboard widget bindings (ADR-0021, issues #1719/#1721) ──
  // Reference integrity (errors): widget `dataset`/`dimensions`/`values` and
  // chartConfig axis/series fields must resolve against the declared
  // datasets. Advisory shapes (warnings): e.g. a table/pivot widget whose
  // binding resolves to count-only measures with no dimensions — almost
  // always a record listing that belongs in an object-bound ListView
  // (ADR-0017), not an analytics dataset.
  for (const w of validateWidgetBindings(config)) {
    issues.push({
      severity: w.severity,
      rule: w.rule,
      message: `${w.where}: ${w.message}`,
      path: w.path,
      fix: w.hint,
    });
  }

  // ── Record-title contract (ADR-0079) ──
  // titleFormat is retired (render-only template the server can't return or
  // query) in favour of nameField; and an object with no resolvable title
  // (no nameField/displayNameField and nothing derivable) ships records with
  // no meaningful name. Both are advisory warnings — the auto-provision
  // transform and the `Record #<id>` floor keep a green build from ever
  // shipping a fully title-less object (the ADR-0078 "not cloud-only" parity
  // with cloud graph-lint).
  for (const t of validateRecordTitle(config)) {
    issues.push({
      severity: t.severity,
      rule: t.rule,
      message: `${t.where}: ${t.message}`,
      path: t.path,
      fix: t.hint,
    });
  }

  // ── Semantic-role pointers (ADR-0085) ──
  // stageField / highlightFields / Field.group are pointers into the object's
  // field map; a dangling pointer is Zod-valid but silently inert at render
  // time (the ADR-0078 completeness gate). All advisory — every consumer
  // degrades gracefully.
  for (const t of validateSemanticRoles(config)) {
    issues.push({
      severity: t.severity,
      rule: t.rule,
      message: `${t.where}: ${t.message}`,
      path: t.path,
      fix: t.hint,
    });
  }

  // ── Capability references (ADR-0066 ⑨) ──
  // requiredPermissions naming a capability that is registered nowhere
  // (no built-in, no permission set grants it, no sys_capability seed) is
  // almost certainly a typo. Advisory — the reference fails closed at runtime,
  // and the capability may legitimately be provided by another installed package.
  for (const t of validateCapabilityReferences(config)) {
    issues.push({
      severity: t.severity,
      rule: t.rule,
      message: `${t.where}: ${t.message}`,
      path: t.path,
      fix: t.hint,
    });
  }

  // ── Security posture (ADR-0090 D7) ──
  // The security-domain publish linter: unset/alias OWD, external dial wider
  // than internal, wildcard VAMA, high-privilege everyone-suggested sets, the
  // reserved word "role", and private-object read grants with no depth. Runs
  // on the NORMALIZED (pre-zod) input here, so alias values that the schema
  // gate would reject in `os compile` get a located fix-it instead of a Zod
  // enum error. `error` findings gate `os compile`; `info` maps to suggestion.
  for (const t of validateSecurityPosture(config)) {
    issues.push({
      severity: t.severity === 'info' ? 'suggestion' : t.severity,
      rule: t.rule,
      message: `${t.where}: ${t.message}`,
      path: t.path,
      fix: t.hint,
    });
  }

  // ── Approval-node approvers (ADR-0090 D3 fallout) ──
  // `{ type: 'role' }` resolves against the better-auth org-membership tier
  // (owner/admin/member), NOT positions — a position name authored there
  // silently routes the approval to nobody. Advisory: the fix-it points at
  // `{ type: 'position' }` (sys_user_position).
  for (const t of validateApprovalApprovers(config)) {
    issues.push({
      severity: t.severity === 'info' ? 'suggestion' : t.severity,
      rule: t.rule,
      message: `${t.where}: ${t.message}`,
      path: t.path,
      fix: t.hint,
    });
  }

  // ── Seed replay safety (framework#3434) ──
  // Seeds are replayed on every boot / re-publish, so a `mode: 'insert'` dataset
  // duplicates its table on every restart (the loader's insert path has no
  // existing-row check). Advisory: the fix-it points at `ignore`/`upsert` + an
  // `externalId` (single field, or a composite list for a join table).
  for (const t of validateSeedReplaySafety(config)) {
    issues.push({
      severity: t.severity,
      rule: t.rule,
      message: `${t.where}: ${t.message}`,
      path: t.path,
      fix: t.hint,
    });
  }

  // ── Seed value vs state machine (framework#3433 follow-up) ──
  // #3433 exempts seed writes from the `state_machine` rule, so a seeded status
  // the FSM does not declare is no longer rejected at write time. Re-add that
  // safety net at author time: a value outside the machine's declared states is
  // almost certainly a typo. Advisory — the exemption itself is legitimate.
  for (const t of validateSeedStateMachine(config)) {
    issues.push({
      severity: t.severity,
      rule: t.rule,
      message: `${t.where}: ${t.message}`,
      path: t.path,
      fix: t.hint,
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
      description: 'Default locale for i18n coverage (must be 100% translated)',
      default: 'en',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Lint);
    const configPath = args.config;
    const timer = createTimer();

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

    try {
      const { config, absolutePath } = await loadConfig(configPath);

      if (!flags.json) {
        printInfo(`Config: ${chalk.white(absolutePath)}`);
      }

      const normalized = normalizeStackInput(config as Record<string, unknown>);
      const issues = lintConfig(normalized);

      // ── Package docs (ADR-0046) ── collected src/docs/*.md + inline docs:
      // flatness, namespace-prefixed names, MDX/image ban, link resolution.
      const docsResult = collectAndLintDocs(absolutePath, normalized as Record<string, unknown>);
      for (const d of docsResult.issues) {
        issues.push({ severity: d.severity, rule: d.rule, message: d.message, path: d.path });
      }

      // ── Translation coverage ──
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

      // ── JSON output ──
      if (flags.json) {
        const errors = issues.filter((i) => i.severity === 'error');
        const warnings = issues.filter((i) => i.severity === 'warning');
        const suggestions = issues.filter((i) => i.severity === 'suggestion');
        console.log(JSON.stringify({
          passed: errors.length === 0,
          total: issues.length,
          errors: errors.length,
          warnings: warnings.length,
          suggestions: suggestions.length,
          ...(hiddenPlatform > 0 ? { hiddenPlatform } : {}),
          ...(score ? { score: score.score, grade: score.grade } : {}),
          issues,
          duration: timer.elapsed(),
        }, null, 2));
        if (errors.length > 0) process.exit(1);
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

      // Group by severity
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      const suggestions = issues.filter((i) => i.severity === 'suggestion');

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

      console.log('');

      if (errors.length > 0) process.exit(1);

    } catch (error: any) {
      if (flags.json) {
        console.log(JSON.stringify({ error: error.message }));
        process.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
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

    if (flags.generator) {
      try {
        const { mod } = await bundleRequire({
          filepath: flags.generator,
          external: BUNDLE_REQUIRE_EXTERNALS,
        });
        const fn = (mod as any).default ?? (mod as any).generate;
        if (typeof fn !== 'function') {
          throw new Error('module must default-export a function (prompt, id) => stack');
        }
        generate = fn;
      } catch (error: any) {
        const msg = `Failed to load generator "${flags.generator}": ${error?.message || error}`;
        if (flags.json) console.log(JSON.stringify({ error: msg }));
        else printError(msg);
        process.exit(1);
      }
    }

    const report = await runMetadataEval(DEFAULT_METADATA_EVAL_CORPUS, {
      ...(generate ? { generate } : {}),
      minScore: flags['eval-min'],
    });

    if (flags.json) {
      console.log(JSON.stringify({ ...report, duration: timer.elapsed() }, null, 2));
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
