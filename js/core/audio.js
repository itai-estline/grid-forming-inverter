// Synthesised sound bed (PLAN 4.6). Off by default, no audio files.
// 60 Hz hum + soft harmonics, filtered-noise wind in the world; hum louder inside the machine.
export const AUDIO = {
  master: 0.32,
  hum: { world: 0.05, machine: 0.22 },
  wind: { world: 0.16, machine: 0.025 },
  harmonics: [[60, 1.0], [120, 0.5], [180, 0.22], [300, 0.08]],
  ramp: 1.2 // s
};

export function createAudio() {
  let ac = null, master, humGain, windGain, windFilter, lfo;
  let on = false;
  let space = 'world';

  function build() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    humGain = ac.createGain(); humGain.gain.value = AUDIO.hum.world; humGain.connect(master);
    const humFilter = ac.createBiquadFilter(); humFilter.type = 'lowpass'; humFilter.frequency.value = 420; humFilter.connect(humGain);
    for (const [f, a] of AUDIO.harmonics) {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = a * 0.5;
      o.connect(g); g.connect(humFilter); o.start();
    }
    // wind: looping noise through a slowly moving band-pass
    const len = ac.sampleRate * 4;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    windFilter = ac.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 380; windFilter.Q.value = 0.7;
    windGain = ac.createGain(); windGain.gain.value = AUDIO.wind.world;
    src.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); src.start();
    lfo = ac.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ac.createGain(); lfoGain.gain.value = 160;
    lfo.connect(lfoGain); lfoGain.connect(windFilter.frequency); lfo.start();
  }

  function apply() {
    if (!ac) return;
    const t = ac.currentTime;
    master.gain.setTargetAtTime(on ? AUDIO.master : 0, t, AUDIO.ramp / 3);
    humGain.gain.setTargetAtTime(AUDIO.hum[space] ?? AUDIO.hum.world, t, AUDIO.ramp / 3);
    windGain.gain.setTargetAtTime(AUDIO.wind[space] ?? AUDIO.wind.world, t, AUDIO.ramp / 3);
  }

  return {
    toggle() {
      on = !on;
      try {
        if (on && !ac) build();
        if (ac && ac.state === 'suspended') ac.resume();
        apply();
      } catch (e) { console.warn('[audio]', e); on = false; }
      return on;
    },
    setSpace(id) { if (id !== space) { space = id; apply(); } },
    get on() { return on; }
  };
}
