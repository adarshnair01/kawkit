import { useEffect } from 'react'

/**
 * Reveal effects for the landing page.
 * - .reveal: gets the class "in" the first time it scrolls into view.
 * Switched off for people who ask for reduced motion; everything is then simply visible.
 */
export function useLandingMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    root.classList.add('anim')

    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add('in')
            seen.unobserve(e.target)
          }
      },
      { threshold: 0.18 },
    )
    document.querySelectorAll('.reveal').forEach((el) => seen.observe(el))

    return () => {
      root.classList.remove('anim')
      seen.disconnect()
    }
  }, [])
}
