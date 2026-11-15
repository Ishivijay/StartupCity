import { ExternalLink, MapPin, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { IN_TOWN_ROLES, type InTownBoard, type InTownPost, type LineupPerson } from '../shared/in-town-schema'
import type { Startup } from '../shared/startup-schema'
import { useCity } from './store'

/**
 * Who is in Helsinki for the startup weeks: the lineups Junction and Slush published,
 * and people who add themselves. Nothing here is collected from social networks.
 */

const TOKENS = 'startup-city-in-town'
const readTokens = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(TOKENS) ?? '{}') } catch { return {} } }
const saveTokens = (tokens: Record<string, string>) => { try { localStorage.setItem(TOKENS, JSON.stringify(tokens)) } catch { /* the post can then only expire */ } }

const ROLE_LABEL: Record<(typeof IN_TOWN_ROLES)[number], string> = { founder: 'Founder', investor: 'Investor', operator: 'Operator', other: 'Visitor' }
const KIND_LABEL = { founder: 'Founder', investor: 'Investor', speaker: 'Speaker' } as const
type Filter = 'all' | 'posted' | 'founder' | 'investor'

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** A startup on the map whose name matches the organisation, if any. */
function matchOrganisation(organisation: string | null, startups: Startup[]) {
  if (!organisation) return null
  const parts = organisation.split(/,|\/| and /).map(norm).filter(Boolean)
  return startups.find((s) => {
    const name = norm(s.name)
    return name.length > 2 && parts.some((part) => part === name || part.startsWith(`${name} `))
  }) ?? null
}

function view(s: Startup) {
  const { select, scene, mode } = useCity.getState()
  select(s.location?.buildingId ?? null, s.id, s.location ? 'map' : null)
  if (s.location && mode === 'explorer') scene?.focusBuilding(s.location.buildingId)
}

