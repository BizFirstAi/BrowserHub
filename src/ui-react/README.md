# BrowserHub — React UI

> **Status: Not Yet Started — Community Contributions Welcome**

This folder will contain a React-based frontend for BrowserHub. The backend API it calls is identical to the one in `../ui-js/browser-hub-ui/server.js`.

## Why a React version?

The Vanilla JS version in `ui-js` is the fastest way to get BrowserHub running and the easiest to read. But many frontend teams work in React. The React version exists so those teams can:

- Use their existing component libraries and tooling
- Write proper component tests with React Testing Library
- Build a richer UI with features like virtual scrolling for large datasets, drag-and-drop pipeline builders, or collaborative editing

The React version does **not** replace the Vanilla JS version. Both remain maintained. Contributors choose which to work on.

## Planned Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 |
| Build | Vite |
| Routing | React Router v6 |
| State | Zustand (lightweight) |
| HTTP | Fetch + SWR |
| Realtime | socket.io-client |
| Styling | CSS Modules (same design tokens as `css/main.css`) |
| Testing | Vitest + React Testing Library |

## Pages to Implement

Match every page in `../ui-js/browser-hub-ui/browser-studio/`:

| Page | Route | Priority |
|------|-------|---------|
| Dashboard | `/` | High |
| Web Extractor | `/extract` | High |
| Lead Discovery | `/leads` | High |
| Datasets | `/datasets` | High |
| Scanner | `/scan` | Medium |
| Results | `/results/:jobId` | Medium |
| Video Studio | `/studio` | Medium |
| Admin | `/admin` | Low |
| Observability | `/observability` | Low |

## How to Contribute

1. Fork the repository
2. Create your implementation in this folder: `src/ui-react/browser-hub-react/`
3. Use the API documented in [`../../Docs/api-reference.md`](../../Docs/api-reference.md)
4. Use the screen designs in [`../../Mockup/index.html`](../../Mockup/index.html) as your visual reference
5. Open a PR against the `dev` branch

## API Backend

The React UI should point at the Node.js server in `../ui-js/browser-hub-ui/` during development:

```bash
# Terminal 1: start the API server
cd ../ui-js/browser-hub-ui
npm start

# Terminal 2: start the React dev server
cd src/ui-react/browser-hub-react
npm run dev
# configure vite.config.js proxy → http://localhost:3000
```

In production, both can be served from the same Express server by adding a `dist/` static route, or deployed separately behind a reverse proxy.
