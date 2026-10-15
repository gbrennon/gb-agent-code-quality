# GB Agent Code Quality

Native TypeScript code-quality hook for the Pi coding agent.

## Overview

- Handles `tool_result` events directly in TypeScript (no inline-Python shell scripts).
- Tracks per-session, per-file consecutive quality failures with a native circuit breaker.
- Runs `check-code-quality` on `write` and `edit` operations for supported file extensions.

## Architecture

- `src/contracts.ts` defines the `HookApi` and event payload contracts.
- `src/circuit_breaker_store.ts` persists per-file failure counts and opens after 3 failures.
- `src/quality_hook_service.ts` gates `write` and `edit` tool executions with `check-code-quality`.
- `src/quality_hooks_extension.ts` registers the quality listener on the Pi extension API.

## Verification

```bash
bun test
```
