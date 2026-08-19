# Flummi

## Project structure

- `commands/` - Discord slash commands.
- `events/` - Discord event handlers.
- `stores/` - JSON-backed data access helpers.
- `services/` - External service integrations, like AI chat.
- `utils/` - Shared local helpers used by commands/events/scripts.
- `panel/` - Control panel HTML.
- `data/` - Local generated bot data. Most of this is ignored by Git.

## Config

Runtime configuration is local-only. Copy `config.example.json` to `config.local.json` on a new machine; the panel saves its settings there. Do not commit either `config.json` or `config.local.json`.

After deploying the analytics update, stop Flummi and run `node scripts/migrate-analytics-storage.js` once on the server. It moves old statistics files into `data/guilds/<guildId>/analytics/` and deletes the originals only after successful conversion.

- Status Options: online | idle | dnd | invisible
- Activity Type Options: Playing | Streaming | Listening | Watching | Competing | None
- Activity Enabled: true | false
