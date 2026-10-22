import { useEffect } from 'react'

interface SidePanelProps {
  onClose: () => void
  children: React.ReactNode
}

/** A right-side slide-over drawer for secondary screens (Settings, SteamCMD, Profile
 *  Management, Map Manager) - the page behind it (Dashboard, a server's own detail view,
 *  whatever was showing) stays mounted and visible/dimmed on the left instead of being
 *  replaced outright, so there's still some context for where you are in the app. Closes on
 *  Escape, on a backdrop click, or on whatever close control the wrapped view itself renders
 *  (its existing "Back" button already calls the same onClose). */
export default function SidePanel({ onClose, children }: SidePanelProps): JSX.Element {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div className="side-panel" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
