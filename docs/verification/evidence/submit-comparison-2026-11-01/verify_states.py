"""Check retained observations; does not execute a CLI or access the network."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
obs = json.loads((ROOT / 'observations.json').read_text())
rea = json.loads((ROOT / 'rea-captures.json').read_text())
prefix = 'submit-probe-20261101-'
checks = []


def check(label, condition):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def changed(before, after):
    return {k.removeprefix('refs/heads/' + prefix)
            for k in before['refs'] if before['refs'][k] != after['refs'][k]}


def fixed(state, name):
    return state['ancestor'][prefix + name]


for case, record in obs.items():
    before, after = record['before'], record['after']
    check(case + ': remote stays at setup refs',
          record['setupRemoteTrackingRefs'] == record['afterBareRemoteRefs'])
    check(case + ': ancestry and intended checkout initially stale',
          not fixed(before, 'child') and not fixed(before, 'sibling'))
    check(case + ': parent names unchanged', before['parents'] == after['parents'])
    check(case + ': checkout preserved', before['branch'] == after['branch'])
    if case.endswith('-an'):
        check(case + ': submit refusal preserves observed state', before == after)
        check(case + ': submit returns failure', record['capture']['exit'] == 1)

for name in ['normal', 'apply', 'conflict', 'frozen', 'occupied']:
    r = obs[name + '-gt']
    check(name + ': Graphite heads retained', not changed(r['before'], r['after']))
    check(name + ': no active conflict', not r['after']['rebase'] and not r['after']['unmerged'])

for name, expected in [('preview', {'child', 'tip'}),
                       ('fanout', {'child', 'tip', 'sibling'})]:
    gt = obs[name + '-gt']
    an = obs[name + '-an']['manual']
    check(name + ': Graphite dry-run rewrites exact heads', changed(gt['before'], gt['after']) == expected)
    check(name + ': separate Anthracite restack rewrites exact heads', changed(an['before'], an['after']) == expected)
    for tool, r in [('gt', gt), ('an', an)]:
        check(name + ': ' + tool + ' selected chain repaired', fixed(r['after'], 'child') and fixed(r['after'], 'tip'))
        check(name + ': ' + tool + ' sibling repair matches scope', fixed(r['after'], 'sibling') == (name == 'fanout'))
    check(name + ': Graphite and component-control branch trees agree', gt['after']['trees'] == an['after']['trees'])
    check(name + ': Anthracite component workflow succeeds', an['capture']['restack']['exit'] == 0 and an['capture']['submit']['exit'] == 0)

conflict = obs['conflict-an']['manual']
check('Anthracite conflict has live rebase and child conflict', conflict['after']['rebase'] and conflict['after']['unmerged'] == 'child.txt')
check('Anthracite conflict reports continue', 'an continue' in conflict['capture']['restack']['stderr'])
occupied = obs['occupied-an']['manual']
check('Anthracite occupied participant refuses unchanged', occupied['capture']['restack']['exit'] == 1 and occupied['before'] == occupied['after'])
frozen = obs['frozen-an']['manual']
check('Anthracite frozen control keeps heads and submits editable tip', not changed(frozen['before'], frozen['after']) and frozen['capture']['submit']['exit'] == 0 and '(Create)' in frozen['capture']['submit']['stdout'])

expected_exits = {'normal-gt': 1, 'preview-gt': 0, 'apply-gt': 1, 'fanout-gt': 0, 'conflict-gt': 1, 'frozen-gt': 0, 'occupied-gt': 0}
for record in rea['cases']:
    d = record['result'][0]
    n = d['normalized_result']
    check(record['name'] + ': observed expected exit', n['exit']['reason'] == 'exited' and n['exit']['code'] == expected_exits[record['name']])
    check(record['name'] + ': complete capture and verified cleanup', not n['truncated'] and n['cleanup']['owned_process_group'] == 'verified')

print(json.dumps({'passingOutcomePredicates': len(checks), 'pairedCases': len(obs) // 2, 'anthraciteComponentControls': 5, 'checks': checks}, indent=2))
