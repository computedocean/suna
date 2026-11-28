'use client';

import { ApiError, type ProjectSessionGroup } from '@kortix/sdk';
import {
  useAddWorkspaceMemoryNote,
  useUpdateWorkspaceSessionGroup,
  useUpdateWorkspaceSessionGroupMemory,
  useWorkspaceMemoryPages,
} from '@kortix/sdk/react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { formatDistanceToNow } from 'date-fns';
import { useEffect, useId, useState } from 'react';

import { useTranslations } from '../../i18n';
import { Button } from '../../primitives/button';
import { ErrorState } from '../../primitives/error-state';
import Loading from '../../primitives/loading';
import { Skeleton } from '../../primitives/skeleton';
import Hint from '../../primitives/hint';
import { Switch } from '../../primitives/switch';
import { Textarea } from '../../primitives/textarea';
import { errorToast, successToast } from '../../primitives/toast';
import { MemoryView } from '../memory/memory-view';

/** The API's cap on a note (`MEMORY_LIMITS.note_chars`). */
const NOTE_MAX = 1000;

type Failure = 'secret' | 'readOnly' | 'failed';
const FAILURE_BY_CODE: Record<string, Failure> = { secret_detected: 'secret', layer_read_only: 'readOnly' };

/**
 * The Memory pane of Space settings. A space with pages gets the full memory
 * view (the page list beside the open page). A space with none gets the one
 * thing it needs: a composer under the pane's header to save the first note,
 * so the pane never opens on an empty canvas with a floating popover.
 */
export function SpaceMemoryPane({
  projectId,
  space,
  onDraftChange,
}: {
  projectId: string;
  space: ProjectSessionGroup;
  /** Whether the composer holds an unsaved note, so closing the dialog can ask first. */
  onDraftChange?: (hasDraft: boolean) => void;
}) {
  const t = useTranslations('sessionSpaces.settings');
  const tMemory = useTranslations('spaces.memory');
  const groupId = space.group_id;
  const pages = useWorkspaceMemoryPages(projectId, groupId);
  const controls = <AutoUpdateBar projectId={projectId} space={space} />;

  if (pages.isError && !pages.data) {
    return (
      <div className="px-6 py-6">
        <ErrorState
          size="sm"
          title={tMemory('loadError')}
          action={
            <Button variant="outline" size="sm" onClick={() => void pages.refetch()}>
              {tMemory('retry')}
            </Button>
          }
        />
      </div>
    );
  }
  if (pages.data && pages.data.length > 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-6 py-3">{controls}</div>
        <MemoryView projectId={projectId} layerKey={groupId} place={space.name} />
      </div>
    );
  }
  // The composer mounts only for a list known to be empty: typed text must not
  // vanish when the list arrives with pages and the page view replaces it.
  if (!pages.data) {
    return (
      <div aria-busy className="space-y-6 px-6 py-6">
        <Skeleton className="h-3 w-96 max-w-full py-0 motion-reduce:animate-none" />
        <Skeleton className="h-28 w-full rounded-lg py-0 motion-reduce:animate-none" />
      </div>
    );
  }
  return (
    <div className="space-y-6 px-6 py-6">
      <p className="text-muted-foreground text-sm text-pretty">{t('memoryDescription')}</p>
      {controls}
      <NoteComposer projectId={projectId} groupId={groupId} onDraftChange={onDraftChange} />
      <p className="text-muted-foreground border-t pt-4 text-sm">{t('memoryEmpty')}</p>
    </div>
  );
}

/**
 * How the space's memory keeps itself current: "Update automatically" (the
 * worker saves what finished sessions decided, learned and agreed; only whoever
 * manages the space turns it off), when it last ran, and "Update now".
 */
