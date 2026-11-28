#!/bin/bash
# saved: one webhook automation exists with a filter on the enterprise plan (the filter, not the worker, skips other plans). It may be paused, or already live: resume refuses a filtered automation until a sample that runs and one that is skipped were tested.
mkdir -p /logs/verifier
judge() { kortix evals judge "$@" || { echo "kortix evals judge failed: no reward, so the trial counts as an error, not a 0"; rm -f /logs/verifier/reward.json; exit 1; }; }
python3 - <<'PY'
import sys; sys.path.insert(0, '/tests')
from kx import *
def hooks():
    data = kj('triggers ls') or {}
    found = [t for t in rows(data, 'triggers') + rows(data, 'runtime') if str(t.get('type') or (t.get('source') or {}).get('kind') or '').lower() == 'webhook' or 'webhook' in str(t.get('source') or '').lower()]
    open(f'{V}/triggers.json', 'w').write(json.dumps(data, indent=1))
    return found
def live(t):
    return t.get('state') not in ('paused', 'disabled', 'done') and t.get('enabled') is not False and not t.get('auto_paused_at')
def enterprise(t):
    return 'enterprise' in json.dumps(t.get('filter') or (t.get('source') or {}).get('filter') or {}).lower()
found = hooks()
# A rebuilt hook may leave the old one paused (deleting needs the person's word): every hook filtered, at most one live.
save({'saved': 1 if found and all(enterprise(t) for t in found) and sum(1 for t in found if live(t)) <= 1 else 0})
PY
[ $? = 0 ] || { echo "the grader crashed: no reward, so the trial counts as an error, not a 0"; rm -f /logs/verifier/reward.json; exit 1; }
python3 -c 'import sys; sys.path.insert(0, "/tests"); import kx; kx.finalize()'
exit 0
