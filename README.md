# CE 430 Course Website (static, GitHub Pages)

This repo is the public interactive-content site for CE 430 —
Indeterminate Structures (Fall 2026), served as a static site via
GitHub Pages at `ce430.course.hfwang.dev`. It follows the format of
the instructor's other course site,
[`ce512.course.hfwang.dev`](https://ce512.course.hfwang.dev/): a
single animated landing page with chapter sections of clickable
cards, each linking to a standalone derivation/visualization page.

It is intentionally separate from the AI companion app, which lives
in its own repo at `ce430.ai.hfwang.dev` (relocated 2026-09-02). This
site has no login, no server-side code, and no database — just HTML,
CSS, and inline JS/SVG.

## ⚠️ This site is a Canvas supplement, not a mirror

**Canvas is authoritative for everything administrative and
graded**: schedule, syllabus, lecture-note PDFs, homework sets,
grades, announcements. **Anything that can be found on Canvas should
not be here.** This site exists only for interactive derivations and
visualizations that go deeper than what fits on a PDF — content with
no grading/roster implications, safe to be public and
search-indexed on GitHub Pages (which has no authentication).

Do **not** add: schedule tables, syllabus copies, lecture-note or
homework PDFs, roster/grade data, or anything else already living on
Canvas. If it's administrative, it belongs on Canvas.

## Structure

```
index.html                          Landing page (ce512-style: animated
                                     gradient background, drifting
                                     equations, chapter sections of cards)
chapter_1/euler_bernoulli/index.html   Euler-Bernoulli derivation (KaTeX, 2 SVGs)
chapter_3/slope_deflection/index.html  Slope-deflection method (KaTeX, 1 SVG)
assets/style.css                    Shared chrome for content pages
                                     (gradient body, header/back-link,
                                     white "page-card" wrapper)
assets/img/                         SVG figures for the content pages
.nojekyll                           Disables Jekyll processing
CNAME                               Custom domain for GitHub Pages
```

Each content page keeps a `&larr; Back to CE 430 Home` link in its
header instead of a shared nav bar, matching the ce512 subpage
convention. To add a new chapter page: create
`chapter_N/<topic>/index.html` following the pattern of the two
existing pages (hero header + `<main class="page-card">`), then add
one `module-card` entry to `index.html` linking to it.

## Analytics (open item)

CE 512 embeds the instructor's Matomo tracker
(`matomo.waecoco.com`, `siteId=12`). CE 430 needs its **own** Matomo
site ID before analytics can be added here — only the instructor can
create one. `index.html` has a commented-out placeholder block ready
to fill in once a site ID exists.

## Deploying

This repo has not been pushed anywhere yet — the instructor will:

1. Create a new GitHub repository (e.g. `ce430-course-site`).
2. Add the new repository as a git remote and push the `main` branch
   to it.
3. In the repo's Settings → Pages, set the source to the `main`
   branch, root directory.
4. Add a DNS `CNAME` record pointing `ce430.course.hfwang.dev` at
   `<github-username>.github.io` (GitHub Pages will read the `CNAME`
   file already committed in this repo to serve the custom domain).

## Local preview

Any static file server works, e.g. from this directory:

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`.
