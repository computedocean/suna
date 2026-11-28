/**
 * Session groups (product word "Spaces") — named folders of a project's
 * sessions that every member shares, behind the `session_groups` flag. A
 * group has a description and instructions, its own memory layer (key = the
 * group id), and a session can be created in one (`group_id`). Spec: tests/spec/end-to-end.md
 * § 7b. Source of truth: apps/api/src/projects/routes/session-groups.ts +
 * projects/lib/session-groups.ts + the `group` filter of GET /sessions.
 */
import { randomUUID } from 'node:crypto';
import {
  MemoryLayerSchema,
  MemoryPageListSchema,
  MemoryPageSchema,
  OkResponseSchema,
  ProjectSessionSchema,
  SessionGroupAssignmentSchema,
  SessionGroupListSchema,
  SessionGroupSchema,
} from '@kortix/api-contract';
import { flow, flowMeta } from '../core/flow';
import { fail } from '../core/expect';
import type { FlowMeta } from '../core/types';
import { hasStorage, insertSession, openWorld } from '../fixtures/agent-principals';

const ROUTES = {
  list: 'GET /v1/projects/:projectId/session-groups',
  create: 'POST /v1/projects/:projectId/session-groups',
  update: 'PATCH /v1/projects/:projectId/session-groups/:groupId',
  remove: 'DELETE /v1/projects/:projectId/session-groups/:groupId',
  order: 'PUT /v1/projects/:projectId/session-groups/order',
  assign: 'PUT /v1/projects/:projectId/sessions/:sessionId/group',
  sharing: 'PUT /v1/projects/:projectId/session-groups/:groupId/sharing',
  tabs: 'PUT /v1/projects/:projectId/session-groups/:groupId/tabs',
  memoryUpdate: 'POST /v1/projects/:projectId/session-groups/:groupId/memory/update',
  sessionSharing: 'PUT /v1/projects/:projectId/sessions/:sessionId/sharing',
};
const MEMORY_ROUTES = {
  layer: 'GET /v1/projects/:projectId/memory/layers/:layerKey',
  pages: 'GET /v1/projects/:projectId/memory/layers/:layerKey/pages',
  create: 'POST /v1/projects/:projectId/memory/layers/:layerKey/pages',
  page: 'GET /v1/projects/:projectId/memory/pages/:pageId',
};
const LAYER = '/v1/workspaces/:projectId/memory/layers/:layerKey';
const LAYER_PAGES = '/v1/workspaces/:projectId/memory/layers/:layerKey/pages';
const MEMORY_PAGE = '/v1/workspaces/:projectId/memory/pages/:pageId';
const SESSION_ROUTES = {
  list: 'GET /v1/projects/:projectId/sessions',
  read: 'GET /v1/projects/:projectId/sessions/:sessionId',
  create: 'POST /v1/projects/:projectId/sessions',
};
const GROUPS = '/v1/workspaces/:projectId/session-groups';
const GROUP = '/v1/workspaces/:projectId/session-groups/:groupId';
const ORDER = '/v1/workspaces/:projectId/session-groups/order';
const SHARING = '/v1/workspaces/:projectId/session-groups/:groupId/sharing';
const TABS = '/v1/workspaces/:projectId/session-groups/:groupId/tabs';
const MEMORY_UPDATE = '/v1/workspaces/:projectId/session-groups/:groupId/memory/update';
const ASSIGN = '/v1/workspaces/:projectId/sessions/:sessionId/group';
const SESSIONS = '/v1/workspaces/:projectId/sessions';
const SESSION_SHARING = '/v1/workspaces/:projectId/sessions/:sessionId/sharing';
const SESSION = '/v1/workspaces/:projectId/sessions/:sessionId';

type Group = { group_id: string; name: string; description: string | null; position: number };
type Session = { session_id: string; group_id: string | null; updated_at: string };

