import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'

const ALLOWED_FILES: Record<string, string> = {
  cookies: 'cookies_video.mp4',
  manifest_hindi: 'manifest_hindi_video.mp4',
  exercise: 'exercise_video.mp4',
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const fileId = (req.query.id as string) || 'cookies'
  const fileName = ALLOWED_FILES[fileId]

  if (!fileName) {
    res.status(400).send('Invalid video id')
    return
  }

  const filePath = path.join(process.cwd(), fileName)
  if (!fs.existsSync(filePath)) {
    res.status(404).send(`${fileName} not found on server`)
    return
  }

  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const range = req.headers.range

  res.setHeader('Content-Type', 'video/mp4')

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1
    const file = fs.createReadStream(filePath, { start, end })
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Length', chunkSize.toString())
    file.pipe(res)
  } else {
    res.setHeader('Content-Length', fileSize.toString())
    const file = fs.createReadStream(filePath)
    file.pipe(res)
  }
}
