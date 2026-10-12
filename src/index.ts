import { CircuitBreakerStore } from "./circuit_breaker_store";
import { QualityHookService } from "./quality_hook_service";
import { QualityHooksExtension } from "./quality_hooks_extension";

export type {
  HookApi,
  HookContentBlock,
  HookEventContext,
  HookExecOptions,
  HookExecutionResult,
  ToolInputPayload,
  ToolResultEvent,
  ToolResultPatch,
} from "./contracts";

export { CircuitBreakerStore, QualityHookService, QualityHooksExtension };

const defaultExtension = new QualityHooksExtension();

export default defaultExtension.register.bind(defaultExtension);
