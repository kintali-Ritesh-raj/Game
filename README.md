# MARKET WARS — Online Multiplayer

An original strategy board game for 2–4 people playing on separate phones, tablets, laptops, or browsers. It has a tabletop-style square board that scales to the screen, light and dark modes, shared dice and card reveals, and the supplied dice and property-visit sounds.

The application uses **Next.js 16, TypeScript, Supabase Auth/Postgres/Realtime, and Vercel**. Every game command runs on the server and is committed to Supabase. There is no offline game-state fallback.

**Play online:** [market-wars-flax.vercel.app](https://market-wars-flax.vercel.app). Server functions run in Vercel's Mumbai region (`bom1`, set in `vercel.json`) next to the Supabase database (`ap-south-1`).

## Run locally

Use Node.js 22 or newer (Node 24 is used in CI).

On Windows PowerShell with script execution disabled, use `npm.cmd` and `npx.cmd` instead of `npm` and `npx` in these commands.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and fill in all three values from the **same** Supabase project:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY
```

The legacy `service_role` key also works for `SUPABASE_SECRET_KEY`. Keep the server key in `.env.local` or Vercel environment settings. Never put it in a `NEXT_PUBLIC_` variable, source code, or GitHub. `.env*` files are ignored except `.env.example`.

Complete the database setup below, then run:

```sh
npm run dev
```

Open `http://localhost:3000`. Creating or joining a room requires the configured Supabase service. Opening an HTML file is no longer the application entry point.

## Supabase setup

1. Create or resume a Supabase project.
2. In Authentication, enable **anonymous sign-ins**. Players get a persistent identity without an email/password form. See [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).
3. In the project's SQL Editor, run both migrations in `supabase/migrations/` once each, in filename order, on a new database:
   - [`20261005182109_online_multiplayer.sql`](supabase/migrations/20261005182109_online_multiplayer.sql) creates the tables, grants, RLS policies, server-only RPC functions, and Realtime publication entries.
   - [`20261007120000_cleanup_and_rejoin.sql`](supabase/migrations/20261007120000_cleanup_and_rejoin.sql) enables `pg_cron`, schedules the room cleanup job, and adds private rejoin codes (`mw_seat_keys`) with the `mw_reclaim_seat` function.
4. Confirm the `supabase_realtime` publication includes `mw_rooms` and `mw_connections`. The first migration adds them; do not publish `mw_game_secrets`, `mw_commands`, or `mw_seat_keys`.
5. Add the project's URL, publishable key, and secret key to your environment.

The SQL migrations are versioned for the Supabase CLI too. If you already use linked Supabase migrations, apply them with `npm run db:push` after linking the intended project. Do not re-run a migration against a database that already has it; create a new migration for later schema changes.

**Room cleanup:** a `pg_cron` job runs every minute and deletes rooms that are closed or have had no game activity for 15 minutes, along with their private state, connections, command receipts, and rejoin codes. Lobbies and paused games are included, so a game left idle for 15 minutes is gone. Check recent runs with `select * from cron.job_run_details order by start_time desc limit 5;`.

A missing/paused project, disabled anonymous sign-ins, missing migration, or missing server key prevents online play. The app reports a connection/configuration error instead of starting a local game.

## GitHub and Vercel

1. Push this project to a GitHub repository, including `package-lock.json`, `public/`, and `supabase/migrations/`. Keep `.env.local`, `node_modules`, `.next`, `.cache`, and `output` out of Git.
2. Import that repository into Vercel. Select the **Next.js** framework preset and the repository root as the root directory. The standard `npm run build` command is sufficient; use the default output setting.
3. Add the three environment variables above to the Vercel project. Configure Preview separately if you use a separate test database.
4. Deploy. If public environment variables change later, redeploy so the browser bundle receives them.
5. Open the deployment, create a game, and share its generated link. The app uses the current site's origin, so links automatically become `https://YOUR_DEPLOYMENT.vercel.app/game/AB12CD` or your custom domain.

Supabase hosts the Realtime WebSocket connection. Vercel handles short authenticated HTTP commands; it does not need a persistent WebSocket server or an in-memory room process. See [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).

The GitHub Actions workflow runs the rule, authorization, database-policy tests, and production build on pushes and pull requests. It does not need production secrets.

## Play and reconnect

- **Create Game:** enter a name and token. You become the Host and receive a unique six-character room code and share link.
- **Join Game:** enter a code, or open a shared `/game/CODE` link. New visitors choose their own name and token at that room's entry screen.
- The lobby shows the Host, names, tokens, and connection status. Names and tokens must be unique. At most four players can join.
- Only the Host can start, with at least two players. Everyone plays by the same rules; there are no roles. Player choices lock when play starts.
- Every player sees the same dice, movement, money, assets, buildings, events, rent, Prison status, trade offers, bankruptcy, and winner.
- Each browser can act only for its own player. Auctions authorize the current bidder, a trade offer authorizes its recipient, and an event debt authorizes its debtor, even outside their normal turn.
- Refresh or reopen the room link **in the same browser profile** to recover your seat. Supabase retains the game; the browser retains your anonymous identity.
- **Rejoin codes:** select **Show rejoin code** on the room status line to see your private 8-character code (like `ABCD-2345`). On another device, or after clearing browser data, choose **Join Game → Already have a seat? Rejoin with a code**, enter the room code and your rejoin code, and your seat, cash, and properties move to that device. Whoever holds the code can move the seat, so keep it private. Bots have no codes.
- **Exit game** (top bar) leaves a running game for good: your properties and buildings return to the bank and play continues. It is unavailable during an auction or unpaid payment.
- Connection status uses a separate heartbeat for every tab. An abrupt disconnect is marked offline after approximately 45 seconds. A clean tab departure is reported immediately where the browser permits it.
- Each player has 90 seconds to act. When time runs out, any connected player's browser asks the server to pass the turn: an open offer is skipped, an event is applied, an auction bid is passed, an unanswered trade offer is declined, and a pending payment is settled (or the player goes bankrupt if their assets cannot cover it).
- Rolling doubles makes that landing a waypoint with no action; the player must roll again, and only the final landing is resolved. The Host does not need to stay online after the game starts.
- Leaving a lobby transfers hosting to the next remaining player. Simply refreshing or briefly disconnecting does not transfer hosting.
- An uncertain command response keeps the original request ID for safe retry, including after refresh. Known invalid/stale actions refresh the room before another attempt.
- Clearing browser site data or switching browser profiles loses the anonymous identity; use your rejoin code to take your seat back. A room code identifies the room, not a player.

The square board is the only board view: all 40 spaces around the edges, moving player tokens, property ownership and buildings, and dice in the center. On laptops, market activity sits on the left and players and actions on the right; tablets and phones show the board first at full width. Tap any space to read its full deed. **Your token** focuses your current space, and keyboard users can open a focused deed with Enter or Space. The ☾/☀ button in the header switches dark mode, remembered per browser.

Sound can be muted in Settings; browser audio requires an initial user interaction. Animations respect the device's reduced-motion preference.

Purchases, rent, taxes, Launch income, events, and penalties appear as short notifications at the top of the screen for every player. Player cards and deeds show individual house icons and counts; the board also displays the buildings. A tower represents the fifth development level.

Unowned properties offer **Buy** or **Skip**. Skipping leaves the property with the bank; there is no auction. After purchase, the owner can choose **Auction property** during their own turn, before rolling or after resolving their landing. Other players bid; the seller receives the winning amount and the buyer receives the property with its buildings. If everyone passes, the owner keeps it. Mortgaged properties must be unmortgaged first.

**Trading:** on your turn, before rolling or after resolving your move, choose **Propose trade** (action card or Assets) to offer any player properties and/or cash for their properties and/or cash. The other player accepts or declines; an unanswered offer is declined after 90 seconds. Properties in a color that has buildings cannot be traded, and mortgages move with the property. You can make up to 3 offers per turn. Bots accept offers they consider fair and may offer cash for the last property they need to complete a set.

## Architecture and integrity

| Area | Implementation |
| --- | --- |
| Pages and room links | Next.js App Router in `app/` |
| Room creation and commands | Authenticated route handlers under `app/api/rooms/` |
| Authoritative rules | `lib/game-engine.cjs`, shared server-validated rules model |
| Identity/turn checks | `lib/game-actions.ts`, `lib/validation.ts` |
| Turn timer and leaving | `lib/turn-timeout.ts`, `lib/bot-timing.ts` |
| Rejoin codes | `lib/seat-keys.ts`, `mw_reclaim_seat` |
| Board renderer | `lib/game-ui.js` (grid, center controls, pawn placement), `app/classic-board.css`, `app/board-premium.css` (frame, cards, felt, piece layout and animation) |
| Board miniatures | `lib/board-pieces.js`: SVG pawns, ownership shields, houses, the tower and space icons, all drawn from game state and `player.color` |
| Online UI and recovery | `components/useMultiplayer.ts`, `GameClient`, `Lobby`, `PlayerForm` |
| Public room state | `mw_rooms`, read-only to authenticated room members |
| Private state/deck order | `mw_game_secrets`, server access only |
| Connection status | `mw_connections`, read-only to room members |
| Deduplication | `mw_commands`, server access only |
| Rejoin codes | `mw_seat_keys`, server access only |
| Room cleanup | `mw_cleanup_rooms()` on a one-minute `pg_cron` schedule |

The API verifies the Supabase access token with `auth.getUser()`. It never trusts a caller-supplied player ID, balance, dice roll, or complete state. Dice use Node's cryptographic random source. The database locks the room and checks its revision before accepting a mutation. A request ID and command fingerprint make retries idempotent. Two actions calculated from the same revision cannot both commit.

Game commands read the room revision and private game state together in one database snapshot, so concurrent commands cannot combine an old revision with a newer state.

Lobby joins, unique tokens/names, four-seat capacity, profile edits, and host transfers run inside database transactions. RLS blocks outsiders from reading a room. Browser roles cannot mutate any game table or execute privileged RPCs. Future event deck order is excluded from the public snapshot and Realtime stream.

Realtime delivers committed snapshots. A fetch after subscription, periodic reconciliation, and reconnect/visibility handlers recover missed messages. Client animations replay accepted moves without calculating new game outcomes. The server state is already durable if a tab closes mid-animation.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

`npm test` runs 41 rule checks, 18 server and bot checks, and 8 PostgreSQL/PGlite checks. These cover complete games (including trades), classic rents, 2-of-a-color and even building, trades, doubles waypoints, turn timeouts, leaving a game, owner auctions, off-turn debt, detention, bankruptcy, room capacity, idempotency, conflicting revisions, RLS, private deck order, rejoin codes, and room cleanup. PGlite exercises PostgreSQL rules and policies; it has no `pg_cron`, so the cleanup function is tested directly rather than through its schedule, and it does not test the hosted Realtime service.

Deterministic two-browser UI checks use the Playwright CLI. Start the app with `npm run dev` first, then open it at `localhost` (the Next.js dev server rejects `127.0.0.1`):

```sh
node tests/prepare-ui-checks.cjs
npx playwright-cli -s=market-online open http://localhost:3000 --headed
npx playwright-cli -s=market-online run-code --filename=output/playwright/online-ui-checks.js
npx playwright-cli -s=market-online close
```

These 69 browser checks deliberately mock Supabase Auth, HTTP, and Realtime transport. They verify the real browser UI, permissions, synchronized dice and ownership display, top notifications, house counts, owner auctions, shared event cards, reduced motion, both audio files, rejoin codes, room-link entry, refresh, offline handling, bot turns, keyboard access, locating a token, and square-board layouts from 320px to 1440px. If a check fails, the error names the last check that passed. Screenshots are written under `output/playwright/`.

For a **real internet/Supabase smoke test**, configure a test Supabase project with anonymous sign-ins and the migration, start the Next app against it, and run:

```powershell
$env:RUN_LIVE_TESTS = '1'
$env:TEST_APP_URL = 'http://localhost:3000'
npm run test:online
```

`TEST_APP_URL` can also be a Vercel test deployment using the same project. The test verifies server cleanup access before creating five temporary anonymous identities, then checks actual Realtime delivery, joins, capacity, authorization, simultaneous rolls, restoration and RLS. It checks every room and identity cleanup result before reporting success. If cleanup fails, exact recovery IDs remain in an ignored `output/live-tests/` receipt. The server key is required for cleanup. No live test is silently replaced with a mock when configuration is missing.

Before inviting friends, also open the deployed link on two different devices/networks, make a purchase, refresh one device, and confirm both show the same turn and money.

## Rules

Everyone begins with $1,500 and the last financially active player wins. All players follow one classic rule set; there are no roles. The in-game **How to play** dialog has the full rules.

- **Buying:** unowned property costs its listed price. Landing on it offers only **Buy** or **Skip**; a skipped property stays with the bank.
- **Rent:** undeveloped land charges base rent, doubled when the owner holds at least 2 properties of that color. Houses and the tower use the rent table on each deed. Transit stations charge $25 with one and $50 with both; utilities charge the dice total ×4, or ×10 with both. Mortgaged property collects no rent. Rent is still collected while in Prison.
- **Building:** own at least 2 unmortgaged properties of a color. A newly acquired property must be landed on again before its first build; after that you can build on it at any point in your turn, evenly across the ones you own, at the district price per level. Sell evenly for half the cost.
- **Mortgages:** half the price; sell every building in the color first. Unmortgage for the value plus 10%.
- **Trading:** properties and cash between players, as described above.
- **Taxes and spaces:** Business Tax $200, Wealth Tax $100, Free Market does nothing, City Bank pays $50, Open Auction offers a random unowned property.
- **Prison:** the Go to Prison corner, some event cards, or three doubles in a row. Roll doubles, pay $50 before rolling, or pay $50 after three failed rolls. Landing on Prison normally is just a visit.
- **Doubles:** a doubles landing is a waypoint with no purchase, rent, tax, or event. You must roll again; only the final landing resolves, and End turn stays disabled until then.
- **Turn timer:** 90 seconds of inactivity passes the turn, as described above.

Games saved under the earlier two-role version still load: roles are ignored and a Price War detention becomes Prison.
