/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useHref, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ChevronDown, FileQuestion, Loader2, Menu } from 'lucide-react';
import { useAdapter } from '@object-ui/app-shell';
import { MarkdownRenderer, extractToc } from '@object-ui/plugin-markdown';
import { useObjectTranslation } from '@object-ui/i18n';
import { rewriteDocLinks } from './doc-links';
import { DocShell } from './DocShell';
import { BookSidebar } from './BookSidebar';
import { DocRefusal } from './BookPage';
import { useBookData } from './use-book-data';
import { resolveBookTree, bookSlug, bookNamedBy, type ResolvedBook } from './book-nav';

interface DocItem {
  name: string;
  label?: string;
  content: string;
}

/**
 * `/docs/:name` — render one package-doc metadata item (ADR-0046).
 *
 * Docs are inert `doc` metadata compiled from a package's flat
 * `src/docs/*.md`; this page fetches the item by name through the
 * standard metadata API and renders the sanitized Markdown body,
 * rewriting relative `[x](./other_doc.md)` references to the `/docs/<name>`
 * route's href, basename included (see doc-links.ts).
 *
 * Per the ADR, an unresolvable doc (bad URL, or a cross-package link
 * whose target was removed in a newer dependency version) degrades to a
 * "not found" notice — never an install-time or hard failure.
 *
 * A doc the member may not read is a different answer: the server refuses it
 * with 401 / 403 (ADR-0046 §6.7), and the page shows that refusal, with the
 * server's reason, rather than "not found" or a load failure (objectui#10188).
 */
