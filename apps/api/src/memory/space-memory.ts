/**
 * A Space's (session group's) memory folder, `/Spaces/<group_id>/Memory`, as
 * the turn brief lists it (`sessionSpaceBrief`): one Drive folder list, titles
 * from file names (no file is read), newest first. The memory routes reach the
 * same folder as the layer keyed by the group id (`resolveLayer`).
 */
import { sessionGroupDriveFolder } from '@kortix/shared';
import { MEMORY_DIR_NAME } from '../drives/folders';
import { findProjectDrive } from '../drives/service';
import { layerFiles, titleFromName } from './files';
import { volumeOps } from './volume-ops';

/** The space memory files, newest first, with titles from their names; null when the project has no Drive or storage is off. */
export async function spaceMemoryFiles(projectId: string, groupId: string): Promise<Array<{ rel: string; title: string }> | null> {
  const folder = sessionGroupDriveFolder(groupId);
  if (!folder || !volumeOps().available()) return null;
  const drive = await findProjectDrive(projectId);
  if (!drive) return null;
  const { pages } = await layerFiles({
    key: groupId,
    scope: 'channel',
    spaceId: null,
    name: groupId,
    projectId,
    drive,
    root: `${folder}/${MEMORY_DIR_NAME}`,
    agentFolder: null,
    skip: [],
    readOnly: true,
    canWrite: false,
    isDefault: false,
  });
  return pages.map((page) => ({ rel: page.rel, title: titleFromName(page.rel) }));
}
