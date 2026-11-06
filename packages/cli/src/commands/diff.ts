// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { comparePackageVersions, seedModeOverwritesMatchedRows } from '@objectstack/metadata-core';
import { loadConfig } from '../utils/config.js';
import { authoringRuleUnionStack } from '../utils/stack-collections.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printErrorToStderr,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  errorCodeFields,
  isReportedError,
} from '../utils/format.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface DiffEntry {
  type: 'added' | 'removed' | 'modified';
  category: string;
  name: string;
  detail?: string;
  breaking: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────

function getNames(items: any[] | undefined): Map<string, any> {
  const map = new Map<string, any>();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (item?.name) map.set(item.name, item);
  }
  return map;
}

function diffNamedArrays(
  beforeItems: any[] | undefined,
  afterItems: any[] | undefined,
  category: string,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const beforeMap = getNames(beforeItems);
  const afterMap = getNames(afterItems);

  // Removed items
  for (const [name] of beforeMap) {
    if (!afterMap.has(name)) {
      entries.push({
        type: 'removed',
        category,
        name,
        breaking: true,
      });
    }
  }

  // Added items
  for (const [name] of afterMap) {
    if (!beforeMap.has(name)) {
      entries.push({
        type: 'added',
        category,
        name,
        breaking: false,
      });
    }
  }

  return entries;
}

function seedModeNote(mode: string): string {
  if (seedModeOverwritesMatchedRows(mode)) return '; a replay writes its columns over the rows it matches';
  if (mode === 'replace') return '; a replay deletes every row of the object and inserts these';
  return '';
}

/**
 * Objects, fields and seed datasets, read from the package upgrade plan
 * (`comparePackageVersions`, `@objectstack/metadata-core`) — the comparison
 * the install door's dry run and the `manifest` service's `planUpgrade` read,
 * so this command and an install cannot disagree about one pair of versions.
 *
 * Printed per object as before: removed fields, added fields, then (new with
 * the plan) declared renames, type changes, then suspected renames, then the
 * object's label change. A suspected rename's two keys stay listed as removed
 * and added, as the plan lists them: nothing declares otherwise.
 */
function diffObjectsAndSeeds(beforeConfig: any, afterConfig: any): DiffEntry[] {
  const plan = comparePackageVersions(beforeConfig, afterConfig);
  const entries: DiffEntry[] = [];

  for (const name of plan.objects.removed) entries.push({ type: 'removed', category: 'objects', name, breaking: true });
  for (const name of plan.objects.added) entries.push({ type: 'added', category: 'objects', name, breaking: false });

  const afterObjects = getNames(afterConfig.objects);
  for (const [name, beforeObj] of getNames(beforeConfig.objects)) {
    const afterObj = afterObjects.get(name);
    if (!afterObj) continue;
    const category = `objects.${name}.fields`;
    const mine = <T extends { object: string }>(list: T[]): T[] => list.filter((item) => item.object === name);

    for (const f of mine(plan.fields.removed)) {
      entries.push({ type: 'removed', category, name: f.field, breaking: true, detail: 'field removed' });
    }
    for (const f of mine(plan.fields.added)) {
      entries.push({
        type: 'added',
        category,
        name: f.field,
        breaking: f.required,
        detail: f.required ? 'required field added' : 'optional field added',
      });
    }
    for (const r of mine(plan.declaredRenames)) {
      entries.push({ type: 'modified', category, name: r.to, breaking: true, detail: `renamed from ${r.from}, declared by renamedFrom` });
    }
    for (const t of mine(plan.typeChanges)) {
      entries.push({ type: 'modified', category, name: t.field, breaking: true, detail: `type changed: ${t.from} → ${t.to}` });
    }
    for (const s of mine(plan.suspectedRenames)) {
      entries.push({
        type: 'modified',
        category,
        name: s.field,
        breaking: true,
        detail: `suspected rename to ${s.candidates.map((c) => c.field).join(' or ')}: no renamedFrom declares it, `
          + 'so the new key installs as a new empty column',
      });
    }

    // Label / ownership changes on the object itself
    if (beforeObj.label !== afterObj.label) {
      entries.push({
        type: 'modified',
        category: 'objects',
        name,
        breaking: false,
        detail: `label changed: "${beforeObj.label ?? '(none)'}" → "${afterObj.label ?? '(none)'}"`,
      });
    }
  }

  for (const d of plan.seeds.removed) {
    entries.push({ type: 'removed', category: 'data', name: d.key, breaking: false, detail: `seed dataset removed, mode ${d.mode}` });
  }
  for (const d of plan.seeds.added) {
    entries.push({
      type: 'added',
      category: 'data',
      name: d.key,
      breaking: false,
      detail: `seed dataset added: ${d.records} record(s); mode ${d.mode}${seedModeNote(d.mode)}`,
    });
  }
  for (const d of plan.seeds.changed) {
    const mode = d.fromMode === d.mode ? d.mode : `${d.fromMode} → ${d.mode}`;
    entries.push({
      type: 'modified',
      category: 'data',
      name: d.key,
      breaking: false,
      detail: `seed dataset changed: ${d.changed.join(', ')}; mode ${mode}${seedModeNote(d.mode)}`,
    });
  }

  return entries;
}

/**
 * Every change between two folded stacks, in the order the command prints
 * them: objects with their field-level changes first, then each name-level
 * category, then seed datasets.
 */
