import { useCallback, useEffect, useState, type FormEvent } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import { usePermission } from "~/client/permissions/usePermission";
import { useSession } from "~/client/session/useSession";
import { useNotification } from "~/client/components/notification/useNotification";
import { extractErrorMessage } from "~/client/api/errorMessage";
import {
  fetchMembers,
  inviteMember,
  updateMemberRole,
  revokeMember,
  type InstallationMember,
} from "~/client/api/installationMemberApi";
import type { MemberRole } from "~/client/api/sessionApi";

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  write: "Write",
  read: "Read",
};

export default function MembersPage() {
  const { user } = useSession();
  const { showNotification } = useNotification();
  const canAccess = usePermission("installationAdmin.access") !== "none";
  const canInvite = usePermission("installationAdmin.inviteMember") === "write";
  const canUpdate = usePermission("installationAdmin.updateMember") === "write";
  const canRevoke = usePermission("installationAdmin.revokeMember") === "write";

  const [members, setMembers] = useState<InstallationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("write");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await fetchMembers());
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't load members.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess, load]);

  if (!canAccess) {
    return (
      <Container maxWidth="sm" sx={{ px: 2 }}>
        <Alert severity="info">
          You don't have access to manage this installation's members.
        </Alert>
      </Container>
    );
  }

  const roleOptions: MemberRole[] =
    user?.role === "owner"
      ? ["owner", "admin", "write", "read"]
      : ["admin", "write", "read"];

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      await inviteMember({ email, role });
      setEmail("");
      setRole("write");
      showNotification(`Invited ${email}.`, "success");
      await load();
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't send the invite.");
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: MemberRole) => {
    try {
      await updateMemberRole(memberId, newRole);
      showNotification("Role updated.", "success");
      await load();
    } catch (err) {
      showNotification(
        extractErrorMessage(err) ?? "Couldn't update that member's role.",
        "error",
      );
    }
  };

  const handleRevoke = async (memberId: string) => {
    try {
      await revokeMember(memberId);
      showNotification("Member removed.", "success");
      await load();
    } catch (err) {
      showNotification(
        extractErrorMessage(err) ?? "Couldn't remove that member.",
        "error",
      );
    }
  };

  const ownerCount = members.filter((m) => m.role === "owner").length;

  return (
    <Container maxWidth="sm" sx={{ px: 2 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Members
      </Typography>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}

        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
              Who has access
            </Typography>
            {!loading && (
              <List dense disablePadding>
                {members.map((member) => {
                  const isLastOwner =
                    member.role === "owner" && ownerCount <= 1;
                  return (
                    <ListItem
                      key={member.id}
                      disableGutters
                      // Deliberately not passed via ListItemText's own
                      // `secondary` prop — MUI renders that inside a <p>,
                      // and a TextField's root is a <div>; the resulting
                      // <div> nested in a <p> is invalid HTML that React
                      // itself flags at runtime (confirmed live). Rendering
                      // the selector as ListItemText's sibling instead
                      // avoids the nesting entirely.
                      secondaryAction={
                        <IconButton
                          edge="end"
                          aria-label={`Remove ${member.email}`}
                          disabled={!canRevoke || isLastOwner}
                          onClick={() => handleRevoke(member.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      }
                      sx={{ flexDirection: "column", alignItems: "flex-start" }}
                    >
                      <ListItemText primary={member.email} />
                      <TextField
                        select
                        size="small"
                        variant="standard"
                        value={member.role}
                        disabled={
                          !canUpdate || (isLastOwner && member.role === "owner")
                        }
                        onChange={(e) =>
                          handleRoleChange(
                            member.id,
                            e.target.value as MemberRole,
                          )
                        }
                        sx={{ mt: 0.5, minWidth: 120 }}
                      >
                        {(member.role === "owner"
                          ? (["owner", "admin", "write", "read"] as const)
                          : roleOptions
                        ).map((r) => (
                          <MenuItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </MenuItem>
                        ))}
                      </TextField>
                    </ListItem>
                  );
                })}
              </List>
            )}
          </CardContent>
        </Card>

        {canInvite && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
                Invite someone
              </Typography>
              <Box component="form" onSubmit={handleInvite}>
                <Stack spacing={2}>
                  <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    fullWidth
                  />
                  <TextField
                    select
                    label="Role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as MemberRole)}
                    fullWidth
                  >
                    {roleOptions.map((r) => (
                      <MenuItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={inviting || !email}
                  >
                    {inviting ? "Sending invite…" : "Send invite"}
                  </Button>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Container>
  );
}
