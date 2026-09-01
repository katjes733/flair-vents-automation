import AppDataSource from "~/server/database/datasource";
import {
  resolveScheduleEvents,
  resolveScheduleConfig,
  type ScheduleEvent,
  type ScheduleConfig,
} from "~/shared/schemas/scheduleEvents";

export interface ScheduleData {
  id: string;
  installationId: string;
  name: string;
  events: ScheduleEvent[];
  config: ScheduleConfig;
}

interface ScheduleRow {
  id: string;
  installation_id: string;
  name: string;
  events: unknown;
  config: unknown;
}

function toScheduleData(row: ScheduleRow): ScheduleData {
  return {
    id: row.id,
    installationId: row.installation_id,
    name: row.name,
    events: resolveScheduleEvents(row.events),
    config: resolveScheduleConfig(row.config),
  };
}

export async function getSchedulesForInstallation(
  installationId: string,
): Promise<ScheduleData[]> {
  const repo = (await AppDataSource.getInstance()).getRepository("Schedule");
  const rows = (await repo.find({
    where: { installation_id: installationId },
  })) as ScheduleRow[];
  return rows.map(toScheduleData);
}
