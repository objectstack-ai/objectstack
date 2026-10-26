import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CLI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — see the
// header of that file and objectui#3494.
import { DEMO_MODULE, findDemoImports, rewriteDemoImports, stripCode } from '../extract-mdx-demos.mjs';

/**
 * objectui#3788 — the migration script rewrote the demo import by MATCHING ONE
 * SPELLING of the statement instead of by reading what the migrated file still
 * uses.
 *
 * `scripts/extract-mdx-demos.mjs` turns `<InteractiveDemo …/>` / `<ComponentDemo …/>`
 * blocks into `<SchemaExample id="…"/>`, then swapped the file's import. The swap
 * was this regex:
 *
 *     /import\s*\{\s*InteractiveDemo[^}]*\}\s*from\s*['"]@\/app\/components\/ComponentDemo['"];?/
 *
 * `\{\s*InteractiveDemo` anchors on the FIRST specifier being `InteractiveDemo`.
 * Every file written as `import { ComponentDemo, DemoGrid } from '…'` therefore
 * had its content migrated and its import left untouched, and the residue piled
 * up: measured on `origin/main` @ `0af9826ab`, 106 files under `content/docs/`
 * carried such an import, 84 of them using neither name and 22 using only
 * `DemoGrid`. Nothing broke — an unused MDX import is inert — which is precisely
 * why it grew unseen for a whole migration wave.
 *
 * `rewriteDemoImports` decides on USAGE. What this file pins:
 *
 *  1. The mixed-import case in all three of its outcomes — none / one / both of
 *     the imported names surviving. All-or-nothing is the wrong shape: 22 real
 *     files keep `DemoGrid` while losing `ComponentDemo`, so a rewriter that only
 *     knew "drop the line" or "keep the line" would be wrong 22 times.
 *  2. **The red control**: the ORIGINAL regex, verbatim, against the same
 *     fixture. It is what proves the spelling match — not something else — was
 *     the cause, and it is what would go green again if someone reverted the fix
 *     without noticing these tests.
 *  3. That a name mentioned only inside a code fence is NOT a use. Docs pages
 *     print component tags as sample code constantly; counting those would keep
 *     dead imports alive under a rule that reads as if it were checking usage.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The rewrite `main()` used before this fix — kept as the red control, verbatim. */
