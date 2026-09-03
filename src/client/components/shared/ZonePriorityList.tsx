import { useState, type DragEvent } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import {
  computeDropSide,
  computeReorderedIndex,
  type DropTarget,
} from "~/client/components/shared/reorderDragLogic";
import { normalizeZonePriorityOrder } from "~/client/components/shared/zonePriorityOrder";

export interface ZonePriorityListOption {
  id: string;
  name: string;
}

interface ZonePriorityListProps {
  zones: ZonePriorityListOption[];
  value: string[];
  onChange: (order: string[]) => void;
}

/**
 * A shared, reorderable zone-priority list — drag-and-drop plus an
 * always-available up/down arrow fallback (touch, keyboard, or just a
 * more precise single-position move), both driving the exact same reorder
 * arithmetic (`reorderDragLogic.ts`, also used by ZoneGrid's dashboard
 * cards) so the two interaction paths can never diverge. Used both for
 * the global default `zone_priority_order` (System Parameters) and a
 * schedule event's own priority-order override (EventEditorDialog).
 * Purely controlled — no fetch/persist of its own, since its two callers
 * have entirely different persistence models (an immediate PATCH vs. a
 * dialog's local draft state saved later).
 */
export default function ZonePriorityList({
  zones,
  value,
  onChange,
}: ZonePriorityListProps) {
  const order = normalizeZonePriorityOrder(
    value,
    zones.map((z) => z.id),
  );
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  function endDrag(): void {
    setDraggingId(null);
    setDropTarget(null);
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, index: number): void {
    e.preventDefault();
    const side = computeDropSide(
      e.clientX,
      e.currentTarget.getBoundingClientRect(),
    );
    setDropTarget((prev) =>
      prev?.index === index && prev.side === side ? prev : { index, side },
    );
  }

  function handleDrop(): void {
    const target = dropTarget;
    const fromIndex = order.findIndex((id) => id === draggingId);
    endDrag();
    if (!target || fromIndex === -1) return;
    const insertAt = computeReorderedIndex(fromIndex, target);
    if (insertAt === null) return;
    const next = [...order];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(insertAt, 0, moved);
    onChange(next);
  }

  if (zones.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No zones to rank yet.
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      {order.map((zoneId, index) => {
        const zone = zonesById.get(zoneId);
        if (!zone) return null; // defensive — normalizeZonePriorityOrder already filters these out
        return (
          <Box
            key={zoneId}
            draggable
            onDragStart={() => setDraggingId(zoneId)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
            onDragEnd={endDrag}
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1,
              py: 0.5,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              opacity: draggingId === zoneId ? 0.5 : 1,
              bgcolor: "background.paper",
            }}
          >
            {draggingId &&
              draggingId !== zoneId &&
              dropTarget?.index === index && (
                <Box
                  aria-hidden
                  data-testid="priority-drop-indicator"
                  sx={{
                    position: "absolute",
                    left: 4,
                    right: 4,
                    height: 2,
                    borderRadius: 1,
                    bgcolor: "primary.main",
                    zIndex: 1,
                    ...(dropTarget.side === "before"
                      ? { top: -3 }
                      : { bottom: -3 }),
                  }}
                />
              )}
            <DragIndicatorIcon
              fontSize="small"
              color="disabled"
              sx={{ cursor: "grab" }}
            />
            <Typography variant="body2" sx={{ flexGrow: 1 }}>
              {index + 1}. {zone.name}
            </Typography>
            <IconButton
              size="small"
              aria-label={`Move ${zone.name} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={`Move ${zone.name} down`}
              disabled={index === order.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
    </Stack>
  );
}
