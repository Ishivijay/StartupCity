import { AnimatePresence, motion } from 'framer-motion'
import { Pause, Play, SkipForward } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cutsceneSchema, type Cutscene, type CutsceneRequest } from '../shared/cutscene-schema'
import { sound } from './audio'
import { useCity } from './store'

/** Playback state shared by the timers, the narration and the film. */
type Control = { paused: boolean; onChange: Set<() => void> }

/** Waits for `ms` of unpaused time, or until the signal aborts. */
const hold = (ms: number, signal: AbortSignal, control: Control) => new Promise<void>((resolve) => {
  let left = ms
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    if (!control.paused) left -= now - last
    last = now
    if (left <= 0 || signal.aborted) { clearInterval(timer); resolve() }
  }, 50)
  signal.addEventListener('abort', () => { clearInterval(timer); resolve() }, { once: true })
})

/** Reading time for a line when there is no voice. */
const readingMs = (line: string) => Math.max(2200, line.split(/\s+/).length * 300)

async function playLine(url: string | null, line: string, signal: AbortSignal, control: Control, audioRef: { current: HTMLAudioElement | null }) {
  if (!url || !sound.get().sound) return hold(readingMs(line), signal, control)
  const audio = new Audio(url)
  audioRef.current = audio
  const follow = () => { if (control.paused) audio.pause(); else void audio.play().catch(() => {}) }
  control.onChange.add(follow)
  try {
    if (!control.paused) await audio.play()
  } catch {
    // Autoplay blocked or audio missing: fall back to reading time.
    control.onChange.delete(follow)
    return hold(readingMs(line), signal, control)
  }
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    audio.addEventListener('ended', done, { once: true })
    audio.addEventListener('error', done, { once: true })
    signal.addEventListener('abort', () => { audio.pause(); done() }, { once: true })
  })
  control.onChange.delete(follow)
}

