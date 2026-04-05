import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { judgePiiRequest } from './pii-judge'

const API_KEY = process.env.MEMORIES_AI_API_KEY || ''
const BASE_URL = 'https://api.memories.ai/serve/api/v1'
const UNIQUE_ID = 'insta-ai-reels'
const LOG_FILE = path.join(process.cwd(), 'insta-ai.log')

function log(stage: string, message: string, data?: any) {
  const timestamp = new Date().toISOString()
  const entry = `[${timestamp}] [${stage}] ${message}${data !== undefined ? '\n  ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n  ') : ''}\n`
  fs.appendFileSync(LOG_FILE, entry)
}

async function uploadVideoFile(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath)
  const fileName = path.basename(filePath)
  const fileSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2)

  log('UPLOAD', `Reading file: ${fileName} (${fileSizeMB} MB)`)

  const formData = new FormData()
  formData.append('file', new Blob([fileBuffer], { type: 'video/mp4' }), fileName)
  formData.append('unique_id', UNIQUE_ID)

  log('UPLOAD', `Sending to ${BASE_URL}/upload ...`)

  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { Authorization: API_KEY },
    body: formData,
  })

  log('UPLOAD', `Response status: ${res.status}`)

  if (!res.ok) {
    const errorText = await res.text()
    log('UPLOAD', 'Upload failed', { status: res.status, body: errorText })
    throw new Error(`Upload failed: ${res.status}`)
  }

  const json = await res.json()
  log('UPLOAD', 'Response body', json)

  if (json.code !== '0000') throw new Error(`Upload error: ${json.msg}`)

  log('UPLOAD', `Got videoNo: ${json.data.videoNo}`)
  return json.data.videoNo as string
}

async function waitForParsed(videoNo: string, maxAttempts = 60, intervalMs = 5000): Promise<void> {
  log('POLL', `Waiting for video ${videoNo} to reach PARSE status (max ${maxAttempts} attempts, ${intervalMs}ms interval)`)

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `${BASE_URL}/get_private_video_details?video_no=${videoNo}&unique_id=${UNIQUE_ID}`,
      { headers: { Authorization: API_KEY } }
    )

    if (res.ok) {
      const json = await res.json()
      const status = json.data?.status
      log('POLL', `Attempt ${i + 1}: status = ${status}`)

      if (status === 'PARSE') {
        log('POLL', 'Video is parsed and ready')
        return
      }
      if (status === 'FAILED') {
        log('POLL', 'Video processing FAILED', json)
        throw new Error('Video processing failed on memories.ai')
      }
    } else {
      log('POLL', `Attempt ${i + 1}: HTTP ${res.status}`)
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  log('POLL', 'Timed out waiting for PARSE status')
  throw new Error('Timed out waiting for video to be parsed')
}

interface ChatResult {
  content: string
  sessionId: string
}

async function chatWithVideo(videoNo: string, prompt: string, sessionId?: string): Promise<ChatResult> {
  log('CHAT', `Sending chat request for video ${videoNo}`)
  log('CHAT', `Prompt: "${prompt}"`)
  if (sessionId) log('CHAT', `Session ID (follow-up): ${sessionId}`)

  const body: Record<string, any> = {
    video_nos: [videoNo],
    prompt,
    unique_id: UNIQUE_ID,
  }
  if (sessionId) body.session_id = sessionId

  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      Authorization: API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  log('CHAT', `Response status: ${res.status}`)

  if (!res.ok) {
    const errorText = await res.text()
    log('CHAT', 'Chat API error', { status: res.status, body: errorText })
    throw new Error(`Chat API error: ${res.status}`)
  }

  const text = await res.text()
  log('CHAT', 'Raw response', text)

  let content = ''
  let returnedSessionId = sessionId || ''

  try {
    const json = JSON.parse(text)

    if (json.data?.content) {
      content = json.data.content
    } else if (json.content) {
      content = json.content
    }

    if (json.data?.session_id) {
      returnedSessionId = String(json.data.session_id)
    }
  } catch {
    const lines = text.split('\n').filter(Boolean)
    const contentParts: string[] = []

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.startsWith('data:') ? line.slice(5) : line)
        if (parsed.type === 'content' && parsed.content) {
          contentParts.push(parsed.content)
        }
        if (parsed.sessionId) {
          returnedSessionId = String(parsed.sessionId)
        }
        if (parsed.code === 'SUCCESS' && parsed.data === 'Done') break
      } catch {
        // skip non-JSON lines
      }
    }

    content = contentParts.join('')
  }

  if (!content) content = 'No response from AI.'
  log('CHAT', `Final assembled response (${content.length} chars), sessionId: ${returnedSessionId}`)
  return { content, sessionId: returnedSessionId }
}

