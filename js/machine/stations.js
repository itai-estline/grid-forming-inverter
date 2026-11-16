// Per-station tuning knobs for the machine space (s06..s14).
//
// frame:  camera framing from node bounds (+ hologram boxes).
//   nodes  node names whose union box is the subject
//   holos  hologram ids to include in the subject box
//   az/el  view direction in degrees (az 0 = from the front, CAD -Y side; +az swings toward +X,
//          the terminal side; el = height angle)
//   k      tightness: 1 = bounding sphere just fills the subject area, < 1 = closer
//   kp     same for portrait (aspect < 0.8). fov in degrees (portrait: fovP)
//   lift   extra target shift up, as a fraction of the subject radius
// focus:  extra nodes kept bright (added to content/home.json `focus`). 'all' = no dimming.
// ghost:  nodes turned smoked and mostly transparent at this station
// glow:   conductor groups -> [level, dash, pwm, sine, hot]; missing groups use BASE_GLOW
// lights: point-light intensities (amber at the caps, cyan moving with `cyanAt`, ctl over the
//         board, warn at the terminal)
// holos:  hologram ids shown at this station
// via:    extra camera path points (scene units) flown through on the way IN
// weight: relative scroll length of the gap leading in
// labels: [text, node name or [x,y,z] scene point, tone]

export const BASE_GLOW = {
  dc: [0.42, 0.55, 0, 0, 0],
  pin: [0.36, 0.2, 0.55, 0, 0],
  pout: [0.36, 0.2, 0, 0.6, 0],
  tap: [0.3, 0.1, 0, 0.6, 0],
  sig: [0.38, 0.75, 0, 0, 0]
};

