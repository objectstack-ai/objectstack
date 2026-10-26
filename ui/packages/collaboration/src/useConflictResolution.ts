/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo } from 'react';
import type { CollaborationConfig } from '@object-ui/types';

export interface VersionEntry {
  id: string;
  version: number;
  timestamp: string;
  userId: string;
  userName?: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  message?: string;
}

export interface ConflictInfo {
  id: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  baseValue: unknown;
  localTimestamp: string;
  remoteTimestamp: string;
  remoteUserId: string;
}

export interface ConflictResolutionResult {
  /** Version history entries */
  versions: VersionEntry[];
  /** Current version number */
  currentVersion: number;
  /** Pending conflicts that need resolution */
  conflicts: ConflictInfo[];
  /** Whether there are unresolved conflicts */
  hasConflicts: boolean;
  /** Record a new version */
  recordVersion: (changes: Record<string, { before: unknown; after: unknown }>, message?: string) => void;
  /** Resolve a conflict */
  resolveConflict: (conflictId: string, resolution: 'local' | 'remote' | 'merge', mergedValue?: unknown) => void;
  /** Resolve all conflicts with a strategy */
  resolveAllConflicts: (strategy: 'local' | 'remote') => void;
  /** Revert to a previous version */
  revertToVersion: (versionId: string) => Record<string, unknown> | null;
  /** Compare two versions */
  compareVersions: (versionA: string, versionB: string) => Record<string, { before: unknown; after: unknown }> | null;
  /** Add a conflict */
  addConflict: (conflict: Omit<ConflictInfo, 'id'>) => void;
  /** Clear version history */
  clearHistory: () => void;
}

let conflictCounter = 0;

function generateConflictId(): string {
  conflictCounter += 1;
  return `conflict-${Date.now()}-${conflictCounter}`;
}

let versionIdCounter = 0;

function generateVersionId(): string {
  versionIdCounter += 1;
  return `ver-${Date.now()}-${versionIdCounter}`;
}

/**
 * Hook for conflict resolution with version history.
 *
 * Manages a local version history and conflict queue. Supports
 * last-write-wins, manual merge, and server-wins resolution strategies.
 *
 * @param userId - Current user ID
 * @param userName - Current user display name
 * @param _config - Optional collaboration config (for future server-side integration)
 */
