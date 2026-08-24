#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `llms.txt` FRESHNESS gate — the hand-kept protocol summary we SHIP to AI
 * consumers may not advertise a symbol, a subpath, a package or a count that
 * this package does not actually have (#11344).
 *
 *   pnpm --filter @objectstack/spec check:llms-txt
 *   pnpm --filter @objectstack/spec check:llms-txt --self-test
 *
 * ## WHY THIS EXISTS
 *
 * `packages/spec/llms.txt` ships inside the published `@objectstack/spec`
 * tarball (`files` array; asserted by `scripts/check-published-files.mjs`,
 * whose EXTRA_ENTRIES records it as "Protocol summary for LLM consumers"). It
 * describes itself as context for AI agents — the audience least able to
 * notice staleness, and the audience most likely to turn a claim into code. An
 * agent that reads "`FormSchema`: layout" writes
 * `import { FormSchema } from '@objectstack/spec/ui'`, which does not resolve.
 * The file is not a doc that merely misinforms; it is an input that produces
 * broken code.
 *
 * It has NO generator — none of this package's ~20 `gen:*` scripts emits it —
 * so every claim in it is hand-typed and nothing re-derived any of them. The
 * measured cost of that, when #11344 counted:
 *
 *   - **eleven** advertised symbols existed nowhere in the published export
 *     surface (`IUIService`, `ThemeSchema`, `IdentitySchema`, `PolicySchema`,
 *     `ContractSchema`, `EndpointSchema`, `RAGPipelineSchema`, `MCPSchema`,
 *     `FilterSchema`, `AnalyticsSchema`, `FormSchema`);
 *   - **two** advertised packages did not exist (`@objectstack/nextjs`,
 *     `@objectstack/nestjs`);
 *   - the schema-inventory table disagreed with the tree in twelve of thirteen
 *     rows, omitted a domain entirely, and its heading (171) did not even match
 *     the sum of its own rows (170);
 *   - the package-ecosystem heading claimed 19 against a real 68.
 *
 * The `IUIService` row is the one that shows why a gate rather than another
 * hand-audit: that contract was REMOVED in v11 ("Remove the deprecated
 * `IUIService` contract (use `IMetadataService`)" — this package's own
 * CHANGELOG), and the row outlived it by two majors. Worse, the immediately
 * preceding repair of this same file — which deleted a phantom
 * `IGraphQLService` row — cited the `IUIService` row beside it as a live
 * PRECEDENT, never noticing it was itself dead. A hand-audit standing next to
 * the defect did not see it. That is the whole argument for re-deriving.
 *
 * ## WHAT IT CHECKS — five invariants
 *
 *   SUBPATH   every `@objectstack/spec/<x>` the file names as an import target
 *             is a real `exports` key of this package's manifest.
 *   NAMED     every symbol the file advertises in a STRUCTURED CLAIM POSITION
 *             resolves against the checked-in `api-surface/` shards. Three
 *             positions, and they are resolved with deliberately different
 *             strictness — see below.
 *   COUNTED   every declared count is re-derived: the schema-inventory heading
 *             against the sum of its own table AND against the real per-domain
 *             `src/<domain>/**\/*.zod.ts` population; the package-ecosystem
 *             heading against the real non-private `@objectstack/*` workspace
 *             set.
 *   LISTED    every row of the package table names a real published package,
 *             and the schema-inventory table has exactly one row per schema
 *             domain — no domain silently dropped, none invented.
 *   STRUCTURE every section this gate reads is present and parses. A file the
 *             parser stops recognising FAILS; it never passes with zero
 *             comparisons.
 *
 * ## WHY `api-surface/` IS THE AUTHORITY FOR NAMES
 *
 * It is checked in, it is sharded one file per published entry point, and
 * `check:api-surface` already keeps it equal to the built `dist/*.d.ts`. So
 * this gate needs no build of its own and cannot disagree with the export
 * surface a consumer's import actually resolves to. It also ships in the same
 * tarball as `llms.txt`, which means a consumer can verify any claim this gate
 * makes without leaving the package.
 *
 * Reading `src/` instead would be the wrong authority twice over: a name can be
 * declared in `src/` and never re-exported from an entry point (so the import
 * still fails), and a name can be exported from a barrel with no matching
 * `export const <name>` line anywhere (`DriverInterfaceSchema` is exactly this
 * — a `src/` grep reports it absent and it is perfectly importable).
 *
 * ## THE THREE CLAIM POSITIONS, AND WHY THEY ARE NOT EQUALLY STRICT
 *
 *   1. **Layer bullets** (`### Layer N: ... (\`@objectstack/spec/x\`)` followed
 *      by `- **\`Name\`**: ...`) resolve against the union of ALL entry points.
 *      That section is an ARCHITECTURE overview: it groups concepts into
 *      layers, and a concept legitimately lives in a neighbouring entry point
 *      (`IDataDriver` is described under the data layer and exported from
 *      `./contracts`, exactly as this file's own §5 example imports it).
 *      Demanding entry-point agreement here would manufacture failures for
 *      claims that are true.
 *   2. **Namespace bullets** (`### \`import * as N from '@objectstack/spec/x'\``
 *      followed by `- \`A\`, \`B\`: ...`) resolve against THAT entry point
 *      only. The heading is literally an import statement, so the entry point
 *      is part of the claim: a name that resolves from a different subpath does
 *      not make this bullet true, it makes it a broken copy-paste.
 *   3. **Contract table rows** (the section whose heading names
 *      `\`@objectstack/spec/contracts\``) resolve against `./contracts` only,
 *      for the same reason. This is the position `IGraphQLService` and
 *      `IUIService` occupied.
 *
 * Fenced `import ... from '@objectstack/spec/<x>'` statements are read too, at
 * strictness 2 — an import in a code block is the most directly copy-pasteable
 * claim in the file, and it carries its own entry point.
 *
 * ## WHAT IS DELIBERATELY OUT OF POPULATION
 *
 *   - **Prose and narrative.** Layer descriptions, coding-pattern text, the
 *     upgrade advice in the final section. Nothing in them is falsifiable
 *     against the tree, and a gate that pretended otherwise would be asserting
 *     taste.
 *   - **Code-fence BODIES.** Only the `import` specifiers are read. Deciding
 *     which other identifiers in a snippet are protocol symbols rather than
 *     locals, fields or illustrative pseudo-code is a judgement this gate would
 *     have to invent, and inventing it is how a checker starts producing
 *     confident wrong answers.
 *   - **`N+` lower-bound figures** — `46+ types`, `7,095+ total` describes,
 *     `1,470+ JSON Schemas`. These are checkable in the weak sense (real >=
 *     claimed) and that is precisely the problem: such a check goes red only
 *     when the protocol SHRINKS, so it would sit green while the figure drifts
 *     arbitrarily far out of date — the shape `check-quick-reference-counts`
 *     names when it refuses a comparison that can never fail ("a check that can
 *     never go red reads as coverage and is not"). Making them honest means
 *     deciding whether an AI-facing summary should carry an exact,
 *     every-PR-churning number or no number at all. That is a CONTENT decision
 *     for the maintainer, not a thing for this gate to settle by picking a
 *     comparison operator. They are skipped, not excused; #11344's report
 *     carries the open question.
 *
 * ## WHY THERE IS NO `gen:llms-txt`
 *
 * Asked and declined at triage (#11344, verbatim: "a full generator only if it
 * falls out of existing `gen:*` vocabulary cheaply. Do not invent a new
 * generation pipeline for this card"). The classification is also the safety
 * property, exactly as with `check:objectui-pin-citations`: the automation a
 * reader reaches for — rewrite each stale number and drop each dead symbol —
 * is the operation that must NOT be offered. The numbers are not the claim; the
 * PROSE BESIDE THEM is. A row reading `| integration | 7 | Connector (Database,
 * File Storage, GitHub, MQ, SaaS, Vercel) |` is wrong in both cells when the
 * domain has one schema, and a generator that rewrote `7` to `1` would leave a
 * confident, freshly-stamped sentence listing six connectors that are not
 * there. That converts a loud "this is stale" into a silent lie, which is
 * strictly worse than the rot. Every failure here is a re-read of the section,
 * never a command.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const PKG = resolve(HERE, '..');
const ROOT = resolve(PKG, '..', '..');
const TARGET = 'packages/spec/llms.txt';
const SELF = 'packages/spec/scripts/check-llms-txt.ts';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** A domain directory with no `*.zod.ts` under it is not a schema domain. */
const ZOD_SUFFIX = '.zod.ts';

export type Finding = {
  kind: 'subpath' | 'named' | 'count' | 'listed' | 'structure';
  line: number;
  message: string;
};

/**
 * Everything the gate compares the file against. Injected rather than read
 * inside `checkFile` so the self-test can pin behaviour against a known tree
 * instead of against whatever this repo happens to hold today.
 */
export type Catalog = {
  /** `./data` -> every exported name of that entry point. */
  entryExports: Record<string, Set<string>>;
  /** Declared `exports` keys of packages/spec/package.json, as `./x`. */
  subpaths: Set<string>;
  /** `data` -> how many `*.zod.ts` live under `src/data/`, recursively. */
  domainZodCounts: Record<string, number>;
  /** Every non-private `@objectstack/*` workspace package name. */
  workspacePackages: Set<string>;
};

/** Every name exported from any entry point — the layer-bullet population. */
function allExportedNames(catalog: Catalog): Set<string> {
  const all = new Set<string>();
  for (const names of Object.values(catalog.entryExports)) for (const n of names) all.add(n);
  return all;
}

/** Split a markdown table line into trimmed cells (an escaped `\|` is not a separator). */
function splitCells(line: string): string[] {
  const parts = line.split(/(?<!\\)\|/);
  parts.shift();
  if (parts.length && parts[parts.length - 1]!.trim() === '') parts.pop();
  return parts.map((c) => c.trim());
}

/** The single backticked token of a cell, or null when it carries none. */
function backticked(cell: string): string | null {
  const m = /`([^`]+)`/.exec(cell);
  return m ? m[1]!.trim() : null;
}

/**
 * The part of a bullet BEFORE its first `:` that is outside backticks — the
 * claim, as opposed to the description. Backtick-awareness is load-bearing:
 * `- \`ViewSchema\`: \`type: 'grid'\`` has a colon inside the description's own
 * backticks, and a naive split would swallow the whole line.
 */
function claimSegment(bullet: string): string {
  let inTick = false;
  for (let i = 0; i < bullet.length; i++) {
    const ch = bullet[i];
    if (ch === '`') inTick = !inTick;
    else if (ch === ':' && !inTick) return bullet.slice(0, i);
  }
  return bullet;
}

/** Backticked identifiers in a claim segment (`**\`A\`**`, `` `A`, `B` ``). */
function claimedIdentifiers(segment: string): string[] {
  const out: string[] = [];
  for (const m of segment.matchAll(/`([^`]+)`/g)) {
    const tok = m[1]!.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) out.push(tok);
  }
  return out;
}

/** `@objectstack/spec/data` -> `./data`, for a WHOLE token only. */
function toSubpath(token: string): string | null {
  const m = /^@objectstack\/spec\/([a-z][a-z0-9-]*)$/.exec(token);
  return m ? `./${m[1]}` : null;
}

type Section = { heading: string; line: number; body: string[]; bodyStart: number };

/** Split the file into `##` sections. Text before the first `##` is dropped. */
function sections(lines: string[]): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  lines.forEach((raw, i) => {
    if (/^##\s+/.test(raw) && !/^###/.test(raw)) {
      cur = { heading: raw.replace(/^##\s+/, '').trim(), line: i + 1, body: [], bodyStart: i + 2 };
      out.push(cur);
    } else if (cur) cur.body.push(raw);
  });
  return out;
}

/**
 * The first markdown table in a body, as rows of cells plus the absolute line
 * of each row. A table is recognised by its alignment divider, so a stray
 * pipe in prose cannot be mistaken for one.
 */
function firstTable(
  body: string[],
  bodyStart: number,
): { rows: { cells: string[]; line: number }[]; count: number } {
  const tables: { cells: string[]; line: number }[][] = [];
  let cur: { cells: string[]; line: number }[] | null = null;
  let sawDivider = false;
  body.forEach((raw, i) => {
    const line = bodyStart + i;
    if (/^\|/.test(raw)) {
      if (/^\|[\s:|-]+\|\s*$/.test(raw)) {
        sawDivider = true;
        return;
      }
      if (!sawDivider) return;
      if (!cur) {
        cur = [];
        tables.push(cur);
      }
      cur.push({ cells: splitCells(raw), line });
    } else if (raw.trim() === '' ? false : true) {
      cur = null;
      sawDivider = false;
    } else if (raw.trim() === '') {
      cur = null;
      sawDivider = false;
    }
  });
  return { rows: tables[0] ?? [], count: tables.length };
}

/**
 * The whole verdict for one file text against one catalog. Pure: no I/O, so the
 * self-test drives it directly.
 */
export function checkFile(text: string, catalog: Catalog): { findings: Finding[]; checked: number } {
  const lines = text.split(/\r?\n/);
  const findings: Finding[] = [];
  const add = (kind: Finding['kind'], line: number, message: string) =>
    findings.push({ kind, line, message });
  const everywhere = allExportedNames(catalog);
  let checked = 0;

  // ---- SUBPATH -----------------------------------------------------------
  // A subpath claim is a WHOLE backticked `@objectstack/spec/<x>` token or a
  // fenced import specifier. The whole-token rule is what keeps
  // `node_modules/@objectstack/spec/CHANGELOG.md` — a real file path, not an
  // import target — out of the population.
  const namedSubpaths: { sub: string; line: number }[] = [];
  lines.forEach((raw, i) => {
    for (const m of raw.matchAll(/`([^`]+)`/g)) {
      const sub = toSubpath(m[1]!.trim());
      if (sub) namedSubpaths.push({ sub, line: i + 1 });
    }
    for (const m of raw.matchAll(/from\s+'(@objectstack\/spec[^']*)'/g)) {
      const sub = toSubpath(m[1]!);
      if (sub) namedSubpaths.push({ sub, line: i + 1 });
    }
  });
  for (const { sub, line } of namedSubpaths) {
    checked++;
    if (!catalog.subpaths.has(sub))
      add(
        'subpath',
        line,
        `names \`@objectstack/spec/${sub.slice(2)}\`, which is not an \`exports\` key of packages/spec/package.json`,
      );
  }

  // ---- NAMED: fenced imports (entry-point strict) ------------------------
  lines.forEach((raw, i) => {
    const m = /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s*from\s+'(@objectstack\/spec[^']*)'/.exec(raw);
    if (!m) return;
    const sub = toSubpath(m[2]!);
    if (!sub || !catalog.entryExports[sub]) return;
    for (const rawName of m[1]!.split(',')) {
      const name = rawName.trim().split(/\s+as\s+/)[0]!.trim();
      if (!name) continue;
      checked++;
      if (!catalog.entryExports[sub]!.has(name))
        add(
          'named',
          i + 1,
          `example imports \`${name}\` from \`@objectstack/spec/${sub.slice(2)}\`, which does not export it` +
            (everywhere.has(name) ? ' (it is exported from another entry point)' : ' (it exists nowhere)'),
        );
    }
  });

  // ---- NAMED: layer bullets (union-of-entry-points) ----------------------
  // and NAMED: namespace bullets (entry-point strict).
  let layerBlocks = 0;
  let namespaceBlocks = 0;
  {
    type Mode = { kind: 'layer' } | { kind: 'namespace'; sub: string; raw: string } | null;
    let mode: Mode = null;
    lines.forEach((raw, i) => {
      if (/^##\s/.test(raw) && !/^###/.test(raw)) mode = null;
      const h3 = /^###\s+(.*)$/.exec(raw);
      if (h3) {
        const head = h3[1]!;
        const asImport = /`import\s+\*\s+as\s+\w+\s+from\s+'(@objectstack\/spec[^']*)'`/.exec(head);
        if (asImport) {
          const sub = toSubpath(asImport[1]!);
          mode = sub ? { kind: 'namespace', sub, raw: asImport[1]! } : null;
          if (mode) namespaceBlocks++;
          return;
        }
        if (/^Layer\s+\d+\s*:/.test(head)) {
          mode = { kind: 'layer' };
          layerBlocks++;
          return;
        }
        mode = null;
        return;
      }
      if (!mode || !/^\s*-\s+/.test(raw)) return;
      const ids = claimedIdentifiers(claimSegment(raw.replace(/^\s*-\s+/, '')));
      for (const id of ids) {
        // Only names shaped like a protocol symbol are claims; `camelCase`
        // prose tokens in a bullet are not.
        if (!/^[A-Z]/.test(id)) continue;
        checked++;
        if (mode.kind === 'layer') {
          if (!everywhere.has(id))
            add('named', i + 1, `layer bullet advertises \`${id}\`, which no entry point exports`);
        } else {
          const set = catalog.entryExports[mode.sub];
          if (!set) {
            add('named', i + 1, `namespace block names unknown entry point \`${mode.raw}\``);
          } else if (!set.has(id)) {
            add(
              'named',
              i + 1,
              `\`${id}\` is listed under \`${mode.raw}\`, which does not export it` +
                (everywhere.has(id) ? ' (it is exported from another entry point)' : ' (it exists nowhere)'),
            );
          }
        }
      }
    });
  }

  const secs = sections(lines);

  // ---- Contract table ----------------------------------------------------
  const contractSecs = secs.filter((s) => /`@objectstack\/spec\/contracts`/.test(s.heading));
  if (contractSecs.length !== 1) {
    add(
      'structure',
      contractSecs[0]?.line ?? 1,
      `expected exactly one section whose heading names \`@objectstack/spec/contracts\`, found ${contractSecs.length}`,
    );
  } else {
    const sec = contractSecs[0]!;
    const { rows, count } = firstTable(sec.body, sec.bodyStart);
    if (count !== 1)
      add('structure', sec.line, `"${sec.heading}" has ${count} tables under it; expected exactly 1`);
    else if (rows.length === 0)
      add('structure', sec.line, `"${sec.heading}" has a table with no rows`);
    for (const row of rows) {
      const name = backticked(row.cells[0] ?? '');
      if (!name) {
        add('structure', row.line, `contract row has no backticked contract name in its first cell`);
        continue;
      }
      checked++;
      const set = catalog.entryExports['./contracts'];
      if (set && !set.has(name))
        add(
          'named',
          row.line,
          `service-contract table advertises \`${name}\`, which \`@objectstack/spec/contracts\` does not export` +
            (everywhere.has(name) ? ' (it is exported from another entry point)' : ' (it exists nowhere)'),
        );
    }
  }

  // ---- COUNTED / LISTED: schema inventory --------------------------------
  const COUNT_SCHEMAS = /\((\d[\d,]*)\s+schemas?\)/;
  const invSecs = secs.filter((s) => COUNT_SCHEMAS.test(s.heading));
  const invNamed = secs.filter((s) => /schema inventory/i.test(s.heading));
  for (const s of invNamed)
    if (!COUNT_SCHEMAS.test(s.heading))
      add('structure', s.line, `"${s.heading}" declares no "(N schemas)" count`);
  if (invSecs.length !== 1) {
    add(
      'structure',
      invSecs[0]?.line ?? 1,
      `expected exactly one "(N schemas)" section heading, found ${invSecs.length}`,
    );
  } else {
    const sec = invSecs[0]!;
    const declared = Number(COUNT_SCHEMAS.exec(sec.heading)![1]!.replace(/,/g, ''));
    const { rows, count } = firstTable(sec.body, sec.bodyStart);
    if (count !== 1) {
      add('structure', sec.line, `"${sec.heading}" has ${count} tables under it; expected exactly 1`);
    } else if (rows.length === 0) {
      add('structure', sec.line, `"${sec.heading}" has a table with no rows`);
    } else {
      let sum = 0;
      const seen = new Set<string>();
      for (const row of rows) {
        const domain = (backticked(row.cells[0] ?? '') ?? (row.cells[0] ?? '')).replace(/[*`]/g, '').trim();
        const nRaw = (row.cells[1] ?? '').replace(/[,`*]/g, '').trim();
        if (!/^\d+$/.test(nRaw)) {
          add('structure', row.line, `domain row \`${domain}\` has no numeric count in its second cell`);
          continue;
        }
        const n = Number(nRaw);
        sum += n;
        seen.add(domain);
        const real = catalog.domainZodCounts[domain];
        checked++;
        if (real === undefined)
          add(
            'listed',
            row.line,
            `domain row \`${domain}\` names no schema domain — packages/spec/src/${domain}/ holds no ${ZOD_SUFFIX} file`,
          );
        else if (real !== n)
          add('count', row.line, `domain \`${domain}\` declares ${n} schemas; src/${domain}/ holds ${real}`);
      }
      for (const domain of Object.keys(catalog.domainZodCounts).sort())
        if (!seen.has(domain))
          add(
            'listed',
            sec.line,
            `domain \`${domain}\` has ${catalog.domainZodCounts[domain]} schemas in src/${domain}/ but no row in the inventory table`,
          );
      const realTotal = Object.values(catalog.domainZodCounts).reduce((a, b) => a + b, 0);
      checked++;
      if (declared !== sum)
        add(
          'count',
          sec.line,
          `heading declares ${declared} schemas but its own table sums to ${sum}`,
        );
      if (declared !== realTotal)
        add(
          'count',
          sec.line,
          `heading declares ${declared} schemas; packages/spec/src/ holds ${realTotal}`,
        );
    }
  }

  // ---- COUNTED / LISTED: package ecosystem -------------------------------
  const COUNT_PACKAGES = /\((\d[\d,]*)\s+packages?\)/;
  const pkgSecs = secs.filter((s) => COUNT_PACKAGES.test(s.heading));
  const pkgNamed = secs.filter((s) => /package ecosystem/i.test(s.heading));
  for (const s of pkgNamed)
    if (!COUNT_PACKAGES.test(s.heading))
      add('structure', s.line, `"${s.heading}" declares no "(N packages)" count`);
  if (pkgSecs.length !== 1) {
    add(
      'structure',
      pkgSecs[0]?.line ?? 1,
      `expected exactly one "(N packages)" section heading, found ${pkgSecs.length}`,
    );
  } else {
    const sec = pkgSecs[0]!;
    const declared = Number(COUNT_PACKAGES.exec(sec.heading)![1]!.replace(/,/g, ''));
    const { rows, count } = firstTable(sec.body, sec.bodyStart);
    if (count !== 1) {
      add('structure', sec.line, `"${sec.heading}" has ${count} tables under it; expected exactly 1`);
    } else if (rows.length === 0) {
      add('structure', sec.line, `"${sec.heading}" has a table with no rows`);
    } else {
      for (const row of rows) {
        const name = backticked(row.cells[0] ?? '');
        if (!name) {
          add('structure', row.line, `package row has no backticked package name in its first cell`);
          continue;
        }
        checked++;
        if (!catalog.workspacePackages.has(name))
          add('listed', row.line, `package table advertises \`${name}\`, which this workspace does not publish`);
      }
      checked++;
      if (declared !== catalog.workspacePackages.size)
        add(
          'count',
          sec.line,
          `heading declares ${declared} packages; the workspace publishes ${catalog.workspacePackages.size}`,
        );
    }
  }

  // ---- STRUCTURE: the parser must still recognise the file ---------------
  if (layerBlocks === 0)
    add('structure', 1, 'no "### Layer N: ..." blocks found at all — the architecture overview is unreadable to this gate');
  if (namespaceBlocks === 0)
    add(
      'structure',
      1,
      'no "### `import * as N from \'@objectstack/spec/x\'`" blocks found at all — the namespace exports section is unreadable to this gate',
    );

  return { findings, checked };
}

// ---------------------------------------------------------------------------
// Catalog construction (I/O)
// ---------------------------------------------------------------------------

function countZodFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) n += countZodFiles(p);
    else if (entry.name.endsWith(ZOD_SUFFIX)) n++;
  }
  return n;
}

function readDomainZodCounts(): Record<string, number> {
  const src = join(PKG, 'src');
  if (!existsSync(src)) {
    console.error(`\n✗ ${SELF}: packages/spec/src/ not found.\n`);
    console.error(
      'The schema-inventory table is measured against that tree. Passing without\n' +
        'it would put this gate exactly where #11344 found the file: green by vacancy.\n',
    );
    process.exit(1);
  }
  const out: Record<string, number> = {};
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const n = countZodFiles(join(src, entry.name));
    if (n > 0) out[entry.name] = n;
  }
  return out;
}

