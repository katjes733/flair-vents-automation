import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import type { ScheduleEvent } from "~/client/api/schedulesApi";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import { asAbsoluteTemp, toDisplayAbsolute } from "~/shared/types/temperature";
import {
  computeDaySegments,
  resolveDayOverlaps,
  MINUTES_PER_DAY,
} from "~/client/components/dashboard/scheduleMatrixLayout";
import { buildColorByEventId } from "~/client/components/dashboard/scheduleEventColors";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_MARKS = [0, 6, 12, 18, 24];
const HOUR_GUIDES = [6, 12, 18];
const ROW_HEIGHT = 28;
const DAY_LABEL_WIDTH = 28;

function percentOfDay(minutes: number): string {
  return `${(minutes / MINUTES_PER_DAY) * 100}%`;
}

function formatHourMark(hour: number): string {
  if (hour === 0 || hour === 24) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

interface ScheduleMatrixProps {
  /** Which zone this strip belongs to — used to resolve/display that zone's own cool/heat values per block. */
  zoneId: string;
  /** Already filtered to events where this zone is assigned (has a `zone_settings` row) — this component does no membership filtering itself. */
  events: ScheduleEvent[];
  onEditEvent: (event: ScheduleEvent) => void;
  /**
   * Precomputed once across an entire schedule's events, not just this
   * room's — so two rooms sharing the same period render the same color.
   * Falls back to computing it from `events` alone (this room's own
   * events) when the caller doesn't supply one, so this component still
   * works standalone.
   */
  colorByEventId?: Map<string, string>;
}

/**
 * One room's compact week strip — days of week stacked as rows (Sun top
 * to Sat bottom), hours running left to right, matching how Flair's own
 * app lays this out. Color-coded per event, with overlap conflicts made
 * visible rather than silently resolved: the segment that would actually
 * govern a given moment (per eventBeats — fewer days_of_week bits, then
 * most-recently-edited) renders solid, and whatever portion of a losing
 * event's own block is actually contested renders hatched. Each block
 * also shows this room's own resolved cool/heat values for that period.
 * Click a block to edit that event. Used once per room by
 * ScheduleRoomsOverview, which hands every room the same
 * `colorByEventId` map so a shared period renders the same color
 * everywhere it appears.
 */
export default function ScheduleMatrix({
  zoneId,
  events,
  onEditEvent,
  colorByEventId: colorByEventIdProp,
}: ScheduleMatrixProps) {
  const { temperatureUnit } = useDisplayUnit();
  const colorByEventId = colorByEventIdProp ?? buildColorByEventId(events);
  const segments = computeDaySegments(events);

  function blockLabel(event: ScheduleEvent): string {
    if (event.mode === "inactive") return "Inactive";
    const row = event.zone_settings.find((r) => r.zone_id === zoneId);
    if (
      !row ||
      row.cool_setpoint === undefined ||
      row.heat_setpoint === undefined
    ) {
      return "";
    }
    const cool = Math.round(
      toDisplayAbsolute(asAbsoluteTemp(row.cool_setpoint), temperatureUnit),
    );
    const heat = Math.round(
      toDisplayAbsolute(asAbsoluteTemp(row.heat_setpoint), temperatureUnit),
    );
    return `${cool}/${heat}`;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", pl: `${DAY_LABEL_WIDTH + 4}px`, mb: 0.25 }}>
        {HOUR_MARKS.map((h) => (
          <Typography
            key={h}
            variant="caption"
            color="text.secondary"
            sx={{
              flex: h === 0 || h === 24 ? 0.5 : 1,
              fontSize: "0.6rem",
              textAlign:
                h === 0 ? "left" : h === 24 ? "right" : ("center" as const),
            }}
          >
            {formatHourMark(h)}
          </Typography>
        ))}
      </Box>

      {DAY_LABELS.map((dayLabel, day) => {
        const daySegments = segments.filter((s) => s.day === day);
        const rendered = resolveDayOverlaps(daySegments);
        return (
          <Box
            key={day}
            sx={{ display: "flex", alignItems: "center", mb: "2px" }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                width: DAY_LABEL_WIDTH,
                flexShrink: 0,
                fontSize: "0.65rem",
              }}
            >
              {dayLabel}
            </Typography>
            <Box
              sx={{
                position: "relative",
                flexGrow: 1,
                height: ROW_HEIGHT,
                bgcolor: "action.hover",
                borderRadius: 0.5,
                overflow: "hidden",
              }}
            >
              {HOUR_GUIDES.map((h) => (
                <Box
                  key={h}
                  aria-hidden
                  sx={{
                    position: "absolute",
                    left: percentOfDay(h * 60),
                    top: 0,
                    bottom: 0,
                    borderLeft: "1px dashed",
                    borderColor: "divider",
                    opacity: 0.5,
                  }}
                />
              ))}

              {rendered.map(({ segment, solidRanges, hatchedRanges }, i) => {
                const color = colorByEventId.get(segment.event.id) ?? "#757575";
                const isInactive = segment.event.mode === "inactive";
                const span = segment.endMinutes - segment.startMinutes;
                const label = blockLabel(segment.event);
                return (
                  <Tooltip
                    key={`${segment.event.id}-${i}`}
                    title={`${segment.event.mode === "inactive" ? "Inactive" : "Active"} · ${segment.event.start_time}–${segment.event.end_time}${label && !isInactive ? ` · ${label}°${temperatureUnit}` : ""}`}
                  >
                    <Box
                      role="button"
                      aria-label={`Edit event, ${segment.event.start_time} to ${segment.event.end_time}`}
                      tabIndex={0}
                      onClick={() => onEditEvent(segment.event)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          onEditEvent(segment.event);
                        }
                      }}
                      sx={{
                        position: "absolute",
                        top: 1,
                        bottom: 1,
                        left: percentOfDay(segment.startMinutes),
                        width: percentOfDay(span),
                        cursor: "pointer",
                      }}
                    >
                      {solidRanges.map((r, j) => (
                        <Box
                          key={`solid-${j}`}
                          sx={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: `${((r.start - segment.startMinutes) / span) * 100}%`,
                            width: `${((r.end - r.start) / span) * 100}%`,
                            bgcolor: isInactive
                              ? "action.disabledBackground"
                              : color,
                            opacity: isInactive ? 0.6 : 0.85,
                            borderRadius: 0.5,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          {!isInactive && label && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: "common.white",
                                fontSize: "0.6rem",
                                lineHeight: 1,
                                px: 0.25,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {label}
                            </Typography>
                          )}
                        </Box>
                      ))}
                      {hatchedRanges.map((r, j) => (
                        <Box
                          key={`hatch-${j}`}
                          data-testid="matrix-hatched-range"
                          sx={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: `${((r.start - segment.startMinutes) / span) * 100}%`,
                            width: `${((r.end - r.start) / span) * 100}%`,
                            background: `repeating-linear-gradient(45deg, ${color}, ${color} 4px, transparent 4px, transparent 8px)`,
                            opacity: 0.6,
                            borderRadius: 0.5,
                          }}
                        />
                      ))}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
