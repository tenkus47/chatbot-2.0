import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { token, host } from './config.js'

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
    const response = await fetch(`${host}/api/auth/session`, {
      headers: { Cookie: token },
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
    console.log(req.body)
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: {
        Cookie: token,
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
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: {
        Cookie: token,
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


app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})