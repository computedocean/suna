'use client';

import { getProject } from '@kortix/sdk';
import { contract, qk, useCaptureWorkspace, useFeatureFlag } from '@kortix/sdk/react';
import {
  CoinsIcon,
  CreditCardIcon,
  FingerprintIcon,
  KeyIcon,
  LockKeyIcon as SecurityIcon,
  MonitorPlayIcon,
  NetworkIcon,
  PaintBrushIcon,
  QuestionIcon,
  ScrollIcon,
  ShieldIcon,
  UsersIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
  ACCOUNT_TAB_FOR_SECTION,
  isProjectAdminResource,
  isWorkspaceAccountSection,
  PROJECT_ADMIN_RESOURCES,
  projectAdminHref,
  sectionLabelKey,
  WORKSPACE_SETTINGS_GROUPS,
  type ProjectAdminSectionKey,
  type ProjectAdminSettingsKey,
  type WorkspaceAccountSectionKey,
  type WorkspaceSettingsGroupId,
} from '../../customize/project-settings/project-admin-sections';
import { projectSettingsSections } from '../../customize/project-settings/project-settings-sections';
import { useTranslations as useI18nTranslations } from '../../i18n';
import type { AccountSection } from '../../internal/account-hub/sections';
import { useAccountHubAccess } from '../../internal/account-hub/use-account-hub-access';
import { captureHref } from '../../internal/capture/use-capture-area';
import { useAccountsList } from '../../internal/hooks/account/use-accounts-list';
import { isProjectAdminPath } from '../../internal/layout/project-capability-nav';
import { adminResourceRowOpen, capabilityAccess } from '../../internal/layout/project-settings-nav';
import { CUSTOMIZE_SECTION_GATE_ACTIONS, isCustomizeSectionVisible, PROJECT_ACTIONS } from '../../internal/lib/project-actions';
import { useProjectCans, useProjectPageCans, type CanResult } from '../../internal/lib/use-project-can';
import { useWorkspaceSettingsRailStore, type WorkspaceSettingsRail } from '../../internal/stores/workspace-settings-rail-store';
import { useUiPathname } from '../../providers/ui-provider';

/**
 * The Workspace settings rail (which sections the caller may open, in their
 * groups), computed once for the settings page (`ProjectAdminDashboard`) and
 * for the project sidebar (`WorkspaceSettingsRailPublisher`). One rule set,
 * so the sidebar's Customize list and the page never disagree.
 */

/** Which host pages exist (`apps/web` provides both): a row for a missing page is not listed. */
export interface WorkspaceSettingsRailHost {
  /** The account hub's panes. */
  account: boolean;
  /** The Apps page. */
  apps: boolean;
}

/** Rail glyphs for the account rows, the account hub's own (`sections.ts`). */
const ACCOUNT_SECTION_ICONS: Record<WorkspaceAccountSectionKey, Icon> = {
  security: SecurityIcon,
  branding: PaintBrushIcon,
  'api-keys': KeyIcon,
  members: UsersIcon,
  groups: NetworkIcon,
  roles: ShieldIcon,
  identity: FingerprintIcon,
  audit: ScrollIcon,
  help: QuestionIcon,
  plan: CreditCardIcon,
  usage: CoinsIcon,
};

/** The rail group drawn in the rail's footer instead of the scrolling list. */
export const RAIL_FOOTER_GROUP: WorkspaceSettingsGroupId = 'support';

export interface RailRow {
  key: ProjectAdminSectionKey;
  /** Where the row goes when it is not a section of this page. */
  href?: string;
  label: string;
  icon: Icon;
  /** The project pane of this section is open to the caller. */
  project: boolean;
  /** The account pane of this section is open to the caller. */
  account: boolean;
}

export interface RailGroupRows {
  id: WorkspaceSettingsGroupId;
  rows: RailRow[];
}

function answered(caps: Record<string, CanResult>, actions: readonly string[]): boolean {
  return actions.every((action) => caps[action] && !caps[action].isLoading);
}

/**
 * The rail's groups and rows for the caller, and whether every answer they
 * depend on is in (`settled`). Reads only queries the sidebar and the page
 * already share, so a second caller costs no request.
 */
