/**
 * JOES AI -INTELLIGENT AI ASSISTANT AND CODING WORKSPACE
 * Owner: AKRAM JOES TECHNOLOGIES
 * Founder: KAIGWA AKRAM (The Inspired Engineer)
 * Logic: Multimodal + Scraper + Memory Capsule + Clinical Safety + Artifacts
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "kaigwaakram123@gmail.com";

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://joesai.work.gd',
    'https://joesai.work.gd'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS policy blocked origin: ${origin}`));
    }
}));

// Logging middleware for debugging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// 1. Serve static files cleanly from your root directory
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

const KEYS = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    google: process.env.GOOGLE_SEARCH_API_KEY,
    cx: process.env.GOOGLE_SEARCH_ENGINE_ID
};

const ENGINE_CONFIG = {
    chat: { primary: 'llama-3.3-70b-versatile', deliverer: 'gemini-2.0-flash-lite' },
    code: { primary: 'llama-3.3-70b-specdec', deliverer: 'gemini-2.0-flash' },
    study: { primary: 'llama-3.3-70b-versatile', deliverer: 'gemini-2.5-pro-latest' }
};

const creatorIdentity = "You are Joes AI, a highly intelligent and custom-designed AI assistant. " +
    "You were developed and are owned entirely by AKRAM JOES TECHNOLOGIES founded by KAIGWA AKRAM the INSPIRED ENGINEER. " +
    "If any user asks you who developed you, who owns you, or who built you, you must answer proudly that you were developed and are owned by AKRAM JOES TECHNOLOGIES founded by KAIGWA AKRAM the INSPIRED ENGINEER. " +
    "Never state that you are developed by Google, Meta, OpenAI, or anyone else.";

const IDENTITY_RULES = creatorIdentity + `
IMPORTANT RULES FOR DATA PRESENTATION:
1. NO EXCUSES: Never tell the user 'I cannot provide clickable links' or 'I cannot render images.' You have full capability to do so using Markdown.
2. TABLES: When presenting structured comparative data, lists, or metrics, you MUST format them as clean Markdown tables (using standard pipe syntax: | Column | Column |).
3. MERMAID DIAGRAMS: For workflows, simple flowcharts, or system process loops, write visual layout schemas using Mermaid.js syntax inside a code block marked with 'mermaid'.
4. REAL IMAGES & PHOTOS:
   - You MUST cross-reference the user query with the 'VERIFIED REAL-TIME GOOGLE SEARCH RESULTS' block provided below.
   - To display a real image, use standard Markdown: ![Image Description](Direct Image URL). Place these directly in your explanation where relevant.
   - FALLBACK RULES (For custom illustrations): If no functional image URLs are present in the search results, use: ![Alt Text](https://image.pollinations.ai/prompt/[Descriptive-Detail-Prompt-Encoded]?width=600&height=400&nologo=true) replacing spaces with %20.
5. CLICKABLE CITATIONS: Every factual claim must be followed by a clickable link. Format them strictly as: [Source Name](URL). These links should be placed naturally in the text or as a list of 'References' at the end.
6. EMOJIS: Naturally incorporate high-quality, expressive emojis where appropriate. Keep their usage professional and tasteful.`;

function getModePrompt(mode) {
    switch (mode) {
        case 'code':
            return creatorIdentity + " You are currently operating in CODE MODE. Act as a senior programmer. Provide highly-optimized, production-ready, clean, and properly structured programming source code. Add descriptive inline comments. Minimize unrelated conversational chatter. Use emojis extremely rarely here.";
        case 'study':
            return creatorIdentity + " You are currently operating in STUDY MODE. Act as an empathetic academic tutor. Break down complex subjects using structured step-by-step concepts, real-life analogies, and bullet points. Always close by presenting 2 brief quiz questions.";
        case 'chat':
        default:
            return creatorIdentity + " You are currently operating in CHAT MODE. Be friendly, energetic, and engaging. Keep responses conversational, and use expressive emojis naturally and selectively where appropriate.";
    }
}

function getKoofrBaseUrl() {
    const url = process.env.CLOUDSYNC_URL;
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
}

async function scrapeUrl(url) {
    try {
        const response = await fetch(`https://r.jina.ai/${url}`, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        return data.data.content ? `\nRAW PAGE DATA FROM ${url}:\n${data.data.content.slice(0, 15000)}` : "";
    } catch (e) { return ""; }
}

async function generateMemoryCapsule(history) {
    if (!history || history.length < 5) return "First meeting with user.";
    try {
        const brain = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${KEYS.groq}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{
                    role: 'system',
                    content: 'Extract active project details, technology stacks used, and user goals from this history. Output as a short "Project Memory Capsule".'
                }, ...history.slice(-10)]
            })
        });
        const res = await brain.json();
        return res.choices[0].message.content;
    } catch (e) { return "Conversation in progress."; }
}

function getSmartImage(prompt) {
    const encoded = encodeURIComponent(prompt);
    return `https://image.pollinations.ai/prompt/${encoded}-style-recraft-v3-cinematic-8k?width=1024&height=768&nologo=true&seed=${Math.floor(Math.random() * 9999)}`;
}

async function fetchGoogleGrounding(query) {
    if (!KEYS.google) return { text: "", imgs: [] };
    try {
        const res = await fetch(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${KEYS.google}&cx=${KEYS.cx}`);
        const data = await res.json();
        const text = (data.items || []).slice(0, 5).map(it => `${it.title}: ${it.snippet} [Source: ${it.link}]`).join('\n\n');
        const imgs = (data.items || []).map(it => it.pagemap?.cse_image?.[0]?.src).filter(Boolean);
        return { text, imgs };
    } catch (e) { return { text: "", imgs: [] }; }
}

async function specialistPass(msg, mode, context) {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${KEYS.openrouter}`
            },
            body: JSON.stringify({
                model: "openrouter/free",
                messages: [{ role: "user", content: `Review strategy for: ${msg}. Mode context: ${mode}. Additional Data: ${context}` }]
            })
        });
        const data = await response.json();
        if (data.error) {
            console.error(`API Error: ${data.error.message}`);
            return "Workspace error. Please try again.";
        }
        return data.choices[0].message.content;
    } catch (err) {
        console.error("Network connection error:", err);
        return "";
    }
}

app.post('/api/chat', async (req, res) => {
    const { messages, mode, fileData, mimeType, fileName } = req.body;
    const currentMode = mode || 'chat';
    const cfg = ENGINE_CONFIG[currentMode];

    try {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const message = messages?.[messages.length - 1]?.content || "";
        const urlsFound = message?.match(urlRegex) || [];
        let scrapedText = "";
        if (urlsFound.length > 0) scrapedText = await scrapeUrl(urlsFound[0]);
        const grounding = await fetchGoogleGrounding(message || fileName);
        const capsule = await generateMemoryCapsule(messages);

        const groqLogic = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${KEYS.groq}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: cfg.primary,
                messages: [
                    { role: 'system', content: `Brain Strategy Pass. History Capsule: ${capsule}. Data Found: ${grounding.text} ${scrapedText}` },
                    { role: 'user', content: message }
                ]
            })
        });
        const brain = await groqLogic.json();
        const primaryLogic = brain.choices?.[0]?.message?.content || "";
        const supplement = await specialistPass(message, currentMode, grounding.text);

        const systemPrompt = IDENTITY_RULES + `
BRAND: Joes AI by AKRAM JOES TECHNOLOGIES. FOUNDER: KAIGWA AKRAM.
PROJECT CAPSULE: ${capsule}
BRAIN STRATEGY: ${primaryLogic}
SPECIALIST NOTE: ${supplement}
GROUNDED FACTS: ${grounding.text} ${scrapedText}
OPERATIONAL MODE: ${currentMode}
MULTIMODAL: You can hear, see, and read the binary "${fileName}" attached.
IMAGES: Use ![Vis](${getSmartImage(message)}) or verified search links: ${grounding.imgs.join(', ')}`;

        const historyContext = (messages || []).slice(-20).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content || "Analyzing session..." }]
        }));
        const finalInput = [{ text: message || "Generate based on strategy." }];
        if (fileData) finalInput.push({ inline_data: { mime_type: mimeType, data: fileData } });
        historyContext.push({ role: 'user', parts: finalInput });

        const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.deliverer}:generateContent?key=${KEYS.gemini}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: historyContext,
                generationConfig: { temperature: 0.5 }
            })
        });

        const gemData = await gemRes.json();
        const text = gemData.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't process that.";
        res.json({ text });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to process request" });
    }
});

app.post('/api/chat/stream', async (req, res) => {
    const { message, chatHistory, mode, fileData, mimeType, fileName } = req.body;
    const currentMode = mode || 'chat';
    const cfg = ENGINE_CONFIG[currentMode];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urlsFound = message?.match(urlRegex) || [];
        let scrapedText = "";
        if (urlsFound.length > 0) scrapedText = await scrapeUrl(urlsFound[0]);
        const grounding = await fetchGoogleGrounding(message || fileName);
        const capsule = await generateMemoryCapsule(chatHistory);

        const groqLogic = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${KEYS.groq}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: cfg.primary,
                messages: [
                    { role: 'system', content: `Brain Strategy Pass. History Capsule: ${capsule}. Data Found: ${grounding.text} ${scrapedText}` },
                    { role: 'user', content: message }
                ]
            })
        });
        const brain = await groqLogic.json();
        const primaryLogic = brain.choices?.[0]?.message?.content || "";
        const supplement = await specialistPass(message, currentMode, grounding.text);

        const systemPrompt = IDENTITY_RULES + `
BRAND: Joes AI by AKRAM JOES TECHNOLOGIES. FOUNDER: KAIGWA AKRAM.
PROJECT CAPSULE: ${capsule}
BRAIN STRATEGY: ${primaryLogic}
SPECIALIST NOTE: ${supplement}
GROUNDED FACTS: ${grounding.text} ${scrapedText}
OPERATIONAL MODE: ${currentMode}
MULTIMODAL: You can hear, see, and read the binary "${fileName}" attached.
IMAGES: Use ![Vis](${getSmartImage(message)}) or verified search links: ${grounding.imgs.join(', ')}`;

        const historyContext = (chatHistory || []).slice(-20).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content || "Analyzing session..." }]
        }));
        const finalInput = [{ text: message || "Generate based on strategy." }];
        if (fileData) finalInput.push({ inline_data: { mime_type: mimeType, data: fileData } });
        historyContext.push({ role: 'user', parts: finalInput });

        const gemUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.deliverer}:streamGenerateContent?alt=sse&key=${KEYS.gemini}`;
        const gRes = await fetch(gemUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: historyContext,
                generationConfig: { temperature: 0.5 }
            })
        });

        gRes.body.on('data', chunk => {
            const dataStr = chunk.toString();
            const lines = dataStr.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('data: ')) res.write(`${line}\n\n`);
            }
        });

        gRes.body.on('error', err => {
            console.error("Stream reader dropped error:", err);
            res.write(`data: ${JSON.stringify({ error: "Stream packet drop recovery active." })}\n\n`);
            res.end();
        });

        gRes.body.on('end', () => res.end());

    } catch (e) {
        console.error(e);
        res.write(`data: ${JSON.stringify({ error: "Collaboration sync re-mapping. One moment..." })}\n\n`);
        res.end();
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
        adminEmail: ADMIN_EMAIL
    });
});

app.post('/api/check-admin', async (req, res) => {
    const { email, uid } = req.body;
    const isOwner = email === ADMIN_EMAIL;
    res.json({
        isAdmin: isOwner,
        role: isOwner ? "The Inspired Engineer" : "Verified Owner",
        permissions: isOwner ? ["*"] : ["chat", "code", "study"]
    });
});

app.get('/api/search', async (req, res) => {
    const data = await fetchGoogleGrounding(req.query.q);
    res.json(data);
});

console.log('API routes registered: /api/chat, /api/chat/stream, /api/config, /api/check-admin, /api/search, /api/chats');

app.get('/api/chats', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;
    const userId = req.headers['x-user-id'] || 'default';
    const isAdminRequest = req.headers['x-is-admin'] === 'true';

    if (!baseUrl || !user || !password) {
        return res.status(400).json({ error: "Cloud Config Missing: Set CLOUDSYNC variables on Render." });
    }

    try {
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
        const response = await fetch(baseUrl, {
            method: 'PROPFIND',
            headers: { 'Authorization': authHeader, 'Depth': '1' }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: "Failed to list files from Koofr." });
        }

        const xml = await response.text();
        const hrefRegex = /<(?:[^:>]+:)?href>([^<]+)<\/(?:[^:>]+:)?href>/gi;
        let match;
        const files = [];
        const userPrefix = isAdminRequest ? 'JoesAI_Chat_' : `JoesAI_Chat_${userId.trim()}__`;

        while ((match = hrefRegex.exec(xml)) !== null) {
            const decodedPath = decodeURIComponent(match[1]);
            let filename = decodedPath.split('/').pop();
            if (filename) filename = filename.trim().split('?')[0];

            if (filename && filename.startsWith(userPrefix) && filename.endsWith('.json')) {
                const rawParts = filename.replace(userPrefix, '').replace('.json', '');
                const parts = rawParts.split('__');
                const id = parts[0];
                const title = parts[1] ? parts[1].replace(/-/g, ' ') : 'Saved Chat';
                files.push({ id, filename, title });
            }
        }

        files.sort((a, b) => b.id.localeCompare(a.id));
        res.json(files);
    } catch (err) {
        console.error("Koofr listing failure:", err);
        res.status(500).json({ error: "Failed to load chats from Koofr." });
    }
});

app.get('/api/chats/:filename', async (req, res) => {
    const { filename } = req.params;
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;

    if (!baseUrl || !user || !password) {
        return res.status(400).json({ error: "Cloud Sync Config Missing on Render." });
    }

    try {
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
        const response = await fetch(`${baseUrl}${filename}`, {
            method: 'GET',
            headers: { 'Authorization': authHeader }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: "Failed to read file from Koofr." });
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error("Koofr read failure:", err);
        res.status(500).json({ error: "Failed to load chat file." });
    }
});

app.post('/api/chats', async (req, res) => {
    const { sessionId, title, history } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;
    const userId = req.headers['x-user-id'] || 'default';

    if (!baseUrl || !user || !password) {
        return res.status(400).json({ error: "Cloud Sync Config Missing on Render." });
    }

    try {
        const safeTitle = (title || 'Untitled').trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const filename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

        const response = await fetch(`${baseUrl}${filename}`, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId, title, history })
        });

        if (response.ok || response.status === 201 || response.status === 204) {
            res.json({ success: true, filename });
        } else {
            res.status(response.status).json({ error: "Failed to save to Koofr." });
        }
    } catch (err) {
        console.error("Koofr upload failure:", err);
        res.status(500).json({ error: "Failed to save file to Koofr." });
    }
});

app.delete('/api/chats/:filename', async (req, res) => {
    const { filename } = req.params;
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;

    if (!baseUrl || !user || !password) {
        return res.status(400).json({ error: "Cloud Sync Config Missing on Render." });
    }

    try {
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
        const response = await fetch(`${baseUrl}${filename}`, {
            method: 'DELETE',
            headers: { 'Authorization': authHeader }
        });

        if (response.ok || response.status === 204) {
            res.json({ success: true });
        } else {
            res.status(response.status).json({ error: "Failed to delete file on Koofr." });
        }
    } catch (err) {
        console.error("Koofr deletion failure:", err);
        res.status(500).json({ error: "Failed to delete file on Koofr." });
    }
});

// 2. Clear fallback route for root URL if index.html is missing in the directory
app.get('/', (req, res) => {
    res.send('JOES AI Core API Status: Active and Running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ===========================================
    JOES AI -INTELLIGENT AI ASSISTANT AND CODING WORKSPACE ONLINE
    STATUS   : ALL ENGINES ACTIVE
    ORCHESTRATOR : AKRAM JOES TECHNOLOGIES
    ENGINES : SCRAPER + MEMORY + CLINICAL SAFETY + INTELLIGENCE
    ===========================================
    `);
});
