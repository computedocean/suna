'use client';

import { useTranslations } from '../../../i18n';
import { cn } from '../../../lib/utils';
import { FaviconAvatar } from '../../../primitives/favicon-avatar';
import type { TurnSource } from '../shared/derive-panels';
import { sourcesDetail } from '../../turn/turn-sources';
import type { Detail } from './detail-view';
import { PANEL_ROW, PANEL_ROW_ICON, PanelCard } from './panel-card';

/** Rows drawn in the card; the header's "See all" lists every source with its excerpt. */
const SHOWN = 5;

/**
 * Every web page the session read, in the order the agent met them: the
 * site's mark, the page title, its domain. A row opens the page. The header's
 * "See all" opens the full list with excerpts. A session that read no page
 * draws no card.
 */
export function SourcesCard({
  sources,
  onOpenDetail,
}: {
  sources: TurnSource[];
  onOpenDetail: (detail: Detail) => void;
}) {
  const t = useTranslations('sessionUi.turn');
  if (sources.length === 0) return null;
  const title = t('sourcesTitle');

  return (
    <PanelCard
      title={title}
      isEmpty={false}
      headerAction={
        // Text only, no fill or padding: the label ends on the rows' trailing edge.
        <button
          type="button"
          onClick={() => onOpenDetail(sourcesDetail('session-sources', title, sources))}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs transition-colors duration-fast outline-none focus-visible:ring-2"
        >
          {t('seeAllSources')}
        </button>
      }
    >
      <ul className="flex flex-col">
        {sources.slice(0, SHOWN).map((s) => (
          <li key={s.url} className="flex">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(PANEL_ROW, 'focus-visible:ring-ring outline-none focus-visible:ring-2')}
            >
              <span className={PANEL_ROW_ICON}>
                <FaviconAvatar value={s.url} size="2xs" className="rounded-none" />
              </span>
              <span className="text-foreground min-w-0 flex-1 truncate">{s.title}</span>
              <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs">{s.domain}</span>
            </a>
          </li>
        ))}
      </ul>
    </PanelCard>
  );
}
