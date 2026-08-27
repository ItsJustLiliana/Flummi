# Discord App Review Preparation

This document describes Flummi's current gateway-intent use and local data handling. It is an internal review aid, not a claim of Discord approval.

## Privileged intents

### GUILD_MEMBERS

Flummi uses `GUILD_MEMBERS` for member lifecycle events and current membership state. `events/guildMemberAdd.js`, `guildMemberRemove.js`, and `guildMemberUpdate.js` detect joins, leaves, role changes, nickname changes, and timeout changes. Those events support join security and account-age checks (`handleJoinSecurity`), invite-use attribution (`findUsedInvite`), autoroles, onboarding, welcome/goodbye automation, role persistence (`handleMemberAdd`/`handleMemberRemove`), member lifecycle logging, workflows, and moderation/member management.

The dashboard also uses current member state for the administrator-configured member list and permission editor (`listGuildMembers`, `getCurrentMemberRole`) and revalidates current guild membership and administrator permissions before protected guild access (`hasCurrentGuildAccess` and `requireGuildAdminAccess` in `control-panel.js`). The panel client can start without this intent, but member-list functionality is then unavailable. Flummi does not request member data for bulk harvesting or unrelated profiling; its member cache is capped and current membership is fetched only for these operational and access-control features.

### MESSAGE_CONTENT

Flummi reads message content only when an enabled feature needs the message being processed. `events/messageCreate.js` handles administrator-configured keyword triggers/autoresponders, message-driven workflows, mentioned/reply conversational AI, referenced-message AI context, user-requested image/search features, and optional saved ping requests. `services/automod-service.js` applies configured spam, link, invite, bad-word, duplicate, mention, emoji, caps, and other safety rules where native Discord AutoMod is insufficient. Content is also needed for modmail relay, report message context, ticket transcripts, and starboard copies.

General analytics never persist normal message text. `recordMessageEvent` derives identifiers, timestamps, length, attachment/embed/reply/thread counts, and configured media counters; `incrementMessageStats` stores counters and identifiers only. Message content is processed transiently for triggers, workflow conditions, AutoMod evaluation, and conversational routing. It is retained only by a feature that needs later content: consented AI memory, ticket transcripts, modmail history, submitted reports/forms/feedback/suggestions/reminders/AFK text, saved ping requests, AutoMod evidence, or administrator-authored triggers, custom commands, schedules, workflow actions, and response templates. Flummi does not persist arbitrary guild message history.

Optional external AI processing remains behind the existing per-user consent gate in `services/ai-consent-service.js`. AI requests minimize identifiers and request provider zero-data-retention/data-collection denial. Local AI history is bounded and retained separately per user.

## Other gateway intents

The exact bot list is exported by `services/discord-intents.js` and used by `index.js`:

- `GUILDS`: guild, channel, role, interaction, configuration, and management features.
- `GUILD_MESSAGES`: receive guild message events for the enabled message-driven features above.
- `GUILD_VOICE_STATES`: voice statistics, temporary voice rooms, and voice-linked roles.
- `GUILD_MODERATION`: ban/unban events and moderation state.
- `GUILD_MESSAGE_REACTIONS`: starboard and ticket-rating workflows.
- `DIRECT_MESSAGES`: consented guild modmail plus replies to website support and feedback threads; DM channels use the configured channel partial.

Flummi does not request presence or other unused gateway intents.

## Developer Portal policy URLs

Use these exact public HTTPS URLs in the Discord Developer Portal:

- Terms of Service: `https://flummi.liliananuzohra.com/terms`
- Privacy Policy: `https://flummi.liliananuzohra.com/privacy`

Both routes are public without Discord authentication and accept both `GET` and `HEAD`, which allows Discord's URL validator to verify them. Production must set `PANEL_PUBLIC_URL=https://flummi.liliananuzohra.com`, keep the Cloudflare tunnel online, and serve a valid public TLS certificate. Do not enter the private Tailscale address, `localhost`, a URL with a port, or a URL copied from an authenticated dashboard session.

