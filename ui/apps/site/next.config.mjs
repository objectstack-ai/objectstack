import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Do not let `next dev` mint AGENTS.md / CLAUDE.md in this directory
  // (objectui#4160). From next 16.3 the dev server detects an AI coding agent
  // from the environment and writes both files here
  // (node_modules/next/dist/server/lib/generate-agent-files.js), carrying a
  // managed block whose own text asks the reader to commit it. This repo's
  // AGENTS.md / CLAUDE.md are hand-written and binding, and this app's
  // CLAUDE.md would be a bare `@AGENTS.md` import splicing framework prose into
  // that authority chain — so we opt out here and additionally gitignore both
  // paths, since `agentRules` is upstream-owned and a later next release can
  // rename or drop it. Both halves are pinned by
  // `scripts/__tests__/site-next-agent-files-4160.test.ts`.
  agentRules: false,
  // Every entry MUST be a declared dependency of this app (pinned by
  // `scripts/__tests__/site-playground-layout-registration-3904.test.ts`).
  // Next resolves each name as `<pkg>/package.json` FROM THIS APP'S DIRECTORY to
  // decide what to bundle instead of externalize; under pnpm's strict linker an
  // undeclared package is simply unresolvable here, so the entry silently does
  // nothing. `@object-ui/i18n` and `@object-ui/plugin-aggrid` sat here in exactly
  // that state (objectui#3904) — and that is how `@object-ui/layout` looked
  // supported while `page-header` rendered a red OBJUI-001 panel until #3787
  // added the real dependency. A dead entry here is worse than a missing one: it
  // reads as "already wired up".
  transpilePackages: [
    '@object-ui/core',
    '@object-ui/components',
    '@object-ui/fields',
    '@object-ui/layout',
    '@object-ui/react',
    '@object-ui/types',
    '@object-ui/plugin-calendar',
    '@object-ui/plugin-charts',
    '@object-ui/plugin-chatbot',
    '@object-ui/plugin-dashboard',
    '@object-ui/plugin-editor',
    '@object-ui/plugin-form',
    '@object-ui/plugin-gantt',
    '@object-ui/plugin-grid',
    '@object-ui/plugin-kanban',
    '@object-ui/plugin-map',
    '@object-ui/plugin-markdown',
    '@object-ui/plugin-timeline',
    '@object-ui/plugin-view',
  ],
  async rewrites() {
    return [
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/docs/:path*',
      },
    ];
  },
};

export default withMDX(config);
