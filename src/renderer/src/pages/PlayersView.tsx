import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import PlayerBansPanel from './PlayerBansPanel'
import PlayerWhitelistPanel from './PlayerWhitelistPanel'
import PlayerActivityPanel from './PlayerActivityPanel'
import PlayerRosterPanel from './PlayerRosterPanel'

interface PlayersViewProps {
  profiles: ServerProfile[]
  /** Omitted when this is rendered as a left-sidebar tab (App.tsx's ARK mode) rather than a
   *  standalone screen pushed on top of everything else - there's nowhere to "go back" to,
   *  the sidebar itself is the navigation. */
  onBack?: () => void
}

type PlayersTab = 'live' | 'bans' | 'whitelist' | 'activity'

/** Merges the player-related screens (live roster, bans, whitelist, activity) behind one
 *  "Players" entry point with a left sidebar to switch between them, rather than separate
 *  top-level buttons - all are ARK-only and all operate on the same profile list, so splitting
 *  them into unrelated top-level screens was more navigation than the content warranted. */
export default function PlayersView({ profiles, onBack }: PlayersViewProps): JSX.Element {
  const [tab, setTab] = useState<PlayersTab>('live')
  // Hidden servers (Dashboard's own "hide" toggle) are hidden here too - a player-management
  // screen listing a server its owner deliberately tucked away would defeat the point of
  // hiding it in the first place.
  const visibleProfiles = profiles.filter((p) => !p.hidden)

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        {onBack && <button onClick={onBack}>&larr; Back</button>}
        <h1>Players</h1>
      </header>
      <div className="players-view-body">
        <nav className="players-view-sidebar">
          <button type="button" className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
            Live Players
          </button>
          <button type="button" className={tab === 'bans' ? 'active' : ''} onClick={() => setTab('bans')}>
            Bans
          </button>
          <button type="button" className={tab === 'whitelist' ? 'active' : ''} onClick={() => setTab('whitelist')}>
            Whitelist
          </button>
          <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            Activity
          </button>
        </nav>
        <div className="players-view-content">
          {tab === 'live' && <PlayerRosterPanel profiles={visibleProfiles} />}
          {tab === 'bans' && <PlayerBansPanel profiles={visibleProfiles} />}
          {tab === 'whitelist' && <PlayerWhitelistPanel profiles={visibleProfiles} />}
          {tab === 'activity' && <PlayerActivityPanel profiles={visibleProfiles} />}
        </div>
      </div>
    </div>
  )
}