export function diffStacks(beforeConfig: any, afterConfig: any): DiffEntry[] {
  const plan = diffObjectsAndSeeds(beforeConfig, afterConfig);
  const allDiffs: DiffEntry[] = plan.filter((entry) => entry.category !== 'data');

  // Views, Flows, Agents, Apps (name-level diff)
  const simpleCats: Array<{ key: string; label: string }> = [
    { key: 'views', label: 'views' },
    { key: 'flows', label: 'flows' },
    { key: 'agents', label: 'agents' },
    { key: 'apps', label: 'apps' },
    { key: 'dashboards', label: 'dashboards' },
    { key: 'actions', label: 'actions' },
    { key: 'workflows', label: 'workflows' },
    { key: 'apis', label: 'apis' },
    { key: 'positions', label: 'positions' },
  ];

  for (const cat of simpleCats) {
    allDiffs.push(...diffNamedArrays(beforeConfig[cat.key], afterConfig[cat.key], cat.label));
  }
  allDiffs.push(...plan.filter((entry) => entry.category === 'data'));
  return allDiffs;
}

// ─── Command ────────────────────────────────────────────────────────

export default class Diff extends Command {
  static override description = 'Compare two ObjectStack configurations and detect breaking changes';

  static override args = {
    before: Args.string({ description: 'Path to the "before" config file', required: false }),
    after: Args.string({ description: 'Path to the "after" config file', required: false }),
  };

  static override flags = {
    before: Flags.string({ description: 'Path to the "before" config (alternative)' }),
    after: Flags.string({ description: 'Path to the "after" config (alternative)' }),
    json: Flags.boolean({ description: 'Output as JSON' }),
    'breaking-only': Flags.boolean({ description: 'Show only breaking changes' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Diff);
    const timer = createTimer();

    const beforePath: string | undefined = args.before || flags.before;
    const afterPath: string | undefined = args.after || flags.after;

    // This refusal goes to STDERR, and it is the one write in this file that
    // has to (#15697).
    //
    // It sits ABOVE the first `if (!flags.json)` below, so it is reached with
    // the face still undecided and fires in BOTH — the text face and the
    // machine face alike. Measured on the published entry `bin/run.js` with
    // `NO_COLOR=1` and the streams captured separately, it used to answer
    // `os diff --json` with **exit 1, 141 bytes of prose on stdout and an empty
    // stderr**: `JSON.parse(stdout)` threw, on the one stream `--json` reserves
    // for the machine (`utils/json-stdout.ts`). Both faces measured identically,
    // because there is no branch here to tell them apart.
    //
    // ⚠️ Every other diagnostic in this file stays on stdout deliberately: they
    // sit INSIDE a `!flags.json` branch, i.e. the command has already decided it
    // is rendering its text face, which is exactly the case `printError` is for
    // (see the note on {@link printErrorToStderr}).
    //
    // ⛔ Moving the bytes is the whole change. The exit code stays 1, the
    // wording stays identical, and no payload is invented: what `--json` should
    // emit on a refusal is an open envelope question (#15549) touching this
    // command family at once, and settling it is above this fix's authority.
    if (!beforePath || !afterPath) {
      printErrorToStderr('Two config file paths are required.');
      console.error('');
      console.error(chalk.dim('  Usage: objectstack diff <before> <after>'));
      console.error(chalk.dim('     or: objectstack diff --before path1 --after path2'));
      process.exit(1);
    }

    if (!flags.json) {
      printHeader('Diff');
      printStep('Loading configurations...');
    }

    try {
      // [#22288] Each side folded before any category is read: a
      // multi-package `preserve` config carries its objects, views, flows
      // and the rest in its package bodies, none at its top level, so a diff
      // of two such configs compared two empty stacks and reported nothing.
      // A stack with no `packages[]` comes back by identity.
      const beforeConfig: any = authoringRuleUnionStack((await loadConfig(beforePath)).config);
      const afterConfig: any = authoringRuleUnionStack((await loadConfig(afterPath)).config);

      if (!flags.json) {
        printInfo(`Before: ${chalk.white(beforePath)}`);
        printInfo(`After:  ${chalk.white(afterPath)}`);
      }

      // ── Diff all categories ──
      const allDiffs = diffStacks(beforeConfig, afterConfig);

      // ── Filter ──
      const diffs = flags['breaking-only']
        ? allDiffs.filter((d) => d.breaking)
        : allDiffs;

      const breakingCount = allDiffs.filter((d) => d.breaking).length;

      // ── Output ──
      if (flags.json) {
        await emitJson({
          before: beforePath,
          after: afterPath,
          total: diffs.length,
          breaking: breakingCount,
          changes: diffs,
          duration: timer.elapsed(),
        });
        return;
      }

      console.log('');

      if (diffs.length === 0) {
        printSuccess(flags['breaking-only']
          ? 'No breaking changes detected.'
          : 'No changes detected.');
        console.log('');
        return;
      }

      // Group by category
      const grouped = new Map<string, DiffEntry[]>();
      for (const d of diffs) {
        const key = d.category;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(d);
      }

      for (const [category, items] of grouped) {
        console.log(`  ${chalk.bold(category)}`);
        for (const item of items) {
          const icon = item.type === 'added' ? '+' : item.type === 'removed' ? '-' : '~';
          const color = item.type === 'added' ? chalk.green : item.type === 'removed' ? chalk.red : chalk.yellow;
          const breakingTag = item.breaking ? chalk.bgRed.white(' BREAKING ') + ' ' : '';
          const detail = item.detail ? chalk.dim(` (${item.detail})`) : '';
          console.log(`    ${color(icon)} ${breakingTag}${color(item.name)}${detail}`);
        }
        console.log('');
      }

      // Summary
      if (breakingCount > 0) {
        printError(`${breakingCount} breaking change(s) detected`);
      } else {
        printSuccess('No breaking changes');
      }
      console.log(chalk.dim(`  ${diffs.length} total change(s) in ${timer.display()}`));
      console.log('');

    } catch (error: any) {
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
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
}
