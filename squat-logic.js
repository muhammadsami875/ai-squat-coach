// squat-logic.js
// Pure maths + rep-counting state machine. No camera / DOM code here,
// so it can be tested with plain Node (see test-logic.mjs).

// Thresholds: yahan se coach ko strict ya easy bana sakte hain.
export const CONFIG = {
  standingAngle: 160,   // knee angle >= this  => standing tall
  startAngle: 145,      // knee angle <  this  => a rep has started
  minRepAngle: 130,     // must go below this to count as an attempt at all
  depthTarget: 100,     // knee angle <= this  => deep enough ("parallel")
  leanLimit: 65,        // torso lean from vertical (deg) above this => BACK flag
  leanPenaltyStart: 50, // score starts dropping above this lean
  heelRiseLimit: 0.06,  // heel lift (fraction of leg length) above this => HEELS flag
  heelPenaltyStart: 0.03,
  minRepSeconds: 0.6,   // faster than this is treated as jitter, not a rep
  smoothing: 0.5,       // 0..1, higher = less smoothing of the knee angle
  cleanScore: 70,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Angle (degrees) at point b formed by a-b-c. Points are {x,y} in PIXELS. */
export function angleDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!m) return 180;
  const cos = clamp((v1.x * v2.x + v1.y * v2.y) / m, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Torso lean: angle of the hip->shoulder line from vertical (0 = upright). */
export function torsoLeanDeg(shoulder, hip) {
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y; // image y grows downward, so flip
  return (Math.abs(Math.atan2(dx, dy)) * 180) / Math.PI;
}

/** Heel lift measure, normalised by leg size so it works at any distance. */
export function heelDelta(hip, knee, ankle, heel, footIndex) {
  const seg = dist(hip, knee) + dist(knee, ankle);
  if (!seg) return 0;
  return (footIndex.y - heel.y) / seg;
}

export class SquatAnalyzer {
  constructor(config = {}) {
    this.cfg = { ...CONFIG, ...config };
    this.target = 5;
    this.reset();
  }

  reset() {
    this.phase = 'idle'; // idle -> standing <-> down
    this.angle = null;
    this.baseline = null; // heel baseline while standing
    this.rep = null;
    this.reps = [];
  }

  get done() {
    return this.reps.length >= this.target;
  }

  /**
   * Feed one frame. Returns a finished-rep object when a rep completes, else null.
   * t = seconds, kneeAngle/lean in degrees, heelD from heelDelta().
   */
  update({ t, kneeAngle, lean = 0, heelD = 0 }) {
    const c = this.cfg;
    this.angle =
      this.angle === null
        ? kneeAngle
        : this.angle + c.smoothing * (kneeAngle - this.angle);
    const a = this.angle;

    if (this.phase === 'idle') {
      if (a >= c.standingAngle) {
        this.phase = 'standing';
        this.baseline = heelD;
      }
      return null;
    }

    if (this.phase === 'standing') {
      if (a >= c.standingAngle) {
        this.baseline += 0.1 * (heelD - this.baseline);
      }
      if (a < c.startAngle) {
        this.phase = 'down';
        this.rep = { tStart: t, tMin: t, minAngle: a, maxLean: lean, maxRise: 0 };
      }
      return null;
    }

    // phase === 'down'
    const r = this.rep;
    if (a < r.minAngle) {
      r.minAngle = a;
      r.tMin = t;
    }
    r.maxLean = Math.max(r.maxLean, lean);
    r.maxRise = Math.max(r.maxRise, heelD - this.baseline);

    if (a >= c.standingAngle) {
      this.phase = 'standing';
      this.rep = null;
      r.tEnd = t;
      const tooShort = r.tEnd - r.tStart < c.minRepSeconds;
      if (r.minAngle > c.minRepAngle || tooShort || this.done) return null;
      return this._finish(r);
    }
    return null;
  }

  _finish(r) {
    const c = this.cfg;
    const flags = [];
    if (r.minAngle > c.depthTarget) flags.push('depth');
    if (r.maxLean > c.leanLimit) flags.push('back');
    if (r.maxRise > c.heelRiseLimit) flags.push('heels');

    const depthPen = clamp((r.minAngle - c.depthTarget) * 1.2, 0, 50);
    const leanPen = clamp((r.maxLean - c.leanPenaltyStart) * 1.0, 0, 25);
    const heelPen = clamp((r.maxRise - c.heelPenaltyStart) * 500, 0, 25);
    const score = Math.round(clamp(100 - depthPen - leanPen - heelPen, 0, 100));

    const rep = {
      index: this.reps.length + 1,
      tStart: r.tStart,
      tEnd: r.tEnd,
      tMin: r.tMin,
      minAngle: Math.round(r.minAngle),
      maxLean: Math.round(r.maxLean),
      heelRise: +Math.max(0, r.maxRise).toFixed(3),
      lowerTime: +(r.tMin - r.tStart).toFixed(2),
      flags,
      score,
      good: flags.length === 0 && score >= c.cleanScore,
    };
    this.reps.push(rep);
    return rep;
  }
}
