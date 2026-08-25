import { createMDX } from 'fumadocs-mdx/next';
import { toNextRedirects } from './redirects.mjs';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // `next dev` otherwise writes `apps/docs/AGENTS.md` and `apps/docs/CLAUDE.md`
  // into the working tree whenever it detects an AI coding agent (Next 16
  // `ensureAgentRulesForDev`). Neither path is tracked or ignored, so both land
  // as `??` and any `git add -A` after booting the docs server sweeps them into
  // an unrelated PR. Those two filenames are load-bearing in this repo: the
  // root `AGENTS.md` is the binding playbook and agents are told to read the
  // `AGENTS.md` governing the files they touch, so a Next-authored stub
  // pointing at `node_modules/next/dist/docs/` can be read as this repo's
  // discipline -- and the generated text argues for committing itself, which
  // nudges an agent the wrong way. The generated `CLAUDE.md` is the single
  // line `@AGENTS.md`, an import directive that pulls the stub in.
  //
  // Disabled at the source rather than gitignored on purpose: an ignore rule
  // for `apps/docs/AGENTS.md` would silently swallow a future repo-authored
  // `AGENTS.md` for this app, failing invisibly at exactly the moment someone
  // was trying to add real guidance there. A visible untracked file is a better
  // failure than an invisibly ignored one for this filename specifically.
  //
  // This only stops future generation: a checkout that already ran `next dev`
  // keeps its copies until they are removed once by hand
  // (`rm -f apps/docs/AGENTS.md apps/docs/CLAUDE.md`).
  agentRules: false,
  // No `output: 'standalone'` here on purpose. The standalone packer
  // (`writeStandaloneDirectory` -> `copyTracedFiles`) opens
  // `.next/next-server.js.nft.json`, and that open is the ONLY thing in a
  // production build that reads it. Vercel builds this app via `vercel.json`'s
  // `pnpm turbo run build --filter=@objectstack/docs` -- that is turborepo, NOT
  // Turbopack. `next build` on Next 16 uses Turbopack in CI and on Vercel
  // alike; both print `Next.js 16.3.1 (Turbopack)`, so the bundler is not what
  // differs between them. The production build died there with ENOENT on that
  // file while the same cold build passes locally -- so the trace set is absent
  // under Vercel's builder specifically. Nothing in this repo consumes `.next/standalone`: no
  // Dockerfile, workflow, script or config references it, and `docker/Dockerfile`
  // does not build apps/docs at all. Vercel does its own serverless packaging,
  // so the setting bought nothing here and cost the whole deployment. If this
  // app ever gains a self-hosted Node target that needs the standalone bundle,
  // reintroduce it together with a builder that emits the trace set.
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
  async headers() {
    // The agent-reader surfaces below each serve the full text of documentation
    // pages as `text/markdown` / `text/plain`, at URLs a crawler can reach. They
    // are a deliberate feature -- this is how AI agents read these docs -- so
    // they keep answering 200 with their full body to anyone who asks. The only
    // thing added here is a directive telling *search engines* which copy is the
    // one worth indexing: the HTML page.
    //
    // `noindex` rather than `Link: <...>; rel="canonical"`, and the reasons are
    // not interchangeable:
    //
    //   1. Coverage. Only the per-page markdown has an HTML twin to point a
    //      canonical at. `/llms.txt` is an index of every page and
    //      `/llms-full.txt` is all 400+ of them concatenated (8 MB today); there
    //      is no single HTML URL either one is a duplicate *of*, so a canonical
    //      header cannot say anything honest about them and would leave the two
    //      largest parallel copies on the site undirected. `noindex` states the
    //      same intent for all four sources.
    //   2. A canonical link is a hint a search engine weighs against other
    //      signals and may overrule; `noindex` is a directive. What this card
    //      wants is the strong form -- keep the copy fetchable, keep it out of
    //      results.
    //
    // The two are also not additive: pairing `noindex` with a canonical pointing
    // elsewhere is contradictory (the target is asked to absorb the signal of a
    // page that has asked to be dropped), so exactly one of them belongs here.
    //
    // ⚠️ This works only while `robots.txt` still allows these paths to be
    // crawled -- a `Disallow` would stop the fetch that reveals the header and
    // leave the URLs eligible for URL-only indexing instead. `app/robots.ts`
    // names them under `Allow:` on purpose; the two files are one mechanism.
    //
    // Matching is on the *incoming* request path, before rewrites, which is why
    // `/docs/:path*.mdx` is spelled here as the client asks for it. Its rewrite
    // destination `/llms.mdx/docs/:path*` is a real route and answers directly
    // too (measured: `/llms.mdx/docs/data-modeling/objects` -> 200
    // `text/markdown`), so each page actually has two markdown URLs and both are
    // listed.
    const noindex = ['/docs/:path*.mdx', '/llms.mdx/:path*', '/llms.txt', '/llms-full.txt'];

    return noindex.map((source) => ({
      source,
      headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
    }));
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
