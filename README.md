# CF Blitz

A tiny local web app for **2-player Codeforces blitz duels** (no login, no database).

## Tech

- **Client**: React + Vite + Tailwind
- **Server**: Node.js + Express
- **Realtime**: Socket.io
- **Storage**: in-memory JS objects

## Run locally

From the `cf-blitz/` folder:

```bash
npm install
npm run dev
```

- **Frontend**: `http://localhost:5173`
- **Backend**: `http://localhost:3000` (health: `http://localhost:3000/health`)

## Run for an event (60 laptops / ~30 rooms)

Because room state is **in-memory**, all players must connect to the **same server**. Recommended setup:

- Pick **one machine** (a laptop/PC) as the **host** on the same Wi‑Fi/LAN.
- Everyone opens the host URL in a browser.

### Host machine

1) Get host IP (macOS):

```bash
ipconfig getifaddr en0
```

Assume it prints `192.168.1.50`.

2) Build + serve the app from a single port:

```bash
npm install
npm run start
```

This serves the frontend from the backend.

### Player laptops

Open:

- `http://192.168.1.50:3000`

### Notes

- Ensure the host firewall allows inbound connections on **port 3000**.
- Codeforces API is rate-limited; the server includes a small global delay between CF API requests to handle many concurrent rooms more safely.

## How to play

- Open `http://localhost:5173` in two browser windows (or two devices on the same machine).
- One player **creates** a room and shares the **room code**.
- The other player **joins** using the room code.
- Both players enter their **Codeforces handle**.
- The server picks 3 random problems (ratings **800/1000/1200**) and polls every **10s** for accepted submissions.
- Click **View statement** on a card to read the full problem statement inside the app.

## Project structure

```
cf-blitz/
  server/
    server.js
    rooms.js
    codeforces.js
  client/
    src/
      App.jsx
      Room.jsx
      Game.jsx
      socket.js
```

