import { describe, it, expect, vi, beforeEach } from "vitest";

const { httpClient } = vi.hoisted(() => ({
  httpClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("~/client/api/httpClient", () => ({ httpClient }));

const { fetchMembers, inviteMember, updateMemberRole, revokeMember } =
  await import("~/client/api/installationMemberApi");

beforeEach(() => {
  httpClient.get.mockReset();
  httpClient.post.mockReset();
  httpClient.patch.mockReset();
  httpClient.delete.mockReset();
});

describe("installationMemberApi", () => {
  it("fetchMembers unwraps the members array", async () => {
    httpClient.get.mockResolvedValue({ data: { members: [{ id: "1" }] } });
    expect(await fetchMembers()).toEqual([{ id: "1" }]);
    expect(httpClient.get).toHaveBeenCalledWith("/installation-members");
  });

  it("inviteMember unwraps the created member", async () => {
    httpClient.post.mockResolvedValue({ data: { member: { id: "1" } } });
    const result = await inviteMember({
      email: "a@example.com",
      role: "write",
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      "/installation-members/invite",
      { email: "a@example.com", role: "write" },
    );
    expect(result).toEqual({ id: "1" });
  });

  it("updateMemberRole patches the given member", async () => {
    httpClient.patch.mockResolvedValue({ data: {} });
    await updateMemberRole("member-1", "read");
    expect(httpClient.patch).toHaveBeenCalledWith(
      "/installation-members/member-1",
      { role: "read" },
    );
  });

  it("revokeMember deletes by id", async () => {
    httpClient.delete.mockResolvedValue({ data: {} });
    await revokeMember("member-1");
    expect(httpClient.delete).toHaveBeenCalledWith(
      "/installation-members/member-1",
    );
  });
});
