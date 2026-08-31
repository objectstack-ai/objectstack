// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Public-surface contract (#5648): every rule id constant a rule file exports
// must be reachable from a PUBLISHED barrel entry.
//
// Why this can silently rot, and why it matters. A rule emits its id into every
// finding (`f.rule`), and that string is what `os lint --json` / `os validate`
// put in front of consumers — Studio's finding renderer, downstream filtering,
// and `suppressWarnings: ['<rule-id>']` in authored metadata. The rule files
// export a named constant for exactly that reason: a consumer should compare
// against the constant, not retype the slug. But `package.json#exports` opens
// only "." and "./runtime" (and `tsup.config.ts` builds only those two
// entries), so a constant that no barrel re-exports is not merely inconvenient
// to reach — it is UNREACHABLE. There is no deep path to fall back to, and the
// consumer's only remaining option is the string literal the constant existed
// to eliminate.
//
// Nothing failed when the barrel line was forgotten: the rule kept working, its
// own unit test imported the constant from the rule file directly (not from the
// barrel), and the omission surfaced only when someone tried to consume it from
// outside the package. #5648 was filed for one such gap
// (`FLOW_TRIGGER_UNKNOWN_EVENT`); the sweep it asked for found SIX more, spread
// over five rule files and going back well before it —
// `APPROVAL_APPROVER_TYPE_UNSUPPORTED`, `SECURITY_FLS_UNQUALIFIED_KEY`,
// `FIELD_GROUP_SHADOWED`, `WIDGET_LEGACY_ANALYTICS_SHAPE`,
// `WIDGET_LEGACY_ANALYTICS_UNRENDERABLE`, `REACT_CHART_DRILLDOWN_INVALID`. Seven
// independent omissions of the same one-line kind is not a memory problem to
// solve by remembering harder; it is a missing check. So the judgement moves
// here: adding a rule id and forgetting the barrel line now fails a test in the
// same package, in the same run the new rule's own tests go green.
//
// Two shapes of false green this is built to refuse:
//
//  1. A rule file the check never looked at. The discovery surface is a
//     filesystem read of `src/`, never a hand-maintained list of rule files, so
//     a new rule file is enumerated the moment it exists. `covers the whole
//     rule surface` additionally pins a floor on the number of ids found, so a
//     future edit that breaks the extraction pattern fails loudly instead of
//     passing over an empty set.
//  2. A barrel entry the check never imported. The two entries are named
//     statically below (a fully dynamic import cannot be bundled reliably), but
//     `barrel entries match the published exports map` proves that list is the
//     COMPLETE set of published entries by deriving it independently from
//     `package.json#exports` and from `tsup.config.ts`. Adding a third entry
//     without registering it here fails rather than going unchecked.
//
// The reverse direction (`no barrel export names a rule id that no rule file
// defines`) is deliberately weaker than it looks, and should be read as
// visibility rather than as the primary guard: a re-export of a name the source
// module no longer exports cannot survive `tsc` or the `dts` build at all. What
// this direction does catch is a name that still resolves but has drifted off
// its rule — a barrel line pointing at a different module than the definition,
// or a rule-id-shaped string exported from somewhere that no longer emits it.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as indexBarrel from './index.js';
import * as runtimeBarrel from './runtime.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(srcDir, '..');

/**
 * The published entries, keyed by the `src/<key>.ts` file each one builds from.
 * Static imports because a bundler cannot follow a fully dynamic one — kept
 * honest by `barrel entries match the published exports map`, which derives the
 * same set from `package.json` and `tsup.config.ts` and fails if this record
 * has drifted.
 */
const BARREL_ENTRIES: Record<string, Record<string, unknown>> = {
  index: indexBarrel as unknown as Record<string, unknown>,
  runtime: runtimeBarrel as unknown as Record<string, unknown>,
};

/**
 * A rule id is a lowercase slug: `flow-trigger-unknown-event`,
 * `unique/double-declaration` (namespaced), `page-source-className-tailwind`
 * (a camelCase segment where the id names an authored key).
 *
 * Shape, not emission site, decides. An earlier draft of this test classified
 * by looking for `rule: NAME` next to the definition and MISSED the four
 * `REACT_CHART_*` ids, which reach their finding through a helper argument
 * instead — including the one gap that turned out to be real. Shape is the
 * property every id has regardless of how it travels.
 *
 * What this correctly leaves out today is the one exported string const in the
 * package that is not an id: `RELATED_LIST_TYPE = 'record:related_list'`, a
 * page block type (the `:` and `_` are not id spelling). If a future non-id
 * const IS slug-shaped, prefer re-exporting it over loosening this pattern —
 * the barrel is the package's public surface, and an exported const that no
 * consumer can import is the defect this test exists to name.
 */
const RULE_ID_SHAPE = /^[a-z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*$/;

/** `export const NAME = 'value';` on one line — how every rule id is declared. */
const EXPORTED_STRING_CONST = /^export const ([A-Z][A-Z0-9_]*) = '([^']*)';\s*$/;

