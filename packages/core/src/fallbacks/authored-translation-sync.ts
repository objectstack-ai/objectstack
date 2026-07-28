// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime-authored translation sync (#2591).
 *
 * Translations authored in the Studio persist as `translation` sys_metadata
 * rows (`allowRuntimeCreate: true`), but historically only STATIC bundles
 * (app `bundle.translations`, plugin `translations/`) were ever loaded into
 * the i18n runtime — a published translation was a dead-end on publish AND
 * after a restart.
 *
 * This module is the single shared implementation of the fix, wired by both
 * hosts an `i18n` service can come from:
 *   - the runtime's AppPlugin (covers the kernel's in-memory fallback — the
 *     dev/standalone reality) and
 *   - @objectstack/service-i18n's I18nServicePlugin (the file-based adapter).
 * Both adapters expose `replaceAuthoredTranslations(byLocale)`; the sync
 * computes the full authored layer from the rows and REPLACES it wholesale
 * (clear-then-reload), so deleted items/keys stop resolving.
 *
 * Item payload is a single-locale `TranslationItem` — the same `objects.`
 * groups the file-authored bundles use, plus the `locale` it translates
 * (#3778; before that, this type was registered against an object-first
 * `o.<object>` dialect no resolver read, so an authored translation saved
 * cleanly and rendered nothing). Locale resolution: the top-level `locale`,
 * then the item name when it looks like a BCP-47 tag — the name fallback
 * covers rows written before `locale` became required. Rows still carrying
 * the retired shape are skipped with a warning naming the row, since their
 * content can never resolve. Multiple items on one locale deep-merge in name
 * order (deterministic).
 *
 * Trigger points (wired by {@link wireAuthoredTranslationSync}):
 *   • `kernel:ready`      — cold-boot coverage;
 *   • `metadata:reloaded` — publish-while-running coverage (#2576);
 *   • protocol `onMetadataMutation` — direct-active saves / deletes of
 *     `translation` rows that don't go through a package publish (#2588's
 *     mutation stream).
 *
 * Rows are read straight from `sys_metadata` through the engine — the same
 * discipline as the authored-hook re-sync (#2588): env-scoped kernels
 * surface authored rows nowhere else, and the i18n map is process-wide so
 * rows are taken across all organizations. Best-effort: a failed read keeps
 * the currently applied authored layer.
 */

import { LEGACY_OBJECT_FIRST_KEYS } from '@objectstack/spec/system';

import { deepMerge } from './memory-i18n.js';

type AnyRecord = Record<string, any>;

interface MinimalCtx {
  logger: { debug?: (...a: any[]) => void; info?: (...a: any[]) => void; warn?: (...a: any[]) => void };
  getService(name: string): any;
  hook?(name: string, fn: () => Promise<void> | void): void;
}

/**
 * Ownership marker: several plugins may wire the sync against the same
 * kernel (AppPlugin AND I18nServicePlugin on a production server). The first
 * wirer to touch a given i18n service instance claims it; later wirers
 * no-op, so the layer is computed once per change instead of N times.
 */
const OWNER_PROP = '__authoredTranslationSyncOwner';

// Deliberately narrow (language + optional script/region only): item names
// are snake_case, so a permissive multi-segment pattern would classify names
// like `my_custom_strings` as locales.
const LOCALE_LIKE = /^[a-z]{2,3}([_-]([A-Za-z]{4}|[A-Za-z]{2}|[0-9]{3}))?$/;

/**
 * Read ACTIVE `translation` metadata rows and compute the authored layer,
 * keyed by locale. Returns `null` when the read failed (callers must keep
 * the current layer, never tear it down on an error).
 */
export async function readAuthoredTranslationLayer(
  engine: { find(object: string, opts?: AnyRecord): Promise<any[]> },
  logger?: MinimalCtx['logger'],
): Promise<Record<string, Record<string, unknown>> | null> {
  let rows: any[];
  try {
    rows = (await engine.find('sys_metadata', {
      where: { type: 'translation', state: 'active' },
    })) ?? [];
    if (rows.length === 0) {
      // Legacy plural rows — mirrors the protocol's singular/plural fallback.
      rows = (await engine.find('sys_metadata', {
        where: { type: 'translations', state: 'active' },
      })) ?? [];
    }
  } catch (err: any) {
    logger?.debug?.('[i18n] authored-translation read failed — keeping current layer', {
      error: err?.message,
    });
    return null;
  }

  const byLocale: Record<string, Record<string, unknown>> = {};
  const sorted = [...rows].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
  for (const row of sorted) {
    let data: any;
    try {
      data = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    } catch {
      continue; // malformed row — skip it, keep the rest
    }
    if (!data || typeof data !== 'object') continue;

    // Rows written against the retired object-first shape resolve to nothing
    // no matter what locale they claim, so say that plainly rather than
    // letting them look loaded. New saves are rejected at the metadata door
    // by `TranslationItemSchema`; this covers rows that predate it.
    const legacyKeys = LEGACY_OBJECT_FIRST_KEYS.filter((key) => data[key] !== undefined);
    if (legacyKeys.length > 0) {
      logger?.warn?.(
        `[i18n] authored translation '${row?.name}' uses the retired object-first shape `
        + `(${legacyKeys.join(', ')}) — nothing resolves from it; re-author it under `
        + "'objects.<object_name>' with a top-level 'locale' — skipped",
      );
      continue;
    }

    const locale: string | undefined =
      (typeof data?.locale === 'string' && data.locale)
      || (typeof row?.name === 'string' && LOCALE_LIKE.test(row.name) ? row.name : undefined)
      || undefined;
    if (!locale) {
      logger?.warn?.(
        `[i18n] authored translation '${row?.name}' has no resolvable locale `
        + "(set the top-level 'locale', or name the item after its BCP-47 locale) — skipped",
      );
      continue;
    }
    // Strip authoring bookkeeping; everything else is translation data. The
    // lock/package fields are stamped by the metadata protocol on published
    // rows — merging them would seed junk keys into the i18n layer.
    const {
      name: _n, locale: _l,
      _packageId: _p, _packageVersion: _pv, _provenance: _pr,
      _lock: _lk, _lockReason: _lr, _lockDocsUrl: _ld, _lockSource: _ls,
      ...payload
    } = data;
    byLocale[locale] = deepMerge(byLocale[locale] ?? {}, payload as Record<string, unknown>);
  }
  return byLocale;
}

/**
 * Wire the authored-translation sync into a plugin context: registers the
 * `kernel:ready` / `metadata:reloaded` hooks and (at kernel:ready) the
 * protocol mutation subscription. Idempotent per i18n service instance via
 * the ownership marker. Safe to call on kernels with no engine, no protocol,
 * or an i18n service without `replaceAuthoredTranslations` — every path
 * degrades to a no-op.
 */
export function wireAuthoredTranslationSync(ctx: MinimalCtx): void {
  if (typeof ctx.hook !== 'function') return;

  const token = Symbol('authored-translation-sync');
  const resolveOwnedI18n = (): any | null => {
    let i18n: any;
    try { i18n = ctx.getService('i18n'); } catch { return null; }
    if (!i18n || typeof i18n.replaceAuthoredTranslations !== 'function') return null;
    const current = i18n[OWNER_PROP];
    if (current === undefined) {
      i18n[OWNER_PROP] = token;
      return i18n;
    }
    return current === token ? i18n : null; // another wirer owns this instance
  };

  // Serialized: overlapping publishes must not finish out of order and leave
  // the older authored snapshot applied.
  let chain: Promise<void> = Promise.resolve();
  const sync = (): Promise<void> => {
    const run = chain.then(async () => {
      const i18n = resolveOwnedI18n();
      if (!i18n) return;
      let engine: any;
      try { engine = ctx.getService('objectql'); } catch { return; }
      if (!engine || typeof engine.find !== 'function') return;
      const layer = await readAuthoredTranslationLayer(engine, ctx.logger);
      if (layer === null) return; // failed read — keep current layer
      i18n.replaceAuthoredTranslations(layer);
      ctx.logger.info?.('[i18n] synced runtime-authored translations', {
        locales: Object.keys(layer),
      });
    });
    chain = run.catch(() => undefined);
    return run;
  };

  ctx.hook('kernel:ready', async () => {
    // Subscribe to translation mutations through the protocol choke point
    // (#2588). Only the owning wirer subscribes.
    if (resolveOwnedI18n()) {
      let protocol: any = null;
      try { protocol = ctx.getService('protocol'); } catch { /* no protocol on this kernel */ }
      if (protocol && typeof protocol.onMetadataMutation === 'function') {
        protocol.onMetadataMutation((evt: { type: string; name: string; state: string }) => {
          if (evt?.type !== 'translation' || evt.state === 'draft') return;
          void sync().catch((err: any) => {
            ctx.logger.warn?.('[i18n] authored-translation re-sync after mutation failed', {
              item: evt.name,
              error: err?.message,
            });
          });
        });
      }
    }
    await sync();
  });
  ctx.hook('metadata:reloaded', async () => {
    await sync();
  });
}
