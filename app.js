/*
 * Repo Diagram: turn any GitHub repo into a nested treemap of its codebase.
 * One API call for the whole tree. Everything else runs in the browser.
 */

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 1000;
const VIEW_H = 620;

/* ---- language colors (by file extension) ---- */
const LANG = {
  js: ["JavaScript", "#f1e05a"], mjs: ["JavaScript", "#f1e05a"], cjs: ["JavaScript", "#f1e05a"],
  jsx: ["JavaScript", "#f1e05a"],
  ts: ["TypeScript", "#3178c6"], tsx: ["TypeScript", "#3178c6"],
  py: ["Python", "#3572A5"], ipynb: ["Jupyter", "#DA5B0B"],
  rb: ["Ruby", "#701516"], go: ["Go", "#00ADD8"], rs: ["Rust", "#dea584"],
  java: ["Java", "#b07219"], kt: ["Kotlin", "#A97BFF"], swift: ["Swift", "#F05138"],
  c: ["C", "#555555"], h: ["C/C++", "#555555"], cpp: ["C++", "#f34b7d"], cc: ["C++", "#f34b7d"],
  hpp: ["C++", "#f34b7d"], cs: ["C#", "#178600"],
  php: ["PHP", "#4F5D95"], sh: ["Shell", "#89e051"], bash: ["Shell", "#89e051"],
  html: ["HTML", "#e34c26"], css: ["CSS", "#563d7c"], scss: ["SCSS", "#c6538c"],
  vue: ["Vue", "#41b883"], svelte: ["Svelte", "#ff3e00"], dart: ["Dart", "#00B4AB"],
  json: ["JSON", "#8892b0"], yml: ["YAML", "#cb171e"], yaml: ["YAML", "#cb171e"],
  toml: ["TOML", "#9c4221"], xml: ["XML", "#0060ac"],
  md: ["Markdown", "#6a737d"], mdx: ["Markdown", "#6a737d"], txt: ["Text", "#6a737d"],
  sql: ["SQL", "#e38c00"], graphql: ["GraphQL", "#e10098"], proto: ["Protobuf", "#8892b0"],
  lock: ["Lockfile", "#3a4252"], svg: ["SVG", "#ff9e64"],
  png: ["Image", "#7c5cff"], jpg: ["Image", "#7c5cff"], jpeg: ["Image", "#7c5cff"],
  gif: ["Image", "#7c5cff"], ico: ["Image", "#7c5cff"], webp: ["Image", "#7c5cff"],
};
const UNKNOWN = ["Other", "#3a4252"];
const extOf = (name) => {
  const b = name.split("/").pop();
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
};
const langOf = (name) => LANG[extOf(name)] || UNKNOWN;

/* ---- stack detection: file/path signatures ---- */
const STACK_SIGNS = [
  { test: (p) => p === "package.json", label: "Node.js", color: "#68a063" },
  { test: (p) => p === "tsconfig.json", label: "TypeScript", color: "#3178c6" },
  { test: (p) => /^next\.config\./.test(p), label: "Next.js", color: "#e9edf4" },
  { test: (p) => /^vite\.config\./.test(p), label: "Vite", color: "#646cff" },
  { test: (p) => /tailwind\.config\./.test(p), label: "Tailwind", color: "#22d3ee" },
  { test: (p) => p === "requirements.txt" || p === "pyproject.toml" || p === "setup.py", label: "Python", color: "#3572A5" },
  { test: (p) => p === "go.mod", label: "Go", color: "#00ADD8" },
  { test: (p) => p === "cargo.toml", label: "Rust", color: "#dea584" },
  { test: (p) => p === "gemfile", label: "Ruby", color: "#701516" },
  { test: (p) => p === "pom.xml" || /^build\.gradle/.test(p), label: "JVM/Java", color: "#b07219" },
  { test: (p) => p === "dockerfile" || p === "docker-compose.yml" || p === "docker-compose.yaml", label: "Docker", color: "#2496ed" },
  { test: (p) => p.startsWith(".github/workflows/"), label: "GitHub Actions", color: "#e9edf4" },
  { test: (p) => p === "makefile", label: "Make", color: "#8892b0" },
  { test: (p) => /(jest\.config|vitest\.config|pytest\.ini|\.test\.|_test\.|\/tests?\/)/.test(p), label: "Has tests", color: "#37d68a" },
  { test: (p) => p === "prisma/schema.prisma", label: "Prisma", color: "#5a67d8" },
  { test: (p) => p === "terraform" || /\.tf$/.test(p), label: "Terraform", color: "#7b42bc" },
];

