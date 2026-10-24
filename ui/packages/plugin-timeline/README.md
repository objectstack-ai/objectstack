# @object-ui/plugin-timeline

Timeline component plugin for Object UI with support for vertical, horizontal, and Gantt-style timelines.

## Installation

```bash
npm install @object-ui/plugin-timeline
```

## Usage

### Vertical Timeline

```tsx
import {
  Timeline,
  TimelineItem,
  TimelineMarker,
  TimelineContent,
  TimelineTitle,
  TimelineTime,
  TimelineDescription
} from '@object-ui/plugin-timeline';

function App() {
  return (
    <Timeline>
      <TimelineItem>
        <TimelineMarker variant="success" />
        <TimelineContent>
          <TimelineTime>2024-01-15</TimelineTime>
          <TimelineTitle>Project Started</TimelineTitle>
          <TimelineDescription>
            Kickoff meeting and initial planning
          </TimelineDescription>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  );
}
```

### Gantt Timeline

```tsx
import {
  TimelineGantt,
  TimelineGanttHeader,
  TimelineGanttRow,
  TimelineGanttBar
} from '@object-ui/plugin-timeline';

// See examples in the source code for Gantt usage
```

## Schema-Driven Usage

This plugin automatically registers with ObjectUI's component registry when imported:

```tsx
import '@object-ui/plugin-timeline';

const schema = {
  type: 'timeline',
  variant: 'vertical',
  items: [
    {
      time: '2024-01-15',
      title: 'Project Started',
      description: 'Kickoff meeting',
      variant: 'success'
    }
  ]
};
```

### Object-bound timeline (`object-timeline`)

`object-timeline` fetches records from `objectName` and draws one entry per
record, from the fields its `timeline` config names. An authored node takes its
props in the `properties` bag, where `@objectstack/spec`'s
`ComponentPropsMap['object-timeline']` row declares them:

```json
{
  "type": "object-timeline",
  "properties": {
    "objectName": "project_task",
    "timeline": { "startDateField": "start_date", "titleField": "name" },
    "navigation": { "mode": "drawer" }
  }
}
```

The first record source present wins: `items` (authored entries, drawn as
written), then `data` (pre-fetched records), then a `bind` path, then the query
on `objectName`. So `objectName` is optional: a timeline drawn from `items`,
`data` or a `bind` path needs none to draw (entry-click navigation still reads
it, below), and a node-level `dataSource` binding can supply the object instead. Records are composed into entries through the
`timeline` block's field bindings (`startDateField`, `endDateField`,
`titleField`, `groupByField`, `colorField`), each of which outranks the flat
key of the same binding; `mapping` (`{ title, date, description, variant }`)
is read where the block leaves a binding unset, and `descriptionField` names
the description field (`mapping.description` outranks it). `limit` caps the
query (`$top`, default 100), and `filter` / `sort` lower to `$filter` /
`$orderby` on it; the rail still draws composed entries by start date.
`dateFormat` is `short`, `long` or `iso`. Without a `groupByField`, entries
group into date buckets (Earlier, Today, Tomorrow, This week, Next week, Later,
No date), and "This week" starts on the first day of the week of the display
locale: Sunday under `en-US`, Monday under `en-GB` or `zh-CN`. `rowLabel`, `minDate`, `maxDate` and
`timeline.scale` are read by the gantt branch only, which on this block draws
authored `items`.

`navigation` is what an entry click opens — the spec's `NavigationConfig` by
reference, `ViewNavigationConfig` in `@object-ui/types`: `mode` (`page`,
`drawer`, `modal`, `split`, `popover`, `new_window` or `none`) with `size`,
`openNewTab` and `preventNavigation`. `drawer`, `modal` and `popover` open the
entry's record in that overlay, `new_window` and `openNewTab: true` open the
record page in a new tab, `preventNavigation: true` opens nothing, and `size`
sets the overlay width. `page`, and a block written without `mode` (it takes
the spec's `page` default), open the record page of the timeline's `objectName`
through the record navigator the host publishes (the console publishes one on
its custom pages, record pages and list views); under a host that publishes
none, such as an embedded renderer, or on a timeline that names no
`objectName`, the click opens nothing. On a timeline that names no
`objectName`, `new_window` and `openNewTab: true` open no record page either:
the tab opens at a slash and the entry's `id` alone (its `_id` when it has no
`id`, `undefined` when it has neither). A click handler from a parent view
outranks the whole key. ⚠️ With the key absent a click opens nothing: this renderer supplies no
drawer default. `split` opens nothing on this block either, because the
timeline gives the split shell no main panel.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-timeline)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-timeline)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT © ObjectStack Inc.
