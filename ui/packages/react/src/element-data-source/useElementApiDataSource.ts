/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The renderer half of the spec's API binding of a page element (objectui#12197):
 * `PageComponentSchema.dataSource` as `ElementApiDataSourceSchema`,
 *
 * ```json
 * { "provider": "api", "read": { "url": "/api/v1/cloud/home" }, "path": "data" }
 * ```
 *
 * The spec states what a renderer does with it: the element reads ONE
 * same-origin endpoint with the console's signed-in fetch and binds the selected
 * value, "which the element reads as `data` in its expression holes and its
 * `visibleWhen`". `SchemaRenderer` is the one place both of those are evaluated,
 * so it calls {@link useElementApiDataSource} for every node and binds the
 * answer as the `data` root (see "The API binding" there). This module owns the
 * read itself.
 *
 * ## The binding is judged by the spec's own schema
 *
 * A node's `dataSource` reaches the renderer as stored metadata, unparsed. The
 * hook parses it with `ElementApiDataSourceSchema` before it reads anything,
 * so a binding the spec refuses — an absolute or protocol-relative `url`, a
 * credential key, a `method` other than `GET`, a malformed `path` — is
 * `refused` here with the spec's own message, and no request is sent. There is
 * no second, hand-kept same-origin rule in this repo to drift from the
 * contract's.
 *
 * A `dataSource` that is not an API binding (absent, or the object binding
 * `useElementDataSource` reads) is `absent` here: the two shapes are told apart
 * by `provider: 'api'`, the spec's discriminator.
 *
 * ## The read
 *
 * Through `SchemaRendererContext.apiFetch`, the host's authenticated fetch the
 * console hands every renderer (`ConsoleShell`), falling back to the global
 * fetch only when no host supplies one — the rule every `apiFetch` reader in
 * the tree follows. `GET`, `Accept: application/json`, `credentials: 'include'`.
 * A non-2xx answer, a body that is not JSON, or a `path` that selects nothing
 * is `error`, with a sentence naming which; the value is never guessed.
 *
 * Concurrent elements that bind the same URL share ONE request: {@link
 * readElementApi} keeps a pending request per URL and forgets it the moment it
 * settles (the shape `readStorageUsage` uses).
 *
 * ## One read per open (objectui#13323)
 *
 * A host that knows what "one open" of a page is mounts {@link
 * ElementApiOpenScope} around everything that reads a binding, naming the open
 * it is in. Inside it, a read that has already answered in the SAME open is
 * answered again from that answer, with no request: a navigation entry's
 * `visible` and a page element bound to the same URL make one request, even
 * when the entry's read settled before the element mounted (the case the
 * in-flight sharing misses). A failed read is not kept, so the next reader
 * asks again; and an answer read in another open is never handed out, so a new
 * open reads again. The scope changes no read's timing: a reader asks exactly
 * when it asked before, and only whether that ask reaches the network moves.
 * And a write ends the reuse: once anything declares a data change
 * (`notifyDataChanged`, the bus every action and save reports to), nothing
 * read before it is handed out again, so a read after an action asks the
 * server.
 *
 * Without a scope, nothing is kept beyond the request in flight, as before.
 *
 * ## Reading again after the page's own action
 *
 * A mounted reader asks once per binding. The bus above cannot ask it again:
 * an endpoint names no object, and the bus's unknown-scope change is declared
 * from every surface of the app, so a reader that read again on it would read
 * again on every unrelated write. The page that ran the action is the scope
 * that knows its own data changed. A host that runs a page's actions mounts
 * {@link ElementApiRereadScope} around the page with a signal from {@link
 * createElementApiReread}, and calls `reread()` after an action on that page
 * succeeds; every reader below reads again, and no reader outside it does.
 *
 *  - The answer on screen stays while the new read is in flight: the element
 *    never falls back to its loading state, and whatever it holds (a row's
 *    button in the middle of its own run) stays mounted.
 *  - The new answer replaces it in place; a failed read draws the binding's
 *    error face, never the answer from before the write.
 *  - A read asked after `reread()` never joins a request that was already in
 *    flight when it was called: that request may have been answered before the
 *    write landed. Readers that ask after it share one request, as before.
 *
 * Without a re-read scope a reader asks once per binding, as before.
 *
 * @module
 */

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ElementApiDataSourceSchema, type ElementApiDataSource } from '@objectstack/spec/ui';
import { SchemaRendererContext, type ApiFetch } from '../context/SchemaRendererContext.js';
import { isConfigBag } from '../utils/configBag.js';
import { subscribeDataChanges } from '../data-invalidation.js';

