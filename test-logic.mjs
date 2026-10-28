// Run:  node test-logic.mjs
// Synthetic squats ke saath rep counter ko check karta hai (camera ki zaroorat nahi).
import { SquatAnalyzer, angleDeg, torsoLeanDeg } from './squat-logic.js';

let failed = 0;
const check = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failed++;
};

// --- geometry ---
check('straight leg = 180 deg', Math.round(angleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })) === 180);
check('right angle = 90 deg', Math.round(angleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })) === 90);
check('upright torso = 0 lean', Math.round(torsoLeanDeg({ x: 5, y: 0 }, { x: 5, y: 10 })) === 0);
check('45 deg torso lean', Math.round(torsoLeanDeg({ x: 10, y: 0 }, { x: 0, y: 10 })) === 45);

// --- simulated session at 30 fps ---
const a = new SquatAnalyzer();
a.target = 10;
let t = 0;
const dt = 1 / 30;

function frame(angle, lean = 20, heelD = 0) {
  t += dt;
  return a.update({ t, kneeAngle: angle, lean, heelD });
}
function stand(sec = 1) {
  for (let i = 0; i < sec * 30; i++) frame(175);
}
// one squat: down to `minAngle` and back over `dur` seconds
function squat(minAngle, { lean = 30, heel = 0, dur = 2.4 } = {}) {
  const n = Math.round(dur * 30);
  let rep = null;
  for (let i = 0; i <= n; i++) {
    const phase = Math.sin((i / n) * Math.PI); // 0 -> 1 -> 0
    const angle = 175 - (175 - minAngle) * phase;
    const r = frame(angle, 20 + (lean - 20) * phase, heel * phase);
    if (r) rep = r;
  }
  // return to standing so the rep can finish
  for (let i = 0; i < 20; i++) {
    const r = frame(175);
    if (r) rep = r;
  }
  return rep;
}

stand();
const r1 = squat(85);
const r2 = squat(118);
const r3 = squat(90, { heel: 0.1 });
const r4 = squat(92, { lean: 78 });
const jitter = squat(142, { dur: 0.5 });
const r5 = squat(80);

check('rep 1 (deep, clean) counted as good', r1 && r1.good && r1.score >= 90);
check('rep 2 (shallow) flagged depth, not clean', r2 && !r2.good && r2.flags.includes('depth'));
check('rep 3 (heels up) flagged heels', r3 && !r3.good && r3.flags.includes('heels'));
check('rep 4 (leaning) flagged back', r4 && !r4.good && r4.flags.includes('back'));
check('tiny wobble is ignored', jitter === null || jitter === undefined);
check('rep 5 counted after the wobble', r5 && r5.good && r5.index === 5);
check('total reps = 5', a.reps.length === 5);
check('lowering time is sensible (0.5-2s)', r1.lowerTime > 0.5 && r1.lowerTime < 2);

// --- target limit ---
const b = new SquatAnalyzer();
b.target = 1;
let tt = 0;
const f2 = (ang) => b.update({ t: (tt += dt), kneeAngle: ang });
for (let i = 0; i < 30; i++) f2(175);
for (let k = 0; k < 2; k++) {
  for (let i = 0; i <= 60; i++) f2(175 - 90 * Math.sin((i / 60) * Math.PI));
  for (let i = 0; i < 20; i++) f2(175);
}
check('stops counting after target reached', b.reps.length === 1 && b.done);

console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
