/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useRef } from 'react';

export interface PanZoomState {
  /** Current zoom level */
  zoom: number;
  /** Current pan offset */
  panOffset: { x: number; y: number };
  /** Zoom in */
  zoomIn: () => void;
  /** Zoom out */
  zoomOut: () => void;
  /** Reset zoom to 1x */
  resetZoom: () => void;
  /** Set zoom to specific value */
  setZoom: (zoom: number) => void;
  /** Handle wheel event for zoom */
  handleWheel: (e: React.WheelEvent) => void;
  /** Start panning (on mouse down with space or middle button) */
  startPan: (e: React.MouseEvent) => void;
  /** Get transform style for the canvas */
  transformStyle: React.CSSProperties;
}

export interface PanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  initialZoom?: number;
}

/**
 * Hook for canvas pan and zoom functionality.
 */
export function useCanvasPanZoom(options: PanZoomOptions = {}): PanZoomState {
  const { minZoom = 0.25, maxZoom = 3, zoomStep = 0.1, initialZoom = 1 } = options;
  const [zoom, setZoomState] = useState(initialZoom);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef({ x: 0, y: 0 });

  const clampZoom = useCallback((z: number) => Math.min(maxZoom, Math.max(minZoom, +z.toFixed(2))), [minZoom, maxZoom]);

  const zoomIn = useCallback(() => setZoomState((z) => clampZoom(z + zoomStep)), [clampZoom, zoomStep]);
  const zoomOut = useCallback(() => setZoomState((z) => clampZoom(z - zoomStep)), [clampZoom, zoomStep]);
  const resetZoom = useCallback(() => { setZoomState(1); setPanOffset({ x: 0, y: 0 }); }, []);
  const setZoom = useCallback((z: number) => setZoomState(clampZoom(z)), [clampZoom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
      setZoomState((z) => clampZoom(z + delta));
    }
  }, [clampZoom, zoomStep]);

  const startPan = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isPanningRef.current = true;
      lastPanPosRef.current = { x: e.clientX, y: e.clientY };

      const handleMouseMove = (me: MouseEvent) => {
        if (!isPanningRef.current) return;
        const dx = me.clientX - lastPanPosRef.current.x;
        const dy = me.clientY - lastPanPosRef.current.y;
        lastPanPosRef.current = { x: me.clientX, y: me.clientY };
        setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      };

      const handleMouseUp = () => {
        isPanningRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
  }, []);

  const transformStyle: React.CSSProperties = {
    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
    transformOrigin: '0 0',
  };

  return {
    zoom,
    panOffset,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
    handleWheel,
    startPan,
    transformStyle,
  };
}
