import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { host } from './config.js'
import { ensureCookies, getCookieHeaderForRequest, setCookiesFromUser } from './cookies.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'public')))

app.get('/', (req, res) => {
  res.send('Hello World')
})

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'chat.html'))
})

app.get('/api/user', async (req, res) => {
  try {
    await ensureCookies()
    const cookieHeader = getCookieHeaderForRequest()
    const response = await fetch(`${host}/api/auth/session`, {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    })
    const session = await response.json()
    if (!session?.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    return res.json(session.user)
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch session' })
  }
})



app.post('/api/chat/stream', async (req, res) => {
  try {
    await ensureCookies()
    const cookieHeader = getCookieHeaderForRequest()
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: {
        ...(cookieHeader && { Cookie: cookieHeader }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })
    if (!response.ok) {
      const text = await response.text()
      return res.status(response.status).send(text)
    }
    const contentType = response.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    const reader = response.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    }
    await pump()
  } catch (err) {
    res.status(502).json({ error: 'Failed to proxy chat stream' })
  }
})

app.post('/api/chat', async (req, res) => {
  try {
    await ensureCookies()
    const cookieHeader = getCookieHeaderForRequest()
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: {
        ...(cookieHeader && { Cookie: cookieHeader }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })
    res.status(response.status)
    const contentType = response.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    if (!response.body) {
      return res.end()
    }
    const reader = response.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    }
    await pump()
  } catch (err) {
    return res.status(502).json({ error: 'Failed to proxy chat' })
  }
})

/** Accept user-provided cookie string (e.g. pasted from browser DevTools) and use for melong.ai requests */
app.post('/api/cookies', async (req, res) => {
  try {
    const { cookies } = req.body
    if (typeof cookies !== 'string' || !cookies.trim()) {
      return res.status(400).json({ error: 'Body must include { "cookies": "name=value; ..." }' })
    }
    await setCookiesFromUser(cookies.trim())
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

app.listen(3000, async () => {
  await ensureCookies()
  console.log('Server is running on http://localhost:3000')
})