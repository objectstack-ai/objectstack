/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailDrawer
 *
 * A standardized right-side drawer that renders {@link RecordDetailPanel} for
 * a single record.
 *
 * ⭐ **This component no longer owns a shell** (objectui#9299, director seat
 * decision batch #128 item 1). It used to bring its own `Sheet` plus its own
 * drag-resize implementation, and that is exactly what the card measured as
 * the defect: `ObjectGantt`, `ObjectKanban` and `ObjectCalendar` rendered this
 * drawer for all four authored `navigation.mode` values, so `modal`, `split`
 * and `popover` were silently the drawer. Those three renderers now mount
 * {@link RecordDetailPanel} through `NavigationOverlay` themselves and honour
 * the authored mode.
 *
 * What survives here is the published convenience wrapper — drawer mode, one
 * record, handler-presence capability — delegating to the SAME
 * `NavigationOverlay` every other surface uses. Two consequences, both ruled:
 *
 * - **One drag-resize implementation** (item 4). The width this drawer used to
 *   persist under `objectui.drawerWidth.OBJECT` (480 px floor) is read once and
 *   migrated into the shell's `ov:drawer-width:OBJECT` (360 px floor), so a user
 *   who had already sized their drawer keeps that width. ⛔ It is not reset.
 *   The retired key is spelled in exactly one place —
 *   `legacyRecordDrawerWidthKey` in `@object-ui/components`.
 * - **One chrome.** The shell's header (breadcrumb-style title + close +
 *   optional expand) replaces the sr-only `SheetHeader` this file used to
 *   render. That is the "chrome de-duplication" the ruling priced in.
 */

import React from 'react';
import {
  NavigationOverlay,
  legacyRecordDrawerWidthKey,
  recordOverlayWidthStorageKey,
} from '@object-ui/components';
import type { DataSource } from '@object-ui/types';
import {
  DEFAULT_SYSTEM_FIELDS,
  RECORD_OVERLAY_DEFAULT_WIDTH,
  RecordDetailPanel,
} from './RecordDetailPanel';

export interface RecordDetailDrawerProps {
  /** Whether the drawer is currently open. */
  open: boolean;
  /** Called when the user dismisses the drawer (overlay click, Esc, after delete). */
  onClose: () => void;
  /** Drawer header title (typically the record's primary label). */
  title: string;
  /** The record being displayed. */
  record: Record<string, any>;
  /** Logical object name used by the data source. */
  objectName: string;
  /** Record id (string-coerced before issuing update/delete). */
  recordId: string | number;
  /** Active data source — used for inline updates and deletion. */
  dataSource?: DataSource;
  /**
   * Optional objectSchema (as returned by `dataSource.getObjectSchema`).
   * When provided the drawer infers field types so dates / picklists /
   * currency render with their proper widgets.
   */
  objectSchema?: { fields?: Record<string, any> } | null;
  /**
   * Drawer width — accepts any CSS width value. Defaults to
   * `min(960px, 60vw)` which fills ~60% of typical desktop viewports
   * (the prior `max-w-2xl` cap felt cramped on wide screens).
   *
   * That default is the single code home of the literal repo-wide: the
   * gantt, kanban and calendar renderers deliberately spell no width and
   * let `undefined` fall through to here. Converging it on the `size: 'lg'`
   * bucket (`min(92vw, 960px)` — up to 53% wider below a 1600px viewport)
   * was RULED AGAINST: objectui#6584, 2026-08-27 — stays on the CSS
   * literal; no bucket convergence. The question is CLOSED, not open. A
   * future move to the bucket is a fresh ruling, with visual-regression
   * evidence across all four surfaces in one stroke.
   *
   * ⚠️ Pixels are unchanged by objectui#9299's shell delegation: the shell
   * treats an authored width as a floor via
   * `max(WIDTH, min(60vw, 880px))`, and for this default that expression
   * reduces to `min(60vw, 960px)` at every viewport — the same value the
   * inline style used to set.
   *
   * Note: when `resizable` is true (the default), this is only used
   * as the initial width — the user's drag-resized width takes over
   * and is persisted to localStorage keyed by `objectName`.
   */
  width?: string | number;
  /** Number of columns the field grid should use. Default `2`. */
  columns?: number;
  /**
   * Optional override for the SYSTEM_FIELDS filter. Defaults to a
   * standard set (id, timestamps, audit fields).
   */
  systemFields?: Set<string>;
  /**
   * Persist an inline field edit. Plugins usually update local state
   * here so the drawer stays in sync after the network round-trip.
   */
  onFieldSave?: (field: string, value: unknown) => void | Promise<void>;
  /**
   * Persist record deletion. Plugins are expected to remove the record
   * from their local state; the drawer auto-closes after this resolves.
   */
  onDelete?: () => void | Promise<void>;
  /**
   * Allow the user to drag the left edge to resize the drawer width.
   * Resized width is persisted per-objectName in localStorage. Default `true`.
   */
  resizable?: boolean;
  /**
   * Optional URL to the full record page. When provided, the drawer
   * shows an "Open in new tab" entry in the record header's overflow menu.
   * Typically `/console/apps/{appName}/{objectName}/record/{recordId}`.
   */
  fullPageHref?: string;
}

