import { createMDX } from 'fumadocs-mdx/next';
import { toNextRedirects } from './redirects.mjs';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: false,
  },
  turbopack: {
    resolveAlias: {
      // MDX content lives in ../../content/docs/ (outside the app directory).
      // Turbopack resolves modules starting from the file's directory, so it
      // can't find packages installed under this app's node_modules/.
      // Alias lucide-react so external MDX files can import it.
      'lucide-react': './node_modules/lucide-react',
    },
  },
  async redirects() {
    return toNextRedirects();
  },
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
