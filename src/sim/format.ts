const PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
];

/** Format with an SI prefix: fmt(0.0148, 'A') → "14.8 mA", fmt(4700, 'Ω') → "4.7 kΩ". */
export function fmt(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const a = Math.abs(value);
  if (a < 1e-10) return `0 ${unit}`;
  for (const [f, p] of PREFIXES) {
    if (a >= f * 0.9995) return `${Number((value / f).toPrecision(digits))} ${p}${unit}`;
  }
  return `${Number((value / 1e-9).toPrecision(digits))} n${unit}`;
}
