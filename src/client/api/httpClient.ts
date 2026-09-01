import axios from "axios";

// The single axios instance every API call goes through — no component or
// hook should ever call axios/fetch directly. This is the one seam where an
// Authorization header could be added later if login is ever introduced.
export const httpClient = axios.create({
  baseURL: "/api/v1",
  timeout: 10000,
});