export function CutscenePlayer() {
  const request = useCity((s) => s.cutscene)
  const [scene, setScene] = useState<Cutscene | null>(null)
  const [index, setIndex] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [filmOn, setFilmOn] = useState(false)
  const [paused, setPaused] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const control = useRef<Control>({ paused: false, onChange: new Set() })
  const shotRef = useRef<AbortController | null>(null)

  const setPause = (on: boolean) => {
    control.current.paused = on
    setPaused(on)
    useCity.getState().scene?.holdCamera(on)
    const video = videoRef.current
    if (video) { if (on) video.pause(); else void video.play().catch(() => {}) }
    for (const fn of control.current.onChange) fn()
  }
  const next = () => { setPause(false); shotRef.current?.abort() }
  const close = () => useCity.setState({ cutscene: null })

  useEffect(() => {
    if (!request) return
    const controller = new AbortController()
    const { signal } = controller
    const store = useCity.getState()
    const city = store.scene
    if (!city) return
    const returnTo = store.mode
    const streetSpot = city.playerPosition()
    control.current = { paused: false, onChange: new Set() }
    setScene(null); setIndex(-1); setError(null); setFilmOn(false); setPaused(false)
    city.enterExplorer(undefined, 1.4)
    city.setCinematic(true)
    city.shoot('establish', null)
    sound.duck(true)

    const run = async () => {
      let script: Cutscene
      try {
        const response = await fetch('/api/cutscene', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request satisfies CutsceneRequest), signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'The cutscene could not be prepared.')
        script = cutsceneSchema.parse(data)
      } catch (failure) {
        if (signal.aborted) return
        setError(failure instanceof Error && failure.message ? failure.message : 'The cutscene could not be prepared.')
        await hold(2600, signal, control.current)
        return
      }
      if (signal.aborted) return
      setScene(script)
      const startups = useCity.getState().startups
      for (let i = 0; i < script.shots.length && !signal.aborted; i++) {
        const shot = script.shots[i]
        const step = new AbortController()
        shotRef.current = step
        const shotSignal = AbortSignal.any([signal, step.signal])
        // A generated establishing film plays under the opening line, then the live city takes over.
        const film = i === 0 && script.film
        if (film) {
          setFilmOn(true)
          // The film covers the screen, so the 3D city stops drawing until it ends.
          setTimeout(() => { if (!shotSignal.aborted) city.setRendering(false) }, 900)
        }
        const target = shot.focus ? startups.find((s) => s.id === shot.focus)?.location : null
        setIndex(i)
        if (target && i === script.shots.length - 1) useCity.getState().select(target.buildingId, shot.focus, null)
        const travel = city.shoot(shot.camera, target ? { x: target.x, z: target.z } : null)
        // Hold each shot for the longer of its narration and its camera move.
        const waits = [playLine(shot.audio, shot.line, shotSignal, control.current, audioRef), hold(travel * 1000 + 200, shotSignal, control.current)]
        if (film) waits.push(filmEnded(shotSignal))
        await Promise.all(waits)
        if (film) { city.setRendering(true); setFilmOn(false) }
      }
      if (!signal.aborted) await hold(500, signal, control.current)
    }

    /** Done when the film ends, fails, stalls before starting, or after 12 seconds of play. */
    const filmEnded = (shotSignal: AbortSignal) => new Promise<void>((resolve) => {
      const started = performance.now()
      const cap = hold(12_000, shotSignal, control.current)
      void cap.then(resolve)
      const check = () => {
        const video = videoRef.current
        const stalled = video && video.currentTime === 0 && !control.current.paused && performance.now() - started > 3000
        if (shotSignal.aborted || (video && (video.ended || video.error)) || stalled) return resolve()
        setTimeout(check, 200)
      }
      setTimeout(check, 400)
    })

    void run().finally(() => {
      audioRef.current?.pause()
      city.setRendering(true)
      city.holdCamera(false)
      sound.duck(false)
      if (useCity.getState().cutscene !== request) return
      city.setCinematic(false)
      useCity.setState({ cutscene: null })
      if (returnTo === 'street') city.enterStreet(streetSpot)
    })
    return () => {
      controller.abort()
      audioRef.current?.pause()
      city.setRendering(true)
      city.holdCamera(false)
      city.setCinematic(false)
      sound.duck(false)
    }
  }, [request])

  useEffect(() => {
    if (!request) return
    const keys = (event: KeyboardEvent) => {
      const action = { Escape: close, Enter: close, Space: () => setPause(!control.current.paused), ArrowRight: next }[event.code]
      if (!action) return
      event.preventDefault()
      event.stopImmediatePropagation()
      action()
    }
    window.addEventListener('keydown', keys, true)
    return () => window.removeEventListener('keydown', keys, true)
  }, [request])

  const shot = scene && index >= 0 ? scene.shots[index] : null
  const last = scene ? index >= scene.shots.length - 1 : true
  return (
    <AnimatePresence>
      {request && (
        <motion.div className="sc-cutscene" role="dialog" aria-label="Cutscene" aria-live="polite"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.24 }}>
          <AnimatePresence>
            {filmOn && scene?.film && (
              <motion.video key="film" ref={videoRef} className="sc-film" src={scene.film.src} poster={scene.film.poster} autoPlay muted playsInline preload="auto"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
            )}
          </AnimatePresence>
          <motion.i className="sc-bar top" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} exit={{ scaleY: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
          <motion.i className="sc-bar bottom" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} exit={{ scaleY: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
          <div className="sc-cut-top">
            <h2>{scene?.title ?? (error ? 'Cutscene unavailable' : 'Preparing the scene')}</h2>
            <span className="sc-cut-progress">
              {scene && index >= 0 && <span>{index + 1} of {scene.shots.length}</span>}
              <span className="sc-cut-controls">
                <button type="button" className="sc-cut-icon" disabled={!scene} aria-label={paused ? 'Play' : 'Pause'} title={paused ? 'Play (Space)' : 'Pause (Space)'} onClick={() => setPause(!paused)}>
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                </button>
                <button type="button" className="sc-cut-icon" disabled={!scene || last} aria-label="Next line" title="Next line (→)" onClick={next}><SkipForward size={15} /></button>
                <button type="button" onClick={close}>Skip <kbd>Esc</kbd></button>
              </span>
            </span>
          </div>
          {scene && index >= 0 && <i className="sc-cut-bar" style={{ width: `${((index + 1) / scene.shots.length) * 100}%` }} />}
          <div className="sc-cut-bottom">
            <AnimatePresence mode="wait">
              <motion.p key={shot?.line ?? error ?? 'loading'} className="sc-subtitle"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
                {shot?.line ?? error ?? 'Gemini is writing this scene from the company records.'}
              </motion.p>
            </AnimatePresence>
            <small>
              {paused ? 'Paused. Press Space or Play to continue. ' : ''}
              {scene
                ? `Written by ${scene.writer}${scene.voice ? `, voiced by ${scene.voice}` : ''}, using only the sourced records.${filmOn && scene.film ? ` Film generated by ${scene.film.model}${scene.film.faithful ? ' from a frame of the map' : ', an impression of Helsinki, not the map'}.` : ''}`
                : 'Narration is written and voiced by Gemini, using only the sourced records.'}
            </small>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
