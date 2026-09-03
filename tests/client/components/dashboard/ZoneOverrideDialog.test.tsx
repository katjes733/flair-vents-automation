/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { createOverride } = vi.hoisted(() => ({ createOverride: vi.fn() }));
vi.mock("~/client/api/overridesApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/overridesApi")>();
  return { ...actual, createOverride };
});

const { default: ZoneOverrideDialog } =
  await import("~/client/components/dashboard/ZoneOverrideDialog");

const theme = createTheme();

function renderDialog({
  open = true,
  onClose = vi.fn(),
  onCreated = vi.fn(),
}: {
  open?: boolean;
  onClose?: () => void;
  onCreated?: () => void;
} = {}) {
  const utils = render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <ZoneOverrideDialog
          open={open}
          zoneId="z1"
          zoneName="Bedroom"
          onClose={onClose}
          onCreated={onCreated}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
  return { ...utils, onClose, onCreated };
}

describe("ZoneOverrideDialog", () => {
  beforeEach(() => {
    createOverride.mockReset().mockResolvedValue({ id: "mo-1" });
    localStorage.clear();
  });

  // Regression test: same bug/fix as AddZoneDialog.test.tsx and
  // AddAirHandlerDialog.test.tsx — this dialog stays mounted between
  // opens, so `value`/`holdType`/`kind` used to carry over from a
  // previous attempt. `actor` is deliberately excluded from the reset —
  // it's meant to persist per-browser across overrides.
  it("clears position/hold-type on reopen, but keeps the remembered actor name", async () => {
    const { rerender } = renderDialog({ open: true });
    const rerenderOpen = (open: boolean) =>
      rerender(
        <ThemeProvider theme={theme}>
          <NotificationProvider>
            <ZoneOverrideDialog
              open={open}
              zoneId="z1"
              zoneName="Bedroom"
              onClose={vi.fn()}
              onCreated={vi.fn()}
            />
          </NotificationProvider>
        </ThemeProvider>,
      );

    fireEvent.change(screen.getByLabelText("Position (0–100%)"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Martin" },
    });

    rerenderOpen(false);
    rerenderOpen(true);

    expect(screen.getByLabelText("Position (0–100%)")).toHaveValue(null);
    expect(screen.getByLabelText("Your name")).toHaveValue("Martin");
  });

  it("seeds the actor field from a previously stored per-browser name on initial mount", () => {
    localStorage.setItem("actorDisplayName", "Sherri");
    renderDialog();
    expect(screen.getByLabelText("Your name")).toHaveValue("Sherri");
  });

  it("Set override is disabled until both a value and an actor name are entered", () => {
    renderDialog();
    const submit = screen.getByRole("button", { name: "Set override" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Martin" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Position (0–100%)"), {
      target: { value: "30" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("submits a position override with the entered value, default hold type, and trimmed actor name; notifies success and closes", async () => {
    const { onClose, onCreated } = renderDialog();

    fireEvent.change(screen.getByLabelText("Position (0–100%)"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "  Martin  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Set override" }));

    await screen.findByText("Manual override set for Bedroom.");
    expect(createOverride).toHaveBeenCalledWith({
      kind: "position",
      zone_id: "z1",
      value: 35,
      hold_type: "2h",
      actor: "Martin",
    });
    expect(localStorage.getItem("actorDisplayName")).toBe("Martin");
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("changing Hold until submits the newly selected hold type", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("combobox", { name: "Hold until" }));
    await user.click(
      await screen.findByRole("option", {
        name: "Until next scheduled event",
      }),
    );

    fireEvent.change(screen.getByLabelText("Position (0–100%)"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Martin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set override" }));

    await screen.findByText("Manual override set for Bedroom.");
    expect(createOverride).toHaveBeenCalledWith(
      expect.objectContaining({ hold_type: "until_next_event" }),
    );
  });

  it("switching to Setpoint changes the field label and value units, and submits the setpoint kind", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Setpoint" }));
    expect(screen.getByLabelText("Setpoint (°C)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Setpoint (°C)"), {
      target: { value: "21" },
    });
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Martin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set override" }));

    await screen.findByText("Manual override set for Bedroom.");
    expect(createOverride).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "setpoint", value: 21 }),
    );
  });

  it("shows an error notification and does not close or notify creation when the API call fails", async () => {
    createOverride.mockRejectedValueOnce(new Error("network error"));
    const { onClose, onCreated } = renderDialog();

    fireEvent.change(screen.getByLabelText("Position (0–100%)"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Martin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set override" }));

    await screen.findByText("Couldn't set the override — try again.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Set override" }),
    ).not.toBeDisabled();
  });
});
