import { useCallback, useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import {
  fetchHomeKitStatus,
  discoverHomeKitAccessories,
  pairHomeKitAccessory,
  unpairHomeKitAccessory,
  type HomeKitStatus,
  type DiscoveredAccessory,
} from "~/client/api/homekitApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import { useCanWrite } from "~/client/permissions/usePermission";

interface HomeKitPairingDialogProps {
  open: boolean;
  airHandlerId: string;
  airHandlerName: string;
  onClose: () => void;
}

// Auto-formats the 8 raw digits shown on the thermostat's own screen into
// the XXX-XX-XXX shape the pairing protocol requires — see
// docs/homekit-ecobee-control-research.md's own confirmed format.
function formatSetupCode(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * Setup flow for the direct local HomeKit setpoint-delivery path — see
 * "Direct HomeKit Thermostat Control" in the plan. A mutation/action flow
 * (discover, then pair with a live setup code, or unpair), not a simple
 * fetched-list picker, so it deliberately doesn't reuse FlairZoneSelect's
 * shape.
 */
export default function HomeKitPairingDialog({
  open,
  airHandlerId,
  airHandlerName,
  onClose,
}: HomeKitPairingDialogProps) {
  const { showNotification } = useNotification();
  const canEdit = useCanWrite("dashboard.airHandler.edit");
  const [status, setStatus] = useState<HomeKitStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [accessories, setAccessories] = useState<DiscoveredAccessory[]>([]);
  const [selectedAccessoryId, setSelectedAccessoryId] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setAccessories([]);
    setSelectedAccessoryId("");
    setSetupCode("");
    setError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      setStatus(await fetchHomeKitStatus(airHandlerId));
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't load HomeKit status.");
    } finally {
      setLoadingStatus(false);
    }
  }, [airHandlerId]);

  useEffect(() => {
    if (open) void loadStatus();
  }, [open, loadStatus]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setError(null);
    try {
      const found = await discoverHomeKitAccessories(airHandlerId);
      setAccessories(found);
      if (found.length === 1) setSelectedAccessoryId(found[0].accessoryId);
      if (found.length === 0) {
        setError(
          "No unpaired HomeKit accessories found on the network — make sure the thermostat's own HomeKit setup screen is currently open.",
        );
      }
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  }, [airHandlerId]);

  const handlePair = useCallback(async () => {
    if (!selectedAccessoryId || !setupCode) return;
    setPairing(true);
    setError(null);
    try {
      await pairHomeKitAccessory(airHandlerId, selectedAccessoryId, setupCode);
      showNotification(`Paired "${airHandlerName}" with HomeKit.`, "success");
      setAccessories([]);
      setSelectedAccessoryId("");
      setSetupCode("");
      await loadStatus();
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Pairing failed — double-check the code and that the setup screen is still open.",
      );
    } finally {
      setPairing(false);
    }
  }, [
    airHandlerId,
    airHandlerName,
    loadStatus,
    selectedAccessoryId,
    setupCode,
    showNotification,
  ]);

  const handleUnpair = useCallback(async () => {
    setUnpairing(true);
    setError(null);
    try {
      await unpairHomeKitAccessory(airHandlerId);
      showNotification(`Unpaired "${airHandlerName}" from HomeKit.`, "success");
      await loadStatus();
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't unpair — try again.");
    } finally {
      setUnpairing(false);
    }
  }, [airHandlerId, airHandlerName, loadStatus, showNotification]);

  const setupCodeValid = /^\d{3}-\d{2}-\d{3}$/.test(setupCode);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>HomeKit pairing — {airHandlerName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {loadingStatus ? (
            <CircularProgress size={24} />
          ) : status?.paired ? (
            <>
              <DialogContentText>
                Paired (accessory {status.accessoryId}) —{" "}
                {status.reachable ? "reachable now" : "not currently reachable"}
                .
              </DialogContentText>
              {status.lastConnectError && (
                <DialogContentText color="error">
                  Last error: {status.lastConnectError}
                </DialogContentText>
              )}
            </>
          ) : (
            <>
              <DialogContentText>
                Not paired. Open this thermostat's own on-screen HomeKit setup
                menu to display its setup code, then discover and pair below.
              </DialogContentText>
              <Button
                variant="outlined"
                onClick={handleDiscover}
                disabled={discovering || !canEdit}
              >
                {discovering ? "Discovering…" : "Discover"}
              </Button>
              {accessories.length > 0 && (
                <TextField
                  select
                  label="Accessory"
                  value={selectedAccessoryId}
                  onChange={(e) => setSelectedAccessoryId(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                >
                  {accessories.map((a) => (
                    <MenuItem key={a.accessoryId} value={a.accessoryId}>
                      {a.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {selectedAccessoryId && (
                <TextField
                  label="Setup code"
                  placeholder="XXX-XX-XXX"
                  value={setupCode}
                  onChange={(e) =>
                    setSetupCode(formatSetupCode(e.target.value))
                  }
                  helperText="The 8-digit code shown on the thermostat's own screen right now."
                />
              )}
            </>
          )}
          {error && (
            <DialogContentText color="error">{error}</DialogContentText>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3 }}>
        {status?.paired ? (
          <Button
            color="error"
            disabled={unpairing || !canEdit}
            onClick={handleUnpair}
          >
            Unpair
          </Button>
        ) : (
          <span />
        )}
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Close</Button>
          {!status?.paired && (
            <Button
              variant="contained"
              disabled={!setupCodeValid || pairing || !canEdit}
              onClick={handlePair}
            >
              Pair
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
