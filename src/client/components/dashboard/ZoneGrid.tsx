import Grid from "@mui/material/Grid";
import type { Zone } from "~/client/api/zonesApi";
import type { ZoneTickDecisionRecord } from "~/client/api/airHandlersApi";
import type { ManualOverride } from "~/client/api/overridesApi";
import ZoneCard from "~/client/components/dashboard/ZoneCard";

interface ZoneGridProps {
  zones: Zone[];
  tickRecordsByZoneId: Map<string, ZoneTickDecisionRecord>;
  activeOverridesByZoneId: Map<string, ManualOverride>;
  onChanged: () => void;
  onEdit: (zone: Zone) => void;
}

export default function ZoneGrid({
  zones,
  tickRecordsByZoneId,
  activeOverridesByZoneId,
  onChanged,
  onEdit,
}: ZoneGridProps) {
  return (
    <Grid container spacing={2}>
      {zones.map((zone) => (
        <Grid key={zone.id} size={{ xs: 12, sm: 6, md: 4 }}>
          <ZoneCard
            zone={zone}
            tickRecord={tickRecordsByZoneId.get(zone.id)}
            activeOverride={activeOverridesByZoneId.get(zone.id)}
            onChanged={onChanged}
            onEdit={onEdit}
          />
        </Grid>
      ))}
    </Grid>
  );
}
