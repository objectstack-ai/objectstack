// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build Skill References
 *
 * Generates an `_index.md` file per skill that points to Zod schema source
 * files inside the consumer's `node_modules/@objectstack/spec/src/`.
 *
 * Skills do NOT bundle copies of the schemas — when a skill is installed
 * into a metadata-driven project (e.g. via skills.sh), `@objectstack/spec`
 * is always present as a dependency. Pointing at the published source files
 * keeps a single source of truth and stays version-aligned automatically.
 *
 * The script:
 * 1. Reads a declarative mapping of { skill → core zod files }
 * 2. Recursively resolves local `import … from` dependencies (so the index
 *    surfaces shared schemas an agent will need to follow)
 * 3. Writes `skills/{name}/references/_index.md` with pointers + one-line
 *    descriptions extracted from each file's leading JSDoc comment
 *
 * Usage:
 *   tsx scripts/build-skill-references.ts            # write
 *   tsx scripts/build-skill-references.ts --check    # verify in sync (CI); exit 1 on drift
 */

import fs from 'fs';
import path from 'path';
import { createSink, type Owns } from './lib/generated-output';

// ── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SPEC_SRC = path.resolve(__dirname, '../src');
const SKILLS_DIR = path.resolve(REPO_ROOT, 'skills');
const SPEC_PKG = '@objectstack/spec';

const CHECK = process.argv.includes('--check');
const { emit, manageDir, flush } = createSink({ check: CHECK, repoRoot: REPO_ROOT });

// ── Skill → Zod file mapping ────────────────────────────────────────────────
// Paths are relative to packages/spec/src/ (category/file.zod.ts)

const SKILL_MAP: Record<string, string[]> = {
  'objectstack-data': [
    'data/field.zod.ts',
    'data/object.zod.ts',
    'data/validation.zod.ts',
    'data/hook.zod.ts',
    'data/datasource.zod.ts',
    'data/seed.zod.ts',
    'security/permission.zod.ts',
  ],
  'objectstack-query': [
    'data/query.zod.ts',
    'data/filter.zod.ts',
  ],
  'objectstack-ai': [
    'ai/agent.zod.ts',
    'ai/tool.zod.ts',
    'ai/skill.zod.ts',
    'ai/model-registry.zod.ts',
    'ai/conversation.zod.ts',
    'ai/mcp.zod.ts',
    'ai/embedding.zod.ts',
    'ai/usage.zod.ts',
  ],
  'objectstack-api': [
    'api/endpoint.zod.ts',
    'api/auth.zod.ts',
    'api/realtime.zod.ts',
    'api/rest-server.zod.ts',
    'api/graphql.zod.ts',
    'api/websocket.zod.ts',
    'api/errors.zod.ts',
    'api/batch.zod.ts',
    'api/versioning.zod.ts',
  ],
  'objectstack-automation': [
    'automation/flow.zod.ts',
    'automation/trigger-registry.zod.ts',
    'automation/approval.zod.ts',
    'automation/state-machine.zod.ts',
    'automation/execution.zod.ts',
    'automation/webhook.zod.ts',
    'automation/node-executor.zod.ts',
  ],
  'objectstack-ui': [
    'ui/view.zod.ts',
    'ui/app.zod.ts',
    'ui/dashboard.zod.ts',
    'ui/chart.zod.ts',
    'ui/action.zod.ts',
    'ui/page.zod.ts',
    'ui/widget.zod.ts',
    'ui/component.zod.ts',
    'ui/report.zod.ts',
    'ui/theme.zod.ts',
  ],
  'objectstack-platform': [
    // project setup (was objectstack-quickstart)
    'kernel/manifest.zod.ts',
    'data/datasource.zod.ts',
    'data/seed.zod.ts',
    // plugin development (was objectstack-plugin)
    'kernel/plugin.zod.ts',
    'kernel/context.zod.ts',
    'kernel/service-registry.zod.ts',
    'kernel/plugin-lifecycle-events.zod.ts',
    'kernel/plugin-capability.zod.ts',
    'kernel/plugin-loading.zod.ts',
    'kernel/feature.zod.ts',
    'kernel/metadata-plugin.zod.ts',
  ],
  'objectstack-i18n': [
    'system/translation.zod.ts',
    'ui/i18n.zod.ts',
  ],
};

