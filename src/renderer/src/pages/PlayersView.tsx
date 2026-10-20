import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import PlayerBansPanel from './PlayerBansPanel'
import PlayerActivityPanel from './PlayerActivityPanel'

interface PlayersViewProps {
  profiles: ServerProfile[]
  onBack: () => void
}

type PlayersTab = 'bans' | 'activity'

/** Merges the two player-related screens (bans, activity) behind one "Players" entry point
 *  with a left sidebar to switch between them, rather than two separate top-level buttons -
 *  both are ARK-only and both operate on the same profile list, so splitting them into
 *  unrelated top-level screens was more navigation than the content warranted. */
export default function PlayersView({ profiles, onBack }: PlayersViewProps): JSX.Element {
  const [tab, setTab] = useState<PlayersTab>('bans')

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>Players</h1>
      </header>
      <div className="players-view-body">
        <nav className="players-view-sidebar">
          <button type="button" className={tab === 'bans' ? 'active' : ''} onClick={() => setTab('bans')}>
            Bans
          </button>
          <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            Activity
          </button>
        </nav>
        <div className="players-view-content">
          {tab === 'bans' ? <PlayerBansPanel profiles={profiles} /> : <PlayerActivityPanel profiles={profiles} />}
        </div>
      </div>
    </div>
  )
}
