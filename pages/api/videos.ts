import type { NextApiRequest, NextApiResponse } from 'next'

const videos = [
  {
    id: 'cookies',
    url: '/api/video-file?id=cookies',
    user: 'baker_jane',
    caption: 'Cookie making demo',
    likes: 120
  },
  {
    id: 'manifest_hindi',
    url: '/api/video-file?id=manifest_hindi',
    user: 'mindful_vibes',
    caption: 'Manifest your dreams',
    likes: 340
  },
  {
    id: 'exercise',
    url: '/api/video-file?id=exercise',
    user: 'fit_daily',
    caption: 'Quick home workout',
    likes: 256
  }
]

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json(videos)
}