// ── Import resolver ──────────────────────────────────────────────────────────

function extractLocalImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];
  const dir = path.dirname(filePath);
  // Match `import … from '<relative>'`, tolerating a multi-line import clause.
  // The clause between `import` and `from` never contains a `;`, quote, or `(`,
  // so excluding those keeps the non-greedy span from bridging across a
  // statement boundary, a side-effect import (`import './x'`), or a dynamic
  // `import(...)` into the wrong specifier. A plain `.` (the old pattern) does
  // not cross newlines, so multi-line named imports were silently dropped.
  const re = /^import\b[^;'"()]*?\bfrom\s*['"](\.[^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const importSpec = match[1];
    let resolved = path.resolve(dir, importSpec);
    // ESM specifiers may carry a `.js` extension that maps to a `.ts` source
    // (`./types.js` → `./types.ts`); otherwise append `.ts` for an
    // extensionless local specifier. Blindly appending `.ts` turned `.js`
    // imports into a non-existent `foo.js.ts` that was then dropped.
    if (resolved.endsWith('.js')) resolved = resolved.slice(0, -3) + '.ts';
    else if (!resolved.endsWith('.ts')) resolved += '.ts';
    if (fs.existsSync(resolved)) {
      imports.push(path.relative(SPEC_SRC, resolved));
    }
  }
  return imports;
}

/**
 * Transitive closure of a skill's core files.
 *
 * Only SKILL_MAP entries can be `missing` — `extractLocalImports` resolves
 * against disk, so a dep that doesn't exist is never queued. A dangling entry
 * is therefore an authoring bug in SKILL_MAP, not a spec change to absorb, and
 * the caller fails on it: silently dropping the pointer is how the skill ends
 * up advertising a schema it no longer references (`data/dataset.zod.ts`
 * lingered here for a year after #1620 renamed it to `data/seed.zod.ts`).
 */
function resolveAll(entryFiles: string[]): { files: string[]; missing: string[] } {
  const visited = new Set<string>();
  const missing: string[] = [];
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (visited.has(rel)) continue;
    const abs = path.resolve(SPEC_SRC, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    visited.add(rel);
    for (const dep of extractLocalImports(abs)) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }
  return { files: [...visited].sort(), missing };
}

// ── JSDoc description extractor ──────────────────────────────────────────────

