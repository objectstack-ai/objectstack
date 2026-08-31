// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  errorCodeFields,
} from '../utils/format.js';

// ─── Types ──────────────────────────────────────────────────────────

interface DiffEntry {
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

function getFieldNames(obj: any): string[] {
  if (!obj?.fields || typeof obj.fields !== 'object') return [];
  return Object.keys(obj.fields);
}

function getFieldType(obj: any, fieldName: string): string | undefined {
  return obj?.fields?.[fieldName]?.type;
}

function isFieldRequired(obj: any, fieldName: string): boolean {
  return obj?.fields?.[fieldName]?.required === true;
}

function diffNamedArrays(
  beforeItems: any[] | undefined,
  afterItems: any[] | undefined,
  category: string,
  detectFieldChanges: boolean,
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

  // Modified items — field-level diff for objects
  if (detectFieldChanges) {
    for (const [name, beforeObj] of beforeMap) {
      const afterObj = afterMap.get(name);
      if (!afterObj) continue;

      const beforeFields = getFieldNames(beforeObj);
      const afterFields = getFieldNames(afterObj);
      const beforeSet = new Set(beforeFields);
      const afterSet = new Set(afterFields);

      // Removed fields
      for (const f of beforeFields) {
        if (!afterSet.has(f)) {
          entries.push({
            type: 'removed',
            category: `${category}.${name}.fields`,
            name: f,
            breaking: true,
            detail: 'field removed',
          });
        }
      }

      // Added fields
      for (const f of afterFields) {
        if (!beforeSet.has(f)) {
          const breaking = isFieldRequired(afterObj, f);
          entries.push({
            type: 'added',
            category: `${category}.${name}.fields`,
            name: f,
            breaking,
            detail: breaking ? 'required field added' : 'optional field added',
          });
        }
      }

      // Type changes
      for (const f of beforeFields) {
        if (!afterSet.has(f)) continue;
        const oldType = getFieldType(beforeObj, f);
        const newType = getFieldType(afterObj, f);
        if (oldType && newType && oldType !== newType) {
          entries.push({
            type: 'modified',
            category: `${category}.${name}.fields`,
            name: f,
            breaking: true,
            detail: `type changed: ${oldType} → ${newType}`,
          });
        }
      }

      // Label / ownership changes on the object itself
      if (beforeObj.label !== afterObj.label) {
        entries.push({
          type: 'modified',
          category,
          name,
          breaking: false,
          detail: `label changed: "${beforeObj.label ?? '(none)'}" → "${afterObj.label ?? '(none)'}"`,
        });
      }
    }
  }

  return entries;
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

    if (!beforePath || !afterPath) {
      printError('Two config file paths are required.');
      console.log('');
      console.log(chalk.dim('  Usage: objectstack diff <before> <after>'));
      console.log(chalk.dim('     or: objectstack diff --before path1 --after path2'));
      process.exit(1);
    }

    if (!flags.json) {
      printHeader('Diff');
      printStep('Loading configurations...');
    }

    try {
      const { config: beforeConfig } = await loadConfig(beforePath);
      const { config: afterConfig } = await loadConfig(afterPath);

      if (!flags.json) {
        printInfo(`Before: ${chalk.white(beforePath)}`);
        printInfo(`After:  ${chalk.white(afterPath)}`);
      }

      // ── Diff all categories ──
      const allDiffs: DiffEntry[] = [];

      // Objects (with field-level diff)
      allDiffs.push(...diffNamedArrays(beforeConfig.objects, afterConfig.objects, 'objects', true));

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
        allDiffs.push(
          ...diffNamedArrays(beforeConfig[cat.key], afterConfig[cat.key], cat.label, false),
        );
      }

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
      console.log('');
      printError(error.message || String(error));
      process.exit(1);
    }
  }
}
