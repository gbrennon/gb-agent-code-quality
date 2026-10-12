import type { HookApi, HookEventContext, ToolResultEvent } from "./contracts";
import { QualityHookService } from "./quality_hook_service";

/**
 * Register the native TypeScript code-quality hook on the Pi HookApi.
 *
 * Binds tool_result quality gating with circuit-breaker recovery to the Pi
 * extension runtime without shell-script JSON wrappers.
 */
export class QualityHooksExtension {
  private readonly qualityService: QualityHookService;

  public constructor(qualityService?: QualityHookService) {
    this.qualityService = qualityService ?? new QualityHookService();
  }

  /**
   * Register the quality tool_result listener on the provided API instance.
   */
  public register(api: HookApi): void {
    api.on("tool_result", (event: ToolResultEvent, ctx: HookEventContext) => {
      return this.qualityService.handleToolResult(api, event, ctx);
    });
  }
}
