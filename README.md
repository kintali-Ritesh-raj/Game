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

The square 2D board is the default view: all 40 spaces around the edges, moving player tokens, property ownership and buildings, and dice in the center. On laptops, market activity sits on the left and players and actions on the right; tablets and phones show the board first at full width. Tap any space to read its full deed. **Your token** focuses your current space, and keyboard users can open a focused deed with Enter or Space. The ☾/☀ button in the header switches dark mode, remembered per browser.

**3D board (optional).** The **2D board / 3D board** switch above the board shows a realistic tabletop: a walnut frame on a wooden table, the printed board, ivory dice, glossy pawns, owner chips and houses, event-card decks and a tray of Market Wars notes, with soft shadows and studio lighting. It is a view of the same game, and the server-confirmed state drives everything in it. The dice tumble to the values the server reports, pawns hop space by space, and tapping a space opens its deed. Drag to look around. Desktops start in 3D and phones in 2D. The choice is saved per browser. If WebGL is unavailable, the switch is disabled and the 2D board stays. If the device turns out too slow, the view falls back to 2D on its own. Reduced-motion preferences skip the dice tumble and pawn hops. All textures are drawn in code (no downloaded art), the pixel ratio is capped at 2, and the scene only redraws when something changes. Files: `components/Board3D.tsx`, `components/BoardView.tsx`, `lib/board3d-textures.ts`.

Sound can be muted in Settings; browser audio requires an initial user interaction. Animations respect the device's reduced-motion preference.

Purchases, rent, taxes, Launch income, events, and penalties appear as short notifications at the top of the screen for every player. Player cards and deeds show individual house icons and counts; the board also displays the buildings. A tower represents the fifth development level.

Unowned properties offer **Buy** or **Skip**. Skipping leaves the property with the bank; there is no auction. After purchase, the owner can choose **Auction property** during their own turn, before rolling or after resolving their landing. Other players bid; the seller receives the winning amount and the buyer receives the property with its buildings. If everyone passes, the owner keeps it. Mortgaged properties must be unmortgaged first.

**Trading:** on your turn, before rolling or after resolving your move, choose **Propose trade** (action card or Assets) to offer any player properties and/or cash for their properties and/or cash. The other player accepts or declines; an unanswered offer is declined after 90 seconds. Any property can be traded: its houses and mortgage move with it to the new owner, who must land on it before building there. You can make up to 3 offers per turn. Bots trade carefully. A bot never breaks up a color set it owns, never sells the last property of a set to anyone (unless the same trade finishes a set for the bot), and will not sell part of a color it holds 2 of. Otherwise it values a property by its price, buildings and what it means to both players, and asks a premium of at least 25% that rises against the leading player, when it has plenty of cash, and with every recent offer from the same player. When it declines, it says why and may name a property of yours it would trade for. It keeps a cash reserve for rent when paying cash. A bot offers a human player cash only for the last property it needs to complete a color, at most once every 8 rounds, and never repeats a declined offer for 20 rounds.

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

Lobby joins, unique tokens/names, four-seat capacity, profile edits, and host transfers run inside database transactions. RLS blocks outsiders from reading a room. Browser roles cannot mutate any game table or execute privileged RPCs. Event cards are independent weighted draws made on the server, so there is no hidden deck order to leak.

Realtime delivers committed snapshots. A fetch after subscription, periodic reconciliation, and reconnect/visibility handlers recover missed messages. Client animations replay accepted moves without calculating new game outcomes. The server state is already durable if a tab closes mid-animation.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

`npm test` runs 58 rule checks, 25 server and bot checks, and 8 PostgreSQL/PGlite checks. These cover complete games (including trades), classic rents, building on landing and even building, trades, doubles waypoints, turn timeouts, leaving a game, owner auctions, off-turn debt, detention, bankruptcy, room capacity, idempotency, conflicting revisions, RLS, the Wheel of Fortune, the Free Market jackpot, City Events, 100-card decks and rarity, rolled and gamble cards, the Prison pass, old-save migration, rejoin codes, and room cleanup. PGlite exercises PostgreSQL rules and policies; it has no `pg_cron`, so the cleanup function is tested directly rather than through its schedule, and it does not test the hosted Realtime service.

Deterministic two-browser UI checks use the Playwright CLI. Start the app with `npm run dev` first, then open it at `localhost` (the Next.js dev server rejects `127.0.0.1`):

```sh
node tests/prepare-ui-checks.cjs
npx playwright-cli -s=market-online open http://localhost:3000 --headed
npx playwright-cli -s=market-online run-code --filename=output/playwright/online-ui-checks.js
npx playwright-cli -s=market-online close
```

