// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package documentation collection + lint (ADR-0046).
 *
 * `os build` compiles every Markdown file in the package's flat
 * `src/docs/` directory into a `doc` metadata item on the stack
 * (`docs: DocSchema[]`). This module owns both halves of that contract:
 *
 *   - **Collection**: filename stem → `name`, frontmatter `title:` or the
 *     first `#` heading → `label`, body → `content`. Subdirectories are a
 *     build error — flatness is the contract that keeps cross-references
 *     stable (a link is `[text](./<name>.md)`; resolution is a basename
 *     lookup with zero path arithmetic).
 *   - **Lint**: namespace-prefix naming (doc uniqueness is logical — the
 *     metadata registry key carries no package coordinate, so a bare-name
 *     collision silently overwrites across packages), the v1 syntax bans
 *     (no MDX, no images), and same-package link resolution.
 *
 * Cross-package links (a target whose prefix is not this package's
 * namespace) are deliberately not checked here: they resolve against
 * dependency docs at publish time, and render-side they degrade to a
 * "doc not found" notice rather than coupling into dependency resolution.
 */

import fs from 'fs';
import path from 'path';

export interface DocTranslationItem {
  label?: string;
  description?: string;
  content: string;
}

export interface DocItem {
  name: string;
  label?: string;
  description?: string;
  content: string;
  /**
   * Sort key + explicit book-group placement (ADR-0046 §6), read from
   * frontmatter `order:`/`group:`. The book resolver honors both; absent
   * leaves them out so the schema defaults apply.
   */
  order?: number;
  group?: string;
  /**
   * Per-locale variants (ADR-0046 i18n), compiled from sibling
   * `<name>.<locale>.md` files. The base file is the default + fallback.
   */
  translations?: Record<string, DocTranslationItem>;
}

export interface DocIssue {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  path: string;
}

const DOC_NAME_RE = /^[a-z][a-z0-9_]*$/;
// A locale-variant file is `<base>.<locale>.md` (ADR-0046 i18n), e.g.
// `crm_lead_guide.zh.md` or `crm_lead_guide.pt-BR.md`. The base stem must be a
// valid doc name; the locale is a BCP-47-ish tag (primary subtag + optional
// region). Flatness is unchanged — variants are still flat siblings.
const DOC_VARIANT_RE = /^([a-z][a-z0-9_]*)\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)$/;

