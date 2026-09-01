import { useContext } from "react";
import { NotificationContext } from "~/client/components/notification/notificationContextValue";

export const useNotification = () => useContext(NotificationContext);
