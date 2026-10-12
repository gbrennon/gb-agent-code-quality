import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import defaultHook, {
  CircuitBreakerStore,
  type HookApi,
  type HookEventContext,
  type HookExecOptions,
  type HookExecutionResult,
  QualityHookService,
  QualityHooksExtension,
  type ToolResultEvent,
  type ToolResultPatch,
} from "../src/index";

interface RecordedExecCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

class FakeHookApi implements HookApi {
  public readonly calls: RecordedExecCall[] = [];
  public readonly registeredEvents: string[] = [];
  public toolHandler: (
    event: ToolResultEvent,
    ctx: HookEventContext,
  ) => Promise<ToolResultPatch | undefined> = async () => undefined;
  private readonly nextResult: HookExecutionResult;

  public constructor(
    nextResult: HookExecutionResult = { code: 0, stdout: "", stderr: "" },
  ) {
    this.nextResult = nextResult;
  }

  public on(event: string, handler: unknown): void {
    this.registeredEvents.push(event);
    if (event === "tool_result") {
      this.toolHandler = handler as typeof this.toolHandler;
    }
  }

  public async exec(
    command: string,
    args: readonly string[],
    options: HookExecOptions,
  ): Promise<HookExecutionResult> {
    this.calls.push({ command, args, cwd: options.cwd });
    return this.nextResult;
  }
}

test("default export registers the quality tool_result hook", () => {
  const api = new FakeHookApi();

  defaultHook(api);

  expect(typeof defaultHook).toBe("function");
  expect(api.registeredEvents).toContain("tool_result");
});

test("quality hook passes cleanly when check-code-quality returns zero", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-hooks-test-"));
  const breaker = new CircuitBreakerStore(tempDir, 3);
  const extension = new QualityHooksExtension(new QualityHookService(breaker));
  const api = new FakeHookApi({ code: 0, stdout: "ok", stderr: "" });
  extension.register(api);
  const event: ToolResultEvent = {
    toolName: "write",
    input: { path: "src/app.ts" },
    content: [{ type: "text", text: "wrote file" }],
  };

  const patch = await api.toolHandler(event, { cwd: "/work/repo" });

  expect(patch).toBeUndefined();
  expect(api.calls).toEqual([
    { command: "check-code-quality", args: ["src/app.ts"], cwd: "/work/repo" },
  ]);
});

test("quality hook opens circuit breaker on threshold failure and resets on read", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-hooks-breaker-"));
  const breaker = new CircuitBreakerStore(tempDir, 2);
  const service = new QualityHookService(breaker);
  const failingApi = new FakeHookApi({ code: 1, stdout: "", stderr: "CCN > 5" });
  const ctx: HookEventContext = { cwd: "/work/repo", sessionId: "s1" };
  const writeEvent: ToolResultEvent = {
    toolName: "edit",
    input: { path: "src/app.py" },
    content: [],
  };
  const readEvent: ToolResultEvent = {
    toolName: "read",
    input: { path: "src/app.py" },
    content: [],
  };

  const first = await service.handleToolResult(failingApi, writeEvent, ctx);
  const second = await service.handleToolResult(failingApi, writeEvent, ctx);
  const blocked = await service.handleToolResult(failingApi, writeEvent, ctx);
  await service.handleToolResult(failingApi, readEvent, ctx);

  expect(JSON.stringify(first)).toContain("Code quality check failed:");
  expect(JSON.stringify(second)).toContain("circuit_breaker_open");
  expect(JSON.stringify(blocked)).toContain("read_file_again_or_request_help");
  expect(breaker.isOpen("s1", "/work/repo", "src/app.py")).toBe(false);
});
