import { useContext } from "react";
import { DisplayUnitContext } from "~/client/theme/displayUnitContextValue";

export const useDisplayUnit = () => useContext(DisplayUnitContext);
