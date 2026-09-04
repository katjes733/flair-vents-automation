import { httpClient } from "~/client/api/httpClient";

export type HoldType = "2h" | "4h" | "until_next_event" | "permanent";

// Shared by the current-status (`GET /overrides`) and history
// (`GET /overrides/:zoneId/history`) endpoints — `active` is a derived
// field only the current-status one computes (it needs "now", which has no
// meaning for a past row in a history window), so it lives on `ManualOverride`
// alone, not this base shape.
export interface ManualOverrideRecord {
  id: string;
  zoneId: string;
  config:
    | {
        kind: "setpoint";
        value: number;
        hold_type: HoldType;
        actor: string;
        note?: string;
      }
    | {
        kind: "position";
        value: number;
        hold_type: HoldType;
        actor: string;
        note?: string;
      };
  createdAtMs: number;
  expiresAtMs: number | null;
  revokedAtMs: number | null;
}

export interface ManualOverride extends ManualOverrideRecord {
  active: boolean;
}

export interface CreateOverrideRequest {
  kind: "setpoint" | "position";
  zone_id: string;
  value: number;
  hold_type: HoldType;
  actor: string;
  note?: string;
}

export async function fetchOverrides(): Promise<ManualOverride[]> {
  const { data } = await httpClient.get<ManualOverride[]>("/overrides");
  return data;
}

export async function createOverride(
  body: CreateOverrideRequest,
): Promise<ManualOverride> {
  const { data } = await httpClient.post<ManualOverride>("/overrides", body);
  return data;
}

export async function revokeOverride(id: string): Promise<void> {
  await httpClient.post(`/overrides/${id}/revoke`);
}

// See "Stage 13, Increment B" follow-up — backs the Telemetry page's
// override activity lane. Every row whose active window overlaps
// [fromMs, toMs], not just the zone's current one.
export async function fetchOverrideHistory(
  zoneId: string,
  fromMs: number,
  toMs: number,
): Promise<ManualOverrideRecord[]> {
  const { data } = await httpClient.get<ManualOverrideRecord[]>(
    `/overrides/${zoneId}/history`,
    { params: { fromMs, toMs } },
  );
  return data;
}
