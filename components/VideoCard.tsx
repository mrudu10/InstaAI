import React, { useEffect, useRef, useState, useCallback } from 'react'

type Video = { id: string; url: string; user: string; caption: string; likes: number }
type ChatMessage = { role: 'user' | 'assistant'; text: string; blocked?: boolean }

const DEFAULT_PROMPT = 'Summarize this video and provide creative captions and hashtags for social media.'

function readBool(key: string, fallback = false) {
  if (typeof window === 'undefined') return fallback
  try {
    const v = localStorage.getItem(key)
    return v === '1'
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {}
}

function formatAiText(raw: string): React.ReactNode[] {
  const lines = raw.split('\n')
  const nodes: React.ReactNode[] = []
  let key = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      nodes.push(<div key={key++} className="ai-fmt-spacer" />)
      continue
    }

    // Headings: ### or ##
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/)
    if (headingMatch) {
      nodes.push(<div key={key++} className="ai-fmt-heading">{cleanBold(headingMatch[1])}</div>)
      continue
    }

    // Numbered list: 1. or 1)
    const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/)
    if (numberedMatch) {
      nodes.push(
        <div key={key++} className="ai-fmt-point">
          <span className="ai-fmt-num">{numberedMatch[1]}.</span>
          <span>{cleanBold(numberedMatch[2])}</span>
        </div>
      )
      continue
    }

    // Bullet: - or *
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/)
    if (bulletMatch) {
      nodes.push(
        <div key={key++} className="ai-fmt-point">
          <span className="ai-fmt-bullet" />
          <span>{cleanBold(bulletMatch[1])}</span>
        </div>
      )
      continue
    }

    // Hashtag lines
    if (trimmed.startsWith('#') && !trimmed.startsWith('##')) {
      const tags = trimmed.match(/#\w+/g)
      if (tags && tags.length > 1) {
        nodes.push(
          <div key={key++} className="ai-fmt-tags">
            {tags.map((tag, i) => <span key={i} className="ai-fmt-tag">{tag}</span>)}
          </div>
        )
        continue
      }
    }

    // Quoted caption lines
    const quoteMatch = trimmed.match(/^"(.+)"$/)
    if (quoteMatch) {
      nodes.push(<div key={key++} className="ai-fmt-quote">{quoteMatch[1]}</div>)
      continue
    }

    // Regular text
    nodes.push(<div key={key++} className="ai-fmt-text">{cleanBold(trimmed)}</div>)
  }

  return nodes
}

function cleanBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  )
}