export default function DocPage() {
  // Route is `/docs/:slug/:name` (`:slug` = book, `:name` = doc). `appName` is
  // the parent route's package-id segment under `/apps/:appName/docs/:slug/:name`.
  const { slug, name, appName } = useParams<{ slug?: string; name: string; appName?: string }>();
  const navigate = useNavigate();
  // The docs route's href, router basename included (objectui#12686): the
  // rewritten cross-references carry it so a new tab or a copied link reaches
  // the doc. `navigate` takes the bare router path and applies the basename.
  const docsHref = useHref('/docs');
  const adapter = useAdapter();
  const { t } = useObjectTranslation();
  const [doc, setDoc] = useState<DocItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'refused' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!name || !adapter) return;
      setState('loading');
      try {
        // ADR-0048 — pass the route's package so the single-doc fetch is
        // package-scoped (prefer-local) on the server. With this, doc names
        // need not be globally namespace-prefixed; the prefix becomes optional.
        const raw: any = await adapter.getClient().meta.getItem('doc', name, appName ? { packageId: appName } : undefined);
        const item = raw?.item ?? raw?.data ?? raw;
        if (cancelled) return;
        if (item && typeof item.content === 'string') {
          setDoc({ name, label: item.label, content: item.content });
          setState('ready');
        } else {
          setState('missing');
        }
      } catch (err: any) {
        if (cancelled) return;
        // `@objectstack/client` rejects a non-2xx read with the status in
        // `httpStatus`. 401 / 403 is the audience gate refusing this member
        // (objectui#10188) — a refusal, never "not found".
        const status = err?.httpStatus;
        if (status === 401 || status === 403) {
          setErrorMessage(err?.message ?? '');
          setState('refused');
          return;
        }
        // The metadata API answers 404 for unknown names — that is the
        // ADR-mandated soft-degrade path, not an error.
        if (status === 404 || /not found/i.test(err?.message ?? '')) {
          setState('missing');
        } else {
          setErrorMessage(err?.message ?? 'Failed to load documentation');
          setState('error');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [name, appName, adapter]);

  // Scroll a heading into view ourselves rather than letting the browser
  // follow a bare `#id` href. When the console is served under a sub-path the
  // host injects `<base href="…/_console/">` so relative asset URLs resolve; a
  // side effect is that fragment-only links resolve against that base instead
  // of the current page, so a plain `#id` click navigates to the console root
  // ("home") rather than scrolling. Reflect the section in the URL via an
  // absolute path that ignores <base>.
  const scrollToHeading = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
  }, []);

  // SPA navigation for rewritten doc-to-doc links: anchors render as plain
  // <a href="{docsHref}/...">; intercept same-app clicks so following a
  // cross-reference doesn't trigger a full page reload, handing the router the
  // path under `/docs` (it re-applies the basename itself). In-body fragment links
  // (`[x](#section)`) get the same JS-scroll treatment as the ToC so <base>
  // doesn't bounce them to home.
  const onContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const anchor = (e.target as HTMLElement).closest('a');
      const href = anchor?.getAttribute('href');
      if (!href) return;
      if (href.startsWith(`${docsHref}/`)) {
        e.preventDefault();
        navigate(`/docs${href.slice(docsHref.length)}`);
      } else if (href.startsWith('#')) {
        e.preventDefault();
        scrollToHeading(decodeURIComponent(href.slice(1)));
      }
    },
    [docsHref, navigate, scrollToHeading],
  );

  // ToC entries are bare `#id` anchors; scroll in JS for the same <base> reason.
  const onTocClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
      // Leave modified / non-primary clicks (new tab, etc.) to the browser.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      scrollToHeading(id);
    },
    [scrollToHeading],
  );

  // Long-doc table of contents (h2–h3). Slugs match rehype-slug so a #id
  // link resolves to the rendered heading's anchor. Shown only past a few
  // headings so short docs stay clean.
  const toc = useMemo(() => extractToc(doc?.content ?? ''), [doc?.content]);
  const tocLabel = t('help.onThisPage', { defaultValue: 'On this page' });

  // Book context (ADR-0046 §6): the `:slug` segment names the book we're
  // reading in, so its spine renders as a persistent left nav. Resolved from
  // the portal book set; degrades to no sidebar if the slug is unknown (e.g.
  // the backend serves no books yet).
  const { books, docs: allDocs } = useBookData();
  const base = appName ? `/apps/${appName}/docs` : '/docs';
  const resolvedBook = useMemo<ResolvedBook | null>(() => {
    const book = books.find((b) => bookSlug(b) === slug);
    return book ? resolveBookTree(book, allDocs) : null;
  }, [books, allDocs, slug]);
  const docHref = useCallback((docName: string) => `${base}/${slug}/${docName}`, [base, slug]);
  // A `:slug` segment that is a book's NAME rather than its slug — what a
  // `{ type: 'doc', book, doc }` navigation entry links to (objectui#11197) — is
  // redirected to the canonical `bookSlug` URL, so the page reads in that book's
  // context. Only a segment NO book answers by slug is consulted, so every
  // reader URL that finds its book today keeps its answer.
  const namedBook = useMemo(() => (slug && !resolvedBook ? bookNamedBy(slug, books) : null), [slug, resolvedBook, books]);

  if (namedBook && name) {
    return <Navigate to={`${base}/${bookSlug(namedBook)}/${name}`} replace />;
  }

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label={t('help.loadingDocumentation', { defaultValue: 'Loading documentation' })} />
      </div>
    );
  }

  if (state === 'missing') {
    return (
      <DocShell breadcrumb={name}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
          <FileQuestion className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Documentation not found</h1>
          <p className="text-sm text-muted-foreground">
            No document named <code className="rounded bg-muted px-1 py-0.5">{name}</code> is installed.
            It may belong to a package that is not installed, or it was removed in a newer version.
          </p>
        </div>
      </DocShell>
    );
  }

  if (state === 'refused') {
    return <DocRefusal name={name} message={errorMessage} />;
  }

  if (state === 'error') {
    return (
      <DocShell breadcrumb={name}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <h1 className="text-lg font-semibold">Failed to load documentation</h1>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
        </div>
      </DocShell>
    );
  }

  return (
    <DocShell breadcrumb={doc?.label ?? name}>
      {/* Narrow screens: the persistent left sidebar is hidden, so the book
        * nav collapses into a disclosure above the content instead of vanishing. */}
      {resolvedBook ? (
        <details className="group mx-auto max-w-6xl px-4 pt-4 sm:px-6 lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <Menu className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{resolvedBook.label ?? 'Contents'}</span>
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 rounded-md border p-3">
            <BookSidebar book={resolvedBook} activeDoc={name} docHref={docHref} />
          </div>
        </details>
      ) : null}
      <div className={`mx-auto flex gap-8 p-4 sm:p-6 ${resolvedBook ? 'max-w-6xl' : 'max-w-5xl'}`}>
        {resolvedBook ? (
          <aside className="hidden w-56 shrink-0 lg:block">
            <nav className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-auto pr-1">
              <BookSidebar book={resolvedBook} activeDoc={name} docHref={docHref} />
            </nav>
          </aside>
        ) : null}
        <article
          className="min-w-0 max-w-3xl flex-1 [&_h1]:scroll-mt-24 [&_h2]:scroll-mt-24 [&_h3]:scroll-mt-24"
          onClick={onContentClick}
        >
          <MarkdownRenderer
            schema={{ type: 'markdown', content: rewriteDocLinks(doc?.content ?? '', docsHref) }}
          />
        </article>
        {toc.length >= 3 ? (
          <aside className="hidden xl:block w-56 shrink-0">
            <nav aria-label={tocLabel} className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-auto">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tocLabel}
              </div>
              <ul className="border-l border-border text-sm">
                {toc.map((item) => (
                  <li key={item.id} style={{ paddingLeft: (item.depth - 2) * 12 }}>
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => onTocClick(e, item.id)}
                      className="-ml-px block border-l border-transparent py-0.5 pl-3 text-muted-foreground hover:border-primary hover:text-foreground"
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        ) : null}
      </div>
    </DocShell>
  );
}
