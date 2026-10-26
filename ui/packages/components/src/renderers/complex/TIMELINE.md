# Timeline Component

A comprehensive, feature-rich timeline component for Object UI that supports three distinct variants: vertical, horizontal, and Gantt-style (Airtable-like) timelines.

## Features

- 🎯 **Three Variants**: Vertical, Horizontal, and Gantt/Airtable-style timelines
- 🎨 **Color Variants**: Support for default, success, warning, danger, and info colors
- 📅 **Date Formatting**: Configurable date formats (short, long, ISO)
- ⏱️ **Time Scales**: Gantt view supports day, week, and month scales
- 🔄 **Interactive**: Click handlers for timeline items
- 🎭 **Icon Support**: Add custom icons or emojis to timeline markers
- 📊 **Multi-track**: Gantt view supports multiple rows/tracks
- 🔢 **Auto-calculated**: Automatic date range calculation for Gantt view
- 💅 **Tailwind CSS**: Fully styled with Tailwind, customizable with className

## Installation

The timeline component is included in `@object-ui/components`.

```bash
npm install @object-ui/components @object-ui/react @object-ui/core
```

## Usage

### Vertical Timeline

Perfect for showing project milestones, history, or chronological events.

```json
{
  "type": "timeline",
  "variant": "vertical",
  "dateFormat": "long",
  "items": [
    {
      "time": "2024-01-15",
      "title": "Project Kickoff",
      "description": "Initial meeting with stakeholders and project planning",
      "variant": "success",
      "icon": "🚀"
    },
    {
      "time": "2024-02-01",
      "title": "Design Phase Complete",
      "description": "UI/UX designs approved and ready for development",
      "variant": "info",
      "icon": "🎨"
    },
    {
      "time": "2024-03-15",
      "title": "Beta Release",
      "description": "Internal testing phase begins",
      "variant": "warning",
      "icon": "⚡"
    },
    {
      "time": "2024-04-01",
      "title": "Official Launch",
      "description": "Product goes live to all users",
      "variant": "success",
      "icon": "🎉"
    }
  ]
}
```

### Horizontal Timeline

Ideal for roadmaps, quarterly plans, or linear progressions.

```json
{
  "type": "timeline",
  "variant": "horizontal",
  "dateFormat": "short",
  "items": [
    {
      "time": "2024-01-01",
      "title": "Q1 2024",
      "description": "Planning & Design",
      "variant": "success"
    },
    {
      "time": "2024-04-01",
      "title": "Q2 2024",
      "description": "Development",
      "variant": "info"
    },
    {
      "time": "2024-07-01",
      "title": "Q3 2024",
      "description": "Testing & QA",
      "variant": "warning"
    },
    {
      "time": "2024-10-01",
      "title": "Q4 2024",
      "description": "Launch & Scale",
      "variant": "success"
    }
  ]
}
```

### Gantt Timeline (Airtable Style)

Perfect for project management, resource planning, and multi-track timelines.

```json
{
  "type": "timeline",
  "variant": "gantt",
  "dateFormat": "short",
  "scale": "month",
  "rowLabel": "Project Tasks",
  "items": [
    {
      "label": "Backend Development",
      "items": [
        {
          "title": "API Design",
          "startDate": "2024-01-01",
          "endDate": "2024-01-31",
          "variant": "success"
        },
        {
          "title": "Database Schema",
          "startDate": "2024-01-15",
          "endDate": "2024-02-15",
          "variant": "info"
        },
        {
          "title": "API Implementation",
          "startDate": "2024-02-01",
          "endDate": "2024-03-31",
          "variant": "default"
        }
      ]
    },
    {
      "label": "Frontend Development",
      "items": [
        {
          "title": "UI Design",
          "startDate": "2024-01-15",
          "endDate": "2024-02-15",
          "variant": "warning"
        },
        {
          "title": "Component Library",
          "startDate": "2024-02-01",
          "endDate": "2024-03-15",
          "variant": "info"
        },
        {
          "title": "Integration",
          "startDate": "2024-03-01",
          "endDate": "2024-04-15",
          "variant": "default"
        }
      ]
    },
    {
      "label": "Testing & QA",
      "items": [
        {
          "title": "Unit Tests",
          "startDate": "2024-02-15",
          "endDate": "2024-03-15",
          "variant": "success"
        },
        {
          "title": "Integration Tests",
          "startDate": "2024-03-01",
          "endDate": "2024-04-01",
          "variant": "info"
        },
        {
          "title": "User Acceptance Testing",
          "startDate": "2024-04-01",
          "endDate": "2024-04-30",
          "variant": "danger"
        }
      ]
    }
  ]
}
```

