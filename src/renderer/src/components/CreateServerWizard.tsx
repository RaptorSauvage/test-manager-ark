import { useEffect, useRef, useState } from 'react'
import type { ServerProfile } from '@shared/types'
import { createDefaultProfile } from '../lib/profile'
import { parseSteamCmdProgress, type SteamCmdStage } from '../lib/steamcmdProgress'

type SetupMode = 'fresh' | 'copyConfig' | 'importInstall' | 'importFile'
type InstallState = 'idle' | 'running' | 'success' | 'error'

interface CreateServerWizardProps {
  profiles: ServerProfile[]
  onProfilesChange: (profiles: ServerProfile[]) => void
  /** Reuses Dashboard's own existing handleImport/handleImportFromFile unchanged - both
   *  already navigate to the new profile's Settings tab on success, which unmounts this
   *  wizard as a side effect of the page changing under it. */
  onImportInstall: () => Promise<void>
  onImportFile: () => Promise<void>
  importing: boolean
  importError: string
  onClose: () => void
}

const NAME_PATTERN = /^[A-Za-z0-9 _.-]+$/
const STAGE_COLOR: Record<SteamCmdStage, string> = {
  starting: 'var(--muted)',
  installing: 'var(--accent)',
  verifying: 'var(--purple)',
  complete: 'var(--ok)',
  error: 'var(--danger)'
}

