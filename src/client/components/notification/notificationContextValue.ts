import { createContext } from "react";

export type NotificationContextType = {
  showNotification: (
    message: string,
    severity?: "error" | "warning" | "info" | "success",
    duration?: number,
  ) => void;
};

export const NotificationContext = createContext<NotificationContextType>({
  showNotification: () => {},
});
