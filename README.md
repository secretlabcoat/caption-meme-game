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

## Photos

Game photos live in `client/public/photos`. Stock photo watermarks are fine.

## Deploy notes (already set up in this project)

- Render uses the `server` folder (`npm install` / `npm start`), health check `/health`
- Netlify builds the `client` folder; set `VITE_SOCKET_URL` to the Render URL (no slash at the end) before building
- Optionally set Render’s `CLIENT_ORIGIN` to your Netlify URL
