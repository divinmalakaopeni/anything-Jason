# GitEditor — Collaborative Block Editor backed by Git

A full-stack web application where every document is a **JSON file stored in a Git repository**. Multiple people can edit different sections simultaneously. Every save is a Git commit. Full history, branching, and diff viewing built in.

---

## Quick start

### 1. Prerequisites

```bash
node --version   # needs v18+
git --version    # needs git installed
```

### 2. Install dependencies

```bash
# In the project root
cd server && npm install
cd ../client && npm install
```

### 3. Configure the server

```bash
cd server
cp .env.example .env
# Edit .env if needed (defaults work out of the box)
```

### 4. Run in development

Open two terminals:

```bash
# Terminal 1 — server
cd server
npm run dev

# Terminal 2 — client
cd client
npm run dev
```

Then open **http://localhost:5173** in your browser.

---

## How to use

### First time
1. Open the app → you'll see the repository list (empty at first)
2. Click **⚙ Settings** and enter your name and email — these appear in every Git commit
3. Click **+ New repository** → give it a name → the editor opens

### Import your pdf2json output
1. On the home page, click **⬆ Import** on any repo card
2. Drop your `myfile.json` (the output from pdf2json.py) into the dropzone
3. Choose **Replace** or **Append**
4. Click Import — the file is committed to Git automatically

### Editing
- Click any block to edit it
- Press **Enter** in a paragraph to add a new block below
- Use the toolbar (appears on hover) to change block type, move up/down, or delete
- **Ctrl+S** (or **⌘S**) saves and commits immediately
- Auto-save commits every 30 seconds if there are changes

### Collaboration
- Multiple people open the same repo URL
- Each person's name appears in the **Online now** sidebar
- When someone starts editing a block, it gets **locked** — others see a red indicator with the editor's name
- Saves by other users appear as toast notifications

### Git history
- Click **🕐 Git history** in the sidebar
- Click any commit to view the document at that point in time (read-only)
- Click **diff** to see exactly what changed
- Click the commit again to return to the current version

### Branches
- Click the branch name in the sidebar to switch or create branches
- Each branch has its own document state

### Export
- **PDF**: click **📄 PDF** in the sidebar — downloads directly
- **Google Docs**: requires OAuth setup (see below)

---

## Project structure

```
giteditor/
├── server/
│   ├── index.js              ← Express + Socket.io server
│   ├── routes/
│   │   ├── repo.js           ← Git repo CRUD, history, branches, diff
│   │   ├── document.js       ← Read/save document.json
│   │   ├── export.js         ← PDF (Puppeteer) and Google Docs export
│   │   └── import.js         ← Import pdf2json output files
│   └── services/
│       ├── git.js            ← All Git operations (simple-git)
│       ├── socket.js         ← Real-time collaboration (Socket.io)
│       └── export.js         ← PDF and Google Docs generation
│
├── client/
│   └── src/
│       ├── pages/
│       │   ├── HomePage.jsx   ← Repository list, create/clone/import
│       │   ├── EditorPage.jsx ← Main editor with sidebar and history
│       │   └── SetupPage.jsx  ← User settings
│       ├── components/
│       │   ├── BlockEditor.jsx    ← Core block-based editor
│       │   ├── HistoryPanel.jsx   ← Git history + diff viewer
│       │   ├── PresenceBar.jsx    ← Online users
│       │   ├── CreateRepoModal.jsx
│       │   ├── ImportModal.jsx
│       │   └── BranchPanel.jsx
│       ├── hooks/
│       │   ├── useSocket.js   ← Socket.io connection + collaboration events
│       │   └── useAutoSave.js ← Periodic save + dirty state
│       ├── stores/
│       │   └── useStore.js    ← Zustand global state
│       └── utils/
│           └── api.js         ← Axios API client
│
└── repos/                     ← Git repositories stored here (auto-created)
```

---

## JSON document format

Every document is stored as `document.json` inside its Git repository:

```json
{
  "document_metadata": {
    "title": "My Document",
    "description": "...",
    "created_at": "2026-05-27T...",
    "updated_at": "2026-05-27T..."
  },
  "content": [
    {
      "id": "b_abc123",
      "type": "heading",
      "level": 1,
      "text": "Introduction"
    },
    {
      "id": "b_def456",
      "type": "paragraph",
      "text": "This is a paragraph.",
      "bold": false,
      "italic": false
    },
    {
      "id": "b_ghi789",
      "type": "table",
      "headers": ["Name", "Value"],
      "rows": [["Item 1", "100"], ["Item 2", "200"]]
    },
    {
      "id": "b_jkl012",
      "type": "image",
      "subtype": "vector_region",
      "caption": "Figure 1: System diagram",
      "extracted_image_path": "./extracted_images/vec_p0001_001.png"
    }
  ]
}
```

Each commit in the repo tracks exactly one line change in this file, making `git blame` and `git log -p` highly readable.

---

## Google Docs export setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → enable **Google Docs API** and **Google Drive API**
3. Create OAuth 2.0 credentials (Web application)
4. Add your credentials to `server/.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_secret
   ```
5. In the app, click **📊 Google Docs** — you'll be prompted to sign in with Google

---

## Production deployment

```bash
# Build the client
cd client && npm run build

# Run the server (serves built client automatically)
cd ../server
NODE_ENV=production npm start
```

The server will serve the built client at the same port (3001 by default).
