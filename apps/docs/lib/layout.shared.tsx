import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

export const gitConfig = {
  user: 'objectstack-ai',
  repo: 'spec',
  branch: 'main',
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2 font-bold">
          <Image
            src="https://objectstack.ai/logo.svg"
            alt="ObjectStack"
            width={30}
            height={30}
          />
          ObjectStack
        </div>
      ),
      transparentMode: 'top',
    },
    links: [
      {
        text: 'Documentation',
        url: '/docs/',
        active: 'nested-url',
      },
      {
        text: 'Website',
        url: 'https://www.objectstack.ai',
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
