import { fmt } from '../sim/format';
import { pointKey } from '../sim/geometry';
import { useEditor } from './store';

export function Multimeter() {
  const mode = useEditor((s) => s.mode);
  const probes = useEditor((s) => s.probes);
  const sim = useEditor((s) => s.sim);
  if (mode.type !== 'probe' && !probes.red) return null;

  const vRed = probes.red ? sim.nodeVoltage.get(pointKey(probes.red)) : undefined;
  const vBlack = probes.black ? sim.nodeVoltage.get(pointKey(probes.black)) : undefined;

  let display = '----';
  let hint = 'Click a point to place the red (+) probe.';
  if (probes.red && !probes.black) hint = 'Now click a second point for the black (−) probe.';
  if (probes.red && probes.black) {
    if (vRed === undefined || vBlack === undefined) {
      display = 'OPEN';
      hint = "A probe is touching empty board. Put probes on pins or wire ends.";
    } else {
      const v = vRed - vBlack;
      display = Math.abs(v) < 0.0005 ? '0.000 V' : fmt(v, 'V', 4);
      hint = 'Voltage is always measured between TWO points: it\'s a difference in "push". Click again to start a new measurement.';
    }
  }

  return (
    <section className="panel meter">
      <h2>Multimeter · DC volts</h2>
      <div className="lcd">{display}</div>
      <p className="hint">{hint}</p>
    </section>
  );
}
