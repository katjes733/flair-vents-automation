import pino from "pino";
import {
  REDACT_PATHS,
  deepScrub,
  safeReqSerializer,
  scrubLogArgs,
} from "~/server/logRedaction";

export default function createLogger(
  env: Record<string, string | undefined> = process.env,
  // Injectable so tests can point the logger at an in-memory sink instead of
  // stdout — see tests/server/logRedaction.test.ts.
  destination: pino.DestinationStream = pino.destination(1),
) {
  const prettyPrint =
    env.LOG_PRETTY_PRINT !== undefined
      ? env.LOG_PRETTY_PRINT === "true"
      : env.NODE_ENV !== "production";

  return pino(
    {
      level: env.LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: REDACT_PATHS,
        censor: "[REDACTED]",
      },
      serializers: {
        req: safeReqSerializer,
        flairRequest: deepScrub,
        flairResponse: deepScrub,
        payload: deepScrub,
        body: deepScrub,
      },
      hooks: {
        logMethod(inputArgs, method) {
          method.apply(
            this,
            scrubLogArgs(inputArgs) as Parameters<typeof method>,
          );
        },
      },
      formatters: {
        level: (label: string): { level: string } => ({ level: label }),
        bindings: (): Record<string, unknown> => ({}),
      },
      ...(prettyPrint && {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            levelFirst: true,
            translateTime: "UTC:mm/dd/yyyy, h:MM:ss TT Z",
          },
        },
      }),
    },
    destination,
  );
}
