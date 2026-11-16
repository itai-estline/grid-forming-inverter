// CAD reference data for the machine space.
// CAD frame: millimetres, Z up, origin at the enclosure's inside corner (PLAN 6.1).
// Scene frame: 1 mm = 0.1 scene unit, Y up: scene (x, y, z) = (CADx, CADz, -CADy) * 0.1.
// unit.glb is in glTF metres and gets scaled x100, which gives exactly the same frame.

export const MM = 0.1;

export function cad(THREE, x, y, z) {
  return new THREE.Vector3(x * MM, z * MM, -y * MM);
}

// Node table (PLAN 6.1). min = CAD min corner (mm), size = CAD size (mm).
// The three current sensors are NOT at the lead-suggested spots in the placeholder: those
// overlapped filter_cap_b, so the placeholder puts them in a column at x 256..268 between the
// filter capacitors and the PCB edge. If the real unit.glb has them elsewhere, the station
// framing follows the real nodes (all framing uses node bounds).
export const NODE_TABLE = {
  enclosure_base:   { min: [-1.5, -1.5, -1.5], size: [303, 203, 131.5], tier: 'A' },
  enclosure_lid:    { min: [-1.5, -1.5, 130],  size: [303, 203, 1.5],   tier: 'A' },
  fan_frame:        { min: [10, 60, 2],        size: [25, 80, 80],      tier: 'A' },
  fan_rotor:        { min: [10, 85, 27],       size: [25, 30, 30],      tier: 'A' },
  heatsink:         { min: [40, 50, 2],        size: [120, 100, 56],    tier: 'A' },
  thermal_pad:      { min: [82, 89.5, 58],     size: [36, 21, 0.25],    tier: 'A' },
  ipm:              { min: [82, 89.5, 58.2],   size: [36, 21, 3.1],     tier: 'A' },
  power_pcb:        { min: [40, 10, 76],       size: [240, 180, 1.6],   tier: '-' },
  dclink_cap_1:     { min: [42.5, 22.5, 77.6], size: [35, 35, 50],      tier: 'B' },
  dclink_cap_2:     { min: [42.5, 142.5, 77.6], size: [35, 35, 50],     tier: 'B' },
  inductor_a:       { min: [156, 11, 77.6],    size: [58, 58, 30],      tier: 'B' },
  inductor_b:       { min: [216, 11, 77.6],    size: [58, 58, 30],      tier: 'B' },
  inductor_c:       { min: [186, 76, 77.6],    size: [58, 58, 30],      tier: 'B' },
  filter_cap_a:     { min: [160, 140, 77.6],   size: [42, 30, 45],      tier: 'B' },
  filter_cap_b:     { min: [210, 140, 77.6],   size: [42, 30, 45],      tier: 'B' },
  filter_cap_c:     { min: [100, 150, 77.6],   size: [42, 30, 45],      tier: 'B' },
  control_board:    { min: [140, 20, 115],     size: [100, 70, 1.6],    tier: 'C' },
  terminal_block:   { min: [255, 150, 77.6],   size: [20, 40, 18],      tier: 'C' },
  sensor_current_a: { min: [256, 129, 77.6],   size: [12, 10, 14],      tier: 'C' },
  sensor_current_b: { min: [256, 87, 77.6],    size: [12, 10, 14],      tier: 'C' },
  sensor_current_c: { min: [256, 103, 77.6],   size: [12, 10, 14],      tier: 'C' },
  sensor_voltage:   { min: [150, 178, 77.6],   size: [12, 10, 14],      tier: 'C' }
};

export const REQUIRED_NODES = Object.keys(NODE_TABLE);
export const OPTIONAL_NODES = ['standoffs', 'screws', 'ipm_pins'];

// Expected centre of the power PCB in scene units. If the real model's PCB sits elsewhere,
// the conductor group is shifted by the difference so the glow stays on the board.
export const PCB_CENTRE_CAD = [160, 100, 76.8];

