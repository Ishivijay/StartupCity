import { config } from 'dotenv'

config({ quiet: true })

export const settings = {
  // Local runs stay private to this machine. Hosts like Cloud Run set PORT and expect every interface.
  host: process.env.HOST?.trim() || (process.env.PORT ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT || 8787),
  contextKey: process.env.CONTEXT_DEV_API_KEY?.trim(),
  // STARTUP_CITY_GEMINI_KEY wins over GEMINI_API_KEY, so a host that injects its own
  // GEMINI_API_KEY (Google AI Studio does) can still run on a key of your choice.
  geminiKey: process.env.STARTUP_CITY_GEMINI_KEY?.trim() || process.env.GEMINI_API_KEY?.trim(),
  // Fast interpretation, per-company research answers, ecosystem-wide analysis.
  geminiModels: {
    fast: process.env.GEMINI_MODEL_FAST?.trim() || 'gemini-4-hydrogen',
    research: process.env.GEMINI_MODEL_RESEARCH?.trim() || 'gemini-4-carbon',
    deep: process.env.GEMINI_MODEL_DEEP?.trim() || 'gemini-4-argon',
    voice: process.env.GEMINI_MODEL_VOICE?.trim() || 'gemini-3.8-flash-tts',
    voiceName: process.env.GEMINI_VOICE?.trim() || 'Aoede',
  },
}
