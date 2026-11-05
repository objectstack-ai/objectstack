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
 * The record is in memory only, and only for installs made in this session:
 * the runtime serves no count of a package's sample rows after the install
 * answer (its listing answers present or not), so a reload drops the count
 * rather than guessing one.
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
  /** Sample records the install left in place ({@link sampleRecordsLoaded}). */
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

/** Records what an install loaded, replacing an earlier record for the package. */
export function rememberSampleData(notice: SampleDataNotice): void {
  session.get(notice.manifestId)?.withdrawBanner?.();
  session.set(notice.manifestId, { notice });
}

/** The record for a package, or `undefined` when this session installed it with no sample data. */
export function sampleDataNotice(manifestId: string): SampleDataNotice | undefined {
  return session.get(manifestId)?.notice;
}

/** Drops the record and its banner: the sample data was cleared. */
export function forgetSampleData(manifestId: string): void {
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
}
