import { useSyncExternalStore } from 'react'

/**
 * Sound settings and the soundtrack.
 *
 * The score is generated live with the Web Audio API: a slow, warm progression
 * in D major on soft pads, a felt piano that improvises short phrases over it,
 * a low bass and wind in the background, all in a long reverb. Nothing is
 * downloaded, and it never repeats exactly.
 *
 * "Sound" is the master switch: it also silences the engine's effects and the
 * cutscene narration. "Music" only turns the score on or off.
 */

export type SoundSettings = { sound: boolean; music: boolean; volume: number }

const STORAGE = 'startup-city-sound'
const DEFAULTS: SoundSettings = { sound: true, music: true, volume: 0.6 }

function load(): SoundSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Partial<SoundSettings>
    return {
      sound: typeof value.sound === 'boolean' ? value.sound : DEFAULTS.sound,
      music: typeof value.music === 'boolean' ? value.music : DEFAULTS.music,
      volume: typeof value.volume === 'number' ? Math.min(1, Math.max(0, value.volume)) : DEFAULTS.volume,
    }
  } catch { return { ...DEFAULTS } }
}

let settings = load()
const listeners = new Set<() => void>()

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12)

/** Two bars per chord. Pads are voiced close, with the colour notes on top. */
const CHORDS = [
  { root: 38, pad: [50, 57, 61, 64, 66], tones: [62, 66, 69, 73, 76] }, // Dmaj9
  { root: 35, pad: [50, 54, 57, 61, 64], tones: [59, 62, 66, 69, 74] }, // Bm11
  { root: 31, pad: [55, 59, 62, 66, 69], tones: [62, 66, 67, 71, 74] }, // Gmaj9
  { root: 33, pad: [52, 57, 59, 64, 66], tones: [64, 66, 69, 71, 76] }, // A6/9
]
/** D major pentatonic, the melody's home. */
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83]
/** Rhythms for one bar in eighth notes; 1 plays a note. */
const RHYTHMS = [
  [1, 0, 1, 0, 0, 1, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0],
  [0, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
]
const BEAT = 60 / 74

class Soundtrack {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private musicBus!: GainNode
  private tone!: BiquadFilterNode
  private dry!: GainNode
  private wet!: GainNode
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  private timer = 0
  private nextBar = 0
  private bar = 0
  private step = 4
  private night = true
  private ducked = false

  /** Browsers only allow sound after the visitor has interacted with the page. */
  unlock() {
    if (!this.ctx) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Context) return
      this.build(new Context())
    }
    if (this.ctx!.state === 'suspended' && !document.hidden) void this.ctx!.resume()
    this.apply()
  }

  private build(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -14
    limiter.ratio.value = 4
    this.master.connect(limiter).connect(ctx.destination)

    this.musicBus = ctx.createGain()
    this.tone = ctx.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.Q.value = 0.4
    this.tone.frequency.value = 3200
    this.dry = ctx.createGain()
    this.dry.gain.value = 0.7
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.55
    const reverb = ctx.createConvolver()
    reverb.buffer = this.impulse(4.8)
    this.tone.connect(this.dry).connect(this.musicBus)
    this.tone.connect(reverb).connect(this.wet).connect(this.musicBus)
    this.musicBus.connect(this.master)

    // Wind: soft filtered noise that swells and drifts.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
    const data = noise.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.12; data[i] = last }
    const source = ctx.createBufferSource()
    source.buffer = noise
    source.loop = true
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'bandpass'
    this.windFilter.frequency.value = 500
    this.windFilter.Q.value = 0.9
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    source.connect(this.windFilter).connect(this.windGain).connect(this.musicBus)
    source.start()

    this.nextBar = ctx.currentTime + 0.3
    this.timer = window.setInterval(() => this.schedule(), 250)
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend()
      else if (settings.sound) void this.ctx.resume()
    })
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!
    const length = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let channel = 0; channel < 2; channel++) {
      const d = buffer.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        const t = i / length
        d[i] = (Math.random() * 2 - 1) * (1 - t) ** 3 * (1 - Math.exp(-i / 900))
      }
    }
    return buffer
  }

  /** Applies the current settings with short fades. */
  apply() {
    window.__webworldEngine?.audio?.setMuted(!settings.sound)
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.master.gain.setTargetAtTime(settings.sound ? 1 : 0, now, 0.15)
    const music = settings.music ? settings.volume * (this.ducked ? 0.35 : 1) : 0
    this.musicBus.gain.setTargetAtTime(music * 0.9, now, settings.music ? 1.2 : 0.3)
    this.tone.frequency.setTargetAtTime(this.night ? 2400 : 4200, now, 2)
    if (!settings.sound) void this.ctx.suspend()
    else if (!document.hidden) void this.ctx.resume()
  }

  /** Quieter music while a narrator speaks. */
  duck(on: boolean) {
    this.ducked = on
    this.apply()
  }

  /** Darker and sparser at night, brighter by day. */
  setNight(night: boolean) {
    this.night = night
    this.apply()
  }

  private schedule() {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running' || !settings.music) {
      if (ctx) this.nextBar = Math.max(this.nextBar, ctx.currentTime + 0.3)
      return
    }
    while (this.nextBar < ctx.currentTime + 1.5) {
      this.playBar(this.nextBar)
      this.nextBar += BEAT * 4
      this.bar++
    }
  }

  private playBar(at: number) {
    const chord = CHORDS[Math.floor(this.bar / 2) % CHORDS.length]
    const length = BEAT * 4
    if (this.bar % 2 === 0) {
      for (const note of chord.pad) this.pad(midi(note), at, length * 2 + 2.5, 0.011)
      this.bass(midi(chord.root), at, length * 2 + 1.5)
    }
    // Wind drifts slowly from bar to bar.
    this.windFilter.frequency.setTargetAtTime(320 + Math.random() * 700, at, 2.5)
    this.windGain.gain.setTargetAtTime(0.08 + Math.random() * 0.18, at, 3)

    // Phrases of four bars, with the last bar of each eight left quieter so the music breathes.
    const phrase = this.bar % 8
    const rests = this.night ? [5, 5, 4] : [5, 4]
    const rhythm = phrase === 7 ? RHYTHMS[rests[Math.floor(Math.random() * rests.length)]] : RHYTHMS[Math.floor(Math.random() * (this.night ? 5 : 4))]
    rhythm.forEach((hit, i) => {
      if (!hit) return
      // A gentle random walk, pulled towards the chord's own notes.
      this.step = Math.max(0, Math.min(SCALE.length - 1, this.step + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]))
      let note = SCALE[this.step]
      if (Math.random() < 0.4) note = chord.tones.reduce((best, t) => (Math.abs(t - note) < Math.abs(best - note) ? t : best), chord.tones[0])
      const swing = (Math.random() - 0.5) * 0.03
      this.piano(midi(note), at + i * BEAT / 2 + swing, 0.05 + Math.random() * 0.025)
      // Now and then a soft octave answer.
      if (Math.random() < 0.12) this.piano(midi(note + 12), at + i * BEAT / 2 + BEAT * 1.5, 0.02)
    })
  }

  private pad(frequency: number, at: number, duration: number, level: number) {
    const ctx = this.ctx!
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    filter.Q.value = 0.3
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(level, at + 2.4)
    gain.gain.setValueAtTime(level, at + duration - 2.6)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    for (const cents of [-7, 6]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = frequency
      osc.detune.value = cents
      osc.connect(filter)
      osc.start(at)
      osc.stop(at + duration + 0.1)
    }
    filter.connect(gain).connect(this.tone)
  }

  private bass(frequency: number, at: number, duration: number) {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.07, at + 0.9)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain).connect(this.tone)
    osc.start(at)
    osc.stop(at + duration + 0.1)
  }

  /** A felt piano: a soft hammer, a quick bright part and a long round tail. */
  private piano(frequency: number, at: number, level: number) {
    const ctx = this.ctx!
    const out = ctx.createGain()
    out.gain.value = 1
    const pan = ctx.createStereoPanner?.()
    if (pan) { pan.pan.value = (Math.random() - 0.5) * 0.6; out.connect(pan).connect(this.tone) } else out.connect(this.tone)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(2600, at)
    filter.frequency.exponentialRampToValueAtTime(700, at + 1.6)
    filter.connect(out)
    for (const [ratio, amount, decay, type] of [[1, 1, 3.2, 'sine'], [1, 0.25, 1.6, 'triangle'], [2, 0.12, 0.8, 'sine'], [3, 0.04, 0.4, 'sine']] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = frequency * ratio
      osc.detune.value = (Math.random() - 0.5) * 4
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(level * amount, at + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
      osc.connect(gain).connect(filter)
      osc.start(at)
      osc.stop(at + decay + 0.05)
    }
  }
}

const soundtrack = new Soundtrack()

export const sound = {
  get: () => settings,
  set(partial: Partial<SoundSettings>) {
    settings = { ...settings, ...partial }
    try { localStorage.setItem(STORAGE, JSON.stringify(settings)) } catch { /* lasts for this visit */ }
    soundtrack.apply()
    for (const fn of listeners) fn()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  unlock: () => soundtrack.unlock(),
  duck: (on: boolean) => soundtrack.duck(on),
  setNight: (night: boolean) => soundtrack.setNight(night),
}

export function useSound() {
  return useSyncExternalStore(sound.subscribe, sound.get, sound.get)
}

/** Starts the soundtrack on the first click, tap or key, and wires the engine's sound button and M key. */
export function installSound() {
  const first = () => {
    sound.unlock()
    window.removeEventListener('pointerdown', first, true)
    window.removeEventListener('keydown', first, true)
  }
  window.addEventListener('pointerdown', first, true)
  window.addEventListener('keydown', first, true)
  window.addEventListener('sc-sound-toggle', () => sound.set({ sound: !settings.sound }))
  soundtrack.apply()
}