/* ---- state ---- */
let ROOT = null;      // full tree
let CURRENT = null;   // node currently displayed
let REPO_META = null; // { full_name, description, html_url }

/* ---- events ---- */
$("repo-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run($("repo").value);
});
document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    $("repo").value = c.dataset.repo;
    run(c.dataset.repo);
  })
);
$("download").addEventListener("click", downloadPng);

/* ---- main ---- */
async function run(raw) {
  const parsed = parseRepo(raw);
  if (!parsed) return showStatus("That does not look like a GitHub repo. Try owner/name.", true);
  const { owner, repo } = parsed;

  $("go").disabled = true;
  $("result").hidden = true;
  showStatus(`<div class="spinner"></div>Reading <b>${esc(owner)}/${esc(repo)}</b> ...`);

  try {
    const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (metaRes.status === 404) throw new Error(`No repo at ${owner}/${repo}. Private or typo?`);
    if (metaRes.status === 403) throw new Error("GitHub rate limit hit (60/hr unauthenticated). Wait a minute and retry.");
    if (!metaRes.ok) throw new Error(`GitHub returned ${metaRes.status}.`);
    const meta = await metaRes.json();

    const branch = meta.default_branch || "main";
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    if (!treeRes.ok) throw new Error(`Could not read the file tree (${treeRes.status}).`);
    const tree = await treeRes.json();

    const blobs = (tree.tree || []).filter((n) => n.type === "blob");
    if (blobs.length === 0) throw new Error("This repo has no files to map.");

    REPO_META = { full_name: meta.full_name, description: meta.description, html_url: meta.html_url, truncated: tree.truncated };
    ROOT = buildTree(meta.name, blobs);
    computeSize(ROOT);
    CURRENT = ROOT;

    render(meta, blobs);
  } catch (err) {
    showStatus(`⚠️ ${esc(err.message)}`, true);
  } finally {
    $("go").disabled = false;
  }
}

function parseRepo(raw) {
  if (!raw) return null;
  let s = raw.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/* ---- tree building ---- */
function buildTree(rootName, blobs) {
  const root = { name: rootName, path: "", isDir: true, children: [], _map: {}, size: 0 };
  for (const b of blobs) {
    const parts = b.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        node.children.push({ name: part, path: b.path, isDir: false, size: b.size || 1 });
      } else {
        let child = node._map[part];
        if (!child) {
          child = { name: part, path: parts.slice(0, i + 1).join("/"), isDir: true, children: [], _map: {}, size: 0 };
          node._map[part] = child;
          node.children.push(child);
        }
        node = child;
      }
    }
  }
  return root;
}

function computeSize(node) {
  if (!node.isDir) return node.size;
  node.size = node.children.reduce((s, c) => s + computeSize(c), 0);
  return node.size;
}

