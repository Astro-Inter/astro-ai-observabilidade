"""Compare only aggregate indicators; do not print trace contents or credentials."""
import json
import math
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

new = 'https://astro-ai-observabilidade.app-4str0.workers.dev'
old = 'https://astro-ai-observabilidade.onrender.com'
now = datetime.now(timezone.utc).replace(microsecond=0)
query = urlencode({'period': 'custom', 'start': (now - timedelta(days=7)).isoformat(), 'end': now.isoformat()})
def read(base):
    request = Request(base + '/api/observability/dashboard?' + query, headers={'Origin': 'https://astro-inter.github.io'})
    with urlopen(request, timeout=45) as response:
        return json.load(response)
def compare(a, b, path=''):
    if path.endswith('/generated_at'):
        return
    if path.endswith(('/period/start', '/period/end')):
        assert datetime.fromisoformat(a) == datetime.fromisoformat(b), path
    elif isinstance(a, dict):
        assert set(a) == set(b), ('fields', path, sorted(set(a) ^ set(b)))
        for key in a:
            compare(a[key], b[key], path + '/' + key)
    elif isinstance(a, list):
        assert len(a) == len(b), ('length', path)
        for index, (x, y) in enumerate(zip(a, b)):
            compare(x, y, path + '/' + str(index))
    elif isinstance(a, (int, float)) and not isinstance(a, bool):
        assert math.isclose(a, b, rel_tol=1e-8, abs_tol=1e-8), ('number', path)
    else:
        assert a == b, ('value', path)
try:
    if '--files' in sys.argv:
        actual = json.loads(Path(__file__).with_name('live-new.json').read_text(encoding='utf-8-sig'))
        previous = json.loads(Path(__file__).with_name('live-old.json').read_text(encoding='utf-8-sig'))
    else:
        actual = read(new)
        previous = read(old)
    compare(actual, previous)
    print(json.dumps({'live_parity': 'passed', 'runs': actual['runs_examined'], 'data_status': actual['data_status']}))
except Exception as error:
    print(json.dumps({'live_parity': 'failed', 'error_type': type(error).__name__, 'reason': str(error)[:200]}))
    raise SystemExit(1)
