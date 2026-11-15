import { z } from 'zod'

/**
 * "In town": who is in Helsinki for the startup weeks.
 * Two sources only: lineups the events published themselves, and people who post themselves.
 * Nothing is scraped from social networks.
 */

export const IN_TOWN_ROLES = ['founder', 'investor', 'operator', 'other'] as const

export type LineupPerson = {
  id: string
  name: string
  title: string | null
  organisation: string | null
  kind: 'founder' | 'investor' | 'speaker'
  event: string
  role: string
  sourceUrl: string
  sourceName: string
}

export type InTownEvent = { id: string; name: string; dates: string; from: string; to: string; venue: string; sourceUrl: string; note?: string }

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-18.')
// Contact details belong behind the visitor's own link, never in the post text.
const noContact = (value: string) => !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(value) && !/\+?\d[\d\s().-]{7,}\d/.test(value)
const text = (min: number, max: number) => z.string().trim().min(min).max(max)
  .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' '))
  .refine(noContact, 'Leave out email addresses and phone numbers. Add a link instead.')

export const inTownPostInput = z.object({
  name: text(2, 60),
  role: z.enum(IN_TOWN_ROLES),
  company: text(0, 60).optional().default(''),
  from: day,
  to: day,
  lookingFor: text(10, 160),
  link: z.string().trim().max(200).optional().default('')
    .refine((value) => value === '' || /^https:\/\/[^\s]+$/.test(value), 'Links must start with https://'),
  meetAt: z.string().max(80).nullable().optional().default(null),
  consent: z.literal(true, { message: 'Tick the box to publish your post.' }),
}).refine((post) => post.to >= post.from, { message: 'The last day is before the first day.', path: ['to'] })

export type InTownPostInput = z.input<typeof inTownPostInput>

export type InTownPost = {
  id: string
  name: string
  role: (typeof IN_TOWN_ROLES)[number]
  company: string
  from: string
  to: string
  lookingFor: string
  link: string
  meetAt: string | null
  createdAt: string
}

export type InTownBoard = { events: InTownEvent[]; lineup: LineupPerson[]; posts: InTownPost[]; retrievedAt: string; note: string }
