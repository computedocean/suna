'use client';

import { useTranslations } from '@/i18n/use-translations';
import Link from '@/components/site-link';
import { useProjectSendGate } from '@/hooks/projects/use-project-send-gate';
import type { Command } from '@kortix/sdk/react';
import { MY_KORTIX_SANDBOX_SLUG, isMyKortixAgentName } from '@kortix/shared';
import { cn, uiRoutes } from '@kortix/ui';
import { ComposerChatInput, type ComposerOptions } from '@kortix/ui/session/composer/composer-chat-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kortix/ui/tabs';
import { useProjectHomeSend } from '@kortix/ui/workspace';
import { useCallback, useState, type ReactNode } from 'react';

import { LIBRARY_TAB_ACTIVE } from './apps-library';
import {
  APP_CREATE_KINDS,
  appTemplatesFor,
  type AppCreateKind,
  type AppTemplate,
  type AppTemplateArt,
  type AppTemplateHue,
} from './app-templates';

type SendArgs = Parameters<ReturnType<typeof useProjectHomeSend>['send']>;

/**
 * The top of the Apps page: the project home's composer and the templates
 * under it. A send starts a new session with the prompt and opens it, as on
 * the project home. A template only writes its prompt into the composer. Apps
 * the agent deploys show up in the grid below; slides, sheets and docs are
 * published to Artifacts.
 */
