import { readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { host } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COOKIE_FILE = join(__dirname, '..', '.melong-cookies.json')

/**
 * Parse Set-Cookie header value(s) into a jar: { name -> value }.
 * Each setCookie is "name=value; Path=/; HttpOnly" - we only keep name=value.
 */
function parseSetCookies(setCookieHeaders) {
  const jar = {}
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) return jar
  for (const raw of setCookieHeaders) {
    const part = raw.split(';')[0]?.trim()
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    jar[name] = value
  }
  return jar
}

/**
 * Merge cookies from a Cookie header string (e.g. from env or user paste) into the jar.
 */
function mergeCookieString(jar, cookieString) {
  if (!cookieString || typeof cookieString !== 'string') return
  const pairs = cookieString.split(';').map((s) => s.trim()).filter(Boolean)
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
}

/**
 * Fetch initial cookies from melong.ai by following redirects and collecting Set-Cookie.
 */
async function fetchCookiesFromMelong() {
  const jar = {}
  const urlsToTry = [
    `${host}/api/auth/csrf`,
    `${host}/api/auth/session`,
    host,
  ]
  const seen = new Set()

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'MelongProxy/1.0' },
      })
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      if (setCookies.length) {
        Object.assign(jar, parseSetCookies(setCookies))
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (location && !seen.has(location)) {
          seen.add(location)
          const next = location.startsWith('http') ? location : new URL(location, url).href
          urlsToTry.push(next)
        }
      }
    } catch (_) {
      // ignore per-URL errors
    }
  }

  return jar
}

/**
 * Load jar from file. Returns {} if file missing or invalid.
 */
async function loadJarFromFile() {
  try {
    const raw = await readFile(COOKIE_FILE, 'utf8')
    const data = JSON.parse(raw)
    return typeof data === 'object' && data !== null ? data : {}
  } catch {
    return {}
  }
}

/**
 * Save jar to file.
 */
async function saveJarToFile(jar) {
  await writeFile(COOKIE_FILE, JSON.stringify(jar, null, 2), 'utf8')
}

/**
 * Build the Cookie header string from a jar.
 */
function getCookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

// In-memory jar: fetched + env override + user-provided (API). Persisted to file when user sets cookies.
let cookieJar = {}

/**
 * Initialize cookie jar: load from file, then fetch from melong.ai if empty, then merge MELONG_COOKIES env.
 */
export async function initCookies() {
  cookieJar = await loadJarFromFile()
  const fromEnv = process.env.MELONG_COOKIES
  if (fromEnv) mergeCookieString(cookieJar, fromEnv)
  if (Object.keys(cookieJar).length === 0) {
    const fetched = await fetchCookiesFromMelong()
    Object.assign(cookieJar, fetched)
    if (Object.keys(cookieJar).length > 0) await saveJarToFile(cookieJar)
  }
  return cookieJar
}

/**
 * Get the Cookie header string to use for requests to melong.ai.
 */
export function getCookieHeaderForRequest() {
  return getCookieHeader(cookieJar)
}

/**
 * Update jar with user-provided cookie string (e.g. pasted from browser). Persists to file.
 */
export async function setCookiesFromUser(cookieString) {
  mergeCookieString(cookieJar, cookieString)
  await saveJarToFile(cookieJar)
  return cookieJar
}

/**
 * Ensure cookies are loaded (call before first request). Idempotent.
 */
let initPromise = null
export async function ensureCookies() {
  if (initPromise === null) initPromise = initCookies()
  return initPromise
}
