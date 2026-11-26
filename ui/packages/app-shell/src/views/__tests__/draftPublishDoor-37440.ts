// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37440 — a stateful double of the `/meta` item doors a
 * draft-then-publish caller goes through, holding one draft row and one live
 * row per address (type, name, package), with the two ADR-0008 pins of the
 * per-item publish as the real door judges them
 * (`PublishMetaItemRequestSchema`, measured on the real door in
 * `packages/client/src/meta-publish-item-package.test.ts`):
 *
 *  - a draft save answers its receipt `version`; `If-None-Match: *` over a
 *    pending draft, and an `If-Match` that is not the draft's version, are
 *    refused `409 METADATA_CONFLICT`;
 *  - the publish judges `draftVersion` FIRST (against the draft row), then
 *    `If-Match` / `If-None-Match: *` (against the live row), each refused
 *    `409 METADATA_CONFLICT` with `currentVersion`; with no pin, whichever
 *    draft is pending goes live — the window the card closes;
 *  - a draft discard (`reset` with `state: 'draft'`) pinned `If-Match` removes
 *    that draft only, and is refused `409` when the draft moved;
 *  - the draft read answers the envelope with its `version`, `null` when none.
 *
 * `interleave` runs ANOTHER writer's draft write right before the next
 * publish reaches the door: the race the pins are for.
 */

import type { MetadataClient } from '@object-ui/data-objectstack';

type Options = Record<string, unknown>;

interface Row {
  body: unknown;
  version: string;
}

export interface DraftPublishDoor {
  client: {
    save: (type: string, name: string, body: unknown, options?: Options) => Promise<unknown>;
    publish: (type: string, name: string, options?: Options) => Promise<unknown>;
    reset: (type: string, name: string, options?: Options) => Promise<unknown>;
    getDraft: (type: string, name: string, options?: Options) => Promise<unknown>;
  };
  /** The same doors, typed as the console's client for callers that take one. */
  metadataClient: Pick<MetadataClient, 'save' | 'publish' | 'reset' | 'getDraft'>;
  /** The pending draft body at the address, or `undefined`. */
  draftOf: (type: string, name: string, packageId?: string | null) => unknown;
  /** The live body at the address, or `undefined`. */
  liveOf: (type: string, name: string, packageId?: string | null) => unknown;
  /** Store a live row at the address (the state before the Save), answering its version. */
  seedLive: (type: string, name: string, packageId: string | null | undefined, body: unknown) => string;
  /** Another writer's draft write to the address, landing right before the next publish. */
  interleave: (type: string, name: string, packageId: string | null | undefined, body: unknown) => void;
  /** Every request, in order: `[door, type, name, options]`. */
  calls: Array<[string, string, string, Options]>;
}

const key = (type: string, name: string, packageId: unknown): string =>
  JSON.stringify([type, name, typeof packageId === 'string' && packageId ? packageId : null]);

function conflict(currentVersion: string | null): Error {
  return Object.assign(new Error('the version token sent is not the current version'), {
    status: 409,
    code: 'METADATA_CONFLICT',
    body: { error: 'conflict', code: 'METADATA_CONFLICT', currentVersion },
  });
}

export function draftPublishDoor(): DraftPublishDoor {
  let seq = 0;
  const drafts = new Map<string, Row>();
  const live = new Map<string, Row>();
  const calls: DraftPublishDoor['calls'] = [];
  let pendingInterleave: (() => void) | null = null;
  const writeDraft = (k: string, body: unknown): Row => {
    const row = { body, version: `draft-${++seq}` };
    drafts.set(k, row);
    return row;
  };
  const client: DraftPublishDoor['client'] = {
    async save(type, name, body, options = {}) {
      calls.push(['save', type, name, options]);
      const k = key(type, name, options.packageId);
      if (options.mode !== 'draft') {
        const row = { body, version: `live-${++seq}` };
        live.set(k, row);
        return { success: true, version: row.version };
      }
      const current = drafts.get(k);
      if (options.ifNoneMatch === '*' && current) throw conflict(current.version);
      if (typeof options.ifMatch === 'string' && options.ifMatch !== current?.version) {
        throw conflict(current?.version ?? null);
      }
      const row = writeDraft(k, body);
      return { success: true, version: row.version, state: 'draft' };
    },
    async publish(type, name, options = {}) {
      calls.push(['publish', type, name, options]);
      if (pendingInterleave) {
        const run = pendingInterleave;
        pendingInterleave = null;
        run();
      }
      const k = key(type, name, options.packageId);
      const draft = drafts.get(k);
      if (options.draftVersion !== undefined && options.draftVersion !== draft?.version) {
        throw conflict(draft?.version ?? null);
      }
      const active = live.get(k);
      if (typeof options.ifMatch === 'string' && options.ifMatch !== active?.version) throw conflict(active?.version ?? null);
      if (options.ifNoneMatch === '*' && active) throw conflict(active.version);
      if (!draft) throw Object.assign(new Error('no draft'), { status: 404, code: 'NO_DRAFT' });
      const row = { body: draft.body, version: `live-${++seq}` };
      live.set(k, row);
      drafts.delete(k);
      return { success: true, version: row.version };
    },
    async reset(type, name, options = {}) {
      calls.push(['reset', type, name, options]);
      const k = key(type, name, options.packageId);
      if (options.state === 'draft') {
        const draft = drafts.get(k);
        if (typeof options.ifMatch === 'string' && options.ifMatch !== draft?.version) throw conflict(draft?.version ?? null);
        drafts.delete(k);
      } else {
        live.delete(k);
      }
      return { success: true };
    },
    async getDraft(type, name, options = {}) {
      calls.push(['getDraft', type, name, options]);
      const draft = drafts.get(key(type, name, options.packageId));
      return draft ? { type, name, item: draft.body, version: draft.version } : null;
    },
  };
  return {
    client,
    // The doors answer what the console's client answers for these calls; its
    // generic signatures are what the cast stands in for.
    metadataClient: client as unknown as DraftPublishDoor['metadataClient'],
    draftOf: (type, name, packageId) => drafts.get(key(type, name, packageId))?.body,
    liveOf: (type, name, packageId) => live.get(key(type, name, packageId))?.body,
    seedLive: (type, name, packageId, body) => {
      const row = { body, version: `live-${++seq}` };
      live.set(key(type, name, packageId), row);
      return row.version;
    },
    interleave: (type, name, packageId, body) => {
      pendingInterleave = () => {
        writeDraft(key(type, name, packageId), body);
      };
    },
    calls,
  };
}
