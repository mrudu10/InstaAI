import React, { useEffect, useState } from 'react'
import Head from 'next/head'
import VideoCard from '../components/VideoCard'

type Video = { id: string; url: string; user: string; caption: string; likes: number }

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([])

  useEffect(() => {
    fetch('/api/videos')
      .then((r) => r.json())
      .then((data) => setVideos(data))
      .catch((e) => console.error(e))
  }, [])

  return (
    <>
      <Head>
        <title>Reels Clone</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="app-shell">
        <div className="phone-frame">
          <div className="reels-container">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
