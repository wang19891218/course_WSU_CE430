# CE 430 Course Website (static, GitHub Pages)

This repo is the public course website for CE 430 — Indeterminate
Structures (Fall 2026), served as a static site via GitHub Pages at
`ce430.course.hfwang.dev`.

It is intentionally separate from the AI companion app, which now
lives in its own repo at `ce430.ai.hfwang.dev` (relocated
2026-09-02). This site has no login, no server-side code, and no
database — just HTML, CSS, and PDFs.

## ⚠️ Public visibility

**GitHub Pages is public with no authentication.** Anything committed
here — including every PDF under `assets/pdf/` — is world-readable to
anyone with the URL, indexable by search engines, and visible in the
repo's git history even if later removed. Only ever commit material
that is fine for anyone on the internet to see. This is why the
release model below only ever adds already-taught/assigned content.

## Structure

```
index.html            Course home: schedule, syllabus link, materials/topics links
materials.html         Released lecture notes, homework, syllabus link
euler_bernoulli.html   Euler-Bernoulli derivation (KaTeX math, two SVG figures)
syllabus.html          Copy of the course syllabus
assets/style.css        Shared stylesheet (nav header, tables, etc.)
assets/pdf/             Released PDFs
assets/img/              SVG figures for the derivation page
.nojekyll               Disables Jekyll processing (files starting with
                         `_` etc. are served as-is)
CNAME                    Custom domain for GitHub Pages
```

## Release model

Only material that has already been covered or assigned in class is
posted here — this mirrors the release-manifest model used by the AI
companion app's `materials.py` page. To release a new file:

1. Copy the file into `assets/pdf/`.
2. Add one row (a `<div class="material-row">` block, following the
   existing pattern) to the appropriate section in `materials.html`.
3. Commit both changes together.

Do **not** post: the full lecture notes (only the as-taught portion
is released), the Quiz 1 extract, or any homework not yet assigned.

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
