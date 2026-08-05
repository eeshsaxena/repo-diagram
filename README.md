<div align="center">

# ◆ Repo Diagram

**Paste any GitHub repo. See the whole codebase in one picture.**

An instant, interactive treemap of any repository, colored by language,
sized by real file bytes, with auto stack detection. No install, no backend,
no sign-up. It all runs in your browser from a single API call.

[**Live demo**](#) · [How it works](#how-it-works) · [Run locally](#run-locally)

</div>

---

## What it does

Type `owner/name` (or a full GitHub URL) and Repo Diagram fetches the repo's
file tree in one request, then renders it as a **nested treemap**:

- **Every file is a tile,** sized by its real byte count.
- **Colored by language,** so the shape of the codebase is obvious at a glance.
- **Click any folder to zoom in,** with a breadcrumb to climb back out.
- **Hover for the path and size** of anything.
- **Stack detection** reads the tell-tale files (`package.json`, `Dockerfile`,
  `pyproject.toml`, `.github/workflows`, and more) and shows what the project is
  built with.
- **Download a PNG** of the map to drop in a README, a slide, or a tweet.

## Why it is shareable

- **One glance tells a story.** "Oh, that repo is 80% tests" or "this is mostly
  config" reads instantly from the picture.
- **Zero friction.** No clone, no build, no auth. Paste and see.
- **The output is the ad.** Every downloaded map carries the repo name and a
  quiet credit, so shares bring people back.

## How it works

```
index.html    layout, search, side panels
styles.css    the dark, grid-backed look
app.js        fetch, tree building, squarified treemap, zoom, export
```

1. One call to `GET /repos/{owner}/{repo}` for metadata and the default branch.
2. One call to `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` for the
   entire file tree. That is the whole network cost.
3. The flat path list is folded into a nested tree, folder sizes are summed from
   file bytes, and a **squarified treemap** (implemented from scratch, no D3)
   lays it out for good tile aspect ratios.
4. Rendering is plain SVG. PNG export serializes that SVG and rasterizes it on a
   `<canvas>`, so nothing external is needed.

No file contents are ever downloaded, so it is fast and light even on large
repos. Everything stays in your browser.

## Run locally

No build step:

```bash
npx serve .
```

Then open the printed URL, or just double-click `index.html`.

> The unauthenticated GitHub API allows 60 requests/hour per IP, and each map
> costs two requests. For a public deployment, proxy through a small serverless
> function that adds a token to raise the limit.

## Deploy

Static site, so it drops onto anything:

- **GitHub Pages:** push and enable Pages.
- **Vercel / Netlify / Cloudflare Pages:** point at the folder, no config.

## Limits and ideas

- Very large repos may hit the API's tree size cap; the panel flags a truncated
  tree when that happens.
- Roadmap: import-graph mode (parse a few key files into a dependency diagram),
  compare two repos, and a shareable permalink per repo.

## License

MIT.