/**
 * Where an API binding stands.
 *
 *  - `absent` — the node carries no API binding; nothing is read.
 *  - `refused` — the node carries one the spec refuses; nothing is read.
 *  - `loading` — the read is in flight.
 *  - `ready` — the read answered and `path` selected a value.
 *  - `error` — the read failed, or `path` selected nothing.
 */
export type ElementApiDataSourceStatus = 'absent' | 'refused' | 'loading' | 'ready' | 'error';

export interface UseElementApiDataSourceResult {
  status: ElementApiDataSourceStatus;
  /** The parsed binding, for every status but `absent` and `refused`. */
  config?: ElementApiDataSource;
  /** The selected value, set only for `ready`. */
  data?: unknown;
  /** Author-facing explanation, set for `refused` and `error`. */
  error?: string;
}

/**
 * Is this `dataSource` value the API binding — whatever it says beyond
 * `provider`? `provider: 'api'` is the spec's discriminator between the two
 * shapes of `PageComponentSchema.dataSource`; the object binding carries no
 * `provider`.
 */
export function isElementApiDataSourceShape(value: unknown): boolean {
  return isConfigBag(value) && value.provider === 'api';
}

/**
 * Judge a node's `dataSource` as an API binding: `absent` when it is not one,
 * `refused` with the spec's message when the spec refuses it, otherwise the
 * parsed binding.
 */
export function judgeElementApiDataSource(
  value: unknown,
):
  | { status: 'absent' }
  | { status: 'refused'; error: string }
  | { status: 'parsed'; config: ElementApiDataSource } {
  if (!isElementApiDataSourceShape(value)) return { status: 'absent' };
  const parsed = ElementApiDataSourceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      status: 'refused',
      error: parsed.error.issues.map((issue) => issue.message).join(' '),
    };
  }
  return { status: 'parsed', config: parsed.data };
}

/**
 * Select `path` (dotted segments; a numeric segment indexes an array) from a
 * response body. `found: false` when any segment has nothing under it — an
 * absent key, not a key whose value is `undefined`, is what "selects nothing"
 * means.
 */
