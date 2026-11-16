import type { Config } from "../config.js";
import type { FlightProvider } from "../types.js";
import { DuffelProvider } from "./duffel.js";
import { MockProvider } from "./mock.js";

export const makeProvider = (cfg: Config): FlightProvider =>
  cfg.provider === "duffel" ? new DuffelProvider(process.env.DUFFEL_TOKEN ?? "") : new MockProvider();
