// Core configuration for the home page journey.
// Everything the lead is likely to tune lives here, in clearly named objects.

// Same hex values as css/tokens.css (PLAN section 2).
export const TOKENS = {
  ac: 0x3fe0ff, dc: 0xffab2e, ctl: 0xff4fd8, home: 0xffe2b0,
  inv1: 0x7cf29c, inv2: 0xb28dff, warn: 0xff6b4a,
  night0: 0x05070d, night1: 0x0a0f1c, night2: 0x111a2e, night3: 0x1b2740, night4: 0x2a3858,
  duskGlow: 0xe08a4a, ink: 0xece7e1,
  fea: [0x1c3cff, 0x18b8ff, 0x19e6a0, 0x8cf02a, 0xffe81a, 0xff8a14, 0xf0241c]
};

// The run order of the two 3D spaces. Station -> space comes from content/home.json.
export const SPACE_IDS = ['world', 'machine'];

// Big split headlines at the first and last station (the only copy not in home.json).
// Each word block: text, x / y = centre of the block as a fraction of the viewport (0..1,
// y measured from the top), depth = distance from the camera in scene units. Blocks with a
// depth are drawn inside the 3D scene, so nearer objects pass in front of the letters.
// depth 0 = drawn as plain DOM text on top of everything.
export const HEADLINES = {
  s01: {
    label: 'Who keeps the grid steady?',
    landscape: [
      { text: 'Who keeps', x: 0.27, y: 0.235, depth: 300 },
      { text: 'the grid', x: 0.755, y: 0.39, depth: 260 },
      { text: 'steady?', x: 0.4, y: 0.55, depth: 0 }
    ],
    portrait: [
      { text: 'Who keeps', x: 0.5, y: 0.2, depth: 300 },
      { text: 'the grid', x: 0.5, y: 0.305, depth: 260 },
      { text: 'steady?', x: 0.5, y: 0.41, depth: 0 }
    ]
  },
  s16: {
    label: 'Built in simulation',
    landscape: [
      { text: 'Built in', x: 0.3, y: 0.2, depth: 520 },
      { text: 'simulation', x: 0.66, y: 0.4, depth: 480 }
    ],
    portrait: [
      { text: 'Built in', x: 0.5, y: 0.17, depth: 520 },
      { text: 'simulation', x: 0.5, y: 0.265, depth: 480 }
    ]
  }
};

// Scroll feel.
export const SCROLL = {
  wheelPxPerStation: 1700,    // wheel / trackpad pixels for one station of weight 1
  touchScreensPerStation: 1.3, // swipe distance (in viewport heights) for one station
  maxStepPerEvent: 0.1,       // clamp for one wheel event, in stations
  smoothTime: 0.55,           // critically damped follow time (s)
  magnet: false,             // false = one continuous scroll, no pull to the nearest station
  magnetDelay: 0.2,           // s without input before the soft magnet pulls to a station
  magnetBias: 0.22,           // how far past a station (in the scroll direction) before the magnet picks the next one
  stationEase: 0.12,          // 0 = constant speed between stations, 1 = full smootherstep dwell at each station
  jumpVeilDistance: 1.6,      // goTo() further than this uses a short veil cut instead of flying the whole rail
  dragThresholdPx: 7,         // pointer travel before a drag counts as a touch moment
  textFadeStart: 0.3,         // |f| where the station text starts to fade
  textFadeEnd: 0.5,           // |f| where it is gone
  labelFade: 0.3              // |f| where projected labels are gone
};

// Space-change veil (PLAN 4.4), as fractions of the gap.
export const VEIL = { fadeInStart: 0.3, opaqueStart: 0.47, opaqueEnd: 0.52, fadeOutEnd: 0.61 };

// Camera feel.
export const CAMERA = {
  fov: 42,                    // default vertical fov when a pose gives none
  portraitAspect: 0.8,        // below this the layout and poses switch to portrait
  swayAmount: 0.0035,         // idle handheld sway, fraction of the camera-to-target distance
  parallaxAmount: 0.012,      // mouse parallax, fraction of the camera-to-target distance
  defaultClip: { near: 0.1, far: 5000 }
};

// Post-processing (PLAN 4.3).
export const POST = {
  exposure: 1.0,
  bloom: { strength: 0.62, radius: 0.55, threshold: 1.0 },
  grain: 0.06,
  vignette: 0.32,
  veilCentre: [0.012, 0.016, 0.03],
  veilEdge: [0.006, 0.008, 0.016]
};

// Quality tiers (PLAN 4.6). maxPixels caps the drawing buffer on very large screens.
export const QUALITY = {
  high:   { dpr: 2.0,  maxPixels: 4.4e6, bloomScale: 1.0, shadows: true,  shadowMap: 2048, aa: 'smaa', grain: true },
  medium: { dpr: 1.5,  maxPixels: 3.0e6, bloomScale: 0.5, shadows: true,  shadowMap: 1024, aa: 'fxaa', grain: true },
  low:    { dpr: 1.75, maxPixels: 1.8e6, bloomScale: 0.5, shadows: false, shadowMap: 0,    aa: 'fxaa', grain: true }
};
export const QUALITY_ORDER = ['high', 'medium', 'low'];
export const AUTO_QUALITY = { windowSeconds: 2, frameMsLimit: 24, settleSeconds: 3 };

export const PATHS = {
  content: 'content/home.json',
  stationImage: (id) => `assets/stations/${id}.webp`
};
