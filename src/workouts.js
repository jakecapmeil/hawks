// Workout library. Built from the Hawks plan menus (Tue/Thu/Sun sessions across
// plans 1-6), Jake's own XC Coach Log sessions, and standard high school
// distance training (Daniels, Lydiard, Canova-style race-specific work).
//
// Paces are written relative to current 5K race pace so one library fits every
// runner; PACE_ZONES turns a 5K time into actual per-mile paces.
//
// Fields: type, races (what it prepares you for), phase (base, build, peak,
// taper), level (1 beginner - 3 advanced), total_min (warm-up to cool-down),
// work (the hard part), main (the session), wu/cd, rec (recovery), paces,
// purpose, cues, progress (how to make it harder next time), source.

export const WORKOUT_TYPES = {
  easy: 'Easy / recovery',
  long: 'Long run',
  steady: 'Steady / aerobic',
  progression: 'Progression',
  tempo: 'Tempo',
  threshold: 'Threshold / cruise intervals',
  vo2: 'VO2max intervals',
  track: 'Track reps (speed)',
  fartlek: 'Fartlek',
  hills: 'Hills',
  strides: 'Strides / speed development',
  race_specific: 'Race-specific',
  time_trial: 'Time trial / race sim',
};

export const RACES = ['800', '1600', '3200', '5K', 'XC', '10K', 'Half'];
export const PHASES = ['base', 'build', 'peak', 'taper'];

// Multipliers on 5K pace per mile. 5K at 6:15/mi gives threshold ~6:41, which
// matches Jake's 15-min tempo gate (6:45-6:55).
export const PACE_ZONES = [
  { key: 'mile', label: 'Mile pace', factor: 0.92 },
  { key: '3200', label: '3200 pace', factor: 0.965 },
  { key: '5k', label: '5K pace', factor: 1.0 },
  { key: '10k', label: '10K pace', factor: 1.04 },
  { key: 'threshold', label: 'Threshold (comfortably hard, ~1 hr race pace)', factor: 1.07 },
  { key: 'tempo', label: 'Tempo (half-marathon pace)', factor: 1.1 },
  { key: 'steady', label: 'Steady / marathon pace', factor: 1.17 },
  { key: 'easy', label: 'Easy', factor: [1.3, 1.45] },
  { key: 'recovery', label: 'Recovery', factor: [1.45, 1.6] },
];

