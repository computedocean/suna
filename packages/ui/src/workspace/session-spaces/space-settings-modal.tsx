'use client';

import { ApiError, type ProjectSessionGroup } from '@kortix/sdk';
import { useDeleteWorkspaceSessionGroup, useUpdateWorkspaceSessionGroup } from '@kortix/sdk/react';
import { sessionGroupDriveFolder } from '@kortix/shared';
import { BrainIcon, FolderSimpleIcon, GearSixIcon, UsersThreeIcon, XIcon } from '@phosphor-icons/react';
import { useId, useRef, useState, type ComponentType, type ReactNode } from 'react';

import { useTranslations } from '../../i18n';
import { uiRoutes } from '../../lib/routes';
import { cn } from '../../lib/utils';
import { ActionBar, ActionBarDock } from '../../primitives/action-bar';
import { Button } from '../../primitives/button';
import { ConfirmDialog } from '../../primitives/confirm-dialog';
import { Input } from '../../primitives/input';
import Hint from '../../primitives/hint';
import { Modal, ModalClose, ModalContent, ModalTitle } from '../../primitives/modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../primitives/tabs';
import { Textarea } from '../../primitives/textarea';
import { errorToast, successToast } from '../../primitives/toast';
import { useUiRouter } from '../../providers/ui-provider';
import { ProjectIconField } from '../projects/modal/project-icon-field';
import { SpaceIconBare, spaceIconValue } from './space-icon';
import { SpaceMemoryPane } from './space-memory-pane';
import { SpaceSharePanel } from './space-share-modal';

/** The API's limits (`SESSION_GROUP_NAME_MAX`, `SESSION_GROUP_DESCRIPTION_MAX`, `SESSION_GROUP_INSTRUCTIONS_MAX`). */
const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;
const INSTRUCTIONS_MAX = 8000;

/** The search parameter that opens Space settings on a pane (`?settings=memory`). */
export const SPACE_SETTINGS_PARAM = 'settings';

export const SPACE_SETTINGS_PANES = ['general', 'members', 'files', 'memory'] as const;
export type SpaceSettingsPane = (typeof SPACE_SETTINGS_PANES)[number];

export function isSpaceSettingsPane(value: string | null | undefined): value is SpaceSettingsPane {
  return (SPACE_SETTINGS_PANES as readonly string[]).includes(value ?? '');
}

/**
 * One rail row. The project sidebar's menu-button recipe (32px, `px-2`,
 * medium label, `bg-hover` / `bg-active`), as the workspace Settings rail
 * draws it, so the two settings surfaces read as one.
 */
const RAIL_ROW =
  'h-8 flex-none gap-2 rounded-md border-0 px-2 text-sm font-medium transition-none max-lg:w-auto lg:w-full lg:justify-start ' +
  'data-[state=inactive]:text-sidebar-foreground data-[state=active]:bg-active data-[state=active]:text-foreground hover:data-[state=inactive]:bg-hover [&_svg]:size-4';

type Draft = { name: string; description: string; instructions: string; icon: ProjectSessionGroup['icon'] };

function draftOf(space: ProjectSessionGroup): Draft {
  return {
    name: space.name,
    description: space.description ?? '',
    instructions: space.instructions ?? '',
    icon: space.icon ?? null,
  };
}

/**
 * Space settings: a rail of panes on the left, the open pane on the right.
 * General holds what every session of the space reads (its name, what it is
 * for, its instructions) and Delete; Members its sharing; Files its shared
 * folder; Memory the pages its sessions read and save. The General draft
 * lives here, above the panes, so switching panes keeps unsaved edits;
 * closing with unsaved edits asks first, and Save shows only while there is
 * something to save (the floating action bar).
 */
