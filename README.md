# Electronix

A browser game for learning electronics: place parts, draw wires, and watch where current flows and where it stops. Parts burn out, batteries short, and every failure explains *why*.

```
npm install
npm run dev     # http://localhost:5173
npm test        # simulator unit tests
```

**Controls:** V select · W wire · M multimeter · T rotate · Del delete · Esc cancel · Ctrl+Z undo · Space pause/play the clock

**Parts:** B battery · R resistor · L bulb · S switch · E LED · D diode · C capacitor · Q NPN transistor

**Code map:** `src/sim/` is the pure-TypeScript circuit solver: Modified Nodal Analysis, Newton-Raphson with SPICE-style junction limiting and pseudo-transient continuation, and backward-Euler time stepping for capacitors. There's one file per component in `src/sim/components/`. `src/editor/` is the React/SVG board. `src/game/` holds examples and, later, levels.

---

## My input: what's feasible and what isn't
- **Current flow and voltages: fully feasible.** I'll use Modified Nodal Analysis (MNA), the method SPICE uses, in roughly 300 lines of TypeScript. Animated "electron dots" move along the wires at a speed proportional to the current. Wires that carry no current go grey. A part that gets no voltage is shown as dead.
- **Failure modes: feasible and the best teaching tool.** Each part has ratings: an LED's maximum current, a resistor's wattage, a battery's internal resistance. Going over a rating produces a "burn" (smoke animation, part blackened), a short-circuit warning, a warm-battery warning, or a reverse-polarity warning. Each failure explains *why* it happened.
- **Diodes, LEDs and transistors: feasible**, using nonlinear models solved with Newton-Raphson iteration (a simplified Shockley diode and Ebers-Moll BJT). This is where "how transistors work" becomes visual: a small base current switches a large collector current.
- **Capacitors and anything that changes over time** (RC timers, blinking): feasible as a time-stepped simulation, but it comes in a later phase.
- **Transformers: possible, but only with AC simulation**, which needs a time-domain simulation with inductors. Planned as a late phase. Until then, a lesson can teach the concept with an interactive animation instead of the full solver.
- **Soldering: can't be meaningfully simulated.** It's a physical skill. Instead, the game has **Bench Missions**: after finishing a level in the game, you get a checklist for building the same circuit for real. That covers breadboard first, then soldering on perfboard, with technique tips, safety notes and a self-check ("does the LED light? measure X with a multimeter, you should read ~Y V"). The **multimeter** tool in the game is the bridge, because you practise probing virtually and then do it for real.

## Learning roadmap (the level map)
Worlds unlock in order. Each level has a goal, a parts budget, and a pass check that the simulator evaluates.

1. **World 1 – Circuits 101:** closed loop, battery + bulb, switch, series vs parallel, short circuit (a deliberate failure level).
2. **World 2 – Ohm's Law:** resistors, voltage/current/resistance, color codes, voltage dividers, the multimeter (V, A, Ω), power and heat.
3. **World 3 – Diodes & LEDs:** polarity, forward voltage, current-limiting resistor (burn the LED once on purpose), sizing resistors.
4. **World 4 – Transistors:** the NPN as a switch, base resistor, driving a buzzer/motor, the flyback diode, the transistor as an amplifier (intro).
5. **World 5 – Capacitors & Time:** charge/discharge, RC time constant, debounce, two-transistor astable blinker, intro to the 555 timer.
6. **World 6 – Bench skills (in parallel from World 2 on):** breadboard layout, reading schematics, soldering basics, perfboard, desoldering, safety.
7. **World 7 – AC & Magnetism:** AC vs DC, inductors, transformers (turns ratio, step-down), rectifier + smoothing cap = a simple power supply.
8. **(Optional) World 8 – Microcontrollers:** the bridge to Arduino.

## Architecture
```
electronix/
  src/
    sim/            # pure TS, no React — testable in isolation
      netlist.ts    # build nodes from parts + wires (union-find on connected pins)
      mna.ts        # matrix assembly + Gaussian elimination / LU
      newton.ts     # nonlinear iteration (diodes, BJTs)
      transient.ts  # (phase 3) time stepping for C/L
      components/   # one file per part: stamp(), ratings, failure check
        battery.ts resistor.ts wire.ts switch.ts led.ts diode.ts npn.ts capacitor.ts ...
      evaluate.ts   # results -> per-part state: ok | dead | overloaded | burnt | shorted
    editor/         # React canvas: grid, drag parts, draw wires, rotate, delete
      Board.tsx PartView.tsx WireView.tsx FlowAnimation.tsx Multimeter.tsx
    game/
      levels/       # JSON/TS level defs: goal, allowed parts, pass predicate, lessons
      progress.ts   # unlocked levels, stars (localStorage)
      LessonPanel.tsx FailureCard.tsx BenchMission.tsx
    App.tsx
  tests/sim/        # Vitest: known circuits with hand-calculated answers
```
- **Stack:** Vite + React + TypeScript, with SVG rendering (crisp, easy hit-testing, fine for dozens of parts). Zustand for editor state, Vitest for tests. No backend; progress is saved in localStorage.
- **Simulation loop:** each edit triggers rebuilding the netlist, an MNA solve, and evaluation. The UI then colors the wires, sets the animation speed, and shows part status. A DC solve is instant for circuits this size.
- **Component interface:** `{ pins, stamp(matrix, state), ratings, check(result) -> Failure[] }`. Adding a new part means adding one file.
- **Level pass checks** are small functions over the sim result, e.g. `led1.current between 10–20 mA && no failures`.

## Phased milestones
1. ✅ **Phase 1 – Sandbox MVP:** grid editor, battery/wire/resistor/switch/bulb, linear MNA, current-flow animation, multimeter, short-circuit detection. *Outcome: build circuits and watch them work.*
2. **Phase 2 – Game layer + World 1–3:** level system, lessons, failure cards, LED/diode via Newton-Raphson, burn effects, Bench Mission checklists.
3. ✅ (sandbox parts done) **Phase 3 – World 4–5:** NPN transistor model, transient simulation, capacitors, time-based animations (blinking LED).
4. **Phase 4 – World 6–7:** schematic/breadboard view toggle, soldering mission content, inductors, AC source, transformer, rectifier.
5. **Polish:** sounds, stars/scoring (fewest parts, lowest power), free-play sandbox, optional hosting on GitHub Pages.

## Verification
- **Sim unit tests (Vitest)**, checked against hand-calculated values: a 9V source with a 1kΩ resistor gives 9mA; a voltage divider gives the expected midpoint; parallel resistors; LED + 330Ω at 5V gives about 9mA; a short circuit is flagged; an NPN switch saturates with the right base current; an RC circuit reaches 63% at τ.
- **Manual check:** run `npm run dev`, build each World 1 level in the browser, and confirm the animation, the failures and the pass detection. I'll use browser automation to take screenshots of key states.
- **Real-world check:** the Bench Mission readings for the generic kit (9V/5V, 220–1kΩ resistors, red LEDs, 2N2222/BC547) should match what a multimeter actually shows.


Progress is tracked in [GitHub issues](https://github.com/jonashatschek/electronix/issues).