function AutoUpdateBar({ projectId, space }: { projectId: string; space: ProjectSessionGroup }) {
  const t = useTranslations('sessionSpaces.settings');
  const switchId = useId();
  const update = useUpdateWorkspaceSessionGroup(projectId);
  const refresh = useUpdateWorkspaceSessionGroupMemory(projectId);
  const canManage = space.can_manage === true;
  const pendingToggle = update.isPending && update.variables?.groupId === space.group_id;
  const auto = pendingToggle && update.variables?.input.memory_auto_update !== undefined
    ? update.variables.input.memory_auto_update
    : space.memory_auto_update !== false;
  const updatedAt = space.memory_updated_at ? new Date(space.memory_updated_at) : null;

  const toggle = (next: boolean) => {
    update.mutate(
      { groupId: space.group_id, input: { memory_auto_update: next } },
      { onError: () => errorToast(t('memoryAutoFailed')) },
    );
  };
  const runNow = () => {
    refresh.mutateAsync(space.group_id).then(
      (result) =>
        result.updated_pages > 0
          ? successToast(t('memoryUpdated', { count: result.updated_pages }))
          : successToast(t('memoryUpToDate')),
      () => errorToast(t('memoryUpdateFailed')),
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2.5">
        <Switch id={switchId} checked={auto} disabled={!canManage || pendingToggle} onCheckedChange={toggle} />
        <label htmlFor={switchId} className="text-foreground text-sm">
          {t('memoryAuto')}
        </label>
      </div>
      <span className="text-muted-foreground text-xs">
        {updatedAt ? t('memoryUpdatedAgo', { time: formatDistanceToNow(updatedAt, { addSuffix: true }) }) : t('memoryNeverUpdated')}
      </span>
      <Hint label={t('memoryUpdateHint')}>
        <Button variant="outline" size="sm" className="ml-auto gap-1.5" disabled={refresh.isPending} onClick={runNow}>
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {refresh.isPending ? <Loading className="size-3.5" /> : <ArrowsClockwiseIcon className="size-3.5" />}
          </span>
          {t('memoryUpdateNow')}
        </Button>
      </Hint>
    </div>
  );
}

/** One note for the space's memory, in the prompt input's shape. Enter saves; Shift+Enter starts a new line. */
function NoteComposer({
  projectId,
  groupId,
  onDraftChange,
}: {
  projectId: string;
  groupId: string;
  onDraftChange?: (hasDraft: boolean) => void;
}) {
  const t = useTranslations('sessionSpaces.settings');
  const tMemory = useTranslations('spaces.memory');
  const hintId = useId();
  const add = useAddWorkspaceMemoryNote(projectId, groupId);
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const hasDraft = text.trim().length > 0;
  useEffect(() => {
    onDraftChange?.(hasDraft);
  }, [hasDraft, onDraftChange]);
  // Unmounting (the first note became a page, or the dialog closed) leaves no draft behind.
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

  const save = () => {
    const note = text.trim();
    if (!note || add.isPending) return;
    // `mutateAsync`: the first note swaps this pane to the page list, which
    // unmounts the composer, and TanStack drops an unmounted caller's callbacks.
    add.mutateAsync({ text: note }).then(
      () => {
        setText('');
        successToast(tMemory('rememberThis.saved'));
      },
      (err) => setFailure((err instanceof ApiError && err.code && FAILURE_BY_CODE[err.code]) || 'failed'),
    );
  };

  return (
    <form
      className="bg-popover focus-within:border-ring duration-fast rounded-lg border transition-colors"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Textarea
        value={text}
        maxLength={NOTE_MAX}
        minHeight={72}
        maxHeight={240}
        aria-label={t('memoryLabel')}
        aria-invalid={failure ? true : undefined}
        aria-describedby={hintId}
        placeholder={t('memoryPlaceholder')}
        className="rounded-none border-0 bg-transparent px-3 pt-3 font-normal shadow-none focus:ring-0"
        onChange={(event) => {
          setText(event.target.value);
          setFailure(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
        <p id={hintId} role={failure ? 'alert' : undefined} className={failure ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
          {failure ? tMemory(`remember.status.${failure}`) : tMemory('remember.hint')}
        </p>
        <Button type="submit" size="sm" disabled={!text.trim() || add.isPending} aria-busy={add.isPending || undefined}>
          {add.isPending ? <Loading className="size-3.5 shrink-0" /> : null}
          {tMemory('remember.send')}
        </Button>
      </div>
    </form>
  );
}
