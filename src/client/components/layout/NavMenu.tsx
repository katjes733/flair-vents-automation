import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AppsIcon from "@mui/icons-material/Apps";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import BugReportIcon from "@mui/icons-material/BugReport";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useState, type MouseEvent } from "react";
import { useNavigate, useLocation } from "react-router";
import { useThemeMode } from "~/client/theme/useThemeMode";
import { useDiagnosticMode } from "~/client/theme/useDiagnosticMode";
import { useSession } from "~/client/session/useSession";
import { usePermission } from "~/client/permissions/usePermission";

interface NavItem {
  path: string;
  label: string;
}

// One array drives both the page title lookup and the nav menu, so they
// can't drift apart — same convention as wake-on-lan's NavMenu. "Members"
// stays in this same list (so its page title still resolves) but is
// filtered out of the rendered menu below for anyone without
// installationAdmin access — read/write roles never see it at all.
const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard" },
  { path: "/schedules", label: "Schedules" },
  { path: "/diagnostics", label: "Diagnostics" },
  { path: "/telemetry", label: "Telemetry" },
  { path: "/settings", label: "Settings" },
  { path: "/system-parameters", label: "System Parameters" },
  { path: "/members", label: "Members" },
];

const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.path, item.label]),
);

export default function NavMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { mode, toggle: toggleThemeMode } = useThemeMode();
  const { diagnosticMode, toggle: toggleDiagnosticMode } = useDiagnosticMode();
  const { user, logout } = useSession();
  const canAccessMembers = usePermission("installationAdmin.access") !== "none";
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => item.path !== "/members" || canAccessMembers,
  );
  const pageTitle = PAGE_TITLES[location.pathname] ?? "";
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [mainMenuAnchor, setMainMenuAnchor] = useState<null | HTMLElement>(
    null,
  );
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(
    null,
  );

  const handleMainMenuOpen = (event: MouseEvent<HTMLElement>) => {
    setMainMenuAnchor(event.currentTarget);
  };

  const handleMainMenuClose = () => {
    setMainMenuAnchor(null);
  };

  const handleNavigate = useCallback(
    (path: string) => {
      handleMainMenuClose();
      navigate(path);
    },
    [navigate],
  );

  const handleUserMenuOpen = (event: MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleLogout = () => {
    handleUserMenuClose();
    logout();
  };

  return (
    <AppBar
      position="fixed"
      color="primary"
      enableColorOnDark
      sx={{
        width: "100%",
        bgcolor: "background.paper",
        color: "text.primary",
        boxShadow: 1,
      }}
    >
      <Toolbar sx={{ minHeight: { xs: 48, sm: 64 }, px: 2 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexShrink: 1,
            flexGrow: 0,
            // Reserve the same width whether or not the hamburger renders,
            // so the centered title doesn't jump between the login/signup
            // pages (no user yet) and the rest of the app.
            minWidth: { xs: 40, sm: 48 },
          }}
        >
          {user && (
            <>
              <IconButton
                edge="start"
                color="inherit"
                aria-label="menu"
                onClick={handleMainMenuOpen}
                sx={{ mr: 1 }}
              >
                <AppsIcon />
              </IconButton>
              <Menu
                anchorEl={mainMenuAnchor}
                open={Boolean(mainMenuAnchor)}
                onClose={handleMainMenuClose}
              >
                {visibleNavItems.map((item) => (
                  <MenuItem
                    key={item.path}
                    onClick={() => handleNavigate(item.path)}
                  >
                    {item.label}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexDirection: "row",
            flexGrow: 1,
            minWidth: 0,
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {isMobile ? (
            <Typography variant="h6" component="div" fontWeight={600} noWrap>
              {pageTitle}
            </Typography>
          ) : (
            <Typography variant="h5" component="div" fontWeight={600} noWrap>
              Flair Vents Automation
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {user && (
            <Tooltip
              title={
                diagnosticMode
                  ? "Turn off Diagnostic Mode"
                  : "Turn on Diagnostic Mode"
              }
            >
              <IconButton
                color={diagnosticMode ? "primary" : "inherit"}
                onClick={toggleDiagnosticMode}
                aria-label="Toggle Diagnostic Mode"
              >
                <BugReportIcon />
              </IconButton>
            </Tooltip>
          )}
          <IconButton
            color="inherit"
            onClick={toggleThemeMode}
            aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
          >
            {mode === "light" ? <DarkModeIcon /> : <LightModeIcon />}
          </IconButton>
          {user && (
            <>
              <Tooltip title={user.loginEmail}>
                <IconButton
                  color="inherit"
                  onClick={handleUserMenuOpen}
                  aria-label="Account menu"
                >
                  <AccountCircleIcon />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={userMenuAnchor}
                open={Boolean(userMenuAnchor)}
                onClose={handleUserMenuClose}
              >
                <MenuItem disabled sx={{ opacity: "1 !important" }}>
                  <Box>
                    <Typography variant="body2">{user.loginEmail}</Typography>
                    {user.installationName && (
                      <Typography variant="caption" color="text.secondary">
                        {user.installationName}
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleLogout}>Log out</MenuItem>
              </Menu>
            </>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