These 109 browser checks deliberately mock Supabase Auth, HTTP, and Realtime transport. They verify the real browser UI, permissions, synchronized dice and ownership display, top notifications, house counts, owner auctions, shared event cards, reduced motion, both audio files, rejoin codes, room-link entry, refresh, offline handling, bot turns, keyboard access, locating a token, and square-board layouts from 320px to 1440px. If a check fails, the error names the last check that passed. Screenshots are written under `output/playwright/`.

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
- **Animations:** every roll tumbles the dice (Tailwind throws three and greys out the dropped one); a card that rolls a die throws one 3D die over the board for every player, then shows what it paid or cost. Notifications are colour-coded: green for gains, red for losses, violet for power-ups, orange for Prison, gold for deals and blue for City Events, each naming the player. Cash changes float up from the player's balance, and a jailed pawn sits behind bars. Reduced-motion settings turn the motion off.
- **Rent:** undeveloped land charges base rent, doubled when the owner holds at least 2 properties of that color. Houses and the tower use the rent table on each deed. Owning every property of a color (the full set) doubles all of its rents, houses and tower included; undeveloped rent stays at the 2-of-a-color double. Transit stations charge $50 with one and $150 with both; utilities charge the dice total ×6, or ×15 with both. Because they can never be built on, station and utility rents are multiplied by the game stage (×2 after round 15, ×3 after round 30, ×4 after round 80, ×5 after round 130). Mortgaged property collects no rent. Rent is still collected while in Prison.
- **Building:** any unmortgaged property you own can be built on, even if it is your only one of that color. You build only on the property your token landed on this turn (not a doubles waypoint), one level per landing. A newly acquired property must be landed on again on a later turn before its first build. Build and sell evenly across every property you own in that color: each needs a building before any gets a second. Each level costs the district price; selling returns half.
- **Mortgages:** half the price; sell every building in the color first. **Fire Sale:** with under $200 in cash when you mortgage, you receive 25% more. The amount actually received is stored on the property, and unmortgaging costs 110% of it (rounded up), so a Fire Sale is never a profit loop. Automatic mortgages (bots, timeouts) follow the same rule.
- **Trading:** properties and cash between players, as described above.
- **Taxes:** Business Tax is the lesser of $200 and 10% of your cash. Wealth Tax is $15 per property and $25 per building level, so it is $0 if you own nothing. City Bank pays $50 interest, rising by $50 every 7 rounds (round 8: $100, round 15: $150). Open Auction offers a random unowned property.
- **Free Market jackpot:** half of every tax, fine and card payment to the bank goes into the Free Market pot (the other half leaves the economy, which keeps cash from inflating and games finishing). The pot starts at $100. Landing on Free Market wins all of it and resets it to $100.
- **Wheel of Fortune** (top-right corner): one spin when you land. Slices, weighted by rarity: Jackpot +$400 and Taxman −$250 (rare); Good spin +$200, Small win +$100 and Bad spin −$150 (common); Free house, Power-up and Free spin (uncommon). Free house: you choose a property for one free building level (building on landing and even building apply, landing there does not; with nothing to build on you get $100). Power-up: a random timed buff. Free spin: spin again, at most 3 in a row. The weights keep an average spin within about $15 of zero at every game stage (a test enforces it), and the odds are shown on the wheel dialog. The server spins; the browser only animates the result.
- **Prison:** landing on Prison locks you up, as do some event cards and three doubles in a row. Roll doubles, pay the fine before rolling, or pay it after three failed rolls. The fine is $50 and rises by $100 every 20 rounds (round 21: $150, round 41: $250). A **Get out of Prison free** card (from an event) is kept in your hand and used automatically whenever you would be jailed. If a detained player's 90 seconds run out, the $50 fine is paid automatically; when cash is short, their lowest-rent property is mortgaged first.
- **Event cards:** Market and Economic decks have 52 cards each, drawn by rarity (common 70%, uncommon 25%, rare 5%) and never repeating within 12 draws. Types: fixed cash, rolled amounts (die × a unit), gambles (roll a die), everyone-gains or everyone-pays, movement, per-property and per-building formulas, catch-up cards (the poorest gets a big grant) and levy cards (the richest pays into the jackpot), jail, and rare cards: Get out of Prison free, Rent Shield, Rent Doubler, Rent Reversal and Roll Again.
- **Game stage:** cash on cards and the wheel, both taxes, and station and utility rents are ×2 from round 16, ×3 from round 31, ×4 from round 81 and ×5 from round 131. A round is every active player taking one turn. (The wheel's free house and power-up do not scale, so its average drifts from about +$9 per spin at stage 1 to about −$9 at stage 3, −$18 at stage 4 and −$27 at stage 5.)
- **Power-ups** (timed buffs, shown on the player card with remaining uses): Launch Boost (next 2 passes of Launch pay $150 on top of the normal $200), Tailwind (next 2 rolls use three dice and keep the best two; doubles are judged on the kept two, and the dropped die is logged), Rent Shield (no rent on the next 2 landings that would cost rent, stations and utilities included), Rent Doubler (the next 2 rent collections are doubled, up to $400 each, never reducing a rent already above $400) and Rent Reversal (on the next 3 such landings the owner pays you). Landings that owe no rent use no charge. Order when several apply: the City Event multiplier first, then Rent Doubler and its cap, then Rent Reversal before Rent Shield. Old saves start with none.
- **City Events:** every 5th round, chosen at random but never the same twice in a row, announced one round ahead in a banner above the board and in the log: Property Boom (every rent +50% for 2 rounds), Recession (building costs −30% and every rent −25% for 2 rounds) or Tax Audit (instant: the richest player by net worth pays the poorest $100; ties go to the lower seat). Boom and Recession show their remaining rounds in the banner.
- **Doubles:** a doubles landing is a waypoint with no purchase, rent, tax, or event. You must roll again; only the final landing resolves, and End turn stays disabled until then.
- **Turn timer:** 90 seconds of inactivity passes the turn, as described above.

Games saved under the earlier two-role version still load: roles are ignored and a Price War detention becomes Prison.
