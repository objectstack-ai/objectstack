/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from '@object-ui/components';
import type { NLQuerySchema, NLQueryResult } from '@object-ui/types';
import { Search, Sparkles, Clock, ArrowRight, Loader2, Table } from 'lucide-react';
import { useDisplayLocale } from '@object-ui/i18n';
import { useAiTranslation, formatPercent } from './useAiTranslation';

export interface NLQueryInputProps {
  schema: NLQuerySchema;
  /** Callback when a query is submitted */
  onSubmit?: (query: string) => void;
}

/**
 * NLQueryInput - Natural language query interface
 * Allows users to query data using natural language, with AI-powered parsing.
 */
export const NLQueryInput: React.FC<NLQueryInputProps> = ({ schema, onSubmit: onSubmitProp }) => {
  const { t } = useAiTranslation();
  // Dates and percentages read the DISPLAY locale, never the machine's
  // (objectui#10232).
  const displayLocale = useDisplayLocale();
  const {
    placeholder = t('ai.nlQuery.placeholder'),
    result: initialResult,
    suggestions = [],
    showHistory = false,
    history = [],
    loading: externalLoading = false,
  } = schema;

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<NLQueryResult | undefined>(initialResult);
  const [loading, setLoading] = useState(false);

  const isLoading = loading || externalLoading;

  const handleSubmit = (q?: string) => {
    const queryText = q || query;
    if (!queryText.trim()) return;
    
    setLoading(true);
    onSubmitProp?.(queryText);
    
    // Simulate AI processing when no external handler
    if (!onSubmitProp) {
      setTimeout(() => {
        setResult({
          query: queryText,
          summary: t('ai.nlQuery.simulatedSummary', { query: queryText }),
          confidence: 0.85,
          data: [],
          columns: [],
        });
        setLoading(false);
      }, 1000);
    } else {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    handleSubmit(suggestion);
  };

  return (
    <div className="space-y-4">
      {/* Query Input */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleSubmit()}
                placeholder={placeholder}
                className="pl-10 pr-20"
                disabled={isLoading}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <Button 
                  size="sm" 
                  onClick={() => handleSubmit()}
                  disabled={isLoading || !query.trim()}
                  className="h-7"
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      {t('ai.nlQuery.ask')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && !result && (
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((suggestion: string, idx: number) => (
                <button type="button"
                  key={idx}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="text-xs px-2.5 py-1 rounded-full border bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Table className="h-4 w-4" />
                {t('ai.nlQuery.results')}
              </CardTitle>
              {result.confidence !== undefined && (
                <Badge variant={result.confidence >= 0.7 ? 'default' : 'secondary'} className="text-xs">
                  {t('ai.nlQuery.match', { percent: formatPercent(result.confidence, displayLocale) })}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {result.summary && (
              <p className="text-sm text-muted-foreground mb-3">{result.summary}</p>
            )}

            {/* Result Table */}
            {result.data && result.data.length > 0 && result.columns && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {result.columns.map((col: { name: string; label?: string; type?: string }, idx: number) => (
                        <th key={idx} className="px-4 py-2 text-left font-medium">
                          {col.label || col.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((row: Record<string, unknown>, rowIdx: number) => (
                      <tr key={rowIdx} className="border-t">
                        {result.columns!.map((col: { name: string; label?: string; type?: string }, colIdx: number) => (
                          <td key={colIdx} className="px-4 py-2">
                            {String(row[col.name] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Empty results */}
            {(!result.data || result.data.length === 0) && (
              <div className="text-center py-6 text-muted-foreground text-sm">
                {t('ai.nlQuery.noResults')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Query History */}
      {showHistory && history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t('ai.nlQuery.recentQueries')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {history.slice(0, 5).map((item: { query: string; timestamp: string }, idx: number) => (
              <button type="button"
                key={idx}
                onClick={() => handleSuggestionClick(item.query)}
                className="w-full flex items-center gap-2 p-2 rounded-md text-sm text-left hover:bg-muted/50 transition-colors"
              >
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{item.query}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                  {new Date(item.timestamp).toLocaleDateString(displayLocale)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
