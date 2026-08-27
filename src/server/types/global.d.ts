/* eslint-disable no-unused-vars */
import type pino from "pino";

/* mark as a module so TS treats it as a declaration file */
export {};

declare global {
  var logger: pino;
}
