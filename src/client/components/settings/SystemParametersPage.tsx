import { useCallback, useEffect, useMemo, useState } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { fetchSettings, updateSettings } from "~/client/api/settingsApi";
import type { SystemSettings } from "~/client/api/settingsApi";
import { fetchZones } from "~/client/api/zonesApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import ParamField from "~/client/components/settings/ParamField";
import ZonePriorityList, {
  type ZonePriorityListOption,
} from "~/client/components/shared/ZonePriorityList";
import {
  SYSTEM_PARAMETER_GROUPS,
  SYSTEM_SETTINGS_DEFAULTS,
  getByPath,
  toDisplayString,
  fromDisplayString,
  sameDisplayValue,
  paramUnitLabel,
  type DisplayUnits,
  type ParamFieldDef,
} from "~/client/components/settings/systemParameterFields";

type DraftValues = Record<string, string>;

const SHOW_ADVANCED_STORAGE_KEY = "systemParametersShowAdvanced";

function resolveStoredShowAdvanced(): boolean {
  try {
    return localStorage.getItem(SHOW_ADVANCED_STORAGE_KEY) === "true";
  } catch {
    // localStorage unavailable (e.g. private browsing restrictions) —
    // default closed, same as a first-ever visit.
    return false;
  }
}

function buildDraft(config: SystemSettings, units: DisplayUnits): DraftValues {
  const draft: DraftValues = {};
  for (const group of SYSTEM_PARAMETER_GROUPS) {
    for (const field of group.fields) {
      draft[field.path] = toDisplayString(
        field.kind,
        getByPath(config, field.path),
        units,
      );
    }
  }
  return draft;
}

/**
 * Every scalar system_settings.config tunable (~50 fields) that isn't
 * already covered by GlobalStatusBar (control_disarmed), the per-browser
 * Settings page (display_temperature_unit/display_airflow_unit), or a
 * future zone/air-handler picker (zone_priority_order,
 * away_native_zone_ids, live_air_handler_ids, driving_zone_overrides) — see
 * the implementation plan's SystemParameters section. This is DB-backed,
 * install-wide control-loop tuning, not a per-browser preference, which is
 * why it's a separate page from Settings rather than folded into it.
 *
 * Two things make ~50 real, physically-consequential tunables approachable
 * rather than overwhelming: every field carries a `description` shown as
 * hover text (an info icon, not an always-visible caption — see
 * ParamField's own comment for why), and each field is tagged `common` or
 * `advanced` (see ParamFieldDef's comment) so day-to-day comfort tuning
 * isn't sitting next to equipment-protection/alerting-cadence knobs by
 * default. `showAdvanced` is a page-local, per-browser preference —
 * persisted the same way theme mode/Diagnostic Mode are, but scoped to
 * this page rather than app-wide, since "which settings I want to see"
 * has nothing to do with diagnostics.
 */
