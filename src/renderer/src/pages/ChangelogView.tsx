import { CHANGELOG } from '@shared/changelog'

interface ChangelogViewProps {
  onBack: () => void
}

export default function ChangelogView({ onBack }: ChangelogViewProps): JSX.Element {
  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>What&apos;s New</h1>
      </header>
      <div className="changelog-list">
        {CHANGELOG.map((entry, i) => (
          <section className="changelog-entry" key={`${entry.date}-${i}`}>
            <div className="changelog-entry-header">
              <span className="changelog-date">{entry.date}</span>
              <h3>{entry.title}</h3>
            </div>
            <ul>
              {entry.details.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