/** Extract a single-line scalar `key: value` from a frontmatter block. */
function frontmatterScalar(block: string, key: string): string | undefined {
  const re = new RegExp(`^${key}\\s*:`, 'i');
  const line = block.split(/\r?\n/).find((l) => re.test(l));
  if (!line) return undefined;
  const value = line.replace(re, '').trim().replace(/^['"]|['"]$/g, '');
  return value || undefined;
}

/**
 * Strip a leading `---` frontmatter block; extract `title:`, `description:`,
 * `order:`, and `group:` if present (all optional, single-line scalars).
 * `order:` is parsed to a number and dropped when non-numeric.
 */
function parseFrontmatter(raw: string): {
  title?: string;
  description?: string;
  order?: number;
  group?: string;
  body: string;
} {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return { body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { body: raw };
  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const bodyStart = raw.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : raw.slice(bodyStart + 1);
  const orderRaw = frontmatterScalar(block, 'order');
  const order = orderRaw !== undefined ? Number(orderRaw) : undefined;
  return {
    title: frontmatterScalar(block, 'title'),
    description: frontmatterScalar(block, 'description'),
    ...(order !== undefined && !Number.isNaN(order) ? { order } : {}),
    group: frontmatterScalar(block, 'group'),
    body,
  };
}

/** Remove fenced code blocks and inline code spans before content scans. */
function stripCode(markdown: string): string {
  return markdown
    .replace(/^(```|~~~)[\s\S]*?^\1\s*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

function firstHeading(markdown: string): string | undefined {
  const m = stripCode(markdown).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : undefined;
}

/**
 * Read `src/docs/*.md` (flat) next to the given config file and compile
 * each file into a `DocItem`. Structural problems (subdirectories, bad
 * filename stems) are reported as error issues; offending files are
 * skipped rather than partially collected.
 */
export function collectDocsFromSrc(configPath: string): { docs: DocItem[]; issues: DocIssue[] } {
  const docsDir = path.join(path.dirname(configPath), 'src', 'docs');
  const issues: DocIssue[] = [];
  if (!fs.existsSync(docsDir)) return { docs: [], issues };

  const baseByName = new Map<string, DocItem>();
  const variants: Array<{ base: string; locale: string; item: DocTranslationItem; rel: string }> = [];

  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    const rel = `src/docs/${entry.name}`;
    if (entry.isDirectory()) {
      issues.push({
        severity: 'error',
        rule: 'docs/flat-directory',
        message: `Subdirectory "${entry.name}" under src/docs/ is not allowed (ADR-0046 §3.2). Flatten all .md files directly into src/docs/.`,
        path: rel,
      });
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const stem = entry.name.slice(0, -3);
    const raw = fs.readFileSync(path.join(docsDir, entry.name), 'utf-8');
    const { title, description, order, group, body } = parseFrontmatter(raw);

    // Locale variant `<base>.<locale>.md` (ADR-0046 i18n) — checked before the
    // bare-name rule, since a variant stem legitimately contains a dot.
    const variantMatch = stem.match(DOC_VARIANT_RE);
    if (variantMatch) {
      variants.push({
        base: variantMatch[1],
        locale: variantMatch[2],
        item: { ...(title ? { label: title } : {}), ...(description ? { description } : {}), content: body },
        rel,
      });
      continue;
    }

    if (!DOC_NAME_RE.test(stem)) {
      issues.push({
        severity: 'error',
        rule: 'docs/filename',
        message: `Doc filename "${entry.name}" must be snake_case (e.g. crm_lead_guide.md), optionally with a locale suffix (crm_lead_guide.zh.md); the stem becomes the doc name.`,
        path: rel,
      });
      continue;
    }

    baseByName.set(stem, {
      name: stem,
      label: title ?? firstHeading(body),
      ...(description ? { description } : {}),
      content: body,
      ...(order !== undefined ? { order } : {}),
      ...(group ? { group } : {}),
    });
  }

  // Fold variants into their base doc. An orphan variant (no base file) is an
  // error: it would silently never render (resolution always starts from the
  // base doc).
  for (const v of variants) {
    const base = baseByName.get(v.base);
    if (!base) {
      issues.push({
        severity: 'error',
        rule: 'docs/orphan-translation',
        message: `Locale variant "${path.basename(v.rel)}" has no base doc "${v.base}.md" in this package — add the base file or remove the variant.`,
        path: v.rel,
      });
      continue;
    }
    if (base.translations?.[v.locale]) {
      issues.push({
        severity: 'error',
        rule: 'docs/duplicate-translation',
        message: `Duplicate "${v.locale}" variant for doc "${v.base}".`,
        path: v.rel,
      });
      continue;
    }
    (base.translations ??= {})[v.locale] = v.item;
  }

  return { docs: [...baseByName.values()], issues };
}

/**
 * Content + naming lint over the package's full doc set (collected files
 * plus any inline `defineStack({ docs })` items).
 */
export function lintDocs(docs: DocItem[], namespace: string | undefined): DocIssue[] {
  const issues: DocIssue[] = [];
  if (docs.length === 0) return issues;

  if (!namespace) {
    issues.push({
      severity: 'error',
      rule: 'docs/namespace-required',
      message: 'A package that ships docs must declare manifest.namespace (ADR-0046 §3.2) — doc names are namespace-prefixed.',
      path: 'manifest.namespace',
    });
  }

  const names = new Set<string>();
  for (const doc of docs) {
    const where = `docs/${doc.name}`;

    if (names.has(doc.name)) {
      issues.push({
        severity: 'error',
        rule: 'docs/duplicate-name',
        message: `Duplicate doc name "${doc.name}" (inline defineStack docs and src/docs/*.md files share one namespace).`,
        path: where,
      });
      continue;
    }
    names.add(doc.name);

    if (namespace && !doc.name.startsWith(`${namespace}_`)) {
      issues.push({
        severity: 'error',
        rule: 'docs/namespace-prefix',
        message: `Doc name "${doc.name}" must carry the package namespace prefix: rename to "${namespace}_${doc.name}" (file ${namespace}_${doc.name}.md).`,
        path: where,
      });
    }

    const scannable = stripCode(doc.content);

    // v1 image ban (ADR-0046 §3.4): binaries bloat artifacts; external
    // URLs break version immutability.
    if (/!\[[^\]]*\]\(/.test(scannable) || /<img[\s>]/i.test(scannable)) {
      issues.push({
        severity: 'error',
        rule: 'docs/no-images',
        message: `Doc "${doc.name}" contains an image reference — not allowed in v1 (ADR-0046 §3.4).`,
        path: where,
      });
    }

    // MDX ban (ADR-0046 §3.4): MDX is code crossing the ADR-0025 trust
    // boundary. Heuristics are conservative — ESM import/export statement
    // shapes and capitalized JSX component tags outside code — so prose
    // like "import the data first" never trips them.
    if (
      /^\s*import\s+.+\s+from\s+['"]/m.test(scannable) ||
      /^\s*export\s+(default|const|function)\s/m.test(scannable) ||
      /<[A-Z][A-Za-z0-9]*[\s/>]/.test(scannable)
    ) {
      issues.push({
        severity: 'error',
        rule: 'docs/no-mdx',
        message: `Doc "${doc.name}" appears to contain MDX/JSX — only CommonMark + GFM Markdown is allowed (ADR-0046 §3.3/§3.4).`,
        path: where,
      });
    }

    // Locale variants get the same v1 content bans — a translated body must
    // not smuggle in MDX/images that the base file forbids.
    for (const [locale, variant] of Object.entries(doc.translations ?? {})) {
      const vScannable = stripCode(variant.content);
      if (/!\[[^\]]*\]\(/.test(vScannable) || /<img[\s>]/i.test(vScannable)) {
        issues.push({
          severity: 'error',
          rule: 'docs/no-images',
          message: `Doc "${doc.name}" (${locale}) contains an image reference — not allowed in v1 (ADR-0046 §3.4).`,
          path: `${where}.${locale}`,
        });
      }
      if (
        /^\s*import\s+.+\s+from\s+['"]/m.test(vScannable) ||
        /^\s*export\s+(default|const|function)\s/m.test(vScannable) ||
        /<[A-Z][A-Za-z0-9]*[\s/>]/.test(vScannable)
      ) {
        issues.push({
          severity: 'error',
          rule: 'docs/no-mdx',
          message: `Doc "${doc.name}" (${locale}) appears to contain MDX/JSX — only CommonMark + GFM Markdown is allowed (ADR-0046 §3.3/§3.4).`,
          path: `${where}.${locale}`,
        });
      }
    }
  }

  // Same-package link resolution: `[text](./<name>.md#anchor)` where the
  // target carries OUR namespace prefix must resolve to a doc in this
  // package. Targets with a different prefix are cross-package links,
  // verified at publish time against dependency docs.
  for (const doc of docs) {
    const linkRe = /\]\((?:\.\/)?([a-zA-Z0-9_.-]+\.md)(#[^)]*)?\)/g;
    const scannable = stripCode(doc.content);
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(scannable)) !== null) {
      const target = m[1].slice(0, -3);
      if (m[1].includes('/')) continue; // path-shaped link; flatness rule already errs on real subdirs
      if (namespace && !target.startsWith(`${namespace}_`)) continue;
      if (!names.has(target)) {
        issues.push({
          severity: 'error',
          rule: 'docs/broken-link',
          message: `Doc "${doc.name}" links to "./${m[1]}" but no doc named "${target}" exists in this package.`,
          path: `docs/${doc.name}`,
        });
      }
    }
  }

  return issues;
}

// ── Inline metadata views (ADR-0051): ```metadata fences ────────────────────

type AnyRec = Record<string, unknown>;

const METADATA_EMBED_TYPES = ['state_machine', 'flow', 'permission'] as const;

/** Parse a flat `key: value` ```metadata fence body (data, not code). Mirrors
 *  the objectui-side parser so build-time validation matches render-time. */
function parseMetadataFenceBody(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Extract each ```metadata fenced block's raw body from Markdown. NOTE: the
 *  other content scans use stripCode(), which DELETES fenced blocks — so this
 *  walks the raw lines instead. */
function extractMetadataFences(content: string): string[] {
  const bodies: string[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```\s*metadata\b/.test(lines[i])) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      bodies.push(body.join('\n'));
    }
  }
  return bodies;
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Closest candidate within a small edit distance, for did-you-mean hints. */
function nearest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

/**
 * Lint ```metadata embeds (ADR-0051): body shape + reference liveness against
 * the package's OWN metadata. A broken embed degrades to a placeholder at
 * render time (never crashes), but a dead same-package reference is a build
 * error here — the same posture as `docs/broken-link`. Cross-package embeds
 * are out of v1 scope, so every reference must resolve within this stack.
 */
export function lintMetadataEmbeds(docs: DocItem[], stack: Record<string, unknown>): DocIssue[] {
  const issues: DocIssue[] = [];
  const objects = Array.isArray(stack.objects) ? (stack.objects as AnyRec[]) : [];
  const flows = Array.isArray(stack.flows) ? (stack.flows as AnyRec[]) : [];
  const permissions = Array.isArray(stack.permissions) ? (stack.permissions as AnyRec[]) : [];
  const objByName = new Map(objects.map((o) => [String(o?.name), o]));
  const flowNames = flows.map((f) => String(f?.name));
  const permNames = permissions.map((p) => String(p?.name));

  const scan = (docName: string, content: string, locale?: string): void => {
    const where = `docs/${docName}${locale ? ` (${locale})` : ''}`;
    const err = (rule: string, message: string) => issues.push({ severity: 'error', rule, message, path: where });

    for (const body of extractMetadataFences(content)) {
      const f = parseMetadataFenceBody(body);
      const type = f.type;

      // ── body shape ──
      if (!type) {
        err('docs/metadata-embed', `metadata embed in "${docName}" is missing \`type\` (one of ${METADATA_EMBED_TYPES.join(', ')}).`);
        continue;
      }
      if (!(METADATA_EMBED_TYPES as readonly string[]).includes(type)) {
        const s = nearest(type, METADATA_EMBED_TYPES as unknown as string[]);
        err('docs/metadata-embed', `metadata embed in "${docName}" has unknown type "${type}"${s ? ` — did you mean \`${s}\`?` : ` (expected ${METADATA_EMBED_TYPES.join(', ')})`}.`);
        continue;
      }
      if (!f.name) {
        err('docs/metadata-embed', `metadata embed (${type}) in "${docName}" is missing \`name\`.`);
        continue;
      }

      // ── reference liveness (same-package) ──
      if (type === 'state_machine') {
        if (!f.object) {
          err('docs/metadata-embed', `state_machine embed "${f.name}" in "${docName}" is missing \`object\` (a state machine is a rule on an object).`);
          continue;
        }
        const obj = objByName.get(f.object);
        if (!obj) {
          const s = nearest(f.object, [...objByName.keys()]);
          err('docs/metadata-embed-ref', `state_machine embed in "${docName}" references object "${f.object}", which does not exist in this package${s ? ` — did you mean \`${s}\`?` : ''}.`);
          continue;
        }
        const rules = obj.validations ?? obj.validationRules;
        const smNames = (Array.isArray(rules) ? (rules as AnyRec[]) : [])
          .filter((r) => r?.type === 'state_machine')
          .map((r) => String(r?.name));
        if (!smNames.includes(f.name)) {
          const s = nearest(f.name, smNames);
          err('docs/metadata-embed-ref', `state_machine embed in "${docName}" references "${f.name}", but object "${f.object}" has no state_machine rule with that name${s ? ` — did you mean \`${s}\`?` : ''}.`);
        }
      } else if (type === 'flow') {
        if (!flowNames.includes(f.name)) {
          const s = nearest(f.name, flowNames);
          err('docs/metadata-embed-ref', `flow embed in "${docName}" references flow "${f.name}", which does not exist in this package${s ? ` — did you mean \`${s}\`?` : ''}.`);
        }
      } else if (type === 'permission') {
        if (!permNames.includes(f.name)) {
          const s = nearest(f.name, permNames);
          err('docs/metadata-embed-ref', `permission embed in "${docName}" references permission set "${f.name}", which does not exist in this package${s ? ` — did you mean \`${s}\`?` : ''}.`);
        }
      }
    }
  };

  for (const doc of docs) {
    scan(doc.name, doc.content);
    for (const [locale, v] of Object.entries(doc.translations ?? {})) scan(doc.name, v.content, locale);
  }
  return issues;
}

/**
 * One-call entry for `os build`: collect `src/docs/*.md`, merge with the
 * stack's inline `docs`, and lint the combined set. Returns the merged
 * doc array (inline items first — they were already schema-validated) and
 * every issue found.
 */
export function collectAndLintDocs(
  configPath: string,
  stack: Record<string, unknown>,
): { docs: DocItem[]; issues: DocIssue[] } {
  const inline = Array.isArray(stack.docs) ? (stack.docs as DocItem[]) : [];
  const collected = collectDocsFromSrc(configPath);
  const namespace = (stack.manifest as { namespace?: string } | undefined)?.namespace;
  const docs = [...inline, ...collected.docs];
  const issues = [...collected.issues, ...lintDocs(docs, namespace), ...lintMetadataEmbeds(docs, stack)];
  return { docs, issues };
}