export function InTown() {
  const startups = useCity((s) => s.startups)
  const [board, setBoard] = useState<InTownBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [tokens, setTokens] = useState(readTokens)

  const load = () => fetch('/api/in-town').then((r) => r.json()).then((data: InTownBoard) => { if (!Array.isArray(data?.lineup)) throw new Error('bad board'); setBoard({ ...data, posts: data.posts ?? [] }); setError(null) }).catch(() => setError('The board could not be loaded.'))
  useEffect(() => { void load() }, [])

  const placed = useMemo(() => startups.filter((s) => s.location && s.industry !== 'hub').sort((a, b) => a.name.localeCompare(b.name)), [startups])
  const q = norm(query)
  const hit = (...values: (string | null)[]) => !q || values.some((v) => v && norm(v).includes(q))
  const posts = (board?.posts ?? []).filter((p) => (filter === 'all' || filter === 'posted' || filter === p.role) && hit(p.name, p.company, p.lookingFor))
  const lineup = filter === 'posted' ? [] : (board?.lineup ?? []).filter((p) => (filter === 'all' || p.kind === filter) && hit(p.name, p.organisation, p.title))

  const remove = async (post: InTownPost) => {
    const token = tokens[post.id]
    if (!token) return
    await fetch(`/api/in-town/${post.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
    const next = { ...tokens }
    delete next[post.id]
    saveTokens(next); setTokens(next); void load()
  }

  return (
    <div className="sc-drawer-body sc-intown">
      <p className="sc-muted">Who is in Helsinki for Junction and Slush: the lineups the events published, and people who added themselves. Posts disappear after their last day.</p>
      {adding
        ? <PostForm placed={placed} onCancel={() => setAdding(false)} onDone={(post, token) => {
            const next = { ...tokens, [post.id]: token }
            saveTokens(next); setTokens(next); setAdding(false); setFilter('posted'); void load()
          }} />
        : <button type="button" className="sc-primary sc-intown-add" onClick={() => setAdding(true)}><Plus size={16} /> Add yourself</button>}

      <div className="sc-intown-tools">
        <label className="sc-intown-search"><Search size={15} /><input type="search" placeholder="Search names and companies" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" /></label>
        <div className="sc-chips" role="radiogroup" aria-label="Show">
          {([['all', 'Everyone'], ['posted', 'Posted'], ['founder', 'Founders'], ['investor', 'Investors']] as [Filter, string][]).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>

      {error && <p className="sc-missing">{error}</p>}
      {board && (
        <>
          <section>
            <h3 className="sc-intown-head">Posted by visitors <em>{posts.length}</em></h3>
            {posts.length === 0 && <p className="sc-missing">{board.posts.length ? 'No posts match.' : 'Nobody has posted yet. Be the first: say when you are here and what you are looking for.'}</p>}
            <ul className="sc-intown-list">
              {posts.map((p) => {
                const at = p.meetAt ? startups.find((s) => s.id === p.meetAt) : null
                return (
                  <li key={p.id} className="posted">
                    <p className="sc-intown-name"><b>{p.name}</b><span className={`sc-who ${p.role}`}>{ROLE_LABEL[p.role]}</span></p>
                    <p className="sc-muted">{p.company ? `${p.company}, ` : ''}in town {shortDate(p.from)} to {shortDate(p.to)}</p>
                    <p>{p.lookingFor}</p>
                    <div className="sc-row-actions">
                      {at && <button type="button" className="sc-text-btn" onClick={() => view(at)}><MapPin size={14} /> Meet at {at.name}</button>}
                      {p.link && <a className="sc-text-btn" href={p.link} target="_blank" rel="noopener noreferrer nofollow ugc"><ExternalLink size={14} /> Profile</a>}
                      {tokens[p.id] && <button type="button" className="sc-text-btn" onClick={() => void remove(p)}><Trash2 size={14} /> Remove my post</button>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
          {board.events.map((event) => {
            const people = lineup.filter((p) => p.event === event.id)
            if (!people.length && filter !== 'all') return null
            return (
              <section key={event.id}>
                <h3 className="sc-intown-head">{event.name} <em>{people.length}</em></h3>
                <p className="sc-muted">{event.dates}, {event.venue}. <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">Published lineup</a>{event.note ? `. ${event.note}` : ''}</p>
                <ul className="sc-intown-list">
                  {people.map((p) => <LineupRow key={p.id} person={p} startup={matchOrganisation(p.organisation, startups)} />)}
                </ul>
              </section>
            )
          })}
          <p className="sc-muted sc-intown-note">{board.note}</p>
        </>
      )}
    </div>
  )
}

function LineupRow({ person, startup }: { person: LineupPerson; startup: Startup | null }) {
  return (
    <li>
      <p className="sc-intown-name"><b>{person.name}</b><span className={`sc-who ${person.kind}`}>{person.role === 'Speaker' ? KIND_LABEL[person.kind] : person.role}</span></p>
      <p className="sc-muted">{[person.title, person.organisation].filter(Boolean).join(', ')}</p>
      {startup && (
        <div className="sc-row-actions">
          <button type="button" className="sc-text-btn" onClick={() => view(startup)}>{startup.location ? <><MapPin size={14} /> {startup.name} on the map</> : <>Open {startup.name}</>}</button>
        </div>
      )}
    </li>
  )
}

function PostForm({ placed, onCancel, onDone }: { placed: Startup[]; onCancel: () => void; onDone: (post: InTownPost, token: string) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ name: '', role: 'founder' as (typeof IN_TOWN_ROLES)[number], company: '', from: today, to: today < '2026-11-19' ? '2026-11-19' : today, lookingFor: '', link: '', meetAt: '', consent: false })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/in-town', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, meetAt: form.meetAt || null, consent: form.consent || undefined }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'The post could not be saved.')
      onDone(data.post, data.token)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The post could not be saved.')
    } finally { setBusy(false) }
  }

  return (
    <form className="sc-intown-form" onSubmit={submit} onKeyDown={(e) => e.stopPropagation()}>
      <header><h3>Add yourself</h3><button type="button" className="sc-icon" aria-label="Cancel" onClick={onCancel}><X size={16} /></button></header>
      <label>Name<input required minLength={2} maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" /></label>
      <div className="sc-intown-pair">
        <label>I am a<select value={form.role} onChange={(e) => set({ role: e.target.value as typeof form.role })}>{IN_TOWN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        <label>Company<input maxLength={60} value={form.company} onChange={(e) => set({ company: e.target.value })} autoComplete="organization" placeholder="Optional" /></label>
      </div>
      <div className="sc-intown-pair">
        <label>From<input type="date" required min={today} value={form.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To<input type="date" required min={form.from} value={form.to} onChange={(e) => set({ to: e.target.value })} /></label>
      </div>
      <label>Looking for<textarea required minLength={10} maxLength={160} rows={2} value={form.lookingFor} onChange={(e) => set({ lookingFor: e.target.value })} placeholder="Seed-stage climate teams, a coffee with Rust engineers..." /><small>{form.lookingFor.length} of 160</small></label>
      <label>Link to reach you<input type="url" maxLength={200} pattern="https://.*" value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://www.linkedin.com/in/... (optional)" /></label>
      <label>Meet near<select value={form.meetAt} onChange={(e) => set({ meetAt: e.target.value })}><option value="">Anywhere in Helsinki</option>{placed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="sc-check sc-intown-consent"><input type="checkbox" checked={form.consent} onChange={(e) => set({ consent: e.target.checked })} /> Publish this on the public board until my last day. I can remove it from this browser at any time.</label>
      <p className="sc-muted">Please leave out email addresses and phone numbers. Use the link instead.</p>
      {error && <p className="sc-intown-error" role="alert">{error}</p>}
      <button type="submit" className="sc-primary" disabled={busy || !form.consent}>{busy ? 'Publishing' : 'Publish'}</button>
    </form>
  )
}
