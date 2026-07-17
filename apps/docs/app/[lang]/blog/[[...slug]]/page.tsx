import { notFound } from 'next/navigation';
import { blog } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// Extended type for blog post data
interface BlogPostData {
  title: string;
  description?: string;
  author?: string;
  date?: string;
  tags?: string[];
  body: React.ComponentType;
}

const components = getMDXComponents() as any;

export default async function BlogPage({
  params,
}: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const { slug } = await params;
  
  // If no slug, show blog index
  if (!slug || slug.length === 0) {
    // getPages() returns source order — newest first is the only order a blog
    // index should ever be in. Undated posts sort last rather than jumping.
    const posts = [...blog.getPages()].sort((a, b) => {
      const at = new Date((a.data as unknown as BlogPostData).date ?? 0).getTime();
      const bt = new Date((b.data as unknown as BlogPostData).date ?? 0).getTime();
      return bt - at;
    });

    return (
      <HomeLayout {...baseOptions()}>
        <main className="container max-w-5xl mx-auto px-4 py-16">
          <div className="mb-12">
            <h1 className="text-4xl font-bold mb-4">Blog</h1>
            <p className="text-lg text-fd-foreground/80">
              Insights, updates, and best practices from the ObjectStack team.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {posts.map((post) => {
              const postData = post.data as unknown as BlogPostData;
              return (
                <Link
                  key={post.url}
                  href={post.url}
                  className="group block rounded-lg border border-fd-border bg-fd-card p-6 transition-all hover:border-fd-primary/30 hover:shadow-md"
                >
                  <div className="mb-3">
                    <h2 className="text-2xl font-semibold mb-2 group-hover:text-fd-primary transition-colors">
                      {postData.title}
                    </h2>
                    {postData.description && (
                      <p className="text-fd-foreground/70">
                        {postData.description}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 text-sm text-fd-foreground/70">
                    {postData.date && (
                      <time dateTime={postData.date}>
                        {new Date(postData.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </time>
                    )}
                    {postData.author && (
                      <span>By {postData.author}</span>
                    )}
                  </div>

                  {postData.tags && postData.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {postData.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-fd-primary/10 px-2.5 py-0.5 text-xs font-medium text-fd-primary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {posts.length === 0 && (
            <div className="text-center py-12">
              <p className="text-fd-foreground/70">No blog posts yet. Check back soon!</p>
            </div>
          )}
        </main>
      </HomeLayout>
    );
  }

  // Show individual blog post
  const page = blog.getPage(slug);
  
  if (!page) {
    notFound();
  }

  const pageData = page.data as unknown as BlogPostData;
  const MDX = page.data.body;

  return (
    <HomeLayout {...baseOptions()}>
      <main className="container max-w-4xl mx-auto px-4 py-16">
        <Link 
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-fd-foreground/70 hover:text-fd-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Blog
        </Link>

        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <header className="mb-8 pb-8 border-b border-fd-border">
            <h1 className="text-4xl font-bold mb-4">{pageData.title}</h1>
            
            {pageData.description && (
              <p className="text-xl text-fd-foreground/80 mb-6">
                {pageData.description}
              </p>
            )}

            <div className="flex items-center gap-4 text-sm text-fd-foreground/70">
              {pageData.date && (
                <time dateTime={pageData.date}>
                  {new Date(pageData.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
              )}
              {pageData.author && (
                <span>By {pageData.author}</span>
              )}
            </div>

            {pageData.tags && pageData.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {pageData.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-fd-primary/10 px-3 py-1 text-sm font-medium text-fd-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>

          <MDX components={components} />
        </article>
      </main>
    </HomeLayout>
  );
}

export async function generateStaticParams() {
  return blog.getPages().map((page) => ({
    slug: page.slugs,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  
  // If no slug, return default metadata for blog index
  if (!slug || slug.length === 0) {
    return {
      title: 'Blog',
      description: 'Insights, updates, and best practices from the ObjectStack team.',
    };
  }
  
  const page = blog.getPage(slug);

  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
