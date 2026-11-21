/**
 * Modified Nodal Analysis, the core of SPICE-style simulators.
 *
 * Each node (except ground) gets an unknown voltage. Kirchhoff's current law says the
 * currents leaving every node sum to zero, giving one linear equation per node:
 *     A · v = b
 * A holds conductances (1/R) between nodes and b holds injected currents. Every
 * component "stamps" its contribution into A and b. Nonlinear parts (diodes,
 * transistors, coming in Phase 2) are linearized around a guess and re-solved
 * until the solution stops changing (Newton-Raphson), using the same stamps.
 *
 * Node index -1 means ground (0 V); it has no row in the matrix.
 */
export class LinearSystem {
  readonly n: number;
  readonly A: Float64Array;
  readonly b: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.A = new Float64Array(n * n);
    this.b = new Float64Array(n);
  }

  /** A conductance g (siemens) between nodes i and j. */
  addConductance(i: number, j: number, g: number) {
    const { A, n } = this;
    if (i >= 0) A[i * n + i] += g;
    if (j >= 0) A[j * n + j] += g;
    if (i >= 0 && j >= 0) {
      A[i * n + j] -= g;
      A[j * n + i] -= g;
    }
  }

  /** A current (amps) injected INTO node i. */
  addCurrent(i: number, amps: number) {
    if (i >= 0) this.b[i] += amps;
  }

  /** Gaussian elimination with partial pivoting. Returns null if the matrix is singular. */
  solve(): Float64Array | null {
    const n = this.n;
    const A = Float64Array.from(this.A);
    const b = Float64Array.from(this.b);

    for (let col = 0; col < n; col++) {
      let pivot = col;
      let best = Math.abs(A[col * n + col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.abs(A[r * n + col]);
        if (v > best) {
          best = v;
          pivot = r;
        }
      }
      if (best < 1e-18) return null;
      if (pivot !== col) {
        for (let c = 0; c < n; c++) {
          const t = A[col * n + c];
          A[col * n + c] = A[pivot * n + c];
          A[pivot * n + c] = t;
        }
        const t = b[col];
        b[col] = b[pivot];
        b[pivot] = t;
      }
      const d = A[col * n + col];
      for (let r = col + 1; r < n; r++) {
        const f = A[r * n + col] / d;
        if (f === 0) continue;
        for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c];
        b[r] -= f * b[col];
      }
    }

    const x = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let c = r + 1; c < n; c++) s -= A[r * n + c] * x[c];
      x[r] = s / A[r * n + r];
    }
    return x;
  }
}
