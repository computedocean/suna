'use client';

import { GlobeIcon } from '@phosphor-icons/react';
import { useTranslations } from '../../i18n';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives/button';
import { FaviconAvatar } from '../../primitives/favicon-avatar';
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover';
import type { Detail } from '../panel/easy/detail-view';
import { useOptionalSessionPanel } from '../panel/session-panel-provider';
import type { TurnSource } from '../panel/shared/derive-panels';

/** Favicons drawn in the button before the count. */
const STACK = 3;

/** The side panel's view of a list of sources: every page with its title and excerpt. */
export function sourcesDetail(key: string, title: string, sources: TurnSource[]): Detail {
  return {
    key,
    title,
    icon: <GlobeIcon className="text-foreground size-4 shrink-0" />,
    meta: <span className="tabular-nums">{sources.length}</span>,
    // Rows carry their own inset for the hover fill; the layer's p-4 would double it.
    padded: false,
    body: (
      <div className="p-2">
        <SourceList sources={sources} />
      </div>
    ),
  };
}

/**
 * "N sources" in an answer's action bar: the favicons of the first sites the
 * response read, then the count. It opens this response's sources in the
 * session side panel; a second press closes it. A host without the side panel
 * gets the same list in a popover.
 */
export function TurnSourcesButton({ turnId, sources }: { turnId: string; sources: TurnSource[] }) {
  const t = useTranslations('sessionUi.turn');
  const panel = useOptionalSessionPanel();
  if (sources.length === 0) return null;

  const key = `turn-sources:${turnId}`;
  const face = <SourcesFace sources={sources} label={t('sources', { count: sources.length })} />;

  if (!panel) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" className={BUTTON}>
            {face}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-88 p-0">
          <div className="max-h-[min(28rem,60vh)] overflow-y-auto p-1.5">
            <SourceList sources={sources} />
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  const open = panel.detail?.key === key;
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-pressed={open}
      data-testid="turn-sources"
      onClick={() => (open ? panel.closeDetail() : panel.openDetail(sourcesDetail(key, t('sourcesTitle'), sources)))}
      className={cn(BUTTON, open && 'bg-active text-foreground')}
    >
      {face}
    </Button>
  );
}

const BUTTON = 'text-muted-foreground hover:text-foreground gap-1.5 text-xs font-normal';

function SourcesFace({ sources, label }: { sources: TurnSource[]; label: string }) {
  // One favicon per site: three results from one domain show its mark once.
  const marks = [...new Map(sources.map((s) => [s.domain, s])).values()].slice(0, STACK);
  return (
    <>
      <span aria-hidden className="flex items-center -space-x-1">
        {marks.map((s) => (
          <FaviconAvatar key={s.domain} value={s.url} size="2xs" className="ring-background rounded-full ring-2" />
        ))}
      </span>
      <span className="tabular-nums">{label}</span>
    </>
  );
}

/**
 * The pages, one row each: the site, the page title, the excerpt the search
 * returned. A row opens the page in a new tab.
 */
export function SourceList({ sources }: { sources: TurnSource[] }) {
  return (
    <ol className="flex min-w-0 flex-col gap-0.5">
      {sources.map((s) => (
        <li key={s.url}>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:bg-hover focus-visible:ring-ring flex flex-col gap-1 rounded-md px-2.5 py-2 transition-colors duration-fast outline-none focus-visible:ring-2"
          >
            <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              <FaviconAvatar value={s.url} size="2xs" className="shrink-0 rounded-none" />
              <span className="truncate">{s.domain}</span>
            </span>
            <span className="text-foreground line-clamp-2 text-sm leading-snug text-pretty">{s.title}</span>
            {s.snippet ? (
              <span className="text-muted-foreground line-clamp-3 text-xs leading-normal text-pretty">{s.snippet}</span>
            ) : null}
          </a>
        </li>
      ))}
    </ol>
  );
}
