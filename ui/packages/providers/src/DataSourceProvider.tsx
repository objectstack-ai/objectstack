import { createContext, useContext } from 'react';
import type { DataSourceProviderProps } from './types.js';

const DataSourceContext = createContext<any>(null);

/**
 * DataSourceProvider - Generic data source context
 *
 * Provides data source to child components without coupling to ObjectStack.
 * Third-party systems can inject their own data adapters.
 */
export function DataSourceProvider({
  dataSource,
  children,
}: DataSourceProviderProps) {
  return (
    <DataSourceContext.Provider value={dataSource}>
      {children}
    </DataSourceContext.Provider>
  );
}

/**
 * Hook to access data source from context
 */
export function useDataSource() {
  const context = useContext(DataSourceContext);
  if (!context) {
    throw new Error('useDataSource must be used within DataSourceProvider');
  }
  return context;
}
