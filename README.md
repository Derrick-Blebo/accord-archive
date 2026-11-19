# accord-archive
# Accord Archive (`accordarchives.com`)

**Accord Archive** is a Christian digital library, historical manuscript archive, and fellowship community platform. It provides free and paid digital publications, curated music, a community fellowship feed, verified Ministry/Minister pages, and real-time user notifications.

---

## Tech Stack

* **Frontend:** Static HTML5, Tailwind CSS (CDN), Vanilla JavaScript
* **Icons & Fonts:** FontAwesome 6.4.0, Google Fonts (`Inter` & `Playfair Display`)
* **Backend & Auth:** Supabase (`@supabase/supabase-js@2` — Auth, PostgreSQL, Row Level Security, Storage)
* **Hosting & Serverless:** Vercel (static hosting + serverless functions in `api/`)

---

## Design System

Accord Archive uses a **light-mode-only** interface:

| Token | Hex | Usage |
| :--- | :--- | :--- |
| Background Base | `#F8FAFC` | Page canvas (`bg-accord-bg`) |
| Slate Text | `#0F172A` | Headings & primary copy (`text-accord-slate`) |
| Muted Slate | `#64748B` | Secondary text & metadata (`text-accord-muted`) |
| Accord Blue | `#0077FE` | Primary CTAs, active tabs, links (`bg-accord-blue`) |
| Dark Blue | `#005BC4` | Hover states (`bg-accord-darkBlue`) |
| Light Blue | `#E6F0FF` | Soft badges & tinted surfaces (`bg-accord-lightBlue`) |
| Accord Gold | `#F5A623` | Brand accent bar, bookmarks, verified tags (`text-accord-gold`) |

* **Typography:** `Playfair Display` (`.serif-heading`) for titles and section headings; `Inter` for body copy and UI controls.

---

## Project Structure

### Public Pages
* `index.html` / `index.js` — Digital Library homepage with Kindle-style horizontal shelves, category/access filters, mid-grid banner slider, and manuscript submission modal.
* `book.html` / `book.js` — Dedicated publication page (`book.html?id=<book_id>`) with full un-truncated description, metadata, Read/Download/Buy CTA, Likes, Comments, Save, and Share.
* `feed.html` / `feed.js` — Fellowship Feed (`All`, `Videos`, `Testimonies`, `Audio`, `Text Posts`) with likes, comments, reporting/flagging, and links to verified Ministry profiles.
* `ministry.html` / `ministry.js` — Public profile page (`ministry.html?id=<profile_id>`) for verified Ministries & Ministers with Follow/Unfollow, follower counts, and filtered post tabs.
* `post.html`, `forum.html`, `music.html`, `saved.html`, `profile.html`, `signin.html`, `author.html` — Supporting community, media, and account pages.

### Shared & Serverless
* `header.js` — Unified global navbar (`#accord-header`) with auth state, profile dropdown, saved badge, and global notification bell dropdown.
* `admin-core.js` — Shared Supabase client initializer for pages that do not instantiate their own client.
* `api/preview.js` — Vercel serverless function that injects dynamic Open Graph / WhatsApp meta tags for shared links (`book.html?id=...`, `forum.html?testimony=...`, `forum.html?event=...`).

### Admin & Moderation Portals
* `admin.html`, `superadmin.html`, `feed-admin.html`, `testimonies-admin.html` — Role-based portals for catalog management, layout configuration, and content moderation.

---

## Supabase Architecture

### Storage
* **Bucket:** `archive-files` (manuscript PDFs, covers, and user submissions)

### Core Tables
* `books` (`id` is `bigint`) — Library catalog. Uses `download_url` (not `file_url`) and `likes_count`.
* `profiles` — User accounts. Verified Ministries/Ministers are identified by:
  ```js
  account_type === 'ministry_minister' || upgrade_status === 'approved'

  feed_posts — Community feed items (post_type: video | audio | text | testimony, author_id, body, media_url, is_anonymous, is_approved, likes_count).

book_likes — Book likes keyed by (book_id, voter_key) with a trigger syncing books.likes_count.

book_comments — Authenticated reader comments on book.html.

ministry_follows — Follow relationships (follower_id, ministry_id) restricted to verified Ministries/Ministers.

notifications — Per-user notifications (type, title, message, link_url, is_read) populated via SECURITY DEFINER triggers.

Additional tables: categories, submissions, post_likes, post_comments, post_reports, user_bookmarks, user_testimony_bookmarks, user_purchases.

Postgres Triggers & Helpers
sync_book_likes_count() — Keeps books.likes_count updated on book_likes insert/delete.

notify_ministry_followers_on_post() — Notifies all followers when a verified Ministry/Minister publishes an approved, non-anonymous post to feed_posts.

notify_on_new_follow() — Notifies a Ministry/Minister when someone follows their page.

notify_on_book_comment() / notify_on_post_comment() — Notifies discussion participants and post authors on new comments.

is_verified_ministry(uuid) — SECURITY DEFINER helper used in feed_posts RLS policies so non-ministry accounts cannot publish restricted post types.

Key Conventions & Gotchas
Separate HTML & JS: Keep page logic in dedicated lowercase .js files matching their .html counterparts.

Global supabaseClient: admin-core.js and header.js initialize supabaseClient globally—never re-declare const supabaseClient on pages that load them.

Hidden Config Rows in books: Always filter out these system rows from public book queries:

__ACCORD_ROLES_CONFIG__

__ACCORD_LAYOUT_CONFIG__

__ACCORD_MUSIC_CONFIG__

Cache Busting: Whenever you update a .js file, bump its ?v=N query string in the corresponding HTML <script> tag (e.g., header.js?v=2).

Vercel OG Preview Rewrite: Ensure vercel.json routes /book.html?id=... through /api/preview?page=book:


