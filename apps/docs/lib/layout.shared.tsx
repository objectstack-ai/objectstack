import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

// The repository was renamed `framework` → `objectstack`. GitHub keeps a permanent
// rename redirect, so the old name still resolves — but every URL built from it costs a
// 301, and `repo` is also the source of `SoftwareSourceCode.codeRepository` in the
// homepage JSON-LD, where it is a machine-readable identity claim rather than a link.
// Keep this the *current* name: a future repo actually named `framework` would silently
// repoint every link built here.
export const gitConfig = {
  user: 'objectstack-ai',
  repo: 'objectstack',
  branch: 'main',
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2 font-bold">
          {/* Served from public/ — the retired objectstack.ai marketing site no longer hosts assets. */}
          <img src="/logo.svg" alt="ObjectStack" width={30} height={30} />
          ObjectStack
        </div>
      ),
    },
    // Every layout spreads baseOptions() — DocsLayout (docs sidebar), and HomeLayout on
    // the home page and on /blog — so this one entry is the blog's link on all of them.
    links: [{ text: 'Blog', url: '/blog', active: 'nested-url' }],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
