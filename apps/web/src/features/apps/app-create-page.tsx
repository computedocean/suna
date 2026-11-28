'use client';

import Link from '@/components/site-link';
import { useTranslations } from '@/i18n/use-translations';
import { uiRoutes } from '@kortix/ui';
import { EmptyArt } from '@kortix/ui/empty-art';
import { EmptyState } from '@kortix/ui/empty-state';
import { PROJECT_ACTIONS, ProjectPageHeader, useProjectCan } from '@kortix/ui/workspace';
import { CaretRightIcon, SquaresFourIcon } from '@phosphor-icons/react';

import { useSearchParams } from 'next/navigation';

import { AppCreate } from './app-create';
import { APP_CREATE_KINDS, type AppCreateKind } from './app-templates';

/**
 * `/workspaces/<id>/apps/new`: the composer and the templates on a page of
 * their own, under "Apps › New app". A send opens the new session; the App it
 * deploys shows up on `/apps`.
 */
export function AppCreatePage({ projectId }: { projectId: string }) {
  const t = useTranslations('appCreate');
  const tI18nComplete = useTranslations('hardcodedUi.i18nComplete');
  const can = useProjectCan(projectId, PROJECT_ACTIONS.PROJECT_SESSION_START);
  const appsHref = `${uiRoutes().project(projectId)}/apps`;
  // `?kind=` from an empty tab on `/apps`: a PDF starts as a doc, any other page as an App.
  const requested = useSearchParams().get('kind');
  const initialKind: AppCreateKind =
    requested === 'pdf' ? 'doc' : (APP_CREATE_KINDS as readonly string[]).includes(requested ?? '') ? (requested as AppCreateKind) : 'app';
  return (
    // `h-svh`: the header stays put and only the body scrolls (same as `AppsView`).
    <div className="flex h-svh flex-col overflow-hidden">
      <ProjectPageHeader
        title={t('newApp')}
        breadcrumb={
          <>
            <Link
              href={appsHref}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 rounded-sm text-sm outline-none focus-visible:ring-2"
            >
              {tI18nComplete.raw('text89dd748442c1')}
            </Link>
            <CaretRightIcon className="text-muted-foreground size-3 shrink-0" aria-hidden />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-10 pb-20 md:px-8 lg:pt-16">
          {can.allowed === true ? (
            <AppCreate projectId={projectId} initialKind={initialKind} autoFocus />
          ) : can.allowed === false ? (
            <EmptyState media={<EmptyArt icon={SquaresFourIcon} />} title={t('noStart')} description={t('noStartHint')} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