export function useWorkspaceSettingsRailGroups(projectId: string, host: WorkspaceSettingsRailHost) {
  const tI18nComplete = useI18nTranslations('hardcodedUi.i18nComplete');
  const tSettings = useI18nTranslations('workspaces.settings');
  // The project row (`GET /projects/:id`, one database read) for the account
  // id. Not the detail: it reads the repository, and every Customize tab
  // waited on it for this one field (2026-11-04).
  const project = useQuery({
    queryKey: qk.project.summary(projectId),
    queryFn: () => getProject(projectId),
    enabled: !!projectId,
    ...contract('config'),
  });
  const accountId = project.data?.account_id;

  // One batch for the page gate, the resource rows and Members: the same
  // `PROJECT_PAGE_ACTIONS` batch the sidebar has usually cached already.
  const pageCans = useProjectPageCans(projectId);
  const settingsCans = useProjectCans(projectId, CUSTOMIZE_SECTION_GATE_ACTIONS, { accountId });
  const canAdmin = pageCans[PROJECT_ACTIONS.PROJECT_SETTINGS_WRITE];
  const projectRowsOpen = canAdmin?.allowed === true;
  const drives = useFeatureFlag(projectId, 'drives');
  const evals = useFeatureFlag(projectId, 'evals');

  // The account rows: the account hub's own rule, for a member of the
  // workspace's account. A project shared into an account the caller does not
  // belong to has no account panes for them.
  const accountsQuery = useAccountsList();
  const isAccountMember =
    !!accountId && (accountsQuery.data ?? []).some((account) => account.account_id === accountId);
  const hub = useAccountHubAccess(isAccountMember ? accountId : undefined);
  const accountPane = host.account;
  // Kortix Capture is per workspace (its tenant is the account). The row
  // follows the rule the switcher's Capture link follows: Capture is on for
  // this workspace, for a member of its account.
  const capture = useCaptureWorkspace(isAccountMember ? (accountId ?? null) : null);
  const captureOn = isAccountMember && capture.data?.enabled === true;

  // The Customize rule for each library, without its flag clauses: a flag-off
  // Loops page explains its own gate (`FeatureGateScreen`) instead of
  // disappearing from the rail. Repo applies `drives` itself, below.
  const resources = capabilityAccess(pageCans, { drives: true, reminders: true });
  const settingsAnswered = answered(settingsCans, CUSTOMIZE_SECTION_GATE_ACTIONS);
  const settingsProbeFailed = CUSTOMIZE_SECTION_GATE_ACTIONS.some((action) => settingsCans[action]?.isError);
  const settled =
    !!canAdmin &&
    !canAdmin.isLoading &&
    resources.settled &&
    settingsAnswered &&
    !drives.isLoading &&
    !evals.isLoading &&
    // Members needs the account id: wait for the project so it never pops in.
    project.isFetched &&
    accountsQuery.isFetched &&
    (!isAccountMember || !accountPane || hub.settled);

  // `resources.tabs` is a fresh array each render; its contents are the key.
  const allowedTabs = resources.tabs.join(',');
  const drivesOn = drives.enabled;
  const evalsOn = evals.enabled;
  const visibleSections = hub.sectionVisible;
  const groups = useMemo<RailGroupRows[]>(() => {
    const allowed = new Set(allowedTabs.split(','));
    const hubOpen = (tab: AccountSection) => !!accountPane && isAccountMember && visibleSections[tab] === true;
    const settingsByKey = new Map(
      projectSettingsSections(tI18nComplete)
        .filter((s): s is typeof s & { key: ProjectAdminSettingsKey } => s.key !== 'review')
        .map((s) => [s.key, s] as const),
    );
    const label = (key: ProjectAdminSectionKey) => tSettings(`sections.${sectionLabelKey(key)}`);
    const rowFor = (key: ProjectAdminSectionKey): RailRow | null => {
      // Capture is a link out to the workspace's Kortix Capture area.
      if (key === 'capture') {
        if (!captureOn || !accountId) return null;
        return {
          key,
          href: captureHref(accountId, 'devices'),
          label: label(key),
          icon: MonitorPlayIcon,
          project: false,
          account: false,
        };
      }
      if (isProjectAdminResource(key)) {
        const resource = PROJECT_ADMIN_RESOURCES.find((r) => r.key === key);
        if (!resource || !adminResourceRowOpen(resource, projectRowsOpen, allowed)) return null;
        if (resource.host && !host.apps) return null;
        if (resource.flag === 'drives' && !drivesOn) return null;
        if (resource.flag === 'evals' && !evalsOn) return null;
        return {
          key,
          label: label(key),
          icon: resource.icon,
          project: true,
          account: false,
        };
      }
      if (isWorkspaceAccountSection(key)) {
        const tab = ACCOUNT_TAB_FOR_SECTION[key];
        if (!tab || !hubOpen(tab)) return null;
        return {
          key,
          label: label(key),
          icon: ACCOUNT_SECTION_ICONS[key],
          project: false,
          account: true,
        };
      }
      const setting = settingsByKey.get(key as ProjectAdminSettingsKey);
      if (!setting) return null;
      // The Settings page's rule: a failed probe hides nothing. The pane
      // itself reports a 403 if the server refuses it.
      const projectOpen =
        projectRowsOpen &&
        (settingsProbeFailed ||
          isCustomizeSectionVisible(setting.gate, (action) => settingsCans[action]?.allowed === true));
      const tab = ACCOUNT_TAB_FOR_SECTION[key];
      const account = !!tab && hubOpen(tab);
      if (!projectOpen && !account) return null;
      return { key, label: label(key), icon: setting.icon, project: projectOpen, account };
    };
    return WORKSPACE_SETTINGS_GROUPS.map((group) => ({
      id: group.id,
      rows: group.sections.map(rowFor).filter((row): row is RailRow => row !== null),
    })).filter((group) => group.rows.length > 0);
  }, [
    allowedTabs,
    accountPane,
    isAccountMember,
    visibleSections,
    projectRowsOpen,
    host.apps,
    drivesOn,
    evalsOn,
    settingsCans,
    settingsProbeFailed,
    tI18nComplete,
    tSettings,
    captureOn,
    accountId,
  ]);

  return { groups, settled, accessCheckFailed: canAdmin?.isError === true, accountId, isAccountMember };
}

