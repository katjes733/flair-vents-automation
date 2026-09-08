import type {
  HomeKitClient,
  HomeKitCurrentState,
} from "~/server/util/homekit/client";

// A stateful, in-memory fake — mirrors tests/helpers/fakeFlairClient.ts's
// own scriptable-fault-injection pattern, so control-loop tests exercise
// the HomeKit delivery path with zero real network/HAP dependency.

export interface HomeKitWriteCall {
  kind: "target" | "threshold-heat" | "threshold-cool";
  value: number;
  at: number;
}

export class FakeHomeKitClient implements HomeKitClient {
  private state: HomeKitCurrentState = {
    currentTempC: 22,
    targetMode: 2,
    targetTemperatureC: 22,
    heatThresholdC: null,
    coolThresholdC: null,
    currentHeatingCoolingState: 2,
    currentFanState: 2,
  };
  private paired = true;
  private forcedError: Error | null = null;
  readonly writeHistory: HomeKitWriteCall[] = [];
  removePairingCallCount = 0;

  setState(state: Partial<HomeKitCurrentState>): void {
    this.state = { ...this.state, ...state };
  }

  setPaired(paired: boolean): void {
    this.paired = paired;
  }

  forceError(error: Error | null): void {
    this.forcedError = error;
  }

  private maybeThrow(): void {
    if (this.forcedError) throw this.forcedError;
    if (!this.paired) throw new Error("Not paired");
  }

  async isPaired(): Promise<boolean> {
    if (this.forcedError) return false;
    return this.paired;
  }

  async getCurrentState(): Promise<HomeKitCurrentState> {
    this.maybeThrow();
    return this.state;
  }

  async setTargetTemperature(valueC: number): Promise<void> {
    this.maybeThrow();
    this.writeHistory.push({ kind: "target", value: valueC, at: Date.now() });
    this.state = { ...this.state, targetTemperatureC: valueC };
  }

  async setThresholdTemperature(
    which: "heat" | "cool",
    valueC: number,
  ): Promise<void> {
    this.maybeThrow();
    this.writeHistory.push({
      kind: which === "heat" ? "threshold-heat" : "threshold-cool",
      value: valueC,
      at: Date.now(),
    });
  }

  async removePairing(): Promise<void> {
    this.maybeThrow();
    this.removePairingCallCount += 1;
  }
}
