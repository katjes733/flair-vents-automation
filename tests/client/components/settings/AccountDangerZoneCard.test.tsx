/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { deleteAccount } = vi.hoisted(() => ({ deleteAccount: vi.fn() }));
vi.mock("~/client/api/accountApi", () => ({ deleteAccount }));

const { default: AccountDangerZoneCard } =
  await import("~/client/components/settings/AccountDangerZoneCard");

function renderCard() {
  return render(<AccountDangerZoneCard />);
}

describe("AccountDangerZoneCard", () => {
  const logoutEverywhere = vi.fn();

  beforeEach(() => {
    logoutEverywhere.mockReset().mockResolvedValue(undefined);
    deleteAccount.mockReset();
    useSession.mockReturnValue({ logoutEverywhere });
  });

  it("confirms before logging out everywhere, then calls it", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Log out everywhere" }));
    expect(screen.getByText("Log out everywhere?")).toBeInTheDocument();
    expect(logoutEverywhere).not.toHaveBeenCalled();

    // Two buttons now share this accessible name — the card's own trigger
    // and the confirm dialog's own action — the dialog's is the last one.
    const dialogButtons = screen.getAllByRole("button", {
      name: "Log out everywhere",
    });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);
    await vi.waitFor(() => expect(logoutEverywhere).toHaveBeenCalledOnce());
  });

  it("requires a password before Delete my account is enabled", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "correct-password" },
    });
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).not.toBeDisabled();
  });

  it("shows the server's error inline on a failed deletion", async () => {
    deleteAccount.mockRejectedValue({
      response: { data: { error: "You're the only owner of Home — ..." } },
      isAxiosError: true,
    });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText(/only owner of Home/)).toBeInTheDocument();
  });

  it("calls deleteAccount with the entered password on confirmation", async () => {
    // A successful deletion hard-navigates to /login afterward (see the
    // component's own comment on why) — jsdom logs a harmless "Not
    // implemented: navigation" warning for that call, which doesn't fail
    // this test and isn't worth stubbing around (window.location.assign
    // isn't reconfigurable in this jsdom version).
    deleteAccount.mockResolvedValue(undefined);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await vi.waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith("correct-password"),
    );
  });
});
