import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface BreakerEntry {
  readonly failures: number;
}

type BreakerStateMap = Record<string, BreakerEntry>;

/**
 * Persist per-session, per-file quality failure counts in a JSON state file.
 *
 * Opens the circuit breaker once a file reaches the configured consecutive
 * failure threshold and resets the counter when the file is read or passes.
 */
export class CircuitBreakerStore {
  private readonly stateFilePath: string;
  private readonly threshold: number;

  public constructor(stateDir?: string, threshold: number = 3) {
    const baseDir = stateDir ?? join(tmpdir(), "gb-agent-code-quality-circuit-breaker");
    mkdirSync(baseDir, { recursive: true });
    this.stateFilePath = join(baseDir, "state.json");
    this.threshold = threshold;
  }

  /**
   * Return true when the consecutive failure count meets or exceeds threshold.
   */
  public isOpen(session: string, cwd: string, filePath: string): boolean {
    const state = this.readState();
    const key = this.buildKey(session, cwd, filePath);
    const entry = state[key];
    if (!entry) {
      return false;
    }
    return entry.failures >= this.threshold;
  }

  /**
   * Clear recorded failures for the given session and file path.
   */
  public reset(session: string, cwd: string, filePath: string): void {
    const state = this.readState();
    const key = this.buildKey(session, cwd, filePath);
    if (!(key in state)) {
      return;
    }
    delete state[key];
    this.writeState(state);
  }

  /**
   * Increment failure count and return true if the circuit breaker is now open.
   */
  public recordFailure(session: string, cwd: string, filePath: string): boolean {
    const state = this.readState();
    const key = this.buildKey(session, cwd, filePath);
    const current = state[key];
    const nextFailures = current ? current.failures + 1 : 1;
    state[key] = { failures: nextFailures };
    this.writeState(state);
    return nextFailures >= this.threshold;
  }

  /**
   * Build the structured terminal message emitted when the breaker is open.
   */
  public formatOpenMessage(cwd: string, filePath: string): string {
    const resolvedPath = resolve(cwd, filePath);
    return JSON.stringify({
      action: "read_file_again_or_request_help",
      cwd,
      failures: this.threshold,
      path: resolvedPath,
      status: "terminal",
      type: "circuit_breaker_open",
    });
  }

  private buildKey(session: string, cwd: string, filePath: string): string {
    const resolvedPath = resolve(cwd, filePath);
    return `${session}::${resolvedPath}`;
  }

  private readState(): BreakerStateMap {
    if (!existsSync(this.stateFilePath)) {
      return {};
    }
    try {
      const raw = readFileSync(this.stateFilePath, "utf-8");
      return JSON.parse(raw) as BreakerStateMap;
    } catch {
      return {};
    }
  }

  private writeState(state: BreakerStateMap): void {
    const serialized = JSON.stringify(state, null, 2);
    writeFileSync(this.stateFilePath, serialized, "utf-8");
  }
}