## Persistent content inventory

| Store/path | Content handling | Basis and cleanup |
| --- | --- | --- |
| `data/guilds/*/analytics/**` and message-stat rollups | Metadata only; raw message text is never written | Identifiable rows default to 365 days, then become non-user-attributed aggregate history where applicable |
| `data/guilds/*/moderation/cases.jsonl` | AutoMod may retain up to 500 characters of the violating message as case evidence | Required for the configured moderation record; case retention is server-configurable (365-day default) |
| `data/global/users/*/aiMemory.json` | Consented AI prompts, compact context, and replies | Bounded history; 90-day inactivity default; `/resetmemory` or `/data delete` removes it |
| `data/guilds/*/tickets/transcripts/**` | Ticket messages, attachments, embeds, and reactions | Required transcript feature; configurable retention (90-day default); participant `/data delete` removes matching local transcript artifacts |
| `data/guilds/*/operations.json` | Modmail messages; explicit report context/reasons; reminders, AFK and pulse text | Feature-required content; terminal records default to 365 days; user and guild deletion apply |
| `data/guilds/*/pingRequests.json` | Referenced message text and attachment URLs explicitly saved by a user | 30-day default; user and guild deletion apply |
| Guild settings, `triggers.json`, and custom-command storage | Administrator-authored triggers, responses, templates, schedules, workflow actions, and custom commands | Configuration required to reproduce the requested behavior; removed with guild data |
| Community management and global support stores | Explicit ticket topics, suggestions, forms/appeals, feedback, privacy requests, and abuse reports | User-submitted feature content; terminal records follow configured/default retention and deletion/de-identification controls |
| Local guild backups | Copies of the guild-local stores above, so may contain the same feature-required content | 90-day default; included in user scrubbing and guild removal |
| Runtime activity and bot logs | Operational metadata only; content-like object fields are redacted before log persistence | 90-day default; guild activity rows are removed on guild removal |

Starboard copies message content into the administrator-configured Discord starboard channel, while Flummi's local starboard state stores only source and destination message IDs. Ticket/modmail channels and transcript attachments sent to Discord remain subject to Discord and server-administrator controls; locally generated copies remain subject to Flummi cleanup.

## Data Minimization

- The main bot and dashboard set `MessageManager: 0`; the main client also sweeps any message cache entries every 60 seconds with a 60-second lifetime. Member caches are capped at 200, with dashboard member-fetch results cached for 60 seconds.
- Central retention runs at startup and daily. It prunes identifiable analytics, logs, AI memory, notifications, saved pings, closed operational records, backups, file-manager recovery copies, and other configured stores. Ticket transcripts and moderation records have their own retention jobs.
- General message analytics store metadata and derived counters, never normal message contents. Expired identifiable analytics can contribute only to anonymous daily/channel aggregates.
- `/data view` and `/data export` provide access; `/data delete` removes dedicated user files, scrubs shared stores and backups, removes matching local ticket transcripts, and attempts to delete linked Flummi-managed ticket/modmail Discord channels. `/resetmemory` clears AI memory.
- Removing Flummi from a guild deletes its local guild directory, stored backups, and guild-scoped runtime activity entries.
- External AI use requires explicit user consent. Outgoing AI text is identifier-sanitized, provider data collection is denied, and zero-data-retention routing is requested.
- Transient processing (trigger matching, workflow conditions, AutoMod history, referenced-message handling, and routing) is kept separate from persistent storage. Only explicit feature stores retain content, and no general guild message archive is maintained.

## Review conclusion

`GUILD_MEMBERS` remains technically necessary for Flummi's member lifecycle, security, roles, onboarding, moderation, and current dashboard authorization/member-management functions. `MESSAGE_CONTENT` remains technically necessary for configured triggers, custom message safety, consented conversational AI and referenced context, saved ping requests, reports, modmail, tickets, starboard, and other message-driven features. Removing either intent would materially break current user-facing functionality.
