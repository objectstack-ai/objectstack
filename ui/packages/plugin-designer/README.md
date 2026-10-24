# @object-ui/plugin-designer

Visual designers for Object UI — page, data model, process, and report designers with collaboration support.

## Features

- 🎨 **Page Designer** - Drag-and-drop page builder with component tree
- 🗄️ **Data Model Designer** - Entity-relationship diagram editor with auto-layout
- ⚙️ **Process Designer** - BPMN-style process flow editor with minimap
- 📝 **Report Designer** - Visual report layout builder with sections
- 🤝 **Collaboration Provider** - Real-time multi-user editing with connection status
- ↩️ **Undo/Redo** - Full undo/redo history via `useUndoRedo`
- 📋 **Clipboard** - Copy/paste support via `useClipboard`
- 🔲 **Multi-Select** - Bulk selection via `useMultiSelect`
- 🔍 **Canvas Pan/Zoom** - Smooth pan and zoom via `useCanvasPanZoom`
- 🗺️ **Minimap** - Overview minimap for large canvases
- 📦 **Auto-registered** - Components register with `ComponentRegistry` on import

## Installation

```bash
npm install @object-ui/plugin-designer
```

**Peer Dependencies:**
- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0
- `react-router-dom` ^6.0.0 || ^7.0.0

## Quick Start

```tsx
import { CollaborationProvider, PageDesigner } from '@object-ui/plugin-designer';
import type { CollaborationConfig, DesignerComponent } from '@object-ui/types';

const collaboration: CollaborationConfig = {
  enabled: true,
  roomId: 'landing-page',
  showCursors: true,
};

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
    <CollaborationProvider config={collaboration}>
      <PageDesigner
        components={componentList}
        showComponentTree
        undoRedo
      />
    </CollaborationProvider>
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

### CollaborationProvider / ConnectionStatusIndicator

Multi-user real-time editing support:

```tsx
import {
  CollaborationProvider,
  ConnectionStatusIndicator,
  PageDesigner,
} from '@object-ui/plugin-designer';
import type { CollaborationConfig } from '@object-ui/types';

declare const collaboration: CollaborationConfig;

<CollaborationProvider config={collaboration}>
  <ConnectionStatusIndicator />
  <PageDesigner showComponentTree undoRedo />
</CollaborationProvider>;
```

### Shared Hooks

```tsx
import {
  useUndoRedo,
  useClipboard,
  useMultiSelect,
  useCanvasPanZoom,
  useConfirmDialog,
} from '@object-ui/plugin-designer';

import type { DesignerComponent } from '@object-ui/types';

const { undo, redo, canUndo, canRedo } = useUndoRedo<DesignerComponent[]>([]);
const { clipboard, copy, paste, hasContent } = useClipboard<DesignerComponent>();
const { selectedIds, selectOne, selectMany, clearSelection } = useMultiSelect();
const { zoom, panOffset, zoomIn, zoomOut, resetZoom } = useCanvasPanZoom();
const { confirm, isOpen } = useConfirmDialog();
```

### Shared Components

```tsx
import { ConfirmDialog, Minimap, PropertyEditor, VersionHistory } from '@object-ui/plugin-designer';
```

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-designer)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-designer)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