export default function VideoCard({ video }: { video: Video }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [liked, setLiked] = useState<boolean>(() => readBool(`liked_${video.id}`))
  const [saved, setSaved] = useState<boolean>(() => readBool(`saved_${video.id}`))
  const [likesCount, setLikesCount] = useState<number>(video.likes + (liked ? 1 : 0))
  const [optionsOpen, setOptionsOpen] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [modalExpanded, setModalExpanded] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [videoNo, setVideoNo] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const modalRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragCurrentY = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            el.play().catch(() => {})
          } else {
            el.pause()
            el.currentTime = 0
          }
        })
      },
      { threshold: [0.6] }
    )

    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    writeBool(`liked_${video.id}`, liked)
  }, [liked, video.id])

  useEffect(() => {
    writeBool(`saved_${video.id}`, saved)
  }, [saved, video.id])

  useEffect(() => {
    setLikesCount(video.likes + (liked ? 1 : 0))
  }, [liked, video.likes])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Node
      const menu = document.getElementById(`options-${video.id}`)
      if (!menu) return
      if (!menu.contains(target)) setOptionsOpen(false)
    }
    if (optionsOpen) document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [optionsOpen, video.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, aiLoading])

  const stopRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setAiLoading(false)
  }, [])

  const sendMessage = useCallback(async (prompt: string, isInitial: boolean) => {
    if (aiLoading || !prompt.trim()) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setAiLoading(true)
    setAiError(null)

    const updatedMessages: ChatMessage[] = [...messages, { role: 'user' as const, text: prompt }]
    setMessages(updatedMessages)

    try {
      const body: Record<string, any> = { prompt }
      if (!isInitial && videoNo) {
        body.videoNo = videoNo
        if (sessionId) body.sessionId = sessionId
      } else {
        body.videoId = video.id
      }

      body.conversationHistory = updatedMessages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.text)

      const res = await fetch('/api/insta-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const data = await res.json()

      if (!res.ok) {
        setAiError(data.error || 'Something went wrong')
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: data.response, blocked: !!data.blocked },
        ])
        if (data.videoNo) setVideoNo(data.videoNo)
        if (data.sessionId) setSessionId(data.sessionId)
        setModalExpanded(true)
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages((prev) => [...prev, { role: 'assistant', text: 'Request stopped.' }])
      } else {
        setAiError(err.message || 'Network error')
      }
    } finally {
      setAiLoading(false)
      abortRef.current = null
    }
  }, [aiLoading, videoNo, sessionId, messages])

  const handleAiClick = useCallback(() => {
    if (modalVisible) {
      setModalExpanded(true)
      inputRef.current?.focus()
      return
    }

    setAiError(null)
    setModalVisible(true)

    const hasHistory = messages.length > 0
    setModalExpanded(hasHistory)
    setChatInput(hasHistory ? '' : DEFAULT_PROMPT)

    setTimeout(() => inputRef.current?.focus(), 100)
  }, [modalVisible, messages.length])

  const handleSend = useCallback(() => {
    if (!chatInput.trim() || aiLoading) return
    const msg = chatInput.trim()
    setChatInput('')
    const isInitial = videoNo === null
    sendMessage(msg, isInitial)
  }, [chatInput, aiLoading, videoNo, sendMessage])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const closeModal = useCallback(() => {
    stopRequest()
    setModalVisible(false)
    setModalExpanded(false)
    setAiError(null)
  }, [stopRequest])

  const handleDragStart = useCallback((clientY: number) => {
    dragStartY.current = clientY
  }, [])

  const handleDragMove = useCallback((clientY: number) => {
    if (dragStartY.current === null || !modalRef.current) return
    const delta = clientY - dragStartY.current
    dragCurrentY.current = delta
    if (delta > 0) {
      modalRef.current.style.transform = `translateY(${delta}px)`
    } else {
      setModalExpanded(true)
      modalRef.current.style.transform = ''
    }
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragStartY.current === null || !modalRef.current) return
    const delta = dragCurrentY.current

    if (delta > 80) {
      if (modalExpanded) {
        setModalExpanded(false)
      } else {
        closeModal()
      }
    } else if (delta < -40) {
      setModalExpanded(true)
    }

    modalRef.current.style.transform = ''
    dragStartY.current = null
    dragCurrentY.current = 0
  }, [modalExpanded, closeModal])

  return (
    <div className="video-card">
      <video
        ref={ref}
        src={video.url}
        className="video"
        playsInline
        muted
        loop
        preload="metadata"
      />

      <div className="video-info">
        <div className="user">@{video.user}</div>
        <div className="caption">{video.caption}</div>
      </div>

      <div className="controls">
        <button aria-label="insta-ai" className="control-btn ai" onClick={handleAiClick}>
          <span className="icon">✨</span>
        </button>

        <button
          aria-label="like"
          className={`control-btn like ${liked ? 'active' : ''}`}
          onClick={() => setLiked((s) => !s)}
        >
          <span className="icon">{liked ? '❤️' : '🤍'}</span>
          <div className="count">{likesCount}</div>
        </button>

        <button aria-label="save" className={`control-btn save ${saved ? 'active' : ''}`} onClick={() => setSaved((s) => !s)}>
          <span className="icon">{saved ? '🔖' : '📥'}</span>
        </button>

        <div className="options-wrapper" id={`options-${video.id}`}>
          <button aria-label="options" className="control-btn options" onClick={() => setOptionsOpen((s) => !s)}>
            <span className="icon">⋯</span>
          </button>
          {optionsOpen && (
            <div className="options-menu">
              <button className="option-item">Report</button>
              <button className="option-item">Not interested</button>
              <button
                className="option-item"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(window.location.href + `?video=${video.id}`)
                  }
                  setOptionsOpen(false)
                }}
              >
                Copy link
              </button>
            </div>
          )}
        </div>
      </div>

      {modalVisible && (
        <>
          <div className="ai-modal-backdrop" onClick={closeModal} />
          <div
            ref={modalRef}
            className={`ai-modal ${modalExpanded ? 'expanded' : 'collapsed'}`}
          >
            <div
              className="ai-modal-drag-zone"
              onTouchStart={(e) => handleDragStart(e.touches[0].clientY)}
              onTouchMove={(e) => handleDragMove(e.touches[0].clientY)}
              onTouchEnd={handleDragEnd}
              onMouseDown={(e) => handleDragStart(e.clientY)}
              onMouseMove={(e) => { if (dragStartY.current !== null) handleDragMove(e.clientY) }}
              onMouseUp={handleDragEnd}
              onMouseLeave={() => { if (dragStartY.current !== null) handleDragEnd() }}
            >
              <div className="ai-modal-handle" />
              <div className="ai-modal-header">
                <span className="ai-modal-title">InstaAI</span>
                <button className="ai-modal-close" onClick={closeModal} aria-label="Close">&times;</button>
              </div>
            </div>

            <div className="ai-modal-body">
              <div className="ai-chat-messages">
                {messages.length === 0 && !aiLoading && (
                  <div className="ai-chat-empty">
                    Type your prompt below and hit send to analyze this video with AI.
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`ai-chat-msg ${msg.role}${msg.blocked ? ' blocked' : ''}`}>
                    {msg.role === 'assistant' && (
                      <span className="ai-chat-avatar">{msg.blocked ? '🛡️' : '✨'}</span>
                    )}
                    <div className={`ai-chat-bubble${msg.blocked ? ' ai-chat-blocked' : ''}`}>
                      {msg.role === 'assistant' ? (
                        <div className="ai-chat-text ai-formatted">{formatAiText(msg.text)}</div>
                      ) : (
                        <div className="ai-chat-text">{msg.text}</div>
                      )}
                      {msg.role === 'assistant' && !msg.blocked && msg.text !== 'Request stopped.' && (
                        <button
                          className="ai-copy-inline"
                          onClick={() => { if (navigator?.clipboard) navigator.clipboard.writeText(msg.text) }}
                          aria-label="Copy"
                        >
                          Copy
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {aiLoading && (
                  <div className="ai-chat-msg assistant">
                    <span className="ai-chat-avatar">✨</span>
                    <div className="ai-chat-bubble">
                      <div className="ai-typing">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}

                {aiError && (
                  <div className="ai-chat-error">
                    <p>{aiError}</p>
                    <button className="ai-retry-btn" onClick={handleSend}>Try Again</button>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="ai-chat-input-bar">
              <input
                ref={inputRef}
                type="text"
                className="ai-chat-input"
                placeholder={videoNo ? 'Ask a follow-up...' : 'What do you want to know about this video?'}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                disabled={aiLoading}
              />
              {aiLoading ? (
                <button
                  className="ai-chat-stop"
                  onClick={stopRequest}
                  aria-label="Stop"
                >
                  ■
                </button>
              ) : (
                <button
                  className="ai-chat-send"
                  onClick={handleSend}
                  disabled={!chatInput.trim()}
                  aria-label="Send"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