export const STATIONS = {
  s06: {
    frame: { nodes: ['dclink_cap_1', 'dclink_cap_2'], az: 64, el: 42, k: 1.1, kp: 1.0, fov: 36, lift: 0.08 },
    focus: [], ghost: [],
    glow: { dc: [1.7, 0.7, 0, 0, 0] },
    lights: { amber: 6.5, cyan: 0, ctl: 0, warn: 0 }, cyanAt: 'ipm',
    holos: ['capfill'],
    weight: 3.8,
    labels: [['DC-LINK CAPACITORS', 'dclink_cap_2', 'dc']]
  },
  s07: {
    frame: { nodes: ['ipm', 'thermal_pad'], az: 18, el: 48, k: 4.2, kp: 3.8, fov: 36, lift: 0.05 },
    focus: ['ipm_pins', 'thermal_pad'], ghost: ['power_pcb', 'enclosure_base'],
    glow: { dc: [1.0, 0.9, 0, 0, 0], pin: [1.6, 0, 1, 0, 0] },
    lights: { amber: 3, cyan: 6, ctl: 0, warn: 0 }, cyanAt: 'ipm',
    holos: ['gates'],
    labels: [['IGBT MODULE', 'ipm', 'ac']]
  },
  s08: {
    frame: { nodes: ['inductor_a', 'inductor_b', 'inductor_c', 'filter_cap_a', 'filter_cap_b', 'filter_cap_c'], az: 6, el: 40, k: 0.9, kp: 0.95, fov: 38, lift: 0 },
    focus: [], ghost: ['control_board', 'standoffs'],
    glow: { pin: [1.3, 0, 1, 0, 0], pout: [1.7, 0, 0, 1, 0], tap: [1.2, 0, 0, 1, 0], dc: [0.3, 0.4, 0, 0, 0], sig: [0, 0, 0, 0, 0] },
    lights: { amber: 0, cyan: 11, ctl: 0, warn: 0 }, cyanAt: 'inductor_c',
    holos: ['coils'],
    labels: [['INDUCTORS', 'inductor_b', 'ac'], ['FILTER CAPACITORS', 'filter_cap_b', 'ac']]
  },
  s09: {
    frame: { nodes: ['control_board'], holos: ['flywheel'], az: -20, el: 30, k: 0.95, kp: 0.8, fov: 38, lift: 0 },
    focus: ['standoffs'], ghost: [],
    glow: { sig: [1.4, 1, 0, 0, 0] },
    lights: { amber: 0, cyan: 0, ctl: 2.5, warn: 0 }, cyanAt: 'control_board',
    holos: ['flywheel'],
    labels: [['CONTROLLER', 'control_board', 'ctl']]
  },
  s10: {
    frame: { nodes: ['control_board'], holos: ['flywheel', 'droop'], az: 30, el: 32, k: 0.92, kp: 0.8, fov: 38, lift: 0 },
    focus: ['standoffs'], ghost: ['enclosure_base'],
    glow: { sig: [1.1, 1, 0, 0, 0] },
    lights: { amber: 0, cyan: 0, ctl: 4.5, warn: 0 }, cyanAt: 'control_board',
    holos: ['flywheelSmall', 'droop'],
    labels: []
  },
  s11: {
    frame: { nodes: ['filter_cap_a', 'filter_cap_b', 'filter_cap_c', 'sensor_voltage'], holos: ['waves'], az: -6, el: 44, k: 0.92, kp: 0.82, fov: 38, lift: 0 },
    focus: [], ghost: [],
    glow: { tap: [1.6, 0, 0, 1, 0], pout: [0.9, 0, 0, 1, 0], sig: [0.8, 1, 0, 0, 0] },
    lights: { amber: 0, cyan: 9, ctl: 4, warn: 0 }, cyanAt: 'filter_cap_a',
    holos: ['waves'],
    labels: [['VOLTAGE SENSOR', 'sensor_voltage', 'ctl']]
  },
  s12: {
    frame: { nodes: ['sensor_current_a', 'sensor_current_b', 'sensor_current_c', 'terminal_block'], holos: ['current'], az: 56, el: 34, k: 0.88, kp: 0.86, fov: 38, lift: 0 },
    focus: ['terminal_block'], ghost: [],
    glow: { pout: [1.5, 0.2, 0, 1, 0], sig: [0.7, 1, 0, 0, 0] },
    lights: { amber: 0, cyan: 7, ctl: 0, warn: 0 }, cyanAt: 'sensor_current_b',
    holos: ['current', 'fault'],
    labels: [['CURRENT SENSORS', 'sensor_current_a', 'ac']]
  },
  s13: {
    frame: { nodes: ['heatsink', 'fan_frame'], az: -48, el: 16, k: 0.98, kp: 1.0, fov: 38, lift: 0.04 },
    focus: ['ipm_pins'], ghost: ['power_pcb', 'enclosure_base'],
    glow: {},
    lights: { amber: 0, cyan: 1.2, ctl: 0, warn: 0 }, cyanAt: 'heatsink',
    holos: ['streaks', 'fea'],
    via: [[18, 9, 16]],
    weight: 1.15,
    labels: [['HEATSINK', 'heatsink', 'warn'], ['FAN', 'fan_frame', 'ac']]
  },
  s14: {
    frame: { nodes: ['__both'], holos: ['bars'], az: 36, el: 30, k: 0.92, kp: 0.74, fov: 36, lift: 0 },
    focus: 'all', ghost: [],
    glow: {},
    lights: { amber: 0, cyan: 0, ctl: 0, warn: 0 }, cyanAt: 'ipm',
    holos: ['bars', 'unit2'],
    via: [[40, 28, 30]],
    weight: 1.2,
    labels: [['UNIT 1', '__unit1', 'inv1'], ['UNIT 2', '__unit2', 'inv2']]
  }
};

// Portals (scene units): where the camera enters from the world and leaves toward it
export const PORTALS = {
  entry: { position: [52, 34, 30], target: [15, 6, -10] },
  exit: { position: [70, 95, 70], target: [16, 0, -24] }
};

// s14 droop model (PLAN 6.2, verified defaults V13 / D26)
export const PARALLEL = {
  P0: 250, D1: 150, D2: 300,
  baseLoad: 905,       // 385 + 520 W
  stepLoad: 855,       // to 1760 W total -> 670 + 1090 W
  scaleMin: 0.5, scaleMax: 1.3,
  gap: 80,             // mm between the units along CAD Y
  maxW: 1150           // watts at full bar height
};

// Timelines (seconds)
export const TIMING = {
  capFill: 1.8,
  s09Period: 5.0, s09Bump: 1.6,
  s10Period: 8.0,
  s11Period: 3.6, s11Dist: 1.4,
  s12Period: 7.0, s12Fault: 2.0,
  s14Period: 9.0
};