// Conductor routing over the power PCB (CAD mm). PCB top is z = 77.6.
// DC- runs flat on the board (z 80), DC+ is a raised bus (z 83.5) so the two can cross.
// Phases: IPM pins (y = 88 side) -> inductor a/b/c -> current sensors -> terminal AC pins.
// Taps are flying leads from each phase output to its filter capacitor.
// group: dc | pin (IPM to coil, chopped) | pout (after the coil, sine) | tap | sig
// phase: 0, 1, 2 for a, b, c (sets the 120 degree offset of the pulses / sine).
export const ROUTES = [
  // DC rails: terminal -> IPM, and the bus between the two DC-link capacitors
  { id: 'dcp_feed', group: 'dc', r: 1.5, pts: [[261, 184, 96], [261, 184, 90], [255, 176, 83.5], [148, 176, 83.5], [148, 124, 83.5], [90, 124, 83.5]] },
  { id: 'dcn_feed', group: 'dc', r: 1.5, pts: [[269, 184, 96], [269, 184, 88], [262, 172, 80], [152, 172, 80], [152, 120, 80], [96, 120, 80]] },
  { id: 'dcp_ipm', group: 'dc', r: 1.2, pts: [[90, 124, 83.5], [90, 115, 82], [90, 111, 74], [90, 111, 62]] },
  { id: 'dcn_ipm', group: 'dc', r: 1.2, pts: [[96, 120, 80], [96, 114, 79], [96, 111, 72], [96, 111, 62]] },
  { id: 'dcp_cap2', group: 'dc', r: 1.5, pts: [[62, 143, 86], [62, 124, 83.5], [90, 124, 83.5]] },
  { id: 'dcp_cap1', group: 'dc', r: 1.5, pts: [[62, 57, 86], [62, 124, 83.5]] },
  { id: 'dcn_cap2', group: 'dc', r: 1.5, pts: [[72, 143, 83], [72, 120, 80], [96, 120, 80]] },
  { id: 'dcn_cap1', group: 'dc', r: 1.5, pts: [[72, 57, 83], [72, 120, 80]] },

  // IPM -> filter inductors (chopped PWM)
  { id: 'pin_a', group: 'pin', phase: 0, r: 1.3, pts: [[100, 89, 62], [100, 88, 72], [100, 86, 80], [100, 44, 80], [106, 40, 80], [152, 40, 83]] },
  { id: 'pin_b', group: 'pin', phase: 1, r: 1.3, pts: [[106, 89, 62], [106, 88, 72], [106, 86, 80], [106, 73, 80], [224, 73, 80], [227, 63, 84]] },
  { id: 'pin_c', group: 'pin', phase: 2, r: 1.3, pts: [[112, 89, 62], [112, 88, 72], [112, 86, 80], [118, 80, 80], [160, 96, 80], [185, 104, 84]] },

  // inductors -> current sensors -> terminal (smooth sine)
  { id: 'pout_a', group: 'pout', phase: 0, r: 1.3, pts: [[187, 69, 86], [184, 75, 88], [183, 90, 88], [183, 126, 88], [188, 136, 84], [200, 137.5, 80], [250, 137.5, 80], [256, 134, 84.6], [268, 134, 84.6], [270, 140, 80], [270, 146, 80], [260, 155, 96]] },
  { id: 'pout_b', group: 'pout', phase: 1, r: 1.3, pts: [[251, 68, 84], [252, 76, 80], [252, 88, 82], [256, 92, 84.6], [268, 92, 84.6], [274, 94, 82], [278, 100, 80], [278, 146, 80], [272, 155, 96]] },
  { id: 'pout_c', group: 'pout', phase: 2, r: 1.3, pts: [[244, 105, 84], [250, 107, 82], [256, 108, 84.6], [268, 108, 84.6], [273, 112, 80], [274, 146, 80], [266, 155, 96]] },

  // flying leads to the filter capacitors
  { id: 'tap_a', group: 'tap', phase: 0, r: 0.9, smooth: true, pts: [[183, 118, 88], [183, 128, 104], [181, 138, 118], [181, 147, 122.8]] },
  { id: 'tap_b', group: 'tap', phase: 1, r: 0.9, smooth: true, pts: [[252, 84, 82], [251, 104, 108], [240, 128, 116], [231, 147, 122.8]] },
  { id: 'tap_c', group: 'tap', phase: 2, r: 0.9, smooth: true, pts: [[215, 132, 107], [196, 142, 124], [150, 160, 125.5], [126, 164, 122.8]] },   // review 3: arc kept under the lid (underside at 130)

  // control signals up to the control board (magenta)
  { id: 'sig_a', group: 'sig', r: 0.6, smooth: true, pts: [[262, 134, 91.6], [262, 126, 104], [250, 100, 116], [236, 82, 117.4]] },
  { id: 'sig_b', group: 'sig', r: 0.6, smooth: true, pts: [[262, 92, 91.6], [256, 90, 106], [236, 86, 117.4]] },
  { id: 'sig_c', group: 'sig', r: 0.6, smooth: true, pts: [[262, 108, 91.6], [258, 102, 106], [246, 92, 115], [236, 84, 117.4]] },
  { id: 'sig_v', group: 'sig', r: 0.6, smooth: true, pts: [[156, 183, 91.6], [156, 168, 126], [150, 120, 124], [148, 86, 117.4]] },
  { id: 'sig_ipm', group: 'sig', r: 0.6, smooth: true, pts: [[106, 111, 62], [106, 114, 78], [114, 110, 94], [130, 90, 110], [146, 70, 117.4]] }
];

// Fixed points used by stations (CAD mm)
export const POINTS = {
  dcTerminal: [265, 184, 96],
  acTerminal: [266, 155, 96],
  ipmTop: [100, 100, 61.4],
  heatSpot: [100, 100, 58],
  boardTop: [190, 55, 117]
};
