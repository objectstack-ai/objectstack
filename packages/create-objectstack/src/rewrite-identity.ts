// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Namespace rewriting for a scaffolded project. Kept out of index.ts because
// that module calls `program.parse()` on import — anything a test needs must be
// importable without running the CLI (same reason as pkg-utils.ts).
//
// WHY THIS IS ITS OWN MODULE, AND WHY IT VERIFIES ITSELF
// -----------------------------------------------------
// A scaffolded project must satisfy the `${manifest.namespace}_${shortName}`
// rule (packages/spec/src/kernel/namespace-prefix.ts). Scaffolding rewrites the
// manifest namespace to the user's project name, so every `object.name` literal
// carrying the TEMPLATE's namespace prefix has to move with it. Rewriting one
// without the other produces a project that fails `objectstack build` on the
// user's very first command.
//
// That is exactly what shipped. The old code read the template's namespace from
// `objectstack.manifest.json` only:
//
//     if (typeof m.namespace === 'string') templateNamespace = m.namespace;
//     ...
//     if (namespace !== templateNamespace && templateNamespace) { ...rewrite... }
//
// and two different file formats answer to that name:
//
//   - the BUNDLED `blank` template's manifest is app-shaped and HAS `namespace`;
//   - a REMOTE template's manifest is the template-REGISTRY document
//     (`$schema: .../template-manifest.json` — name/displayName/category/skills/
//     translations) and has NO `namespace` at all. The real namespace lives in
//     `objectstack.config.ts`.
//
// So for every remote template the guard fell through, the object-name rewrite
// was silently skipped, while the config's `namespace:` was rewritten anyway —
// leaving `namespace: 'my_app'` next to `name: 'todo_task'`. All five published
// remote templates (todo, compliance, content, contracts, procurement) failed
// this way, and the nightly registry canary had been red on every one of them
// for weeks with nobody watching (#4902).
//
// Hence two rules here:
//   1. `objectstack.config.ts` is the AUTHORITY for the template's namespace —
//      it is the same value the scaffolder overwrites, so the two can never
//      disagree. The manifest is a fallback, not the source.
//   2. The rewrite VERIFIES ITSELF. A prefix rewrite that silently does nothing
//      is indistinguishable from one that was not needed, and that ambiguity is
//      what made this ship. `findStaleNamespacePrefixes` turns it into an error.

import fs from 'node:fs';
import path from 'node:path';

/** `namespace: 'x'` in a stack config — first occurrence, single/double/backtick. */
const CONFIG_NAMESPACE_RE = /\bnamespace:\s*(['"`])([a-z0-9_]+)\1/i;

/**
 * The namespace a template ships with, read BEFORE any rewrite.
 *
 * Prefers `objectstack.config.ts` (authoritative — the scaffolder rewrites that
 * exact literal) and falls back to an app-shaped `objectstack.manifest.json`.
 * Returns undefined when the template declares no namespace anywhere, which is
 * the one case where there is genuinely nothing to move.
 */
export function readTemplateNamespace(targetDir: string): string | undefined {
  const configPath = path.join(targetDir, 'objectstack.config.ts');
  if (fs.existsSync(configPath)) {
    const m = CONFIG_NAMESPACE_RE.exec(fs.readFileSync(configPath, 'utf8'));
    if (m) return m[2];
  }

  // Fallback: an app-shaped manifest. A template-registry manifest has no
  // `namespace` key and correctly yields undefined here.
  const manifestPath = path.join(targetDir, 'objectstack.manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (typeof m.namespace === 'string' && m.namespace) return m.namespace;
    } catch {
      // unparseable manifest → no opinion, fall through
    }
  }
  return undefined;
}

/** Every `*.ts` file under `dir`, recursively. Missing dir → empty. */
function tsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      tsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const namePrefixRe = (ns: string, flags: string) =>
  new RegExp(`(\\bname:\\s*)(['"\`])${ns}_([a-z0-9_]+)\\2`, flags);

/**
 * Rewrite `name: '<from>_x'` → `name: '<to>_x'` in every `*.ts` under `dir`.
 * Returns the number of literals rewritten.
 */
export function rewriteObjectNamePrefix(
  dir: string,
  from: string,
  to: string,
): number {
  let rewritten = 0;
  for (const file of tsFiles(dir)) {
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(
      namePrefixRe(from, 'g'),
      (_m, prefix: string, q: string, rest: string) => {
        rewritten++;
        return `${prefix}${q}${to}_${rest}${q}`;
      },
    );
    if (after !== before) fs.writeFileSync(file, after);
  }
  return rewritten;
}

/**
 * Any `name: '<oldNs>_…'` literal still present after a rewrite — i.e. metadata
 * the scaffolded project will be rejected for. Each entry is `file:line`
 * relative to `dir`, plus the offending text.
 */
export function findStaleNamespacePrefixes(
  dir: string,
  oldNs: string,
): { file: string; line: number; text: string }[] {
  const re = namePrefixRe(oldNs, '');
  const stale: { file: string; line: number; text: string }[] = [];
  for (const file of tsFiles(dir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        stale.push({
          file: path.relative(dir, file),
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }
  return stale;
}
