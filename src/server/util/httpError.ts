// An error with a deliberate, known HTTP status — as opposed to an
// unexpected internal failure, which the generic handler treats as a 500.
// CORS rejection is the first caller; any future intentional rejection
// (e.g. a not-found lookup) reuses the same mechanism rather than each
// inventing its own status-code convention.
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
