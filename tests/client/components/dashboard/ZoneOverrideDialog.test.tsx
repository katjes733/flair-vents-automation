/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

function renderDialog(open = true) {
  return render(
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
    const { rerender } = renderDialog(true);
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
});
