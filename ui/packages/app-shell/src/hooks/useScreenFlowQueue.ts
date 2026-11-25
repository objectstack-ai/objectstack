/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The paused screen-flow runs a host's `FlowRunner` shows, one after another
 * (objectstack#36931).
 *
 * A host used to hold ONE paused run (`useState<ScreenFlowState | null>`), and
 * every launch that paused wrote it. One click pauses one run, so that held.
 * The grid's per-record bulk fan-out dispatches a `flow` action once per
 * selected record, and every record whose run paused wrote the same slot: the
 * last one won, and the others' runs waited at a screen nobody could reach
 * any more. Now each paused launch is queued, `FlowRunner` shows the oldest,
 * and closing or completing it shows the next.
 *
 * - Every entry carries its own `key`, which the host passes to `FlowRunner`
 *   as its React key, so the next run mounts a fresh runner. A record link
 *   on a result screen closes the dialog first and completes the run after it
 *   (objectstack#36849): that answer must land on the runner that sent it,
 *   never on the next run's screen.
 * - `settle(key)` drops the entry by key, never "the head", so the late
 *   `onComplete` of that record-link case cannot drop the next run as well.
 */

import { useCallback, useRef, useState } from 'react';
import type { ScreenFlowState } from '../views/FlowRunner.js';

export interface QueuedScreenFlow {
  /** Unique within the host, for `FlowRunner`'s React key and for `settle`. */
  key: number;
  state: ScreenFlowState;
}

export interface ScreenFlowQueue {
  /** The run `FlowRunner` shows now, or `undefined` when none waits. */
  head: QueuedScreenFlow | undefined;
  /** Queue a paused run behind those already waiting. */
  enqueue: (state: ScreenFlowState) => void;
  /** Drop the run queued under `key` (closed or completed); the next one shows. */
  settle: (key: number) => void;
}

export function useScreenFlowQueue(): ScreenFlowQueue {
  const [queue, setQueue] = useState<QueuedScreenFlow[]>([]);
  const nextKey = useRef(0);
  const enqueue = useCallback((state: ScreenFlowState) => {
    nextKey.current += 1;
    const key = nextKey.current;
    setQueue((q) => [...q, { key, state }]);
  }, []);
  const settle = useCallback((key: number) => {
    setQueue((q) => q.filter((entry) => entry.key !== key));
  }, []);
  return { head: queue[0], enqueue, settle };
}
