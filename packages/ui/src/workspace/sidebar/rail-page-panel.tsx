'use client';

import type { Artifact, ProjectGoal } from '@kortix/sdk';
import { useArtifactMutations, useArtifacts, useProjectApps, useProjectGoals } from '@kortix/sdk/react';
import { ArrowUpRightIcon, BrowserIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';

import { appStatus, gridApps } from '../../apps/app-shared';
import { useTranslations } from '../../i18n';
import { HoverPrefetchLink } from '../../internal/components/hover-prefetch-link';
import { goalHref, goalIconState, GoalStatusIcon } from '../../internal/goals/goal-meta';
import { PROJECT_ACTIONS } from '../../internal/lib/project-actions';
import { useProjectCan } from '../../internal/lib/use-project-can';
import { uiRoutes } from '../../lib/routes';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives/button';
import { FadedScrollArea } from '../../primitives/faded-scroll-area';
import Hint from '../../primitives/hint';
import { InputGroupSearch, InputGroupSearchIcon, InputGroupSearchInput } from '../../primitives/input-group';
import Loading from '../../primitives/loading';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../../primitives/sidebar';
import { Skeleton } from '../../primitives/skeleton';
import { errorToast } from '../../primitives/toast';
import { UiLink as Link, useUiPathname, useUiRouter, useUiSearchParams } from '../../providers/ui-provider';
import { desktopTabsMounted } from './footer/project-artifacts-nav';

/** The rail pages whose items the panel lists, as it lists the sessions and the spaces (`sidebar_rail`). */
export const RAIL_PANEL_PAGES = ['apps', 'artifacts', 'goals'] as const;
export type RailPanelPage = (typeof RAIL_PANEL_PAGES)[number];

export function isRailPanelPage(value: string): value is RailPanelPage {
  return (RAIL_PANEL_PAGES as readonly string[]).includes(value);
}

/** The page's own URL, or null where the host does not offer it. */
export function railPanelHref(projectId: string, page: RailPanelPage): string | null {
  return page === 'apps' ? uiRoutes().apps(projectId) : page === 'artifacts' ? uiRoutes().artifacts(projectId) : uiRoutes().goals(projectId);
}

/** The rail page the route is on: the panel shows its items there. */
export function railPanelPageOf(projectId: string, pathname: string | null | undefined): RailPanelPage | null {
  if (!pathname) return null;
  for (const page of RAIL_PANEL_PAGES) {
    const href = railPanelHref(projectId, page);
    if (href && (pathname === href || pathname.startsWith(`${href}/`))) return page;
  }
  return null;
}

/** Above this many items the list gets a search field. */
const SEARCH_THRESHOLD = 10;
const SKELETON_WIDTHS = ['w-36', 'w-28', 'w-40', 'w-24'];

/**
 * The panel's list for Apps, Artifacts or Goals: one sidebar row per item, the
 * open one marked, so these pages read like the sessions and the spaces
 * beside them. A long list gets a search field. Rows prefetch on hover only.
 */
export function RailPagePanel({ projectId, page }: { projectId: string; page: RailPanelPage }) {
  const t = useTranslations('sidebar');
  const [query, setQuery] = useState('');
  const [searchable, setSearchable] = useState(false);
  const [onCount] = useState(() => (count: number) => setSearchable(count > SEARCH_THRESHOLD));
  const needle = query.trim().toLowerCase();
  const placeholder = page === 'apps' ? t('searchApps') : page === 'artifacts' ? t('searchArtifacts') : t('iconRail.searchGoals');
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {searchable ? (
        <div className="px-2">
          <InputGroupSearch>
            <InputGroupSearchIcon>
              <MagnifyingGlassIcon />
            </InputGroupSearchIcon>
            <InputGroupSearchInput size="xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
          </InputGroupSearch>
        </div>
      ) : null}
      <FadedScrollArea fadeColor="from-sidebar" rootClassName="min-h-0 flex-1" className="h-full min-h-0">
        <SidebarMenu className="gap-px">
          {page === 'apps' ? (
            <AppsList projectId={projectId} needle={needle} onCount={onCount} />
          ) : page === 'artifacts' ? (
            <ArtifactsList projectId={projectId} needle={needle} onCount={onCount} />
          ) : (
            <GoalsList projectId={projectId} needle={needle} onCount={onCount} />
          )}
        </SidebarMenu>
      </FadedScrollArea>
    </div>
  );
}

