/*
 * beam_solver.js -- discrete dynamic Euler-Bernoulli beam.
 *
 *   mLin * v_tt + c * v_t + EI * v_xxxx = q(x, t)
 *
 * v(x,t) is the transverse displacement of one member of length L,
 * discretized into N+1 nodes (index 0..N, spacing h = L/N). v_xxxx is
 * approximated with the standard central 5-point stencil
 *
 *   v'''' (x_k) ~= ( v[k-2] - 4 v[k-1] + 6 v[k] - 4 v[k+1] + v[k+2] ) / h^4
 *
 * Each end is either:
 *   - "fixed":  both position (delta, a settlement/support-motion input)
 *               AND slope (theta, a rotation input) are prescribed.
 *   - "pinned": only position (delta) is prescribed; the natural
 *               zero-moment condition (zero curvature) closes the system.
 * Both cases are implemented with a single ghost node just outside each
 * end (v[-1] for the i end, v[N+1] for the j end) so the same 5-point
 * stencil above can be evaluated at the first and last INTERIOR nodes
 * (k = 1 and k = N-1) without special-casing them. See _ghost().
 *
 * NOTE ON "theta": this is the raw geometric slope dv/dx at that end in
 * this solver's own v-positive-downward convention. It is a physics-demo
 * quantity, not literally the clockwise-positive slope-deflection theta
 * taught in lecture (no slope-deflection equations are implemented or
 * displayed here -- this file only animates the underlying beam physics:
 * how a load or a support motion deforms the member, and how that shape
 * determines curvature).
 *
 * Time integration is explicit semi-implicit ("symplectic") Euler:
 *   vel[k] += accel[k] * dt;  v[k] += vel[k] * dt;
 * run over several fixed-size SUBSTEPS per animation frame, because the
 * 4th-spatial-derivative stiffness term makes this a stiff ODE system:
 * the discrete operator's largest eigenvalue grows like 1/h^4, so the
 * stable timestep shrinks like h^2 (see stableDt() below), not h.
 *
 * Runs unmodified as a browser <script src="beam_solver.js"> (attaches
 * `BeamSolver` on `window`) and as a Node module (`require`d by the
 * verification harness) -- no DOM/canvas dependency anywhere in this file.
 */

class BeamSolver {
  constructor({ N = 60, L = 1, EI = 1, mLin = 1, zeta = 0.08 } = {}) {
    this.N = N;
    this.L = L;
    this.h = L / N;
    this.EI = EI;
    this.mLin = mLin;

    // Viscous damping coefficient (per unit length), set from a target
    // damping ratio zeta on the beam's first vibration mode (simply
    // supported reference frequency omega1 = (pi/L)^2 * sqrt(EI/mLin)).
    // Only affects the transient "settle" look, not the final static
    // shape the verification harness checks against.
    const omega1 = (Math.PI / L) ** 2 * Math.sqrt(EI / mLin);
    this.c = 2 * zeta * mLin * omega1;

    this.v = new Array(N + 1).fill(0);
    this.vel = new Array(N + 1).fill(0);

    this.endI = { type: 'fixed', theta: 0, delta: 0 };
    this.endJ = { type: 'fixed', theta: 0, delta: 0 };
    // Eased (currently-applied) boundary targets. Sliders write into
    // these targets; step() drags {theta,delta} toward them with a
    // short time-constant lag so a slider change visibly "drags" the
    // beam into its new shape rather than teleporting it.
    this._endITarget = { theta: 0, delta: 0 };
    this._endJTarget = { theta: 0, delta: 0 };

    this.P = 0;
    this.xP = L / 2;
    this.w = 0;
  }

  setBoundary(endI, endJ) {
    if (endI) {
      if (endI.type) this.endI.type = endI.type;
      if (endI.theta !== undefined) this._endITarget.theta = endI.theta;
      if (endI.delta !== undefined) this._endITarget.delta = endI.delta;
    }
    if (endJ) {
      if (endJ.type) this.endJ.type = endJ.type;
      if (endJ.theta !== undefined) this._endJTarget.theta = endJ.theta;
      if (endJ.delta !== undefined) this._endJTarget.delta = endJ.delta;
    }
  }

  // Snap boundary state immediately to its target (used by the
  // verification harness so a static-solution check does not have to
  // wait out the easing lag; the animation itself lets step() ease).
  snapBoundary() {
    Object.assign(this.endI, this._endITarget);
    Object.assign(this.endJ, this._endJTarget);
    this.v[0] = this.endI.delta;
    this.v[this.N] = this.endJ.delta;
  }

