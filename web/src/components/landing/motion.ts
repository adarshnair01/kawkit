import { useEffect } from 'react'

/**
 * Scroll effects for the landing page.
 * - [data-speed]: moves against the scroll at that fraction of its distance from the middle of the screen.
 * - .reveal: gets the class "in" the first time it scrolls into view.
 * Both are switched off for people who ask for reduced motion; everything is then simply visible.
 */
export function useLandingMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    root.classList.add('anim')

    const layers = Array.from(document.querySelectorAll<HTMLElement | SVGElement>('[data-speed]'))
    let raf = 0
    let mx = 0
    let my = 0
    const update = () => {
      raf = 0
      const vh = window.innerHeight
      for (const el of layers) {
        const box = (el.closest('[data-parallax]') ?? el.parentElement)!.getBoundingClientRect()
        const d = box.top + box.height / 2 - vh / 2
        const speed = Number(el.dataset.speed)
        const drift = Number(el.dataset.drift ?? 0)
        el.style.transform = `translate3d(${(mx * drift).toFixed(1)}px, ${(-d * speed + my * drift).toFixed(1)}px, 0)`
      }
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5
      my = e.clientY / window.innerHeight - 0.5
      schedule()
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('pointermove', onMove, { passive: true })

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
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('pointermove', onMove)
      seen.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
}
