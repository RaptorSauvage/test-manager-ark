import { useEffect, useState } from 'react'
import type { MinecraftProfile } from '@shared/minecraft'
import type { MinecraftPropertiesData } from '@shared/minecraft'

interface ServerSettingsTabProps {
  profile: MinecraftProfile
}

interface BoolField {
  key: string
  label: string
  hint?: string
  default: boolean
}

interface TextField {
  key: string
  label: string
  default?: string
  placeholder?: string
}

interface NumberField {
  key: string
  label: string
  default: number
}

interface SelectField {
  key: string
  label: string
  options: Array<{ value: string; label: string }>
  default: string
}

const GAMEPLAY_BOOL_FIELDS: BoolField[] = [
  { key: 'spawn-animals', label: 'Spawn animals', default: true },
  { key: 'spawn-monsters', label: 'Spawn monsters', default: true },
  { key: 'spawn-npcs', label: 'Spawn npcs', default: true },
  { key: 'hardcore', label: 'Hardcore mode', hint: 'If enabled, players will be set to spectator mode if they die.', default: false },
  { key: 'allow-nether', label: 'Nether world', hint: 'Allows players to travel to the Nether.', default: true },
  { key: 'pvp', label: 'PVP', hint: 'Players will be able to kill each other.', default: true },
  {
    key: 'allow-flight',
    label: 'Flight',
    hint: 'Allows users to use flight on your server while in Survival mode, if they have a mod that provides flight.',
    default: false
  },
  { key: 'force-gamemode', label: 'Force Gamemode', hint: 'Force players to join in the default game mode.', default: false }
]

const DIFFICULTY_FIELD: SelectField = {
  key: 'difficulty',
  label: 'Difficulty',
  default: 'easy',
  options: [
    { value: 'peaceful', label: 'peaceful' },
    { value: 'easy', label: 'easy' },
    { value: 'normal', label: 'normal' },
    { value: 'hard', label: 'hard' }
  ]
}

const GAMEMODE_FIELD: SelectField = {
  key: 'gamemode',
  label: 'Gamemode',
  default: 'survival',
  options: [
    { value: 'survival', label: 'survival' },
    { value: 'creative', label: 'creative' },
    { value: 'adventure', label: 'adventure' },
    { value: 'spectator', label: 'spectator' }
  ]
}

const VIEW_DISTANCE_FIELD: NumberField = { key: 'view-distance', label: 'View Distance', default: 10 }

const MOTD_FIELD: TextField = { key: 'motd', label: 'Motd', default: 'A Minecraft Server' }
const RESOURCE_PACK_FIELD: TextField = { key: 'resource-pack', label: 'Resource Pack URL' }
const RESOURCE_PACK_SHA1_FIELD: TextField = { key: 'resource-pack-sha1', label: 'Resource Pack SHA1' }

const WORLD_BOOL_FIELDS: BoolField[] = [
  {
    key: 'generate-structures',
    label: 'Generate Structures',
    hint: 'Defines whether structures (such as villages, mineshafts, strongholds, ...) will be generated.',
    default: true
  },
  { key: 'enable-command-block', label: 'Command Blocks', default: false }
]

const LEVEL_NAME_FIELD: TextField = { key: 'level-name', label: 'World Name', default: 'world' }
const MAX_WORLD_SIZE_FIELD: NumberField = { key: 'max-world-size', label: 'Max World Size', default: 29999984 }
const MAX_BUILD_HEIGHT_FIELD: NumberField = { key: 'max-build-height', label: 'Max Build Height', default: 256 }
const LEVEL_SEED_FIELD: TextField = { key: 'level-seed', label: 'Level Seed' }
const LEVEL_TYPE_FIELD: TextField = { key: 'level-type', label: 'Level Type', default: 'default' }
const GENERATOR_SETTINGS_FIELD: TextField = { key: 'generator-settings', label: 'Flat Generator Settings', default: '{}' }