/** Right-side drawer wrapping {@link RecordDetailPanel} for a single record. */
export function RecordDetailDrawer({
  open,
  onClose,
  title,
  record,
  objectName,
  recordId,
  dataSource,
  objectSchema,
  width = RECORD_OVERLAY_DEFAULT_WIDTH,
  columns = 2,
  systemFields = DEFAULT_SYSTEM_FIELDS,
  onFieldSave,
  onDelete,
  resizable = true,
  fullPageHref,
}: RecordDetailDrawerProps) {
  return (
    <NavigationOverlay
      isOpen={open}
      isOverlay
      mode="drawer"
      selectedRecord={record}
      close={onClose}
      setIsOpen={(next) => { if (!next) onClose(); }}
      width={width}
      title={title}
      storageKey={resizable ? recordOverlayWidthStorageKey(objectName) : undefined}
      legacyStorageKey={resizable ? legacyRecordDrawerWidthKey(objectName) : undefined}
    >
      {() => (
        <div className="px-6 pt-6 pb-6">
          <RecordDetailPanel
            record={record}
            objectName={objectName}
            recordId={recordId}
            dataSource={dataSource}
            objectSchema={objectSchema}
            columns={columns}
            systemFields={systemFields}
            onFieldSave={onFieldSave}
            onDelete={onDelete}
            onClose={onClose}
            fullPageHref={fullPageHref}
          />
        </div>
      )}
    </NavigationOverlay>
  );
}

export default RecordDetailDrawer;

/**
 * Derive a full record-page URL from the current browser location.
 *
 * Used by plugin-gantt / plugin-calendar / plugin-kanban to populate
 * `fullPageHref` without each plugin needing direct access to the router.
 * Strips any `/view/{viewId}` suffix so the resulting URL points at the
 * canonical record page.
 *
 * @param objectName - The object name segment in the URL
 *   (e.g. `campaign`, `lead`).
 * @param recordId - The record's primary key, will be URL-encoded.
 * @returns A path like `/console/apps/{app}/{objectName}/record/{id}`,
 *   or `null` when called outside the browser.
 */
export function deriveRecordPageHref(objectName: string, recordId: string | number): string | null {
  if (typeof window === 'undefined') return null;
  const currentPath = window.location.pathname;
  // Strip everything after `/{objectName}` to get the app prefix.
  const marker = `/${objectName}`;
  const idx = currentPath.indexOf(marker);
  const prefix = idx >= 0 ? currentPath.slice(0, idx) : currentPath.replace(/\/$/, '');
  return `${prefix}/${objectName}/record/${encodeURIComponent(String(recordId))}`;
}