export function SpaceSettingsModal({
  projectId,
  space,
  pane,
  onPaneChange,
  onOpenChange,
  renderFolder,
}: {
  projectId: string;
  space: ProjectSessionGroup;
  /** The open pane; null: the dialog is closed. */
  pane: SpaceSettingsPane | null;
  onPaneChange: (pane: SpaceSettingsPane) => void;
  onOpenChange: (open: boolean) => void;
  /** The host's Drive explorer for the space folder; without it, Files is not offered. */
  renderFolder?: (folder: { path: string; place: string; ownFolder: string | null; missing: ReactNode }) => ReactNode;
}) {
  const t = useTranslations('sessionSpaces.settings');
  const tSpaces = useTranslations('sessionSpaces');
  const open = pane !== null;
  const update = useUpdateWorkspaceSessionGroup(projectId);
  const [draft, setDraft] = useState<Draft>(() => draftOf(space));
  // What the draft started from. A save sends only the fields that differ from
  // it, so a field another member changed meanwhile is not written back.
  const [base, setBase] = useState<Draft>(() => draftOf(space));
  // A fresh draft each time the dialog opens, for the space it opens on.
  const [syncedFor, setSyncedFor] = useState<[boolean, string]>([open, space.group_id]);
  if (syncedFor[0] !== open || syncedFor[1] !== space.group_id) {
    setSyncedFor([open, space.group_id]);
    if (open) {
      setDraft(draftOf(space));
      setBase(draftOf(space));
    }
  }
  const changed = {
    name: draft.name.trim() !== base.name,
    description: draft.description.trim() !== base.description,
    instructions: draft.instructions.trim() !== base.instructions,
    icon: JSON.stringify(draft.icon ?? null) !== JSON.stringify(base.icon ?? null),
  };
  const dirty = changed.name || changed.description || changed.instructions || changed.icon;
  const pending = update.isPending;
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // An unsent note in the Memory pane counts as unsaved work too.
  const [memoryDraft, setMemoryDraft] = useState(false);
  // Every way out (the close button, Escape, a click outside) asks before an unsaved draft is lost.
  const requestClose = () => {
    if (pending) return;
    if (dirty || memoryDraft) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      setNameProblem(t('nameRequired'));
      return;
    }
    if (!dirty || pending) return;
    const description = draft.description.trim();
    const instructions = draft.instructions.trim();
    try {
      await update.mutateAsync({
        groupId: space.group_id,
        input: {
          ...(changed.name ? { name } : {}),
          ...(changed.description ? { description: description || null } : {}),
          ...(changed.instructions ? { instructions: instructions || null } : {}),
          ...(changed.icon ? { icon: draft.icon } : {}),
        },
      });
      const next = { name, description, instructions, icon: draft.icon };
      setDraft(next);
      setBase(next);
      successToast(t('saved'));
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === 'group_name_taken') setNameProblem(tSpaces('nameTaken'));
      else if (code === 'invalid_icon') errorToast(tSpaces('iconSaveFailed'));
      else errorToast(tSpaces('saveFailed'));
    }
  };

  const panes: Array<{ id: SpaceSettingsPane; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'general', label: t('navGeneral'), icon: GearSixIcon },
    { id: 'members', label: t('navMembers'), icon: UsersThreeIcon },
    ...(renderFolder ? [{ id: 'files' as const, label: t('navFiles'), icon: FolderSimpleIcon }] : []),
    { id: 'memory', label: t('navMemory'), icon: BrainIcon },
  ];
  // A pane the host cannot draw (Files without a Drive explorer) opens General.
  const shown: SpaceSettingsPane = pane && panes.some((entry) => entry.id === pane) ? pane : 'general';
  const ownFolder = sessionGroupDriveFolder(space.group_id);
  // Memory stays mounted once opened, so a page edit there survives a switch to another pane.
  const [memoryOpened, setMemoryOpened] = useState(false);
  if (open && shown === 'memory' && !memoryOpened) setMemoryOpened(true);
  if (!open && memoryOpened) setMemoryOpened(false);


  // Focus lands on the pane's name when the dialog opens, not on the first rail row (which then drew its focus ring).
  const titleRef = useRef<HTMLHeadingElement>(null);
  const paneTitle = panes.find((entry) => entry.id === shown)?.label ?? t('navGeneral');

  return (
    <>
      <Modal open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <ModalContent
          variant="base"
          showCloseButton={false}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          className={cn(
            'flex flex-col space-y-0 overflow-hidden p-0',
            'max-lg:h-[92dvh] lg:h-[min(44rem,88vh)] lg:max-w-5xl',
            'lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:grid-rows-1',
          )}
        >
          <Tabs value={shown} onValueChange={(next) => onPaneChange(next as SpaceSettingsPane)} orientation="vertical" className="contents">
            {/* The rail: whose settings these are, then the panes. */}
            <aside className="bg-sidebar flex min-w-0 shrink-0 flex-col border-b lg:border-r lg:border-b-0">
              <div className="flex h-12 shrink-0 items-center gap-2 px-4">
                <SpaceIconBare space={{ name: space.name, icon: space.icon }} className="size-4 shrink-0 text-sm" />
                <ModalTitle className="text-foreground min-w-0 truncate text-sm font-medium">{space.name}</ModalTitle>
              </div>
              <TabsList
                orientation="vertical"
                type="secondary"
                aria-label={t('title')}
                className="h-auto flex-row justify-start gap-0.5 overflow-x-auto bg-transparent px-2 pb-2 lg:flex-col lg:items-stretch"
              >
                {panes.map(({ id, label, icon: Icon }) => (
                  <TabsTrigger key={id} value={id} className={RAIL_ROW}>
                    <Icon className="text-muted-foreground" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </aside>

            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {/* One bar over every pane: its name, then close. The hairline under it is the pane's top edge. */}
              <header className="flex h-12 shrink-0 items-center gap-3 border-b px-6">
                <h2 ref={titleRef} tabIndex={-1} className="text-foreground min-w-0 flex-1 truncate text-sm font-medium outline-none">
                  {paneTitle}
                </h2>
                {shown === 'files' ? <span className="text-muted-foreground hidden font-mono text-xs sm:inline">/drives/space</span> : null}
                <Hint label={tSpaces('cancel')}>
                  <ModalClose asChild>
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground -mr-2 shrink-0" aria-label={tSpaces('cancel')} disabled={pending}>
                      <XIcon className="size-4" />
                    </Button>
                  </ModalClose>
                </Hint>
              </header>

              <TabsContent value="general" className="min-h-0 flex-1 overflow-y-auto">
                <GeneralPane
                  space={space}
                  draft={draft}
                  setDraft={(next) => {
                    setDraft(next);
                    setNameProblem(null);
                  }}
                  nameProblem={nameProblem}
                  pending={pending}
                  onSave={() => void save()}
                  footer={space.can_manage === true ? <DeleteRow projectId={projectId} space={space} /> : null}
                />
              </TabsContent>
              <TabsContent value="members" className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-6 px-6 py-6">
                  <p className="text-muted-foreground text-sm text-pretty">{t('membersDescription')}</p>
                  <SpaceSharePanel projectId={projectId} space={space} enabled={open && shown === 'members'} />
                </div>
              </TabsContent>
              {renderFolder ? (
                <TabsContent value="files" className="flex min-h-0 flex-1 flex-col">
                  {ownFolder ? renderFolder({ path: ownFolder, place: space.name, ownFolder, missing: null }) : null}
                </TabsContent>
              ) : null}
              <TabsContent
                value="memory"
                forceMount={memoryOpened ? true : undefined}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto data-[state=inactive]:hidden"
              >
                {memoryOpened ? <SpaceMemoryPane projectId={projectId} space={space} onDraftChange={setMemoryDraft} /> : null}
              </TabsContent>

              {/* Save shows only while there is something to save, over whichever pane is open. */}
              {dirty ? (
                <ActionBarDock>
                  <ActionBar
                    title={t('unsaved')}
                    busy={pending}
                    actions={[
                      {
                        id: 'reset',
                        label: t('clear'),
                        onSelect: () => {
                          setDraft(base);
                          setNameProblem(null);
                        },
                      },
                      { id: 'save', label: t('save'), emphasis: 'primary', loading: pending, onSelect: () => void save() },
                    ]}
                  />
                </ActionBarDock>
              ) : null}
            </div>
          </Tabs>
        </ModalContent>
      </Modal>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('discardTitle')}
        description={t('discardDescription')}
        confirmLabel={t('discard')}
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmDiscard(false);
          setDraft(base);
          onOpenChange(false);
        }}
      />
    </>
  );
}

