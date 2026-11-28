import { expect, test } from 'bun:test';
import { KORTIX_PERMISSION_GROUPS, expandKortixPermissionGroup } from '@kortix/manifest-schema';
import { HUMAN_ONLY } from '@kortix/shared/workspace-actions';
import { agentMayPerform, canonicalizeGrantActions } from '../iam/agent-scope';
import { agentPrincipalDecision } from '../iam/agent-principal';
import { extractAgents, grantFromLoadedAgents } from '../projects/agents';
import { parseManifestString } from '../projects/triggers';
import { findGrantEscalation, grantAdditions } from '../iam/agent-grant-ceiling';

const grant = (permissions: string[]) => ({ agent: 'worker', permissions, connectors: [] });

test('every registered group resolves through the manifest adapter and authorizes only its grantable members', () => {
  for (const group of KORTIX_PERMISSION_GROUPS) {
    const loaded = extractAgents(parseManifestString(`agents:\n  worker:\n    kortix_permissions: [${group}]\n`));
    expect(loaded.errors).toEqual([]);
    const resolved = canonicalizeGrantActions(grantFromLoadedAgents('worker', loaded));
    const members = expandKortixPermissionGroup(group);
    expect(members.length).toBeGreaterThan(0);
    expect(resolved?.permissions).toEqual([...members]);
    for (const member of members) expect(agentMayPerform(resolved, member)).toBe(true);
    for (const human of HUMAN_ONLY) expect(agentMayPerform(resolved, human)).toBe(false);
  }
});

test('nested groups, short session group, mixed exact grants and segment boundaries', () => {
  const sessions = grant(['session.*', 'billing.read']);
  expect(agentMayPerform(sessions, 'workspace.session.start')).toBe(true);
  expect(agentMayPerform(sessions, 'project.session.bindings.write')).toBe(true);
  expect(agentMayPerform(sessions, 'billing.read')).toBe(true);
  expect(agentMayPerform(sessions, 'project.sessions.start')).toBe(false);
  expect(agentMayPerform(sessions, 'project.trigger.create')).toBe(false);
  expect(agentMayPerform(grant(['workspace.session.bindings.*']), 'project.session.start')).toBe(false);
  expect(agentMayPerform(grant(['workspace.session.bindings.*']), 'project.session.bindings.write')).toBe(true);
  expect(agentMayPerform(grant(['project.session.start']), 'project.session.stop')).toBe(false);
  expect(agentMayPerform(grant(['sessions.*']), 'project.session.start')).toBe(false);
});

test('group grants cannot bypass ceiling, human-only exclusions or workspace binding', () => {
  const input = { action: 'project.session.start', scope: 'project' as const, targetProjectId: 'workspace-a', tokenProjectId: 'workspace-a', grant: grant(['workspace.*']), ceilingAllows: () => true };
  expect(agentPrincipalDecision(input).allowed).toBe(true);
  expect(agentPrincipalDecision({ ...input, ceilingAllows: () => false })).toEqual({ allowed: false, reason: 'agent_ceiling_insufficient' });
  expect(agentPrincipalDecision({ ...input, targetProjectId: 'workspace-b' })).toEqual({ allowed: false, reason: 'token_out_of_scope' });
  expect(agentPrincipalDecision({ ...input, scope: 'account', accountInScope: false, action: 'billing.read' }).allowed).toBe(false);
  for (const action of HUMAN_ONLY) expect(agentPrincipalDecision({ ...input, action }).allowed).toBe(false);
});

test('grant writes compare expanded leaves rather than allowing a wildcard to hide escalation', () => {
  const added = grantAdditions(grant(['project.session.read']), grant(['session.*']));
  expect(added.permissions).toContain('project.session.start');
  expect(added.permissions).not.toContain('project.session.read');
  expect(added.permissions).not.toContain('session.*');
});


test('workspace wildcard is not a global sentinel, and global and exact grants stay compatible', () => {
  expect(agentMayPerform(grant(['workspace.*']), 'unknown.read')).toBe(false);
  expect(agentMayPerform(grant(['workspace.*']), 'project.credentials.issue')).toBe(false);
  for (const spelling of ['"*"', '"all"', '["*", "session.*"]']) {
    const loaded = extractAgents(parseManifestString(`agents:\n  worker:\n    kortix_permissions: ${spelling}\n`));
    expect(grantFromLoadedAgents('worker', loaded)?.permissions).toBe('all');
  }
  const loaded = extractAgents(parseManifestString('agents:\n  worker:\n    kortix_permissions: [workspace.session.start]\n'));
  const resolved = grantFromLoadedAgents('worker', loaded);
  expect(resolved?.permissions).toEqual(['project.session.start']);
  expect(agentMayPerform(resolved, 'project.session.stop')).toBe(false);
  expect(agentMayPerform(grant([]), 'project.session.start')).toBe(false);
});

test('a narrow writer cannot assign a wider session group', async () => {
  const escalation = await findGrantEscalation({
    writer: grant(['project.session.read']),
    writerMayPerform: async (action) => action === 'project.session.read',
    allPermissions: [],
    before: new Map(),
    after: new Map([['worker', grant(['session.*'])]]),
  });
  expect(escalation).toMatchObject({ target: 'worker', dimension: 'permissions', item: 'project.session.start' });
});