/** The published form of the rail: hrefs filled in, the Support group as the footer. */
export function railFromGroups(
  projectId: string,
  groups: readonly RailGroupRows[],
  groupLabel: (id: WorkspaceSettingsGroupId) => string,
  active: ProjectAdminSectionKey | undefined,
): WorkspaceSettingsRail {
  const toRail = (group: RailGroupRows, label?: string) => ({
    id: group.id,
    label,
    rows: group.rows.map((row) => ({
      key: row.key,
      href: row.href ?? projectAdminHref(projectId, row.key),
      label: row.label,
      icon: row.icon,
      linkOut: !!row.href,
    })),
  });
  const footer = groups.find((group) => group.id === RAIL_FOOTER_GROUP);
  return {
    projectId,
    groups: groups.filter((group) => group.id !== RAIL_FOOTER_GROUP).map((group) => toRail(group, groupLabel(group.id))),
    footer: footer ? toRail(footer) : null,
    active,
  };
}

/**
 * Publishes the rail from outside the settings page, so the sidebar's
 * Customize list (the icon rail's hover, its drill) draws real rows on every
 * page, not a skeleton that only the settings page could end. It publishes
 * again whenever an answer changes (a retried probe, a late Capture row). On
 * Workspace settings it stands aside: the page publishes the same rows and
 * also knows the active section. Renders nothing.
 */
export function WorkspaceSettingsRailPublisher({ projectId, host }: { projectId: string; host: WorkspaceSettingsRailHost }) {
  const tSettings = useI18nTranslations('workspaces.settings');
  const { groups, settled, accessCheckFailed } = useWorkspaceSettingsRailGroups(projectId, host);
  const onSettingsPage = isProjectAdminPath(useUiPathname());
  const setRail = useWorkspaceSettingsRailStore((s) => s.setRail);
  useEffect(() => {
    if (onSettingsPage) return;
    if (accessCheckFailed) {
      setRail({ projectId, groups: [], footer: null, active: undefined });
      return;
    }
    if (!settled) return;
    setRail(railFromGroups(projectId, groups, (id) => tSettings(`groups.${id}`), undefined));
  }, [onSettingsPage, accessCheckFailed, settled, groups, projectId, setRail, tSettings]);
  return null;
}
