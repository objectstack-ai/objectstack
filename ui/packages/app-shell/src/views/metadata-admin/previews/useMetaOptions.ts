// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useMetaOptions — name+label options for ANY metadata type (generalises
 * {@link useObjectOptions}). Powers reference pickers that point at a metadata
 * record by name (e.g. an Action's `target` → a flow / page / view). Async;
 * degrades to an empty list so callers fall back to a free-text input. Pass
 * `null` to skip fetching.
 */
import * as React from 'react';
import { useMetadataClient } from '../useMetadata.js';

export interface MetaOption {
  value: string;
  label: string;
}

export function useMetaOptions(type: string | null): { options: MetaOption[]; loading: boolean } {
  const client = useMetadataClient();
  const [options, setOptions] = React.useState<MetaOption[]>([]);
  const [loading, setLoading] = React.useState(!!type);

  React.useEffect(() => {
    if (!type) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    client
      .list<{ name?: string; label?: string }>(type)
      .then((items) => {
        if (cancelled) return;
        const mapped = (items ?? [])
          .map((raw) => (raw && typeof raw === 'object' && 'item' in raw ? (raw as any).item : raw))
          .filter((i: any) => typeof i?.name === 'string' && i.name)
          .map((i: any) => ({
            value: i.name as string,
            label: i.label ? `${i.label} (${i.name})` : (i.name as string),
          }))
          .sort((a: MetaOption, b: MetaOption) => a.value.localeCompare(b.value));
        setOptions(mapped);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, type]);

  return { options, loading };
}
