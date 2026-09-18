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
 * this solver's own v-positive-downward convention -- a physics-demo
 * quantity, not tied to any particular hand-analysis method's sign
 * convention for end rotation. No method name, equation, or worked
 * example is implemented or displayed anywhere on the page this file
 * drives -- it only animates the underlying beam physics: how a load
 * or a support motion produces end moments and support reactions.
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
  constructor({ N = 60, L = 1, EI = 1, mLin = 1, zeta = 0.35 } = {}) {
    this.N = N;
    this.L = L;
    this.h = L / N;
    this.EI = EI;
    this.mLin = mLin;

    // Strain-rate ("square-root"/structural-type) damping: the damping
    // force is -mu * d2(vel)/dx2 rather than mass-proportional -c*vel.
    // For sinusoidal (pinned-pinned) modes, omega_n = sqrt(EI/mLin)*k_n^2
    // gives the same damping ratio for every mode:
    //   zeta_n = mu*k_n^2 / (2*mLin*omega_n) = mu / (2*sqrt(EI*mLin))
    // For other end conditions the mode shapes are not exact sinusoids,
    // so zeta is approximately (not exactly) uniform across modes -- still
    // far better than mass-proportional damping, whose zeta_n ~ 1/omega_n
    // leaves high-mode ripple ringing (the "vibrates too much" complaint).
    // Only affects the transient "settle" look, not the final static
    // shape the verification harness checks against.
    this.mu = 2 * zeta * Math.sqrt(EI * mLin);
    this._acc = new Array(N + 1).fill(0); // scratch: per-substep accelerations

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
  // v_k = (-1)^k), giving omega_max = 4*sqrt(EI/(mLin*h^4)). With the
  // strain-rate damping term (velocity-Laplacian, max eigenvalue 4/h^2)
  // the semi-implicit Euler stability condition on the worst mode is
  //   omega^2*dt^2 + 2*(mu*4/h^2/mLin)*dt <= 4,
  // solved here as a quadratic in dt so large zeta values stay stable
  // (with mu = 0 this reduces to the undamped bound dt <= 2/omega).
  stableDt(safety = 0.4) {
    const A = (16 * this.EI) / (this.mLin * this.h ** 4); // omega_max^2
    const B = (2 * this.mu * 4) / (this.h * this.h * this.mLin);
    const dtMax = (-B + Math.sqrt(B * B + 16 * A)) / (2 * A);
    return safety * dtMax;
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
    const { N, h, EI, mLin, mu, v, vel } = this;

    const tau = 0.12; // seconds, easing time-constant for boundary drags
    const a = 1 - Math.exp(-dt / tau);
    const prevDI = this.endI.delta, prevDJ = this.endJ.delta;
    this.endI.theta += (this._endITarget.theta - this.endI.theta) * a;
    this.endI.delta += (this._endITarget.delta - this.endI.delta) * a;
    this.endJ.theta += (this._endJTarget.theta - this.endJ.theta) * a;
    this.endJ.delta += (this._endJTarget.delta - this.endJ.delta) * a;

    v[0] = this.endI.delta;
    v[N] = this.endJ.delta;
    // prescribed-end velocities from the easing increments, so the
    // damping term sees the true support motion instead of an
    // artificial zero (which would drag against moving supports)
    vel[0] = (this.endI.delta - prevDI) / dt;
    vel[N] = (this.endJ.delta - prevDJ) / dt;

    const vGhostLeft = this._ghost(this.endI.type, v[0], v[1], this.endI.theta, +1);
    const vGhostRight = this._ghost(this.endJ.type, v[N], v[N - 1], this.endJ.theta, -1);

    // nearest-node index for the point load (a discretized Dirac: P/h
    // at one node integrates to P over the node's h-wide strip)
    const kP = Math.max(1, Math.min(N - 1, Math.round(this.xP / h)));

    // Two-pass update: ALL accelerations are computed from the
    // unmodified velocity field first, THEN velocities are updated.
    // (A single fused loop would read vel[k-1] after this substep
    // already updated it -- a directional bias that breaks the
    // symmetric-Laplacian damping.)
    const acc = this._acc;
    for (let k = 1; k <= N - 1; k++) {
      const vm2 = k - 2 < 0 ? vGhostLeft : v[k - 2];
      const vm1 = k - 1 < 0 ? vGhostLeft : v[k - 1];
      const vp1 = k + 1 > N ? vGhostRight : v[k + 1];
      const vp2 = k + 2 > N ? vGhostRight : v[k + 2];
      const d4v = (vm2 - 4 * vm1 + 6 * v[k] - 4 * vp1 + vp2) / h ** 4;
      const d2vel = (vel[k - 1] - 2 * vel[k] + vel[k + 1]) / (h * h);
      let q = this.w;
      if (k === kP) q += this.P / h;
      acc[k] = (q + mu * d2vel - EI * d4v) / mLin;
    }
    for (let k = 1; k <= N - 1; k++) vel[k] += acc[k] * dt;
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

  // Engineering force outputs derived from the CURRENT shape, in the
  // sagging-positive convention: M(x) = -EI * v''(x) (the minus because
  // this file's v is positive DOWNWARD), shear V = dM/dx, and
  // upward-positive vertical support reactions R_i = V(0+), R_j = -V(L-)
  // (2nd-order one-sided differences at the ends). These are the
  // ELASTIC (structural) forces only: during the transient the damping
  // model also transmits a boundary traction ~ mu * d(vel)/dx that is
  // deliberately not shown -- it vanishes at rest, so the settled
  // values are the exact physical reactions.
  forces() {
    const kappa = this.curvature();
    const { N, h, EI } = this;
    const M = kappa.map((k) => -EI * k);
    const Vi = (-3 * M[0] + 4 * M[1] - M[2]) / (2 * h);
    const Vj = (3 * M[N] - 4 * M[N - 1] + M[N - 2]) / (2 * h);
    return { M, Mi: M[0], Mj: M[N], Ri: Vi, Rj: -Vj };
  }

  // Exact STATIC beam-theory solution for the current loads/boundaries:
  // EI v'''' = q solved in closed form as two polynomial segments split
  // at the point load (v = A0+A1 x+A2 x^2+A3 x^3 + w x^4/24EI per
  // segment), with 4 boundary conditions (fixed: v, v' prescribed;
  // pinned: v prescribed, v''=0) and 4 matching conditions at x=xP
  // (v, v', v'' continuous; EI*(v2'''-v1''') = P). Returns v(x) and the
  // sagging-positive bending moment M(x) = -EI v'' sampled at the nodes.
  // Uses the boundary TARGETS (what the sliders ask for), so the live
  // dynamic solution visibly settles onto this curve.
  staticTheory() {
    const { N, L, EI } = this;
    const a = Math.min(Math.max(this.xP, 1e-6), L - 1e-6);
    const P = this.P, w = this.w;
    const bI = { type: this.endI.type, ...this._endITarget };
    const bJ = { type: this.endJ.type, ...this._endJTarget };
    // unknowns: [A0,A1,A2,A3, B0,B1,B2,B3]
    const rows = [], rhs = [];
    const part = (x) => (w * x ** 4) / (24 * EI); // particular terms
    const part1 = (x) => (w * x ** 3) / (6 * EI);
    const part2 = (x) => (w * x ** 2) / (2 * EI);
    // end i (segment A at x=0)
    rows.push([1, 0, 0, 0, 0, 0, 0, 0]); rhs.push(bI.delta - part(0));
    if (bI.type === 'fixed') { rows.push([0, 1, 0, 0, 0, 0, 0, 0]); rhs.push(bI.theta - part1(0)); }
    else { rows.push([0, 0, 2, 0, 0, 0, 0, 0]); rhs.push(-part2(0)); }
    // end j (segment B at x=L)
    rows.push([0, 0, 0, 0, 1, L, L * L, L ** 3]); rhs.push(bJ.delta - part(L));
    if (bJ.type === 'fixed') { rows.push([0, 0, 0, 0, 0, 1, 2 * L, 3 * L * L]); rhs.push(bJ.theta - part1(L)); }
    else { rows.push([0, 0, 0, 0, 0, 0, 2, 6 * L]); rhs.push(-part2(L)); }
    // continuity at x=a: v, v', v''; shear jump EI*(vB'''-vA''')=P
    rows.push([1, a, a * a, a ** 3, -1, -a, -a * a, -(a ** 3)]); rhs.push(0);
    rows.push([0, 1, 2 * a, 3 * a * a, 0, -1, -2 * a, -3 * a * a]); rhs.push(0);
    rows.push([0, 0, 2, 6 * a, 0, 0, -2, -6 * a]); rhs.push(0);
    rows.push([0, 0, 0, -6, 0, 0, 0, 6]); rhs.push(P / EI);
    // gaussian elimination with partial pivoting (8x8)
    const n = 8;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[p][c])) p = r;
      [rows[c], rows[p]] = [rows[p], rows[c]]; [rhs[c], rhs[p]] = [rhs[p], rhs[c]];
      for (let r = 0; r < n; r++) {
        if (r === c || Math.abs(rows[c][c]) < 1e-14) continue;
        const f = rows[r][c] / rows[c][c];
        for (let cc = c; cc < n; cc++) rows[r][cc] -= f * rows[c][cc];
        rhs[r] -= f * rhs[c];
      }
    }
    const sol = rhs.map((b, k) => b / rows[k][k]);
    const A = sol.slice(0, 4), B = sol.slice(4, 8);
    const v = new Array(N + 1), M = new Array(N + 1);
    for (let k = 0; k <= N; k++) {
      const x = (k * L) / N;
      const C = x <= a ? A : B;
      v[k] = C[0] + C[1] * x + C[2] * x * x + C[3] * x ** 3 + part(x);
      const vpp = 2 * C[2] + 6 * C[3] * x + part2(x);
      M[k] = -EI * vpp;
    }
    return { v, M };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BeamSolver };
}
if (typeof window !== 'undefined') {
  window.BeamSolver = BeamSolver;
}
