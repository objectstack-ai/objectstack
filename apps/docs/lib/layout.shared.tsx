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

/** The essay's route: the nav's `Why` entry, and the home page's hero link and section 00. */
export const ESSAY_URL = '/blog/the-ontology-is-the-software';

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
    // the home page and on /blog — so these entries are the nav's links on all of them.
    // `active` is matched against the PUBLIC pathname (`/blog/x`, never the `/en/blog/x`
    // a post is prerendered under) — `components/root-provider.tsx` supplies it.
    links: [
      { text: 'Why', url: ESSAY_URL, active: 'url' },
      { text: 'Blog', url: '/blog', active: 'nested-url' },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
