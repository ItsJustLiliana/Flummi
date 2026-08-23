# Flummi

## Control panel features

The built-in panel manages Flummi per guild and keeps operational data separate from the tracked Discord metadata.

- **Overview:** guild summary, member/role counts, bot status, shots, active channels, and compact message/voice trends.
- **Analytics:** selectable periods, bar or line charts, hover details, responsive graphs, channel/member drill-down, period-over-period message comparison, busiest day/hour, message engagement metadata, activity heatmaps, and moderation totals.
- **Message analytics:** message history by channel, author, period, and selected text channel.
- **Voice analytics:** active sessions, live durations, leaderboards, recent/grouped calls, channel member lookup, voice-session and voice-minutes charts, heatmaps, totals, and average session length.
- **Messenger and triggers:** send messages through the bot, manage trigger replies, images, cooldowns, imports/exports, and trigger audit data.
- **Shots, members, profiles, and permissions:** review shot activity, member command and feature overrides, and profile data. Discord server administrators automatically receive admin access.
- **Management:** independent modules for moderation, AutoMod, cases, roles, automation, tickets, suggestions, join security, Starboard, forms and appeals, channel controls, and native Discord integrations. Each module has its own enable state and guided setup page.
- **Settings:** per-guild bot/trigger options, global and guild feature switches, configurable panel tab names/order/dividers, analytics retention, storage inspection, backups, and targeted data-reset tools.
- **AI & system:** AI model and image-search configuration, AI memory lookup, usage information, activity feed, health, and GitHub update status.
- **Bot logs:** a filterable, auto-refreshing console view for recent info, warnings, and errors—useful for AI time-outs and Discord API failures.
- **Reliability:** storage usage and forecast, latest local backup, loaded event handlers, manual backup creation, and a manual voice-session reconciliation action.

### Analytics and privacy

Analytics store activity metadata rather than message contents. New moderation tracking records member joins/leaves, deleted-message counts, role changes, and invite uses when the bot can read guild invites. Message contents are never written to analytics storage. Analytics data is stored per guild in rotated NDJSON shards, with a configurable retention period and a seamless panel view across shards.

## Project structure

- `commands/` - Discord slash commands.
- `events/` - Discord event handlers.
- `stores/` - JSON-backed data access helpers.
- `services/` - External service integrations, like AI chat.
- `utils/` - Shared local helpers used by commands/events/scripts.
- `panel/` - Control panel HTML, JavaScript, and CSS.
- `data/` - Local generated bot data. Most of this is ignored by Git.

## Staging command deployment

The `Flummi-staging` checkout and staging service use guild-scoped deployment, registering commands directly in configured `guildIds` on every staging restart and clearing global commands from the separate staging application. Keep only the private test server in the staging checkout's ignored config, with its own staging client ID and token. Production defaults to global command deployment, so promoted releases publish commands globally for the public bot.

## Config

Runtime configuration is local-only. Copy `config.example.json` to `config.local.json` on a new machine; the panel saves its settings there. Do not commit either `config.json` or `config.local.json`.

After deploying the analytics update, stop Flummi and run `node scripts/migrate-analytics-storage.js` once on the server. It moves old statistics files into `data/guilds/<guildId>/analytics/` and deletes the originals only after successful conversion.

- Status Options: online | idle | dnd | invisible
- Activity Type Options: Playing | Streaming | Listening | Watching | Competing | None
- Activity Enabled: true | false