/**
 * The panel title row's actions for a page: the page itself (↗), then create
 * one (+, a ghost button like the page link). Apps opens New app, Artifacts creates a doc and
 * opens it, Goals opens New goal on the Goals page. Each create shows only to
 * a caller who may create there.
 */
export function RailPageActions({ projectId, page, label }: { projectId: string; page: RailPanelPage; label: string }) {
  const tApps = useTranslations('appsList');
  const tArtifacts = useTranslations('artifacts');
  const tGoals = useTranslations('goals');
  const router = useUiRouter();
  const canStart = useProjectCan(projectId, PROJECT_ACTIONS.PROJECT_SESSION_START).allowed === true;
  const { create } = useArtifactMutations(projectId);
  const href = railPanelHref(projectId, page);
  if (!href) return null;

  const newDoc = async () => {
    try {
      const artifact = await create.mutateAsync({ folder_id: null, files: { 'index.md': { content: `# ${tArtifacts('untitledDoc')}\n\n` } } });
      router.push(`${href}/${encodeURIComponent(artifact.artifact_id)}`);
    } catch {
      errorToast(tArtifacts('docCreateFailed'));
    }
  };
  const createLabel = page === 'apps' ? tApps('create') : page === 'artifacts' ? tArtifacts('newDoc') : tGoals('newGoal');
  const createHref = page === 'apps' ? (canStart ? `${uiRoutes().project(projectId)}/apps/new` : null) : page === 'goals' ? `${href}?new=1` : null;

  return (
    // `-mr-1.75` cancels the `icon-base` button's inset: the last glyph ends on the row's edge.
    <div className="-mr-1.75 flex shrink-0 items-center gap-1">
      <Hint label={label} side="bottom">
        <Button asChild variant="ghost" size="icon-base" className="text-muted-foreground hover:text-foreground">
          <Link href={href} prefetch aria-label={label}>
            <ArrowUpRightIcon className="cn-rtl-flip size-4" />
          </Link>
        </Button>
      </Hint>
      {page === 'artifacts' ? (
        <Hint label={createLabel} side="bottom">
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground" size="icon-base" aria-label={createLabel} disabled={create.isPending} aria-busy={create.isPending || undefined} onClick={() => void newDoc()}>
            {create.isPending ? <Loading className="size-4 shrink-0" /> : <PlusIcon className="size-4" />}
          </Button>
        </Hint>
      ) : createHref ? (
        <Hint label={createLabel} side="bottom">
          <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground" size="icon-base">
            <Link href={createHref} prefetch={false} aria-label={createLabel}>
              <PlusIcon className="size-4" />
            </Link>
          </Button>
        </Hint>
      ) : null}
    </div>
  );
}

