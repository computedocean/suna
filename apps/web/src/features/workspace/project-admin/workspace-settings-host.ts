import type { WorkspaceSettingsRailHost } from '@kortix/ui/workspace/admin/workspace-settings-rail';

/**
 * Which host pages Workspace settings lists (`HOST_SECTIONS` in
 * project-admin-route.tsx: the account panes, no Apps page). The project
 * sidebar computes its Customize list from it, so the list it shows on any
 * page has the rows the settings page has. A separate module, so the shell
 * does not load the settings panes to read two booleans.
 */
export const WORKSPACE_SETTINGS_RAIL_HOST: WorkspaceSettingsRailHost = { account: true, apps: false };
