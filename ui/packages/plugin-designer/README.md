# @object-ui/plugin-designer

Visual designers for Object UI — page, data model, process, and report designers.

## Features

- 🎨 **Page Designer** - Drag-and-drop page builder with component tree
- 🗄️ **Data Model Designer** - Entity-relationship diagram editor with auto-layout
- ⚙️ **Process Designer** - BPMN-style process flow editor with minimap
- 📝 **Report Designer** - Visual report layout builder with sections
- ↩️ **Undo/Redo** - Full undo/redo history via `useUndoRedo`
- 📋 **Clipboard** - Copy/paste inside the designer canvases
- 🔲 **Multi-Select** - Bulk selection inside the designer canvases
- 🔍 **Canvas Pan/Zoom** - Smooth pan and zoom on the page, data model and process canvases
- 🗺️ **Minimap** - Overview minimap for large canvases
- 📦 **Auto-registered** - Components register with `ComponentRegistry` on import

## Installation

```bash
npm install @object-ui/plugin-designer
```

**Peer Dependencies:**
- `react` ^19.0.0
- `react-dom` ^19.0.0
- `react-router-dom` ^6.0.0 || ^7.0.0

## Quick Start

```tsx
import { PageDesigner } from '@object-ui/plugin-designer';
import type { DesignerComponent } from '@object-ui/types';

const componentList: DesignerComponent[] = [
  {
    id: 'headline',
    type: 'text',
    label: 'Headline',
    position: { x: 0, y: 0, width: 480, height: 48 },
    props: { value: 'Welcome' },
  },
];

function DesignerApp() {
  return (
    <PageDesigner
      components={componentList}
      showComponentTree
      undoRedo
    />
  );
}
```

## API

### PageDesigner

Drag-and-drop page layout builder:

```tsx
import { PageDesigner } from '@object-ui/plugin-designer';
import type { DesignerCanvasConfig, DesignerComponent } from '@object-ui/types';

declare const canvasConfig: DesignerCanvasConfig;
declare const componentList: DesignerComponent[];

<PageDesigner
  canvas={canvasConfig}
  components={componentList}
  showComponentTree
  undoRedo
  readOnly={false}
/>;
```

### DataModelDesigner

Entity-relationship diagram editor:

```tsx
import { DataModelDesigner } from '@object-ui/plugin-designer';
import type { DataModelEntity, DataModelRelationship } from '@object-ui/types';

declare const entities: DataModelEntity[];
declare const relationships: DataModelRelationship[];

<DataModelDesigner entities={entities} relationships={relationships} />;
```

### ProcessDesigner

BPMN-style process flow editor:

```tsx
import { ProcessDesigner } from '@object-ui/plugin-designer';
import type { BPMNEdge, BPMNNode } from '@object-ui/types';

declare const nodes: BPMNNode[];
declare const edges: BPMNEdge[];

<ProcessDesigner
  processName="Order Approval"
  nodes={nodes}
  edges={edges}
  showMinimap
  showToolbar
/>;
```

### ReportDesigner

Visual report layout builder:

```tsx
import { ReportDesigner } from '@object-ui/plugin-designer';
import type { ReportDesignerSection } from '@object-ui/types';

declare const sections: ReportDesignerSection[];

<ReportDesigner reportName="Sales Report" objectName="Order" sections={sections} />;
```

### Shared Hooks

```tsx
import { useUndoRedo } from '@object-ui/plugin-designer';

import type { DesignerComponent } from '@object-ui/types';

const { undo, redo, canUndo, canRedo } = useUndoRedo<DesignerComponent[]>([]);
```

### Shared Components

```tsx
import { ConfirmDialog, Minimap } from '@object-ui/plugin-designer';
```

## Links

- 📚 [Documentation](https://objectstack.ai/docs/frontend/plugins)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-designer)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectstack/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectstack/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
