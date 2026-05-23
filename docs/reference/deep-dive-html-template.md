# Deep Dive HTML Template — Design Spec

## When to produce HTML

ALWAYS. Every deep dive produces a self-contained HTML file. This is not optional — it is one of the three mandatory deliverables (HTML + Google Doc + AgentNews PR).

## Design System

- **Background:** `#0f1117` (near-black)
- **Text:** `#c9cdd5` (body), `#e4e6eb` (headings), `#b0b4c0` (card body), `#8b8fa3` (meta)
- **Accent:** `#a78bfa` (purple — links, badges, timestamps, highlights)
- **Accent hover:** `#c4b5fd`
- **Card background:** `#16181f` with `border: 1px solid #23262f`
- **Container:** `max-width: 860px`, centered
- **Font:** system stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`)
- **Line height:** 1.7

## Required Page Structure (in order)

1. **HTML head** — `<meta charset>`, `<meta viewport>`, `<title>` (clean title, NO "Deep Dive" prefix/suffix), `<style>` block
2. **Hidden `<img>` thumbnail** — `<img src="https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg" style="display:none;">` — AgentNews publish system uses the first `<img>` for the card thumbnail. This MUST be present.
3. **Title `<h1>`** — clean video title (no "Deep Dive")
4. **Meta line** — speaker name, duration badge, "Watch on YouTube ↗" link
5. **YouTube iframe embed** — with JS fallback to thumbnail for file:// and Drive contexts
6. **Overview card** — gradient background, 2-3 sentence summary of the talk
7. **Section cards** — numbered sections (`.section-num` badge), each with:
   - Section title + timestamp link
   - Content paragraphs and lists
   - Optional `.highlight` callout box for key insights
8. **Key Takeaways** — numbered ordered list with bold leads (8-12 items)
9. **Timestamp Index** — grid of all timestamps with descriptions
10. **Footer** — "Deep Dive document generated from YouTube video {VIDEO_ID} · {Speaker}"

## Complete CSS Template

```css
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{background:#0f1117;color:#c9cdd5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.7;padding:24px 16px 64px;}
.container{max-width:860px;margin:0 auto;}
h1{font-size:clamp(1.6rem,4vw,2.2rem);color:#e4e6eb;font-weight:700;line-height:1.25;margin-bottom:8px;}
.meta{font-size:14px;color:#8b8fa3;margin-bottom:24px;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;}
.meta a{color:#a78bfa;text-decoration:none;}
.meta a:hover{text-decoration:underline;}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:rgba(139,92,246,0.15);color:#a78bfa;}
.video-wrap{margin-bottom:32px;border-radius:12px;overflow:hidden;border:1px solid rgba(139,92,246,0.15);}
.overview-card{background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(59,130,246,0.06));border:1px solid rgba(139,92,246,0.18);border-radius:14px;padding:24px 28px;margin-bottom:32px;}
.overview-card h2{color:#c4b5fd;font-size:18px;margin-bottom:10px;font-weight:700;}
.overview-card p{color:#b0b4c0;font-size:15px;}
.section-card{background:#16181f;border:1px solid #23262f;border-radius:14px;padding:24px 28px;margin-bottom:20px;transition:border-color 0.2s;}
.section-card:hover{border-color:rgba(139,92,246,0.35);}
.section-card h2{display:flex;align-items:center;gap:10px;color:#e4e6eb;font-size:17px;font-weight:700;margin-bottom:12px;flex-wrap:wrap;}
.section-num{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:rgba(139,92,246,0.18);color:#a78bfa;font-size:13px;font-weight:700;flex-shrink:0;}
.section-card p,.section-card li{font-size:15px;color:#b0b4c0;}
.section-card ul,.section-card ol{margin:10px 0 6px 20px;}
.section-card li{margin-bottom:5px;}
.section-card strong{color:#d0d4dc;}
.highlight{background:rgba(139,92,246,0.08);border-left:3px solid #a78bfa;padding:10px 16px;border-radius:0 8px 8px 0;margin:12px 0;font-size:14px;color:#c4b5fd;}
.takeaways{background:#16181f;border:1px solid #23262f;border-radius:14px;padding:24px 28px;margin-bottom:20px;}
.takeaways h2{color:#e4e6eb;font-size:18px;font-weight:700;margin-bottom:14px;}
.takeaways ol{margin-left:20px;}
.takeaways li{font-size:15px;color:#b0b4c0;margin-bottom:6px;}
.takeaways li strong{color:#c4b5fd;}
.ts-index{background:#16181f;border:1px solid #23262f;border-radius:14px;padding:24px 28px;margin-bottom:20px;}
.ts-index h2{color:#e4e6eb;font-size:18px;font-weight:700;margin-bottom:16px;}
.ts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:8px;}
.ts-row{display:flex;align-items:center;gap:10px;font-size:14px;color:#8b8fa3;}
.ts-row .timestamp{flex-shrink:0;}
.timestamp{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;background:rgba(139,92,246,0.15);color:#a78bfa;font-size:13px;font-family:monospace;text-decoration:none;transition:background 0.2s,color 0.2s;}
.timestamp:hover{background:rgba(139,92,246,0.3);color:#c4b5fd;}
footer{text-align:center;color:#444;font-size:12px;margin-top:40px;padding-top:20px;border-top:1px solid #1e2028;}
@media(max-width:600px){.ts-grid{grid-template-columns:1fr;}.section-card,.overview-card,.takeaways,.ts-index{padding:18px 16px;}}
```

## Complete HTML Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{CLEAN_TITLE}</title>
<style>
  /* PASTE FULL CSS FROM ABOVE */
</style>
</head>
<body>
<div class="container">

<img src="https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg" alt="{CLEAN_TITLE}" style="display:none;">

<h1>{CLEAN_TITLE}</h1>
<div class="meta">
  <span>{SPEAKER_NAME}</span>
  <span class="badge">~{DURATION}</span>
  <a href="https://www.youtube.com/watch?v={VIDEO_ID}" target="_blank">Watch on YouTube ↗</a>
</div>

<div class="video-wrap">
  <iframe id="yt-embed" src="https://www.youtube.com/embed/{VIDEO_ID}" title="{CLEAN_TITLE}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="no-referrer-when-downgrade" allowfullscreen style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px;"></iframe>
  <a id="yt-fallback" href="https://www.youtube.com/watch?v={VIDEO_ID}" target="_blank" style="display:none;text-decoration:none;">
    <div style="position:relative;width:100%;aspect-ratio:16/9;background:#000 url(https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg) center/cover no-repeat;border-radius:12px;overflow:hidden;">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="38" fill="rgba(255,0,0,0.85)" stroke="#fff" stroke-width="2"/><polygon points="32,22 32,58 60,40" fill="#fff"/></svg>
      </div>
      <div style="position:absolute;bottom:16px;left:16px;right:16px;color:#fff;font-size:14px;text-shadow:0 1px 4px rgba(0,0,0,0.8);">▶ Click to watch on YouTube</div>
    </div>
  </a>
  <script>var iframe=document.getElementById('yt-embed');var fallback=document.getElementById('yt-fallback');iframe.onerror=function(){iframe.style.display='none';fallback.style.display='block';};if(window.location.protocol==='file:'||window.location.hostname==='drive.google.com'){iframe.style.display='none';fallback.style.display='block';}</script>
</div>

<!-- Overview -->
<div class="overview-card">
  <h2>Overview</h2>
  <p>{2-3 sentence summary}</p>
</div>

<!-- Sections — repeat for each major topic -->
<div class="section-card">
  <h2><span class="section-num">1</span> {Section Title} <a class="timestamp" href="https://www.youtube.com/watch?v={VIDEO_ID}&t={SECONDS}s" target="_blank">▶ {MM:SS}</a></h2>
  <p>{Content}</p>
  <ul>
    <li><strong>{Bold lead}</strong> — detail</li>
  </ul>
  <div class="highlight">Key insight: {important quote or insight}</div>
</div>

<!-- Key Takeaways -->
<div class="takeaways">
  <h2>🎯 Key Takeaways</h2>
  <ol>
    <li><strong>{Bold lead}</strong> — detail</li>
  </ol>
</div>

<!-- Timestamp Index -->
<div class="ts-index">
  <h2>⏱ Timestamp Index</h2>
  <div class="ts-grid">
    <div class="ts-row"><a class="timestamp" href="https://www.youtube.com/watch?v={VIDEO_ID}&t=0s" target="_blank">▶ 0:00</a> {Description}</div>
  </div>
</div>

<footer>Deep Dive document generated from YouTube video {VIDEO_ID} · {Speaker}</footer>

</div>
</body>
</html>
```

## Content Guidelines

1. **Write in the video's language** — English videos get English articles, Greek videos get Greek articles.
2. **Maximum detail** for long videos — don't summarize, capture every key point.
3. **Section cards should map to the video's natural segments** — use timestamps from the video description or infer from transcript topic changes.
4. **Highlights** are for the single most important insight per section — use sparingly (not every section needs one).
5. **Blockquotes** — use `.highlight` divs instead of `<blockquote>` for consistency.
6. **Code snippets** use `<code>` inline or `<pre><code>` for blocks.
7. **Takeaways** should be 8-12 items, each with a bold lead phrase.
8. **Timestamp links** must use `&t={seconds}s` format.

## Pitfalls

- Do NOT use plain `<h2>`, `<p>`, `<ul>` outside of cards — everything goes inside `.section-card`, `.overview-card`, `.takeaways`, or `.ts-index`.
- Do NOT forget the hidden `<img>` tag — AgentNews publish system uses the first `<img src>` for the card thumbnail (`thumbnailSource: "html"`). Without it you must pass `--thumbnail-url` manually.
- Do NOT include "Deep Dive" in the `<title>` or `<h1>`.
- Do NOT use `<hr>` — section cards provide visual separation.
- The SHA-256 hash in catalog.json MUST be recalculated after any HTML change.
- Do NOT use different CSS across articles — use this exact template for visual consistency across all deep dives.
