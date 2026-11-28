import { describe, expect, test } from 'bun:test';
import { spaceFolderMountable } from '../../shared/session-group-access';
import { privateSpaceCreateSharing, sessionOwnerSeesGroup, turnSeesGroup } from './session-group-viewer';

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const CREATOR = '00000000-0000-4000-8000-0000000000c1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000ac';
const privateSpace = { visibility: 'private', createdBy: CREATOR };
const never = async () => {
  throw new Error('oversight must not be read');
};

describe('sessionOwnerSeesGroup: a session keeps its Space only while its owner sees it', () => {
  test('a member of a private Space sees it, without reading oversight', async () => {
    expect(await sessionOwnerSeesGroup(privateSpace, OWNER, true, ACCOUNT, never)).toBe(true);
  });

  test('the Space creator and a project-wide Space are seen without reading oversight', async () => {
    expect(await sessionOwnerSeesGroup(privateSpace, CREATOR, false, ACCOUNT, never)).toBe(true);
    expect(await sessionOwnerSeesGroup({ visibility: 'project', createdBy: CREATOR }, OWNER, false, ACCOUNT, never)).toBe(true);
  });

  test('an owner removed from a private Space no longer sees it', async () => {
    expect(await sessionOwnerSeesGroup(privateSpace, OWNER, false, ACCOUNT, async () => false)).toBe(false);
  });

  test('an owner or admin under session oversight still sees it', async () => {
    expect(await sessionOwnerSeesGroup(privateSpace, OWNER, false, ACCOUNT, async () => true)).toBe(true);
  });

  test('a session no person started keeps its Space', async () => {
    expect(await sessionOwnerSeesGroup(privateSpace, null, false, ACCOUNT, never)).toBe(true);
  });
});

describe('turnSeesGroup: the person prompting the turn must see the Space too', () => {
  const PROMPTER = '00000000-0000-4000-8000-0000000000b2';
  const who = (over: Partial<Parameters<typeof turnSeesGroup>[1]>) => ({
    ownerId: OWNER, ownerIsMember: true, prompterId: null, prompterIsMember: false, accountId: ACCOUNT, ...over,
  });

  test('a member outside a private Space prompting a session filed in it: no Space for that turn', async () => {
    expect(await turnSeesGroup(privateSpace, who({ prompterId: PROMPTER }), async () => false)).toBe(false);
  });

  test('a prompter who is a member, or the owner prompting their own session: the Space shows, oversight never read', async () => {
    expect(await turnSeesGroup(privateSpace, who({ prompterId: PROMPTER, prompterIsMember: true }), never)).toBe(true);
    expect(await turnSeesGroup(privateSpace, who({ prompterId: OWNER }), never)).toBe(true);
  });

  test('no person behind the turn (sandbox-authored, automation): the owner rule alone', async () => {
    expect(await turnSeesGroup(privateSpace, who({}), never)).toBe(true);
    expect(await turnSeesGroup(privateSpace, who({ ownerIsMember: false }), async () => false)).toBe(false);
  });

  test('a removed owner hides the Space even from a prompter who sees it', async () => {
    expect(await turnSeesGroup(privateSpace, who({ ownerIsMember: false, prompterId: PROMPTER, prompterIsMember: true }), async () => false)).toBe(false);
  });

  test('a project-wide Space shows to any prompter', async () => {
    expect(await turnSeesGroup({ visibility: 'project', createdBy: CREATOR }, who({ prompterId: PROMPTER }), never)).toBe(true);
  });
});

describe('spaceFolderMountable: a private Space\'s folder mounts only in a session that reaches no one beyond its owner', () => {
  const mount = (groupVisibility: string, sessionVisibility: string | null, parentVisibility: string | null = null) =>
    spaceFolderMountable({ groupVisibility, sessionVisibility, parentVisibility });

  test('a private Space: a private session mounts it; a project-visible or restricted one does not', () => {
    expect(mount('private', 'private')).toBe(true);
    expect(mount('private', 'project')).toBe(false);
    expect(mount('private', 'restricted')).toBe(false);
  });

  test('a child of a private Space mounts it only while its parent is private too', () => {
    expect(mount('private', 'private', 'private')).toBe(true);
    expect(mount('private', 'private', 'project')).toBe(false);
  });

  test('a project-visible Space keeps today\'s behavior: every session of it mounts it', () => {
    expect(mount('project', 'project')).toBe(true);
    expect(mount('project', 'restricted', 'project')).toBe(true);
  });
});

describe('privateSpaceCreateSharing: a new session in a private Space (or a child of one) is private', () => {
  test('explicit or channel-implied project or restricted sharing is refused', () => {
    expect(privateSpaceCreateSharing(true, 'project')).toBe('refuse');
    expect(privateSpaceCreateSharing(true, 'restricted')).toBe('refuse');
  });
  test('no sharing asked, or private: made private', () => {
    expect(privateSpaceCreateSharing(true, null)).toBe('private');
    expect(privateSpaceCreateSharing(true, 'private')).toBe('private');
  });
  test('outside a private Space the rule says nothing', () => {
    expect(privateSpaceCreateSharing(false, 'project')).toBeNull();
  });
});
