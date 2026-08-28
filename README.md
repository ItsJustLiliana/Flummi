# Flummi

Flummi is a Discord bot and web dashboard for server management, moderation, automation, analytics, tickets, workflows, and community tools. Server administrators configure their own guilds, while platform-wide controls stay restricted to configured Flummi developers.

## Highlights

- Moderation actions, cases, audit timelines, AutoMod filters, join security, reports, and incident response.
- Tickets, modmail, suggestions, applications, appeals, welcome flows, role menus, and scheduled messages.
- Message, voice, and media analytics without storing ordinary message contents.
- Optional AI conversations and staff assistance behind explicit user consent and human approval controls.
- A responsive dashboard with mobile navigation and live Discord member, role, channel, category, server, and ban selectors. Administrators do not need to copy Discord IDs into ordinary forms.
- Public command, status, support, feedback, Terms of Service, Privacy Policy, license, policy archive, and acknowledgements pages.

The production website is [flummi.liliananuzohra.com](https://flummi.liliananuzohra.com).

## Public website

The control-panel server also hosts Flummi's public website. These routes do not require a Discord login:

- `/` — landing page and shared-server chooser
- `/commands` — current slash-command catalogue and access requirements
- `/status` — last live update date and time
- `/support` — authenticated support form
- `/feedback` — authenticated product-feedback form
- `/terms` and `/privacy` — Discord Developer Portal policy URLs
- `/licenses`, `/policy-archive`, and `/credits` — licensing, policy history, and acknowledgements

Support and feedback submissions require Discord sign-in so the requester can be identified. They share the configured anti-spam cooldown. Developers receive both types in the dashboard mail inbox and reply through the requester's Discord DMs. Incoming DM replies are attached to the same conversation thread.

## Dashboard

### Server workspace

- **Overview:** guild details, member and bot counts, roles, channels, bot state, feature availability, server health, recent reversible changes, module activity, dependency warnings, and recommendations.
- **Stats & Analytics:** selectable 1/7/30/90-day UTC date ranges or all-time views, hourly charts for a selected day, message and voice charts, heatmaps, member/channel filtering, comparison periods, media usage, and administrator-only moderation totals.
- **Triggers:** create and audit text or image responses, limits, cooldowns, imports, and exports.
- **Members & Permissions:** inspect members and configure per-user command and feature overrides. Discord server administrators automatically receive dashboard admin access.
- **Notifications:** account-addressed updates with unread state and administrator search across cases, reports, tickets, incidents, suggestions, and dashboard activity.
- **Profile & account:** one account menu and profile page for the Flummi profile, private AI consent, personal AI memory controls, notifications, dashboard defaults, and accessibility preferences. These controls remain available without a shared server and follow the signed-in Discord account across servers.
- **Profiles and AI memory:** inspect user-supplied profiles and permitted AI conversation memory.
- **Settings:** guild bot settings, feature switches, configurable navigation, retention, backups, storage inspection, and targeted data-reset tools.
- **Messenger and saved pings:** publish through the bot and inspect explicitly saved ping requests.
- **Audit and reliability:** structured panel changes, runtime logs, storage forecasts, permission checks, backups, and voice-session reconciliation.

Dashboard forms load resources directly from Discord. Single and multi-select controls expose the roles, channels, categories, members, servers, and banned users that are actually available in the selected guild. Workflow JSON remains an advanced editor, with role and channel pickers for inserting valid references.

Every module page includes an explanation, stable shareable link, non-destructive configuration test, permission guidance, readiness checks, and dependency warnings. Server-setting writes use revision checks to prevent one dashboard session from silently overwriting another, while recent saved changes can be undone from Overview.

### Management modules

Every management module has an independent enable state and its own setup page:

- Moderation
- AutoMod & Safety
- Cases & Logs
- Roles & Onboarding
- Automation
- Tickets
- Suggestions
- Join Security
- Starboard
- Forms & Appeals
- Channel Management
- Discord Integrations
- Server Doctor
- Incident Center
- Reports & Modmail
- Workflow Studio
- Staff Operations
- Community Health
- Backup & Recovery
- Flummi Copilot
- Engagement & Utilities

### Developer workspace

Configured developers can manage global feature switches, command permissions, application and guild bot profiles, AI providers, runtime health, logs, compliance records, public status incidents, repository files, support mail, experiments, staging state, and release promotion. Sensitive operations remain protected by role checks, audit logging, confirmation dialogs, and private-connection requirements where applicable.

## Discord features and commands

Commands are loaded from `commands/` and published according to their configured access level. The public `/commands` page is generated from the current command definitions and is the authoritative user-facing command list.

Major command groups include:

- Profiles, personal data access/deletion/correction, AI consent, notifications, status, and help.
- Message, voice, and media leaderboards and server statistics.
- Warnings, timeouts, kicks, bans, purges, member information, and permission management.
- Triggers, tickets, modmail, reports, suggestions, forms, Starboard, integrations, and community utilities.
- Server snapshots, temporary roles, voice-linked roles, scheduled events, polls, giveaways, feeds, and publishing tools.

## Privacy and data handling

General analytics store identifiers, timestamps, counters, and derived metadata—not ordinary Discord message contents. Features that inherently require content, such as tickets, modmail, reports, saved ping requests, administrator-authored responses, and consented AI conversations, retain only the content needed to provide that feature.

- Analytics are stored per guild in rotated NDJSON shards with configurable retention.
- AI processing is disabled per user until explicit consent is granted.
- `/data view`, `/data export`, `/data correct`, `/data delete`, and `/resetmemory` provide user data controls.
- Removing Flummi from a guild removes its local guild data and stored guild backups.
- Central retention jobs clean expired analytics, memory, notifications, support records, backups, logs, and recovery copies.

See [DISCORD_APP_REVIEW.md](DISCORD_APP_REVIEW.md) for the gateway-intent justification, persistent-content inventory, and Discord review notes.

## Requirements

- A current Node.js LTS release and npm
- A Discord application and bot token
- The `GUILD_MEMBERS` and `MESSAGE_CONTENT` privileged intents enabled in the Discord Developer Portal
- Optional OpenRouter and image-search credentials for AI and image features
- A public HTTPS origin if the website or Discord policy URLs are exposed publicly

The bot also uses guilds, guild messages, voice states, moderation, message reactions, and direct-message gateway intents for its configured features.

## Installation

```sh
npm install
```

Copy the examples and add local secrets and application settings:

```sh
cp .env.example .env
cp config.example.json config.local.json
```

On Windows PowerShell, use `Copy-Item` instead of `cp` if that alias is unavailable.

At minimum, configure:

- `DISCORD_BOT_TOKEN`
- `clientId` in `config.local.json`
- `guildIds` for guild-scoped or staging command deployment
- `developerUserIds` for platform developer access
- `PANEL_PUBLIC_URL` when serving the public site

Environment variables override equivalent local configuration values where supported. Never commit `.env`, `config.local.json`, or the legacy `config.json`.

## Running Flummi

```sh
npm start
```

`npm start` launches the bot and, unless disabled in configuration, the control panel. Other scripts are:

```sh
npm run start:bot  # bot only
npm run panel      # panel only
npm run deploy     # deploy slash commands
npm test           # run the test suite
npm stop           # stop managed local processes
```

The panel listens on `0.0.0.0:3789` by default. Override this with `PANEL_HOST` and `PANEL_PORT`.

## Configuration

Flummi reads configuration in this order:

1. Verified secure configuration under `FLUMMI_SECRETS_DIR`
2. `config.local.json`
3. Legacy `config.json`
4. `config.example.json`

The dashboard writes local changes to `config.local.json`, or to the verified secure location when encrypted secrets are enabled.

Presence options:

- Status: `online`, `idle`, `dnd`, or `invisible`
- Activity type: `Playing`, `Streaming`, `Listening`, `Watching`, `Competing`, or `None`
- Activity enabled: `true` or `false`

## Command deployment

Production defaults to global command deployment. Global Discord command changes can take time to propagate.

The `Flummi-staging` checkout uses guild-scoped deployment, registers commands directly in its configured test guilds on restart, and clears global commands from the separate staging application. Keep production and staging client IDs, bot tokens, guild lists, data roots, and services separate.

When command deployment on startup is enabled, restarting Flummi also removes retired commands from the configured Discord application.

## Analytics migration

For installations that still use the pre-sharded analytics layout, stop Flummi and run this once before starting the updated version:

```sh
node scripts/migrate-analytics-storage.js
```

The migration moves older statistics files into `data/guilds/<guildId>/analytics/` and deletes the originals only after successful conversion.

## Project structure

- `commands/` — Discord slash commands
- `events/` — Discord event handlers
- `stores/` — JSON-backed data access helpers
- `services/` — moderation, privacy, AI, workflow, mail, and integration services
- `utils/` — shared helpers
- `panel/` — public website and dashboard HTML, JavaScript, CSS, and translations
- `scripts/` — startup, deployment, migration, release, and maintenance scripts
- `deploy/` — service and hosting support files
- `test/` — Node test suite
- `data/` — generated runtime and guild data, mostly ignored by Git

## Acknowledgements

Flummi is designed, built, and maintained by [Liliana Nuzohra](https://liliananuzohra.com). Source and development work are available through [Liliana's GitHub profile](https://github.com/ItsJustLiliana).

## License

Flummi is distributed under the [ISC License](LICENSE). Third-party components retain their own licenses; the deployed `/licenses` page lists the principal packages and loads Flummi's license directly from the repository root.
