import { Alert, Snackbar } from "@mui/material";
import { useCallback, useState, type ReactNode } from "react";
import { NotificationContext } from "~/client/components/notification/notificationContextValue";

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "error" | "warning" | "info" | "success";
    duration: number;
  }>({
    open: false,
    message: "",
    severity: "info",
    duration: 3000,
  });

  const showNotification = useCallback(
    (
      message: string,
      severity: "error" | "warning" | "info" | "success" = "info",
      duration = 3000,
    ) => {
      setNotification({ open: true, message, severity, duration });
    },
    [],
  );

  const closeNotification = useCallback(() => {
    setNotification((prev) => ({ ...prev, open: false }));
  }, []);

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      <Snackbar
        open={notification.open}
        autoHideDuration={notification.duration}
        onClose={closeNotification}
      >
        <Alert severity={notification.severity}>{notification.message}</Alert>
      </Snackbar>
    </NotificationContext.Provider>
  );
};
