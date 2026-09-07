/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import SectionHeading from "~/client/components/shared/SectionHeading";

afterEach(cleanup);

const theme = createTheme();

function renderHeading(
  props: Partial<Parameters<typeof SectionHeading>[0]> = {},
) {
  return render(
    <ThemeProvider theme={theme}>
      <SectionHeading
        title="Spike Detection"
        description="Flags a rapid temperature change."
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("SectionHeading", () => {
  it("renders the title as plain text", () => {
    renderHeading();
    expect(screen.getByText("Spike Detection")).toBeInTheDocument();
  });

  it("exposes an info button labeled for this section", () => {
    renderHeading();
    expect(
      screen.getByRole("button", { name: "About Spike Detection" }),
    ).toBeInTheDocument();
  });

  it("shows the description in a tooltip on hover", async () => {
    const user = userEvent.setup();
    renderHeading();
    await user.hover(
      screen.getByRole("button", { name: "About Spike Detection" }),
    );
    expect(
      await screen.findByText("Flags a rapid temperature change."),
    ).toBeInTheDocument();
  });

  it("uses a distinct label per title, not a shared generic one", () => {
    renderHeading({ title: "Manual Override Activity" });
    expect(
      screen.getByRole("button", { name: "About Manual Override Activity" }),
    ).toBeInTheDocument();
  });
});