/* ---- squarified treemap ---- */
function squarify(nodes, x, y, w, h) {
  const items = nodes.filter((n) => n.size > 0).slice().sort((a, b) => b.size - a.size);
  const out = [];
  const totalValue = items.reduce((s, n) => s + n.size, 0);
  if (totalValue <= 0 || w <= 0 || h <= 0) return out;
  const scale = (w * h) / totalValue;
  const areas = items.map((n) => n.size * scale);

  let rect = { x, y, w, h };
  let i = 0;
  while (i < items.length) {
    const wide = rect.w >= rect.h;
    const side = wide ? rect.h : rect.w;
    const row = [];
    let rowArea = 0;
    let curWorst = Infinity;
    let j = i;
    while (j < items.length) {
      const cand = row.map((k) => areas[k]).concat(areas[j]);
      const w2 = worst(cand, rowArea + areas[j], side);
      if (row.length === 0 || w2 <= curWorst) {
        row.push(j);
        rowArea += areas[j];
        curWorst = w2;
        j++;
      } else break;
    }
    const thick = rowArea / side;
    let pos = wide ? rect.y : rect.x;
    for (const k of row) {
      const len = areas[k] / thick;
      if (wide) out.push({ node: items[k], x: rect.x, y: pos, w: thick, h: len });
      else out.push({ node: items[k], x: pos, y: rect.y, w: len, h: thick });
      pos += len;
    }
    if (wide) { rect.x += thick; rect.w -= thick; }
    else { rect.y += thick; rect.h -= thick; }
    i = j;
  }
  return out;
}
function worst(areasArr, sum, side) {
  const thick = sum / side;
  let w = 0;
  for (const a of areasArr) {
    const len = a / thick;
    const r = Math.max(thick / len, len / thick);
    if (r > w) w = r;
  }
  return w;
}

/* ---- rendering ---- */
const MAX_DEPTH = 6;
const RECURSE_MIN = 26;   // folder must be at least this big to show children
const LABEL_MIN = 34;     // min px to draw a text label

function render(meta, blobs) {
  $("status").hidden = true;

  $("repo-name").textContent = meta.full_name;
  $("repo-link").href = meta.html_url;
  $("repo-desc").textContent = meta.description || "";

  renderStack(blobs);
  renderLangs(blobs);
  renderGlance(blobs);

  drawMap(CURRENT);
  renderBreadcrumb();

  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function drawMap(node) {
  const svg = $("map");
  svg.innerHTML = "";
  const frag = document.createDocumentFragment();
  layout(node, 2, 2, VIEW_W - 4, VIEW_H - 4, 0, frag);
  svg.appendChild(frag);
}

function layout(node, x, y, w, h, depth, frag) {
  const rects = squarify(node.children, x, y, w, h);
  for (const r of rects) {
    const n = r.node;
    const canRecurse =
      n.isDir && n.children.length > 0 && depth < MAX_DEPTH &&
      r.w > RECURSE_MIN && r.h > RECURSE_MIN;

    if (canRecurse) {
      // folder container
      const pad = 2;
      const labelH = r.h > 46 && r.w > 60 ? 15 : 0;
      const g = el("g", { class: "node" });
      g.appendChild(el("rect", {
        class: "folder", x: r.x, y: r.y, width: r.w, height: r.h,
        rx: 3, fill: "#0e1220", stroke: "#2b3346", "stroke-width": 1,
      }));
      if (labelH) {
        const t = el("text", {
          x: r.x + 5, y: r.y + 11, fill: "#8b96ab", "font-size": 10, "font-weight": 600,
          "font-family": "ui-sans-serif, system-ui, sans-serif",
        });
        t.textContent = clipText(n.name, r.w - 10, 10);
        g.appendChild(t);
      }
      g.addEventListener("click", (e) => { e.stopPropagation(); zoomTo(n); });
      addHover(g, n, true);
      frag.appendChild(g);
      layout(n, r.x + pad, r.y + pad + labelH, r.w - pad * 2, r.h - pad * 2 - labelH, depth + 1, frag);
    } else {
      // leaf (a file, or a folder too small to expand)
      const [lang, color] = n.isDir ? ["Folder", "#2b3346"] : langOf(n.name);
      const g = el("g", { class: "node" });
      g.appendChild(el("rect", {
        class: "leaf", x: r.x, y: r.y, width: Math.max(0, r.w - 0.5), height: Math.max(0, r.h - 0.5),
        rx: 2, fill: color, "fill-opacity": n.isDir ? 0.5 : 0.92,
      }));
      if (r.w > LABEL_MIN && r.h > 12) {
        const t = el("text", {
          x: r.x + 4, y: r.y + 12, fill: labelColor(color), "font-size": 9.5,
          "font-family": "ui-sans-serif, system-ui, sans-serif",
        });
        t.textContent = clipText(n.name, r.w - 8, 9.5);
        g.appendChild(t);
      }
      if (n.isDir) g.addEventListener("click", (e) => { e.stopPropagation(); zoomTo(n); });
      addHover(g, n, n.isDir);
      frag.appendChild(g);
    }
  }
}

function zoomTo(node) {
  CURRENT = node;
  drawMap(node);
  renderBreadcrumb();
  hideTip();
}

function renderBreadcrumb() {
  const bc = $("breadcrumb");
  bc.innerHTML = "";
  const chain = [];
  let n = CURRENT;
  const byPath = indexByPath(ROOT);
  // walk up using path segments
  const segs = CURRENT.path ? CURRENT.path.split("/") : [];
  chain.push(ROOT);
  let acc = "";
  for (const s of segs) {
    acc = acc ? acc + "/" + s : s;
    if (byPath[acc]) chain.push(byPath[acc]);
  }
  chain.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      bc.appendChild(sep);
    }
    if (node === CURRENT) {
      const cur = document.createElement("span");
      cur.className = "current";
      cur.textContent = i === 0 ? node.name : node.name;
      bc.appendChild(cur);
    } else {
      const b = document.createElement("button");
      b.textContent = node.name;
      b.addEventListener("click", () => zoomTo(node));
      bc.appendChild(b);
    }
  });
}

