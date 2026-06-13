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

export interface DocItem {
  name: string;
  label?: string;
  description?: string;
  content: string;
}

export interface DocIssue {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  path: string;
}

const DOC_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Extract a single-line scalar `key: value` from a frontmatter block. */
function frontmatterScalar(block: string, key: string): string | undefined {
  const re = new RegExp(`^${key}\\s*:`, 'i');
  const line = block.split(/\r?\n/).find((l) => re.test(l));
  if (!line) return undefined;
  const value = line.replace(re, '').trim().replace(/^['"]|['"]$/g, '');
  return value || undefined;
}

/**
 * Strip a leading `---` frontmatter block; extract `title:` and
 * `description:` if present (both optional, single-line scalars).
 */
function parseFrontmatter(raw: string): { title?: string; description?: string; body: string } {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return { body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { body: raw };
  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const bodyStart = raw.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : raw.slice(bodyStart + 1);
  return {
    title: frontmatterScalar(block, 'title'),
    description: frontmatterScalar(block, 'description'),
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
  const docs: DocItem[] = [];
  const issues: DocIssue[] = [];
  if (!fs.existsSync(docsDir)) return { docs, issues };

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
    if (!DOC_NAME_RE.test(stem)) {
      issues.push({
        severity: 'error',
        rule: 'docs/filename',
        message: `Doc filename "${entry.name}" must be snake_case (e.g. crm_lead_guide.md); the stem becomes the doc name.`,
        path: rel,
      });
      continue;
    }

    const raw = fs.readFileSync(path.join(docsDir, entry.name), 'utf-8');
    const { title, description, body } = parseFrontmatter(raw);
    docs.push({
      name: stem,
      label: title ?? firstHeading(body),
      ...(description ? { description } : {}),
      content: body,
    });
  }
  return { docs, issues };
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
  const issues = [...collected.issues, ...lintDocs(docs, namespace)];
  return { docs, issues };
}
