<div align="center">

# 🤖 HESABO — AI Accounting Assistant over Chat
### Ask for balances, invoices, payments and quotations by chatting — Telegram today, WhatsApp next

![n8n](https://img.shields.io/badge/n8n-EA4B71?logo=n8n&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Gemini](https://img.shields.io/badge/Google_Gemini-8E75B2?logo=googlegemini&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram_Bot-26A5E4?logo=telegram&logoColor=white)
![Google Sheets](https://img.shields.io/badge/Google_Sheets-34A853?logo=googlesheets&logoColor=white)
![Cloudflare Tunnel](https://img.shields.io/badge/Cloudflare_Tunnel-F38020?logo=cloudflare&logoColor=white)

</div>

---

## 📌 Overview

HESABO is **not a new accounting program** — it is an **AI automation layer** that sits between a chat app and a company's existing accounting data. Customers and staff simply message the bot in Arabic (Egyptian/Gulf dialect) or English:

> *"كام رصيدي؟"* · *"ابعتلي آخر فاتورة"* · *"عايز عرض سعر لقص 4 فتحات"*

The AI understands the intent, checks the sender's **role and permissions**, reads or writes the data, and routes sensitive operations (new invoice, payment, quotation) to a **human approval** step.

## ✨ Features

- 🧠 **AI intent detection** (Gemini) with a **rule-based fallback engine** — keeps working if the AI is unavailable
- 👥 **Roles** — admin, sales, accountant, customer; phone-number linking for customers
- ✅ **Approval workflow** — configurable per operation + amount threshold
- 📒 **Customers, invoices, payments, quotations, leads, hand-offs** stored in Google Sheets (MVP database)
- 🔁 **Follow-ups & overdue reminders**
- 🧪 **Full browser simulator** (`HESABO_Simulator.html`) to test 100+ scenarios before touching real systems
- 🌐 Runs on a local n8n instance exposed via a free **Cloudflare Tunnel**

## 🏗️ Architecture

```mermaid
flowchart LR
  C[Customer / Staff] -->|message| TG[Telegram Bot]
  TG --> N8N[n8n workflow]
  N8N --> A[Code A<br/>Build AI prompt]
  A --> G[Gemini NLU]
  G --> B[Code B<br/>HESABO engine<br/>roles · rules · approvals]
  B <--> GS[(Google Sheets<br/>MVP database)]
  B -->|reply| TG
  B -->|needs approval| M[Manager]
```

## 🗺️ Roadmap

`Simulator ✅` → `Free MVP: Telegram + n8n + Sheets + AI ✅` → validation with 100+ scenarios → production backend + **WhatsApp Business Platform** + accounting/ERP API → OCR, voice & AI sales → **SaaS** with subscription tiers.

## 🚀 Try it

- **Simulator:** open `HESABO_Simulator.html` in any browser — no setup.
- **MVP:** import `HESABO_n8n_workflow.json` into n8n, add your Telegram + Google Sheets credentials, set your Sheet ID, load `HESABO_Database.xlsx` (demo data) into Google Sheets, then run `start_hesabo.ps1`.
- Setup guide: **[HESABO_Phase1_Setup_Guide.pdf](HESABO_Phase1_Setup_Guide.pdf)**

## 🗂️ Files

```
engine/HESABO_engine_core.js    shared core (data access, roles, helpers)
engine/HESABO_engine_codeA.js   n8n Code node A — builds the AI prompt
engine/HESABO_engine_codeB.js   n8n Code node B — the decision engine
HESABO_n8n_workflow.json        importable n8n workflow (25 nodes)
HESABO_Simulator.html           standalone simulator
HESABO_Database.xlsx            demo database (fictional data)
```

---

## 👤 Author

**Mahmoud Shahab** — AI Department Manager · AI Automation & Operations
Building AI-powered systems that turn messy operations into clear, trackable workflows.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-mahmoud--shahab--ai-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/mahmoud-shahab-ai)
[![GitHub](https://img.shields.io/badge/GitHub-ShekoDev-181717?logo=github)](https://github.com/ShekoDev)

© Mahmoud Shahab — All rights reserved.