function indexByPath(root) {
  const map = {};
  (function walk(n) {
    if (n.path) map[n.path] = n;
    if (n.children) n.children.forEach(walk);
  })(root);
  return map;
}

/* ---- side panels ---- */
function renderStack(blobs) {
  const paths = blobs.map((b) => b.path.toLowerCase());
  const found = [];
  const seen = new Set();
  for (const sign of STACK_SIGNS) {
    if (seen.has(sign.label)) continue;
    if (paths.some((p) => sign.test(p))) { found.push(sign); seen.add(sign.label); }
  }
  const box = $("stack");
  box.innerHTML = "";
  if (found.length === 0) { box.innerHTML = '<span style="color:#6b7488;font-size:13px">No obvious signals</span>'; return; }
  for (const s of found) {
    const chip = document.createElement("span");
    chip.className = "stack-chip";
    chip.innerHTML = `<span class="dot" style="background:${s.color}"></span>${esc(s.label)}`;
    box.appendChild(chip);
  }
}

function renderLangs(blobs) {
  const tally = {};
  for (const b of blobs) {
    const [lang, color] = langOf(b.path);
    if (!tally[lang]) tally[lang] = { bytes: 0, color };
    tally[lang].bytes += b.size || 1;
  }
  const total = Object.values(tally).reduce((s, v) => s + v.bytes, 0) || 1;
  const top = Object.entries(tally).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 6);
  const box = $("langs");
  box.innerHTML = "";
  for (const [lang, v] of top) {
    const pct = (v.bytes / total) * 100;
    const row = document.createElement("div");
    row.className = "langbar";
    row.innerHTML =
      `<span class="swatch" style="background:${v.color}"></span>` +
      `<span class="lname">${esc(lang)}</span>` +
      `<span class="track"><span class="fill" style="width:${pct.toFixed(1)}%;background:${v.color}"></span></span>` +
      `<span class="lpct">${pct.toFixed(1)}%</span>`;
    box.appendChild(row);
  }
}

