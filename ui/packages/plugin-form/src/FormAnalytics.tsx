/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * FormAnalytics Component
 *
 * Displays basic analytics for form submissions:
 * - Total submissions count
 * - Fill rate (completed vs started)
 * - Average completion time
 * - Field drop-off rates
 *
 * This is an L1 Foundation component for Phase 14.
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';

export interface FormSubmissionMetric {
  /** Total number of form submissions */
  totalSubmissions: number;
  /** Number of forms started but not completed */
  abandonedSubmissions?: number;
  /** Average time to complete form in seconds */
  avgCompletionTime?: number;
  /** Submissions per day over the last N days */
  dailySubmissions?: Array<{
    date: string;
    count: number;
  }>;
  /** Field-level drop-off data */
  fieldDropOff?: Array<{
    fieldName: string;
    label: string;
    completionRate: number;
  }>;
}

export interface FormAnalyticsProps {
  /** Form identifier */
  formId: string;
  /** Form title */
  formTitle?: string;
  /** Submission metrics data */
  metrics: FormSubmissionMetric;
  /** Additional CSS class */
  className?: string;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * FormAnalytics — Basic form analytics dashboard showing submission metrics.
 *
 * Displays fill rate, completion time, and field-level drop-off data
 * for embeddable forms and data collection workflows.
 */
export const FormAnalytics: React.FC<FormAnalyticsProps> = ({
  formId,
  formTitle,
  metrics,
  className,
}) => {
  // The submission count is a number face, so it groups in the display locale
  // — a bare `toLocaleString()` used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const fillRate = useMemo(() => {
    if (!metrics.abandonedSubmissions) return 100;
    const total = metrics.totalSubmissions + metrics.abandonedSubmissions;
    if (total === 0) return 0;
    return Math.round((metrics.totalSubmissions / total) * 100);
  }, [metrics.totalSubmissions, metrics.abandonedSubmissions]);

  // Find max count for bar chart scaling
  const maxDaily = useMemo(() => {
    if (!metrics.dailySubmissions?.length) return 1;
    return Math.max(...metrics.dailySubmissions.map(d => d.count), 1);
  }, [metrics.dailySubmissions]);

  return (
    <div className={`space-y-4 ${className || ''}`}>
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {formTitle || `Form Analytics`}
        </h2>
        <p className="text-sm text-muted-foreground">
          Form ID: {formId}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Submissions */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Submissions</CardDescription>
            <CardTitle className="text-2xl">
              {metrics.totalSubmissions.toLocaleString(displayLocale)}
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Fill Rate */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fill Rate</CardDescription>
            <CardTitle className="text-2xl">
              {fillRate}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary rounded-full h-2 transition-all"
                style={{ width: `${fillRate}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Avg Completion Time */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg. Completion Time</CardDescription>
            <CardTitle className="text-2xl">
              {metrics.avgCompletionTime
                ? formatDuration(metrics.avgCompletionTime)
                : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Daily Submissions Chart */}
      {metrics.dailySubmissions && metrics.dailySubmissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Daily Submissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-32">
              {metrics.dailySubmissions.map((day, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-primary/80 rounded-t transition-all hover:bg-primary"
                    style={{ height: `${(day.count / maxDaily) * 100}%`, minHeight: day.count > 0 ? '4px' : '0' }}
                    title={`${day.date}: ${day.count} submissions`}
                  />
                  <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                    {day.date.slice(-5)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Field Drop-off */}
      {metrics.fieldDropOff && metrics.fieldDropOff.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Field Completion Rates
            </CardTitle>
            <CardDescription>
              Percentage of users who completed each field
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {metrics.fieldDropOff.map((field, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground">{field.label}</span>
                    <span className="text-muted-foreground">{field.completionRate}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className={`rounded-full h-1.5 transition-all ${
                        field.completionRate >= 80
                          ? 'bg-green-500'
                          : field.completionRate >= 50
                          ? 'bg-yellow-500'
                          : 'bg-destructive'
                      }`}
                      style={{ width: `${field.completionRate}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default FormAnalytics;
