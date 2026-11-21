/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useHref, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ChevronDown, ChevronRight, FileQuestion, Layers, Loader2, Menu } from 'lucide-react';
import { matchAppBySegment, useAdapter, useMetadata, useServedAppLabel } from '@object-ui/app-shell';
import { MarkdownRenderer, MermaidEnlargeContext, extractToc } from '@object-ui/plugin-markdown';
import { useObjectTranslation } from '@object-ui/i18n';
import { rewriteDocLinks } from './doc-links';
import { conflictCandidates, readsByNameAfter } from './doc-address';
import { DocShell } from './DocShell';
import { DocsNav, type DocsNavBook } from './DocsNav';
import { DocRefusal } from './BookPage';
import { useBookData } from './use-book-data';
import { useActiveHeading } from './useActiveHeading';
import { articleNeighbours, type BookArticle } from './docs-reading';
import { resolveBookTree, bookSlug, bookNamedBy, homeBook, labelUncategorized, pkgOfBook, type ResolvedBook } from './book-nav';

interface DocItem {
  name: string;
  label?: string;
  content: string;
}

/** Scroll the heading `id` names into view, the way an in-page anchor click does; false when it is not mounted. */
function scrollHeadingIntoView(id: string): boolean {
  const target = document.getElementById(id);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return target !== null;
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
 *
 * A name two or more enabled packages ship is refused by a read that names no
 * package, `409 RESOURCE_CONFLICT` with the holders as candidates (ADR-0150
 * D3). Nothing picks one: the page lists the candidates, each opening that
 * package's copy at its package address `/apps/<packageId>/docs/<name>`, where
 * the read names the package.
 */
export default function DocPage() {
  // Route is `/docs/:slug/:name` (`:slug` = book, `:name` = doc). `appName` is
  // the parent route's package-id segment under `/apps/:appName/docs/:slug/:name`.
  const { slug, name, appName } = useParams<{ slug?: string; name: string; appName?: string }>();
  const navigate = useNavigate();
  // The section the URL names (`…#section`), whether typed, followed from a
  // cross-reference, or carried through a redirect (DocsSlug, the book-name
  // redirect below).
  const { hash } = useLocation();
  const articleRef = useRef<HTMLElement>(null);
  // The docs route this page is read under: the app's own docs tree inside an
  // app (ADR-0048), else the portal. Body cross-references resolve under it, so
  // a link followed from an app's doc keeps the app shell (top bar, app nav),
  // the same answer the book sidebar gives; the flat `<base>/<name>` segment
  // redirects to the doc's in-book URL under that same base (DocsSlug).
  const base = appName ? `/apps/${appName}/docs` : '/docs';
  // That route's href, router basename included (objectui#12686): the
  // rewritten cross-references carry it so a new tab or a copied link reaches
  // the doc. `navigate` takes the bare router path and applies the basename.
  const docsHref = useHref(base);
  const adapter = useAdapter();
  const { t } = useObjectTranslation();
  const [doc, setDoc] = useState<DocItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'refused' | 'conflict' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [candidates, setCandidates] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!name || !adapter) return;
      setState('loading');
      try {
        // ADR-0048 — pass the route's package so the single-doc fetch is
        // package-scoped (prefer-local) on the server. With this, doc names
        // need not be globally namespace-prefixed; the prefix becomes optional.
        //
        // An exact package address answers only that package's own doc
        // (ADR-0150 D3/D5): where the route's package ships none of the name,
        // a `409` whose candidates name the packages that do, the route's not
        // among them (ruling 6917064203 on objectstack#34398), or `404` when
        // none does. The route's segment is prefer-local context, never an
        // exact address, so either answer falls back to the read by name, as
        // the portal reads it: a cross-reference to another package's doc, and
        // the app-name segment of a package that ships several apps (no
        // package id at all), read the one holder, or list the holders below.
        const client = adapter.getClient();
        let raw: any;
        try {
          raw = await client.meta.getItem('doc', name, appName ? { packageId: appName } : undefined);
        } catch (localErr) {
          if (!appName || !readsByNameAfter(localErr, appName)) throw localErr;
          raw = await client.meta.getItem('doc', name);
        }
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
        // Two or more packages ship this name and the read named none of
        // them: the server names the holders, and the reader picks one.
        const holders = conflictCandidates(err);
        if (holders) {
          setCandidates(holders);
          setState('conflict');
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
    scrollHeadingIntoView(id);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
  }, []);

  // Landing on a URL that names a section scrolls to it once the doc renders.
  // The body mounts after the doc loads and behind the markdown renderer's lazy
  // boundary, so the heading may not exist yet: watch the article until it does.
  // A new `:slug` is a new landing (the book-name redirect below keeps this page
  // mounted and the doc loaded, but draws a new article).
  useEffect(() => {
    if (state !== 'ready' || doc?.name !== name || !hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return; // a malformed escape names no heading
    }
    if (!id || scrollHeadingIntoView(id)) return;
    const article = articleRef.current;
    if (!article) return;
    const observer = new MutationObserver(() => {
      if (scrollHeadingIntoView(id)) observer.disconnect();
    });
    observer.observe(article, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [state, doc, name, slug, hash]);

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
        navigate(`${base}${href.slice(docsHref.length)}`);
      } else if (href.startsWith('#')) {
        e.preventDefault();
        scrollToHeading(decodeURIComponent(href.slice(1)));
      }
    },
    [base, docsHref, navigate, scrollToHeading],
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
  const { books, authoredBooks, docs: allDocs } = useBookData();
  // The synthetic catch-all group is titled in the session language, by its key.
  const uncategorizedLabel = t('help.uncategorized', { defaultValue: 'Uncategorized' });
  const resolvedBook = useMemo<ResolvedBook | null>(() => {
    const book = books.find((b) => bookSlug(b) === slug);
    // Every authored book judges the Uncategorized group, so a doc a sibling
    // book places is not listed there (objectstack#27091).
    return book
      ? labelUncategorized(resolveBookTree(book, allDocs, undefined, authoredBooks), uncategorizedLabel)
      : null;
  }, [books, authoredBooks, allDocs, slug, uncategorizedLabel]);
  const docHref = useCallback((docName: string) => `${base}/${slug}/${docName}`, [base, slug]);
  // objectstack#35424 — the docs column lists every book of the package the
  // reader is in: the current book's package, else the route's app package.
  const packageBooks = useMemo<DocsNavBook[]>(() => {
    const current = books.find((b) => bookSlug(b) === slug);
    const pkg = current ? pkgOfBook(current) : appName;
    if (!pkg) return [];
    return books
      .filter((b) => pkgOfBook(b) === pkg)
      .map((b) => ({
        slug: bookSlug(b),
        book: labelUncategorized(resolveBookTree(b, allDocs, undefined, authoredBooks), uncategorizedLabel),
      }));
  }, [books, authoredBooks, allDocs, slug, appName, uncategorizedLabel]);
  const neighbours = useMemo(
    () => (resolvedBook ? articleNeighbours(resolvedBook, name) : { previous: null, next: null }),
    [resolvedBook, name],
  );
  const bookDocHref = useCallback((bookSegment: string, docName: string) => `${base}/${bookSegment}/${docName}`, [base]);
  // The app the reader returns to: the one the route's segment addresses, by
  // the label the app bar shows.
  const { apps } = useMetadata();
  const { appLabel } = useServedAppLabel();
  const backTo = useMemo(() => {
    if (!appName) return undefined;
    const app = matchAppBySegment(apps as any[] | undefined, appName);
    return { to: `/apps/${appName}`, label: app ? appLabel(app) : appName };
  }, [apps, appName, appLabel]);
  const tocIds = useMemo(() => toc.map((item) => item.id), [toc]);
  const activeHeading = useActiveHeading(state === 'ready' ? tocIds : []);
  const enlargeText = useMemo(
    () => ({
      enlarge: t('help.enlargeDiagram', { defaultValue: 'Enlarge' }),
      title: t('help.diagram', { defaultValue: 'Diagram' }),
    }),
    [t],
  );
  // A `:slug` segment that is a book's NAME rather than its slug — what a
  // `{ type: 'doc', book, doc }` navigation entry links to (objectui#11197) — is
  // redirected to the canonical `bookSlug` URL, so the page reads in that book's
  // context. Only a segment NO book answers by slug is consulted, so every
  // reader URL that finds its book today keeps its answer.
  const namedBook = useMemo(() => (slug && !resolvedBook ? bookNamedBy(slug, books) : null), [slug, resolvedBook, books]);

  if (namedBook && name) {
    return <Navigate to={{ pathname: `${base}/${bookSlug(namedBook)}/${name}`, hash }} replace />;
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

  if (state === 'conflict') {
    return (
      <DocShell breadcrumb={name}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
          <Layers className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {t('help.docConflictTitle', { defaultValue: 'Choose a package' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('help.docConflictDescription', {
              defaultValue: 'More than one installed package provides a document named {{name}}. Open the one you want to read.',
              name,
            })}
          </p>
          <ul
            aria-label={t('help.docConflictCandidates', { defaultValue: 'Packages that provide this document' })}
            className="mt-2 flex w-full max-w-md flex-col gap-2 text-left"
          >
            {candidates.map((packageId) => {
              // The package as the portal names it: its home book for this doc.
              const label = (name ? homeBook(name, books, allDocs, packageId)?.label : undefined) ?? packageId;
              return (
                <li key={packageId}>
                  <Link
                    to={{ pathname: `/apps/${packageId}/docs/${name}`, hash }}
                    className="flex flex-col rounded-md border px-4 py-3 hover:bg-muted/50"
                  >
                    <span className="text-sm font-medium">{label}</span>
                    {label !== packageId ? (
                      <span className="text-xs text-muted-foreground">{packageId}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </DocShell>
    );
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

  const docsNav =
    packageBooks.length > 0 ? (
      <DocsNav
        books={packageBooks}
        currentSlug={slug}
        activeDoc={name}
        docHref={bookDocHref}
        backTo={backTo}
        allDocsHref="/docs"
      />
    ) : null;
  const docsLabel = t('help.documentation', { defaultValue: 'Documentation' });

  return (
    <DocShell breadcrumb={doc?.label ?? name}>
      {/* objectstack#35424 — the docs column is the page's one navigation.
        * Inside an app it sits where the app menu would, full height beside
        * the article; on narrow screens it folds into a disclosure above it. */}
      <div className="flex min-h-full" data-testid="doc-reader">
        {docsNav ? (
          <aside className="hidden w-72 shrink-0 border-r lg:block">
            <nav
              aria-label={t('help.docsNavigation', { defaultValue: 'Documentation navigation' })}
              className={`sticky overflow-auto px-4 py-6 ${appName ? 'top-0 max-h-[calc(100svh-3rem)]' : 'top-12 max-h-[calc(100svh-3rem)]'}`}
            >
              {docsNav}
            </nav>
          </aside>
        ) : null}
        <div className="min-w-0 flex-1">
          {docsNav ? (
            <details className="group mx-4 mt-4 sm:mx-6 lg:hidden">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <Menu className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{resolvedBook?.label ?? docsLabel}</span>
                <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 rounded-md border p-3">{docsNav}</div>
            </details>
          ) : null}
          <div className="mx-auto flex max-w-[1080px] justify-center gap-10 px-4 py-6 sm:px-8 lg:py-8">
            <div className="min-w-0 max-w-[720px] flex-1">
              <nav
                aria-label={t('help.docsBreadcrumb', { defaultValue: 'Documentation path' })}
                className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
                data-testid="doc-breadcrumb"
              >
                <Link to={base} className="hover:text-foreground">
                  {docsLabel}
                </Link>
                {resolvedBook ? (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <Link to={`${base}/${slug}`} className="hover:text-foreground">
                      {resolvedBook.label ?? resolvedBook.name}
                    </Link>
                  </>
                ) : null}
              </nav>
              <article
                ref={articleRef}
                className="[&_h1]:scroll-mt-24 [&_h2]:scroll-mt-24 [&_h3]:scroll-mt-24"
                onClick={onContentClick}
              >
                <MermaidEnlargeContext.Provider value={enlargeText}>
                  <MarkdownRenderer
                    schema={{
                      type: 'markdown',
                      className: '!text-[15px]',
                      content: rewriteDocLinks(doc?.content ?? '', docsHref),
                    }}
                  />
                </MermaidEnlargeContext.Provider>
              </article>
              {resolvedBook ? (
                <ArticlePager
                  previous={neighbours.previous}
                  next={neighbours.next}
                  href={(article) => docHref(article.doc)}
                />
              ) : null}
            </div>
            {toc.length >= 3 ? (
              <aside className="hidden w-56 shrink-0 xl:block">
                <nav aria-label={tocLabel} className="sticky top-6 max-h-[calc(100svh-6rem)] overflow-auto">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {tocLabel}
                  </div>
                  <ul className="border-l border-border text-sm">
                    {toc.map((item) => {
                      const current = item.id === activeHeading;
                      return (
                        <li key={item.id} style={{ paddingLeft: (item.depth - 2) * 12 }}>
                          <a
                            href={`#${item.id}`}
                            onClick={(e) => onTocClick(e, item.id)}
                            aria-current={current ? 'location' : undefined}
                            className={`-ml-px block border-l-2 py-1 pl-3 ${
                              current
                                ? 'border-primary font-medium text-primary'
                                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                            }`}
                          >
                            {item.text}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </DocShell>
  );
}

/**
 * The previous and next article of the book, at the article's end
 * (objectstack#35424). At either end of the book the empty side says so
 * instead of disappearing, so the two cards keep their places.
 */
function ArticlePager({
  previous,
  next,
  href,
}: {
  previous: BookArticle | null;
  next: BookArticle | null;
  href: (article: BookArticle) => string;
}) {
  const { t } = useObjectTranslation();
  const card = 'flex min-h-[4.5rem] flex-col justify-center gap-1 rounded-lg border px-4 py-3';
  return (
    <nav
      aria-label={t('help.articlePager', { defaultValue: 'Previous and next article' })}
      className="mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2"
      data-testid="doc-pager"
    >
      {previous ? (
        <Link to={href(previous)} rel="prev" className={`${card} hover:bg-muted/50`} data-testid="doc-pager-previous">
          <span className="text-xs text-muted-foreground">{t('help.previousArticle', { defaultValue: 'Previous' })}</span>
          <span className="font-medium text-primary">← {previous.label}</span>
        </Link>
      ) : (
        <div className={`${card} text-muted-foreground`} data-testid="doc-pager-first">
          <span className="text-xs">{t('help.previousArticle', { defaultValue: 'Previous' })}</span>
          <span className="text-sm">{t('help.firstInBook', { defaultValue: 'This is the first article in this book' })}</span>
        </div>
      )}
      {next ? (
        <Link to={href(next)} rel="next" className={`${card} items-end text-right hover:bg-muted/50`} data-testid="doc-pager-next">
          <span className="text-xs text-muted-foreground">{t('help.nextArticle', { defaultValue: 'Next' })}</span>
          <span className="font-medium text-primary">{next.label} →</span>
        </Link>
      ) : (
        <div className={`${card} items-end text-right text-muted-foreground`} data-testid="doc-pager-last">
          <span className="text-xs">{t('help.nextArticle', { defaultValue: 'Next' })}</span>
          <span className="text-sm">{t('help.lastInBook', { defaultValue: 'This is the last article in this book' })}</span>
        </div>
      )}
    </nav>
  );
}
