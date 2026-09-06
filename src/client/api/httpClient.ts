import axios from "axios";

// The single axios instance every API call goes through — no component or
// hook should ever call axios/fetch directly. withCredentials is required
// for the session cookie to actually be sent/stored now that real auth
// exists (harmless when client and server share an origin, via the Vite
// dev proxy or the built app's own static serving — see the server's own
// cors({credentials: true}) config, which anticipates this).
export const httpClient = axios.create({
  baseURL: "/api/v1",
  timeout: 10000,
  withCredentials: true,
});

// Registered by SessionProvider so a 401 from ANY API call — not just the
// session endpoints — is treated uniformly as "you're no longer logged
// in," regardless of which component happened to be calling. A
// module-level seam rather than a React context, since this is the one
// place every axios call site needs to reach uniformly.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);