/**
 * One setting: its name and what it does on the left, the control on the
 * right (stacked below `md`). Every row of General shares the one label
 * column, so labels and controls each start on one x.
 */
function SettingRow({
  label,
  hint,
  htmlFor,
  hintId,
  align = 'start',
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  hintId?: string;
  align?: 'start' | 'center';
  children: ReactNode;
}) {
  return (
    <div className={cn('grid gap-3 py-5 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8', align === 'center' && 'md:items-center')}>
      <div className="min-w-0 space-y-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-foreground block text-sm">
            {label}
          </label>
        ) : (
          <span className="text-foreground block text-sm">{label}</span>
        )}
        {hint ? (
          <p id={hintId} className="text-muted-foreground text-xs text-pretty">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function GeneralPane({
  space,
  draft,
  setDraft,
  nameProblem,
  pending,
  onSave,
  footer,
}: {
  space: ProjectSessionGroup;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  nameProblem: string | null;
  pending: boolean;
  onSave: () => void;
  footer: ReactNode;
}) {
  const t = useTranslations('sessionSpaces.settings');
  const nameId = useId();
  const nameErrorId = useId();
  const descriptionId = useId();
  const descriptionHintId = useId();
  const instructionsId = useId();
  const instructionsHintId = useId();
  // Instructions are followed in every member's session: the space's manager sets them (the API refuses anyone else).
  const canEditInstructions = space.can_manage === true;
  const saveOnModEnter = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSave();
    }
  };
  return (
    // Bottom room for the floating Save bar, so it never covers the last row.
    <form
      className="px-6 pb-24"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <fieldset disabled={pending} className="divide-border min-w-0 divide-y">
        <SettingRow label={t('nameLabel')} htmlFor={nameId} align="center">
          <div className="flex items-center gap-2">
            <ProjectIconField
              value={spaceIconValue({ name: draft.name.trim() || space.name, icon: draft.icon })}
              onChange={(emoji) => setDraft({ ...draft, icon: { emoji } })}
              onGlyphChange={(glyph) => setDraft({ ...draft, icon: { glyph } })}
              onClear={draft.icon ? () => setDraft({ ...draft, icon: null }) : undefined}
              disabled={pending}
            />
            <Input
              id={nameId}
              size="md"
              value={draft.name}
              maxLength={NAME_MAX}
              aria-invalid={nameProblem ? true : undefined}
              aria-describedby={nameProblem ? nameErrorId : undefined}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          {nameProblem ? (
            <p id={nameErrorId} role="alert" className="text-destructive mt-2 text-xs">
              {nameProblem}
            </p>
          ) : null}
        </SettingRow>
        <SettingRow label={t('descriptionLabel')} hint={t('descriptionHint')} htmlFor={descriptionId} hintId={descriptionHintId}>
          <Textarea
            id={descriptionId}
            aria-describedby={descriptionHintId}
            value={draft.description}
            maxLength={DESCRIPTION_MAX}
            minHeight={64}
            maxHeight={200}
            placeholder={t('descriptionPlaceholder')}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            onKeyDown={saveOnModEnter}
            className="font-normal"
          />
        </SettingRow>
        <SettingRow
          label={t('instructionsLabel')}
          hint={canEditInstructions ? t('instructionsHint') : `${t('instructionsHint')} ${t('instructionsReadOnly')}`}
          htmlFor={canEditInstructions || draft.instructions ? instructionsId : undefined}
          hintId={instructionsHintId}
        >
          {!canEditInstructions && !draft.instructions ? (
            // Read-only and empty: one quiet line, not an empty box that looks broken.
            <p className="text-muted-foreground pt-2 text-sm">{t('instructionsEmpty')}</p>
          ) : (
            <>
              <Textarea
                id={instructionsId}
                readOnly={!canEditInstructions}
                aria-describedby={instructionsHintId}
                value={draft.instructions}
                maxLength={INSTRUCTIONS_MAX}
                minHeight={160}
                maxHeight={420}
                placeholder={canEditInstructions ? t('instructionsPlaceholder') : undefined}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                onKeyDown={saveOnModEnter}
                className="font-normal"
              />
              {/* The count shows only near the limit, where it helps. */}
              {draft.instructions.length > INSTRUCTIONS_MAX * 0.8 ? (
                <p className="text-muted-foreground mt-2 text-right text-xs tabular-nums">
                  {t('characters', { count: draft.instructions.length, max: INSTRUCTIONS_MAX })}
                </p>
              ) : null}
            </>
          )}
        </SettingRow>
        {footer}
      </fieldset>
    </form>
  );
}

/** The danger zone: one row like every other; the button opens the confirm that states the consequence. */
function DeleteRow({ projectId, space }: { projectId: string; space: ProjectSessionGroup }) {
  const t = useTranslations('sessionSpaces.settings');
  const tSpaces = useTranslations('sessionSpaces');
  const router = useUiRouter();
  const remove = useDeleteWorkspaceSessionGroup(projectId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <SettingRow label={t('deleteLabel')} hint={t('deleteHint')} align="center">
      <div className="flex md:justify-end">
        <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmOpen(true)}>
          {t('deleteAction')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={tSpaces('deleteTitle')}
        description={tSpaces('deleteDescription', { name: space.name })}
        confirmLabel={tSpaces('delete')}
        confirmVariant="destructive"
        isPending={remove.isPending}
        onConfirm={() => {
          remove.mutate(space.group_id, {
            onSuccess: () => {
              successToast(tSpaces('deleted'));
              setConfirmOpen(false);
              // One step, and a replace: Back must not return to the deleted space.
              const all = uiRoutes().sessionSpaces?.(projectId);
              router.replace(all ?? uiRoutes().project(projectId));
            },
            onError: () => errorToast(tSpaces('deleteFailed')),
          });
        }}
      />
    </SettingRow>
  );
}
