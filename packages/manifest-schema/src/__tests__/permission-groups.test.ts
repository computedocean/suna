import { expect, test } from 'bun:test';
import { KORTIX_PERMISSION_GROUPS, validateManifest, resolveGrantSet } from '../index';
import { parse, stringify } from 'yaml';
import Ajv2020 from 'ajv/dist/2020';
import { KORTIX_JSON_SCHEMA } from '../json-schema';

const manifest = (grant: string) => `agents:\n  worker:\n    prompt: Help.\n    kortix_permissions: ${grant}\n`;

test('terminal permission group wildcards validate without changing their scope', () => {
  for (const grant of ['[session.*]', '[workspace.*]', '[workspace.session.*]', '[project.session.*]', '[workspace.gitops.ref.*, billing.read]']) {
    const result = validateManifest(manifest(grant));
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  }
});

test('all registry groups agree with JSON Schema and survive serialization', () => {
  const validate = new Ajv2020({ strict: false }).compile(KORTIX_JSON_SCHEMA);
  for (const group of KORTIX_PERMISSION_GROUPS) {
    const input = manifest(JSON.stringify([group, 'workspace.read']));
    expect(validateManifest(input).valid).toBe(true);
    expect(validate(parse(input))).toBe(true);
    const roundTrip = validateManifest(stringify(parse(input)));
    expect(roundTrip.valid).toBe(true);
    expect(resolveGrantSet([group, 'workspace.read'], 'none')).toEqual([group, 'workspace.read']);
  }
});

test('unknown and malformed groups are rejected', () => {
  for (const grant of ['[sessions.*]', '[workspace.unknown.*]', '[workspace.session*]', '[workspace.*.read]', '[session.**]']) {
    expect(validateManifest(manifest(grant)).valid).toBe(false);
  }
});
