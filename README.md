# InboxPilot AI 🚀
### Autonomous 24/7 AI-Powered Email Management & Daily Digest Agent (Google Apps Script V8)

**InboxPilot AI** is a serverless, 100% free-tier autonomous email intelligence agent built on **Google Apps Script (V8)**, **Gmail API (Read-Only)**, **Google Gemini API**, **Google Sheets**, and the **Telegram Bot API**.

Designed for university students and developers receiving high volumes of daily emails, InboxPilot AI continuously monitors your Gmail inbox every 5 minutes in the background—without requiring your laptop to stay on or paying for external cloud servers.

---

## ✨ Key Features

- **🔒 Strict Read-Only Gmail Security (`gmail.readonly`)**: Uses the Gmail History API for fast incremental synchronization of `INBOX` and `SPAM` messages without ever modifying, deleting, archiving, or marking your emails as read.
- **🧠 Dual Independent AI Classification Engine**:
  - **4 Priority Levels**: `CRITICAL`, `HIGH`, `NORMAL`, `LOW` (with anti-hype guards so marketing emails saying *"URGENT SALE"* are never marked critical).
  - **15 Subject Categories**: *University and Academics*, *Placement and Recruitment*, *GitHub and Developer Tools*, *Finance and Banking*, *Bills and Payments*, *Government and Official*, *Personal Communication*, *Security and Account Notifications*, *Shopping and Orders*, *Travel and Bookings*, *Newsletters and Updates*, *Promotions and Marketing*, *Social and Events*, *Suspected Spam and Phishing*, and *Other*.