interface RuleId {
  name: string;
  value: string;
  file: string;
  line: number;
}

/** Every rule id constant declared anywhere under `src/`, found by reading the directory. */
function declaredRuleIds(): RuleId[] {
  const found: RuleId[] = [];
  for (const file of readdirSync(srcDir).sort()) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    readFileSync(join(srcDir, file), 'utf8').split('\n').forEach((line, i) => {
      const m = EXPORTED_STRING_CONST.exec(line);
      if (m && RULE_ID_SHAPE.test(m[2])) {
        found.push({ name: m[1], value: m[2], file, line: i + 1 });
      }
    });
  }
  return found;
}

describe('rule id constants are reachable from a published barrel (#5648)', () => {
  it('barrel entries match the published exports map', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      exports: Record<string, { import: string | { default?: string } }>;
    };
    // "." -> dist/index.js -> "index";  "./runtime" -> dist/runtime.js -> "runtime"
    //
    // [#13112] A condition's value is EITHER the target path itself, or a
    // nested conditions object carrying it under `default` (the per-condition
    // `types` shape). Both spellings ship in this repo — packages held at the
    // sibling-`types` shape keep the flat one — so read through the nesting
    // rather than assuming either. ⛔ Reading `e.import` blind stringifies an
    // object to "[object Object]", which matches nothing and silently empties
    // this census instead of failing loudly.
    const importTarget = (e: { import: string | { default?: string } }): string =>
      typeof e.import === 'string' ? e.import : e.import?.default ?? '';
    const published = Object.values(pkg.exports)
      .map((e) => /^\.\/dist\/(.+)\.js$/.exec(importTarget(e))?.[1])
      .filter((n): n is string => !!n)
      .sort();
    expect(published.length).toBe(Object.keys(pkg.exports).length);

    // tsup builds the entries; an entry published but not built (or the
    // reverse) would make this test judge reachability against a file that
    // never ships.
    const tsup = readFileSync(join(pkgDir, 'tsup.config.ts'), 'utf8');
    const entryBlock = /entry:\s*\[([^\]]*)\]/.exec(tsup)?.[1] ?? '';
    const built = [...entryBlock.matchAll(/'src\/(.+?)\.ts'/g)].map((m) => m[1]).sort();

    expect(built).toEqual(published);
    expect(Object.keys(BARREL_ENTRIES).sort()).toEqual(published);
  });

  it('covers the whole rule surface', () => {
    const ids = declaredRuleIds();
    // A floor, not an exact count — new rules are expected. Its only job is to
    // fail if the extraction above ever stops finding anything, which would
    // make every assertion below vacuously true.
    expect(ids.length).toBeGreaterThan(100);
    expect(new Set(ids.map((r) => r.file)).size).toBeGreaterThan(30);

    // One id, one name. Two files exporting the same name could only ever have
    // one of them re-exported, and the barrel would silently answer for the
    // wrong rule.
    const byName = new Map<string, RuleId[]>();
    for (const id of ids) byName.set(id.name, [...(byName.get(id.name) ?? []), id]);
    expect([...byName].filter(([, v]) => v.length > 1).map(([n]) => n)).toEqual([]);
  });

  it('every declared rule id constant is exported from a barrel, with its own value', () => {
    const unreachable: string[] = [];
    const mismatched: string[] = [];

    for (const id of declaredRuleIds()) {
      const carrying = Object.entries(BARREL_ENTRIES).filter(([, ns]) => id.name in ns);
      if (carrying.length === 0) {
        unreachable.push(`${id.name} ('${id.value}') — ${id.file}:${id.line}`);
        continue;
      }
      // Reachable by name is not enough: the name must carry THIS definition's
      // value, or the barrel is answering for a different constant.
      for (const [entry, ns] of carrying) {
        if (ns[id.name] !== id.value) {
          mismatched.push(
            `${id.name} — ${id.file}:${id.line} declares '${id.value}', ` +
              `barrel '${entry}' exports '${String(ns[id.name])}'`,
          );
        }
      }
    }

    // `package.json#exports` opens only these entries, so an id missing from
    // both has NO import path at all — add it to the rule module's existing
    // `export { … } from './<rule-file>.js'` block in `src/index.ts`.
    expect({ unreachable, mismatched }).toEqual({ unreachable: [], mismatched: [] });
  });

  it('no barrel export names a rule id that no rule file defines', () => {
    const declared = new Map(declaredRuleIds().map((r) => [r.name, r.value]));
    const orphaned: string[] = [];

    for (const [entry, ns] of Object.entries(BARREL_ENTRIES)) {
      for (const [name, value] of Object.entries(ns)) {
        if (typeof value !== 'string' || !RULE_ID_SHAPE.test(value)) continue;
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
        if (declared.get(name) !== value) {
          orphaned.push(`${entry}: ${name} = '${value}'`);
        }
      }
    }

    expect(orphaned).toEqual([]);
  });
});
