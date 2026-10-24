import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title:  (
       <div className="flex items-center gap-2 font-bold">
        <Image 
          src="/logo.svg" 
          alt="ObjectUI" 
          width={30} 
          height={30} 
        />
        ObjectUI
      </div>
    ),
    },
    githubUrl: 'https://github.com/objectstack-ai/objectui',
    links: [
      {
        text: 'Documentation',
        url: '/docs',
      },
    ],
  };
}
