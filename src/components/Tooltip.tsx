'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'

interface TooltipProps {
  children: ReactNode
  content: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  width?: string
  delay?: number
}

export default function Tooltip({ children, content, position = 'top', width = 'w-64', delay = 150 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [fixedStyle, setFixedStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const updatePosition = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const scrollY = window.scrollY
    const scrollX = window.scrollX

    let top: number
    let left: number

    switch (position) {
      case 'top':
        top = rect.top + scrollY - 8
        left = rect.left + scrollX + rect.width / 2
        break
      case 'bottom':
        top = rect.top + scrollY + rect.height + 8
        left = rect.left + scrollX + rect.width / 2
        break
      case 'left':
        top = rect.top + scrollY + rect.height / 2
        left = rect.left + scrollX - 8
        break
      case 'right':
        top = rect.top + scrollY + rect.height / 2
        left = rect.left + scrollX + rect.width + 8
        break
    }

    setFixedStyle({
      position: 'absolute',
      top: `${top}px`,
      left: `${left}px`,
      transform: position === 'top' || position === 'bottom'
        ? 'translateX(-50%)'
        : position === 'left'
        ? 'translate(-100%, -50%)'
        : 'translateY(-50%)',
      zIndex: 9999,
      animation: 'tooltipFadeIn 0.15s ease-out',
    })
  }

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      updatePosition()
      setIsVisible(true)
    }, delay)
  }

  const hideTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setIsVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (isVisible) {
      const handleScroll = () => updatePosition()
      const handleResize = () => updatePosition()
      window.addEventListener('scroll', handleScroll, { passive: true })
      window.addEventListener('resize', handleResize)
      return () => {
        window.removeEventListener('scroll', handleScroll)
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [isVisible])

  return (
    <>
      <style>{`
        @keyframes tooltipFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      <span
        ref={triggerRef}
        className="relative inline-flex cursor-help"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
        {isVisible && (
          <span
            style={fixedStyle}
            className={`${width} p-2.5 text-xs text-white bg-gray-900 border border-gray-600 rounded-xl shadow-2xl pointer-events-none`}
          >
            {content}
          </span>
        )}
      </span>
    </>
  )
}