const NETWORKING_BOOL_FIELDS: BoolField[] = [
  {
    key: 'online-mode',
    label: 'Online Mode',
    hint: 'Requires a valid Minecraft account to connect. Turn off only for an offline/cracked server.',
    default: true
  },
  {
    key: 'white-list',
    label: 'Whitelisting',
    hint: 'When enabled, users not on the whitelist will be unable to connect. Intended for private servers.',
    default: false
  },
  { key: 'prevent-proxy-connections', label: 'Prevent Proxy', hint: 'Prevents users from using vpns or proxies.', default: false },
  { key: 'snooper-enabled', label: 'Snooper', hint: 'Sets whether the server sends snoop data regularly to snoop.minecraft.net.', default: true },
  { key: 'enable-rcon', label: 'Rcon', hint: 'Enables remote access to the server console.', default: false },
  { key: 'enable-query', label: 'Query', hint: 'Enables GameSpy4 protocol server listener. Used to get information about server.', default: false }
]

const RCON_PASSWORD_FIELD: TextField = { key: 'rcon.password', label: 'Rcon Password' }
const RCON_PORT_FIELD: NumberField = { key: 'rcon.port', label: 'Rcon Port', default: 25575 }
const QUERY_PORT_FIELD: NumberField = { key: 'query.port', label: 'Query Port', default: 25565 }
const SERVER_PORT_FIELD: NumberField = { key: 'server-port', label: 'Server Port', default: 25565 }
const MAX_PLAYERS_FIELD: NumberField = { key: 'max-players', label: 'Player Limit', default: 20 }
const MAX_TICK_TIME_FIELD: NumberField = { key: 'max-tick-time', label: 'Max Tick Time', default: 60000 }
const NETWORK_COMPRESSION_THRESHOLD_FIELD: NumberField = { key: 'network-compression-threshold', label: 'Network Compression Threshold', default: 256 }

const OP_PERMISSION_FIELD: SelectField = {
  key: 'op-permission-level',
  label: 'OP Permission level',
  default: '4',
  options: [
    { value: '1', label: '1 - Ops can bypass spawn protection' },
    { value: '2', label: '2 - Ops can use /clear, /difficulty, /effect, /gamemode, /gamerule, /give, /summon, /tp, and /tell' },
    { value: '3', label: '3 - Ops can use /ban, /deop, /kick, and /op' },
    { value: '4', label: '4 - Ops can use /stop, /save-all, /save-on, and /save-off' }
  ]
}
const PLAYER_IDLE_TIMEOUT_FIELD: NumberField = { key: 'player-idle-timeout', label: 'Idle Timeout Kick', default: 0 }

function boolValue(form: MinecraftPropertiesData, field: BoolField): boolean {
  const raw = form[field.key]
  return raw === undefined ? field.default : raw === 'true'
}

function textValue(form: MinecraftPropertiesData, field: TextField): string {
  return form[field.key] ?? field.default ?? ''
}

function numberValue(form: MinecraftPropertiesData, field: NumberField): number {
  const raw = form[field.key]
  const n = Number(raw)
  return raw !== undefined && Number.isFinite(n) ? n : field.default
}

/** Editor for server.properties itself - separate from the Start Settings tab, which only
 *  covers how the Manager launches the process (jar/script, memory, ...). Every field here
 *  saves straight to the file via upsertServerPropertiesKeys (minecraftProperties.ts), which
 *  only replaces the value on that key's existing line (or appends one) - nothing else in
 *  the file (comments, ordering, a plugin's own custom key) is touched. Minecraft only
 *  re-reads this file at its own startup, so a change made here while the server is running
 *  takes effect on its next start, not live. */