export default function CreateServerWizard({
  profiles,
  onProfilesChange,
  onImportInstall,
  onImportFile,
  importing,
  importError,
  onClose
}: CreateServerWizardProps): JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState('')
  const [installDir, setInstallDir] = useState('')
  const [mode, setMode] = useState<SetupMode>('fresh')
  const [copyFromId, setCopyFromId] = useState('')
  const [installArkApi, setInstallArkApi] = useState(false)

  const [installState, setInstallState] = useState<InstallState>('idle')
  const [installErrorMsg, setInstallErrorMsg] = useState('')
  const [logText, setLogText] = useState('')
  const [newProfileName, setNewProfileName] = useState('')
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = preRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logText])

  const trimmedName = name.trim()
  const nameLengthOk = trimmedName.length >= 2 && trimmedName.length <= 50
  const nameCharsOk = trimmedName.length === 0 || NAME_PATTERN.test(trimmedName)
  const nameUnique = !profiles.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())
  const nameValid = nameLengthOk && nameCharsOk && nameUnique
  const dirValid = installDir.trim().length > 0
  const step1Valid = nameValid && dirValid

  const copySourceProfile = profiles.find((p) => p.id === copyFromId) ?? null

  async function browseInstallDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) setInstallDir(dir)
  }

  async function handleStep2Next(): Promise<void> {
    if (mode === 'importInstall') {
      await onImportInstall()
      return
    }
    if (mode === 'importFile') {
      await onImportFile()
      return
    }
    setStep(3)
  }

  async function runInstall(): Promise<void> {
    setInstallState('running')
    setInstallErrorMsg('')
    setLogText('')

    const profile: ServerProfile = { ...createDefaultProfile(trimmedName), installDir: installDir.trim() }
    setNewProfileName(profile.name)
    const updated = await window.api.profiles.save(profile)
    onProfilesChange(updated)

    const unsubscribe = window.api.steamcmd.onUpdateLogChanged((changedId) => {
      if (changedId !== profile.id) return
      void window.api.steamcmd.getUpdateLog(profile.id).then((log) => setLogText(log ?? ''))
    })

    try {
      await window.api.server.update(profile.id)
      if (mode === 'copyConfig' && copySourceProfile) {
        try {
          await window.api.profiles.copyConfigFrom(copySourceProfile.id, profile.id)
        } catch {
          // Best-effort - the server install itself already succeeded, so this alone
          // shouldn't be reported as the whole wizard having failed.
        }
      }
      setInstallState('success')
    } catch (err) {
      setInstallErrorMsg((err as Error).message)
      setInstallState('error')
    } finally {
      unsubscribe()
    }
  }

  if (installState !== 'idle') {
    const progress = parseSteamCmdProgress(logText)
    const stageColor = STAGE_COLOR[installState === 'error' ? 'error' : progress.stage]
    const barPercent = installState === 'error' ? 100 : progress.percent
    return (
      <div className="wizard-overlay">
        <div className="wizard-modal">
          <div className="wizard-header">
            <span className="wizard-header-icon">⬇️</span>
            <div>
              <h2>Install ARK: Survival Ascended Server</h2>
              <p className="wizard-subtitle">Install the dedicated server files for &quot;{newProfileName}&quot;</p>
            </div>
          </div>

          <div className="wizard-body">
            <section className="install-progress-panel">
              <h3>Installation Progress</h3>
              <div className="install-progress-stage-row">
                <span className="install-progress-stage" style={{ color: stageColor }}>
                  {installState === 'running' && <span className="spinner" />}
                  {installState === 'error' ? 'Installation failed' : progress.label}
                </span>
                <span className="install-progress-percent">{barPercent.toFixed(1)}%</span>
              </div>
              <div className="install-progress-bar">
                <div
                  className="install-progress-bar-fill"
                  style={{ width: `${barPercent}%`, background: stageColor }}
                />
              </div>
              {installState === 'success' && (
                <div className="wizard-hint-box wizard-hint-box-ok">
                  <p>- Server installation completed successfully!</p>
                  <p>- Server files are ready to use</p>
                  <p>- You can now start your ARK server</p>
                </div>
              )}
              {installState === 'error' && (
                <div className="wizard-hint-box wizard-hint-box-error">
                  <p>- {installErrorMsg}</p>
                  <p>- The profile was created, but the server files failed to install - try Update from its card.</p>
                </div>
              )}
            </section>

            <section>
              <h3>Output</h3>
              <pre className="log-output" ref={preRef}>
                {logText || 'Waiting for SteamCMD to start...'}
              </pre>
            </section>
          </div>

          {installState !== 'running' && (
            <div className="wizard-footer">
              <button type="button" className="wizard-primary" onClick={onClose}>
                ✓ Close
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        <div className="wizard-header">
          <span className="wizard-header-icon">🗄️</span>
          <h2>Create New Server Profile</h2>
          <button type="button" className="wizard-close" onClick={onClose} title="Cancel">
            ✕
          </button>
        </div>

        <p className="wizard-subtitle">
          Step {step} of 3: {step === 1 ? 'Basic Information' : step === 2 ? 'Copy Configuration' : 'Additional Options'}
        </p>

        <div className="wizard-steps">
          {[1, 2, 3].map((n) => (
            <div className="wizard-step-indicator" key={n}>
              <div className={`wizard-step-circle${step > n ? ' done' : step === n ? ' active' : ''}`}>
                {step > n ? '✓' : n}
              </div>
              {n < 3 && <div className={`wizard-step-line${step > n ? ' done' : ''}`} />}
            </div>
          ))}
        </div>

        <div className="wizard-body">
          {step === 1 && (
            <>
              <label className="wizard-field">
                Profile Name
                <div className="wizard-input-row">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My ARK Server" />
                  {trimmedName.length > 0 && <span className={nameValid ? 'wizard-valid-ok' : 'wizard-valid-bad'}>{nameValid ? '✓' : '✕'}</span>}
                </div>
              </label>
              <ul className="wizard-hint-list">
                <li className={nameLengthOk ? 'ok' : ''}>Name must be 2-50 characters long</li>
                <li className={nameCharsOk ? 'ok' : ''}>Only letters, numbers, spaces, hyphens, underscores, and periods allowed</li>
                <li className={nameUnique ? 'ok' : ''}>Profile name must be unique</li>
              </ul>

              <label className="wizard-field">
                Installation Directory
                <div className="wizard-input-row">
                  <input
                    value={installDir}
                    onChange={(e) => setInstallDir(e.target.value)}
                    placeholder="C:\ARKServers\MyServer"
                  />
                  {dirValid && <span className="wizard-valid-ok">✓</span>}
                  <button type="button" onClick={() => void browseInstallDir()} title="Browse...">
                    📁
                  </button>
                </div>
              </label>
              <p className="wizard-hint-static">Select the directory where ARK: Survival Ascended will be installed</p>
            </>
          )}

          {step === 2 && (
            <>
              <label className="wizard-option-card" data-selected={mode === 'fresh'}>
                <input type="radio" name="setup-mode" checked={mode === 'fresh'} onChange={() => setMode('fresh')} />
                <div>
                  <strong>Fresh Installation</strong>
                  <p>Default configuration files will be generated for your new server</p>
                </div>
              </label>

              <label className="wizard-option-card" data-selected={mode === 'copyConfig'} data-disabled={profiles.length === 0}>
                <input
                  type="radio"
                  name="setup-mode"
                  checked={mode === 'copyConfig'}
                  disabled={profiles.length === 0}
                  onChange={() => setMode('copyConfig')}
                />
                <div>
                  <strong>Copy configuration from existing server</strong>
                  <p>Reuses another profile&apos;s GameUserSettings.ini/Game.ini on this fresh install</p>
                  {mode === 'copyConfig' && (
                    <select
                      value={copyFromId}
                      onChange={(e) => setCopyFromId(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="">Select a profile...</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>

              <label className="wizard-option-card" data-selected={mode === 'importInstall'}>
                <input
                  type="radio"
                  name="setup-mode"
                  checked={mode === 'importInstall'}
                  onChange={() => setMode('importInstall')}
                />
                <div>
                  <strong>Import existing server</strong>
                  <p>Scan a folder that already has ARK server files installed</p>
                </div>
              </label>

              <label className="wizard-option-card" data-selected={mode === 'importFile'}>
                <input
                  type="radio"
                  name="setup-mode"
                  checked={mode === 'importFile'}
                  onChange={() => setMode('importFile')}
                />
                <div>
                  <strong>Import profile file</strong>
                  <p>Load a previously exported profile .json file</p>
                </div>
              </label>

              {importError && <p className="error-message">{importError}</p>}
            </>
          )}

          {step === 3 && (
            <>
              <label className="wizard-checkbox">
                <input type="checkbox" checked={installArkApi} onChange={(e) => setInstallArkApi(e.target.checked)} />
                Install ArkAPI automatically
              </label>

              <div className="wizard-hint-box wizard-hint-box-review">
                <strong>📋 Review &amp; Confirm</strong>
                <p>- Profile name: {trimmedName}</p>
                <p>- Install path: {installDir}</p>
                <p>
                  -{' '}
                  {mode === 'copyConfig' && copySourceProfile
                    ? `Copy configuration from: ${copySourceProfile.name}`
                    : 'Generate default configuration'}
                </p>
                <p>- Install ArkAPI: {installArkApi ? 'Yes' : 'No'}</p>
              </div>
            </>
          )}
        </div>

        <div className="wizard-footer">
          <div>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            {step > 1 && (
              <button type="button" onClick={() => setStep((step - 1) as 1 | 2 | 3)}>
                &larr; Back
              </button>
            )}
          </div>
          {step === 1 && (
            <button type="button" className="wizard-primary" disabled={!step1Valid} onClick={() => setStep(2)}>
              Next &rarr;
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              className="wizard-primary"
              disabled={importing || (mode === 'copyConfig' && !copyFromId)}
              onClick={() => void handleStep2Next()}
            >
              {importing ? 'Importing...' : <>Next &rarr;</>}
            </button>
          )}
          {step === 3 && (
            <button type="button" className="wizard-primary" onClick={() => void runInstall()}>
              Next &rarr;
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
