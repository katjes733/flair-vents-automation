import { useCallback, useState } from "react";

interface ChartMouseEvent {
  activeLabel?: string | number;
}

export interface DragZoom {
  zoomDomain: [number, number] | null;
  dragStart: number | null;
  dragEnd: number | null;
  handleMouseDown: (e: ChartMouseEvent) => void;
  handleMouseMove: (e: ChartMouseEvent) => void;
  handleMouseUp: () => void;
  resetZoom: () => void;
}

// Ported verbatim from tesla-powerwall-automation's own chart building
// blocks (see "Stage 13, Increment B" in the implementation plan). Drag-to-
// select zoom for Recharts: wire handleMouseDown/Move/Up to the chart's
// onMouseDown/onMouseMove/onMouseUp (Recharts forwards touch drags through
// the same handlers), then filter the chart's data to zoomDomain when set.
export function useDragZoom(minSelectionWidth: number): DragZoom {
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  const handleMouseDown = useCallback((e: ChartMouseEvent) => {
    if (e.activeLabel != null) {
      setDragStart(Number(e.activeLabel));
      setDragEnd(null);
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: ChartMouseEvent) => {
      if (dragStart != null && e.activeLabel != null) {
        setDragEnd(Number(e.activeLabel));
      }
    },
    [dragStart],
  );

  const handleMouseUp = useCallback(() => {
    if (dragStart != null && dragEnd != null && dragStart !== dragEnd) {
      const from = Math.min(dragStart, dragEnd);
      const to = Math.max(dragStart, dragEnd);
      if (to - from >= minSelectionWidth) setZoomDomain([from, to]);
    }
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd, minSelectionWidth]);

  const resetZoom = useCallback(() => setZoomDomain(null), []);

  return {
    zoomDomain,
    dragStart,
    dragEnd,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    resetZoom,
  };
}