function fmt(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// "19:25" (5K time) -> per-mile paces for every zone.
export function pacesFrom5k(time) {
  const m = String(time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const perMile = (Number(m[1]) * 60 + Number(m[2])) / 3.10686;
  return PACE_ZONES.map((z) => ({
    zone: z.key,
    label: z.label,
    per_mile: Array.isArray(z.factor) ? `${fmt(perMile * z.factor[0])}-${fmt(perMile * z.factor[1])}` : fmt(perMile * z.factor),
    per_400: Array.isArray(z.factor) ? null : fmt((perMile * z.factor) / 4.02336),
  }));
}

const W = (o) => o;

export const WORKOUTS = [
  // ---------------------------------------------------------------- easy
  W({ id: 'easy-30', name: 'Easy 30 + strides', type: 'easy', races: RACES, phase: PHASES, level: 1, total_min: 35,
    main: '30 min easy, then 6x20s strides with full walk-back recovery', work: '6x20s strides', paces: 'Easy: conversational, HR under ~80% max (Jake: under 162). Strides at 5K effort, relaxed, not a sprint.',
    purpose: 'Aerobic base and leg turnover without fatigue. The default day between workouts.',
    cues: 'Time is a ceiling, not a target. If HR drifts up late, slow down rather than finishing on pace.', progress: 'Add 5 min every other week, up to 45-50 min.', source: 'Jake XC Coach Log (Jul 27)' }),
  W({ id: 'recovery-25', name: 'Recovery jog', type: 'easy', races: RACES, phase: PHASES, level: 1, total_min: 25,
    main: '20-30 min very easy, flat, nothing attached', work: 'none', paces: 'Recovery pace, HR under ~72% max. Slower than you think.',
    purpose: 'Blood flow the day after a workout or race. Gets you out the door without adding load.',
    cues: 'Treadmill or soft surface is fine. Stop if anything hurts.', progress: 'Never progress this one.', source: 'Jake XC Coach Log (Jul 28)' }),
  W({ id: 'double-easy', name: 'AM/PM double', type: 'easy', races: ['5K', 'XC', '10K', 'Half'], phase: ['base', 'build'], level: 3, total_min: 75,
    main: 'AM 3 mi easy, PM 6 mi easy with strides', work: 'PM strides', paces: 'Both runs fully easy.',
    purpose: 'Higher weekly mileage without one long beat-up run. Used on the 60 mpw plan.',
    cues: 'Keep the AM run short and boring; the PM run carries the strides.', progress: 'Only add once 50+ mpw feels routine.', source: 'Hawks plan 6 (Mon/Wed/Thu)' }),

  // ---------------------------------------------------------------- long
  W({ id: 'long-easy', name: 'Easy long run', type: 'long', races: RACES, phase: ['base', 'build', 'peak'], level: 1, total_min: 60,
    main: '50-90 min easy on a flat route, no surges', work: 'the whole run', paces: 'Easy, the same pace band as normal easy days.',
    purpose: 'Builds the aerobic engine, capillaries, and durability. Biggest single driver of XC fitness.',
    cues: 'Start at the slow end of easy. Fuel and water past 75 min. Long run is about 20-25% of weekly miles.', progress: 'Add 5-10 min per week, step back every 3rd-4th week.', source: 'Jake XC Coach Log (Jul 26), Hawks plans 1-6 (Sun)' }),
  W({ id: 'long-blocks', name: 'Long run with 3x8-10 min', type: 'long', races: ['5K', 'XC', '10K', 'Half'], phase: ['build', 'peak'], level: 2, total_min: 75,
    main: 'Long run with 3x8 min (plans 1-2), 3x9 min (plan 3-4) or 3x10 min (plans 5-6) at 5K+25-30 sec, 2-2:30 jog between', work: '24-30 min', paces: 'Blocks at 5K pace + 25-30 s/mi (close to threshold). Rest of the run easy.',
    purpose: 'Threshold work inside a long run. Teaches you to run strong on tired legs, like the last mile of XC.',
    cues: 'Put the blocks in the middle third, not the end. Blocks should feel controlled.', progress: 'Go 3x8 -> 3x9 -> 3x10 -> 2x15.', source: 'Hawks plans 1-6 (Sunday long run menu)' }),
  W({ id: 'long-progression', name: 'Progression long run', type: 'long', races: ['3200', '5K', 'XC', '10K', 'Half'], phase: ['build', 'peak'], level: 2, total_min: 70,
    main: 'Long run in thirds: easy, steady, then the last 10-15 min down to threshold (5K-30s is the cap)', work: 'last third', paces: 'Easy -> steady -> threshold.',
    purpose: 'Finishing strength and pacing discipline.',
    cues: 'Each third faster than the last, never the other way round. If you are tired, just jog easy.', progress: 'Lengthen the fast final section.', source: 'Hawks plans 1-6 (Sunday long run menu)' }),
  W({ id: 'long-hilly', name: 'Hilly long run', type: 'long', races: ['XC', '5K', '10K'], phase: ['base', 'build'], level: 2, total_min: 70,
    main: '60-75 min easy over a rolling route (Prospect Park loop, Van Cortlandt back hills)', work: 'the hills', paces: 'Easy by effort: let pace slow on the climbs.',
    purpose: 'Strength and XC-specific durability without a formal workout.',
    cues: 'Run the hills by effort, not pace. Quick feet on the downhills.', progress: 'Add one more loop of hills.', source: 'Standard XC base' }),
  W({ id: 'long-fast-finish', name: 'Fast-finish long run', type: 'long', races: ['5K', 'XC', '10K', 'Half'], phase: ['peak'], level: 3, total_min: 80,
    main: '60 min easy, then 15 min at tempo, then 5 min easy', work: '15 min', paces: 'Tempo = half-marathon pace.',
    purpose: 'Race-like fatigue late in a run. A big session: use it instead of a workout that week.',
    cues: 'Do not start the fast part unless the first hour was truly easy.', progress: 'Extend fast finish to 20 min.', source: 'Standard' }),

  // ---------------------------------------------------------------- steady / progression
  W({ id: 'steady-40', name: 'Steady state', type: 'steady', races: ['5K', 'XC', '10K', 'Half'], phase: ['base', 'build'], level: 2, total_min: 55,
    main: '10 min easy, 30-40 min steady, 5-10 min easy', work: '30-40 min', paces: 'Steady/marathon pace: faster than easy, well short of tempo.',
    purpose: 'Aerobic strength in base season. Bridges easy running and tempo.',
    cues: 'You should be able to say a sentence. HR around 80-85% max.', progress: 'Add 5 min per week.', source: 'Standard (Lydiard base)' }),
  W({ id: 'prog-thirds', name: '30-min progression', type: 'progression', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build', 'peak'], level: 1, total_min: 45,
    main: '10 min easy, 10 min steady, 10 min threshold, 10 min cool-down', work: '20 min', paces: 'Easy -> steady -> threshold.',
    purpose: 'A gentle first workout. Teaches you to run faster without straining.',
    cues: 'Good beginner workout or a first workout back from a break.', progress: 'Make each section 12, then 15 min.', source: 'Standard' }),
  W({ id: 'prog-5k-minus-30', name: 'Progression to 5K-30', type: 'progression', races: ['5K', 'XC'], phase: ['build'], level: 2, total_min: 50,
    main: 'Start easy and drop roughly 10-15 s/mi every mile, finishing at 5K pace minus 30 s for the last half mile', work: 'last 2 miles', paces: 'Easy down to faster than 5K pace for the final stretch.',
    purpose: 'Negative splitting and closing speed.', cues: 'Patience. The first half should feel too easy.', progress: 'Add a mile at the front.', source: 'Hawks plans 1-2 (Sunday menu)' }),

  // ---------------------------------------------------------------- tempo
  W({ id: 'tempo-15-gate', name: '15-min tempo', type: 'tempo', races: ['3200', '5K', 'XC', '10K'], phase: ['base', 'build'], level: 1, total_min: 40,
    main: '12 min wu, 15 min tempo, 11 min cd', work: '15 min', paces: 'Tempo/threshold (Jake: 6:45-6:55, HR 176-184).',
    purpose: 'First sustained threshold run of a block. Also a fitness check: run it on pace, not faster.',
    cues: 'Faster or longer is a fail, not extra credit. Even pace the whole way.', progress: '20 min, then 2x12 min, then 25 min.', source: 'Jake XC Coach Log (Jul 29 tempo gate)' }),
  W({ id: 'tempo-3mi', name: '3-mile tempo', type: 'tempo', races: ['5K', 'XC', '10K'], phase: ['build'], level: 2, total_min: 50,
    main: '1.5 mi wu, 3 mi tempo, 1.5 mi cd', work: '3 mi', paces: '5K pace + 20 s/mi.',
    purpose: 'Core XC threshold session. Raises the pace you can hold before lactate piles up.',
    cues: 'Mile 3 should be the same pace as mile 1. Find a flat loop or the track.', progress: 'Go to 4 mi, then 2x2.5 mi.', source: 'Hawks plans 1-2 (Tuesday menu)' }),
  W({ id: 'tempo-20', name: '20-min tempo', type: 'tempo', races: ['3200', '5K', 'XC', '10K'], phase: ['build', 'peak'], level: 2, total_min: 50,
    main: '15 min wu, 20 min tempo, 10 min cd + 4 strides', work: '20 min', paces: 'Threshold.',
    purpose: 'Classic Daniels tempo. The bread and butter of distance training.', cues: 'Comfortably hard: you could hold it for close to an hour in a race.', progress: '25 min, then 2x15.', source: 'Standard (Daniels T-pace)' }),
  W({ id: 'tempo-4mi', name: '4-mile tempo', type: 'tempo', races: ['XC', '10K', 'Half'], phase: ['build', 'peak'], level: 3, total_min: 60,
    main: '2 mi wu, 4 mi tempo, 2 mi cd', work: '4 mi', paces: 'Half-marathon pace (5K + ~30 s/mi).', purpose: 'Long threshold for 50-60 mpw runners.',
    cues: 'Slightly slower than a 3-mile tempo.', progress: '5 mi, or 2x3 mi with 2 min.', source: 'Standard' }),
  W({ id: 'tempo-broken', name: 'Broken tempo 2x2 mi', type: 'tempo', races: ['5K', 'XC', '10K'], phase: ['build', 'peak'], level: 2, total_min: 55,
    main: '2 mi wu, 2x2 mi at tempo with 2 min jog, 2 mi cd', work: '4 mi', paces: 'Threshold, second rep 5 s/mi faster if it feels good.',
    purpose: 'More threshold volume than a straight tempo with less strain.', cues: 'The jog is a jog, not a stop.', progress: '3x2 mi.', source: 'Standard' }),

  // ---------------------------------------------------------------- threshold / cruise
  W({ id: 'cruise-mile-4', name: '4x mile at 5K, 200 jog', type: 'threshold', races: ['3200', '5K', 'XC'], phase: ['build', 'peak'], level: 2, total_min: 55,
    main: '2 mi wu, 4x1 mile with 200m jog, 2 mi cd', work: '4 mi', paces: '5K pace (plans 3-5). Newer runners: threshold.',
    purpose: 'The signature Hawks Tuesday session. Race-pace endurance with short rest.', cues: 'All four within 5 seconds of each other. Rep 1 should feel easy.',
    progress: '5x mile (plan 6), or cut rest to 60s standing.', source: 'Hawks plans 3-5 (Tuesday menu)' }),
  W({ id: 'cruise-mile-5', name: '5x mile at 5K, 200 jog', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['peak'], level: 3, total_min: 65,
    main: '2 mi wu, 5x1 mile with 200m jog, 2 mi cd', work: '5 mi', paces: '5K pace.', purpose: 'Big race-pace volume for 60 mpw runners.',
    cues: 'Hold form in reps 4-5. If rep 5 is 10+ s slower, stop at 4 next time.', progress: 'Run 1-2 s faster per rep.', source: 'Hawks plan 6 (Tuesday menu)' }),
  W({ id: 'cruise-3mile', name: '3x mile at 5K', type: 'threshold', races: ['1600', '3200', '5K', 'XC'], phase: ['build'], level: 1, total_min: 45,
    main: '1.5 mi wu, 3x1 mile with 200 jog or 90s standing, 1.5 mi cd', work: '3 mi', paces: '5K pace.', purpose: 'First mile-rep session for 30-35 mpw runners.',
    cues: 'Learn what 5K pace feels like.', progress: '4x mile.', source: 'Hawks plans 1-2 (Tuesday menu)' }),
  W({ id: 'cruise-k-6', name: '6x1K at 5K+15', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['build'], level: 2, total_min: 50,
    main: '2 mi wu, 6x1K at 5K+15 s/mi with 90s rest, 2 mi cd', work: '6K', paces: '5K pace + 15 s/mi.', purpose: 'Threshold-plus work with lots of volume. Thursday "medium" day.',
    cues: 'Should feel medium, not hard. You are saving the real effort for Tuesday.', progress: '8x1K (plan 6).', source: 'Hawks plans 3-5 (Thursday menu)' }),
  W({ id: 'cruise-k-8', name: '8x1K at 5K+15', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['build', 'peak'], level: 3, total_min: 60,
    main: '2 mi wu, 8x1K at 5K+15 s/mi with 90s rest, 2 mi cd', work: '8K', paces: '5K pace + 15 s/mi.', purpose: 'Big medium-day volume for 60 mpw.',
    cues: 'Even splits. Stay relaxed in the shoulders.', progress: 'Cut rest to 60s.', source: 'Hawks plan 6 (Thursday menu)' }),
  W({ id: 'cruise-2k-3', name: '3x2K at 5K, 2 min', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 3x2K at 5K pace with 2 min rest, 2 mi cd', work: '6K', paces: '5K pace.', purpose: 'Long race-pace reps: as close to the race as practice gets.',
    cues: 'The middle 800 of each rep is where focus slips.', progress: '4x2K (plan 6).', source: 'Hawks plans 3-5 (Tuesday menu)' }),
  W({ id: 'cruise-2k-4', name: '4x2K at 5K, 2 min', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['peak'], level: 3, total_min: 65,
    main: '2 mi wu, 4x2K at 5K pace with 2 min rest, 2 mi cd', work: '8K', paces: '5K pace.', purpose: 'The toughest race-pace session on the Hawks menu.',
    cues: 'Only after a full block of mile repeats.', progress: 'This is the top of the ladder.', source: 'Hawks plan 6 (Tuesday menu)' }),
  W({ id: 'threshold-10x400', name: '10x400 threshold', type: 'threshold', races: ['1600', '3200', '5K'], phase: ['base', 'build'], level: 1, total_min: 45,
    main: '15 min wu, 10x400 at threshold with 45s rest, 10 min cd', work: '4K', paces: 'Threshold.', purpose: 'Threshold volume in small bites, good for younger runners or track season.',
    cues: 'These should feel too easy. That is the point.', progress: '12-15x400, or 6x800.', source: 'Standard (Norwegian-style sub-threshold)' }),
  W({ id: 'threshold-double', name: 'Double threshold (AM 5x6 min / PM 10x1K)', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['build'], level: 3, total_min: 110,
    main: 'AM: 5x6 min at threshold, 1 min rest. PM: 10x1K at threshold, 1 min rest.', work: '30 min + 10K', paces: 'Just under threshold, controlled.',
    purpose: 'Norwegian method: lots of threshold time without the damage of VO2 work.', cues: 'Advanced only, 55+ mpw. Must stay controlled, never a race.',
    progress: 'Do not progress in high school; use sparingly.', source: 'Standard (Norwegian double threshold)' }),

  // ---------------------------------------------------------------- VO2max
  W({ id: 'vo2-800-6', name: '6x800 at 5K', type: 'vo2', races: ['1600', '3200', '5K', 'XC'], phase: ['build', 'peak'], level: 1, total_min: 45,
    main: '1.5 mi wu, 6x800 at 5K pace with 200 jog or 90s standing, 1.5 mi cd', work: '3 mi', paces: '5K pace.', purpose: 'Classic VO2 workout. Raises your aerobic ceiling.',
    cues: 'Same split every rep. Last two should be the hardest but not the fastest.', progress: '8x800, or 5x1K.', source: 'Hawks plans 1-2 (Tuesday menu)' }),
  W({ id: 'vo2-k-5', name: '5x1K at 5K', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['build', 'peak'], level: 2, total_min: 50,
    main: '1.5 mi wu, 5x1K at 5K pace with 200 jog or 90s standing, 1.5 mi cd', work: '5K', paces: '5K pace.', purpose: 'A full 5K of race-pace work.',
    cues: 'Rep 3 is where you decide the workout.', progress: '6x1K faster than 5K (plans 3-5).', source: 'Hawks plans 1-2 (Tuesday menu)' }),
  W({ id: 'vo2-k-fast', name: '6-7x1K faster than 5K', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 6x1K (plans 3-5) or 7x1K (plan 6) at 3200-5K pace with 200 jog, 2 mi cd', work: '6-7K', paces: 'Between 3200 and 5K pace.',
    purpose: 'Pushes your top-end aerobic speed. Makes 5K pace feel easier.', cues: 'Fast, not frantic. Stay tall when it hurts.', progress: 'Cut the jog to 150m.', source: 'Hawks plans 3-6 (Tuesday menu)' }),
  W({ id: 'vo2-3on1off', name: '6-8x(3 min on, 1 min off)', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['build'], level: 1, total_min: 45,
    main: '15 min wu, 6x3 min hard / 1 min easy (plans 1-2), 8x2:30/1 (plans 3-5) or 8x3/1 (plan 6), 10 min cd', work: '18-24 min', paces: '5K effort on the on, easy jog on the off. Great on grass.',
    purpose: 'Time-based VO2 work. Works on any terrain, perfect for XC courses.', cues: 'Keep the 1 min a real jog, not a walk.', progress: 'Add one rep, or shorten the off to 45s.', source: 'Hawks plans 1-6 (Thursday menu)' }),
  W({ id: 'vo2-1200', name: '4x1200 at 5K, 3 min', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['peak'], level: 2, total_min: 50,
    main: '2 mi wu, 4x1200 at 5K pace with 3 min jog, 2 mi cd', work: '4.8K', paces: '5K pace.', purpose: 'Longer VO2 reps, very race-specific for 5K/XC.',
    cues: 'Lap 2 of each rep is the hard one: stay on pace.', progress: '5x1200.', source: 'Standard' }),
  W({ id: 'vo2-ladder', name: 'Ladder 400-800-1200-800-400', type: 'vo2', races: ['1600', '3200', '5K'], phase: ['build'], level: 2, total_min: 45,
    main: '15 min wu, 400-800-1200-800-400 with half-distance jog, 10 min cd', work: '3.6K', paces: '400s at 3200 pace, 800s/1200 at 5K pace.',
    purpose: 'Variety VO2 session with a fast finish.', cues: 'The last 400 is the fastest rep of the day.', progress: 'Add a 1600 at the top.', source: 'Standard' }),

  // ---------------------------------------------------------------- track
  W({ id: 'track-400-6', name: '6x400 at 5K + 4x200', type: 'track', races: ['800', '1600', '3200', '5K'], phase: ['build'], level: 1, total_min: 40,
    main: '1.5 mi wu, 6x400 at 5K pace with 200 jog, then 4x200 at mile pace with 200 jog, 1.5 mi cd', work: '2.4K + 800', paces: '5K pace, then mile pace.',
    purpose: 'Turnover plus race-pace rhythm. Thursday medium day for plans 1-2.', cues: 'The 200s are quick but smooth, not a sprint.', progress: '12x400 (plans 3-5).', source: 'Hawks plans 1-2 (Thursday menu)' }),
  W({ id: 'track-400-12', name: '12x400 at 5K, 200 jog', type: 'track', races: ['1600', '3200', '5K', 'XC'], phase: ['build', 'peak'], level: 2, total_min: 50,
    main: '2 mi wu, 12x400 at 5K pace with 200 jog, 2 mi cd', work: '4.8K', paces: '5K pace.', purpose: 'Rhythm and volume at race pace.',
    cues: 'Lock in a split, e.g. 93-94 s for 6:15 5K pace.', progress: '16x400 (plan 6).', source: 'Hawks plans 3-5 (Thursday menu)' }),
  W({ id: 'track-400-16', name: '16x400 at 5K, 200 jog', type: 'track', races: ['3200', '5K', 'XC'], phase: ['peak'], level: 3, total_min: 60,
    main: '2 mi wu, 16x400 at 5K pace with 200 jog, 2 mi cd', work: '6.4K', paces: '5K pace.', purpose: 'High-volume race-pace reps for 60 mpw runners.',
    cues: 'Count in sets of 4 to stay sharp mentally.', progress: 'Top of the ladder.', source: 'Hawks plan 6 (Thursday menu)' }),
  W({ id: 'track-mile-sim', name: '4x400 at mile pace, full rest', type: 'track', races: ['800', '1600'], phase: ['peak', 'taper'], level: 2, total_min: 40,
    main: '2 mi wu + drills, 4x400 at goal mile pace with 3-4 min walk/jog, 1.5 mi cd', work: '1600', paces: 'Goal mile pace.', purpose: 'Teaches goal mile rhythm with full recovery.',
    cues: 'Hit the split exactly. Practice the lap-3 focus.', progress: '2x(3x400) or 600-400-200.', source: 'Standard' }),
  W({ id: 'track-200s', name: '10x200 at mile pace', type: 'track', races: ['800', '1600', '3200'], phase: ['build', 'peak', 'taper'], level: 1, total_min: 35,
    main: '15 min wu + drills, 10x200 at mile pace with 200 jog, 10 min cd', work: '2K', paces: 'Mile pace.', purpose: 'Speed and form without big fatigue. Good second workout in race weeks.',
    cues: 'Relaxed face and hands. Faster feet, not longer strides.', progress: '12-16x200, or 8x300.', source: 'Standard' }),
  W({ id: 'track-600s', name: '5x600 at 3200 pace', type: 'track', races: ['1600', '3200'], phase: ['peak'], level: 2, total_min: 45,
    main: '2 mi wu, 5x600 at 3200 pace with 400 jog, 1.5 mi cd', work: '3K', paces: '3200 pace.', purpose: '2-mile specific speed endurance.',
    cues: 'Hold the last 200 of each rep.', progress: 'Cut jog to 200.', source: 'Standard' }),
  W({ id: 'track-800-fast', name: '3x800 at mile-3200 pace, full rest', type: 'track', races: ['800', '1600', '3200'], phase: ['peak'], level: 3, total_min: 45,
    main: '2 mi wu + drills, 3x800 between mile and 3200 pace with 4-5 min rest, 1.5 mi cd', work: '2.4K', paces: 'Mile-3200 pace.', purpose: 'Lactate tolerance for track races.',
    cues: 'Hard session: never the week before a big XC race.', progress: '4x800.', source: 'Standard' }),
  W({ id: 'track-300s', name: '2 sets of 4x300', type: 'track', races: ['800', '1600'], phase: ['peak', 'taper'], level: 2, total_min: 40,
    main: '2 mi wu + drills, 2 sets of 4x300 at mile pace or faster, 100 walk between reps, 5 min between sets, 1.5 mi cd', work: '2.4K', paces: 'Mile pace to 800 pace.',
    purpose: 'Speed endurance for milers and 800 runners.', cues: 'Stay tall, drive arms on the curve.', progress: 'Make set 2 faster.', source: 'Standard' }),

  // ---------------------------------------------------------------- fartlek
  W({ id: 'fartlek-6x1', name: '6x1 min on / 1 min easy', type: 'fartlek', races: ['1600', '3200', '5K', 'XC'], phase: ['base'], level: 1, total_min: 32,
    main: '10 min wu, 6x(1 min on, 1 min easy), 10 min cd', work: '6 min', paces: 'On: about 5K effort. Off: easy jog.',
    purpose: 'First quality session back from a break. Wakes up the legs without strain.',
    cues: 'Only do it if your recent easy runs have actually been easy by HR.', progress: '8x1, then 4x(2 on/2 off).', source: 'Jake XC Coach Log (Jul 22)' }),
  W({ id: 'fartlek-light', name: 'Light fartlek 4x(1 hard / 2 float)', type: 'fartlek', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build'], level: 1, total_min: 30,
    main: '1 mi wu, 4x(1 min at 5K-mile effort / 2 min float), 1 mi cd', work: '4 min', paces: 'Jake: 1 min @ 6:30, float 8:30-9:00.',
    purpose: 'Gentle intensity re-entry with a float (steady, not walking) recovery.',
    cues: 'Stick to the prescribed rep length. Jake ran 2 min reps instead: great split, wrong dose.', progress: '6x(1/2), then 5x(2/2).', source: 'Jake XC Coach Log (Jul 24)' }),
  W({ id: 'fartlek-mona', name: 'Mona fartlek (20 min)', type: 'fartlek', races: ['3200', '5K', 'XC', '10K'], phase: ['build', 'peak'], level: 2, total_min: 45,
    main: '15 min wu, then 2x90s, 4x60s, 4x30s, 4x15s on, each followed by the same time float, 10 min cd', work: '20 min', paces: 'On at 5K pace or faster (shorter = faster); float at steady, not jog.',
    purpose: 'Famous Steve Moneghetti session. Builds the ability to surge and recover while still moving.',
    cues: 'The float is the workout: keep it honest.', progress: 'Run it on hills or grass.', source: 'Standard (Moneghetti)' }),
  W({ id: 'fartlek-pyramid', name: 'Pyramid fartlek 1-2-3-4-3-2-1', type: 'fartlek', races: ['3200', '5K', 'XC'], phase: ['build'], level: 2, total_min: 50,
    main: '15 min wu, 1-2-3-4-3-2-1 min on with half the time easy jog, 10 min cd', work: '16 min', paces: '1-2 min at 3200-5K effort, 3-4 min at 5K-10K effort.',
    purpose: 'Varied pace awareness. Good on an XC course.', cues: 'Come down the pyramid faster than you went up.', progress: 'Add a 5 min at the top.', source: 'Standard' }),
  W({ id: 'fartlek-xc-surge', name: 'XC surge fartlek', type: 'fartlek', races: ['XC'], phase: ['peak'], level: 2, total_min: 45,
    main: '15 min wu, 20 min at steady with a 30s surge every 2:30 (8 surges), 10 min cd', work: '20 min', paces: 'Steady base, surges at mile effort.',
    purpose: 'Simulates the pace changes of an XC race: passing, hills, the start.', cues: 'Go back to steady right after each surge; do not slow to a jog.',
    progress: 'Make the base pace closer to threshold.', source: 'Standard XC' }),
  W({ id: 'fartlek-minutes', name: '10x1 min on / 1 min off', type: 'fartlek', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build'], level: 1, total_min: 40,
    main: '10 min wu, 10x(1 min on / 1 min jog), 10 min cd', work: '10 min', paces: '3200-5K effort.', purpose: 'Simple, flexible VO2 intro.',
    cues: 'Use it on vacation or when there is no track.', progress: '12x, or 8x(90s/60s).', source: 'Standard' }),

  // ---------------------------------------------------------------- hills
  W({ id: 'hills-12', name: '12x hill, jog down', type: 'hills', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build'], level: 1, total_min: 45,
    main: '1.5 mi wu, 12x hill repeat (60-75s up) with jog-down recovery, 1.5 mi cd', work: '12-15 min', paces: 'Hard by effort (about 5K effort), not pace.',
    purpose: 'Strength and power. Builds XC hill confidence and protects against injury.', cues: 'Drive knees and arms, stay on the balls of your feet, crest the top running.',
    progress: 'Add 2 reps, or a longer hill.', source: 'Hawks plans 1-2 (Thursday menu)' }),
  W({ id: 'hills-short-sprints', name: '8x10s hill sprints', type: 'hills', races: RACES, phase: ['base', 'build', 'peak'], level: 1, total_min: 35,
    main: 'Easy run with 8x10s all-out on a steep hill at the end, full walk-down recovery (2 min)', work: '80 s', paces: 'Max effort, but short enough it never gets anaerobic.',
    purpose: 'Neuromuscular power and tendon strength. Almost zero fatigue cost.', cues: 'Start with 4. Steep hill, perfect form.', progress: 'Up to 10x12s.', source: 'Standard (Brad Hudson)' }),
  W({ id: 'hills-long', name: '6x2 min hill', type: 'hills', races: ['5K', 'XC', '10K'], phase: ['build'], level: 2, total_min: 50,
    main: '2 mi wu, 6x2 min up a long gradual hill at threshold-5K effort, jog down, 2 mi cd', work: '12 min', paces: 'Threshold to 5K effort.', purpose: 'Aerobic strength on hills. XC-specific.',
    cues: 'Even effort to the top. Run the downhill quick and relaxed.', progress: '8x2 min.', source: 'Standard XC' }),
  W({ id: 'hills-circuit', name: 'Hill circuit (up hard, over the top)', type: 'hills', races: ['XC'], phase: ['peak'], level: 2, total_min: 50,
    main: '2 mi wu, 6-8x(hill at 5K effort + 200m at 5K pace past the crest), easy jog back, 2 mi cd', work: '15 min', paces: '5K effort.',
    purpose: 'Practicing the XC move that wins races: pushing over the top of a hill.', cues: 'Most runners ease off at the crest. You do not.', progress: 'Extend past the crest to 300m.', source: 'Standard XC' }),

  // ---------------------------------------------------------------- strides / speed
  W({ id: 'strides-6x20', name: '6x20s strides, walk back', type: 'strides', races: RACES, phase: PHASES, level: 1, total_min: 8,
    main: 'After an easy run: 6x20s strides with 60-75s walk-back recovery', work: '2 min', paces: 'Jake: ~6:15/mi in weeks 1-2, ~5:50 week 3, ~5:25 week 4, ~5:00 week 5.',
    purpose: 'Keeps speed and form sharp all season with almost no cost.', cues: 'Walk back, do not jog: full recovery is the point.', progress: 'Pace drops a little each week, never the volume.', source: 'Jake XC Coach Log (Jul 27)' }),
  W({ id: 'strides-flys', name: '4x30m flys', type: 'strides', races: ['800', '1600', '3200'], phase: ['peak', 'taper'], level: 2, total_min: 25,
    main: 'Drills, then 4x(30m build + 30m fast + 30m float), full recovery', work: '2 min', paces: 'Near top speed in the middle 30m.', purpose: 'Top-end speed for track season kicks.',
    cues: 'Relaxed speed. Tension is slow.', progress: '6x.', source: 'Standard' }),
  W({ id: 'drills-form', name: 'Drill and form session', type: 'strides', races: RACES, phase: ['base', 'build'], level: 1, total_min: 20,
    main: 'A-skips, B-skips, high knees, butt kicks, carioca, straight-leg bounds (2x20m each), then 4 strides', work: 'drills', paces: 'Quality over speed.',
    purpose: 'Coordination, posture and efficiency.', cues: 'Do these before every workout as part of the warm-up.', progress: 'Add bounding and single-leg hops.', source: 'Standard' }),

  // ---------------------------------------------------------------- race specific
  W({ id: 'race-5k-broken', name: 'Broken 5K (2K-1600-800-400)', type: 'race_specific', races: ['5K', 'XC'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 2K - 1600 - 800 - 400 at goal 5K pace with 90s rest, 2 mi cd', work: '4.8K', paces: 'Goal 5K pace, last 400 faster.', purpose: 'A rehearsal of your goal race split into pieces.',
    cues: 'If you can run this on pace with 90s rest, the goal is realistic.', progress: 'Cut rests to 60s.', source: 'Standard' }),
  W({ id: 'race-xc-change', name: 'XC change-of-pace 3x(1K tempo + 400 fast)', type: 'race_specific', races: ['XC', '5K'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 3x(1K at threshold straight into 400 at 3200 pace), 3 min jog between sets, 2 mi cd', work: '4.2K', paces: 'Threshold into 3200 pace with no break.',
    purpose: 'Teaches you to throw in a surge while already tired: race tactics.', cues: 'The 400 is where races are won.', progress: '4 sets.', source: 'Standard XC' }),
  W({ id: 'race-mile-cut', name: 'Cutdown 1200-800-400', type: 'race_specific', races: ['1600', '3200'], phase: ['peak'], level: 2, total_min: 45,
    main: '2 mi wu + drills, 1200 at 3200 pace, 800 at mile pace, 400 faster than mile pace, 3-4 min rest, 1.5 mi cd', work: '2.4K', paces: '3200 -> mile -> faster.',
    purpose: 'Closing speed for track distance races.', cues: 'Run the 400 like the last lap of a race.', progress: 'Do it twice with 8 min between.', source: 'Standard' }),
  W({ id: 'race-10k-tempo-reps', name: '3x2 mi at 10K pace', type: 'race_specific', races: ['10K', 'Half'], phase: ['peak'], level: 3, total_min: 75,
    main: '2 mi wu, 3x2 mi at 10K pace with 3 min jog, 2 mi cd', work: '6 mi', paces: '10K pace.', purpose: 'Specific endurance for longer races.',
    cues: 'Patience in rep 1.', progress: '2x3 mi.', source: 'Standard' }),
  W({ id: 'race-half-mp', name: '2x4 mi at half pace', type: 'race_specific', races: ['Half'], phase: ['peak'], level: 3, total_min: 90,
    main: '2 mi wu, 2x4 mi at goal half-marathon pace with 1 mi easy, 2 mi cd', work: '8 mi', paces: 'Goal half pace (about tempo).', purpose: 'Half-marathon rehearsal.',
    cues: 'Practice fueling on the easy mile.', progress: '10 mi continuous at goal pace 3 weeks out.', source: 'Standard' }),
  W({ id: 'race-week-opener', name: 'Pre-race opener', type: 'race_specific', races: RACES, phase: ['taper'], level: 1, total_min: 30,
    main: '15-20 min easy, 4x200 at race pace with full recovery, 4 strides', work: '800', paces: 'Race pace, smooth.', purpose: 'Day-before-or-2-days-out sharpener: wakes the legs up without tiring them.',
    cues: 'Should leave you feeling fresh and a little restless.', progress: 'None.', source: 'Standard (shakeout + strides)' }),
  W({ id: 'race-week-light', name: 'Race-week workout (lighter)', type: 'race_specific', races: ['5K', 'XC'], phase: ['taper'], level: 1, total_min: 40,
    main: '1.5 mi wu, 2 mi of work (e.g. 4x800 or 3x1K at 5K pace), 1.5 mi cd', work: '2 mi', paces: '5K pace, no faster.', purpose: 'Matches the Hawks race-week "5 (2 WO)" day: sharp but short.',
    cues: 'Finish feeling like you could do two more.', progress: 'None: taper is about less.', source: 'Hawks plans 1-6 (race-week Thursday)' }),
  W({ id: 'shakeout', name: 'Shakeout', type: 'easy', races: RACES, phase: ['taper'], level: 1, total_min: 20,
    main: '2-3 mi very easy with 2-4 strides', work: 'strides', paces: 'Easy.', purpose: 'Day before or morning of a race. Loosens up, settles nerves.',
    cues: 'Optional on Friday for plans 5-6. Short and boring is perfect.', progress: 'None.', source: 'Hawks plans 5-6 (Friday shakeout)' }),

  // ---------------------------------------------------------------- time trials
  W({ id: 'tt-mile', name: 'Mile time trial', type: 'time_trial', races: ['800', '1600', '3200'], phase: ['build', 'peak'], level: 2, total_min: 40,
    main: '2 mi wu + drills + 4 strides, 1 mile all-out, 1.5 mi cd', work: '1 mi', paces: 'All out, even laps.', purpose: 'Fitness check and pace-calculator input.',
    cues: 'Lap 3 decides it.', progress: 'Repeat every 4-6 weeks.', source: 'Standard' }),
  W({ id: 'tt-3k', name: '3K / 2-mile time trial', type: 'time_trial', races: ['3200', '5K', 'XC'], phase: ['build'], level: 2, total_min: 45,
    main: '2 mi wu + strides, 3K or 2 mi at hard race effort, 2 mi cd', work: '2 mi', paces: 'Race effort.', purpose: 'Sets 5K training paces when there has been no recent race.',
    cues: 'Use the result to update your 5K pace (3200 time x ~1.65).', progress: 'Repeat mid-season.', source: 'Standard' }),
  W({ id: 'tt-5k-sim', name: '5K course rehearsal', type: 'time_trial', races: ['5K', 'XC'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 2 mi on the actual race course at goal pace, 2 min rest, 1 mi at goal pace, 2 mi cd', work: '3 mi', paces: 'Goal 5K pace.',
    purpose: 'Learn the course (Van Cortlandt hills, the flats) at race pace.', cues: 'Note where to push and where to hold on.', progress: 'Do it 10-14 days before the big race.', source: 'Standard XC' }),
];

export function findWorkouts({ type, race, phase, level, max_min, min_min, q } = {}) {
  const query = String(q || '').toLowerCase();
  return WORKOUTS.filter((w) =>
    (!type || w.type === type)
    && (!race || w.races.includes(race))
    && (!phase || w.phase.includes(phase))
    && (!level || w.level <= level)
    && (!max_min || w.total_min <= max_min)
    && (!min_min || w.total_min >= min_min)
    && (!query || `${w.name} ${w.main} ${w.purpose} ${w.source}`.toLowerCase().includes(query)));
}
