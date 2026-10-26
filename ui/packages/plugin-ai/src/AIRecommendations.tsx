/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@object-ui/components';
import type { AIRecommendationsSchema, AIRecommendationItem } from '@object-ui/types';
import { Sparkles, Star, ExternalLink, X, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useDisplayLocale } from '@object-ui/i18n';
import { useAiTranslation, formatPercent } from './useAiTranslation';

export interface AIRecommendationsProps {
  schema: AIRecommendationsSchema;
  /** Callback when a recommendation is selected */
  onSelect?: (item: AIRecommendationItem) => void;
  /** Callback when a recommendation is dismissed */
  onDismiss?: (item: AIRecommendationItem) => void;
}

/**
 * AIRecommendations - AI-powered recommendation component
 *
 * Renders EVERY item in `schema.recommendations`, in both the `list` and the
 * `grid` layout, and the count badge in the header reports that same length.
 * There is no cap: the caller decides how many items to hand over, and slicing
 * — if it is wanted — happens before the array reaches this component.
 *
 * That sentence replaces a promise this component never honoured.
 * `AIRecommendationsSchema.maxResults` was declared as *"Maximum number of
 * results to display"*, offered in the designer, and read by nothing: a node
 * carrying `maxResults: 5` against a 50-item list rendered 50 rows with no
 * diagnostic. The key is retired (objectui#8178, ADR-0049, director decision
 * batch #78) rather than implemented, because nothing pulled on it; it is a
 * `?: never` tombstone on the schema now, and the behaviour stated here is
 * pinned by `AIRecommendations.rendersEveryItem-8178.test.tsx`.
 */
export const AIRecommendations: React.FC<AIRecommendationsProps> = ({ schema, onSelect, onDismiss }) => {
  const { t } = useAiTranslation();
  const displayLocale = useDisplayLocale();
  const {
    recommendations = [],
    showScores = false,
    layout = 'list',
    loading = false,
    emptyMessage = t('ai.recommendations.empty'),
  } = schema;

  const handleSelect = (item: AIRecommendationItem) => {
    onSelect?.(item);
  };

  const handleDismiss = (item: AIRecommendationItem) => {
    onDismiss?.(item);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Sparkles className="h-8 w-8 text-blue-500 mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-muted-foreground">{t('ai.recommendations.generating')}</p>
        </CardContent>
      </Card>
    );
  }

  if (recommendations.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  const renderScoreBadge = (score: number) => {
    if (!showScores) return null;
    const variant = score >= 0.7 ? 'default' : score >= 0.4 ? 'secondary' : 'outline';
    return <Badge variant={variant} className="text-xs">{formatPercent(score, displayLocale)}</Badge>;
  };

  const renderListItem = (item: AIRecommendationItem) => (
    <div
      key={item.id}
      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => handleSelect(item)}
    >
      <div className="mt-1 shrink-0">
        <Star className="h-4 w-4 text-yellow-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">{item.title}</span>
          {item.category && (
            <Badge variant="outline" className="text-xs">{item.category}</Badge>
          )}
          {renderScoreBadge(item.score)}
        </div>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {item.action && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleDismiss(item); }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  const renderGridItem = (item: AIRecommendationItem) => (
    <Card
      key={item.id}
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => handleSelect(item)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <Star className="h-4 w-4 text-yellow-500" />
          {renderScoreBadge(item.score)}
        </div>
        <h4 className="font-medium text-sm mb-1">{item.title}</h4>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-3">{item.description}</p>
        )}
        {item.category && (
          <Badge variant="outline" className="text-xs mt-2">{item.category}</Badge>
        )}
        <div className="flex items-center gap-1 mt-3">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-green-600">
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500">
            <ThumbsDown className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-blue-500" />
          {t('ai.recommendations.title')}
          <Badge variant="secondary" className="text-xs">{recommendations.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {layout === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recommendations.map(renderGridItem)}
          </div>
        ) : (
          <div className="space-y-2">
            {recommendations.map(renderListItem)}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
