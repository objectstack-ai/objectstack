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
//     (`$schema: .../template-manifest.json` — name/displayName/businessFunctions/skills/
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

/**
 * The reverse-domain prefix a scaffolded project is named under.
 *
 * `example.com` is the IETF-reserved documentation domain (RFC 2606), so a
 * scaffold can carry it without colliding with anyone's real namespace, and an
 * author who publishes is told to change it rather than discovering a clash.
 */
const SCAFFOLD_ID_PREFIX = 'com.example.';

/**
 * The package id a scaffolded project gets, derived from its project name.
 *
 * `manifest.id` is a reverse-domain identifier (`MANIFEST_ID_PATTERN`,
 * `@objectstack/spec/kernel`): dot-separated lowercase segments, hyphens
 * allowed inside a segment, **underscores not**. That last clause is why this
 * cannot reuse `sanitizeNamespace`: a namespace is snake_case by rule, so
 * `my-app` sanitizes to the namespace `my_app`, and `com.example.my_app` is
 * refused by the very schema the scaffold has to satisfy. The two identifiers
 * are derived from the same project name under DIFFERENT rules, and deriving
 * one from the other is the bug.
 *
 * Nor can the raw project name be used: `id: '<projectName>'` is what shipped,
 * and a bare word carries no dot at all, so every scaffolded project failed
 * `manifest.id` the moment the rule was enforced.
 *
 * Held against the real pattern by `rewrite-identity.test.ts`.
 */
export function deriveManifestId(projectName: string): string {
  // Drop an npm scope: `@acme/my-app` is the project `my-app`.
  let s = projectName.replace(/^@[^/]+\//, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  // A segment must OPEN with a letter, so a name that is empty or starts with a
  // digit gets a literal prefix rather than a silently invalid id.
  if (!/^[a-z]/.test(s)) s = `app-${s}`.replace(/-+$/, '');
  return `${SCAFFOLD_ID_PREFIX}${s}`;
}

/**
 * The longest namespace a scaffold emits: the longest base namespace that
 * still has a paired customization namespace (`<namespace>_custom`, ADR-0146
 * D3). A longer one passes the manifest grammar (20 characters) but has no
 * pair, so `os validate` on the fresh project warns
 * `namespace-no-customization-pair` about objects its author never wrote.
 *
 * It is `MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH` from
 * `@objectstack/spec/kernel`, restated because this package cannot import it:
 * the spec is a devDependency here, so a value import would be bundled into
 * the published scaffolder (`check:undeclared-dep-imports`), and making it a
 * runtime dependency would put zod into a two-dependency `npx` entry point.
 * `scaffold-namespace-cap.test.ts` pins the two equal, so they cannot drift.
 */
export const SCAFFOLD_NAMESPACE_MAX_LENGTH = 13;

/**
 * The `objectstack.manifest.json` keys `@objectstack/spec` 18 retired
 * (ADR-0049): `category` (#30980) and `name`, `specVersion`, `skills`,
 * `scaffold`, `visibility`, `publisher`, `isStarter` (#31035).
 * `TemplateManifestSchema` carries a `retiredKey()` tombstone for each, so a
 * manifest still declaring one fails a parse, and `os package publish`
 * refuses `category`, `visibility` and `publisher` outright. The scaffolder strips
 * every one of them from the template's manifest, so a template authored
 * before that release can never hand a new project a manifest the schema
 * refuses.
 *
 * Restated rather than imported for the reason {@link SCAFFOLD_NAMESPACE_MAX_LENGTH}
 * gives (the spec is not a runtime dependency of this two-dependency `npx`
 * entry point). `scaffold-retired-manifest-keys.test.ts` pins this list equal
 * to the spec's own registry rows (`RETIRED_KEYS_BY_MAJOR`, every
 * `marketplace/TemplateManifest:<key>` entry), so a key retired there without
 * being added here goes red.
 */
export const RETIRED_TEMPLATE_MANIFEST_KEYS = [
  'category',
  'name',
  'specVersion',
  'skills',
  'scaffold',
  'visibility',
  'publisher',
  'isStarter',
] as const;

/**
 * Delete every {@link RETIRED_TEMPLATE_MANIFEST_KEYS} key from a parsed
 * manifest, in place. Returns the keys it found, in list order.
 */
export function stripRetiredManifestKeys(manifest: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of RETIRED_TEMPLATE_MANIFEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) {
      delete manifest[key];
      found.push(key);
    }
  }
  return found;
}

/**
 * Convert an npm package name into a valid ObjectStack namespace identifier
 * (regex `^[a-z][a-z0-9_]{1,19}$`, reserved: base/system/sys) that is at most
 * {@link SCAFFOLD_NAMESPACE_MAX_LENGTH} characters, so it has a paired
 * customization namespace. A longer name is truncated, with no trailing `_`.
 * Mirrors `sanitizeNamespace()` in `@objectstack/cli`'s `init` command, so
 * both scaffolders agree.
 */
export function sanitizeNamespace(name: string): string {
  const max = SCAFFOLD_NAMESPACE_MAX_LENGTH;
  let s = name.replace(/^@[^/]+\//, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  s = s.replace(/^_+|_+$/g, '');
  if (!s) s = 'app';
  if (/^[0-9]/.test(s)) s = 'a' + s;
  if (s.length < 2) s = (s + '_app').slice(0, max);
  if (s.length > max) s = s.slice(0, max).replace(/_+$/, '');
  if (['base', 'system', 'sys'].includes(s)) s = (s + '_app').slice(0, max);
  return s;
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
 * Any `name: '<oldNs>_…'` literal still present after a rewrite that does NOT
 * also carry the `<newNs>_` prefix — i.e. metadata the scaffolded project will
 * be rejected for. Each entry is `file:line` relative to `dir`, plus the
 * offending text.
 *
 * Both halves of the predicate are needed. A new namespace may itself begin
 * with `<oldNs>_` (project `blank-probe` → namespace `blank_probe` under the
 * `blank` template), and then every CORRECTLY rewritten name (`blank_probe_note`)
 * carries the old prefix too; testing the old prefix alone reports the rewrite
 * as stale and refuses a valid project. A name under `<newNs>_` satisfies the
 * `${namespace}_${shortName}` rule whatever else it starts with, so it is
 * never stale. One predicate for every template namespace — no name is special.
 * Judged per literal, so a correct name cannot hide a stale one on its line.
 */
export function findStaleNamespacePrefixes(
  dir: string,
  oldNs: string,
  newNs: string,
): { file: string; line: number; text: string }[] {
  const oldRe = namePrefixRe(oldNs, 'g');
  const newRe = namePrefixRe(newNs, '');
  const stale: { file: string; line: number; text: string }[] = [];
  for (const file of tsFiles(dir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const literals = [...lines[i].matchAll(oldRe)].map((m) => m[0]);
      if (literals.some((literal) => !newRe.test(literal))) {
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