function renderGlance(blobs) {
  const files = blobs.length;
  const bytes = blobs.reduce((s, b) => s + (b.size || 0), 0);
  const dirs = countDirs(ROOT) - 1;
  const deepest = maxDepth(ROOT);
  const rows = [
    ["Files", files.toLocaleString()],
    ["Folders", dirs.toLocaleString()],
    ["Total size", humanSize(bytes)],
    ["Max depth", String(deepest)],
  ];
  if (REPO_META && REPO_META.truncated) rows.push(["Note", "tree truncated by API"]);
  const box = $("glance");
  box.innerHTML = "";
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`;
    box.appendChild(row);
  }
}

function countDirs(n) { return n.isDir ? 1 + n.children.filter((c) => c.isDir).reduce((s, c) => s + countDirs(c), 0) : 0; }
function maxDepth(n, d = 0) { return !n.isDir || n.children.length === 0 ? d : Math.max(...n.children.map((c) => maxDepth(c, d + 1))); }

/* ---- tooltip ---- */
function addHover(g, node, isDir) {
  g.addEventListener("mousemove", (e) => {
    const tip = $("tooltip");
    const size = isDir ? `${humanSize(node.size)} across ${node.children.length} item(s)` : humanSize(node.size);
    const kind = isDir ? "📁 " : "📄 ";
    tip.innerHTML = `<div>${kind}<b>${esc(node.name)}</b></div>` +
      `<div class="t-path">${esc(node.path || "/")}</div>` +
      `<div class="t-size">${esc(size)}</div>` +
      (isDir ? `<div class="t-path">click to zoom in</div>` : "");
    tip.hidden = false;
    const pad = 14;
    let left = e.clientX + pad, top = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (left + r.width > window.innerWidth) left = e.clientX - r.width - pad;
    if (top + r.height > window.innerHeight) top = e.clientY - r.height - pad;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  });
  g.addEventListener("mouseleave", hideTip);
}
function hideTip() { $("tooltip").hidden = true; }

/* ---- helpers ---- */
function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function clipText(s, maxW, fontSize) {
  const per = fontSize * 0.58;
  const max = Math.floor(maxW / per);
  if (s.length <= max) return s;
  if (max <= 1) return "";
  return s.slice(0, max - 1) + "…";
}
function labelColor(bg) {
  // pick dark or light text based on background luminance
  const c = bg.replace("#", "");
  if (c.length < 6) return "#000";
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0a0c10" : "#eef2f8";
}
function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  const u = ["KB", "MB", "GB"];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 ? 1 : 0) + " " + u[i];
}
function showStatus(html, isError = false) {
  const s = $("status");
  s.innerHTML = html;
  s.className = "status" + (isError ? " error" : "");
  s.hidden = false;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ---- PNG export ---- */
async function downloadPng() {
  const svg = $("map");
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  // solid background so the PNG is not transparent
  const bg = el("rect", { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: "#0e1117" });
  clone.insertBefore(bg, clone.firstChild);

  const title = REPO_META ? REPO_META.full_name : "repo";
  const cap = el("text", {
    x: 12, y: VIEW_H - 10, fill: "#5b6478", "font-size": 12,
    "font-family": "ui-sans-serif, system-ui, sans-serif",
  });
  cap.textContent = `${title} · mapped with Repo Diagram`;
  clone.appendChild(cap);

  const xml = new XMLSerializer().serializeToString(clone);
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);

  const scale = 2;
  const canvas = $("export-canvas");
  canvas.width = VIEW_W * scale;
  canvas.height = VIEW_H * scale;
  const ctx = canvas.getContext("2d");

  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = "#0e1117";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const a = document.createElement("a");
    a.download = `${title.replace("/", "-")}-map.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
    const btn = $("download");
    const old = btn.textContent;
    btn.textContent = "Saved ✓";
    setTimeout(() => (btn.textContent = old), 1400);
  };
  img.onerror = () => showStatus("Could not render PNG in this browser.", true);
  img.src = svgUrl;
}