  setLoad({ P = this.P, xP = this.xP, w = this.w } = {}) {
    this.P = P;
    this.xP = xP;
    this.w = w;
  }

  // Recommended stable dt for explicit sub-stepping. The pentadiagonal
  // stencil (1,-4,6,-4,1) has maximum eigenvalue 16/h^4 (Nyquist mode,
  // v_k = (-1)^k), giving omega_max = 4*sqrt(EI/(mLin*h^4)). Semi-implicit
  // Euler on a harmonic oscillator x'' = -omega^2 x is stable for
  // omega*dt <= 2; `safety` adds margin below that bound.
  stableDt(safety = 0.4) {
    const omegaMax = 4 * Math.sqrt(this.EI / (this.mLin * this.h ** 4));
    return (safety * 2) / omegaMax;
  }

  // sign = +1 for the left ghost node (index -1, next to node 0),
  // -1 for the right ghost node (index N+1, next to node N) -- flips
  // the central-difference slope formula's direction accordingly.
  _ghost(endType, v0, v1, slope, sign) {
    if (endType === 'fixed') {
      return v1 - sign * 2 * this.h * slope;
    }
    // pinned / natural boundary: zero curvature (zero moment) at the end
    return 2 * v0 - v1;
  }

  step(dt) {
    const { N, h, EI, mLin, c, v, vel } = this;

    const tau = 0.12; // seconds, easing time-constant for boundary drags
    const a = 1 - Math.exp(-dt / tau);
    this.endI.theta += (this._endITarget.theta - this.endI.theta) * a;
    this.endI.delta += (this._endITarget.delta - this.endI.delta) * a;
    this.endJ.theta += (this._endJTarget.theta - this.endJ.theta) * a;
    this.endJ.delta += (this._endJTarget.delta - this.endJ.delta) * a;

    v[0] = this.endI.delta;
    v[N] = this.endJ.delta;

    const vGhostLeft = this._ghost(this.endI.type, v[0], v[1], this.endI.theta, +1);
    const vGhostRight = this._ghost(this.endJ.type, v[N], v[N - 1], this.endJ.theta, -1);

    // nearest-node index for the point load (a discretized Dirac: P/h
    // at one node integrates to P over the node's h-wide strip)
    const kP = Math.max(1, Math.min(N - 1, Math.round(this.xP / h)));

    for (let k = 1; k <= N - 1; k++) {
      const vm2 = k - 2 < 0 ? vGhostLeft : v[k - 2];
      const vm1 = k - 1 < 0 ? vGhostLeft : v[k - 1];
      const vp1 = k + 1 > N ? vGhostRight : v[k + 1];
      const vp2 = k + 2 > N ? vGhostRight : v[k + 2];
      const d4v = (vm2 - 4 * vm1 + 6 * v[k] - 4 * vp1 + vp2) / h ** 4;
      let q = this.w;
      if (k === kP) q += this.P / h;
      const accel = (q - c * vel[k] - EI * d4v) / mLin;
      vel[k] += accel * dt;
    }
    for (let k = 1; k <= N - 1; k++) v[k] += vel[k] * dt;
  }

  // Advance by one animation-frame's worth of wall-clock time (seconds),
  // internally split into enough stable substeps. Returns the substep
  // count actually used (exposed for on-page diagnostics).
  advance(dtFrame, safety = 0.4) {
    const dt = this.stableDt(safety);
    const nSub = Math.max(1, Math.ceil(dtFrame / dt));
    const subDt = dtFrame / nSub;
    for (let i = 0; i < nSub; i++) this.step(subDt);
    return nSub;
  }

  // Curvature kappa(x) = v''(x) at every node, including the two ends
  // (via the same ghost-node values used internally).
  curvature() {
    const { N, h, v } = this;
    const kappa = new Array(N + 1).fill(0);
    const vGhostLeft = this._ghost(this.endI.type, v[0], v[1], this.endI.theta, +1);
    const vGhostRight = this._ghost(this.endJ.type, v[N], v[N - 1], this.endJ.theta, -1);
    for (let k = 0; k <= N; k++) {
      const vm1 = k === 0 ? vGhostLeft : v[k - 1];
      const vp1 = k === N ? vGhostRight : v[k + 1];
      kappa[k] = (vm1 - 2 * v[k] + vp1) / h ** 2;
    }
    return kappa;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BeamSolver };
}
if (typeof window !== 'undefined') {
  window.BeamSolver = BeamSolver;
}
