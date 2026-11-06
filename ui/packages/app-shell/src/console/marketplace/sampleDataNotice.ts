// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sample data an install into this runtime loaded, as the console tells
 * the installer about it (objectstack#30323).
 *
 * Sample data stays ON by default: an app tried with data in it shows what it
 * does. What this module serves is the way out, so the person who installed it
 * can start for real without hunting for it:
 *
 * - {@link sampleRecordsLoaded} reads the install answer's own count, so the
 *   install note says how many sample records the app now holds.
 * - The session record below keeps that count, per installed package, for the
 *   rest of this console session. The package page's clear confirm reads it
 *   back, and the banner that follows the installer to the app's own pages
 *   (`SampleDataLeaveBanner`) is raised from it and withdrawn through it.
 *
 * The record is in memory only. A reload drops it, and the package page fills
 * it again from the runtime's own count of the sample rows a purge would
 * delete now (`GET …/install-local/:manifestId/sample-data`, objectstack#30616)
 * through {@link noteServedSampleCount}: a count above zero records it, zero
 * drops the record and its banner. An answer this session learned after that
 * read began (an install, a reseed or a clear) is fresher and is kept.
 */

import type { LocalInstallSeeded } from './marketplaceApi.js';

/**
 * How many sample records an install left in place, from its answer's
 * `seeded`: `inserted + updated + skipped` of an `inline` run (its `skipped`
 * are records whose row was already there). `null` when the install ran no
 * seed now (`skipped`, `refused`, `replayer`), sent no report, or its run left
 * no record in place, so the note says nothing about sample data.
 */
export function sampleRecordsLoaded(answer: { seeded?: LocalInstallSeeded }): number | null {
  const seeded = answer.seeded;
  if (!seeded || seeded.mode !== 'inline') return null;
  const count = (seeded.inserted ?? 0) + (seeded.updated ?? 0) + (seeded.skipped ?? 0);
  return count > 0 ? count : null;
}

/** One installed package's sample data, as this session learned it. */
export interface SampleDataNotice {
  /** The install-local ledger key the clear acts on. */
  manifestId: string;
  /** The package's display name, as the install note named it. */
  name: string;
  /** Sample records the install left in place ({@link sampleRecordsLoaded}), or the runtime's count of them ({@link noteServedSampleCount}). */
  count: number;
  /** The package page, where the clear confirm is drawn. */
  path: string;
}

interface SessionEntry {
  notice: SampleDataNotice;
  /** Withdraws the banner raised for it, while one stands. */
  withdrawBanner?: () => void;
  /** Set by the banner's action: the package page opens its confirm on arrival. */
  confirmRequested?: boolean;
}

const session = new Map<string, SessionEntry>();

/**
 * Per package, how many times this session learned its sample data from an
 * answer of its own (install, reseed, clear): a served count read before the
 * latest of them is older than it, and is not recorded.
 */
const learned = new Map<string, number>();
const learn = (manifestId: string) => learned.set(manifestId, (learned.get(manifestId) ?? 0) + 1);

/** Records what an install loaded, replacing an earlier record for the package. */
export function rememberSampleData(notice: SampleDataNotice): void {
  learn(notice.manifestId);
  session.get(notice.manifestId)?.withdrawBanner?.();
  session.set(notice.manifestId, { notice });
}

/** What {@link noteServedSampleCount} compares against: read it when the count's request starts. */
export function sampleDataGeneration(manifestId: string): number {
  return learned.get(manifestId) ?? 0;
}

/**
 * Records the runtime's count of a package's sample rows, read on a visit to
 * its page. A count above zero updates the record in place (a standing banner
 * and a pending confirm request stay with it) or starts one; zero drops the
 * record and withdraws its banner. Ignored when this session learned the
 * package's sample data from an answer after `generation` was read.
 */
export function noteServedSampleCount(notice: SampleDataNotice, generation: number): void {
  if (sampleDataGeneration(notice.manifestId) !== generation) return;
  const entry = session.get(notice.manifestId);
  if (notice.count <= 0) {
    entry?.withdrawBanner?.();
    session.delete(notice.manifestId);
    return;
  }
  if (entry) entry.notice = notice;
  else session.set(notice.manifestId, { notice });
}

/** The record for a package, or `undefined` when this session installed it with no sample data. */
export function sampleDataNotice(manifestId: string): SampleDataNotice | undefined {
  return session.get(manifestId)?.notice;
}

/** Drops the record and its banner: the sample data was cleared. */
export function forgetSampleData(manifestId: string): void {
  learn(manifestId);
  session.get(manifestId)?.withdrawBanner?.();
  session.delete(manifestId);
}

/** Keeps the banner's withdraw handle with its record. */
export function attachBanner(manifestId: string, withdraw: () => void): void {
  const entry = session.get(manifestId);
  if (entry) entry.withdrawBanner = withdraw;
}

/** Withdraws the banner, keeping the record: the installer is back on the package page. */
export function withdrawBanner(manifestId: string): void {
  const entry = session.get(manifestId);
  entry?.withdrawBanner?.();
  if (entry) entry.withdrawBanner = undefined;
}

/** The banner's action: the package page opens its clear confirm on arrival. */
export function requestClearConfirm(manifestId: string): void {
  const entry = session.get(manifestId);
  if (entry) entry.confirmRequested = true;
}

/** Whether the banner asked for the confirm; reading it consumes the request. */
export function takeClearConfirmRequest(manifestId: string): boolean {
  const entry = session.get(manifestId);
  if (!entry?.confirmRequested) return false;
  entry.confirmRequested = false;
  return true;
}

/** Test-only: an empty session. */
export function resetSampleDataSessionForTesting(): void {
  session.clear();
  learned.clear();
}