flow('SGRP-1', flowMeta('session-groups', Object.values(ROUTES), { timeoutMs: 120_000 }), async (ctx) => {
  const { project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  try {
    await ctx.step('with session_groups off (the default), every session-groups route → 403 feature_disabled', async () => {
      const groupParams = { ...params, groupId: randomUUID() };
      for (const r of [
        await world.owner.get(GROUPS, { params }),
        await world.owner.post(GROUPS, { name: 'Store A' }, { params }),
        await world.owner.patch(GROUP, { name: 'Store B' }, { params: groupParams }),
        await world.owner.del(GROUP, { params: groupParams }),
        await world.owner.put(ORDER, { group_ids: [] }, { params }),
        await world.owner.put(ASSIGN, { group_id: null }, { params: { ...params, sessionId: randomUUID() } }),
        await world.owner.put(SHARING, { visibility: 'project' }, { params: groupParams }),
        await world.owner.put(TABS, { tabs: [] }, { params: groupParams }),
      ]) {
        r.status(403).body().has('$.code', 'feature_disabled').has('$.feature', 'session_groups');
      }
    });

    await ctx.step('the refused writes stored nothing: the project has no group row', async () => {
      const { rows } = await world.db.query('SELECT 1 FROM kortix.project_session_groups WHERE project_id = $1', [project.id]);
      if (rows.length !== 0) fail(`expected no groups, found ${rows.length}`);
    });

    await ctx.step('an anonymous caller → 401', async () => {
      (await ctx.client.as(ctx.P.ANON).get(GROUPS, { params })).status(401);
    });
  } finally {
    await world.close();
  }
});

flow('SGRP-2', flowMeta('session-groups', [ROUTES.list, ROUTES.create, ROUTES.update, ROUTES.remove, ROUTES.order, ROUTES.sharing], { timeoutMs: 120_000 }), async (ctx) => {
  const { team, project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  const member = await team.addMember('member');
  await team.grantProjectRole(project.id, member.userId!, 'member');
  const asMember = ctx.client.as(member);
  // Membership is access (design.md C3): the outsider is a person outside the workspace.
  const outsider = ctx.client.as(ctx.P.NONMEMBER);
  const ids: Record<string, string> = {};
  try {
    await world.setFeature('session_groups', true);

    await ctx.step('the owner creates Store A and Store B, a member creates Store C → 201 each, last in the order', async () => {
      for (const [client, name, position] of [
        [world.owner, '  Store A  ', 0],
        [world.owner, 'Store B', 1],
        [asMember, 'Store C', 2],
      ] as const) {
        const r = await client.post(GROUPS, { name }, { params });
        r.status(201).body().schema(SessionGroupSchema).has('$.name', name.trim()).has('$.position', position)
          .has('$.visibility', 'private').has('$.can_manage', true);
        ids[name.trim()] = r.json<Group>().group_id;
      }
    });

    await ctx.step('a new group is private to its creator: the owner lists A and B, the member only C', async () => {
      const names = async (client: typeof world.owner) =>
        (await client.get(GROUPS, { params })).status(200).json<{ groups: Group[] }>().groups.map((group) => group.name);
      if (JSON.stringify(await names(world.owner)) !== JSON.stringify(['Store A', 'Store B'])) fail('owner list', await names(world.owner));
      if (JSON.stringify(await names(asMember)) !== JSON.stringify(['Store C'])) fail('member list', await names(asMember));
    });

    await ctx.step('each creator shares theirs with the whole project → 200 visibility project', async () => {
      for (const [client, name] of [[world.owner, 'Store A'], [world.owner, 'Store B'], [asMember, 'Store C']] as const) {
        (await client.put(SHARING, { visibility: 'project' }, { params: { ...params, groupId: ids[name]! } }))
          .status(200).body().schema(SessionGroupSchema).has('$.visibility', 'project');
      }
    });

    await ctx.step('GET lists them in order for the owner and the member alike', async () => {
      for (const client of [world.owner, asMember]) {
        const r = await client.get(GROUPS, { params });
        r.status(200).body().schema(SessionGroupListSchema);
        const names = r.json<{ groups: Group[] }>().groups.map((group) => group.name);
        if (JSON.stringify(names) !== JSON.stringify(['Store A', 'Store B', 'Store C'])) fail('wrong order', names);
      }
    });

    await ctx.step('a name the project has in any case → 409 group_name_taken; a blank or 81-character name → 400', async () => {
      (await world.owner.post(GROUPS, { name: 'store a' }, { params })).status(409).body().has('$.code', 'group_name_taken');
      (await world.owner.post(GROUPS, { name: '   ' }, { params })).status(400);
      (await world.owner.post(GROUPS, { name: 'x'.repeat(81) }, { params })).status(400);
    });

    await ctx.step('an account member outside the project → 403/404 on list and create, and stores nothing', async () => {
      (await outsider.get(GROUPS, { params })).status([403, 404]);
      (await outsider.post(GROUPS, { name: 'Intruder' }, { params })).status([403, 404]);
      const { rows } = await world.db.query('SELECT 1 FROM kortix.project_session_groups WHERE project_id = $1', [project.id]);
      if (rows.length !== 3) fail(`expected 3 groups, found ${rows.length}`);
    });

    await ctx.step('a description is trimmed and stored; PATCH changes it alone, empty clears it; 2001 characters or an empty PATCH → 400', async () => {
      const r = await world.owner.post(GROUPS, { name: 'Launch', description: '  Ship the pricing page.  ' }, { params });
      r.status(201).body().schema(SessionGroupSchema).has('$.description', 'Ship the pricing page.');
      const launch = r.json<Group>().group_id;
      (await world.owner.patch(GROUP, { description: 'Ship it by Dec 1.' }, { params: { ...params, groupId: launch } }))
        .status(200).body().has('$.name', 'Launch').has('$.description', 'Ship it by Dec 1.');
      (await world.owner.patch(GROUP, { description: '' }, { params: { ...params, groupId: launch } })).status(200).body().has('$.description', null);
      (await world.owner.post(GROUPS, { name: 'Long', description: 'x'.repeat(2001) }, { params })).status(400);
      (await world.owner.patch(GROUP, {}, { params: { ...params, groupId: launch } })).status(400);
      (await world.owner.del(GROUP, { params: { ...params, groupId: launch } })).status(200);
    });

    await ctx.step('PATCH renames; a taken name → 409; an unknown or malformed id → 404 group_not_found', async () => {
      (await world.owner.patch(GROUP, { name: 'Store A (EU)' }, { params: { ...params, groupId: ids['Store A']! } }))
        .status(200).body().schema(SessionGroupSchema).has('$.name', 'Store A (EU)').has('$.position', 0);
      (await asMember.patch(GROUP, { name: 'STORE B' }, { params: { ...params, groupId: ids['Store C']! } }))
        .status(409).body().has('$.code', 'group_name_taken');
      for (const groupId of [randomUUID(), 'not-a-uuid']) {
        (await world.owner.patch(GROUP, { name: 'X' }, { params: { ...params, groupId } })).status(404).body().has('$.code', 'group_not_found');
      }
    });

    await ctx.step('PUT /order with every id once → 200 in the new order; a partial or foreign list → 409 group_order_stale and nothing moves', async () => {
      const order = [ids['Store C']!, ids['Store A']!, ids['Store B']!];
      const r = await asMember.put(ORDER, { group_ids: order }, { params });
      r.status(200).body().schema(SessionGroupListSchema);
      const got = r.json<{ groups: Group[] }>().groups.map((group) => [group.group_id, group.position]);
      if (JSON.stringify(got) !== JSON.stringify(order.map((id, i) => [id, i]))) fail('order not applied', got);
      (await world.owner.put(ORDER, { group_ids: order.slice(0, 2) }, { params })).status(409).body().has('$.code', 'group_order_stale');
      (await world.owner.put(ORDER, { group_ids: [...order.slice(0, 2), randomUUID()] }, { params }))
        .status(409).body().has('$.code', 'group_order_stale');
      (await world.owner.put(ORDER, { group_ids: [order[0], order[0], order[1]] }, { params })).status(400);
      const after = (await world.owner.get(GROUPS, { params })).json<{ groups: Group[] }>().groups.map((group) => group.group_id);
      if (JSON.stringify(after) !== JSON.stringify(order)) fail('a refused reorder moved groups', after);
    });

    await ctx.step('DELETE by someone who is not its creator → 403 group_manage_forbidden; by its creator → 200 {ok}; the rest close up; again → 404', async () => {
      (await asMember.del(GROUP, { params: { ...params, groupId: ids['Store A']! } })).status(403).body().has('$.code', 'group_manage_forbidden');
      (await world.owner.del(GROUP, { params: { ...params, groupId: ids['Store A']! } })).status(200).body().schema(OkResponseSchema);
      const groups = (await world.owner.get(GROUPS, { params })).json<{ groups: Group[] }>().groups;
      const got = groups.map((group) => [group.name, group.position]);
      if (JSON.stringify(got) !== JSON.stringify([['Store C', 0], ['Store B', 1]])) fail('positions did not close up', got);
      (await world.owner.del(GROUP, { params: { ...params, groupId: ids['Store A']! } })).status(404).body().has('$.code', 'group_not_found');
    });
  } finally {
    await world.close();
  }
});

flow('SGRP-3', flowMeta('session-groups', [ROUTES.create, ROUTES.sharing, ROUTES.assign, ROUTES.remove, SESSION_ROUTES.list, SESSION_ROUTES.read], { timeoutMs: 120_000 }), async (ctx) => {
  const { team, project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  const member = await team.addMember('member');
  await team.grantProjectRole(project.id, member.userId!, 'member');
  const asMember = ctx.client.as(member);
  const other = await team.project({ managedGit: true });
  try {
    await world.setFeature('session_groups', true);
    const store = (await world.owner.post(GROUPS, { name: 'Store A' }, { params })).status(201).json<Group>().group_id;
    (await world.owner.put(SHARING, { visibility: 'project' }, { params: { ...params, groupId: store } })).status(200);
    const shared = await insertSession(world, world.ownerUserId, 'project');
    const loose = await insertSession(world, world.ownerUserId, 'project');
    const hidden = await insertSession(world, world.ownerUserId, 'private');
    const readSession = async (sessionId: string) =>
      (await world.owner.get(SESSION, { params: { ...params, sessionId } })).status(200).json<Session>();
    const listIds = async (query: Record<string, string>) =>
      (await world.owner.get(SESSIONS, { params, query })).status(200).json<Session[]>().map((s) => s.session_id).sort();

    await ctx.step('a member files a project session into Store A → 200 {session_id, group_id}; its updated_at stays', async () => {
      const before = await readSession(shared);
      if (before.group_id !== null) fail('a new session is already in a group', before.group_id);
      (await asMember.put(ASSIGN, { group_id: store }, { params: { ...params, sessionId: shared } }))
        .status(200).body().schema(SessionGroupAssignmentSchema).has('$.session_id', shared).has('$.group_id', store);
      const after = await readSession(shared);
      if (after.group_id !== store) fail('GET /sessions/:id does not carry the group', after.group_id);
      if (after.updated_at !== before.updated_at) fail('filing moved updated_at', [before.updated_at, after.updated_at]);
    });

    await ctx.step('GET /sessions?group=<id> lists only its sessions, each with group_id; ?group=none leaves them out', async () => {
      const grouped = (await world.owner.get(SESSIONS, { params, query: { group: store } })).status(200);
      grouped.body().schema(ProjectSessionSchema.array());
      const rows = grouped.json<Session[]>();
      if (rows.length !== 1 || rows[0]!.session_id !== shared || rows[0]!.group_id !== store) fail('group list', rows);
      const none = await listIds({ group: 'none' });
      if (none.includes(shared) || !none.includes(loose)) fail('group=none', none);
      (await world.owner.get(SESSIONS, { params, query: { group: 'store-a' } })).status(400);
    });

    await ctx.step('GET /session-groups counts each space\'s sessions: Store A has 1, last active at its updated_at; a new empty space has 0 and null', async () => {
      const empty = (await world.owner.post(GROUPS, { name: 'Empty' }, { params })).status(201).json<Group>().group_id;
      const listed = (await world.owner.get(GROUPS, { params })).status(200).json<{ groups: Array<Group & { session_count?: number; last_activity_at?: string | null }> }>().groups;
      const a = listed.find((group) => group.group_id === store);
      const e = listed.find((group) => group.group_id === empty);
      const session = await readSession(shared);
      if (a?.session_count !== 1) fail('Store A session_count', a);
      if (!a?.last_activity_at || Date.parse(a.last_activity_at) !== Date.parse(session.updated_at)) fail('Store A last_activity_at', [a?.last_activity_at, session.updated_at]);
      if (e?.session_count !== 0 || e.last_activity_at !== null) fail('Empty space activity', e);
      (await world.owner.del(GROUP, { params: { ...params, groupId: empty } })).status(200);
    });

    await ctx.step("a session the member cannot see → 404; another project's group or an unknown one → 404 group_not_found", async () => {
      (await asMember.put(ASSIGN, { group_id: store }, { params: { ...params, sessionId: hidden } })).status(404);
      const foreign = randomUUID();
      await world.db.query(
        `INSERT INTO kortix.project_session_groups (group_id, account_id, project_id, name, position)
         VALUES ($1, $2, $3, 'Elsewhere', 0)`,
        [foreign, world.accountId, other.id],
      );
      for (const groupId of [foreign, randomUUID()]) {
        (await world.owner.put(ASSIGN, { group_id: groupId }, { params: { ...params, sessionId: loose } }))
          .status(404).body().has('$.code', 'group_not_found');
      }
      if ((await readSession(loose)).group_id !== null) fail('a refused filing changed the session');
      (await world.owner.put(ASSIGN, { group_id: store }, { params: { ...params, sessionId: randomUUID() } })).status(404);
    });

    await ctx.step('a session another session started stays with its parent: filing it → 400 group_child_session', async () => {
      const child = await insertSession(world, world.ownerUserId, 'project');
      await world.db.query('UPDATE kortix.project_sessions SET parent_session_id = $1 WHERE session_id = $2', [shared, child]);
      (await world.owner.put(ASSIGN, { group_id: store }, { params: { ...params, sessionId: child } }))
        .status(400).body().has('$.code', 'group_child_session');
      if ((await readSession(child)).group_id !== null) fail('a refused child was filed');
    });

    await ctx.step('group_id null takes the session out of its group', async () => {
      (await world.owner.put(ASSIGN, { group_id: store }, { params: { ...params, sessionId: loose } })).status(200);
      (await world.owner.put(ASSIGN, { group_id: null }, { params: { ...params, sessionId: loose } }))
        .status(200).body().has('$.group_id', null);
      if ((await readSession(loose)).group_id !== null) fail('null did not take the session out');
    });

    await ctx.step('with the flag off, ?group= is ignored (both sessions listed) and the session keeps its group_id', async () => {
      await world.setFeature('session_groups', false);
      const all = await listIds({ group: store });
      if (!all.includes(shared) || !all.includes(loose)) fail('flag off still filtered by group', all);
      const { rows } = await world.db.query<{ group_id: string | null }>('SELECT s.group_id FROM kortix.project_sessions s JOIN kortix.project_session_groups g ON g.group_id = s.group_id WHERE s.session_id = $1', [shared]);
      if (rows[0]?.group_id !== store) fail('flag off removed the filing');
      await world.setFeature('session_groups', true);
    });

    await ctx.step('deleting Store A leaves its session in no group', async () => {
      (await world.owner.del(GROUP, { params: { ...params, groupId: store } })).status(200);
      if ((await readSession(shared)).group_id !== null) fail('the session still names the deleted group');
    });
  } finally {
    await world.close();
  }
});

flow('SGRP-5', flowMeta('session-groups', [ROUTES.list, ROUTES.create, ROUTES.update, ROUTES.remove, ROUTES.sharing, ROUTES.assign, SESSION_ROUTES.list, SESSION_ROUTES.read], { timeoutMs: 120_000 }), async (ctx) => {
  const { team, project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  const ana = await team.addMember('member');
  await team.grantProjectRole(project.id, ana.userId!, 'member');
  const bob = await team.addMember('member');
  await team.grantProjectRole(project.id, bob.userId!, 'member');
  const asAna = ctx.client.as(ana);
  const asBob = ctx.client.as(bob);
  try {
    await world.setFeature('session_groups', true);
    const space = (await world.owner.post(GROUPS, { name: 'Board prep', description: 'December board meeting.' }, { params }))
      .status(201).json<Group>().group_id;
    const groupParams = { ...params, groupId: space };
    const filed = await insertSession(world, world.ownerUserId, 'private');
    const ownersOther = await insertSession(world, world.ownerUserId, 'private');
    (await world.owner.put(ASSIGN, { group_id: space }, { params: { ...params, sessionId: filed } })).status(200);
    const child = await insertSession(world, world.ownerUserId, 'private', { metadata: { spawned_by_session: filed } });
    const listedBy = async (client: typeof world.owner) =>
      (await client.get(SESSIONS, { params })).status(200).json<Session[]>().map((row) => row.session_id);
    const groupNames = async (client: typeof world.owner) =>
      (await client.get(GROUPS, { params })).status(200).json<{ groups: Group[] }>().groups.map((group) => group.name);

    await ctx.step('a private space says nothing to anyone else: not listed, its id → 404, its private sessions → 404 and not listed', async () => {
      if ((await groupNames(asAna)).includes('Board prep')) fail('a member lists the private space');
      (await asAna.patch(GROUP, { description: 'x' }, { params: groupParams })).status(404).body().has('$.code', 'group_not_found');
      (await asAna.put(SHARING, { visibility: 'project' }, { params: groupParams })).status(404);
      for (const sessionId of [filed, child]) (await asAna.get(SESSION, { params: { ...params, sessionId } })).status(404);
      if ((await listedBy(asAna)).some((id) => id === filed || id === child)) fail('a member lists a private session of the space');
    });

    await ctx.step('the owner shares it with Ana → 200 private, member_ids [Ana]; a non-member id → 400 not_a_member', async () => {
      (await world.owner.put(SHARING, { visibility: 'private', member_ids: [ana.userId] }, { params: groupParams }))
        .status(200).body().schema(SessionGroupSchema).has('$.visibility', 'private').has('$.member_ids[0]', ana.userId);
      (await world.owner.put(SHARING, { visibility: 'private', member_ids: [randomUUID()] }, { params: groupParams }))
        .status(400).body().has('$.code', 'not_a_member');
    });

    await ctx.step('Ana now lists the space and reads and lists its sessions, the child included; not the owner\'s other private session; Bob still nothing', async () => {
      if (!(await groupNames(asAna)).includes('Board prep')) fail('Ana does not list the shared space');
      for (const sessionId of [filed, child]) (await asAna.get(SESSION, { params: { ...params, sessionId } })).status(200);
      const listed = await listedBy(asAna);
      if (!listed.includes(filed) || !listed.includes(child)) fail('Ana does not list the space sessions', listed);
      if (listed.includes(ownersOther)) fail('the space shared a session outside it');
      (await asAna.get(SESSION, { params: { ...params, sessionId: ownersOther } })).status(404);
      if ((await groupNames(asBob)).includes('Board prep')) fail('Bob lists a space not shared with him');
      (await asBob.get(SESSION, { params: { ...params, sessionId: filed } })).status(404);
    });

    await ctx.step('Ana edits the description (200) but may not share or delete it (403 group_manage_forbidden)', async () => {
      (await asAna.patch(GROUP, { description: 'Deck due Dec 1.' }, { params: groupParams })).status(200).body().has('$.description', 'Deck due Dec 1.').has('$.can_manage', false);
      (await asAna.put(SHARING, { visibility: 'project' }, { params: groupParams })).status(403).body().has('$.code', 'group_manage_forbidden');
      (await asAna.del(GROUP, { params: groupParams })).status(403).body().has('$.code', 'group_manage_forbidden');
    });

    await ctx.step("Ana may not move the owner's private session out (403 group_share_forbidden); her own private session filed there is shared with the owner", async () => {
      (await asAna.put(ASSIGN, { group_id: null }, { params: { ...params, sessionId: filed } })).status(403).body().has('$.code', 'group_share_forbidden');
      const anasOwn = await insertSession(world, ana.userId!, 'private');
      (await asAna.put(ASSIGN, { group_id: space }, { params: { ...params, sessionId: anasOwn } })).status(200);
      (await world.owner.get(SESSION, { params: { ...params, sessionId: anasOwn } })).status(200);
    });

    await ctx.step('everyone in the workspace: Bob lists the space and reads its sessions', async () => {
      (await world.owner.put(SHARING, { visibility: 'project' }, { params: groupParams })).status(200).body().has('$.visibility', 'project').has('$.member_ids.length', 0);
      if (!(await groupNames(asBob)).includes('Board prep')) fail('Bob does not list a project space');
      (await asBob.get(SESSION, { params: { ...params, sessionId: filed } })).status(200);
    });

    await ctx.step('back to only the owner: Ana and Bob lose the space and its sessions at once', async () => {
      (await world.owner.put(SHARING, { visibility: 'private', member_ids: [] }, { params: groupParams })).status(200);
      for (const client of [asAna, asBob]) {
        if ((await groupNames(client)).includes('Board prep')) fail('a person still lists an unshared space');
        (await client.get(SESSION, { params: { ...params, sessionId: filed } })).status(404);
        if ((await listedBy(client)).includes(filed)) fail('a person still lists a session of an unshared space');
      }
    });

    await ctx.step('with session_groups off a shared space shares nothing: Ana loses its sessions', async () => {
      (await world.owner.put(SHARING, { visibility: 'private', member_ids: [ana.userId] }, { params: groupParams })).status(200);
      (await asAna.get(SESSION, { params: { ...params, sessionId: filed } })).status(200);
      await world.setFeature('session_groups', false);
      (await asAna.get(SESSION, { params: { ...params, sessionId: filed } })).status(404);
      if ((await listedBy(asAna)).includes(filed)) fail('flag off still lists a space session');
      await world.setFeature('session_groups', true);
    });
  } finally {
    await world.close();
  }
});

flow('SGRP-6', flowMeta('session-groups', [ROUTES.create, ROUTES.tabs, ROUTES.sharing, ROUTES.list], { timeoutMs: 120_000 }), async (ctx) => {
  const { team, project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  const ana = await team.addMember('member');
  await team.grantProjectRole(project.id, ana.userId!, 'member');
  try {
    await world.setFeature('session_groups', true);
    const space = (await world.owner.post(GROUPS, { name: 'Launch' }, { params })).status(201).json<Group>().group_id;
    const groupParams = { ...params, groupId: space };
    const tabs = [
      { id: 'plan', title: 'Plan', kind: 'file', ref: `/Spaces/${space}/plan.md` },
      { id: 'assets', title: 'Assets', kind: 'folder', ref: `/Spaces/${space}/assets` },
      { id: 'site', title: 'Site', kind: 'link', ref: 'https://example.com/' },
    ];

    await ctx.step('PUT tabs stores the ordered list; the list read returns it', async () => {
      (await world.owner.put(TABS, { tabs }, { params: groupParams })).status(200).body().schema(SessionGroupSchema)
        .has('$.tabs.length', 3).has('$.tabs[0].id', 'plan').has('$.tabs[2].kind', 'link');
      const listed = (await world.owner.get(GROUPS, { params })).json<{ groups: Array<Group & { tabs: Array<{ id: string }> }> }>().groups;
      if (JSON.stringify(listed.find((group) => group.group_id === space)?.tabs.map((tab) => tab.id)) !== JSON.stringify(['plan', 'assets', 'site'])) fail('tabs not stored in order');
    });

    await ctx.step('an http link, a relative path, a repeated id or 21 tabs → 400; the stored tabs do not change', async () => {
      for (const bad of [
        [{ id: 'x', title: 'X', kind: 'link', ref: 'http://example.com/' }],
        [{ id: 'x', title: 'X', kind: 'file', ref: 'plan.md' }],
        [tabs[0], tabs[0]],
        Array.from({ length: 21 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, kind: 'link', ref: 'https://example.com/' })),
      ]) {
        (await world.owner.put(TABS, { tabs: bad }, { params: groupParams })).status(400);
      }
    });

    await ctx.step('someone the space is not shared with → 404; once shared, they reorder the tabs → 200', async () => {
      const asAna = ctx.client.as(ana);
      (await asAna.put(TABS, { tabs: [] }, { params: groupParams })).status(404);
      (await world.owner.put(SHARING, { visibility: 'private', member_ids: [ana.userId] }, { params: groupParams })).status(200);
      (await asAna.put(TABS, { tabs: [tabs[2], tabs[0], tabs[1]] }, { params: groupParams })).status(200).body().has('$.tabs[0].id', 'site');
    });
  } finally {
    await world.close();
  }
});

flow('SGRP-7', flowMeta('session-groups', [ROUTES.create, ROUTES.list, ROUTES.remove, SESSION_ROUTES.read, 'PATCH /v1/accounts/:accountId/iam/session-oversight'], { timeoutMs: 120_000 }), async (ctx) => {
  const { team, project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  const admin = await team.addMember('admin');
  const asAdmin = ctx.client.as(admin);
  try {
    await world.setFeature('session_groups', true);
    const space = (await world.owner.post(GROUPS, { name: 'Payroll' }, { params })).status(201).json<Group>().group_id;
    const filed = await insertSession(world, world.ownerUserId, 'private');
    (await world.owner.put(ASSIGN, { group_id: space }, { params: { ...params, sessionId: filed } })).status(200);
    const listsPayroll = async () =>
      (await asAdmin.get(GROUPS, { params })).status(200).json<{ groups: Group[] }>().groups.some((group) => group.group_id === space);

    await ctx.step('with account session oversight off, an admin does not see a private space or its sessions', async () => {
      if (await listsPayroll()) fail('an admin lists a private space without oversight');
      (await asAdmin.get(SESSION, { params: { ...params, sessionId: filed } })).status(404);
      (await asAdmin.del(GROUP, { params: { ...params, groupId: space } })).status(404);
    });

    await ctx.step('with oversight on (the owner turns it on), the admin sees it and its session, and may manage it', async () => {
      (await world.owner.patch('/v1/accounts/:accountId/iam/session-oversight', { enabled: true }, { params: { accountId: team.id } }))
        .status(200).body().has('$.enabled', true);
      if (!(await listsPayroll())) fail('an admin under oversight does not list the private space');
      (await asAdmin.get(SESSION, { params: { ...params, sessionId: filed } })).status(200);
      const listed = (await asAdmin.get(GROUPS, { params })).json<{ groups: Array<Group & { can_manage: boolean }> }>().groups;
      if (listed.find((group) => group.group_id === space)?.can_manage !== true) fail('an admin under oversight may not manage the space');
    });
  } finally {
    await world.close();
  }
});

// SGRP-4 needs the session create route to answer, which needs a sandbox
// provider and a reachable KORTIX_URL; the local profile answers 503.
const createMeta = (routes: string[]): FlowMeta => ({
  domain: 'session-groups',
  requires: ['database', 'sandbox'],
  timeoutMs: 300_000,
  routes,
});

flow('SGRP-4', createMeta([ROUTES.create, SESSION_ROUTES.create, SESSION_ROUTES.list]), async (ctx) => {
  const { project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  try {
    await world.setFeature('session_groups', true);
    await world.fund();
    const space = (await world.owner.post(GROUPS, { name: 'Q4 launch' }, { params })).status(201).json<Group>().group_id;
    let sessionId = '';

    await ctx.step('create a session with group_id → 201, group_id is the space; ?group=<id> lists it', async () => {
      const r = await world.owner.post(SESSIONS, { group_id: space, initial_prompt: 'ke2e: noop' }, { params });
      r.status(201).body().schema(ProjectSessionSchema).has('$.group_id', space);
      sessionId = r.json<Session>().session_id;
      ctx.track('session', sessionId, { projectId: project.id });
      const ids = (await world.owner.get(SESSIONS, { params, query: { group: space } })).status(200).json<Session[]>().map((s) => s.session_id);
      if (!ids.includes(sessionId)) fail('the new session is not in its space list', ids);
    });

    await ctx.step('an unknown group_id → 404 group_not_found and no session', async () => {
      (await world.owner.post(SESSIONS, { group_id: randomUUID(), initial_prompt: 'ke2e: noop' }, { params }))
        .status(404).body().has('$.code', 'group_not_found');
    });
  } finally {
    await world.close();
  }
});

flow('SGRP-8', flowMeta('session-groups', [ROUTES.create, ROUTES.update, ROUTES.list, ROUTES.sharing, ROUTES.memoryUpdate, ROUTES.sessionSharing, ROUTES.assign, ...Object.values(MEMORY_ROUTES)], { timeoutMs: 120_000 }), async (ctx) => {
  const { team, project, world } = await openWorld(ctx);
  const params = { projectId: project.id };
  const ana = await team.addMember('member');
  await team.grantProjectRole(project.id, ana.userId!, 'member');
  const bob = await team.addMember('member');
  await team.grantProjectRole(project.id, bob.userId!, 'member');
  const asAna = ctx.client.as(ana);
  const asBob = ctx.client.as(bob);
  try {
    await world.setFeature('session_groups', true);

    await ctx.step('instructions are created with a space, trimmed, PATCHed alone, read back in the list; empty clears them; 8001 characters → 400', async () => {
      const r = await world.owner.post(GROUPS, { name: 'Docs', instructions: '  Answer in German.  ' }, { params });
      r.status(201).body().schema(SessionGroupSchema).has('$.instructions', 'Answer in German.').has('$.description', null);
      const groupParams = { ...params, groupId: r.json<Group>().group_id };
      (await world.owner.patch(GROUP, { instructions: 'Cite the source of every number.' }, { params: groupParams }))
        .status(200).body().schema(SessionGroupSchema).has('$.name', 'Docs').has('$.instructions', 'Cite the source of every number.');
      const listed = (await world.owner.get(GROUPS, { params })).status(200).json<{ groups: Array<Group & { instructions: string | null }> }>().groups;
      if (listed.find((g) => g.group_id === groupParams.groupId)?.instructions !== 'Cite the source of every number.') fail('the list does not read the instructions back', listed);
      (await world.owner.patch(GROUP, { instructions: 'x'.repeat(8001) }, { params: groupParams })).status(400);
      (await world.owner.patch(GROUP, { instructions: '' }, { params: groupParams })).status(200).body().has('$.instructions', null);
      const { rows } = await world.db.query('SELECT instructions FROM kortix.project_session_groups WHERE group_id = $1', [groupParams.groupId]);
      if (rows[0]?.instructions !== null) fail('cleared instructions are still stored', rows);
    });

    const space = (await world.owner.post(GROUPS, { name: 'Board memory' }, { params })).status(201).json<Group>().group_id;
    (await world.owner.put(SHARING, { visibility: 'private', member_ids: [ana.userId] }, { params: { ...params, groupId: space } })).status(200);
    const layer = { params: { ...params, layerKey: space } };

    await ctx.step('the space memory layer: scope channel, no space_id, its name, folder /Spaces/<id>/Memory, writable by its creator and by a member it is shared with', async () => {
      for (const client of [world.owner, asAna]) {
        (await client.get(LAYER, layer)).status(200).body().schema(MemoryLayerSchema)
          .has('$.layer_id', space).has('$.scope', 'channel').has('$.space_id', null).has('$.name', 'Board memory')
          .has('$.folder', `/Spaces/${space}/Memory`).has('$.can_write', true);
      }
    });

    await ctx.step('a member the space is not shared with → 404 memory_not_found on the layer, its pages and create', async () => {
      (await asBob.get(LAYER, layer)).status(404).body().has('$.code', 'memory_not_found');
      (await asBob.get(LAYER_PAGES, layer)).status(404).body().has('$.code', 'memory_not_found');
      (await asBob.post(LAYER_PAGES, { type: 'other', title: 'Intruder' }, layer)).status(404).body().has('$.code', 'memory_not_found');
    });

    await ctx.step('with session_groups off the space memory layer → 404 memory_not_found', async () => {
      await world.setFeature('session_groups', false);
      (await world.owner.get(LAYER, layer)).status(404).body().has('$.code', 'memory_not_found');
      await world.setFeature('session_groups', true);
    });

    const spaceParams = { params: { ...params, groupId: space } };
    await ctx.step('automatic memory: on by default with no update yet; its creator turns it off (PATCH alone, read back in the list and stored) and on again', async () => {
      (await world.owner.get(GROUPS, { params })).status(200).body().schema(SessionGroupListSchema);
      const before = (await world.owner.get(GROUPS, { params })).json<{ groups: Array<Group & { memory_auto_update: boolean; memory_updated_at: string | null }> }>().groups.find((g) => g.group_id === space);
      if (before?.memory_auto_update !== true || before.memory_updated_at !== null) fail('a new space is not on with no update', before);
      (await world.owner.patch(GROUP, { memory_auto_update: false }, spaceParams)).status(200).body().schema(SessionGroupSchema).has('$.memory_auto_update', false).has('$.name', 'Board memory');
      const listed = (await world.owner.get(GROUPS, { params })).json<{ groups: Array<Group & { memory_auto_update: boolean }> }>().groups.find((g) => g.group_id === space);
      if (listed?.memory_auto_update !== false) fail('the list does not read memory_auto_update back', listed);
      const { rows } = await world.db.query('SELECT memory_auto_update FROM kortix.project_session_groups WHERE group_id = $1', [space]);
      if (rows[0]?.memory_auto_update !== false) fail('memory_auto_update is not stored', rows);
      (await world.owner.patch(GROUP, { memory_auto_update: 'no' }, spaceParams)).status(400);
      (await world.owner.patch(GROUP, { memory_auto_update: true }, spaceParams)).status(200).body().has('$.memory_auto_update', true);
    });

    await ctx.step('a member it is shared with cannot turn automatic memory off → 403 group_manage_forbidden, nothing changes; a member it is not shared with → 404', async () => {
      (await asAna.patch(GROUP, { memory_auto_update: false }, spaceParams)).status(403).body().has('$.code', 'group_manage_forbidden');
      (await asBob.patch(GROUP, { memory_auto_update: false }, spaceParams)).status(404).body().has('$.code', 'group_not_found');
      const { rows } = await world.db.query('SELECT memory_auto_update FROM kortix.project_session_groups WHERE group_id = $1', [space]);
      if (rows[0]?.memory_auto_update !== true) fail('a refused PATCH changed memory_auto_update', rows);
    });

    await ctx.step('POST memory/update: a member it is not shared with → 404 group_not_found; with session_groups off → 403 feature_disabled', async () => {
      (await asBob.post(MEMORY_UPDATE, {}, spaceParams)).status(404).body().has('$.code', 'group_not_found');
      await world.setFeature('session_groups', false);
      (await world.owner.post(MEMORY_UPDATE, {}, spaceParams)).status(403).body().has('$.code', 'feature_disabled');
      await world.setFeature('session_groups', true);
    });

    if (!(await hasStorage(world))) {
      await ctx.step('no drive storage on this target: creating a space memory page → 503 drive_storage_unavailable', async () => {
        (await asAna.post(LAYER_PAGES, { type: 'decisions', title: 'Board deck format' }, layer)).status(503).body().has('$.code', 'drive_storage_unavailable');
      });
    }

    // With no session in the space nothing is read and the Drive is never touched, with or without storage.
    await ctx.step('POST memory/update with no session in the space: 200, nothing read or written, memory_updated_at is the run time (stored, read back in the list); a member it is shared with may run it; no lease is left behind', async () => {
      for (const client of [world.owner, asAna]) {
        const r = await client.post(MEMORY_UPDATE, {}, spaceParams);
        r.status(200).body().has('$.updated_pages', 0).has('$.sessions', 0);
        const done = r.json<{ memory_updated_at: string | null }>();
        if (!done.memory_updated_at || Number.isNaN(Date.parse(done.memory_updated_at))) fail('memory_updated_at is not the run time', done);
      }
      const { rows } = await world.db.query('SELECT memory_updated_at, memory_update_lease_until FROM kortix.project_session_groups WHERE group_id = $1', [space]);
      if (rows[0]?.memory_updated_at === null) fail('memory_updated_at is not stored', rows);
      if (rows[0]?.memory_update_lease_until !== null) fail('the update left its lease behind', rows);
      const listed = (await world.owner.get(GROUPS, { params })).json<{ groups: Array<Group & { memory_updated_at: string | null }> }>().groups.find((g) => g.group_id === space);
      if (!listed?.memory_updated_at) fail('the list does not read memory_updated_at back', listed);
    });

    await ctx.step('POST memory/update while another update holds the space lease → 409 memory_update_running; once the lease expires it runs again', async () => {
      await world.db.query("UPDATE kortix.project_session_groups SET memory_update_lease_until = now() + interval '5 minutes' WHERE group_id = $1", [space]);
      (await world.owner.post(MEMORY_UPDATE, {}, spaceParams)).status(409).body().has('$.code', 'memory_update_running');
      await world.db.query("UPDATE kortix.project_session_groups SET memory_update_lease_until = now() - interval '1 second' WHERE group_id = $1", [space]);
      (await world.owner.post(MEMORY_UPDATE, {}, spaceParams)).status(200);
    });

    await ctx.step('a session of a private space (and a child of it) stays private: sharing it with the project or named people → 409 space_session_private and nothing changes; narrowing to private → 200', async () => {
      const own = await insertSession(world, world.ownerUserId, 'private');
      await world.db.query('UPDATE kortix.project_sessions SET group_id = $2 WHERE session_id = $1', [own, space]);
      const child = await insertSession(world, world.ownerUserId, 'private');
      await world.db.query('UPDATE kortix.project_sessions SET parent_session_id = $2 WHERE session_id = $1', [child, own]);
      for (const sessionId of [own, child]) {
        for (const body of [{ mode: 'project' }, { mode: 'members', memberIds: [ana.userId] }]) {
          (await world.owner.put(SESSION_SHARING, body, { params: { ...params, sessionId } })).status(409).body().has('$.code', 'space_session_private');
        }
        const { rows } = await world.db.query('SELECT visibility::text AS v FROM kortix.project_sessions WHERE session_id = $1', [sessionId]);
        if (rows[0]?.v !== 'private') fail('a refused sharing change was stored', rows);
        (await world.owner.put(SESSION_SHARING, { mode: 'private' }, { params: { ...params, sessionId } })).status(200);
      }
    });

    await ctx.step('a session shared with the project is not filed into a private space → 409 space_session_private; a private one is (200)', async () => {
      const shared = await insertSession(world, world.ownerUserId, 'project');
      (await world.owner.put(ASSIGN, { group_id: space }, { params: { ...params, sessionId: shared } })).status(409).body().has('$.code', 'space_session_private');
      const { rows } = await world.db.query('SELECT group_id FROM kortix.project_sessions WHERE session_id = $1', [shared]);
      if (rows[0]?.group_id !== null) fail('a refused filing was stored', rows);
      const mine = await insertSession(world, world.ownerUserId, 'private');
      (await world.owner.put(ASSIGN, { group_id: space }, { params: { ...params, sessionId: mine } })).status(200).body().has('$.group_id', space);
    });

    await ctx.step('a session of the space with an impossible stored sync mark (month 99) does not break the update: POST memory/update → 200, and the mark is still unread', async () => {
      const odd = await insertSession(world, world.ownerUserId, 'private', {
        metadata: { space_memory_synced_seq: 5, space_memory_synced_at: '2026-99-28T11:00:00.000Z' },
      });
      await world.db.query('UPDATE kortix.project_session_groups SET memory_update_lease_until = NULL WHERE group_id = $1', [space]);
      await world.db.query('UPDATE kortix.project_sessions SET group_id = $2 WHERE session_id = $1', [odd, space]);
      (await world.owner.post(MEMORY_UPDATE, {}, spaceParams)).status(200);
    });

    if (!(await hasStorage(world))) return;

    await ctx.step('a member it is shared with creates a page (201, the Memory folder is made), the creator lists it and reads it back; a non-member → 404', async () => {
      const created = await asAna.post(LAYER_PAGES, { type: 'decisions', title: 'Board deck format', body: 'Ten slides at most.' }, layer);
      created.status(201).body().schema(MemoryPageSchema).has('$.title', 'Board deck format').has('$.path', `/Spaces/${space}/Memory/decisions/board-deck-format.md`);
      const pageId = created.json<{ page_id: string }>().page_id;
      const pages = (await world.owner.get(LAYER_PAGES, layer)).status(200).body().schema(MemoryPageListSchema).json<{ pages: Array<{ page_id: string }> }>().pages;
      if (!pages.some((page) => page.page_id === pageId)) fail('the new page is not listed', pages);
      (await world.owner.get(MEMORY_PAGE, { params: { ...params, pageId } })).status(200).body().has('$.body', 'Ten slides at most.').has('$.can_edit', true);
      (await asBob.get(MEMORY_PAGE, { params: { ...params, pageId } })).status(404);
    });
  } finally {
    await world.close();
  }
});