function readApiSurface(): { entryExports: Record<string, Set<string>> } {
  const dir = join(PKG, 'api-surface');
  if (!existsSync(dir)) {
    console.error(`\n✗ ${SELF}: packages/spec/api-surface/ not found.\n`);
    console.error(
      'Every symbol claim is resolved against those shards. Without them there is\n' +
        'nothing to compare, and a silent pass would re-open the #11344 defect class.\n' +
        'Regenerate with `pnpm --filter @objectstack/spec gen:api-surface` after a build.\n',
    );
    process.exit(1);
  }
  const entryExports: Record<string, Set<string>> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const shard = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      entry: string;
      exports: string[];
    };
    entryExports[shard.entry] = new Set(shard.exports.map((e) => e.replace(/\s*\(.*$/, '').trim()));
  }
  if (Object.keys(entryExports).length === 0) {
    console.error(`\n✗ ${SELF}: packages/spec/api-surface/ holds no shards.\n`);
    process.exit(1);
  }
  return { entryExports };
}

/**
 * The `packages:` globs of pnpm-workspace.yaml, restricted to `<dir>` and
 * `<dir>/*` exactly as `scripts/check-published-files.mjs` restricts them. A
 * richer pattern is refused rather than approximated: silently matching fewer
 * packages would shrink the denominator of the package count and make a stale
 * heading look correct.
 */
