// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useObjectOptions — the list of objects (name + label) for the object pickers
 * in the designer's default inspectors (action, hook, page block). Async.
 *
 * It publishes three facts, the same three `useObjectFields` does: `options`,
 * `loading` and `error`. A failed fetch still leaves `options` empty with
 * nothing in flight — the action and page-block pickers then fall back to a
 * free-text input — but it also sets `error`, so a failure is no longer
 * indistinguishable from a catalog that answered with no objects
 * (objectui#10585). A caller that makes a claim from the list — flagging a
 * selected object as missing, or telling the author to publish one — must read
 * all three, not `options` alone: hand `{ loading, error }` to `rosterFrom`
 * (`inspectors/_shared.tsx`) and make the claim only when the roster answered.
 */
import * as React from 'react';
import { useMetadataClient } from '../useMetadata.js';

export interface ObjectOption {
  value: string;
  label: string;
}

export interface UseObjectOptionsResult {
  options: ObjectOption[];
  loading: boolean;
  /** Why the last fetch failed; `null` while in flight and after an answer. */
  error: string | null;
}

export function useObjectOptions(): UseObjectOptionsResult {
  const client = useMetadataClient();
  const [options, setOptions] = React.useState<ObjectOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .list<{ name?: string; label?: string }>('object')
      .then((items) => {
        if (cancelled) return;
        const mapped = (items ?? [])
          .map((raw) => (raw && typeof raw === 'object' && 'item' in raw ? (raw as any).item : raw))
          .filter((i: any) => typeof i?.name === 'string' && i.name)
          .map((i: any) => ({
            value: i.name as string,
            label: i.label ? `${i.label} (${i.name})` : (i.name as string),
          }))
          .sort((a: ObjectOption, b: ObjectOption) => a.value.localeCompare(b.value));
        setOptions(mapped);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setOptions([]);
          setLoading(false);
          // The same spelling `useObjectFields` uses, so `rosterFrom` reads
          // both hooks alike: a fault with an empty message is still a fault.
          setError(err?.message ?? String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { options, loading, error };
}
