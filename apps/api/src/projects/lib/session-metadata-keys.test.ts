import { expect, test } from 'bun:test';
import { SPACE_MEMORY_SYNCED_AT_KEY, SPACE_MEMORY_SYNCED_SEQ_KEY } from './space-memory-update/prompt';
import { PATCH_SERVER_MANAGED_SESSION_METADATA_KEYS, SERVER_MANAGED_SESSION_METADATA_KEYS } from './session-metadata-keys';

// Automatic Space memory trusts its sync mark: a client that could write it
// would keep a session out of the Space memory for good.
test('the Space memory sync mark is server-managed on create and on PATCH', () => {
  for (const key of [SPACE_MEMORY_SYNCED_SEQ_KEY, SPACE_MEMORY_SYNCED_AT_KEY]) {
    expect(SERVER_MANAGED_SESSION_METADATA_KEYS as readonly string[]).toContain(key);
    expect(PATCH_SERVER_MANAGED_SESSION_METADATA_KEYS as readonly string[]).toContain(key);
  }
});
