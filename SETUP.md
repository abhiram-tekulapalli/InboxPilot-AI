# InboxPilot AI — Complete Step-by-Step Setup Guide (`SETUP.md`)

This guide walks you through deploying **InboxPilot AI** from scratch using your personal Google account, Google Sheets, a free Gemini API key, and a Telegram Bot. No paid servers, cloud billing, or local background processes are required.

---

## Step 1: Create Your Google Spreadsheet Database

1. Open [https://sheets.new](https://sheets.new) in your browser while signed into the Google account whose Gmail inbox you want to monitor.
2. Click the title at the top left and rename the spreadsheet to **`InboxPilot AI Database`**.
3. Look at the URL in your browser's address bar. It will look like this:
   ```text
   https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
   ```
4. Copy the long string of letters and numbers between `/d/` and `/edit`. Save it in a notepad — this is your **`SPREADSHEET_ID`**.

---

## Step 2: Create the Google Apps Script Project & Add the Code Files

1. Inside your **`InboxPilot AI Database`** Google Sheet, click **Extensions → Apps Script** in the top menu bar.
2. A new browser tab will open with the Google Apps Script IDE. Click **Untitled project** at the top left and rename it to **`InboxPilot AI Agent`**.
3. **Reveal `appsscript.json`:**
   - On the far-left vertical sidebar, click the **Gear icon ⚙️ (`Project Settings`)**.
   - Check the box **"Show 'appsscript.json' manifest file in editor"**.
4. **Add the 15 Project Files:**
   - Click the **`< >` (`Editor`)** icon on the left sidebar to return to your files.
   - Click on **`appsscript.json`** in the file list, replace its entire contents with the `appsscript.json` file from this repository, and press `Ctrl+S` (or `Cmd+S`).
   - Rename the default `Code.gs` file to **`Config.gs`** and paste the contents of `Config.gs`.
   - For each of the remaining 13 `.gs` files below, click the **`+`** icon next to **Files** → choose **Script**, type the exact name (without typing `.gs`, as Apps Script adds `.gs` automatically), and paste its code:
     1. `Config` (`Config.gs`)
     2. `Utils` (`Utils.gs`)
     3. `GmailService` (`GmailService.gs`)
     4. `SenderIntelligence` (`SenderIntelligence.gs`)
     5. `ActionService` (`ActionService.gs`)
     6. `GeminiService` (`GeminiService.gs`)
     7. `ClassificationService` (`ClassificationService.gs`)
     8. `SheetsService` (`SheetsService.gs`)
     9. `TelegramService` (`TelegramService.gs`)
     10. `DigestService` (`DigestService.gs`)
     11. `SyncService` (`SyncService.gs`)
     12. `Scheduler` (`Scheduler.gs`)
     13. `Main` (`Main.gs`)
     14. `Tests` (`Tests.gs`)
   - Press **`Ctrl+S`** (`Cmd+S`) to save all files.

---

## Step 3: Enable the Advanced Gmail Service

1. In the Apps Script Editor left sidebar, look for **Services** and click the **`+`** button next to it.
2. Scroll down and select **Gmail API**.
3. Confirm that:
   - **Version** is set to `v1`
   - **Identifier** is set to `Gmail`
4. Click **Add**.

---

## Step 4: Create Your Free-Tier Gemini API Key

1. Open [Google AI Studio (https://aistudio.google.com/apikey)](https://aistudio.google.com/apikey) and sign in with your Google account.
2. Click **Create API key**.
3. Copy the generated API key string (starts with `AIza...`) — this is your **`GEMINI_API_KEY`**.

---

## Step 5: Create Your Telegram Bot & Get Your Bot Token

1. Open the **Telegram** app on your phone or desktop.
2. Search for **`@BotFather`** (verified with a blue checkmark) and open the chat.
3. Send the command:
   ```text
   /newbot
   ```
4. **BotFather** will ask you for a display name. Reply with:
   ```text
   InboxPilot AI
   ```
5. Next, **BotFather** will ask for a unique username ending in `bot`. Reply with something unique, for example:
   ```text
   yourname_inboxpilot_bot
   ```
6. **BotFather** will reply with a confirmation message containing your **HTTP API Token** (looks like `7123456789:AAHxyz123456...`). Copy this token — this is your **`TELEGRAM_BOT_TOKEN`**.
7. **Important:** In BotFather's message, click the link to your new bot (`t.me/yourname_inboxpilot_bot`), click **Start**, and send the message **`Hello`**.
   *(Your bot will not reply yet — sending `"Hello"` simply registers your chat ID with Telegram so you can retrieve it in Step 6).*

---

## Step 6: How to Get Your `TELEGRAM_CHAT_ID`

After you have sent **`Hello`** to your new bot in Step 5, use either Method A or Method B below:

### Method A: Direct Browser URL (Takes 15 Seconds)
1. Open a new browser tab and paste the following URL, replacing `<YOUR_BOT_TOKEN>` with the token you got from BotFather:
   ```text
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
   *(Example: `https://api.telegram.org/bot7123456789:AAHxyz/getUpdates`)*
2. Press **Enter**. You will see a JSON response like this:
   ```json
   {
     "ok": true,
     "result": [
       {
         "update_id": 12345678,
         "message": {
           "message_id": 2,
           "from": { "id": 987654321, "first_name": "Alex" },
           "chat": { "id": 987654321, "first_name": "Alex", "type": "private" },
           "text": "Hello"
         }
       }
     ]
   }
   ```
3. Copy the number inside `"chat": { "id": 987654321 }`. That number (e.g., `987654321`) is your **`TELEGRAM_CHAT_ID`**.
   *(If `"result": []` is empty, go back to Telegram, send another message `Hello` to your bot, and refresh the browser tab).*

### Method B: Automatic Script Lookup
Once you add `TELEGRAM_BOT_TOKEN` in Step 7 below, you can run `retrieveTelegramChatId()` from `TelegramService.gs` (or click **InboxPilot AI → Auto-Detect Telegram Chat ID** in the Google Sheet menu) and the script will automatically fetch and save `TELEGRAM_CHAT_ID` for you.

---

## Step 7: Add All Keys to Apps Script `Script Properties`

You never hardcode API keys inside the `.gs` code files. Instead, store them in Apps Script's encrypted **Script Properties** vault:

1. In your **Google Apps Script** browser tab, click the **Gear icon ⚙️ (`Project Settings`)** on the far-left sidebar.
2. Scroll down to the bottom section titled **Script Properties**.
3. Click **Add script property**.
4. Add each of the following 10 properties (Property name on the left, Value on the right):

| Property (Left Box) | Value (Right Box) | Notes |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | `AIzaSy...` | Your Gemini API key from Step 4 |
| `GEMINI_MODEL` | `gemini-4-hydrogen` | Or `gemini-3.1-flash-lite` / `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | `7123456789:AAH...` | Your BotFather token from Step 5 |
| `TELEGRAM_CHAT_ID` | `987654321` | Your numeric Telegram Chat ID from Step 6 |
| `SPREADSHEET_ID` | `1BxiMVs0XRA...` | Your Google Sheet ID from Step 1 |
| `DIGEST_TIME` | `20:30` | Daily report time in 24h `HH:mm` format (8:30 PM IST) |
| `TIMEZONE` | `Asia/Kolkata` | Default timezone for deadlines & digests |
| `MAX_EMAILS_PER_EXECUTION` | `15` | Max emails classified per 5-minute cycle |
| `MAX_BODY_CHARACTERS` | `12000` | Max email body characters sent to Gemini |
| `DRY_RUN` | `false` | Keep `false` for live Telegram alerts |

5. Click the blue **Save script properties** button.

---

## Step 8: Authorize OAuth2 & Initialize Your Database + 24/7 Trigger

*(Note: You do **not** need to click the blue "Deploy" button at the top right of Apps Script—that is only for web apps. InboxPilot AI runs via background time-driven triggers).*

1. Click the **`< >` (`Editor`)** icon on the left sidebar of Apps Script.
2. Click on **`Main.gs`** in the file list.
3. In the top toolbar (to the left of the function dropdown), select **`setupAndInitializeAgent`** from the dropdown list and click **Run**.
4. A popup titled **Authorization required** will appear:
   - Click **Review permissions**.
   - Choose your Google account.
   - If Google shows a *"Google hasn't verified this app"* screen, click **Advanced** (bottom left) → click **Go to InboxPilot AI Agent (unsafe)** *(this appears because you are running your own personal script)*.
   - Click **Allow**.
5. Wait 5–10 seconds for the Execution Log at the bottom to say **Execution completed**.
   - This single run automatically creates and formats all **6 sheets** (`Dashboard`, `Emails`, `Sender Directory`, `Sender Rules`, `Daily Reports`, `Logs`) in your Google Spreadsheet AND installs the **5-minute background trigger**!

---

## Step 9: Verify & Test Everything from Your Google Sheet

1. Switch back to your **`InboxPilot AI Database`** Google Sheet tab and **refresh the page**.
2. Wait 3–5 seconds for the custom menu **`InboxPilot AI`** to appear at the top (next to *Help*).
3. **Test 1 — Check Configuration:**
   - Click **InboxPilot AI → 5. Check Configuration**. Confirm it reports **`✅ Configuration is VALID`**.
4. **Test 2 — Send Test Telegram Message:**
   - Click **InboxPilot AI → 3. Send Test Telegram Message**. Your phone will immediately receive a test confirmation from your bot!
5. **Test 3 — Run Live Gmail Scan Now:**
   - Click **InboxPilot AI → 2. Run Agent Now**. Wait 20–40 seconds and watch the **`Emails`**, **`Sender Directory`**, and **`Dashboard`** tabs populate with your real classified emails.
6. **Test 4 — Test the Daily Digest:**
   - Click **InboxPilot AI → 4. Generate Test Daily Digest** to receive a full 7-section daily report on Telegram right now.
7. **Test 5 — Confirm 24/7 Trigger Status:**
   - Click **InboxPilot AI → 7. View Execution Status** and verify **`5-Min Trigger Active: YES (1 trigger)`**.

---

## 🔄 Day-to-Day Usage & Maintenance

- **Zero Laptop Requirement:** Once initialized, Google's servers run `runScheduledAgentCycle` every 5 minutes 24/7.
- **Completing Pending Actions:** When an email requires action (`Action Required = YES`), it starts with `Action Status = PENDING` in Column P of the **`Emails`** sheet and appears in your daily digest every evening. Once you finish the task, simply open the **`Emails`** sheet and change the dropdown in Column P to **`COMPLETED`** or **`DISMISSED`**.
- **Adding Custom Sender Rules:** Open the **`Sender Rules`** tab to force specific email addresses (`EMAIL`) or domains (`DOMAIN`) into a specific Sender Group, Priority, or Category. Set the `Active` column to `TRUE`.
- **Viewing Past Days on the Dashboard:** Change cell **`B3`** on the **`Dashboard`** tab to any `YYYY-MM-DD` date to inspect that day's metrics.