export default function SystemParametersPage() {
  const { temperatureUnit, airflowUnit } = useDisplayUnit();
  const units: DisplayUnits = useMemo(
    () => ({ temperatureUnit, airflowUnit }),
    [temperatureUnit, airflowUnit],
  );
  const { showNotification } = useNotification();

  const [savedConfig, setSavedConfig] = useState<SystemSettings | null>(null);
  const [draft, setDraft] = useState<DraftValues>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resetAllConfirmOpen, setResetAllConfirmOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(resolveStoredShowAdvanced);
  const [zoneOptions, setZoneOptions] = useState<ZonePriorityListOption[]>([]);
  // The one picker-shaped field on this page — kept as its own state
  // rather than folded into `draft`, since ParamField's draft model is a
  // flat string-keyed map and this is a real string[], not a display
  // string. See ZonePriorityList's own comment for why it's always
  // normalized to every known zone, not just the ones already ordered.
  const [priorityOrder, setPriorityOrder] = useState<string[]>([]);

  const handleToggleShowAdvanced = (checked: boolean) => {
    setShowAdvanced(checked);
    try {
      localStorage.setItem(SHOW_ADVANCED_STORAGE_KEY, String(checked));
    } catch {
      // ignore — the choice still applies for the current session
    }
  };

  const allFields = useMemo(
    () => SYSTEM_PARAMETER_GROUPS.flatMap((g) => g.fields),
    [],
  );
  const advancedFieldCount = useMemo(
    () => allFields.filter((f) => f.tier === "advanced").length,
    [allFields],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSettings(), fetchZones()])
      .then(([config, zones]) => {
        if (cancelled) return;
        setSavedConfig(config);
        // Seeded once, from whatever display unit is active at load time —
        // deliberately not re-derived on every unit change, so toggling
        // units elsewhere doesn't clobber an in-progress edit on this page.
        setDraft(buildDraft(config, units));
        setZoneOptions(zones.map((z) => ({ id: z.id, name: z.name })));
        setPriorityOrder(config.zone_priority_order);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          extractErrorMessage(err) ?? "Couldn't load system parameters.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once at load; see comment above
  }, []);

  // Both checks compare in *display* space — the current input string
  // against the default/saved value run through the identical
  // toDisplayString rounding — rather than converting the draft back to
  // canonical units and comparing there. A conversion + round + inverse
  // conversion does not round-trip exactly, so a canonical-space compare
  // (even with a tolerance) either misses a real edit or flags an
  // untouched field as dirty purely from rounding drift; see
  // sameDisplayValue's own comment.
  const isFieldDefault = useCallback(
    (field: ParamFieldDef) =>
      sameDisplayValue(
        field.kind,
        draft[field.path] ?? "",
        toDisplayString(
          field.kind,
          getByPath(SYSTEM_SETTINGS_DEFAULTS, field.path),
          units,
        ),
      ),
    [draft, units],
  );

  const isFieldDirty = useCallback(
    (field: ParamFieldDef) => {
      if (!savedConfig) return false;
      return !sameDisplayValue(
        field.kind,
        draft[field.path] ?? "",
        toDisplayString(field.kind, getByPath(savedConfig, field.path), units),
      );
    },
    [draft, savedConfig, units],
  );

  const dirtyFields = useMemo(
    () => allFields.filter(isFieldDirty),
    [allFields, isFieldDirty],
  );

  const nonDefaultFields = useMemo(
    () => allFields.filter((f) => !isFieldDefault(f)),
    [allFields, isFieldDefault],
  );

  const priorityOrderIsDefault =
    JSON.stringify(priorityOrder) ===
    JSON.stringify(SYSTEM_SETTINGS_DEFAULTS.zone_priority_order);
  const priorityOrderIsDirty =
    JSON.stringify(priorityOrder) !==
    JSON.stringify(savedConfig?.zone_priority_order ?? []);
  const totalDirtyCount = dirtyFields.length + (priorityOrderIsDirty ? 1 : 0);
  const totalNonDefaultCount =
    nonDefaultFields.length + (priorityOrderIsDefault ? 0 : 1);

  const handleChange = (path: string, raw: string) => {
    setDraft((d) => ({ ...d, [path]: raw }));
  };

  const handleReset = (field: ParamFieldDef) => {
    setDraft((d) => ({
      ...d,
      [field.path]: toDisplayString(
        field.kind,
        getByPath(SYSTEM_SETTINGS_DEFAULTS, field.path),
        units,
      ),
    }));
  };

  const handleResetAll = () => {
    // Only touches local draft state — nothing is written to the server
    // until Save, so this is still fully reversible via Discard changes
    // right up until then. The confirmation dialog exists anyway, since
    // silently blowing away every unsaved edit across all ~40 fields at
    // once (not just the ones already at default) is a real, easy-to-regret
    // action for a page this size.
    setDraft(buildDraft(SYSTEM_SETTINGS_DEFAULTS, units));
    setPriorityOrder(SYSTEM_SETTINGS_DEFAULTS.zone_priority_order);
    setError(null);
    setWarnings([]);
    setResetAllConfirmOpen(false);
  };

  const handleSave = async () => {
    if (totalDirtyCount === 0) return;
    setError(null);
    setWarnings([]);

    const invalid = dirtyFields.find((f) => {
      const stored = fromDisplayString(f.kind, draft[f.path] ?? "", units);
      return typeof stored === "number" && !Number.isFinite(stored);
    });
    if (invalid) {
      setError(`"${invalid.baseLabel}" isn't a valid number.`);
      return;
    }

    // Build the minimal patch — only changed top-level keys, per
    // updateSettings' own minimal-PATCH convention. modifier_boosts is a
    // single nested object field server-side, so any one of its own
    // sub-fields changing sends the whole (current-draft) object, not a
    // deep-partial patch the schema doesn't model.
    const dirtyPaths = new Set(dirtyFields.map((f) => f.path));
    const patch: Record<string, unknown> = {};
    let modifierBoostsDirty = false;
    for (const group of SYSTEM_PARAMETER_GROUPS) {
      for (const field of group.fields) {
        const [head] = field.path.split(".");
        if (head === "modifier_boosts") {
          if (dirtyPaths.has(field.path)) modifierBoostsDirty = true;
          continue;
        }
        if (dirtyPaths.has(field.path)) {
          patch[field.path] = fromDisplayString(
            field.kind,
            draft[field.path] ?? "",
            units,
          );
        }
      }
    }
    if (modifierBoostsDirty) {
      const boostsGroup = SYSTEM_PARAMETER_GROUPS.flatMap(
        (g) => g.fields,
      ).filter((f) => f.path.startsWith("modifier_boosts."));
      const boosts: Record<string, unknown> = {};
      for (const f of boostsGroup) {
        const [, key] = f.path.split(".");
        boosts[key] = fromDisplayString(f.kind, draft[f.path] ?? "", units);
      }
      patch.modifier_boosts = boosts;
    }
    if (priorityOrderIsDirty) {
      patch.zone_priority_order = priorityOrder;
    }

    setSaving(true);
    try {
      const result = await updateSettings(patch);
      setSavedConfig(result.config);
      setDraft(buildDraft(result.config, units));
      setPriorityOrder(result.config.zone_priority_order);
      setWarnings(result.warnings);
      showNotification(
        result.warnings.length > 0
          ? "System parameters saved, with warnings below."
          : "System parameters saved.",
        result.warnings.length > 0 ? "warning" : "success",
      );
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't save system parameters.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!savedConfig) return;
    setDraft(buildDraft(savedConfig, units));
    setPriorityOrder(savedConfig.zone_priority_order);
    setError(null);
    setWarnings([]);
  };

  if (loading) {
    return (
      <Container
        maxWidth="sm"
        sx={{ px: 2, display: "flex", justifyContent: "center", mt: 4 }}
      >
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ px: 2, pb: 4 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 1,
          gap: 2,
          position: "sticky",
          top: 0,
          bgcolor: "background.default",
          py: 1,
          zIndex: 1,
        }}
      >
        <Typography variant="h5" fontWeight={600}>
          System Parameters
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            color="warning"
            disabled={totalNonDefaultCount === 0 || saving}
            onClick={() => setResetAllConfirmOpen(true)}
          >
            Reset all to defaults
          </Button>
          <Button
            size="small"
            disabled={totalDirtyCount === 0 || saving}
            onClick={handleDiscard}
          >
            Discard changes
          </Button>
          <Button
            variant="contained"
            size="small"
            disabled={totalDirtyCount === 0 || saving}
            onClick={handleSave}
          >
            {saving
              ? "Saving…"
              : `Save${totalDirtyCount > 0 ? ` (${totalDirtyCount})` : ""}`}
          </Button>
        </Stack>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Control-loop tuning shared by every browser and every zone — unlike
        Settings, these are real, DB-backed values that change how the control
        loop behaves. Hover the{" "}
        <InfoOutlinedIcon
          fontSize="inherit"
          sx={{ verticalAlign: "text-bottom" }}
        />{" "}
        next to a field for what it actually does.
      </Typography>
      <FormControlLabel
        sx={{ mb: 2 }}
        control={
          <Switch
            checked={showAdvanced}
            onChange={(e) => handleToggleShowAdvanced(e.target.checked)}
          />
        }
        label={
          showAdvanced
            ? `Show advanced parameters (${advancedFieldCount} shown)`
            : `Show advanced parameters (${advancedFieldCount} hidden)`
        }
      />
      {error && (
        <DialogContentText color="error" sx={{ mb: 2 }}>
          {error}
        </DialogContentText>
      )}
      {warnings.length > 0 && (
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          {warnings.map((w, i) => (
            <Typography key={i} variant="body2" color="warning.main">
              {w}
            </Typography>
          ))}
        </Stack>
      )}
      <Stack spacing={2}>
        {SYSTEM_PARAMETER_GROUPS.map((group) => {
          // Every field, always — only rendering is gated on showAdvanced,
          // never the underlying data — an already-edited advanced field
          // stays saved/dirty even while its row is hidden.
          const visibleFields = group.fields.filter(
            (f) => showAdvanced || f.tier === "common",
          );
          if (visibleFields.length === 0) return null;
          return (
            <Card variant="outlined" key={group.title}>
              <CardContent>
                <Typography
                  variant="subtitle1"
                  fontWeight={600}
                  sx={{ mb: 1.5 }}
                >
                  {group.title}
                </Typography>
                <Stack spacing={1.5}>
                  {visibleFields.map((field) => {
                    const unitLabel = paramUnitLabel(field.kind, units);
                    const label = unitLabel
                      ? `${field.baseLabel} (${unitLabel})`
                      : field.baseLabel;
                    return (
                      <ParamField
                        key={field.path}
                        label={label}
                        description={field.description}
                        value={draft[field.path] ?? ""}
                        isText={field.kind === "text"}
                        isDefault={isFieldDefault(field)}
                        defaultDisplayValue={toDisplayString(
                          field.kind,
                          getByPath(SYSTEM_SETTINGS_DEFAULTS, field.path),
                          units,
                        )}
                        options={field.options}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        onChange={(raw) => handleChange(field.path, raw)}
                        onReset={() => handleReset(field)}
                      />
                    );
                  })}
                </Stack>
                {group.title === "Contention resolution" && (
                  <Box sx={{ mt: 2 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 1,
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Zone priority order — highest first, used when there
                        isn't enough airflow for every demanding zone at once.
                      </Typography>
                      <Button
                        size="small"
                        disabled={priorityOrderIsDefault}
                        onClick={() =>
                          setPriorityOrder(
                            SYSTEM_SETTINGS_DEFAULTS.zone_priority_order,
                          )
                        }
                      >
                        Reset
                      </Button>
                    </Box>
                    <ZonePriorityList
                      zones={zoneOptions}
                      value={priorityOrder}
                      onChange={setPriorityOrder}
                    />
                  </Box>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      <Dialog
        open={resetAllConfirmOpen}
        onClose={() => setResetAllConfirmOpen(false)}
      >
        <DialogTitle>Reset all parameters to their defaults?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Every field on this page, including the zone priority order, (
            {totalNonDefaultCount} currently away from default) reverts to its
            schema default. Nothing is saved until you click Save — you can
            still Discard changes instead.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetAllConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleResetAll} color="warning" variant="contained">
            Reset all
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