function Row({
  href,
  active,
  icon,
  noPanel = false,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  /** Desktop with tabs: the link goes to its own tab, not into the open session's side panel (`ArtifactRow`'s rule). */
  noPanel?: boolean;
  children: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} className="text-sidebar-foreground">
        <HoverPrefetchLink href={href} prefetch data-no-panel={noPanel ? '' : undefined}>
          <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{children}</span>
        </HoverPrefetchLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function LoadingRows() {
  return (
    <>
      {SKELETON_WIDTHS.map((width) => (
        <SidebarMenuItem key={width} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-4 shrink-0 rounded-sm py-0 motion-reduce:animate-none" />
          <Skeleton className={cn('h-3 py-0 motion-reduce:animate-none', width)} />
        </SidebarMenuItem>
      ))}
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <li className="text-muted-foreground px-2 py-1.5 text-sm">{children}</li>;
}

type ListProps = { projectId: string; needle: string; onCount: (count: number) => void };

/** One artifact row: its type glyph and title, to its own page. */
function ArtifactItem({ artifact, artifactsHref, pathname }: { artifact: Artifact; artifactsHref: string; pathname: string | null }) {
  const to = `${artifactsHref}/${encodeURIComponent(artifact.artifact_id)}`;
  const Glyph = artifact.type === 'html' ? BrowserIcon : FileTextIcon;
  return (
    <Row href={to} active={pathname === to} noPanel={desktopTabsMounted()} icon={<Glyph className="text-muted-foreground size-4" />}>
      {artifact.title}
    </Row>
  );
}

/**
 * What the Apps page shows: the Apps (`gridApps`), then the slides, sheets and
 * docs the page lists beside them (the project's artifacts, newest first).
 */
function AppsList({ projectId, needle, onCount }: ListProps) {
  const t = useTranslations('sidebar.iconRail');
  const tI18nComplete = useTranslations('hardcodedUi.i18nComplete');
  const pathname = useUiPathname();
  const apps = useProjectApps(projectId);
  const artifacts = useArtifacts(projectId, { scope: 'all' });
  const canAdmin = useProjectCan(projectId, PROJECT_ACTIONS.PROJECT_APP_ADMIN).allowed === true;
  const open = useUiSearchParams()?.get('app');
  const href = uiRoutes().apps(projectId);
  const artifactsHref = uiRoutes().artifacts(projectId);
  const listed = apps.data ? gridApps(apps.data, canAdmin) : [];
  const docs = artifacts.data ?? [];
  const total = listed.length + docs.length;
  useCount(total, onCount);
  if (!href) return null;
  if (!apps.data) return <LoadingRows />;
  const shownApps = needle ? listed.filter((app) => app.name.toLowerCase().includes(needle) || app.slug.includes(needle)) : listed;
  const shownDocs = needle ? docs.filter((artifact) => artifact.title.toLowerCase().includes(needle)) : docs;
  if (shownApps.length + shownDocs.length === 0) return <Empty>{needle ? t('noMatches') : t('appsEmpty')}</Empty>;
  return (
    <>
      {shownApps.map((app) => {
        const status = appStatus(app, tI18nComplete);
        return (
          <Row
            key={app.app_id}
            href={`${href}?app=${encodeURIComponent(app.app_id)}`}
            active={open === app.app_id}
            icon={<span aria-hidden className={cn('size-1.5 rounded-full', status.dot)} />}
          >
            {app.name}
          </Row>
        );
      })}
      {artifactsHref
        ? shownDocs.map((artifact) => <ArtifactItem key={artifact.artifact_id} artifact={artifact} artifactsHref={artifactsHref} pathname={pathname} />)
        : null}
    </>
  );
}

function ArtifactsList({ projectId, needle, onCount }: ListProps) {
  const t = useTranslations('sidebar.iconRail');
  const pathname = useUiPathname();
  const artifacts = useArtifacts(projectId, { scope: 'all' });
  const href = uiRoutes().artifacts(projectId);
  useCount(artifacts.data?.length ?? 0, onCount);
  if (!href) return null;
  if (!artifacts.data) return <LoadingRows />;
  const shown = needle ? artifacts.data.filter((artifact) => artifact.title.toLowerCase().includes(needle)) : artifacts.data;
  if (shown.length === 0) return <Empty>{needle ? t('noMatches') : t('artifactsEmpty')}</Empty>;
  return (
    <>
      {shown.map((artifact) => (
        <ArtifactItem key={artifact.artifact_id} artifact={artifact} artifactsHref={href} pathname={pathname} />
      ))}
    </>
  );
}

function GoalsList({ projectId, needle, onCount }: ListProps) {
  const t = useTranslations('sidebar.iconRail');
  const pathname = useUiPathname();
  const goals = useProjectGoals(projectId);
  useCount(goals.data?.length ?? 0, onCount);
  if (!goals.data) return <LoadingRows />;
  const shown = needle ? goals.data.filter((goal) => goal.record.title.toLowerCase().includes(needle)) : goals.data;
  if (shown.length === 0) return <Empty>{needle ? t('noMatches') : t('goalsEmpty')}</Empty>;
  return (
    <>
      {shown.map((goal: ProjectGoal) => {
        const to = goalHref(projectId, goal);
        if (!to) return null;
        return (
          <Row key={goal.goalId} href={to} active={!!pathname && (pathname === to || pathname.startsWith(`${to}/`))} icon={<GoalStatusIcon state={goalIconState(goal)} />}>
            {goal.record.title}
          </Row>
        );
      })}
    </>
  );
}

/** Reports the list's full size to the panel, which shows the search field past `SEARCH_THRESHOLD`. */
function useCount(count: number, onCount: (count: number) => void) {
  useEffect(() => onCount(count), [count, onCount]);
}
