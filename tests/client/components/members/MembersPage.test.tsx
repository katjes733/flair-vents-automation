/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { fetchMembers, inviteMember, updateMemberRole, revokeMember } =
  vi.hoisted(() => ({
    fetchMembers: vi.fn(),
    inviteMember: vi.fn(),
    updateMemberRole: vi.fn(),
    revokeMember: vi.fn(),
  }));
vi.mock("~/client/api/installationMemberApi", () => ({
  fetchMembers,
  inviteMember,
  updateMemberRole,
  revokeMember,
}));

const { default: MembersPage } =
  await import("~/client/components/members/MembersPage");

function renderPage() {
  return render(
    <NotificationProvider>
      <MembersPage />
    </NotificationProvider>,
  );
}

const OWNER_USER = { profile: "admin", role: "owner" };

beforeEach(() => {
  fetchMembers.mockReset().mockResolvedValue([]);
  inviteMember.mockReset();
  updateMemberRole.mockReset();
  revokeMember.mockReset();
  useSession.mockReturnValue({ user: OWNER_USER });
});

describe("MembersPage", () => {
  it("shows an access-denied message for a non-admin profile, without ever fetching", async () => {
    useSession.mockReturnValue({ user: { profile: "write", role: "write" } });
    renderPage();
    expect(screen.getByText(/don't have access to manage/)).toBeInTheDocument();
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  it("lists members once loaded", async () => {
    fetchMembers.mockResolvedValue([
      {
        id: "member-1",
        installationId: "inst-1",
        userId: "user-1",
        email: "owner@example.com",
        role: "owner",
        scope: { air_handler_ids: "*" },
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "member-2",
        installationId: "inst-1",
        userId: "user-2",
        email: "delegate@example.com",
        role: "write",
        scope: { air_handler_ids: "*" },
        createdAt: "2024-01-02T00:00:00.000Z",
      },
    ]);
    renderPage();
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("delegate@example.com")).toBeInTheDocument();
  });

  it("offers 'Owner' as a role option only for an owner-role actor", async () => {
    renderPage();
    await waitFor(() => expect(fetchMembers).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Role" }));
    expect(
      await screen.findByRole("option", { name: "Owner" }),
    ).toBeInTheDocument();
  });

  it("hides 'Owner' as an invite option for a non-owner (admin) actor", async () => {
    useSession.mockReturnValue({ user: { profile: "admin", role: "admin" } });
    renderPage();
    await waitFor(() => expect(fetchMembers).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Role" }));
    expect(
      screen.queryByRole("option", { name: "Owner" }),
    ).not.toBeInTheDocument();
  });

  it("invites a new member and reloads the list", async () => {
    inviteMember.mockResolvedValue({ id: "member-3" });
    renderPage();
    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(inviteMember).toHaveBeenCalledWith({
        email: "new@example.com",
        role: "write",
      }),
    );
    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(2));
  });

  it("disables removing the installation's sole owner", async () => {
    fetchMembers.mockResolvedValue([
      {
        id: "member-1",
        installationId: "inst-1",
        userId: "user-1",
        email: "owner@example.com",
        role: "owner",
        scope: { air_handler_ids: "*" },
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    await screen.findByText("owner@example.com");
    expect(
      screen.getByRole("button", { name: "Remove owner@example.com" }),
    ).toBeDisabled();
  });

  it("removes a non-sole-owner member", async () => {
    fetchMembers.mockResolvedValue([
      {
        id: "member-1",
        installationId: "inst-1",
        userId: "user-1",
        email: "owner@example.com",
        role: "owner",
        scope: { air_handler_ids: "*" },
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "member-2",
        installationId: "inst-1",
        userId: "user-2",
        email: "delegate@example.com",
        role: "write",
        scope: { air_handler_ids: "*" },
        createdAt: "2024-01-02T00:00:00.000Z",
      },
    ]);
    revokeMember.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("delegate@example.com");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove delegate@example.com" }),
    );
    await waitFor(() => expect(revokeMember).toHaveBeenCalledWith("member-2"));
  });
});
