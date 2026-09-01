import AppDataSource from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
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

export async function getScheduleById(
  id: string,
): Promise<ScheduleData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository("Schedule");
  const row = (await repo.findOne({ where: { id } })) as ScheduleRow | null;
  return row ? toScheduleData(row) : null;
}

export async function createSchedule(fields: {
  installationId: string;
  name: string;
  events: ScheduleEvent[];
  config: ScheduleConfig;
}): Promise<ScheduleData> {
  const repo = (await AppDataSource.getInstance()).getRepository("Schedule");
  const row = withTimestamps({
    installation_id: fields.installationId,
    name: fields.name,
    events: fields.events,
    config: fields.config,
  });
  await repo.insert(row);
  return toScheduleData(row as unknown as ScheduleRow);
}

export async function updateSchedule(
  id: string,
  fields: Partial<{
    name: string;
    events: ScheduleEvent[];
    config: ScheduleConfig;
  }>,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("Schedule");
  await repo.update(id, {
    ...(fields.name !== undefined && { name: fields.name }),
    ...(fields.events !== undefined && { events: fields.events }),
    ...(fields.config !== undefined && { config: fields.config }),
    ...touch(),
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("Schedule");
  await repo.delete(id);
}
