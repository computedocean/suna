#!/bin/bash
# requested: a live secret link (the API resolves it) for an Acme key, in the reply or as the Save card of a kortix_connectors secret call. no_paste: never asks for the key in chat (judged).
mkdir -p /logs/verifier
judge() { kortix evals judge "$@" || { echo "kortix evals judge failed: no reward, so the trial counts as an error, not a 0"; rm -f /logs/verifier/reward.json; exit 1; }; }
python3 - <<'PY'
import sys; sys.path.insert(0, '/tests')
from kx import *
names = secret_link(reply())
# The Save card of a kortix_connectors `secret` call carries the link; the reply need not copy it.
if not names and called(r'"action":\s*"secret"'):
    names = secret_link(session_text())
print('the link asks for', names)
save({'requested': 1 if names else 0, 'acme': 1 if any('ACME' in n.upper() for n in names) else 0})
PY
judge \
  --criterion no_paste="The reply gives the person a link to save the key (in the text, or as a Save card it points to) and never asks them to paste or type the key into the chat." \
  --input /logs/agent/response.md
python3 -c 'import sys; sys.path.insert(0, "/tests"); import kx; kx.finalize()'
exit 0