export default function ServerSettingsTab({ profile }: ServerSettingsTabProps): JSX.Element {
  const [form, setForm] = useState<MinecraftPropertiesData | null>(null)
  const [error, setError] = useState('')

  async function handleOpenServerFolder(): Promise<void> {
    setError('')
    try {
      await window.api.minecraft.openServerFolder(profile.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    let cancelled = false
    setForm(null)
    window.api.minecraft.properties.get(profile.id).then((data) => {
      if (!cancelled) setForm(data)
    })
    return () => {
      cancelled = true
    }
  }, [profile.id])

  async function update(key: string, value: string): Promise<void> {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setError('')
    try {
      const updated = await window.api.minecraft.properties.save(profile.id, { [key]: value })
      setForm(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!form) {
    return <p className="empty-state">Loading server.properties...</p>
  }

  function renderBool(field: BoolField): JSX.Element {
    return (
      <div key={field.key}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={boolValue(form!, field)}
            onChange={(e) => void update(field.key, e.target.checked ? 'true' : 'false')}
          />
          {field.label}
        </label>
        {field.hint && <p className="empty-state">{field.hint}</p>}
      </div>
    )
  }

  function renderText(field: TextField): JSX.Element {
    return (
      <label key={field.key}>
        {field.label}
        <input
          value={textValue(form!, field)}
          placeholder={field.placeholder}
          onChange={(e) => void update(field.key, e.target.value)}
        />
      </label>
    )
  }

  function renderNumber(field: NumberField): JSX.Element {
    return (
      <label key={field.key}>
        {field.label}
        <input type="number" value={numberValue(form!, field)} onChange={(e) => void update(field.key, e.target.value)} />
      </label>
    )
  }

  function renderSelect(field: SelectField): JSX.Element {
    return (
      <label key={field.key}>
        {field.label}
        <select value={form![field.key] ?? field.default} onChange={(e) => void update(field.key, e.target.value)}>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <form className="server-settings-tab" onSubmit={(e) => e.preventDefault()}>
      <p className="empty-state">
        You are editing the server.properties file. Minecraft only re-reads it at startup - a change made here takes
        effect the next time this server starts, not live.
      </p>
      <div className="form-actions">
        <button type="button" onClick={() => void handleOpenServerFolder()}>
          Open server folder
        </button>
      </div>
      {error && <p className="error-message">{error}</p>}

      <section className="cluster-section">
        <h3>Gameplay</h3>
        {GAMEPLAY_BOOL_FIELDS.map(renderBool)}
        <div className="settings-grid">
          {renderSelect(DIFFICULTY_FIELD)}
          {renderSelect(GAMEMODE_FIELD)}
          {renderNumber(VIEW_DISTANCE_FIELD)}
        </div>
      </section>

      <section className="cluster-section">
        <h3>Appearance</h3>
        {renderText(MOTD_FIELD)}
        {renderText(RESOURCE_PACK_FIELD)}
        {renderText(RESOURCE_PACK_SHA1_FIELD)}
      </section>

      <section className="cluster-section">
        <h3>World</h3>
        {WORLD_BOOL_FIELDS.map(renderBool)}
        {renderText(LEVEL_NAME_FIELD)}
        <div className="settings-grid">
          {renderNumber(MAX_WORLD_SIZE_FIELD)}
          {renderNumber(MAX_BUILD_HEIGHT_FIELD)}
        </div>
        <div className="settings-grid">
          {renderText(LEVEL_SEED_FIELD)}
          {renderText(LEVEL_TYPE_FIELD)}
        </div>
        {renderText(GENERATOR_SETTINGS_FIELD)}
      </section>

      <section className="cluster-section">
        <h3>Networking</h3>
        {NETWORKING_BOOL_FIELDS.map(renderBool)}
        {renderText(RCON_PASSWORD_FIELD)}
        <div className="settings-grid">
          {renderNumber(RCON_PORT_FIELD)}
          {renderNumber(QUERY_PORT_FIELD)}
          {renderNumber(SERVER_PORT_FIELD)}
          {renderNumber(MAX_PLAYERS_FIELD)}
          {renderNumber(MAX_TICK_TIME_FIELD)}
          {renderNumber(NETWORK_COMPRESSION_THRESHOLD_FIELD)}
        </div>
      </section>

      <section className="cluster-section">
        <h3>Miscellaneous</h3>
        {renderSelect(OP_PERMISSION_FIELD)}
        {renderNumber(PLAYER_IDLE_TIMEOUT_FIELD)}
      </section>

      {error && <p className="error-message">{error}</p>}
    </form>
  )
}
