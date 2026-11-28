'use client';

import Link from '@/components/site-link';
import { useTranslations } from '@/i18n/use-translations';
import type { App, Artifact, ArtifactKind } from '@kortix/sdk';
import { prefetchArtifact } from '@kortix/sdk/react';
import { cn } from '@kortix/ui';
import { PREVIEW_TILE_ASPECT } from '@kortix/ui/apps';
import { ArtifactFrame, artifactFrameKey } from '@kortix/ui/artifacts';
import { Tabs, TabsList, TabsTrigger } from '@kortix/ui/tabs';
import { useQueryClient } from '@tanstack/react-query';

import { artifactHref } from '@/features/artifacts/artifact-meta';

/**
 * The Apps page shows everything agents make: deployed Apps and the
 * artifacts they publish (slides, sheets, docs, PDFs, other pages), one
 * gallery with a tab per kind.
 */
export type { ArtifactKind };
export const LIBRARY_TABS = ['all', 'app', 'slides', 'sheet', 'doc', 'pdf', 'page'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export type LibraryItem = { type: 'app'; app: App } | { type: 'artifact'; artifact: Artifact; kind: ArtifactKind };

/** The picked tab takes the default button's fill; the rest stay transparent. Shared by `/apps` and `/apps/new`. */
export const LIBRARY_TAB_ACTIVE = 'data-[state=active]:bg-action data-[state=active]:text-action-foreground';

const ARTIFACT_KINDS: readonly ArtifactKind[] = ['slides', 'sheet', 'doc', 'pdf', 'page'];

/**
 * The artifact's kind. A current server sends `kind` (set on publish, else
 * derived); an older one omits it, so the same derivation runs here: a doc is
 * a Doc, a `.pdf` entry is a PDF, any other page is a Page.
 */
export function artifactKind(artifact: Artifact): ArtifactKind {
  if (artifact.kind && ARTIFACT_KINDS.includes(artifact.kind)) return artifact.kind;
  if (artifact.type === 'doc') return 'doc';
  return artifact.entry.toLowerCase().endsWith('.pdf') ? 'pdf' : 'page';
}

export function itemName(item: LibraryItem): string {
  return item.type === 'app' ? item.app.name : item.artifact.title;
}

export function itemKey(item: LibraryItem): string {
  return item.type === 'app' ? `app:${item.app.app_id}` : `artifact:${item.artifact.artifact_id}`;
}

export function itemTimes(item: LibraryItem): { created: string; updated: string } {
  const source = item.type === 'app' ? item.app : item.artifact;
  return { created: source.created_at, updated: source.updated_at };
}

/** The tab row: All, then only the kinds the project has. Nothing until the lists load. */
export function LibraryTabs({
  value,
  onValueChange,
  counts,
}: {
  value: LibraryTab;
  onValueChange: (next: LibraryTab) => void;
  counts: Record<LibraryTab, number> | null;
}) {
  const t = useTranslations('appsList');
  if (!counts) return null;
  const tabs = LIBRARY_TABS.filter((tab) => tab === 'all' || counts[tab] > 0);
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as LibraryTab)}>
      {/* Many kinds outgrow a phone: the row scrolls sideways. */}
      <div className="-m-1 [scrollbar-width:none] overflow-x-auto p-1">
        <TabsList variant="secondary" size="xs" aria-label={t('tabsLabel')} className="w-max">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              data-testid={`apps-tab-${tab}`}
              size="xs"
              className={LIBRARY_TAB_ACTIVE}
            >
              {t(`tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}

/**
 * An artifact in the gallery: the same 16:9 bordered thumbnail and one-line
 * caption as an App's card, so the All tab reads as one grid. The page itself
 * is the preview (scaled to a quarter, inert). The tile opens the artifact.
 */
export function ArtifactTile({ projectId, artifact, kind }: { projectId: string; artifact: Artifact; kind: ArtifactKind }) {
  const t = useTranslations('appsList');
  const queryClient = useQueryClient();
  const warm = () => void prefetchArtifact(queryClient, projectId, artifact.artifact_id).catch(() => {});
  return (
    <li>
      <Link
        href={artifactHref(projectId, artifact.artifact_id)}
        onPointerEnter={warm}
        onFocus={warm}
        className="group block w-full text-left focus-visible:outline-none"
        data-testid="library-artifact"
        data-kind={kind}
      >
        <div
          className={cn(
            PREVIEW_TILE_ASPECT,
            'bg-popover duration-normal group-focus-visible:ring-ring/50 relative overflow-hidden rounded-lg border transition-transform ease-out group-hover:-translate-y-1 group-focus-visible:ring-2',
          )}
        >
          {artifact.view_url ? (
            <ArtifactFrame
              frameKey={artifactFrameKey(artifact)}
              preview
              src={artifact.view_url}
              title={artifact.title}
              className="pointer-events-none absolute top-0 left-0 h-[400%] w-[400%] origin-top-left scale-25 border-0"
            />
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <h3 className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">{artifact.title}</h3>
          <span className="text-muted-foreground shrink-0 text-xs">{t(`kind.${kind}`)}</span>
        </div>
      </Link>
    </li>
  );
}
