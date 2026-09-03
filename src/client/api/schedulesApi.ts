import { httpClient } from "~/client/api/httpClient";
import type {
  ScheduleEvent,
  ScheduleConfig,
  ZoneScheduleSetting,
} from "~/shared/schemas/scheduleEvents";
import type { ScheduleEventRequest } from "~/shared/schemas/scheduleRequest";

// Type-only imports from the shared schemas — erased at build time, so this
// doesn't pull zod into the client bundle here. Reusing the server's own
// inferred types for the *response* shapes (rather than hand-duplicating
// the event/zone-settings shape as plain interfaces) means these can never
// drift from what the server actually returns.
export type {
  ScheduleEvent,
  ScheduleConfig,
  ZoneScheduleSetting,
  ScheduleEventRequest,
};

export interface Schedule {
  id: string;
  installationId: string;
  name: string;
  events: ScheduleEvent[];
  config: ScheduleConfig;
}

// Hand-written, not reused from scheduleRequest.ts's own zod-inferred
// types — those schemas' fields carry `.default()`, so `z.infer` (the
// *output* type, post-parse) makes `events`/`config` required even though
// a caller is free to omit them on input. zonesApi.ts's own
// CreateZoneRequest/UpdateZoneRequest hit the identical issue and are
// hand-written for the same reason — confirmed live: reusing the schema
// type directly made `createSchedule({ name: "x" })` a compile error.
export interface CreateScheduleRequest {
  name: string;
  events?: ScheduleEventRequest[];
  config?: Partial<ScheduleConfig>;
}

export interface UpdateScheduleRequest {
  name?: string;
  events?: ScheduleEventRequest[];
  config?: Partial<ScheduleConfig>;
}

export async function fetchSchedules(): Promise<Schedule[]> {
  const { data } = await httpClient.get<Schedule[]>("/schedules");
  return data;
}

export async function createSchedule(
  body: CreateScheduleRequest,
): Promise<Schedule> {
  const { data } = await httpClient.post<Schedule>("/schedules", body);
  return data;
}

// A partial patch — same shape the server's own updateScheduleRequestSchema
// accepts. `events`, when present, is a whole-array replace (the server has
// no per-event patch route), so callers must always send the schedule's
// complete event list, not just the one event that changed. `config`, when
// present, should likewise be sent as a complete object — see
// updateScheduleRequestSchema's own comment on why a bare partial config is
// safe now (genuinePartial), but still stitched from the full current
// config here to keep behavior obvious at the call site.
export async function updateSchedule(
  id: string,
  body: UpdateScheduleRequest,
): Promise<Schedule> {
  const { data } = await httpClient.patch<Schedule>(`/schedules/${id}`, body);
  return data;
}

export async function deleteSchedule(id: string): Promise<void> {
  await httpClient.delete(`/schedules/${id}`);
}
