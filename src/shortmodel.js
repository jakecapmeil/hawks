// HawksPredict-Short: times for the events HawksPredict-Lite was not trained on
// (100, 200, 600, 1000 and the steeplechases), with an 80% range.
//
// Every pair of events has a log-log line, ln t_target = a + b ln t_source + c male, fitted on World Athletics
// top-list personal bests and NRCD collegiate PBs; shortmodel.json holds them with each line's residual SD.
// Several known events are combined by inverse-variance averaging; the range comes from the combined SD,
// inflated by a cross-validated factor and widened where the training marks do not cover the athlete.
// The pair lines mirror research/hawkspredict/scripts/exp13_short_events.py. The nearest-three source cap, the sex averaging, the
// source-uncertainty term and extra_sd are applied here and were not part of the cross-validation.
//
//   predictShortAny([{ ev: '800', sec: 130, extra: 0.04 }, ...], '600') -> { sec, lo, hi, sd, n }   (null with no usable pair)
//   `extra` is the source's own log-SD (a Lite estimate's range, or a PR's age).

import MODEL from './shortmodel.json' with { type: 'json' };

const Z = 1.2816; // 80% interval
const PAIRS = new Map(MODEL.pairs.map((p) => [`${p.s}>${p.t}`, p]));
export const SHORT_INFO = { name: MODEL.name, version: MODEL.version };
export const SHORT_METERS = MODEL.events;

// A result of `m` metres in `sec` seconds as a model source (event key + seconds), or null when the model has no such event.
export function shortSource(m, sec) {
  if (Math.abs(m - 1600) / 1600 < 0.01) return { ev: '1609', sec: sec * Math.pow(1609.344 / 1600, 1.06) };
  if (Math.abs(m - 3200) / 3200 < 0.01) return { ev: '3000', sec: sec * Math.pow(3000 / 3200, 1.06) };
  for (const [ev, meters] of Object.entries(MODEL.events)) {
    if (ev.startsWith('S')) continue;
    if (Math.abs(m - meters) / meters < 0.015) return { ev, sec };
  }
  return null;
}

function one(sources, target, male) {
  const tm = MODEL.events[target];
  // The three sources closest in distance carry the answer; more correlated sources would only fake precision.
  const near = sources
    .filter((s) => s.ev !== target && PAIRS.has(`${s.ev}>${target}`))
    .sort((a, b) => Math.abs(Math.log(MODEL.events[a.ev] / tm)) - Math.abs(Math.log(MODEL.events[b.ev] / tm)))
    .slice(0, 3);
  if (!near.length) return null;
  // The pair lines' own scatter is averaged (inverse variance). A source's own uncertainty is NOT averaged away: its error is
  // shared by every pair it feeds, so the nearest source's SD is added once, in quadrature (b = that pair's slope).
  let sw = 0;
  let sp = 0;
  for (const s of near) {
    const p = PAIRS.get(`${s.ev}>${target}`);
    const w = 1 / (p.sd * p.sd);
    sw += w;
    sp += w * (p.a + p.b * Math.log(s.sec) + p.c * male);
  }
  const first = near[0];
  const srcSd = (first.extra || 0) * Math.abs(PAIRS.get(`${first.ev}>${target}`).b);
  const sd = Math.sqrt((Math.sqrt(1 / sw) * MODEL.infl) ** 2 + srcSd ** 2);
  return { mu: sp / sw, sd, n: near.length };
}

// Sex is not stored, so both are run and averaged; the gap between them widens the range.
export function predictShortAny(sources, target) {
  const a = one(sources, target, 0);
  const b = one(sources, target, 1);
  if (!a || !b) return null;
  const mu = (a.mu + b.mu) / 2;
  const extra = MODEL.extra_sd?.[target] || 0;
  const sd = Math.sqrt(((a.sd + b.sd) / 2) ** 2 + ((a.mu - b.mu) / 2) ** 2 + extra * extra);
  return { sec: Math.exp(mu), lo: Math.exp(mu - Z * sd), hi: Math.exp(mu + Z * sd), sd, n: a.n };
}

export const Z80 = Z;
