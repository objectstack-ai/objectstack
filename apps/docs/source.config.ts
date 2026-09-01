import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';
import path from 'node:path';
import { visit } from 'unist-util-visit';

/**
 * Rewrite ```mermaid code fences into <Mermaid chart="..."/> elements so
 * diagrams render as SVG (components/mermaid.tsx) instead of code blocks.
 */
function remarkMermaid() {
  return (tree: any) => {
    visit(tree, 'code', (node: any, index: number | undefined, parent: any) => {
      if (node.lang !== 'mermaid' || !parent || index === undefined) return;
      parent.children[index] = {
        type: 'mdxJsxFlowElement',
        name: 'Mermaid',
        attributes: [{ type: 'mdxJsxAttribute', name: 'chart', value: node.value }],
        children: [],
      };
    });
  };
}

/**
 * The docs page schema: `pageSchema` plus ONE key.
 *
 * `navTitle` is the short label a page shows in the sidebar / page tree, kept
 * apart from the `title` that the SERP `title`, the `h1`, the JSON-LD, the OG
 * card and `llms.txt` all read. It is optional and falls back to `title`; the
 * fallback is resolved in exactly one place, `apps/docs/lib/nav-title.ts`,
 * whose header is the mechanism's documentation.
 *
 * `fumadocs-core@16.14.4` ships no first-class equivalent -- its `pageSchema`
 * is `{ title, description, icon, full, _openapi }` and its page-tree builder
 * reads `{ title, description, icon }` off a page -- so the key is declared
 * here, in the same `pageSchema.extend(...)` shape `blogSchema` below uses.
 *
 * ⚠️ Adding a key here is not free: `scripts/check-doc-frontmatter.mjs` asserts
 * SET EQUALITY between this extension and its own docs key contract, so a key
 * added here and nowhere else reds that gate rather than arriving untyped.
 */
const docsSchema = pageSchema.extend({
  navTitle: z.string().optional(),
});

export const docs = defineDocs({
  dir: path.resolve(process.cwd(), '../../content/docs'),
  docs: {
    schema: docsSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

const blogSchema = pageSchema.extend({
  author: z.string().optional(),
  date: z.coerce.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const blog = defineDocs({
  dir: path.resolve(process.cwd(), '../../content/blog'),
  docs: {
    schema: blogSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (v) => [...v, remarkMermaid],
  },
});
