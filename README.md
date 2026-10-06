# MARKET WARS — Online Multiplayer

An original strategy board game for 2–4 people playing on separate phones, tablets, laptops, or browsers, with an animated 3D tabletop, shared dice and card reveals, and the supplied dice and property-visit sounds.

The application uses **Next.js 16, TypeScript, Supabase Auth/Postgres/Realtime, and Vercel**. Every game command runs on the server and is committed to Supabase. There is no offline game-state fallback.

**Play online:** [game-wine-kappa-71.vercel.app](https://game-wine-kappa-71.vercel.app). The Vercel project is connected to this repository and automatically deploys pushes to `main`.

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
3. In the project's SQL Editor, run the complete migration in [`supabase/migrations/20261005182109_online_multiplayer.sql`](supabase/migrations/20261005182109_online_multiplayer.sql) once on a new database. The migration creates the tables, grants, RLS policies, server-only RPC functions, and Realtime publication entries together.
4. Confirm the `supabase_realtime` publication includes `mw_rooms` and `mw_connections`. The migration adds them; do not publish `mw_game_secrets` or `mw_commands`.
5. Add the project's URL, publishable key, and secret key to your environment.

The SQL migration is versioned for the Supabase CLI too. If you already use linked Supabase migrations, apply it with `npm run db:push` after linking the intended project. Do not re-run the initial migration against an already migrated database; create a new migration for subsequent schema changes.

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

- **Create Game:** enter a name, role, and token. You become the Host and receive a unique six-character room code and share link.
- **Join Game:** enter a code, or open a shared `/game/CODE` link. New visitors choose their own name, role, and token at that room's entry screen.
- The lobby shows the Host, names, roles, tokens, and connection status. Names and tokens must be unique. At most four players can join.
- Only the Host can start, with at least two players and at least one Monopolist and one Competitor. Player choices lock when play starts.
- Every player sees the same dice, movement, money, assets, buildings, events, rent, Prison/Price War status, bankruptcy, and winner.
- Each browser can act only for its own player. Auctions authorize the current bidder; an event debt authorizes its debtor even outside their normal turn.
- Refresh or reopen the room link **in the same browser profile** to recover your seat. Supabase retains the game; the browser retains your anonymous identity.
- Connection status uses a separate heartbeat for every tab. An abrupt disconnect is marked offline after approximately 45 seconds. A clean tab departure is reported immediately where the browser permits it.
- Disconnection does not cause bankruptcy, remove assets, or skip a turn. The table waits for the acting player to reconnect. The Host does not need to stay online after the game starts.
- Leaving a lobby transfers hosting to the next remaining player. Simply refreshing or briefly disconnecting does not transfer hosting.
- An uncertain command response keeps the original request ID for safe retry, including after refresh. Known invalid/stale actions refresh the room before another attempt.
- Clearing browser site data or switching browser profiles loses an anonymous identity. A room code identifies the room, not an existing player's identity. New devices can join as new players before the game starts; account-based identity recovery is outside this version.

The board fits small screens by default. Drag to rotate, pinch or scroll to zoom, and use the camera buttons to reset or look straight down. Keyboard users can focus the board, select spaces with arrow keys, and open a deed with Enter. A flat board is available when WebGL cannot initialize. Mobile controls remain accessible at the bottom. Sound can be muted in Settings; browser audio requires an initial user interaction. Animations respect the device's reduced-motion preference.

Buying a property shows the owner's token on the board and a purchase popup for everyone. Player cards and deeds show individual house icons and counts; the board also displays the buildings. A tower represents the fifth development level.

Unowned properties offer **Buy** or **Skip**. Skipping leaves the property with the bank. After purchase, the owner can choose **Auction property** during their own turn, before rolling or after resolving their landing. Other players bid; the seller receives the winning amount and the buyer receives the property with its buildings. If everyone passes, the owner keeps it. Mortgaged properties must be unmortgaged first.

## Architecture and integrity

| Area | Implementation |
| --- | --- |
| Pages and room links | Next.js App Router in `app/` |
| Room creation and commands | Authenticated route handlers under `app/api/rooms/` |
| Authoritative rules | `lib/game-engine.cjs`, shared server-validated rules model |
| Identity/turn checks | `lib/game-actions.ts`, `lib/validation.ts` |
| Board renderer | `lib/board-3d.ts` (Three.js), `lib/game-ui.js`, `style.css`, and `app/multiplayer.css` |
| Online UI and recovery | `components/useMultiplayer.ts`, `GameClient`, `Lobby`, `PlayerForm` |
| Public room state | `mw_rooms`, read-only to authenticated room members |
| Private state/deck order | `mw_game_secrets`, server access only |
| Connection status | `mw_connections`, read-only to room members |
| Deduplication | `mw_commands`, server access only |

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

`npm test` runs 31 rule checks, 9 server authorization checks, and 6 PostgreSQL/PGlite checks. These cover complete games, owner auctions, off-turn debt, detention continuations, bankruptcy, room capacity, idempotency, conflicting revisions, RLS, and private deck order. PGlite exercises PostgreSQL rules and policies; it does not test the hosted Realtime service.

Deterministic two-browser UI checks use the Playwright CLI. Start the app at port 3000 first, then:

```sh
node tests/prepare-ui-checks.cjs
npx playwright-cli -s=market-online open http://127.0.0.1:3000 --headed
npx playwright-cli -s=market-online run-code --filename=output/playwright/online-ui-checks.js
npx playwright-cli -s=market-online close
```

These browser checks deliberately mock Supabase Auth, HTTP, and Realtime transport. They verify the real browser UI, permissions, synchronized dice and ownership display, house counts, owner auctions, shared event cards, reduced motion, both audio files, room-link entry, refresh, and layouts from 320px to 1440px. Screenshots are written under `output/playwright/`.

For a **real internet/Supabase smoke test**, configure a test Supabase project with anonymous sign-ins and the migration, start the Next app against it, and run:

```powershell
$env:RUN_LIVE_TESTS = '1'
$env:TEST_APP_URL = 'http://localhost:3000'
npm run test:online
```

`TEST_APP_URL` can also be a Vercel test deployment using the same project. The test verifies server cleanup access before creating five temporary anonymous identities, then checks actual Realtime delivery, joins, capacity, authorization, simultaneous rolls, restoration and RLS. It checks every room and identity cleanup result before reporting success. If cleanup fails, exact recovery IDs remain in an ignored `output/live-tests/` receipt. The server key is required for cleanup. No live test is silently replaced with a mock when configuration is missing.

Before inviting friends, also open the deployed link on two different devices/networks, make a purchase, refresh one device, and confirm both show the same turn and money.

## Rules preserved

Everyone begins with $1,500. The last financially active player wins. The 40 spaces, original property names, two 15-card event decks, role differences, dice/doubles rules, mortgages, taxes, detention, and bankruptcy rules are preserved. Auctions now start only when a property owner chooses to sell; the auction space offers an unowned property for purchase first. Existing saved bank auctions can still finish. The in-game **How to play** dialog contains the full rules.
