import { CircuitBreakerStore } from "./circuit_breaker_store";
import type {
  HookApi,
  HookEventContext,
  ToolResultEvent,
  ToolResultPatch,
} from "./contracts";

const SUPPORTED_EXTENSIONS: Readonly<Record<string, true>> = {
  py: true,
  rs: true,
  go: true,
  ts: true,
  tsx: true,
  js: true,
  jsx: true,
  java: true,
  kt: true,
  swift: true,
  cs: true,
  c: true,
  h: true,
  cc: true,
  cpp: true,
  hpp: true,
  cxx: true,
  rb: true,
  php: true,
  scala: true,
  lua: true,
  sh: true,
  md: true,
  markdown: true,
};

const EDIT_TOOLS: Readonly<Record<string, true>> = {
  write: true,
  edit: true,
};

/**
 * Run post-tool code-quality checks and enforce circuit-breaker recovery rules.
 *
 * Resets the per-file circuit breaker on read operations and runs
 * check-code-quality on write or edit operations for supported extensions.
 */
export class QualityHookService {
  private readonly breaker: CircuitBreakerStore;

  public constructor(breaker: CircuitBreakerStore = new CircuitBreakerStore()) {
    this.breaker = breaker;
  }

  /**
   * Handle a single tool_result event and return a content patch on failure.
   */
  public async handleToolResult(
    api: HookApi,
    event: ToolResultEvent,
    ctx: HookEventContext,
  ): Promise<ToolResultPatch | undefined> {
    const targetPath = this.resolveSupportedPath(event);
    if (!targetPath) {
      return undefined;
    }
    const session = ctx.sessionId || ctx.cwd;
    const toolName = event.toolName.toLowerCase();
    if (toolName === "read") {
      this.breaker.reset(session, ctx.cwd, targetPath);
      return undefined;
    }
    if (!EDIT_TOOLS[toolName]) {
      return undefined;
    }
    return this.evaluateQualityGate(api, event, ctx.cwd, session, targetPath);
  }

  private resolveSupportedPath(event: ToolResultEvent): string {
    if (event.isError) {
      return "";
    }
    const candidate = event.input.path || event.input.filePath || "";
    const dotIndex = candidate.lastIndexOf(".");
    if (dotIndex <= 0) {
      return "";
    }
    const extension = candidate.slice(dotIndex + 1).toLowerCase();
    if (!SUPPORTED_EXTENSIONS[extension]) {
      return "";
    }
    return candidate;
  }

  private async evaluateQualityGate(
    api: HookApi,
    event: ToolResultEvent,
    cwd: string,
    session: string,
    targetPath: string,
  ): Promise<ToolResultPatch | undefined> {
    if (this.breaker.isOpen(session, cwd, targetPath)) {
      const openText = this.breaker.formatOpenMessage(cwd, targetPath);
      return {
        content: [...event.content, { type: "text", text: openText }],
      };
    }
    const result = await api.exec("check-code-quality", [targetPath], { cwd });
    if (result.code === 0) {
      this.breaker.reset(session, cwd, targetPath);
      return undefined;
    }
    const openedNow = this.breaker.recordFailure(session, cwd, targetPath);
    const details = this.formatFailureDetails(
      result.stderr || result.stdout,
      openedNow,
      cwd,
      targetPath,
    );
    return {
      content: [...event.content, { type: "text", text: details }],
    };
  }

  private formatFailureDetails(
    diagnostic: string,
    openedNow: boolean,
    cwd: string,
    targetPath: string,
  ): string {
    if (!openedNow) {
      return `Code quality check failed:\n${diagnostic}`;
    }
    const openNotice = this.breaker.formatOpenMessage(cwd, targetPath);
    return `Code quality check failed:\n${diagnostic}\n${openNotice}`;
  }
}
