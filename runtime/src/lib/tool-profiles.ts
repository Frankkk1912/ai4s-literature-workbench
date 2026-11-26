// Pure types for tools hidden by the active profile. The selection logic lives
// in server.ts (WORKBENCH_TOOL_NAMES, LOCAL_ONLY_TOOLS, selectActiveTools);
// this module exists so registry.ts can reference the type without a cycle.

export type HiddenToolReason =
  /** Not in the `workbench` tool profile. */
  | 'workbench_profile'
  /** Removed because ZOTEUS_READ_ONLY=true filters write tools. */
  | 'read_only'
  /** A remote (OAuth) deployment has no local machine to act on. */
  | 'remote_deployment';

export interface HiddenToolInfo {
  name: string;
  reason: HiddenToolReason;
}