function extractDescription(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const jsdocMatch = content.match(/\/\*\*\s*\n([\s\S]*?)\*\//);
  if (jsdocMatch) {
    const lines = jsdocMatch[1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter((line) => line && !line.startsWith('@') && !line.startsWith('```'));
    const firstLine = lines[0];
    if (firstLine && firstLine.length > 5) {
      const clean = firstLine.replace(/^#+\s*/, '');
      const sentence = clean.split(/\.\s/)[0];
      return sentence.length > 120 ? sentence.slice(0, 117) + '...' : sentence;
    }
  }
  const exports: string[] = [];
  const re = /export\s+const\s+(\w+Schema|\w+)\s*(?:[:=])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) exports.push(m[1]);
  if (exports.length > 0) return `Exports: ${exports.slice(0, 5).join(', ')}`;
  return '';
}

// ── Index generator ──────────────────────────────────────────────────────────

function pointerPath(rel: string): string {
  return `node_modules/${SPEC_PKG}/src/${rel}`;
}

function generateIndex(skillName: string, coreFiles: string[], allFiles: string[]): string {
  const coreSet = new Set(coreFiles);
  const lines: string[] = [
    `# ${skillName} — Schema References`,
    '',
    '> **Auto-generated** by `packages/spec/scripts/build-skill-references.ts`.',
    `> Do not edit — re-run \`pnpm --filter ${SPEC_PKG} run gen:skill-refs\` to update.`,
    '',
    `Schemas live in the published \`${SPEC_PKG}\` package. Read them directly`,
    'from `node_modules` — there is no local copy in the skill bundle.',
    '',
    '## Core schemas',
    '',
  ];

  for (const f of allFiles.filter((f) => coreSet.has(f))) {
    const desc = extractDescription(path.resolve(SPEC_SRC, f));
    lines.push(`- \`${pointerPath(f)}\`${desc ? ` — ${desc}` : ''}`);
  }

  const deps = allFiles.filter((f) => !coreSet.has(f));
  if (deps.length > 0) {
    lines.push('', '## Transitive dependencies', '');
    for (const f of deps) {
      const desc = extractDescription(path.resolve(SPEC_SRC, f));
      lines.push(`- \`${pointerPath(f)}\`${desc ? ` — ${desc}` : ''}`);
    }
  }

  lines.push(
    '',
    '## How to read these',
    '',
    `1. The schemas are runtime Zod definitions. Use \`Read\` on the absolute`,
    `   path under \`node_modules/${SPEC_PKG}/src/\` to inspect field shapes,`,
    `   \`.describe()\` text, enums, and refinements.`,
    `2. TypeScript types: \`import type { … } from '${SPEC_PKG}'\` (or the`,
    '   matching subpath export).',
    '3. Runtime values: `import { … } from \'' + SPEC_PKG + '\'` — the package',
    '   re-exports every schema and helper.',
    '',
  );

  return lines.join('\n');
}

// ── Managed scope ────────────────────────────────────────────────────────────

/**
 * Which paths under a skill's `references/` folder this generator owns — i.e.
 * would delete and rewrite on a real run, and must therefore flag as stale
 * under `--check`.
 *
 * The folder is only *partially* ours: `react-blocks.md` is written by
 * build-react-blocks-contract.ts and hand-written notes are allowed, so both
 * are left alone. Subfolders and loose `*.zod.ts` are leftovers from the
 * retired bundled-schema layout (skills used to carry copies of the schemas);
 * we still sweep them so an old checkout converges.
 */
function ownsReferenceEntry(refsDir: string): Owns {
  return (abs) => {
    const rel = path.relative(refsDir, abs);
    if (!rel || rel.startsWith('..')) return false;
    if (rel.includes(path.sep)) return true; // inside a subfolder → wiped wholesale
    return rel === '_index.md' || rel.endsWith('.zod.ts');
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('🔗 Building skill schema reference indexes...\n');
  const problems: string[] = [];
  let totalSkills = 0;

  for (const [skillName, coreFiles] of Object.entries(SKILL_MAP)) {
    const skillDir = path.resolve(SKILLS_DIR, skillName);
    if (!fs.existsSync(skillDir)) {
      problems.push(`${skillName} → no such skill directory under skills/`);
      continue;
    }

    console.log(`📦 ${skillName}`);
    const { files: allFiles, missing } = resolveAll(coreFiles);
    for (const m of missing) problems.push(`${skillName} → ${m} (no such file under packages/spec/src)`);
    console.log(`   ${coreFiles.length} core + ${allFiles.length - coreFiles.length} deps`);

    const refsDir = path.resolve(skillDir, 'references');
    manageDir(refsDir, ownsReferenceEntry(refsDir));
    emit(path.resolve(refsDir, '_index.md'), generateIndex(skillName, coreFiles, allFiles));
    totalSkills += 1;
  }

  flush({
    surface: 'skills/*/references/_index.md',
    regenerate: '  pnpm --filter @objectstack/spec gen:skill-refs\n  git add skills',
    guard: () => {
      // A dangling SKILL_MAP entry drops a schema pointer from a shipped skill.
      // Dropping it quietly is what this generator used to do; fail instead, in
      // both modes — the map is authored config, so this is always a bug in it.
      if (problems.length) {
        return (
          `SKILL_MAP is out of sync with packages/spec/src:\n\n` +
          problems.map((p) => `  - ${p}`).join('\n') +
          `\n\n  Fix the mapping in ${path.relative(REPO_ROOT, __filename)} — point it at the\n` +
          `  schema's current path, or drop the entry if the concept is gone.`
        );
      }
      // Nothing emitted means nothing compared; "no drift" would read as green.
      if (totalSkills === 0) return `No skills found under ${path.relative(REPO_ROOT, SKILLS_DIR)} — nothing to generate.`;
      return null;
    },
  });
}

main();
