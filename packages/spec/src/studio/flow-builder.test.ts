import { describe, it, expect } from 'vitest';
import {
  FlowNodeShapeSchema,
  FlowNodeRenderDescriptorSchema,
  FlowCanvasNodeSchema,
  FlowCanvasEdgeStyleSchema,
  FlowCanvasEdgeSchema,
  FlowLayoutAlgorithmSchema,
  FlowLayoutDirectionSchema,
  FlowBuilderConfigSchema,
  BUILT_IN_NODE_DESCRIPTORS,
  defineFlowBuilderConfig,
  type FlowBuilderConfig,
  type FlowNodeRenderDescriptor,
  type FlowCanvasNode,
  type FlowCanvasEdge,
} from './flow-builder.zod';

// ---------------------------------------------------------------------------
// FlowNodeShapeSchema
// ---------------------------------------------------------------------------
describe('FlowNodeShapeSchema', () => {
  it('should accept all valid shapes', () => {
    const shapes = [
      'rounded_rect', 'circle', 'diamond', 'parallelogram',
      'hexagon', 'diamond_thick', 'attached_circle', 'screen_rect',
    ];
    shapes.forEach(s => {
      expect(FlowNodeShapeSchema.parse(s)).toBe(s);
    });
  });

  it('should reject invalid shape', () => {
    expect(() => FlowNodeShapeSchema.parse('triangle')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FlowNodeRenderDescriptorSchema
// ---------------------------------------------------------------------------
describe('FlowNodeRenderDescriptorSchema', () => {
  it('should accept a valid descriptor', () => {
    const desc: FlowNodeRenderDescriptor = FlowNodeRenderDescriptorSchema.parse({
      action: 'parallel_gateway',
      shape: 'diamond_thick',
      icon: 'git-fork',
      defaultLabel: 'Parallel Gateway',
      paletteCategory: 'gateway',
    });
    expect(desc.action).toBe('parallel_gateway');
    expect(desc.shape).toBe('diamond_thick');
    expect(desc.defaultWidth).toBe(120); // default
    expect(desc.defaultHeight).toBe(60); // default
    expect(desc.allowBoundaryEvents).toBe(false); // default
  });

  it('should accept custom sizes and colors', () => {
    const desc = FlowNodeRenderDescriptorSchema.parse({
      action: 'wait',
      shape: 'hexagon',
      icon: 'clock',
      defaultLabel: 'Wait',
      defaultWidth: 100,
      defaultHeight: 60,
      fillColor: '#f3e8ff',
      borderColor: '#7c3aed',
      allowBoundaryEvents: true,
      paletteCategory: 'event',
    });
    expect(desc.fillColor).toBe('#f3e8ff');
    expect(desc.allowBoundaryEvents).toBe(true);
  });

  it('should reject without required fields', () => {
    expect(() => FlowNodeRenderDescriptorSchema.parse({})).toThrow();
    expect(() => FlowNodeRenderDescriptorSchema.parse({ action: 'start' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FlowCanvasNodeSchema
// ---------------------------------------------------------------------------
describe('FlowCanvasNodeSchema', () => {
  it('should accept minimal canvas node', () => {
    const node: FlowCanvasNode = FlowCanvasNodeSchema.parse({
      nodeId: 'node_1',
      x: 100,
      y: 200,
    });
    expect(node.nodeId).toBe('node_1');
    expect(node.x).toBe(100);
    expect(node.y).toBe(200);
    expect(node.collapsed).toBe(false); // default
  });

  it('should accept full canvas node with overrides', () => {
    const node = FlowCanvasNodeSchema.parse({
      nodeId: 'parallel_1',
      x: 300,
      y: 150,
      width: 80,
      height: 80,
      collapsed: false,
      fillColor: '#dbeafe',
      borderColor: '#2563eb',
      annotation: 'All departments review in parallel',
    });
    expect(node.width).toBe(80);
    expect(node.annotation).toBe('All departments review in parallel');
  });

  it('should reject without position', () => {
    expect(() => FlowCanvasNodeSchema.parse({ nodeId: 'n1' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FlowCanvasEdgeSchema
// ---------------------------------------------------------------------------
describe('FlowCanvasEdgeSchema', () => {
  it('should accept minimal edge', () => {
    const edge: FlowCanvasEdge = FlowCanvasEdgeSchema.parse({
      edgeId: 'edge_1',
    });
    expect(edge.style).toBe('solid'); // default
    expect(edge.labelPosition).toBe(0.5); // default
    expect(edge.animated).toBe(false); // default
  });

  it('should accept all edge styles', () => {
    const styles = ['solid', 'dashed', 'dotted', 'bold', 'back'];
    styles.forEach(s => {
      expect(FlowCanvasEdgeStyleSchema.parse(s)).toBe(s);
    });
  });

  it('should accept edge with waypoints', () => {
    const edge = FlowCanvasEdgeSchema.parse({
      edgeId: 'edge_fault',
      style: 'bold',
      color: '#dc2626',
      waypoints: [
        { x: 100, y: 200 },
        { x: 150, y: 250 },
        { x: 200, y: 200 },
      ],
      animated: true,
    });
    expect(edge.waypoints).toHaveLength(3);
    expect(edge.animated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FlowLayoutAlgorithmSchema & FlowLayoutDirectionSchema
// ---------------------------------------------------------------------------
describe('FlowLayoutAlgorithmSchema', () => {
  it('should accept all algorithms', () => {
    ['dagre', 'elk', 'force', 'manual'].forEach(a => {
      expect(FlowLayoutAlgorithmSchema.parse(a)).toBe(a);
    });
  });
});

describe('FlowLayoutDirectionSchema', () => {
  it('should accept all directions', () => {
    ['TB', 'BT', 'LR', 'RL'].forEach(d => {
      expect(FlowLayoutDirectionSchema.parse(d)).toBe(d);
    });
  });
});

// ---------------------------------------------------------------------------
// FlowBuilderConfigSchema
// ---------------------------------------------------------------------------
describe('FlowBuilderConfigSchema', () => {
  it('should accept empty config with defaults', () => {
    const config: FlowBuilderConfig = FlowBuilderConfigSchema.parse({});
    expect(config.snap.enabled).toBe(true);
    expect(config.snap.gridSize).toBe(16);
    expect(config.zoom.min).toBe(0.25);
    expect(config.layoutAlgorithm).toBe('dagre');
    expect(config.layoutDirection).toBe('TB');
    expect(config.showMinimap).toBe(true);
    expect(config.showPropertyPanel).toBe(true);
    expect(config.showPalette).toBe(true);
    expect(config.undoLimit).toBe(50);
    expect(config.animateExecution).toBe(true);
    expect(config.connectionValidation).toBe(true);
  });

  it('should accept full custom config', () => {
    const config = FlowBuilderConfigSchema.parse({
      snap: { enabled: true, gridSize: 20, showGrid: false },
      zoom: { min: 0.5, max: 5, default: 1, step: 0.25 },
      layoutAlgorithm: 'elk',
      layoutDirection: 'LR',
      nodeDescriptors: [
        {
          action: 'custom_node',
          shape: 'rounded_rect',
          icon: 'box',
          defaultLabel: 'Custom',
          paletteCategory: 'activity',
        },
      ],
      showMinimap: false,
      showPropertyPanel: true,
      showPalette: true,
      undoLimit: 100,
      animateExecution: false,
      connectionValidation: true,
    });

    expect(config.snap.gridSize).toBe(20);
    expect(config.layoutAlgorithm).toBe('elk');
    expect(config.nodeDescriptors).toHaveLength(1);
    expect(config.undoLimit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// BUILT_IN_NODE_DESCRIPTORS
// ---------------------------------------------------------------------------
describe('BUILT_IN_NODE_DESCRIPTORS', () => {
  it('should have descriptors for all standard node types', () => {
    const actions = BUILT_IN_NODE_DESCRIPTORS.map(d => d.action);
    expect(actions).toContain('start');
    expect(actions).toContain('end');
    expect(actions).toContain('decision');
    expect(actions).toContain('parallel_gateway');
    expect(actions).toContain('join_gateway');
    expect(actions).toContain('wait');
    expect(actions).toContain('boundary_event');
    expect(actions).toContain('assignment');
    expect(actions).toContain('create_record');
    expect(actions).toContain('update_record');
    expect(actions).toContain('delete_record');
    expect(actions).toContain('get_record');
    expect(actions).toContain('http_request');
    expect(actions).toContain('script');
    expect(actions).toContain('screen');
    expect(actions).toContain('loop');
    expect(actions).toContain('subflow');
    expect(actions).toContain('connector_action');
    expect(BUILT_IN_NODE_DESCRIPTORS).toHaveLength(18);
  });

  it('should validate all built-in descriptors against schema', () => {
    BUILT_IN_NODE_DESCRIPTORS.forEach(desc => {
      expect(() => FlowNodeRenderDescriptorSchema.parse(desc)).not.toThrow();
    });
  });

  it('should use diamond_thick for parallel and join gateways', () => {
    const parallel = BUILT_IN_NODE_DESCRIPTORS.find(d => d.action === 'parallel_gateway');
    const join = BUILT_IN_NODE_DESCRIPTORS.find(d => d.action === 'join_gateway');
    expect(parallel?.shape).toBe('diamond_thick');
    expect(join?.shape).toBe('diamond_thick');
  });

  it('should use attached_circle for boundary events', () => {
    const boundary = BUILT_IN_NODE_DESCRIPTORS.find(d => d.action === 'boundary_event');
    expect(boundary?.shape).toBe('attached_circle');
  });

  it('should mark activity nodes as allowing boundary events', () => {
    const activities = BUILT_IN_NODE_DESCRIPTORS.filter(d =>
      ['assignment', 'http_request', 'script', 'create_record', 'update_record', 'delete_record', 'get_record', 'loop', 'subflow', 'connector_action', 'wait'].includes(d.action)
    );
    activities.forEach(a => {
      expect(a.allowBoundaryEvents).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// defineFlowBuilderConfig
// ---------------------------------------------------------------------------
describe('defineFlowBuilderConfig', () => {
  it('should return validated config', () => {
    const config = defineFlowBuilderConfig({
      layoutAlgorithm: 'dagre',
      layoutDirection: 'LR',
      showMinimap: true,
    });
    expect(config.layoutAlgorithm).toBe('dagre');
    expect(config.layoutDirection).toBe('LR');
    expect(config.snap.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BPMN Parallel / Join / Boundary Scenario
// ---------------------------------------------------------------------------
describe('Flow Builder — BPMN scenario', () => {
  it('should model a parallel approval flow on canvas', () => {
    // Place a parallel gateway, two activity branches, a join gateway
    const nodes: FlowCanvasNode[] = [
      FlowCanvasNodeSchema.parse({ nodeId: 'start', x: 50, y: 200 }),
      FlowCanvasNodeSchema.parse({ nodeId: 'parallel_split', x: 200, y: 200 }),
      FlowCanvasNodeSchema.parse({ nodeId: 'legal_review', x: 400, y: 100 }),
      FlowCanvasNodeSchema.parse({ nodeId: 'finance_review', x: 400, y: 300 }),
      FlowCanvasNodeSchema.parse({ nodeId: 'join_merge', x: 600, y: 200 }),
      FlowCanvasNodeSchema.parse({ nodeId: 'end', x: 750, y: 200 }),
    ];

    expect(nodes).toHaveLength(6);

    const edges: FlowCanvasEdge[] = [
      FlowCanvasEdgeSchema.parse({ edgeId: 'e1', style: 'solid' }),
      FlowCanvasEdgeSchema.parse({ edgeId: 'e2_legal', style: 'solid' }),
      FlowCanvasEdgeSchema.parse({ edgeId: 'e2_finance', style: 'solid' }),
      FlowCanvasEdgeSchema.parse({ edgeId: 'e3_legal', style: 'solid' }),
      FlowCanvasEdgeSchema.parse({ edgeId: 'e3_finance', style: 'solid' }),
      FlowCanvasEdgeSchema.parse({ edgeId: 'e4', style: 'solid' }),
    ];

    expect(edges).toHaveLength(6);
  });

  it('should model boundary events attached to activity nodes', () => {
    // An HTTP request node with a timer boundary event for timeout
    const httpNode = FlowCanvasNodeSchema.parse({
      nodeId: 'http_call',
      x: 300,
      y: 200,
      width: 120,
      height: 60,
    });

    const boundaryEvent = FlowCanvasNodeSchema.parse({
      nodeId: 'timeout_boundary',
      x: 370,   // Positioned on the bottom edge of the http node
      y: 250,
      width: 40,
      height: 40,
    });

    expect(httpNode.nodeId).toBe('http_call');
    expect(boundaryEvent.nodeId).toBe('timeout_boundary');

    // Fault edge from boundary to error handler
    const faultEdge = FlowCanvasEdgeSchema.parse({
      edgeId: 'e_fault',
      style: 'bold',
      color: '#dc2626',
    });
    expect(faultEdge.style).toBe('bold');
  });
});
