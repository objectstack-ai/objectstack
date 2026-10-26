import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from 'fumadocs-mdx/config';

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: '../../content/docs',
  docs: {
    schema: frontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // `remark-image` probes every image at build time to inline width/height.
    // For remote images (e.g. shields.io / skills.sh badges) that is a
    // build-time network fetch, which turns an external service's availability
    // into a hard build dependency: a shields.io hiccup (Cloudflare 520 / 1200
    // "Too many requests") would otherwise fail the entire docs build. Make the
    // build resilient to remote-image outages. See objectui#2695.
    remarkImageOptions: {
      // Bound each remote fetch so a hung connection can't stall CI.
      external: { timeout: 10_000 },
      // Warn (don't fail the build) when a remote image can't be sized, but keep
      // strict behaviour for local/authored images so broken in-repo paths are
      // still caught. Note: in the Next.js bundler pipeline local images resolve
      // via `import` and never reach here — this guard only matters if that ever
      // changes, at which point local failures must still be fatal.
      onError: (error) => {
        if (/https?:\/\//.test(error.message)) {
          console.warn(`[remark-image] skipped remote image (build continues): ${error.message}`);
          return;
        }
        throw error;
      },
    },
  },
});
