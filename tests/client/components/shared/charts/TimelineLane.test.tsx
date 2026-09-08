/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TimelineLane from "~/client/components/shared/charts/TimelineLane";

afterEach(cleanup);

// jsdom never computes real layout — every hover test below stubs
// getBoundingClientRect on the lane itself so mouse-position math has a
// real, known width/left to work against.
function stubRect(el: Element, left: number, width: number) {
  el.getBoundingClientRect = () =>
    ({
      left,
      width,
      top: 0,
      height: 28,
      right: left + width,
      bottom: 28,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("TimelineLane", () => {
  it("positions each segment by its proportional share of the domain", () => {
    render(
      <TimelineLane
        domain={[0, 100]}
        segments={[
          { startMs: 0, endMs: 25, color: "red", label: "A" },
          { startMs: 25, endMs: 100, color: "blue", label: "B" },
        ]}
      />,
    );
    const boxes = screen.getAllByTestId("timeline-segment");
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLElement).style.left).toBe("0%");
    expect((boxes[0] as HTMLElement).style.width).toBe("25%");
    expect((boxes[1] as HTMLElement).style.left).toBe("25%");
    expect((boxes[1] as HTMLElement).style.width).toBe("75%");
  });

  it("clips a segment that extends past the domain", () => {
    render(
      <TimelineLane
        domain={[0, 50]}
        segments={[{ startMs: -10, endMs: 100, color: "red", label: "A" }]}
      />,
    );
    const box = screen.getByTestId("timeline-segment");
    expect(box.style.left).toBe("0%");
    expect(box.style.width).toBe("100%");
  });

  it("renders nothing for a segment entirely outside the domain", () => {
    render(
      <TimelineLane
        domain={[0, 50]}
        segments={[{ startMs: 100, endMs: 200, color: "red", label: "A" }]}
      />,
    );
    expect(screen.queryAllByTestId("timeline-segment")).toHaveLength(0);
  });

  it("shows a tooltip with the hovered segment's label and a formatted time", () => {
    render(
      <TimelineLane
        domain={[0, 1000]}
        segments={[
          { startMs: 0, endMs: 500, color: "red", label: "Cooling" },
          { startMs: 500, endMs: 1000, color: "green", label: "Idle" },
        ]}
      />,
    );
    const lane = screen.getByTestId("timeline-lane");
    stubRect(lane, 0, 200);

    // 25% across a 200px-wide lane -> clientX=50 -> falls in the first segment.
    fireEvent.mouseMove(lane, { clientX: 50 });
    expect(screen.getByText("Cooling")).toBeInTheDocument();
    expect(screen.getByText(/Jan 1/)).toBeInTheDocument();
  });

  it("switches the tooltip content when the cursor moves into a different segment", () => {
    render(
      <TimelineLane
        domain={[0, 1000]}
        segments={[
          { startMs: 0, endMs: 500, color: "red", label: "Cooling" },
          { startMs: 500, endMs: 1000, color: "green", label: "Idle" },
        ]}
      />,
    );
    const lane = screen.getByTestId("timeline-lane");
    stubRect(lane, 0, 200);

    fireEvent.mouseMove(lane, { clientX: 50 }); // 25% -> first segment
    expect(screen.getByText("Cooling")).toBeInTheDocument();

    fireEvent.mouseMove(lane, { clientX: 150 }); // 75% -> second segment
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.queryByText("Cooling")).not.toBeInTheDocument();
  });

  it("hides the tooltip on mouse leave", () => {
    render(
      <TimelineLane
        domain={[0, 1000]}
        segments={[{ startMs: 0, endMs: 1000, color: "red", label: "Cooling" }]}
      />,
    );
    const lane = screen.getByTestId("timeline-lane");
    stubRect(lane, 0, 200);

    fireEvent.mouseMove(lane, { clientX: 50 });
    expect(screen.getByText("Cooling")).toBeInTheDocument();

    fireEvent.mouseLeave(lane);
    expect(screen.queryByText("Cooling")).not.toBeInTheDocument();
  });

  it("shows no tooltip when hovering a gap with no matching segment", () => {
    render(
      <TimelineLane
        domain={[0, 1000]}
        segments={[{ startMs: 0, endMs: 200, color: "red", label: "Cooling" }]}
      />,
    );
    const lane = screen.getByTestId("timeline-lane");
    stubRect(lane, 0, 200);

    // 90% across -> timeMs=900, past the only segment's endMs=200.
    fireEvent.mouseMove(lane, { clientX: 180 });
    expect(screen.queryByText("Cooling")).not.toBeInTheDocument();
  });
});
