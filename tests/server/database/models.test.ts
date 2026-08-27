import { describe, it, expect } from "vitest";
import { Installation } from "~/server/database/models/installation";
import { AirHandler } from "~/server/database/models/airHandler";
import { Zone } from "~/server/database/models/zone";
import { Schedule } from "~/server/database/models/schedule";
import { ManualOverride } from "~/server/database/models/manualOverride";
import { FlairToken } from "~/server/database/models/flairToken";
import { SystemSettings } from "~/server/database/models/systemSettings";

// Structural checks, not integration tests against a real DB (that's the
// live smoke test, per the Verification Plan) — these catch the class of
// mistake that's easy to make hand-writing EntitySchema column/FK
// definitions: a typo'd table name, a missing base-entity column, an
// installation_id FK pointing at the wrong target or missing ON DELETE
// RESTRICT.

function baseColumns(entity: typeof Installation) {
  return entity.options.columns;
}

describe("EntitySchema base entity columns", () => {
  const entities = [
    Installation,
    AirHandler,
    Zone,
    Schedule,
    ManualOverride,
    FlairToken,
    SystemSettings,
  ];

  it.each(entities)("carries id/creation_time/modified_time", (entity) => {
    const columns = baseColumns(entity);
    expect(columns.id).toMatchObject({
      type: "uuid",
      primary: true,
      generated: "uuid",
    });
    expect(columns.creation_time).toMatchObject({
      type: "timestamp with time zone",
      nullable: false,
    });
    expect(columns.modified_time).toMatchObject({
      type: "timestamp with time zone",
      nullable: false,
    });
  });
});

describe("Installation", () => {
  it("has the expected table name and name column", () => {
    expect(Installation.options.tableName).toBe("installations");
    expect(Installation.options.columns.name).toMatchObject({
      type: "varchar",
      nullable: false,
    });
  });
});

describe("AirHandler", () => {
  it("FKs installation_id to Installation with ON DELETE RESTRICT", () => {
    const fk = AirHandler.options.foreignKeys?.find((f) =>
      f.columnNames.includes("installation_id"),
    );
    expect(fk?.target).toBe(Installation);
    expect(fk?.onDelete).toBe("RESTRICT");
  });

  it("enforces a unique, non-null name", () => {
    expect(AirHandler.options.columns.name).toMatchObject({
      nullable: false,
      unique: true,
    });
  });
});

describe("Zone", () => {
  it("FKs both installation_id and air_handler_id, both RESTRICT", () => {
    const fks = Zone.options.foreignKeys ?? [];
    const installationFk = fks.find((f) =>
      f.columnNames.includes("installation_id"),
    );
    const airHandlerFk = fks.find((f) =>
      f.columnNames.includes("air_handler_id"),
    );
    expect(installationFk?.target).toBe(Installation);
    expect(installationFk?.onDelete).toBe("RESTRICT");
    expect(airHandlerFk?.target).toBe(AirHandler);
    expect(airHandlerFk?.onDelete).toBe("RESTRICT");
  });

  it("carries separate config and state jsonb columns", () => {
    expect(Zone.options.columns.config).toMatchObject({ type: "jsonb" });
    expect(Zone.options.columns.state).toMatchObject({ type: "jsonb" });
  });

  it("enforces a unique (air_handler_id, name) index", () => {
    const index = Zone.options.indices?.find(
      (i) => i.name === "idx_zones_air_handler_name",
    );
    expect(index?.columns).toEqual(["air_handler_id", "name"]);
    expect(index?.unique).toBe(true);
  });
});

describe("Schedule", () => {
  it("FKs installation_id to Installation with ON DELETE RESTRICT", () => {
    const fk = Schedule.options.foreignKeys?.find((f) =>
      f.columnNames.includes("installation_id"),
    );
    expect(fk?.target).toBe(Installation);
    expect(fk?.onDelete).toBe("RESTRICT");
  });

  it("stores events as a jsonb array column, not per-row", () => {
    expect(Schedule.options.columns.events).toMatchObject({ type: "jsonb" });
  });
});

describe("ManualOverride", () => {
  it("FKs zone_id to Zone with ON DELETE CASCADE", () => {
    const fk = ManualOverride.options.foreignKeys?.find((f) =>
      f.columnNames.includes("zone_id"),
    );
    expect(fk?.target).toBe(Zone);
    expect(fk?.onDelete).toBe("CASCADE");
  });

  it("keeps expires_at and revoked_at both nullable — no far-future sentinel", () => {
    expect(ManualOverride.options.columns.expires_at).toMatchObject({
      nullable: true,
    });
    expect(ManualOverride.options.columns.revoked_at).toMatchObject({
      nullable: true,
    });
  });
});

describe("FlairToken", () => {
  it("enforces installation_id as unique — one Flair account per installation", () => {
    expect(FlairToken.options.columns.installation_id).toMatchObject({
      unique: true,
    });
  });
});

describe("SystemSettings", () => {
  it("enforces installation_id as unique — one settings row per installation", () => {
    expect(SystemSettings.options.columns.installation_id).toMatchObject({
      unique: true,
    });
  });
});