## Props

### Common Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'vertical' \| 'horizontal' \| 'gantt'` | `'vertical'` | Timeline variant to render |
| `dateFormat` | `'short' \| 'long' \| 'iso'` | `'short'` | Date formatting style |
| `items` | `TimelineItem[]` | `[]` | Array of timeline items (structure varies by variant) |
| `className` | `string` | - | Additional CSS classes |

### Vertical/Horizontal Item Props

| Prop | Type | Description |
|------|------|-------------|
| `time` | `string` | ISO date string (e.g., "2024-01-15") |
| `title` | `string` | Item title |
| `description` | `string` | Item description |
| `variant` | `'default' \| 'success' \| 'warning' \| 'danger' \| 'info'` | Color variant |
| `icon` | `string` | Icon or emoji to display in marker |
| `content` | `SchemaNode` | Custom content schema |
| `className` | `string` | Additional CSS classes |

### Gantt-Specific Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `scale` | `'hour' \| 'day' \| 'week' \| 'month' \| 'quarter' \| 'year'` | `'month'` | Time scale for the timeline header. The pre-spec `timeScale` spelling is retired (objectui#6355) |
| `rowLabel` | `string` | `'Items'` | Label for the row header column |
| `minDate` | `string` | Auto-calculated | Override minimum date (YYYY-MM-DD) |
| `maxDate` | `string` | Auto-calculated | Override maximum date (YYYY-MM-DD) |

### Gantt Item Structure

```typescript
{
  label: string;          // Row label
  items: Array<{
    title: string;        // Bar label
    startDate: string;    // ISO date string
    endDate: string;      // ISO date string
    variant?: string;     // Color variant
  }>;
}
```

## Color Variants

The timeline component supports 5 color variants:

- `default` - Blue (default color)
- `success` - Green
- `warning` - Yellow/Orange
- `danger` - Red
- `info` - Purple

Each variant applies to markers (vertical/horizontal) or bars (Gantt).

## Date Formats

- `short` - MM/DD/YYYY (e.g., "1/15/2024")
- `long` - Month DD, YYYY (e.g., "January 15, 2024")
- `iso` - YYYY-MM-DD (e.g., "2024-01-15")

## Time Scales (Gantt Only)

- `day` - Daily granularity
- `week` - Weekly granularity
- `month` - Monthly granularity (default)

## Advanced Usage

### Custom Styling

Use Tailwind CSS classes for custom styling:

```json
{
  "type": "timeline",
  "variant": "vertical",
  "className": "max-w-3xl mx-auto",
  "items": [
    {
      "time": "2024-01-15",
      "title": "Custom Styled Item",
      "className": "bg-blue-50 p-4 rounded-lg",
      "variant": "info"
    }
  ]
}
```

### With Custom Content

You can add custom content schemas to vertical/horizontal timeline items:

```json
{
  "type": "timeline",
  "variant": "vertical",
  "items": [
    {
      "time": "2024-01-15",
      "title": "Custom Content",
      "content": [
        {
          "type": "button",
          "label": "View Details",
          "className": "mt-2"
        }
      ]
    }
  ]
}
```

### Interactive Items

Handle item clicks in Gantt view:

```typescript
// In React component
<SchemaRenderer 
  schema={{
    type: 'timeline',
    variant: 'gantt',
    onItemClick: (item, row, rowIndex, itemIndex) => {
      console.log('Clicked:', item.title, 'in row:', row.label);
    },
    items: [...]
  }}
/>
```

## UI Components

The timeline component is built using these base UI components:

### Vertical/Horizontal
- `Timeline` - Container
- `TimelineItem` - Individual item
- `TimelineMarker` - Marker/dot
- `TimelineContent` - Content wrapper
- `TimelineTitle` - Title heading
- `TimelineTime` - Time display
- `TimelineDescription` - Description text

### Gantt
- `TimelineGantt` - Container
- `TimelineGanttHeader` - Header with time scale
- `TimelineGanttRow` - Individual row
- `TimelineGanttLabel` - Row label
- `TimelineGanttBar` - Task bar
- `TimelineGanttBarContent` - Bar content/text

## Examples

See the [interactive documentation](https://www.objectui.org/docs/plugins/plugin-timeline) for comprehensive examples of all three timeline variants in action.

## License

MIT
