import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import PlayerBansPanel from './PlayerBansPanel'
import PlayerWhitelistPanel from './PlayerWhitelistPanel'
import PlayerActivityPanel from './PlayerActivityPanel'
import PlayerRosterPanel from './PlayerRosterPanel'

interface PlayersViewProps {
  profiles: ServerProfile[]
  onBack: () => void
}

type PlayersTab = 'live' | 'bans' | 'whitelist' | 'activity'

/** Merges the player-related screens (live roster, bans, whitelist, activity) behind one
 *  "Players" entry point with a left sidebar to switch between them, rather than separate
 *  top-level buttons - all are ARK-only and all operate on the same profile list, so splitting
 *  them into unrelated top-level screens was more navigation than the content warranted. */
export default function PlayersView({ profiles, onBack }: PlayersViewProps): JSX.Element {
  const [tab, setTab] = useState<PlayersTab>('live')

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
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
          {tab === 'live' && <PlayerRosterPanel profiles={profiles} />}
          {tab === 'bans' && <PlayerBansPanel profiles={profiles} />}
          {tab === 'whitelist' && <PlayerWhitelistPanel profiles={profiles} />}
          {tab === 'activity' && <PlayerActivityPanel profiles={profiles} />}
        </div>
      </div>
    </div>
  )
}