function readWorkspacePackages(): Set<string> {
  const file = join(ROOT, WORKSPACE_FILE);
  if (!existsSync(file)) {
    console.error(`\n✗ ${SELF}: ${WORKSPACE_FILE} not found at the repo root.\n`);
    process.exit(1);
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) {
    console.error(`\n✗ ${SELF}: ${WORKSPACE_FILE} has no top-level \`packages:\` block.\n`);
    process.exit(1);
  }
  const globs: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\S/.test(l)) break;
    const m = /^\s+-\s+'?"?([^'"#]+?)"?'?\s*$/.exec(l);
    if (m) globs.push(m[1]!.trim());
  }
  if (globs.length === 0) {
    console.error(`\n✗ ${SELF}: ${WORKSPACE_FILE} \`packages:\` block is empty.\n`);
    process.exit(1);
  }
  const dirs: string[] = [];
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const base = join(ROOT, glob.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const e of readdirSync(base, { withFileTypes: true }))
        if (e.isDirectory()) dirs.push(join(base, e.name));
    } else if (!glob.includes('*')) {
      dirs.push(join(ROOT, glob));
    } else {
      console.error(
        `\n✗ ${SELF}: ${WORKSPACE_FILE} pattern "${glob}" is richer than <dir> or <dir>/*; extend ${SELF}.\n`,
      );
      process.exit(1);
    }
  }
  const names = new Set<string>();
  for (const dir of dirs) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest) || !statSync(dir).isDirectory()) continue;
    try {
      const j = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; private?: boolean };
      if (j.name && j.name.startsWith('@objectstack/') && !j.private) names.add(j.name);
    } catch {
      // A manifest that does not parse is another gate's problem, not this one's.
    }
  }
  return names;
}

