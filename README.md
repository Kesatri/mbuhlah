# GMbot by Maskus

A simple Discord bot that sends "gm" automatically every 24 hours and displays a TUI dashboard inside VPS.

## Installation
```bash
npm install discord-simple-api blessed blessed-contrib dotenv
```

## Run
```bash
node app.js
```

## Notes
- If `SEND_AT` is empty, the bot sends immediately and repeats every 24 hours.
- If `SEND_AT` is set (e.g. 09:00), the bot sends every day at that WIB time.
