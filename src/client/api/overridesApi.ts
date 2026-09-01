import { httpClient } from "~/client/api/httpClient";

export type HoldType = "2h" | "4h" | "until_next_event" | "permanent";

export interface ManualOverride {
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
  expiresAtMs: number | null;
  revokedAtMs: number | null;
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
