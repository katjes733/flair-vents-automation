import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Schedule, ScheduleEvent } from "~/client/api/schedulesApi";
import type { Zone } from "~/client/api/zonesApi";
import ScheduleMatrix from "~/client/components/dashboard/ScheduleMatrix";
import { buildColorByEventId } from "~/client/components/dashboard/scheduleEventColors";

interface ScheduleRoomsOverviewProps {
  schedule: Schedule;
  zones: Zone[];
  onEditEvent: (event: ScheduleEvent) => void;
}

/**
 * The whole-schedule review surface — one compact week-strip card per
 * room, rather than a single combined grid, so a room's own periods (and
 * its own resolved setpoints) are readable at a glance without needing to
 * cross-reference a shared legend. Only rooms assigned to at least one
 * period get a card — an unused room's card would just be an empty grid,
 * so it's left out rather than cluttering the overview with rooms that
 * aren't part of this schedule at all. Two rooms sharing the same period
 * always render the same color, since `colorByEventId` is computed once
 * across the *entire* schedule's events (not per room) and handed to
 * every card — see ScheduleMatrix's own doc comment.
 *
 * Cards lay out in a responsive CSS grid (`auto-fill`/`minmax`) rather
 * than a fixed column count: a narrow/mobile viewport naturally collapses
 * to one card per row, a wider desktop viewport fits several side by
 * side, with no separate mobile/desktop layout to keep in sync.
 */
export default function ScheduleRoomsOverview({
  schedule,
  zones,
  onEditEvent,
}: ScheduleRoomsOverviewProps) {
  const colorByEventId = buildColorByEventId(schedule.events);
  const zonesInUse = zones.filter((zone) =>
    schedule.events.some((e) =>
      e.zone_settings.some((r) => r.zone_id === zone.id),
    ),
  );

  if (zones.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No rooms configured yet.
      </Typography>
    );
  }

  if (zonesInUse.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No periods yet — add one above to start scheduling.
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 2,
      }}
    >
      {zonesInUse.map((zone) => {
        const events = schedule.events.filter((e) =>
          e.zone_settings.some((r) => r.zone_id === zone.id),
        );
        return (
          <Card key={zone.id} variant="outlined">
            <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {zone.name}
              </Typography>
              <ScheduleMatrix
                zoneId={zone.id}
                events={events}
                onEditEvent={onEditEvent}
                colorByEventId={colorByEventId}
              />
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}
