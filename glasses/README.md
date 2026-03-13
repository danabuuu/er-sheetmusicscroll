# ER Sheet Music Scroll — Glasses App

Even Hub app that scrolls sheet music on Even Realities G2 glasses.

## Local Development

```bash
cd glasses
npm install
npm run dev        # starts on http://0.0.0.0:5173
```

Copy `.env.example` to `.env.local` and set `VITE_ADMIN_URL` to your local admin server (e.g. `http://192.168.1.x:3000`).

Test with the Even Hub simulator:

```bash
npx @evenrealities/evenhub-simulator http://<your-local-ip>:5173
```

## Deployment

Deployed automatically to GitHub Pages on every push to `main` that touches `glasses/`. See `.github/workflows/deploy-glasses.yml`.
