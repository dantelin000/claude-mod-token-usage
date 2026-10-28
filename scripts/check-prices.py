#!/usr/bin/env python3
"""Check the shape of token-usage/prices.default.json (not the prices: those come from the providers' pages).

  python3 scripts/check-prices.py [path]

Run it after every refresh of the built-in table. `claude plugin test` cannot read the file (its sandbox has no
filesystem), so this is where a broken file is caught before it ships; the file failing to parse would silently
turn the built-in prices off.
"""
import datetime
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'token-usage/prices.default.json'
doc = json.load(open(path, encoding='utf-8'))
errors = []


def bad(msg):
    errors.append(msg)


def rate(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0


def day(s):
    try:
        return datetime.date.fromisoformat(s) and len(s) == 10
    except (TypeError, ValueError):
        return False


RATES = ('input', 'output', 'cached', 'cacheWrite', 'cacheWrite1h', 'thinking')
if not day(doc.get('updated')):
    bad('updated must be an ISO date (YYYY-MM-DD)')
if not (isinstance(doc.get('per'), int) and doc['per'] > 0):
    bad('per must be a positive integer')
srcs = doc.get('sources')
if not (isinstance(srcs, list) and srcs and all(isinstance(u, str) and u.startswith('https://') for u in srcs)):
    bad('sources must be a list of https URLs')
models = doc.get('models')
if not isinstance(models, dict) or not models:
    bad('models must be an object')
    models = {}


def check_rates(where, p, allow):
    for k, v in p.items():
        if k not in allow:
            bad('%s: unknown field %s' % (where, k))
        elif k in RATES and not rate(v):
            bad('%s: %s must be a non-negative number' % (where, k))


for name, p in models.items():
    if '/' in name:
        bad('%s: shipped keys are bare model ids (no provider/ prefix)' % name)
    if not isinstance(p, dict):
        bad('%s: not an object' % name)
        continue
    check_rates(name, p, set(RATES) | {'longPrompt', 'effective', 'note'})
    if not (rate(p.get('input')) and rate(p.get('output'))):
        bad('%s: needs input and output' % name)
    lp = p.get('longPrompt')
    if lp is not None:
        if not (isinstance(lp.get('above'), int) and lp['above'] > 0):
            bad('%s: longPrompt.above must be a positive integer' % name)
        check_rates(name + '.longPrompt', lp, set(RATES) | {'above'})
        if not (rate(lp.get('input')) and rate(lp.get('output'))):
            bad('%s: longPrompt needs input and output' % name)
    last = ''
    for e in p.get('effective', []):
        if not day(e.get('from')) or e['from'] <= last:
            bad('%s: effective.from must be ISO dates in ascending order' % name)
        else:
            last = e['from']
        check_rates(name + '.effective', e, set(RATES) | {'from', 'longPrompt'})
    if 'note' in p and not isinstance(p['note'], str):
        bad('%s: note must be a string' % name)

if errors:
    print('\n'.join(errors))
    sys.exit(1)
print('ok: %d models, built-in prices updated %s' % (len(models), doc['updated']))
