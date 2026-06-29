'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  children: ReactNode
  content: ReactNode
  position?: 'top' | 'bottom'
  width?: string
}

export default function Tooltip({ children, content, position = 'top', width = 'w-64' }: TooltipProps) {
  const [show, setShow] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const calcPos = () => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const cx = r.left + r.width / 2
    let top: number
    if (position === 'top') {
      top = r.top - 8
    } else {
      top = r.bottom + 8
    }
    setCoords({ top, left: cx })
  }

  const open = () => {
    timerRef.current = setTimeout(() => {
      calcPos()
      setShow(true)
    }, 120)
  }

  const close = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShow(false)
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  useEffect(() => {
    if (!show) return
    const onScroll = () => calcPos()
    const onResize = () => calcPos()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [show])

  const tooltip = show ? (
    <div
      className="pointer-events-none"
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        transform: position === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 2147483647,
        maxWidth: '320px',
        width: width === 'w-80' ? '320px' : width === 'w-72' ? '288px' : '256px',
      }}
    >
      <div className="p-2.5 text-xs text-white bg-gray-900 border border-gray-600 rounded-xl shadow-2xl leading-relaxed">
        {content}
      </div>
    </div>
  ) : null

  return (
    <span
      ref={triggerRef}
      className="inline-flex cursor-help"
      onMouseEnter={open}
      onMouseLeave={close}
    >
      {children}
      {typeof document !== 'undefined' && createPortal(tooltip, document.body)}
    </span>
  )
}