const ORIGINAL_IMPORT_SWAP =
  /import\s*\{\s*InteractiveDemo[^}]*\}\s*from\s*['"]@\/app\/components\/ComponentDemo['"];?/;

const originalRewrite = (mdx: string): string =>
  mdx.replace(ORIGINAL_IMPORT_SWAP, `import { SchemaExample } from '${DEMO_MODULE}';`);

/** An MDX page in the shape every file under `content/docs/` uses. */
const page = (importLine: string, body: string): string =>
  ['---', 'title: "Sheet"', '---', '', importLine, '', body, ''].join('\n');

/**
 * The card's specimen, post-migration: content already migrated to
 * `<SchemaExample>`, import still spelled the way the old regex could not see.
 * `content/docs/layout/page-header.mdx:6` was the live instance.
 */
const MIXED_IMPORT = `import { ComponentDemo, DemoGrid } from '${DEMO_MODULE}';`;

describe('rewriteDemoImports — the mixed-import case objectui#3788 is about', () => {
  it('drops the whole statement when the migrated file uses neither name', () => {
    const before = page(MIXED_IMPORT, '<SchemaExample id="layout/page-header" />');
    const after = rewriteDemoImports(before);

    expect(after).not.toContain(DEMO_MODULE);
    // The import took its own blank line with it, leaving the `---\n\n<body>`
    // shape an import-less page has.
    expect(after).toBe(['---', 'title: "Sheet"', '---', '', '<SchemaExample id="layout/page-header" />', ''].join('\n'));
  });

  it('keeps ONLY the name still used — the 22-file partial case, not all-or-nothing', () => {
    const before = page(MIXED_IMPORT, '<DemoGrid>\n<SchemaExample id="a/b" />\n</DemoGrid>');
    const after = rewriteDemoImports(before);

    expect(after).toContain(`import { DemoGrid } from '${DEMO_MODULE}';`);
    expect(after).not.toContain('ComponentDemo,');
    // `ComponentDemo` survives nowhere but the module specifier itself.
    expect(after.replace(DEMO_MODULE, '')).not.toContain('ComponentDemo');
  });

  it('leaves a statement whose every name is still used exactly as written', () => {
    const before = page(MIXED_IMPORT, '<ComponentDemo schema={{ type: "div" }} />\n\n<DemoGrid></DemoGrid>');
    expect(rewriteDemoImports(before)).toBe(before);
  });

  it('does not count the import statement itself as a use of what it imports', () => {
    // The trap a naive `mdx.includes('ComponentDemo')` falls into: the statement
    // names both bindings AND the module, so every import would look "used".
    const before = page(MIXED_IMPORT, 'Prose only.');
    expect(rewriteDemoImports(before)).not.toContain('import');
  });
});

describe('the original spelling-matched regex — the red that proves the cause', () => {
  it('leaves the stale import behind on the very fixture the fix prunes', () => {
    const before = page(MIXED_IMPORT, '<SchemaExample id="layout/page-header" />');

    // RED: the old rewrite cannot see this statement at all, so it survives the
    // migration verbatim — one dead import per migrated page, ~106 of them.
    expect(originalRewrite(before)).toContain(MIXED_IMPORT);
    expect(ORIGINAL_IMPORT_SWAP.test(before)).toBe(false);

    // GREEN: the usage-driven rewrite removes it.
    expect(rewriteDemoImports(before)).not.toContain(DEMO_MODULE);
  });

  it('handled only the one spelling it was anchored on', () => {
    const before = page(`import { InteractiveDemo } from '${DEMO_MODULE}';`, '<SchemaExample id="a/b" />');
    // The single case the old regex did cover — kept so the fix is shown to be a
    // widening, not a swap of one blind spot for another.
    expect(originalRewrite(before)).toContain(`import { SchemaExample } from '${DEMO_MODULE}';`);
    expect(rewriteDemoImports(before, { ensure: ['SchemaExample'] })).toContain(
      `import { SchemaExample } from '${DEMO_MODULE}';`,
    );
  });
});

describe('rewriteDemoImports — `ensure`', () => {
  it('adds a name the migrated body uses but no statement declares', () => {
    // What `main()` passes: the migration has just inserted `<SchemaExample>`
    // tags, so the import must gain the binding the old regex used to swap in.
    const before = page(MIXED_IMPORT, '<SchemaExample id="a/b" />');
    expect(rewriteDemoImports(before, { ensure: ['SchemaExample'] })).toContain(
      `import { SchemaExample } from '${DEMO_MODULE}';`,
    );
  });

  it('never adds an unused name — that would be objectui#3788 in a new spelling', () => {
    const before = page(MIXED_IMPORT, 'Prose only, no demo blocks were migrated.');
    expect(rewriteDemoImports(before, { ensure: ['SchemaExample'] })).not.toContain('import');
  });
});

describe('rewriteDemoImports — usage detection', () => {
  it('does not treat a tag printed inside a code fence as a use', () => {
    const before = page(
      `import { ComponentDemo } from '${DEMO_MODULE}';`,
      ['```plaintext', '<ComponentDemo schema={{ type: "div" }} />', '```'].join('\n'),
    );
    expect(rewriteDemoImports(before)).not.toContain(DEMO_MODULE);
  });

  it('does not treat an inline code span as a use', () => {
    const before = page(`import { DemoGrid } from '${DEMO_MODULE}';`, 'Wrap them in `<DemoGrid>` to lay them out.');
    expect(rewriteDemoImports(before)).not.toContain(DEMO_MODULE);
  });

  it('reads the LOCAL name of a renamed specifier, not the imported one', () => {
    const before = page(`import { InteractiveDemo as Demo } from '${DEMO_MODULE}';`, '<Demo />');
    expect(rewriteDemoImports(before)).toContain(`import { InteractiveDemo as Demo } from '${DEMO_MODULE}';`);

    const dead = page(`import { InteractiveDemo as Demo } from '${DEMO_MODULE}';`, '<InteractiveDemo />');
    expect(rewriteDemoImports(dead)).not.toContain(DEMO_MODULE);
  });

  it('matches whole tag names only', () => {
    const before = page(`import { DemoGrid } from '${DEMO_MODULE}';`, '<DemoGridder />');
    expect(rewriteDemoImports(before)).not.toContain(DEMO_MODULE);
  });

  it('collapses several statements from the module into the surviving one', () => {
    const before = [
      '---',
      '---',
      '',
      `import { ComponentDemo } from '${DEMO_MODULE}';`,
      '',
      `import { DemoGrid } from '${DEMO_MODULE}';`,
      '',
      '<DemoGrid />',
      '',
    ].join('\n');
    const after = rewriteDemoImports(before);
    expect(findDemoImports(after)).toHaveLength(1);
    expect(after).toContain(`import { DemoGrid } from '${DEMO_MODULE}';`);
  });

  it('is a no-op on a file that never imported the module', () => {
    const before = ['---', '---', '', '<SchemaExample id="a/b" />', ''].join('\n');
    expect(rewriteDemoImports(before)).toBe(before);
  });
});

describe('findDemoImports / stripCode', () => {
  it('reports each specifier with its imported and local name', () => {
    const [found] = findDemoImports(page(`import { InteractiveDemo as Demo, DemoGrid } from '${DEMO_MODULE}';`, 'x'));
    expect(found.specifiers).toEqual([
      { imported: 'InteractiveDemo', local: 'Demo', source: 'InteractiveDemo as Demo' },
      { imported: 'DemoGrid', local: 'DemoGrid', source: 'DemoGrid' },
    ]);
  });

  it('blanks fenced blocks and inline spans, and leaves real JSX alone', () => {
    const stripped: string = stripCode(['<Live />', '', '```tsx', '<Fenced />', '```', '', 'and `<Spanned />`'].join('\n'));
    expect(stripped).toContain('<Live />');
    expect(stripped).not.toContain('<Fenced />');
    expect(stripped).not.toContain('<Spanned />');
  });
});

/**
 * The ratchet for the cleanup half.
 *
 * Deliberately an INDEPENDENT scan rather than a call to `rewriteDemoImports`:
 * the cleanup commit was produced by that function, so re-running it here would
 * only assert it agrees with its own output. This walks the tree and re-derives
 * the verdict, which is what makes it able to disagree — and it catches a dead
 * import that arrives by hand as well as one minted by the script.
 *
 * Both implementations were run against `origin/main` @ `0af9826ab` before the
 * cleanup and returned the same partition: 84 statements fully dead, 22 with one
 * of two names dead, 11 already clean.
 */
describe('content/docs carries no dead demo import — the cleanup half of objectui#3788', () => {
  const docsDir = path.join(repoRoot, 'content/docs');

  const mdxFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) mdxFiles(full, out);
      else if (entry.name.endsWith('.mdx')) out.push(full);
    }
    return out;
  };

  const IMPORT_LINE = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*['"]@\/app\/components\/ComponentDemo['"]\s*;?[ \t]*$/gm;

  it('scans a non-trivial number of pages, so a green cannot mean "found nothing"', () => {
    expect(mdxFiles(docsDir).length).toBeGreaterThan(100);
  });

  it('every named import from the demo module is rendered somewhere on its page', () => {
    const dead: string[] = [];
    for (const file of mdxFiles(docsDir)) {
      const source = fs.readFileSync(file, 'utf8');
      IMPORT_LINE.lastIndex = 0;
      const statements = [...source.matchAll(IMPORT_LINE)];
      if (statements.length === 0) continue;

      // Judge against the body: strip the import statements, then fenced blocks
      // and inline code spans (a printed sample tag is documentation, not a use).
      const body = source
        .replace(IMPORT_LINE, '')
        .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[^\n]*$/gm, '')
        .replace(/`[^`\n]*`/g, '');

      for (const statement of statements) {
        for (const raw of statement[1].split(',')) {
          const specifier = raw.trim();
          if (!specifier) continue;
          const local = specifier.includes(' as ') ? specifier.split(/\s+as\s+/)[1].trim() : specifier;
          if (!new RegExp(String.raw`<\/?${local}\b`).test(body)) {
            dead.push(`${path.relative(repoRoot, file)}: ${local}`);
          }
        }
      }
    }
    expect(dead).toEqual([]);
  });
});
