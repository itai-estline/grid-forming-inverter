// Shared navigation data for the detail pages.
// Same items and order as content/home.json -> site.menu, hard-coded here so
// the detail pages never need a fetch. If home.json changes, change this too.
// `short` is only used when the header has room to show the links in one row.

export const SITE = {
  logo: 'Grid-Forming Inverter',
  home: 'index.html',
  backLabel: 'Back to the journey',
  menuLabel: 'Explore the details',
  credit: 'Itai Estline · Independent project · Simulation and design, no hardware built',
  tools: 'MATLAB R2026a, Simulink, Simscape Electrical, Ansys Mechanical, Autodesk Fusion',
  illustrativeLabel: 'Illustrative model'
};

export const NAV = [
  { title: 'Grid-forming in the real world', short: 'Real world', href: 'real-world.html' },
  { title: 'Power stage and filter', short: 'Power stage', href: 'power-stage.html' },
  { title: 'Virtual inertia and droop', short: 'Inertia and droop', href: 'inertia-droop.html' },
  { title: 'The voltage loop', short: 'Voltage loop', href: 'voltage-loop.html' },
  { title: 'Current limiting and faults', short: 'Current limiting', href: 'current-limiting.html' },
  { title: 'Two inverters in parallel', short: 'Parallel', href: 'parallel.html' },
  { title: 'Packaging and thermal', short: 'Packaging', href: 'packaging-thermal.html' },
  { title: 'Side chapter: the dq frame', short: 'dq frame', href: 'dq-frame.html' },
  { title: 'Side chapter: PLL grid sync', short: 'PLL', href: 'pll.html' },
  { title: 'Build log, V1 to V13', short: 'Build log', href: 'build-log.html' },
  { title: 'What went wrong', short: 'What went wrong', href: 'what-went-wrong.html' },
  { title: 'Sources', short: 'Sources', href: 'sources.html' }
];

// Tier badge text used by the part viewer (PLAN 7.2).
export const TIER_TEXT = {
  B: 'Representative part, shape only',
  C: 'Typical part, not specified in this design'
};