function readSubpaths(): Set<string> {
  const j = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>;
  };
  return new Set(Object.keys(j.exports ?? {}));
}

function buildCatalog(): Catalog {
  return {
    ...readApiSurface(),
    subpaths: readSubpaths(),
    domainZodCounts: readDomainZodCounts(),
    workspacePackages: readWorkspacePackages(),
  };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const GOOD_PAGE = [
  '# @objectstack/spec Context for AI Agents',
  '',
  '## 1. Architecture Overview',
  '',
  '### Layer 1: ObjectQL (`@objectstack/spec/data`)',
  '- **`ObjectSchema`**: Defines database tables.',
  '- **`IDataDriver`**: The authoritative contract for database adapters.',
  '',
  '## 2. Coding Patterns',
  '',
  '```typescript',
  "import { ObjectSchema } from '@objectstack/spec/data';",
  '```',
  '',
  '## 3. Schema Inventory by Domain (5 schemas)',
  '',
  '| Domain | Count | Key Schemas |',
  '|--------|-------|-------------|',
  '| data | 3 | Object, Query |',
  '| ui | 2 | View |',
  '',
  '## 4. Key Exports by Namespace',
  '',
  "### `import * as Data from '@objectstack/spec/data'`",
  '- `ObjectSchema`, `QuerySchema`: Data definition.',
  '',
  '## 6. Service Contracts (`@objectstack/spec/contracts`)',
  '',
  '| Contract | Methods |',
  '|----------|---------|',
  '| `IMetadataService` | register, get |',
  '',
  '## 7. Package Ecosystem (2 packages)',
  '',
  '| Package | Description |',
  '|---------|-------------|',
  '| `@objectstack/spec` | Protocol schemas |',
  '| `@objectstack/core` | Runtime core |',
  '',
  '## 9. Upgrading',
  '',
  '`CHANGELOG.md` ships inside this package (`node_modules/@objectstack/spec/CHANGELOG.md`).',
  '',
].join('\n');

const GOOD_CATALOG: Catalog = {
  entryExports: {
    './data': new Set(['ObjectSchema', 'QuerySchema', 'DatasourceSchema']),
    './ui': new Set(['ViewSchema']),
    './contracts': new Set(['IMetadataService', 'IDataDriver']),
  },
  subpaths: new Set(['.', './data', './ui', './contracts']),
  domainZodCounts: { data: 3, ui: 2 },
  workspacePackages: new Set(['@objectstack/spec', '@objectstack/core']),
};

function selfTest(): void {
  const failures: string[] = [];
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (actual !== expected)
      failures.push(`  ${label}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`);
  };
  const has = (findings: Finding[], re: RegExp) => findings.some((f) => re.test(f.message));

  // 1. NEGATIVE — the known-good page is clean, and it really did compare
  //    things. Asserting a measured `checked` rather than only "no findings"
  //    is what stops a parser that silently matches nothing from passing.
  {
    const { findings, checked } = checkFile(GOOD_PAGE, GOOD_CATALOG);
    expect('good page has no findings', findings.map((f) => f.message).join(' | '), '');
    expect('good page actually compared claims', checked > 10, true);
  }

  // 2. POSITIVE — the #11344 / #10833 defect: a contract row naming something
  //    that exists nowhere.
  {
    const bad = GOOD_PAGE.replace('| `IMetadataService` | register, get |', '| `IUIService` | anything |');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('phantom contract is reported', has(findings, /advertises `IUIService`.*does not export \(it exists nowhere\)/), true);
    expect('phantom contract is a named finding', findings[0]?.kind, 'named');
  }

  // 3. POSITIVE — a contract row naming a real export of a DIFFERENT entry
  //    point is still wrong here, and the message says which case it is.
  {
    const bad = GOOD_PAGE.replace('| `IMetadataService` | register, get |', '| `ObjectSchema` | x |');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('cross-entry contract row is reported', has(findings, /`ObjectSchema`.*\(it is exported from another entry point\)/), true);
  }

  // 4. POSITIVE — a namespace bullet is entry-point strict: a name that
  //    resolves only from elsewhere is a broken copy-paste.
  {
    const bad = GOOD_PAGE.replace('- `ObjectSchema`, `QuerySchema`: Data definition.', '- `ObjectSchema`, `ViewSchema`: Data definition.');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('wrong-namespace bullet is reported', has(findings, /`ViewSchema` is listed under `@objectstack\/spec\/data`.*another entry point/), true);
  }

  // 5. POSITIVE — a namespace bullet naming a phantom.
  {
    const bad = GOOD_PAGE.replace('- `ObjectSchema`, `QuerySchema`: Data definition.', '- `ObjectSchema`, `FilterSchema`: Data definition.');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('phantom namespace bullet is reported', has(findings, /`FilterSchema` is listed under.*\(it exists nowhere\)/), true);
  }

  // 6. NEGATIVE — a LAYER bullet resolves against the union, so `IDataDriver`
  //    under the data layer is correct. This pins the deliberate asymmetry
  //    between positions 1 and 2; without it, tightening the layer rule would
  //    look like a harmless cleanup.
  {
    const { findings } = checkFile(GOOD_PAGE, GOOD_CATALOG);
    expect('layer bullet may name a neighbouring entry point', has(findings, /IDataDriver/), false);
  }

  // 7. POSITIVE — but a layer bullet naming something exported NOWHERE is
  //    still a finding.
  {
    const bad = GOOD_PAGE.replace('- **`IDataDriver`**: The authoritative', '- **`ThemeSchema`**: The authoritative');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('phantom layer bullet is reported', has(findings, /layer bullet advertises `ThemeSchema`, which no entry point exports/), true);
  }

  // 8. POSITIVE — a fenced import is the most copy-pasteable claim in the
  //    file and is checked at entry-point strictness.
  {
    const bad = GOOD_PAGE.replace("import { ObjectSchema } from '@objectstack/spec/data';", "import { ThemeSchema } from '@objectstack/spec/data';");
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('bad fenced import is reported', has(findings, /example imports `ThemeSchema`.*exists nowhere/), true);
  }

  // 9. POSITIVE — an undeclared subpath.
  {
    const bad = GOOD_PAGE.replace('### Layer 1: ObjectQL (`@objectstack/spec/data`)', '### Layer 1: ObjectQL (`@objectstack/spec/graphql`)');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('unknown subpath is reported', has(findings, /`@objectstack\/spec\/graphql`, which is not an `exports` key/), true);
  }

  // 10. NEGATIVE — a package-internal FILE PATH is not a subpath claim. The
  //     whole-token rule is what keeps §9's `node_modules/...CHANGELOG.md`
  //     out; losing it would make the gate red on correct prose.
  {
    const { findings } = checkFile(GOOD_PAGE, GOOD_CATALOG);
    expect('a node_modules file path is not a subpath claim', has(findings, /CHANGELOG/), false);
  }

  // 11. POSITIVE — the heading disagreeing with its OWN table. This is the
  //     internal inconsistency #11344 measured (171 declared, 170 summed).
  {
    const bad = GOOD_PAGE.replace('(5 schemas)', '(6 schemas)');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('heading vs table sum is reported', has(findings, /heading declares 6 schemas but its own table sums to 5/), true);
  }

  // 12. POSITIVE — a row disagreeing with the tree, which is the freshness
  //     half: the table can be perfectly self-consistent and still stale.
  {
    const bad = GOOD_PAGE.replace('| data | 3 | Object, Query |', '| data | 4 | Object, Query |').replace('(5 schemas)', '(6 schemas)');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('stale domain row is reported', has(findings, /domain `data` declares 4 schemas; src\/data\/ holds 3/), true);
    expect('and the total is reported against the tree', has(findings, /heading declares 6 schemas; packages\/spec\/src\/ holds 5/), true);
  }

  // 13. POSITIVE — a domain that exists in the tree but has no row. #11344's
  //     `qa` domain was missing exactly this way, and every other number on
  //     the page agreed with every other number.
  {
    const bad = GOOD_PAGE.replace('| ui | 2 | View |\n', '').replace('(5 schemas)', '(3 schemas)');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('dropped domain is reported', has(findings, /domain `ui` has 2 schemas in src\/ui\/ but no row/), true);
    expect('dropped domain is a listed finding', findings.find((f) => /no row/.test(f.message))?.kind, 'listed');
  }

  // 14. POSITIVE — a row for a domain that is not a schema domain at all.
  {
    const bad = GOOD_PAGE.replace('| ui | 2 | View |', '| ui | 2 | View |\n| ghost | 0 | nothing |');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('invented domain is reported', has(findings, /domain row `ghost` names no schema domain/), true);
  }

  // 15. POSITIVE — the package count against the workspace.
  {
    const bad = GOOD_PAGE.replace('(2 packages)', '(19 packages)');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('stale package count is reported', has(findings, /heading declares 19 packages; the workspace publishes 2/), true);
  }

  // 16. POSITIVE — a package row naming something the workspace does not
  //     publish (#11344's `@objectstack/nextjs` / `@objectstack/nestjs`).
  {
    const bad = GOOD_PAGE.replace('| `@objectstack/core` | Runtime core |', '| `@objectstack/nextjs` | Next.js adapter |');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('phantom package row is reported', has(findings, /advertises `@objectstack\/nextjs`, which this workspace does not publish/), true);
  }

  // 17. POSITIVE — reformatting the inventory heading takes it out of the
  //     count population, so it must be loud rather than silently uncounted.
  {
    const bad = GOOD_PAGE.replace('## 3. Schema Inventory by Domain (5 schemas)', '## 3. Schema Inventory by Domain - 5 schemas');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('uncounted inventory heading is reported', has(findings, /declares no "\(N schemas\)" count/), true);
  }

  // 18. POSITIVE — the contract section disappearing is loud.
  {
    const bad = GOOD_PAGE.replace('## 6. Service Contracts (`@objectstack/spec/contracts`)', '## 6. Service Contracts');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('missing contract section is reported', has(findings, /exactly one section whose heading names `@objectstack\/spec\/contracts`, found 0/), true);
  }

  // 19. POSITIVE — a page the parser no longer recognises at all fails
  //     loudly instead of passing with zero comparisons. This is the
  //     invariant that keeps every other one from retiring silently.
  {
    const { findings } = checkFile('# llms\n\nnothing here.\n', GOOD_CATALOG);
    expect('unrecognised page is reported', findings.length > 0, true);
    expect('unrecognised page loses the layer blocks', has(findings, /no "### Layer N: \.\.\." blocks found at all/), true);
    expect('unrecognised page loses the namespace blocks', has(findings, /namespace exports section is unreadable/), true);
    expect('unrecognised page loses the contract section', has(findings, /found 0/), true);
  }

  // 20. POSITIVE — a contract table with no rows is a structure finding, not
  //     a vacuous pass.
  {
    const bad = GOOD_PAGE.replace('| `IMetadataService` | register, get |\n', '');
    const { findings } = checkFile(bad, GOOD_CATALOG);
    expect('empty contract table is reported', has(findings, /has a table with no rows|has 0 tables/), true);
  }

  if (failures.length) {
    console.error('\n✗ check-llms-txt self-test failed:\n');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('✓ check-llms-txt self-test: 20 cases pass.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  if (process.argv.includes('--self-test')) return selfTest();

  const full = join(ROOT, TARGET);
  if (!existsSync(full)) {
    // The file moving is itself a finding: a silent skip would retire the gate.
    console.error(`\n✗ ${TARGET} not found.\n`);
    console.error(
      'This guard exists because that file ships to AI consumers in the npm\n' +
        'tarball and is hand-kept with no generator. If it moved, point TARGET in\n' +
        `${SELF} at its new home; if it is gone, delete this gate,\n` +
        "its package.json wiring, its lint.yml step and its check:generated ledger entry.\n",
    );
    process.exit(1);
  }

  const catalog = buildCatalog();
  const { findings, checked } = checkFile(readFileSync(full, 'utf8'), catalog);

  if (findings.length === 0) {
    const domains = Object.keys(catalog.domainZodCounts).length;
    const total = Object.values(catalog.domainZodCounts).reduce((a, b) => a + b, 0);
    console.log(
      `✓ ${TARGET}: ${checked} claim(s) re-derived — every advertised symbol resolves against ` +
        `api-surface/ (${Object.keys(catalog.entryExports).length} entry points), every subpath is a real ` +
        `\`exports\` key, the inventory matches src/ (${domains} domains, ${total} schemas) and the package ` +
        `table matches the workspace (${catalog.workspacePackages.size} published).`,
    );
    return;
  }

  console.error(`\n✗ ${TARGET} — the file advertises things this package does not have:\n`);
  for (const f of findings) console.error(`  ${TARGET}:${f.line}  [${f.kind}] ${f.message}`);
  console.error(`
This file is hand-kept and SHIPS to AI consumers inside the npm tarball, so a
stale claim here becomes generated code that does not compile. Fix the FILE —
there is deliberately no \`gen:llms-txt\` (see the header): the numbers are not
the claim, the prose beside them is, and rewriting a count without re-reading
its row turns a loud staleness into a silent lie.

  - [named]   the symbol is not exported where the file says it is. Decide
              which half is wrong: re-attribute it to the entry point that
              really exports it, rename it to the export that exists, or — when
              nothing exports it — DELETE the claim. Do not invent a
              replacement: a made-up migration path is worse than a gap.
  - [subpath] the file names an \`@objectstack/spec/x\` that is not an \`exports\`
              key. Either the subpath was renamed or it never existed.
  - [count]   a declared number disagrees with the tree or with its own table.
              Re-read the section, then correct the number AND the prose.
  - [listed]  a row names a package or a domain that does not exist, or a real
              domain has no row at all.
  - [structure] the file no longer looks the way this gate reads it. Reported
              rather than skipped on purpose: a checker that quietly stops
              recognising its file reports success forever.
`);
  process.exit(1);
}

main();
