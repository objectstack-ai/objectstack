import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardRenderer } from '../DashboardRenderer';
import type { DashboardComponentSchema } from '@object-ui/types';

// Mock SchemaRenderer to avoid pulling in the full renderer tree.
// Forwards className and includes an interactive child to simulate real chart content.
vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema, className }: { schema: any; className?: string }) => (
      <div data-testid="schema-renderer" className={className}>
        <button data-testid={`interactive-child-${schema?.type ?? 'unknown'}`}>
          {schema?.type ?? 'unknown'}
        </button>
      </div>
    ),
    SchemaRendererContext: React.createContext(null),
  };
});

// No dashboard-root `title`: retired (objectui#7509), so inert here, and it
// compiled only through `BaseSchema`'s index signature (objectui#11348).
const DASHBOARD_WITH_WIDGETS: DashboardComponentSchema = {
  type: 'dashboard',
  columns: 2,
  widgets: [
    { id: 'w1', title: 'Revenue', type: 'metric' },
    { id: 'w2', title: 'Sales Chart', type: 'bar' },
    { id: 'w3', title: 'Orders Table', type: 'table' },
  ],
};

// Re-enabled 2026-08-03 (#2835 scope check). This suite was `describe.skip`'d
// since 2026-05-01 as `TODO(#ci-hang)`: it hung in `vitest run`, and the hang
// was attributed to a transitive dependency rather than this file or
// DashboardRenderer.tsx. On today's dependency tree it passes standalone
// (24/24 in ~8s); the re-enabling PR's own sharded Test jobs are the
// full-suite gate. If the hang comes back, the failure signature is the Test
// job hitting its `timeout-minutes` with this file mid-run — re-skip with a
// pointer here and bisect the dep change that brought it back.
describe('DashboardRenderer design mode', () => {
  describe('Widget selection', () => {
    it('should render widget test IDs in design mode', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={onWidgetClick}
        />,
      );

      expect(screen.getByTestId('dashboard-preview-widget-w1')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-preview-widget-w2')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-preview-widget-w3')).toBeInTheDocument();
    });

    it('should not render widget test IDs when not in design mode', () => {
      render(<DashboardRenderer schema={DASHBOARD_WITH_WIDGETS} />);

      expect(screen.queryByTestId('dashboard-preview-widget-w1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-preview-widget-w2')).not.toBeInTheDocument();
    });

    it('should call onWidgetClick when a widget is clicked', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={onWidgetClick}
        />,
      );

      fireEvent.click(screen.getByTestId('dashboard-preview-widget-w1'));
      expect(onWidgetClick).toHaveBeenCalledWith('w1');
    });

    it('should set aria-selected on the selected widget', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId="w2"
          onWidgetClick={vi.fn()}
        />,
      );

      expect(screen.getByTestId('dashboard-preview-widget-w2')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('dashboard-preview-widget-w1')).toHaveAttribute('aria-selected', 'false');
    });

    it('should apply selection styling classes on selected widget', () => {
      const { container } = render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId="w1"
          onWidgetClick={vi.fn()}
        />,
      );

      const selectedWidget = screen.getByTestId('dashboard-preview-widget-w1');
      expect(selectedWidget.className).toContain('ring-2');
      expect(selectedWidget.className).toContain('ring-primary');
    });

    it('should have role="button" on widgets in design mode', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      expect(screen.getByTestId('dashboard-preview-widget-w1')).toHaveAttribute('role', 'button');
    });

    it('should have tabIndex=0 for keyboard accessibility in design mode', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      expect(screen.getByTestId('dashboard-preview-widget-w1')).toHaveAttribute('tabindex', '0');
    });

    it('should have aria-label on widgets in design mode', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      expect(screen.getByTestId('dashboard-preview-widget-w1')).toHaveAttribute(
        'aria-label',
        'Widget: Revenue',
      );
    });
  });

  describe('Click deselection', () => {
    it('should call onWidgetClick(null) when clicking background', () => {
      const onWidgetClick = vi.fn();
      const { container } = render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId="w1"
          onWidgetClick={onWidgetClick}
        />,
      );

      // Click on the outer grid container (background)
      const gridContainer = container.firstElementChild as HTMLElement;
      fireEvent.click(gridContainer);
      expect(onWidgetClick).toHaveBeenCalledWith(null);
    });
  });

  describe('Keyboard navigation', () => {
    it('should select next widget with ArrowRight', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId="w1"
          onWidgetClick={onWidgetClick}
        />,
      );

      fireEvent.keyDown(screen.getByTestId('dashboard-preview-widget-w1'), { key: 'ArrowRight' });
      expect(onWidgetClick).toHaveBeenCalledWith('w2');
    });

    it('should select previous widget with ArrowLeft', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId="w2"
          onWidgetClick={onWidgetClick}
        />,
      );

      fireEvent.keyDown(screen.getByTestId('dashboard-preview-widget-w2'), { key: 'ArrowLeft' });
      expect(onWidgetClick).toHaveBeenCalledWith('w1');
    });

    it('should deselect with Escape', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId="w1"
          onWidgetClick={onWidgetClick}
        />,
      );

      fireEvent.keyDown(screen.getByTestId('dashboard-preview-widget-w1'), { key: 'Escape' });
      expect(onWidgetClick).toHaveBeenCalledWith(null);
    });

    it('should select with Enter key', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={onWidgetClick}
        />,
      );

      fireEvent.keyDown(screen.getByTestId('dashboard-preview-widget-w2'), { key: 'Enter' });
      expect(onWidgetClick).toHaveBeenCalledWith('w2');
    });

    it('should select with Space key', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={onWidgetClick}
        />,
      );

      fireEvent.keyDown(screen.getByTestId('dashboard-preview-widget-w1'), { key: ' ' });
      expect(onWidgetClick).toHaveBeenCalledWith('w1');
    });
  });

  describe('Content pointer-events in design mode', () => {
    it('should apply pointer-events-none to widget content in design mode', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      // Card widget (bar chart) — content wrapper should have pointer-events-none
      const barWidget = screen.getByTestId('dashboard-preview-widget-w2');
      const contentWrapper = barWidget.querySelector('.pointer-events-none');
      expect(contentWrapper).toBeInTheDocument();
    });

    it('should apply pointer-events-none to self-contained (metric) widget content', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      // Metric widget — SchemaRenderer receives pointer-events-none className
      const metricWidget = screen.getByTestId('dashboard-preview-widget-w1');
      const contentWrapper = metricWidget.querySelector('.pointer-events-none');
      expect(contentWrapper).toBeInTheDocument();
    });

    it('should NOT apply pointer-events-none when not in design mode', () => {
      const { container } = render(<DashboardRenderer schema={DASHBOARD_WITH_WIDGETS} />);

      // No design-mode content wrapper should have pointer-events-none class.
      // Empty-value cell placeholders use pointer-events-none for accessibility
      // (so they don't intercept row clicks); they are unrelated to design mode.
      expect(container.querySelector('.pointer-events-none:not([data-slot="empty-value"])')).not.toBeInTheDocument();
    });

    it('should still call onWidgetClick when clicking on Card-based widget content area', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={onWidgetClick}
        />,
      );

      // Click on the bar chart widget (Card-based)
      fireEvent.click(screen.getByTestId('dashboard-preview-widget-w2'));
      expect(onWidgetClick).toHaveBeenCalledWith('w2');
    });

    it('should still call onWidgetClick when clicking on table widget', () => {
      const onWidgetClick = vi.fn();
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={onWidgetClick}
        />,
      );

      // Click on the table widget (Card-based)
      fireEvent.click(screen.getByTestId('dashboard-preview-widget-w3'));
      expect(onWidgetClick).toHaveBeenCalledWith('w3');
    });
  });

  describe('Click-capture overlay in design mode', () => {
    it('should render a click-capture overlay on Card-based widgets in design mode', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      // Card widget (bar chart) — should have an absolute overlay div
      const barWidget = screen.getByTestId('dashboard-preview-widget-w2');
      const overlay = barWidget.querySelector('[data-testid="widget-click-overlay"]');
      expect(overlay).toBeInTheDocument();
      expect(overlay?.className).toContain('absolute');
      expect(overlay?.className).toContain('inset-0');
      expect(overlay?.className).toContain('z-10');
    });

    it('should render a click-capture overlay on self-contained widgets in design mode', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      // Metric widget — should have an absolute overlay div
      const metricWidget = screen.getByTestId('dashboard-preview-widget-w1');
      const overlay = metricWidget.querySelector('[data-testid="widget-click-overlay"]');
      expect(overlay).toBeInTheDocument();
      expect(overlay?.className).toContain('absolute');
      expect(overlay?.className).toContain('inset-0');
      expect(overlay?.className).toContain('z-10');
    });

    it('should NOT render overlays when not in design mode', () => {
      const { container } = render(<DashboardRenderer schema={DASHBOARD_WITH_WIDGETS} />);

      expect(container.querySelector('[data-testid="widget-click-overlay"]')).not.toBeInTheDocument();
    });

    it('should apply relative positioning to widget container in design mode', () => {
      render(
        <DashboardRenderer
          schema={DASHBOARD_WITH_WIDGETS}
          designMode
          selectedWidgetId={null}
          onWidgetClick={vi.fn()}
        />,
      );

      // Card widget should have relative for overlay positioning
      const barWidget = screen.getByTestId('dashboard-preview-widget-w2');
      expect(barWidget.className).toContain('relative');

      // Metric widget should have relative for overlay positioning
      const metricWidget = screen.getByTestId('dashboard-preview-widget-w1');
      expect(metricWidget.className).toContain('relative');
    });
  });

  describe('Non-design mode behavior', () => {
    it('should not add design mode attributes when designMode is off', () => {
      const { container } = render(<DashboardRenderer schema={DASHBOARD_WITH_WIDGETS} />);

      // No widget should have data-widget-id
      expect(container.querySelector('[data-widget-id]')).not.toBeInTheDocument();
      // No widget should have role=button
      expect(container.querySelector('[role="button"]')).not.toBeInTheDocument();
    });
  });
});
