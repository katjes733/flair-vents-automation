/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";

afterEach(cleanup);

const { fetchAvailableFlairZones } = vi.hoisted(() => ({
  fetchAvailableFlairZones: vi.fn(),
}));
vi.mock("~/client/api/airHandlersApi", () => ({ fetchAvailableFlairZones }));

const { default: FlairZoneSelect } =
  await import("~/client/components/shared/FlairZoneSelect");

const theme = createTheme();

function renderSelect(
  props: Partial<{
    value: string;
    onChange: (value: string) => void;
    currentAirHandlerId: string;
  }> = {},
) {
  return render(
    <ThemeProvider theme={theme}>
      <FlairZoneSelect
        value={props.value ?? ""}
        onChange={props.onChange ?? vi.fn()}
        currentAirHandlerId={props.currentAirHandlerId}
      />
    </ThemeProvider>,
  );
}

describe("FlairZoneSelect", () => {
  beforeEach(() => {
    fetchAvailableFlairZones.mockReset();
  });

  it("shows a loading state, then the fetched zones", async () => {
    fetchAvailableFlairZones.mockResolvedValue([
      {
        id: "fz-1",
        name: "Upstairs",
        assignedAirHandlerId: null,
        assignedAirHandlerName: null,
      },
    ]);
    renderSelect();
    expect(screen.getByText("Loading Flair zones…")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(
        screen.queryByText("Loading Flair zones…"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("combobox", { name: "Flair zone" }),
    ).toHaveTextContent("None (not linked yet)");
  });

  it("shows an error state when the fetch fails, and disables the field", async () => {
    fetchAvailableFlairZones.mockRejectedValue({
      response: { data: { error: "No Flair structure linked yet." } },
    });
    renderSelect();
    expect(
      await screen.findByText("No Flair structure linked yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Flair zone" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("disables an option already assigned to a different air handler, but not this one's own", async () => {
    fetchAvailableFlairZones.mockResolvedValue([
      {
        id: "fz-1",
        name: "Upstairs",
        assignedAirHandlerId: "ah-other",
        assignedAirHandlerName: "Downstairs",
      },
      {
        id: "fz-2",
        name: "Attic",
        assignedAirHandlerId: "ah-1",
        assignedAirHandlerName: "Attic Unit",
      },
    ]);
    const user = userEvent.setup();
    renderSelect({ currentAirHandlerId: "ah-1" });
    await user.click(
      await screen.findByRole("combobox", { name: "Flair zone" }),
    );
    const takenOption = await screen.findByRole("option", {
      name: /Upstairs.*assigned to Downstairs/,
    });
    expect(takenOption).toHaveAttribute("aria-disabled", "true");
    const ownOption = screen.getByRole("option", { name: "Attic" });
    expect(ownOption).not.toHaveAttribute("aria-disabled", "true");
  });

  it("calls onChange with the selected zone id", async () => {
    fetchAvailableFlairZones.mockResolvedValue([
      {
        id: "fz-1",
        name: "Upstairs",
        assignedAirHandlerId: null,
        assignedAirHandlerName: null,
      },
    ]);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderSelect({ onChange });
    await user.click(
      await screen.findByRole("combobox", { name: "Flair zone" }),
    );
    await user.click(await screen.findByRole("option", { name: "Upstairs" }));
    expect(onChange).toHaveBeenCalledWith("fz-1");
  });
});
