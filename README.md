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

- Status Options: online | idle | dnd | invisible
- Activity Type Options: Playing | Streaming | Listening | Watching | Competing | None
- Activity Enabled: true | false
