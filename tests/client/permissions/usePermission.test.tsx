/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(cleanup);

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { usePermission, useCanWrite } =
  await import("~/client/permissions/usePermission");

function Probe({ action }: { action: "dashboard.zone.create" }) {
  const level = usePermission(action);
  const canWrite = useCanWrite(action);
  return (
    <div>
      <span data-testid="level">{level}</span>
      <span data-testid="canWrite">{String(canWrite)}</span>
    </div>
  );
}

describe("usePermission", () => {
  it("resolves 'none' when there's no logged-in user", () => {
    useSession.mockReturnValue({ user: null });
    render(<Probe action="dashboard.zone.create" />);
    expect(screen.getByTestId("level")).toHaveTextContent("none");
    expect(screen.getByTestId("canWrite")).toHaveTextContent("false");
  });

  it("resolves 'read' (visible, disabled) for a read-profile user", () => {
    useSession.mockReturnValue({ user: { profile: "read" } });
    render(<Probe action="dashboard.zone.create" />);
    expect(screen.getByTestId("level")).toHaveTextContent("read");
    expect(screen.getByTestId("canWrite")).toHaveTextContent("false");
  });

  it("resolves 'write' for a write-profile user", () => {
    useSession.mockReturnValue({ user: { profile: "write" } });
    render(<Probe action="dashboard.zone.create" />);
    expect(screen.getByTestId("level")).toHaveTextContent("write");
    expect(screen.getByTestId("canWrite")).toHaveTextContent("true");
  });

  it("resolves 'none' for an admin-only action under a non-admin profile", () => {
    useSession.mockReturnValue({ user: { profile: "write" } });
    render(<Probe action={"installationAdmin.access" as any} />);
    expect(screen.getByTestId("level")).toHaveTextContent("none");
  });

  it("resolves 'write' for an admin-only action under the admin profile", () => {
    useSession.mockReturnValue({ user: { profile: "admin" } });
    render(<Probe action={"installationAdmin.access" as any} />);
    expect(screen.getByTestId("level")).toHaveTextContent("write");
  });
});
