// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-upgrade-guide.ts — generate `docs/protocol-upgrade-guide.md` as a pure
 * projection of the ADR-0087 registries (D4: "the upgrade guide for major N is
 * GENERATED from the change registry … it can never drift because it is a
 * projection of it").
 *
 * Everything in the emitted document comes from the D2 conversion table and
 * the D3 migration chain — the same data the loader, `objectstack migrate
 * meta`, and `spec-changes.json` run on. Hand-written narrative belongs in the
 * ADRs and release notes, not here.
 *
 *   pnpm --filter @objectstack/spec gen:upgrade-guide     # regenerate + write
 *   pnpm --filter @objectstack/spec check:upgrade-guide   # CI: fail on drift
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '../src/kernel/protocol-version';
import { MIGRATIONS_BY_MAJOR, MIGRATION_SUPPORT_FLOOR } from '../src/migrations/registry';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const GUIDE = resolve(REPO_ROOT, 'docs', 'protocol-upgrade-guide.md');
const CHECK = process.argv.includes('--check');

function build(): string {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  out('<!-- GENERATED (ADR-0087 D4) — do not edit by hand. -->');
  out('<!-- Regenerate: pnpm --filter @objectstack/spec gen:upgrade-guide -->');
  out();
  out('# Metadata protocol upgrade guide');
  out();
  out(
    `Current protocol: **${PROTOCOL_VERSION}** · chain support floor: **protocol ${MIGRATION_SUPPORT_FLOOR}** · ` +
      'generated from the ADR-0087 registries (`@objectstack/spec` `conversions/` + `migrations/`).',
  );
  out();
  out('## How to upgrade — from any past major');
  out();
  out('```bash');
  out(`objectstack migrate meta --from <your-major>   # replays every step below, in order`);
  out(
    `objectstack migrate meta --from ${MIGRATION_SUPPORT_FLOOR} --step      ` +
      '# checkpoint after each major (bisect a failure)',
  );
  out('objectstack validate && tsc --noEmit && <your tests>   # your own verify loop is the acceptance test');
  out('```');
  out();
  out(
    'Mechanical rewrites are applied for you and reported as a diff; **semantic TODOs** are printed ' +
      'with acceptance criteria and are yours to resolve — the chain never auto-applies a change that ' +
      'requires judgment. Arriving several majors late is the designed-for case: timeliness is never ' +
      'load-bearing (ADR-0087).',
  );
  out();

  for (let major = MIGRATION_SUPPORT_FLOOR + 1; major <= PROTOCOL_MAJOR; major++) {
    const step = MIGRATIONS_BY_MAJOR[major];
    const conversions = CONVERSIONS_BY_MAJOR[major] ?? [];
    out(`## Protocol ${major - 1} → ${major}`);
    out();
    if (!step && conversions.length === 0) {
      out('No metadata-facing break shipped in this major — nothing to do.');
      out();
      continue;
    }
    if (step) {
      out(step.rationale);
      out();
    }
    if (conversions.length > 0) {
      out('### Mechanical (applied for you)');
      out();
      out('| Conversion | Surface | Change | Load window |');
      out('|---|---|---|---|');
      for (const c of conversions) {
        const window = c.retiredFromLoadPath
          ? 'retired — `migrate meta` only'
          : `live — protocol ${c.toMajor} loader accepts the old shape`;
        out(`| \`${c.id}\` | \`${c.surface}\` | ${c.summary} | ${window} |`);
      }
      out();
    }
    const semantic = step?.semantic ?? [];
    if (semantic.length > 0) {
      out('### Semantic (delegated to you, with acceptance criteria)');
      out();
      for (const s of semantic) {
        out(`- **\`${s.id}\`** — \`${s.surface}\` → ${s.replacement}`);
        out(`  - Why not automatic: ${s.reason}`);
        out(`  - Done when: ${s.acceptanceCriteria}`);
      }
      out();
    }
  }

  out('---');
  out();
  out(
    '*Machine-readable equivalents: `spec-changes.json` (shipped in `@objectstack/spec` and attached to ' +
      'each GitHub Release) and the structured output of `objectstack migrate meta --json`.*',
  );
  out();
  return lines.join('\n');
}

const next = build();

if (CHECK) {
  const current = existsSync(GUIDE) ? readFileSync(GUIDE, 'utf8') : '';
  if (current !== next) {
    console.error(
      'docs/protocol-upgrade-guide.md is stale — the ADR-0087 registries changed without regenerating.\n' +
        'Run: pnpm --filter @objectstack/spec gen:upgrade-guide  (and commit the result)',
    );
    process.exit(1);
  }
  console.log('protocol-upgrade-guide.md is up to date.');
} else {
  writeFileSync(GUIDE, next);
  console.log(`Wrote ${GUIDE}`);
}