- **🕵️‍♂️ Sender Intelligence & Anti-Spoofing**: Classifies senders across 8 groups, tracks lifetime sender frequency in a **Sender Directory**, supports manual overrides in **Sender Rules** (where exact email rules take precedence over domain rules), and detects display-name spoofing.
- **✅ Action Required & Deadline Extraction (`Asia/Kolkata`)**: Identifies actionable tasks (`PENDING` / `COMPLETED` / `DISMISSED`), extracts explicit or relative deadlines into normalized `Asia/Kolkata` (`+05:30`) ISO-8601 timestamps, and flags ambiguous deadlines for manual review.
- **🚨 Immediate Critical Telegram Alerts**: Sends instant mobile alerts via Telegram within 5 minutes whenever a `CRITICAL` email arrives (e.g., exam registration closing or interview within 24 hours), complete with a clickable **View in Gmail** link.
- **📊 Comprehensive 8:30 PM IST Daily Telegram Digest**: Delivers a 7-section mobile-friendly daily report (Overall Stats, Category Breakdown, Sender-Group Breakdown, Critical/High Emails, Today's Action Items, All Outstanding & Overdue Pending Actions, and an AI Executive Overview). Automatically splits long digests into numbered messages.
- **🛡️ Fault-Tolerant Durable Queue**: Enqueues newly detected message IDs in Google Sheets *before* calling Gemini, uses `LockService` to prevent overlapping runs, bypasses AI calls for Gmail Spam-labelled messages, and gracefully defers tasks on `HTTP 429` rate limits.

---

## 🏗️ System Architecture

```text
Gmail Inbox & Spam (Read-Only OAuth)
        │
        ▼
Scheduled 5-Minute Polling (Apps Script Time-Driven Trigger + LockService)
        │
        ▼
Incremental Gmail History API Sync (Auto-Recovery on HTTP 404 Expired Cursor)
        │
        ▼
Durable Queue & Message ID Deduplication (Google Sheets "Emails" Tab)
        │
        ├──► [Gmail SPAM Label?] ──► Fast-Path Spam Classification (Zero AI Quota Used)
        │
        ▼
Untrusted Email Sanitization (HTML Strip, Attachment Ignore, 12k Char Cap)
        │
        ▼
Gemini Structured JSON Engine + Sender Rules Precedence + Spoofing Guard
        │
        ▼
Google Sheets Database (6 Tabs: Dashboard, Emails, Sender Directory, Sender Rules, Daily Reports, Logs)
        │
        ├──► CRITICAL Priority Email ──► Immediate Telegram Alert (with Retry Queue)
        │
        └──► Daily @ 20:30 IST ────────► 7-Section Daily Telegram Digest (Multi-Part Splitting)
```

---

## 📂 Repository File Structure

| # | File Name | Description |
| :--- | :--- | :--- |
| 1 | `appsscript.json` | Apps Script project manifest (`Asia/Kolkata` timezone, V8 runtime, Advanced Gmail Service v1, minimal read-only scopes). |
| 2 | `Config.gs` | Configuration keys, defaults, 15 categories, 8 sender groups, and `validateConfiguration()`. |
| 3 | `Utils.gs` | Timezone formatting, Base64URL decoding, HTML-to-text stripper, RFC 2822 sender parser, and Telegram HTML escaper. |
| 4 | `GmailService.gs` | Read-only Gmail API wrapper (`Users.getProfile`, `History.list`, `Messages.list`, `Messages.get`, MIME parser). |
| 5 | `SenderIntelligence.gs` | 8-group sender classifier, exact-email-over-domain rule precedence, and display-name spoofing detector. |
| 6 | `ActionService.gs` | Action status normalization (`PENDING` / `COMPLETED` / `DISMISSED`) and `Asia/Kolkata` deadline parser. |
| 7 | `GeminiService.gs` | Gemini REST API client (`UrlFetchApp`), structured JSON schema, prompt-injection defense, and daily overview generator. |
| 8 | `ClassificationService.gs` | End-to-end priority/category validator, Gmail Spam fast-path, and sender rule merger. |
| 9 | `SheetsService.gs` | Auto-initialization, conditional formatting, dropdowns, and batch I/O across all 6 Google Sheets tabs. |
| 10 | `TelegramService.gs` | Telegram Bot API client, auto Chat ID discovery (`getUpdates`), critical alerts, and multi-part message splitter. |
| 11 | `DigestService.gs` | Daily 8:30 PM IST digest compiler (Sections A–G) and overdue pending action highlighter. |
| 12 | `SyncService.gs` | Durable queue synchronization, bounded batch processor, `HTTP 429` deferral, and critical alert retry queue. |
| 13 | `Scheduler.gs` | Idempotent 5-minute time-driven trigger installer (`setupScheduledTriggersIdempotent()`) and status inspector. |
| 14 | `Main.gs` | `onOpen()` custom Google Sheets menu (`InboxPilot AI`), `runScheduledAgentCycle()`, and interactive handlers. |
| 15 | `Tests.gs` | Automated 12-point verification test suite + 8 realistic student email scenarios with `DRY_RUN` protection. |

---

## 🛠️ Complete Setup & Deployment Guide

> **Detailed Step-by-Step Guide:** See [**SETUP.md**](./SETUP.md) for the full beginner-friendly walkthrough, including how to get your Telegram Chat ID and configure Script Properties.

### Quick Start Summary

1. **Create a Google Sheet**:
   - Create a new spreadsheet at [sheets.new](https://sheets.new) named **InboxPilot AI Database** and copy its `SPREADSHEET_ID` from the URL.
2. **Create the Bound Apps Script Project**:
   - In your Google Sheet, click **Extensions → Apps Script**.
   - In **Project Settings (⚙️)**, check **Show "appsscript.json" manifest file in editor**.
   - Copy all 14 `.gs` files and `appsscript.json` into the Apps Script Editor.
3. **Enable Advanced Gmail Service**:
   - In the Apps Script Editor sidebar, click **+** next to **Services**, select **Gmail API (v1)** with identifier `Gmail`, and click **Add**.
4. **Configure Script Properties**:
   - Go to **Project Settings (⚙️) → Script Properties** and add:
     - `GEMINI_API_KEY`: Your free-tier key from [Google AI Studio](https://aistudio.google.com/apikey)
     - `GEMINI_MODEL`: `gemini-4-hydrogen` *(or `gemini-3.1-flash-lite` / `gemini-2.5-flash`)*
     - `TELEGRAM_BOT_TOKEN`: Your bot token from `@BotFather`
     - `TELEGRAM_CHAT_ID`: Your numeric Telegram Chat ID
     - `SPREADSHEET_ID`: Your Google Sheet ID
     - `DIGEST_TIME`: `20:30`
     - `TIMEZONE`: `Asia/Kolkata`
     - `MAX_EMAILS_PER_EXECUTION`: `15`
     - `MAX_BODY_CHARACTERS`: `12000`
     - `DRY_RUN`: `false`
5. **Initialize & Authorize**:
   - Select `Main.gs` → `setupAndInitializeAgent` in the Apps Script toolbar and click **Run**.
   - Approve the read-only OAuth permissions. This automatically creates all 6 sheets and installs the 5-minute background trigger!

---

## 📊 Google Sheets Management Interface

Once initialized, reload your Google Sheet to access the custom **InboxPilot AI** menu in the top bar:

1. **1. Setup / Initialize** — Initializes all 6 tabs and ensures the 5-minute trigger is active.
2. **2. Run Agent Now** — Immediately runs a sync & classification cycle on demand.
3. **3. Send Test Telegram Message** — Sends a test ping to your Telegram chat.
4. **4. Generate Test Daily Digest** — Compiles and delivers the 7-section Daily Digest immediately.
5. **5. Check Configuration** — Validates all Script Properties without exposing secrets.
6. **6. Retry Failed Tasks** — Re-processes any queued/rate-limited emails or unsent alerts.
7. **7. View Execution Status** — Displays trigger status, Gmail History cursor, and last sync timestamps.

---

## 🛡️ Security & Privacy

- **Least-Privilege OAuth**: Requests only `https://www.googleapis.com/auth/gmail.readonly` for Gmail access.
- **Zero Hardcoded Secrets**: All API keys and tokens live strictly inside Apps Script `PropertiesService`.
- **Prompt Injection Defense**: Email subjects, sender names, and bodies are wrapped inside explicit untrusted delimiters and stripped of HTML/scripts before classification.
- **No Attachment Execution**: Version 1 strictly ignores email attachments during MIME traversal.

---

## 📜 License

Released under the Apache-2.0 License.
