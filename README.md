# Caption Meme Game

A party game for phones: everyone sees the same photo, writes a funny caption, then votes. Captions stay anonymous when people vote and when scores show.

## Play on your phone

After deploy, open the **Netlify** link on your phone (that’s the game site). Friends join the same room with the short code.

## What’s running where

- **Netlify** — the website you tap
- **Render** — the live game rooms (keeps everyone in sync)

Free Render servers can nap when nobody’s playing. The first join after a nap may take about a minute.

## Play on this computer (optional)

If you want to try it on this machine:

```bash
cd caption-meme-game
npm install
npm run dev
```

Then open **http://localhost:5173** in a browser. Use a few tabs as different players.

## How a round works

1. One person creates a room and shares the code  
2. Others join with the code  
3. Host starts (needs at least 2 people)  
4. Everyone writes a caption for the photo  
5. Vote for someone else’s caption (anonymous)  
6. Scores update, then next rounds → winner → rematch or lobby  

## Sound

A short original cocktail-lounge loop plays in the browser (synthesized, not a recorded track). Tap or press a key once — browsers won’t start audio until you do. **Music on / Music off** mutes it and remembers the choice on this device. While captions are read aloud (“Number one…”), the music dips so the voice stays clear. **Voice on / Voice off** still controls that read-aloud.

## Photos

Game photos live in `client/public/photos`. Stock photo watermarks are fine.

## Deploy notes (already set up in this project)

- Render uses the `server` folder (`npm install` / `npm start`), health check `/health`
- Netlify builds the `client` folder; set `VITE_SOCKET_URL` to the Render URL (no slash at the end) before building
- Optionally set Render’s `CLIENT_ORIGIN` to your Netlify URL

## Timeouts, reconnects & Render cold starts

- **Cold start:** The API runs on Render's free tier, which sleeps after ~15 min with no HTTP traffic. The first open after idle can take ~30–60 s. Sleeping also wipes in-memory rooms.
- **Keep-awake:** While the page is open, the client pings `/health` every 4 min so the server doesn't sleep mid-game.
- **Reconnects:** Each browser has a stable player key (localStorage). If a phone locks or drops network, it rejoins the same seat automatically; players get a 3-minute grace period before removal.
- **Socket.IO:** `pingInterval` 20 s / `pingTimeout` 60 s; client retries forever and reconnects when the tab becomes visible.
- **Timers:** Default caption timer is 90 s (configurable 10–180). Voting has no timer.
