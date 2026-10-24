import { createContext, useContext, useState, useEffect } from 'react';
import type { MetadataProviderProps } from './types.js';

interface MetadataContextValue {
  metadata: any;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const MetadataContext = createContext<MetadataContextValue | null>(null);

/**
 * MetadataProvider - Schema/metadata management
 *
 * Provides application metadata (objects, fields, views) to child components.
 * Can work with static metadata or fetch from API.
 */
export function MetadataProvider({
  metadata: initialMetadata,
  children,
}: MetadataProviderProps) {
  const [metadata, setMetadata] = useState(initialMetadata || null);
  const [loading, setLoading] = useState(!initialMetadata);

  const refetch = () => {
    // Placeholder for refetch logic
    setLoading(true);
    // In real implementation, this would call the API
    setTimeout(() => {
      setLoading(false);
    }, 100);
  };

  useEffect(() => {
    if (initialMetadata) {
      setMetadata(initialMetadata);
      setLoading(false);
    }
  }, [initialMetadata]);

  const value: MetadataContextValue = {
    metadata,
    loading,
    error: null,
    refetch,
  };

  return (
    <MetadataContext.Provider value={value}>
      {children}
    </MetadataContext.Provider>
  );
}

/**
 * Hook to access metadata from context
 */
export function useMetadata() {
  const context = useContext(MetadataContext);
  if (!context) {
    throw new Error('useMetadata must be used within MetadataProvider');
  }
  return context;
}
