/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ZonePriorityList from "~/client/components/shared/ZonePriorityList";

afterEach(cleanup);

const ZONES = [
  { id: "z1", name: "First" },
  { id: "z2", name: "Second" },
  { id: "z3", name: "Third" },
];

describe("ZonePriorityList", () => {
  it("renders every zone in the given order, numbered", () => {
    render(
      <ZonePriorityList
        zones={ZONES}
        value={["z2", "z1", "z3"]}
        onChange={vi.fn()}
      />,
    );
    const headings = screen.getAllByText(/^\d\. /);
    expect(headings.map((h) => h.textContent)).toEqual([
      "1. Second",
      "2. First",
      "3. Third",
    ]);
  });

  it("appends a zone missing from value at the end, without requiring the caller to pre-normalize", () => {
    render(
      <ZonePriorityList zones={ZONES} value={["z2"]} onChange={vi.fn()} />,
    );
    expect(screen.getByText("1. Second")).toBeInTheDocument();
    expect(screen.getByText("2. First")).toBeInTheDocument();
    expect(screen.getByText("3. Third")).toBeInTheDocument();
  });

  it("disables the up arrow for the first zone and the down arrow for the last", () => {
    render(
      <ZonePriorityList
        zones={ZONES}
        value={["z1", "z2", "z3"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Move First up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Third down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move First down" }),
    ).not.toBeDisabled();
  });

  it("moving a zone down calls onChange with the full swapped order", () => {
    const onChange = vi.fn();
    render(
      <ZonePriorityList
        zones={ZONES}
        value={["z1", "z2", "z3"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move First down" }));
    expect(onChange).toHaveBeenCalledWith(["z2", "z1", "z3"]);
  });

  it("moving the second zone up calls onChange with the swapped order", () => {
    const onChange = vi.fn();
    render(
      <ZonePriorityList
        zones={ZONES}
        value={["z1", "z2", "z3"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move Second up" }));
    expect(onChange).toHaveBeenCalledWith(["z2", "z1", "z3"]);
  });

  it("shows exactly one drop indicator while dragging, on the row being dragged over", () => {
    render(
      <ZonePriorityList
        zones={ZONES}
        value={["z1", "z2", "z3"]}
        onChange={vi.fn()}
      />,
    );
    const firstRow = screen
      .getByText("1. First")
      .closest('[draggable="true"]')!;
    const thirdRow = screen
      .getByText("3. Third")
      .closest('[draggable="true"]')!;

    fireEvent.dragStart(firstRow);
    fireEvent.dragOver(thirdRow, { clientX: 999 });

    expect(screen.getAllByTestId("priority-drop-indicator")).toHaveLength(1);

    fireEvent.dragEnd(firstRow);
    expect(
      screen.queryByTestId("priority-drop-indicator"),
    ).not.toBeInTheDocument();
  });

  it("a full drag-and-drop cycle calls onChange with the reordered list", () => {
    const onChange = vi.fn();
    render(
      <ZonePriorityList
        zones={ZONES}
        value={["z1", "z2", "z3"]}
        onChange={onChange}
      />,
    );
    const firstRow = screen
      .getByText("1. First")
      .closest('[draggable="true"]')!;
    const thirdRow = screen
      .getByText("3. Third")
      .closest('[draggable="true"]')!;

    fireEvent.dragStart(firstRow);
    fireEvent.dragOver(thirdRow, { clientX: 999 }); // right half -> "after"
    fireEvent.drop(thirdRow);

    expect(onChange).toHaveBeenCalledWith(["z2", "z3", "z1"]);
  });

  it("renders a fallback message when there are no zones at all", () => {
    render(<ZonePriorityList zones={[]} value={[]} onChange={vi.fn()} />);
    expect(screen.getByText("No zones to rank yet.")).toBeInTheDocument();
  });
});
