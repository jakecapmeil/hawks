"""'What is a 400 in the 600?' tables from the shipped HawksPredict-Short pair lines (sex averaged, exact PRs as input, 80% range).
Usage: exp17_equiv_tables.py <repo root>"""
import sys, json
import numpy as np
M = json.load(open(f'{sys.argv[1]}/src/shortmodel.json')); P = {f"{p['s']}>{p['t']}": p for p in M['pairs']}; Z = 1.2816
def pred(src, tgt, t):
    p = P[f'{src}>{tgt}']; mus = [p['a'] + p['b'] * np.log(t) + p['c'] * m for m in (0, 1)]; mu = np.mean(mus)
    sd = np.sqrt((p['sd'] * M['infl']) ** 2 + (abs(mus[0] - mus[1]) / 2) ** 2 + M['extra_sd'].get(tgt, 0) ** 2)
    return np.exp(mu), np.exp(mu - Z * sd), np.exp(mu + Z * sd)
fm = lambda s: f'{int(s // 60)}:{s % 60:04.1f}' if s >= 60 else f'{s:.1f}'
for src, tgt, ts in (('400', '600', [52, 56, 60, 64, 68, 74, 80]), ('800', '1609', [112, 122, 132, 142, 156, 172, 190]), ('400', '800', [52, 56, 60, 64, 68, 74, 80]), ('800', '1500', [112, 122, 132, 142, 156, 172, 190]),
                     ('1609', '5000', [260, 290, 320, 350, 380, 420]), ('200', '400', [23, 25, 27, 29, 32, 35]), ('100', '200', [11.5, 12.5, 13.5, 14.5, 16])):
    print(f'\n{src} m -> {tgt} m (one known time)\n| {src} m | {tgt} m | 80% range |\n|---|---|---|')
    for t in ts: m = pred(src, tgt, t); print(f'| {fm(t)} | {fm(m[0])} | {fm(m[1])} to {fm(m[2])} |')
