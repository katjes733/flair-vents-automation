/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import TimelineLane from "~/client/components/shared/charts/TimelineLane";

afterEach(cleanup);

describe("TimelineLane", () => {
  it("positions each segment by its proportional share of the domain", () => {
    const { container } = render(
      <TimelineLane
        domain={[0, 100]}
        segments={[
          { startMs: 0, endMs: 25, color: "red", label: "A" },
          { startMs: 25, endMs: 100, color: "blue", label: "B" },
        ]}
      />,
    );
    const boxes = container.querySelectorAll("[title]");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toHaveAttribute("title", "A");
    expect((boxes[0] as HTMLElement).style.left).toBe("0%");
    expect((boxes[0] as HTMLElement).style.width).toBe("25%");
    expect((boxes[1] as HTMLElement).style.left).toBe("25%");
    expect((boxes[1] as HTMLElement).style.width).toBe("75%");
  });

  it("clips a segment that extends past the domain", () => {
    const { container } = render(
      <TimelineLane
        domain={[0, 50]}
        segments={[{ startMs: -10, endMs: 100, color: "red", label: "A" }]}
      />,
    );
    const box = container.querySelector("[title]") as HTMLElement;
    expect(box.style.left).toBe("0%");
    expect(box.style.width).toBe("100%");
  });

  it("renders nothing for a segment entirely outside the domain", () => {
    const { container } = render(
      <TimelineLane
        domain={[0, 50]}
        segments={[{ startMs: 100, endMs: 200, color: "red", label: "A" }]}
      />,
    );
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });
});