export function selectElementApiPath(
  body: unknown,
  path: string | undefined,
): { found: true; value: unknown } | { found: false; segment: string } {
  if (!path) return { found: true, value: body };
  let current: unknown = body;
  for (const segment of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index >= current.length) return { found: false, segment };
      current = current[index];
      continue;
    }
    if (!isConfigBag(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, segment };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

/** Pending reads, keyed by URL. An entry lives exactly as long as its request. */
const IN_FLIGHT = new Map<string, Promise<unknown>>();

/**
 * Bumped by every `reread()` of every {@link ElementApiReread}, before its
 * readers are told. A request asked in an earlier epoch is neither joined nor
 * handed out again from an open, because it may have been answered before the
 * write the re-read follows.
 */
let rereadEpoch = 0;

/** The epoch each request was asked in. */
const REQUEST_EPOCH = new WeakMap<Promise<unknown>, number>();

/** Was `read` asked after the latest re-read? */
function askedThisEpoch(read: Promise<unknown>): boolean {
  return REQUEST_EPOCH.get(read) === rereadEpoch;
}

/**
 * The open a read is asked in (objectui#13323): its name, and the reads asked
 * in it, by URL. {@link ElementApiOpenScope} provides it; {@link
 * readElementApi} takes it.
 */
export interface ElementApiOpen {
  /** Names the open. A read asked under another name is never reused. */
  readonly open: string;
  /**
   * The reads asked in the open, by URL, each with the name of the open it was
   * asked in. Owned by the scope; never shared across scopes.
   */
  readonly reads: Map<string, { open: string; read: Promise<unknown> }>;
}

const ElementApiOpenContext = createContext<ElementApiOpen | null>(null);

/**
 * Keep the API reads asked under `open` for as long as `open` names the page's
 * open: a reader below that asks for a URL the open has already read gets that
 * read's answer, with no request (see "One read per open" above). The host
 * decides what one open is; the console names it by history entry.
 */
export function ElementApiOpenScope({ open, children }: { open: string; children?: ReactNode }) {
  // The reads live as long as the scope does; `open` is what tells one open's
  // reads from the next one's.
  const [reads] = useState<ElementApiOpen['reads']>(() => new Map());
  // An endpoint names no object, so ANY declared change may have moved its
  // answer: every kept read is dropped, and the next reader asks again.
  useEffect(() => subscribeDataChanges(() => reads.clear()), [reads]);
  const value = useMemo<ElementApiOpen>(() => ({ open, reads }), [open, reads]);
  return createElement(ElementApiOpenContext.Provider, { value }, children);
}

/**
 * The open the reader is in, or `null` outside an {@link ElementApiOpenScope}.
 * Read its `open` and `reads` members, never its identity (AGENTS.md #10).
 */
export function useElementApiOpen(): ElementApiOpen | null {
  return useContext(ElementApiOpenContext);
}

/**
 * `GET url` through `doFetch`, resolving with the parsed JSON body. Rejects on
 * a network failure, a non-2xx answer or a body that is not JSON. Callers that
 * ask while a read of the same URL is pending share it.
 *
 * Given the `open` the caller is in, a read that open has already asked for
 * the URL is returned instead, settled or not, unless it failed
 * (objectui#13323).
 *
 * Neither is shared across a re-read: a read asked before the latest
 * `reread()` of any {@link ElementApiReread} is not joined and not handed out
 * again, so the caller reaches the network.
 */
export function readElementApi(url: string, doFetch: ApiFetch, open?: ElementApiOpen | null): Promise<unknown> {
  const kept = open?.reads.get(url);
  if (open && kept?.open === open.open && askedThisEpoch(kept.read)) return kept.read;
  const pending = IN_FLIGHT.get(url);
  const read = pending && askedThisEpoch(pending) ? pending : requestElementApi(url, doFetch);
  if (open) keepRead(open, url, read);
  return read;
}

/** Keep `read` as `open`'s read of `url`, dropping what an earlier open kept. */
function keepRead(open: ElementApiOpen, url: string, read: Promise<unknown>): void {
  for (const [keptUrl, kept] of open.reads) {
    if (kept.open !== open.open) open.reads.delete(keptUrl);
  }
  open.reads.set(url, { open: open.open, read });
  // A failed read is not an answer: the next reader in the open asks again.
  read.catch(() => {
    if (open.reads.get(url)?.read === read) open.reads.delete(url);
  });
}

function requestElementApi(url: string, doFetch: ApiFetch): Promise<unknown> {
  const request: Promise<unknown> = doFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
    .then(async (res): Promise<unknown> => {
      if (!res.ok) throw new Error(`GET ${url} answered ${res.status}.`);
      try {
        return await res.json();
      } catch {
        throw new Error(`GET ${url} did not answer JSON.`);
      }
    })
    .finally(() => {
      // A request from an earlier epoch may have been replaced by a newer one.
      if (IN_FLIGHT.get(url) === request) IN_FLIGHT.delete(url);
    });
  REQUEST_EPOCH.set(request, rereadEpoch);
  IN_FLIGHT.set(url, request);
  return request;
}

/**
 * A page's re-read signal: `reread()` asks every reader below the {@link
 * ElementApiRereadScope} that holds it to read again (see "Reading again after
 * the page's own action" above). Create one per page mount and keep it for
 * the page's life.
 */
export interface ElementApiReread {
  /** Ask every reader below the scope to read again. */
  reread(): void;
  /** How many re-reads were asked: the readers key their read on it. */
  generation(): number;
  /** Subscribe to `reread()`. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Create a page's re-read signal; see {@link ElementApiReread}. */
export function createElementApiReread(): ElementApiReread {
  let generation = 0;
  const listeners = new Set<() => void>();
  return {
    reread() {
      rereadEpoch += 1;
      generation += 1;
      for (const listener of Array.from(listeners)) listener();
    },
    generation: () => generation,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const ElementApiRereadContext = createContext<ElementApiReread | null>(null);

/**
 * Make the readers below read again whenever `reread` is asked to. The host
 * owns the signal and decides when its page's data changed.
 */
export function ElementApiRereadScope({ reread, children }: { reread: ElementApiReread; children?: ReactNode }) {
  return createElement(ElementApiRereadContext.Provider, { value: reread }, children);
}

const NO_REREAD_SUBSCRIBE = (): (() => void) => () => {};
const NO_REREAD_GENERATION = (): number => 0;

/**
 * Resolve a node's API binding: read its endpoint and select its `path`.
 *
 * Called unconditionally by `SchemaRenderer` for every node; a node without an
 * API binding costs one `isPlainObject` test and issues no request.
 */
export function useElementApiDataSource(schema: unknown): UseElementApiDataSourceResult {
  const context = useContext(SchemaRendererContext);
  const doFetch: ApiFetch = context?.apiFetch ?? fetch;
  const scope = useElementApiOpen();
  const open = scope?.open;
  const reads = scope?.reads;
  // The page's re-read signal: a new generation is a new read of the same
  // binding, with the answer it replaces kept on screen until it lands.
  const reread = useContext(ElementApiRereadContext);
  const generation = useSyncExternalStore(
    reread ? reread.subscribe : NO_REREAD_SUBSCRIBE,
    reread ? reread.generation : NO_REREAD_GENERATION,
    reread ? reread.generation : NO_REREAD_GENERATION,
  );
  const raw = isConfigBag(schema) ? schema.dataSource : undefined;
  // Keyed on the binding's CONTENT, never on its identity (AGENTS.md #10): a
  // re-render that hands over an equal binding is the same read.
  const bindingKey = isElementApiDataSourceShape(raw) ? JSON.stringify(raw) : '';
  const judged = useMemo(
    () => judgeElementApiDataSource(bindingKey ? JSON.parse(bindingKey) : undefined),
    [bindingKey],
  );
  const url = judged.status === 'parsed' ? judged.config.read.url : '';
  const path = judged.status === 'parsed' ? judged.config.path : undefined;
  const requestKey = url ? JSON.stringify([url, path ?? null]) : '';

  // The settled answer carries its own key instead of being cleared when the
  // binding changes, so the effect never sets state synchronously; an answer
  // whose key no longer matches reads as `loading` (useElementDataSource's rule).
  // The re-read generation is not part of the key: a re-read keeps the answer
  // it replaces on screen until its own answer lands.
  const [settled, setSettled] = useState<
    { key: string; ok: true; data: unknown } | { key: string; ok: false; error: string } | null
  >(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // The open this read is asked in (objectui#13323). A change of open does
    // not re-read on its own: the read is asked when the binding asks, as
    // before, and the open only decides whether that ask reaches the network.
    readElementApi(url, doFetch, reads && open !== undefined ? { open, reads } : null).then(
      (body) => {
        if (cancelled) return;
        const selected = selectElementApiPath(body, path);
        setSettled(
          selected.found
            ? { key: requestKey, ok: true, data: selected.value }
            : {
                key: requestKey,
                ok: false,
                error: `dataSource.path "${path}" selects nothing in the answer of GET ${url}: `
                  + `it has no "${selected.segment}".`,
              },
        );
      },
      (error: unknown) => {
        if (cancelled) return;
        setSettled({
          key: requestKey,
          ok: false,
          error: error instanceof Error ? error.message : `GET ${url} failed.`,
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // `open` is left out on purpose: see the comment on the read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, path, requestKey, doFetch, reads, generation]);

  if (judged.status === 'absent') return { status: 'absent' };
  if (judged.status === 'refused') return { status: 'refused', error: judged.error };
  if (settled?.key !== requestKey) return { status: 'loading', config: judged.config };
  if (!settled.ok) return { status: 'error', config: judged.config, error: settled.error };
  return { status: 'ready', config: judged.config, data: settled.data };
}