export const config = {
  maxDuration: 300,
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  log('REQUEST', `${req.method} /api/insta-ai`, { body: req.body })

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!API_KEY) {
    res.status(500).json({ error: 'MEMORIES_AI_API_KEY is not configured' })
    return
  }

  const ALLOWED_FILES: Record<string, string> = {
    cookies: 'cookies_video.mp4',
    manifest_hindi: 'manifest_hindi_video.mp4',
    exercise: 'exercise_video.mp4',
  }

  const { prompt, videoNo: existingVideoNo, sessionId, videoId, conversationHistory } = req.body as {
    prompt?: string
    videoNo?: string
    sessionId?: string
    videoId?: string
    conversationHistory?: string[]
  }

  // ── PII Guardrail: screen every prompt before it reaches memories.ai ──
  const rawPrompt = prompt || ''
  if (rawPrompt.trim()) {
    const verdict = judgePiiRequest(rawPrompt, conversationHistory)
    log('JUDGE', `Verdict: ${verdict.allowed ? 'ALLOWED' : 'BLOCKED'}`, {
      category: verdict.category,
      reason: verdict.reason,
    })

    if (!verdict.allowed) {
      res.status(200).json({
        response: verdict.reason,
        videoNo: existingVideoNo || null,
        sessionId: sessionId || null,
        blocked: true,
      })
      return
    }
  }

  // Follow-up message: video already uploaded and parsed
  if (existingVideoNo && prompt) {
    log('REQUEST', `Follow-up chat on video ${existingVideoNo}, session ${sessionId || 'new'}`)
    try {
      const result = await chatWithVideo(existingVideoNo, prompt, sessionId)
      log('REQUEST', 'Follow-up success!')
      res.status(200).json({ response: result.content, videoNo: existingVideoNo, sessionId: result.sessionId })
    } catch (err: any) {
      log('ERROR', err.message, { stack: err.stack })
      res.status(500).json({ error: err.message || 'Something went wrong' })
    }
    return
  }

  // Initial request: upload, parse, then chat
  const chatPrompt = prompt || 'Summarize this video and provide creative captions and hashtags for social media.'
  const fileKey = videoId || 'cookies'
  const fileName = ALLOWED_FILES[fileKey]

  if (!fileName) {
    res.status(400).json({ error: `Unknown video id: ${fileKey}` })
    return
  }

  const filePath = path.join(process.cwd(), fileName)
  if (!fs.existsSync(filePath)) {
    log('REQUEST', `Video file not found: ${filePath}`)
    res.status(404).json({ error: `${fileName} not found on server` })
    return
  }

  log('REQUEST', `Video file found: ${filePath}`)

  try {
    const videoNo = await uploadVideoFile(filePath)
    await waitForParsed(videoNo)
    const result = await chatWithVideo(videoNo, chatPrompt)
    log('REQUEST', 'Success! Sending response to client.')
    res.status(200).json({ response: result.content, videoNo, sessionId: result.sessionId })
  } catch (err: any) {
    log('ERROR', err.message, { stack: err.stack })
    res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