export function useConflictResolution(
  userId: string,
  userName?: string,
  _config?: CollaborationConfig,
): ConflictResolutionResult {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);

  const currentVersion = useMemo(() => {
    if (versions.length === 0) return 0;
    return versions[versions.length - 1].version;
  }, [versions]);

  const hasConflicts = conflicts.length > 0;

  const recordVersion = useCallback((
    changes: Record<string, { before: unknown; after: unknown }>,
    message?: string,
  ) => {
    setVersions(prev => {
      const nextVersion = prev.length === 0 ? 1 : prev[prev.length - 1].version + 1;
      const entry: VersionEntry = {
        id: generateVersionId(),
        version: nextVersion,
        timestamp: new Date().toISOString(),
        userId,
        userName,
        changes,
        message,
      };
      return [...prev, entry];
    });
  }, [userId, userName]);

  const resolveConflict = useCallback((
    conflictId: string,
    resolution: 'local' | 'remote' | 'merge',
    mergedValue?: unknown,
  ) => {
    setConflicts(prev => {
      const conflict = prev.find(c => c.id === conflictId);
      if (!conflict) return prev;

      let resolvedValue: unknown;
      switch (resolution) {
        case 'local':
          resolvedValue = conflict.localValue;
          break;
        case 'remote':
          resolvedValue = conflict.remoteValue;
          break;
        case 'merge':
          resolvedValue = mergedValue ?? conflict.localValue;
          break;
      }

      // Record the resolution as a version entry
      setVersions(vPrev => {
        const nextVersion = vPrev.length === 0 ? 1 : vPrev[vPrev.length - 1].version + 1;
        const entry: VersionEntry = {
          id: generateVersionId(),
          version: nextVersion,
          timestamp: new Date().toISOString(),
          userId,
          userName,
          changes: {
            [conflict.field]: { before: conflict.baseValue, after: resolvedValue },
          },
          message: `Resolved conflict on "${conflict.field}" using ${resolution} strategy`,
        };
        return [...vPrev, entry];
      });

      return prev.filter(c => c.id !== conflictId);
    });
  }, [userId, userName]);

  const resolveAllConflicts = useCallback((strategy: 'local' | 'remote') => {
    setConflicts(prev => {
      if (prev.length === 0) return prev;

      const allChanges: Record<string, { before: unknown; after: unknown }> = {};
      for (const conflict of prev) {
        allChanges[conflict.field] = {
          before: conflict.baseValue,
          after: strategy === 'local' ? conflict.localValue : conflict.remoteValue,
        };
      }

      setVersions(vPrev => {
        const nextVersion = vPrev.length === 0 ? 1 : vPrev[vPrev.length - 1].version + 1;
        const entry: VersionEntry = {
          id: generateVersionId(),
          version: nextVersion,
          timestamp: new Date().toISOString(),
          userId,
          userName,
          changes: allChanges,
          message: `Resolved all conflicts using ${strategy} strategy`,
        };
        return [...vPrev, entry];
      });

      return [];
    });
  }, [userId, userName]);

  const revertToVersion = useCallback((versionId: string): Record<string, unknown> | null => {
    const targetIdx = versions.findIndex(v => v.id === versionId);
    if (targetIdx === -1) return null;

    // Build the state at the target version by replaying changes
    const state: Record<string, unknown> = {};
    for (let i = 0; i <= targetIdx; i++) {
      const entry = versions[i];
      for (const [field, change] of Object.entries(entry.changes)) {
        state[field] = change.after;
      }
    }

    // Record the revert as a new version
    const revertChanges: Record<string, { before: unknown; after: unknown }> = {};
    const currentState: Record<string, unknown> = {};
    for (const entry of versions) {
      for (const [field, change] of Object.entries(entry.changes)) {
        currentState[field] = change.after;
      }
    }
    for (const [field, value] of Object.entries(state)) {
      if (currentState[field] !== value) {
        revertChanges[field] = { before: currentState[field], after: value };
      }
    }

    if (Object.keys(revertChanges).length > 0) {
      setVersions(prev => {
        const nextVersion = prev.length === 0 ? 1 : prev[prev.length - 1].version + 1;
        const entry: VersionEntry = {
          id: generateVersionId(),
          version: nextVersion,
          timestamp: new Date().toISOString(),
          userId,
          userName,
          changes: revertChanges,
          message: `Reverted to version ${versions[targetIdx].version}`,
        };
        return [...prev, entry];
      });
    }

    return state;
  }, [versions, userId, userName]);

  const compareVersions = useCallback((
    versionA: string,
    versionB: string,
  ): Record<string, { before: unknown; after: unknown }> | null => {
    const idxA = versions.findIndex(v => v.id === versionA);
    const idxB = versions.findIndex(v => v.id === versionB);
    if (idxA === -1 || idxB === -1) return null;

    const [startIdx, endIdx] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];

    // Build state at each version
    const buildState = (upTo: number): Record<string, unknown> => {
      const state: Record<string, unknown> = {};
      for (let i = 0; i <= upTo; i++) {
        for (const [field, change] of Object.entries(versions[i].changes)) {
          state[field] = change.after;
        }
      }
      return state;
    };

    const stateA = buildState(startIdx);
    const stateB = buildState(endIdx);
    const allFields = new Set([...Object.keys(stateA), ...Object.keys(stateB)]);
    const diff: Record<string, { before: unknown; after: unknown }> = {};

    for (const field of allFields) {
      const valA = stateA[field];
      const valB = stateB[field];
      if (valA !== valB) {
        diff[field] = { before: valA, after: valB };
      }
    }

    return diff;
  }, [versions]);

  const addConflict = useCallback((conflict: Omit<ConflictInfo, 'id'>) => {
    const newConflict: ConflictInfo = {
      ...conflict,
      id: generateConflictId(),
    };
    setConflicts(prev => [...prev, newConflict]);
  }, []);

  const clearHistory = useCallback(() => {
    setVersions([]);
    setConflicts([]);
  }, []);

  return {
    versions,
    currentVersion,
    conflicts,
    hasConflicts,
    recordVersion,
    resolveConflict,
    resolveAllConflicts,
    revertToVersion,
    compareVersions,
    addConflict,
    clearHistory,
  };
}
