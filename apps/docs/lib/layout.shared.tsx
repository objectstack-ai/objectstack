import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const gitConfig = {
  user: 'objectstack-ai',
  repo: 'framework',
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
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'Blog', url: '/blog', active: 'nested-url' },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
