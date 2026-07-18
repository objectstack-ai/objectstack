import { createMDX } from 'fumadocs-mdx/next';
import { toNextRedirects } from './redirects.mjs';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    // The docs site prerenders 400+ MDX pages. Next spawns one static-generation
    // worker per CPU, and on Vercel's high-core build container that fan-out
    // multiplied the resident set until the build was OOM-killed (exit 137).
    // Cap the worker count so peak memory stays well under the container limit.
    cpus: 2,
  },
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