export function AppCreate({
  projectId,
  initialKind = 'app',
  autoFocus = false,
  className,
}: {
  projectId: string;
  /** The template tab it opens on (`/apps/new?kind=slides` from an empty Slides tab). */
  initialKind?: AppCreateKind;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useTranslations('appCreate');
  const beforeSend = useProjectSendGate(projectId);
  const { send, sending, draftHandoffScope } = useProjectHomeSend(projectId, { beforeSend });
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const metaSelected = isMyKortixAgentName(selectedAgent);
  const [kind, setKind] = useState<AppCreateKind>(initialKind);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; id: number } | null>(null);

  // My Kortix runs on its own sandbox, as on the project home.
  const handleSend = useCallback(
    (text: string, files: SendArgs[1], options: ComposerOptions, attachments?: SendArgs[3]) =>
      send(text, files, { ...options, ...(metaSelected ? { sandbox_slug: MY_KORTIX_SANDBOX_SLUG } : {}) }, attachments),
    [metaSelected, send],
  );
  // A slash command starts the session with `/<name> <args>`, as on the project home.
  const handleCommand = useCallback(
    (cmd: Command, args: string | undefined, options: ComposerOptions) =>
      // A refused send already told the person why (billing gate, toast).
      void handleSend(`/${cmd.name}${args ? ` ${args}` : ''}`, undefined, options).catch(() => undefined),
    [handleSend],
  );

  const pick = (template: AppTemplate) => {
    if (sending) return;
    setPickedId(template.id);
    setPrefill((previous) => ({ text: t(`templates.${template.id}.prompt`), id: (previous?.id ?? 0) + 1 }));
  };

  return (
    <section aria-labelledby="app-create-title" className={cn('flex flex-col gap-6', className)} data-testid="app-create">
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <h2 id="app-create-title" className="text-foreground text-xl font-medium">
            {t('title')}
          </h2>
          <p className="text-muted-foreground text-sm text-pretty">{t('description')}</p>
        </div>
        <ComposerChatInput
          onSend={handleSend}
          onCommand={handleCommand}
          projectId={projectId}
          draftHandoffScope={draftHandoffScope}
          isSending={sending}
          disabled={sending}
          clearOnSend={false}
          autoFocus={autoFocus}
          placeholder={t('placeholder')}
          hint={t('placeholder')}
          prefill={prefill}
          underbarPlacement="inline"
          slashMenuPlacement="below"
          onAgentSelectionChange={setSelectedAgent}
          // The page column holds it: no centred max width, no inset of its own.
          parentClassName="max-w-none px-0"
        />
      </div>

      <Tabs value={kind} onValueChange={(value) => setKind(value as AppCreateKind)} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="text-foreground text-sm font-medium">{t('templatesHeading')}</h3>
          <div className="-m-1 [scrollbar-width:none] overflow-x-auto p-1">
            <TabsList variant="secondary" size="xs" aria-label={t('kindsLabel')} className="w-max">
              {APP_CREATE_KINDS.map((value) => (
                <TabsTrigger key={value} value={value} size="xs" data-testid={`app-create-kind-${value}`} className={LIBRARY_TAB_ACTIVE}>
                  {t(`kinds.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        {APP_CREATE_KINDS.map((value) => (
          <TabsContent key={value} value={value} className="mt-0 flex flex-col gap-3">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3" data-testid="app-templates">
              {appTemplatesFor(value).map((template) => (
                <li key={template.id} className="flex">
                  <TemplateCard
                    template={template}
                    picked={pickedId === template.id}
                    disabled={sending}
                    onPick={() => pick(template)}
                  />
                </li>
              ))}
            </ul>
            {value === 'app' ? null : (
              <p className="text-muted-foreground text-xs">
                {t.rich('artifactsNote', {
                  link: (chunks: ReactNode) => (
                    <Link href={`${uiRoutes().project(projectId)}/artifacts`} className="text-foreground underline-offset-2 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

/**
 * One template: a wireframe of what it makes, its name and one line. The
 * whole card is the button. One hairline, never a second: hover, focus and
 * the picked card only change the art panel's color and wake the wireframe.
 */
function TemplateCard({
  template,
  picked,
  disabled,
  onPick,
}: {
  template: AppTemplate;
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const t = useTranslations('appCreate');
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-current={picked ? 'true' : undefined}
      className={cn(
        'group bg-background flex w-full flex-col overflow-hidden rounded-lg border text-left outline-none',
        'focus-visible:ring-ring/50 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-60',
      )}
      data-testid="app-template"
      data-template={template.id}
    >
      <div
        className={cn(
          'bg-card flex h-28 w-full items-center justify-center overflow-hidden border-b',
          'duration-moderate ease-default transition-colors group-hover:bg-hover group-focus-visible:bg-hover group-aria-[current=true]:bg-hover',
        )}
        aria-hidden
      >
        <TemplateArt art={template.art} hue={template.hue} />
      </div>
      {/* Name over one line of purpose: the name holds one line, the
          description wraps to two at a reading line height (1.5). */}
      <span className="flex flex-col gap-1 px-4 pt-3 pb-3.5">
        <span className="text-foreground truncate text-sm leading-snug font-medium">{t(`templates.${template.id}.title`)}</span>
        <span className="text-muted-foreground line-clamp-2 text-xs leading-normal font-normal text-pretty">
          {t(`templates.${template.id}.description`)}
        </span>
      </span>
    </button>
  );
}

/* ── Wireframes ─────────────────────────────────────────────────────────────
   Drawn from tokens, not images. At rest a wireframe is neutral with ONE mark
   in its hue. Hover, keyboard focus and the picked card ("awake") fill a few
   more marks with the hue. The card lifts the wireframe 2px; only the bars
   and a doc's lines also grow. Fills only (no border colour), so every change
   is a background-color or a transform. Every class is a static string so
   Tailwind sees it. */

type Hue = AppTemplateHue;

/** The resting mark: always in the hue. */
const SOLID: Record<Hue, string> = {
  blue: 'bg-kortix-blue',
  green: 'bg-kortix-green',
  orange: 'bg-kortix-orange',
  purple: 'bg-kortix-purple',
  red: 'bg-kortix-red',
  yellow: 'bg-kortix-yellow',
};

/** A neutral mark that takes the hue when the card is awake. */
const WAKE: Record<Hue, string> = {
  blue: 'group-hover:bg-kortix-blue group-focus-visible:bg-kortix-blue group-aria-[current=true]:bg-kortix-blue',
  green: 'group-hover:bg-kortix-green group-focus-visible:bg-kortix-green group-aria-[current=true]:bg-kortix-green',
  orange: 'group-hover:bg-kortix-orange group-focus-visible:bg-kortix-orange group-aria-[current=true]:bg-kortix-orange',
  purple: 'group-hover:bg-kortix-purple group-focus-visible:bg-kortix-purple group-aria-[current=true]:bg-kortix-purple',
  red: 'group-hover:bg-kortix-red group-focus-visible:bg-kortix-red group-aria-[current=true]:bg-kortix-red',
  yellow: 'group-hover:bg-kortix-yellow group-focus-visible:bg-kortix-yellow group-aria-[current=true]:bg-kortix-yellow',
};

/** Colour fades and the one move share this timing: 200ms, strong ease-out. */
const FADE = 'duration-moderate ease-default transition-[background-color,scale,translate,opacity] motion-reduce:transition-colors';

/** A mark that pops in when awake (a check, a booked day): from 60%, never from nothing. */
const POP = 'motion-safe:scale-60 motion-safe:group-hover:scale-100 motion-safe:group-focus-visible:scale-100';

/** A card picked up off the board: 4px right, 2px up. */
const NUDGE = 'motion-safe:group-hover:translate-x-1 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-focus-visible:translate-x-1 motion-safe:group-focus-visible:-translate-y-0.5';

/** A mark that grows a little when awake (bars up, lines across). Movement only with motion allowed. */
const GROW_Y = 'origin-bottom motion-safe:scale-y-80 motion-safe:group-hover:scale-y-100 motion-safe:group-focus-visible:scale-y-100';
/** A line being written: it runs out from 45% to its full width. */
const TYPE_X = 'origin-left motion-safe:scale-x-45 motion-safe:group-hover:scale-x-100 motion-safe:group-focus-visible:scale-x-100';

const LINE_WIDTH = {
  4: 'w-4',
  6: 'w-6',
  8: 'w-8',
  10: 'w-10',
  12: 'w-12',
  16: 'w-16',
  20: 'w-20',
  24: 'w-24',
} as const;
type LineWidth = keyof typeof LINE_WIDTH;

type Tone = 'solid' | 'wake' | undefined;

/** A text line. `strong`: a heading. `tone`: in the hue at rest (`solid`) or when awake (`wake`). */
function Line({ w, strong = false, tone, hue, className }: { w: LineWidth; strong?: boolean; tone?: Tone; hue: Hue; className?: string }) {
  return (
    <span
      className={cn(
        'block h-1 shrink-0 rounded-full',
        FADE,
        LINE_WIDTH[w],
        tone === 'solid' ? SOLID[hue] : strong ? 'bg-muted-foreground' : 'bg-border',
        tone === 'wake' && WAKE[hue],
        className,
      )}
    />
  );
}

/** A round mark (a person, a status, a bullet). */
function Dot({ size, tone, hue, className }: { size: 'size-1' | 'size-1.5' | 'size-2.5' | 'size-4'; tone?: Tone; hue: Hue; className?: string }) {
  return (
    <span
      className={cn('shrink-0 rounded-full', FADE, size, tone === 'solid' ? SOLID[hue] : 'bg-border', tone === 'wake' && WAKE[hue], className)}
    />
  );
}

function Surface({ className, children }: { className?: string; children?: ReactNode }) {
  return <span className={cn('bg-background flex rounded-sm border', className)}>{children}</span>;
}

const BAR_HEIGHTS = ['h-3', 'h-5', 'h-4', 'h-7', 'h-6', 'h-9', 'h-8', 'h-11', 'h-10', 'h-12'] as const;

/** Bars: one in the hue at rest, every third one when awake; all grow to full height. */
function Bars({ count, hue, className }: { count: number; hue: Hue; className?: string }) {
  return (
    <span className={cn('flex items-end gap-1 border-b pb-px', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className={cn(
            'w-1.5 rounded-t-sm',
            FADE,
            GROW_Y,
            BAR_HEIGHTS[index % BAR_HEIGHTS.length],
            index === count - 2 ? SOLID[hue] : cn('bg-border', index % 3 === 0 && WAKE[hue]),
          )}
        />
      ))}
    </span>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <Surface className="h-24 w-20 flex-col gap-1.5 px-2.5 py-3">{children}</Surface>;
}

function Slide({ className, children }: { className?: string; children?: ReactNode }) {
  return <Surface className={cn('aspect-video flex-col justify-center gap-1.5 px-3', className)}>{children}</Surface>;
}

/** A table: the first header cell in the hue at rest; awake, the header (and totals) row takes it and the last row fills in. */
function Table({ cols, rows, hue, totals = false }: { cols: number; rows: number; hue: Hue; totals?: boolean }) {
  return (
    <Surface className="flex-col overflow-hidden">
      {Array.from({ length: rows }).map((_, row) => {
        const header = row === 0;
        const total = totals && row === rows - 1;
        return (
          <span key={row} className={cn('flex', row > 0 && 'border-t', total && 'bg-card')}>
            {Array.from({ length: cols }).map((__, col) => (
              <span key={col} className={cn('flex h-3.5 w-7 items-center px-1', col > 0 && 'border-l')}>
                <span
                  className={cn(
                    'h-1 w-full rounded-full',
                    FADE,
                    header && col === 0 ? SOLID[hue] : header || total ? cn('bg-muted-foreground', WAKE[hue]) : 'bg-border',
                    // The last row is the one being filled in.
                    row === rows - 1 && TYPE_X,
                  )}
                />
              </span>
            ))}
          </span>
        );
      })}
    </Surface>
  );
}

function TemplateArt({ art, hue }: { art: AppTemplateArt; hue: Hue }) {
  switch (art) {
    case 'checkin':
      // Today's list: one person is in; awake, two more check in. One stays out.
      return (
        <span className="flex flex-col gap-2">
          {([16, 12, 20, 10] as const).map((w, index) => (
            <span key={index} className="flex items-center gap-2">
              <Dot size="size-2.5" hue={hue} />
              <Line w={w} hue={hue} />
              {index === 2 ? (
                <span className="ml-6 size-2.5 rounded-sm border" />
              ) : (
                <span className={cn('ml-6 size-2.5 rounded-sm', FADE, index === 0 ? SOLID[hue] : cn('bg-border', WAKE[hue], index === 3 && POP))} />
              )}
            </span>
          ))}
        </span>
      );
    case 'form':
      return (
        <span className="flex w-32 flex-col gap-2">
          {([8, 12, 6] as const).map((w, index) => (
            <span key={index} className="flex flex-col gap-1">
              <Line w={w} hue={hue} />
              <Surface className="h-3 w-full items-center px-1">
                {index === 0 ? <Line w={10} tone="wake" hue={hue} className={TYPE_X} /> : null}
              </Surface>
            </span>
          ))}
          <span className={cn('ml-auto h-3 w-10 rounded-sm', SOLID[hue])} />
        </span>
      );
    case 'chart':
      return (
        <span className="flex flex-col gap-2">
          <span className="flex gap-2">
            {([8, 6, 10] as const).map((w, index) => (
              <Surface key={index} className="flex-col gap-1 px-1.5 py-1">
                <Line w={4} hue={hue} />
                <Line w={w} strong tone={index === 0 ? 'solid' : 'wake'} hue={hue} />
              </Surface>
            ))}
          </span>
          <Bars count={14} hue={hue} />
        </span>
      );
    case 'board':
      // Three columns by status; the In progress card is in the hue, its column header when awake.
      return (
        <span className="flex gap-2">
          {([3, 2, 1] as const).map((cards, column) => (
            <span key={column} className="flex w-12 flex-col gap-1">
              <Line w={8} strong tone={column === 1 ? 'wake' : undefined} hue={hue} />
              {Array.from({ length: cards }).map((_, index) => (
                <Surface key={index} className={cn('h-4 w-full items-center gap-1 px-1', column === 1 && index === 0 && cn(FADE, NUDGE))}>
                  {column === 1 && index === 0 ? <Dot size="size-1.5" tone="solid" hue={hue} /> : null}
                  <Line w={index % 2 ? 6 : 8} hue={hue} />
                </Surface>
              ))}
            </span>
          ))}
        </span>
      );
    case 'lookup':
      return (
        <span className="flex w-36 flex-col gap-2">
          <Surface className="h-4 w-full items-center gap-1.5 rounded-full px-1.5">
            <Dot size="size-1.5" tone="solid" hue={hue} />
            <Line w={12} tone="wake" hue={hue} className={TYPE_X} />
          </Surface>
          {[0, 1, 2].map((row) => (
            <span key={row} className={cn('flex items-center gap-2 rounded-sm px-1.5 py-1', row === 0 && 'bg-background border')}>
              <Line w={row === 0 ? 16 : 12} strong={row === 0} tone={row === 0 ? 'wake' : undefined} hue={hue} />
              <Line w={6} hue={hue} className="ml-auto" />
            </span>
          ))}
        </span>
      );
    case 'directory':
      return (
        <span className="grid grid-cols-3 gap-x-3 gap-y-2.5">
          {([10, 8, 12, 8, 10, 6] as const).map((w, index) => (
            <span key={index} className="flex flex-col items-center gap-1">
              <Dot size="size-4" tone={index === 0 ? 'solid' : index === 4 ? 'wake' : undefined} hue={hue} className={index === 4 ? POP : undefined} />
              <Line w={w} hue={hue} />
            </span>
          ))}
        </span>
      );
    case 'deck':
      return (
        <span className="relative flex">
          <Surface className="absolute top-1.5 left-3 aspect-video w-32" />
          <Slide className="relative w-32 items-start">
            <Line w={16} tone="solid" hue={hue} />
            <Line w={10} tone="wake" hue={hue} className={TYPE_X} />
          </Slide>
        </span>
      );
    case 'deck-chart':
      return (
        <Slide className="w-36 items-start justify-start gap-2 py-2.5">
          <Line w={12} strong tone="wake" hue={hue} />
          <Bars count={9} hue={hue} className="w-full justify-between" />
        </Slide>
      );
    case 'deck-grid':
      return (
        <span className="flex flex-col gap-1.5">
          <Slide className="w-32 items-center">
            <Line w={12} tone="solid" hue={hue} />
            <Line w={8} tone="wake" hue={hue} className={TYPE_X} />
          </Slide>
          <span className="flex gap-1.5">
            {[0, 1, 2].map((index) => (
              <Surface key={index} className="aspect-video w-9.5 items-center justify-center">
                <Line w={4} tone={index === 0 ? 'solid' : 'wake'} hue={hue} />
              </Surface>
            ))}
          </span>
        </span>
      );
    case 'table':
      return <Table cols={5} rows={5} hue={hue} />;
    case 'table-totals':
      return <Table cols={4} rows={5} hue={hue} totals />;
    case 'calendar':
      return (
        <span className="grid grid-cols-7 gap-1">
          {Array.from({ length: 21 }).map((_, index) => (
            <span
              key={index}
              className={cn(
                'size-4 rounded-sm',
                FADE,
                index === 2 ? SOLID[hue] : [9, 11, 18].includes(index) ? cn('bg-border', WAKE[hue], index === 11 && POP) : 'bg-background border',
              )}
            />
          ))}
        </span>
      );
    case 'doc':
      return (
        <Page>
          <Line w={12} tone="solid" hue={hue} />
          <span className="h-0.5" />
          {([12, 10, 12, 8, 12, 6] as const).map((w, index) => (
            <Line key={index} w={w} tone={index === 5 ? 'wake' : undefined} hue={hue} className={index === 5 ? TYPE_X : undefined} />
          ))}
        </Page>
      );
    case 'doc-list':
      return (
        <Page>
          <Line w={10} strong tone="wake" hue={hue} />
          <span className="h-0.5" />
          {([10, 8, 10, 6] as const).map((w, index) => (
            <span key={index} className="flex items-center gap-1">
              <Dot size="size-1" tone={index === 0 ? 'solid' : 'wake'} hue={hue} />
              <Line w={w} hue={hue} className={index === 3 ? TYPE_X : undefined} />
            </span>
          ))}
        </Page>
      );
    case 'doc-columns':
      return (
        <Page>
          <Line w={12} strong tone="wake" hue={hue} />
          <span className="h-0.5" />
          <span className="flex gap-1.5">
            {[0, 1].map((column) => (
              <span key={column} className="flex flex-col gap-1.5">
                {([6, 4, 6, 4, 6] as const).map((w, index) => (
                  <Line
                    key={index}
                    w={column && index === 4 ? 4 : w}
                    tone={column === 0 && index === 0 ? 'solid' : column === 1 && index === 4 ? 'wake' : undefined}
                    hue={hue}
                    className={column === 1 && index === 4 ? TYPE_X : undefined}
                  />
                ))}
              </span>
            ))}
          </span>
        </Page>
      );
  }
}
