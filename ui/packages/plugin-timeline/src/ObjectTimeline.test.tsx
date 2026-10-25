import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectTimeline, type ObjectTimelineProps } from './ObjectTimeline';
import { DataSource } from '@object-ui/types';

// Mock useDataScope and useNavigationOverlay
vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
    // `useObjectLabel` was missing here. It used to be masked by a try/catch
    // around the hook inside ObjectTimeline — which meant this mock's gap was
    // silently absorbed by production code that had a rules-of-hooks bug
    // (objectui#2879). With that removed, the mock has to be complete.
    //
    // objectui#5623: ObjectTimeline now calls the SHARED `useSafeFieldLabel`
    // (from `@object-ui/react`, re-exported from `@object-ui/i18n`) instead of
    // a local `useObjectLabel`-based wrapper, so this mock has to cover that
    // name instead — a mock without it would leave `useSafeFieldLabel`
    // `undefined` (this `vi.mock` factory replaces the whole module, no
    // `...actual` spread) and throw on the destructure.
    useSafeFieldLabel: () => ({
      fieldOptionLabel: (_o: string, _f: string, _v: string, fallback: string) => fallback,
      translateOptions: (_o: string, _f: string, opts: unknown[]) => opts,
      fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
    }),
    SchemaRendererContext: React.createContext(null),
  };
});

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NavigationOverlay: () => null,
}));

vi.mock('./renderer', () => ({
  TimelineRenderer: ({ schema }: any) => (
    <div data-testid="timeline-view">
      {schema.items?.map((t: any, idx: number) => (
        <div key={idx} data-testid="timeline-item">{t.title}</div>
      ))}
    </div>
  ),
}));

const mockData = [
  { id: '1', name: 'Event 1', date: '2024-01-01', description: 'Desc 1' },
];

const mockDataSource: DataSource = {
  find: vi.fn(),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(),
};

describe('ObjectTimeline', () => {
    it('renders with static items', async () => {
        // Typed, not `any`: these items used to be spelled `{ title, date }`.
        // `date` is the retired `TimelineEvent` vocabulary and nothing reads it
        // off an item, so the date was silently dropped while the title-only
        // assertion stayed green. A feed item's date is `time` (objectui#6356),
        // and the element type now refuses `date` at compile time.
        const schema: ObjectTimelineProps['schema'] = {
            type: 'timeline',
            items: [
                { title: 'Static Event', time: '2024-01-01' }
            ]
        };
        render(<ObjectTimeline schema={schema} />);
        await waitFor(() => {
            expect(screen.getByText('Static Event')).toBeDefined();
        });
    });

    it('fetches data when objectName is provided', async () => {
        (mockDataSource.find as any).mockResolvedValue(mockData);
        
        const schema: any = {
            type: 'timeline',
            objectName: 'events',
            titleField: 'name',
            dateField: 'date' // Backward-compat: legacy dateField still works
        };

        render(<ObjectTimeline schema={schema} dataSource={mockDataSource} />);

        await waitFor(() => {
             expect(mockDataSource.find).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(screen.getByText('Event 1')).toBeDefined();
        });
    });

    it('uses spec-compliant startDateField property', async () => {
        const dataWithDates = [
            { id: '1', name: 'Sprint 1', start_date: '2024-01-01', end_date: '2024-01-14', team: 'Alpha' },
        ];
        (mockDataSource.find as any).mockResolvedValue(dataWithDates);

        const schema: any = {
            type: 'timeline',
            objectName: 'sprints',
            titleField: 'name',
            startDateField: 'start_date',
            endDateField: 'end_date',
        };

        render(<ObjectTimeline schema={schema} dataSource={mockDataSource} />);

        await waitFor(() => {
            expect(screen.getByText('Sprint 1')).toBeDefined();
        });
    });

    it('supports groupByField and colorField properties', async () => {
        const dataWithGroups = [
            { id: '1', name: 'Task A', start_date: '2024-01-01', team: 'Alpha', priority: 'high' },
        ];
        (mockDataSource.find as any).mockResolvedValue(dataWithGroups);

        const schema: any = {
            type: 'timeline',
            objectName: 'tasks',
            titleField: 'name',
            startDateField: 'start_date',
            groupByField: 'team',
            colorField: 'priority',
        };

        render(<ObjectTimeline schema={schema} dataSource={mockDataSource} />);

        await waitFor(() => {
            expect(screen.getByText('Task A')).toBeDefined();
        });
    });

    it('supports scale property', () => {
        const schema: ObjectTimelineProps['schema'] = {
            type: 'timeline',
            items: [
                { title: 'Weekly Event', time: '2024-01-01' }
            ],
            scale: 'week',
        };
        render(<ObjectTimeline schema={schema} />);
        expect(screen.getByText('Weekly Event')).toBeDefined();
    });
});
