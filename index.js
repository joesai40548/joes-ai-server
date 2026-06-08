const express = require('express');
const cors = require('cors');
// Use native fetch if available on newer Node.js versions, preventing CommonJS require crashes
const fetch = globalThis.fetch || require('node-fetch');
const path = require('path');
const { google } = require('googleapis');
const PdfPrinter = require('pdfmake');
require('dotenv').config();

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

// --- SERVER-SIDE PDFMAKE FONT CONFIGURATION ---
// Server-side pdfmake requires localized .ttf font files.
// Please ensure you have a "fonts" folder at your project root containing these files,
// or install the 'roboto-fontface' library and map paths accordingly.
const fonts = {
    Roboto: {
        normal: path.join(__dirname, 'fonts/Roboto-Regular.ttf'),
        bold: path.join(__dirname, 'fonts/Roboto-Medium.ttf'),
        italics: path.join(__dirname, 'fonts/Roboto-Italic.ttf'),
        bolditalics: path.join(__dirname, 'fonts/Roboto-MediumItalic.ttf')
    }
};

// --- GMAIL OAUTH2 CLIENT INITIALIZATION ---
const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
);

if (process.env.GMAIL_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });
} else {
    console.warn('[Gmail API] WARNING: GMAIL_REFRESH_TOKEN is not defined in environment variables.');
}

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// --- CONFIG & KEYS ---
const KEYS = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    tavily: process.env.TAVILY_API_KEY 
};

const MODELS = {
    chat: { 
        groq: 'llama-3.3-70b-versatile', 
    },
    code: { 
        groq: 'llama-3.3-70b-specdec', 
        gemini: 'gemini-2.5-flash',
        openrouter: 'openrouter/free'
    },
    study: { 
        groq: 'llama-3.3-70b-versatile', 
        gemini: 'gemini-2.5-pro', 
        openrouter: 'openrouter/free'
    }
};

const TAVILY_KEYS_POOL = process.env.TAVILY_API_KEY 
    ? process.env.TAVILY_API_KEY.split(',').map(key => key.trim()).filter(Boolean)
    : [];

// --- HELPER FUNCTIONS ---

/**
 * Strips path traversal sequences to secure cloud storage routes.
 */
function getSafeFilename(filename) {
    if (!filename) return null;
    const base = path.basename(filename);
    if (!base.endsWith('.json')) {
        return null;
    }
    return base;
}

/**
 * Custom Adaptive System Prompt Constructor
 */
function getSystemPrompt(mode) {
    const creatorIdentity = 
        "You are Joes AI, a highly intelligent and custom-designed AI assistant. " +
        "You were developed and are owned entirely by AKRAM JOES TECHNOLOGIES. " +
        "If any user asks you who developed you, who owns you, or who built you, you must answer proudly that you were developed and are owned by AKRAM JOES TECHNOLOGIES. " +
        "Never state that you are developed by Google, Meta, OpenAI, or anyone else. " +
        "CRITICAL OUTPUT REQUIREMENTS:\n" +
        "1. TABLES: MUST format as clean Markdown (| Column | Column |)\n" +
        "2. DIAGRAMS & VISUALS: Generate Mermaid or real images ![Alt text](image_url)\n" +
        "3. STRUCTURED OUTPUT: Clear headings, bullet points. No filler text.\n" +
        "4. CITATIONS: Include inline images or references. Use reliable sources.";

    switch(mode) {
        case 'code':
            return `${creatorIdentity} You are CODE MODE - senior software architect. Provide production-grade code. Use sparse technical emojis (💻, ⚙️).`;
        case 'study':
            return `${creatorIdentity} You are STUDY MODE - academic tutor. Structured step-by-step. Include diagrams and 10 quiz questions.`;
        case 'chat':
        default:
            return `${creatorIdentity} You are CHAT MODE - friendly companion. Conversational with relevant emojis.`;
    }
}

const getKoofrBaseUrl = () => {
    const url = process.env.CLOUDSYNC_URL;
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
};

// --- API ROUTES ---

// Root Endpoint
app.get('/', (req, res) => {
    res.json({
        status: "active",
        service: "Joes AI Backend Server",
        developer: "AKRAM JOES TECHNOLOGIES",
        frontend_url: "http://joesai.work.gd"
    });
});

// Failover search engine utilizing the keys pool
async function fetchTavilySearch(query, searchType = 'web', count = 5) {
    if (TAVILY_KEYS_POOL.length === 0) {
        console.warn('[Search Engine] No Tavily API keys detected in configuration.');
        return { query, searchType, count: 0, items: [] };
    }

    for (let i = 0; i < TAVILY_KEYS_POOL.length; i++) {
        const activeKey = TAVILY_KEYS_POOL[i];
        try {
            console.log(`[Search Engine] Trying Tavily API Key index [${i}] (Total Pool: ${TAVILY_KEYS_POOL.length})`);
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: activeKey,
                    query: query,
                    search_depth: "basic",
                    max_results: Math.min(Math.max(count, 1), 10)
                })
            });

            const data = await response.json();

            if (!response.ok || data.detail?.error) {
                console.warn(`[Search Engine] Key index [${i}] exhausted or rejected. Details:`, data.detail?.error || data);
                continue;
            }

            console.log(`[Search Engine] Search successful using Tavily Key index [${i}].`);
            return {
                query,
                searchType,
                count: data.results?.length || 0,
                items: data.results?.map(item => ({
                    title: item.title,
                    link: item.url,
                    snippet: item.content,
                    displayLink: new URL(item.url).hostname
                })) || []
            };

        } catch (err) {
            console.error(`[Search Engine] Network exception on Tavily Key index [${i}]:`, err.message);
        }
    }

    console.error('[Search Engine] CRITICAL: All provided Tavily API keys in pool have failed or exhausted limits.');
    return { query, searchType, count: 0, items: [] };
}

/**
 * DISCUSSION CHAIN LOGIC ENGINE
 */
async function executeDiscussionChain(message, mode, searchResults, attachments = []) {
    const systemPrompt = getSystemPrompt(mode);
    const modeConfig = MODELS[mode] || MODELS.chat;
    const contextString = JSON.stringify(searchResults, null, 2);

    let groqResponse = "";
    let geminiResponse = "";
    const hasAttachments = attachments && attachments.length > 0;

    if (hasAttachments) {
        console.log(`[Discussion Chain] Attachments detected. Skipping Groq, proceeding to Gemini for file analysis...`);
    } else {
        // STAGE 1: GROQ PRIMARY ANALYSIS
        try {
            console.log(`[Discussion Chain] Stage 1: Groq thinking via ${modeConfig.groq}...`);
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${KEYS.groq}`
                },
                body: JSON.stringify({
                    model: modeConfig.groq,
                    messages: [
                        { role: 'system', content: `${systemPrompt}\n\nWeb Search Reference Content:\n${contextString}` },
                        { role: 'user', content: `Provide initial evaluation and complete response breakdown for: ${message}` }
                    ]
                })
            });

            const data = await response.json();
            groqResponse = data.choices?.[0]?.message?.content || "Groq primary phase was unable to gather raw logic.";
            console.log("[Discussion Chain] Stage 1 Complete.");
        } catch (err) {
            console.error("Discussion Stage 1 (Groq) Error:", err);
            groqResponse = "Primary logic engine timeout. Proceeding with raw data benchmarks.";
        }
    }

    // STAGE 2: GEMINI ANALYSIS & DISCUSSION PASS
    try {
        console.log(`[Discussion Chain] Stage 2: Gemini direct peer discussion via ${modeConfig.gemini}...`);
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modeConfig.gemini}:generateContent?key=${KEYS.gemini}`;
        
        const parts = [{ 
            text: `${systemPrompt}\n\n` +
                  `You are the second engine in a multi-model discussion. Here is the context:\n` +
                  `User Request: ${message}\n` +
                  `Tavily Search Results: ${contextString}\n\n`
        }];

        if (hasAttachments) {
            parts.push(`\n\n[ATTACHMENTS DETECTED - ANALYZE THESE FILES]`);
        }

        const geminiContents = [{
            role: 'user',
            parts: [{ 
                text: parts[0].text
            }]
        }];

        attachments.forEach(att => {
            if (att.fileData && att.mimeType) {
                geminiContents[0].parts.push({
                    inline_data: {
                        mime_type: att.mimeType,
                        data: att.fileData
                    }
                });
            }
        });

        if (hasAttachments) {
            geminiContents[0].parts.push({
                text: `\n\nPlease analyze the attached files and incorporate your findings into your response.`
            });
        } else {
            geminiContents[0].parts.push({
                text: `\n\nThe primary model (Groq) suggested this solution:\n${groqResponse}\n\nDiscuss this response. Enhance it, build on top of it, and apply your advanced features to format tables, integrate visual markdown graphs, or add rich descriptors.`
            });
        }

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: geminiContents })
        });

        const data = await response.json();
        geminiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini peer pass did not augment data structures.";
        console.log("[Discussion Chain] Stage 2 Complete.");
    } catch (err) {
        console.error("Discussion Stage 2 (Gemini) Error:", err);
        geminiResponse = `Peer analysis exception occurred. Default fallback on base frame: ${hasAttachments ? "No Groq analysis (attachments present)" : groqResponse}`;
    }

    // STAGE 3: OPENROUTER DELIVERER PIECE
    try {
        const autoFreeRouterModel = modeConfig.openrouter || 'openrouter/free'; 
        console.log(`[Discussion Chain] Stage 3: OpenRouter final delivery via dynamic broker (${autoFreeRouterModel})...`);
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${KEYS.openrouter}`,
                "HTTP-Referer": "https://joes-ai-server.onrender.com",
                "X-Title": "Joes AI Workspace"
            },
            body: JSON.stringify({
                model: autoFreeRouterModel,
                messages: [
                    { 
                        role: 'system', 
                        content: `${systemPrompt}\n\nYou are the Final Deliverer model in the discussion chain. Your task is to look over the conversation transcripts between the user, Groq, and Gemini, filter out internal chat jargon, balance conflicting views, ensure proper markdown components/images are inserted, and deliver the absolute best final response directly to the user.` 
                    },
                    { 
                        role: 'user', 
                        content: `User query: ${message}\n\n` +
                                 `--- DISCUSSION ENGINE TRANSCRIPT ---\n` +
                                 `${hasAttachments ? 'Groq: [SKIPPED - Attachments detected]' : `Groq analysis: ${groqResponse}`}\n\n` +
                                 `Gemini augmentation: ${geminiResponse}\n` +
                                 `--- END TRANSCRIPT ---\n\n` +
                                 `Deliver the polished final response now.`
                    }
                ]
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error("[OpenRouter API Error Details]:", data);
            throw new Error(data?.error?.message || `HTTP error! status: ${response.status}`);
        }

        // CRASH-FIX SAFETY BARRIER: Check if choices exists before accessing indexing properties
        if (data && data.choices && Array.isArray(data.choices) && data.choices.length > 0 && data.choices[0]?.message?.content) {
            console.log("[Discussion Chain] Stage 3 Complete. Final delivery ready via dynamic broker.");
            return data.choices[0].message.content;
        }
        
        throw new Error("OpenRouter response body fields missing choices array payload.");
    } catch (err) {
        console.error("Discussion Stage 3 (OpenRouter) Error:", err);
        console.log("[Discussion Chain Fallback] Serving Gemini response directly due to OpenRouter block or bad signature.");
        return geminiResponse || "System encounter threshold limitation. Please re-run the thread query.";
    }
}

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTE: LIST ALL SAVED CHAT SESSIONS
// -----------------------------------------------------------
app.get('/api/chats', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;
    const userId = req.headers['x-user-id'] || 'default';

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
        const userPrefix = `JoesAI_Chat_${userId.trim()}__`;

        while ((match = hrefRegex.exec(xml)) !== null) {
            const decodedPath = decodeURIComponent(match[1]);
            let filename = decodedPath.split('/').pop();
            
            if (filename) {
                filename = filename.trim().split('?')[0]; 
            }

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

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTE: LOAD SPECIFIC CHAT CONTENT
// -----------------------------------------------------------
app.get('/api/chats/:filename', async (req, res) => {
    const filename = getSafeFilename(req.params.filename);
    if (!filename) {
        return res.status(400).json({ error: "Invalid filename format." });
    }

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

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTE: SAVE/UPDATE CHAT FILE
// -----------------------------------------------------------
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
        const safeTitle = title.trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
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

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTE: RENAME SPECIFIC FILE
// -----------------------------------------------------------
app.post('/api/chats/rename', async (req, res) => {
    const { oldFilename, sessionId, newTitle } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;
    const userId = req.headers['x-user-id'] || 'default';

    const safeOldFilename = getSafeFilename(oldFilename);
    if (!safeOldFilename) {
        return res.status(400).json({ error: "Invalid old filename format." });
    }

    if (!baseUrl || !user || !password) {
        return res.status(400).json({ error: "Cloud Config Missing: Set CLOUDSYNC variables on Render." });
    }

    try {
        const safeTitle = newTitle.trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const newFilename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

        const response = await fetch(`${baseUrl}${safeOldFilename}`, {
            method: 'MOVE',
            headers: {
                'Authorization': authHeader,
                'Destination': `${baseUrl}${newFilename}`
            }
        });

        if (response.ok || response.status === 201 || response.status === 204) {
            res.json({ success: true, filename: newFilename });
        } else {
            res.status(response.status).json({ error: "Failed to rename conversation." });
        }
    } catch (err) {
        console.error("Koofr WebDAV MOVE Failure:", err);
        res.status(500).json({ error: "Failed to rename file on Koofr." });
    }
});

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTE: DELETE CHAT SESSION
// -----------------------------------------------------------
app.delete('/api/chats/:filename', async (req, res) => {
    const filename = getSafeFilename(req.params.filename);
    if (!filename) {
        return res.status(400).json({ error: "Invalid filename format." });
    }

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

// -----------------------------------------------------------
// PDF EXPORT ROUTE: Generate PDF from chat history
// -----------------------------------------------------------
app.get('/api/chats/:filename/pdf', async (req, res) => {
    const filename = getSafeFilename(req.params.filename);
    if (!filename) {
        return res.status(400).json({ error: "Invalid filename format." });
    }

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

        const chatData = await response.json();
        const history = chatData.history || [];
        
        const docDefinition = {
            content: [
                { text: chatData.title || 'Chat Export', fontSize: 20, bold: true, margin: [0, 0, 0, 10] },
                ...history.flatMap(msg => [
                    { text: `${msg.role}:`, bold: true, margin: [0, 5, 0, 2] },
                    { text: msg.content || '', margin: [0, 0, 0, 10] }
                ])
            ],
            defaultStyle: {
                font: 'Roboto'
            }
        };

        const printer = new PdfPrinter(fonts);
        const pdfDocStream = printer.createPdfKitDocument(docDefinition);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace('.json', '.pdf')}"`);

        pdfDocStream.pipe(res);
        pdfDocStream.end();

    } catch (err) {
        console.error("PDF export failure:", err);
        res.status(500).json({ error: "Failed to generate PDF.", details: err.message });
    }
});

// -----------------------------------------------------------
// ADAPTIVE GEMINI ROUTE (Handles Text & Media Upload split)
// -----------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType, mode, chatHistory } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server: GEMINI_API_KEY is missing on Render settings.' });
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
        const activeSystemInstruction = getSystemPrompt(mode);

        const contents = [];
        if (chatHistory && chatHistory.length > 0) {
            chatHistory.forEach(msg => {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content || "Analyze files safely." }]
                });
            });
        }

        const userParts = [{ text: message || "Analyze this request." }];
        
        if (fileData) {
            userParts.push({
                inline_data: {
                    mime_type: mimeType || "image/jpeg",
                    data: fileData
                }
            });
        }

        contents.push({ role: 'user', parts: userParts });

        const payload = {
            systemInstruction: { parts: [{ text: activeSystemInstruction }] },
            contents: contents
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Google API Error Details:', data);
            return res.status(response.status).json({ 
                error: data.error?.message || 'Google API refused the request.' 
            });
        }

        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI was unable to process this request.";
        res.json({ text: aiResponse });

    } catch (err) {
        console.error('Server side crash:', err);
        res.status(500).json({ error: 'Internal Server Error. Please monitor Render Logs.' });
    }
});

// -----------------------------------------------------------
// YOUTUBE SEARCH ROUTE
// -----------------------------------------------------------
app.post('/api/youtube/search', async (req, res) => {
    const { query, maxResults = 5 } = req.body;
    const API_KEY = process.env.YOUTUBE_API_KEY;

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server: YOUTUBE_API_KEY is missing on Render settings.' });
    }

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Search query is required and must be a string.' });
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodedQuery}&type=video&maxResults=${maxResults}&key=${API_KEY}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            console.error('YouTube API Error:', data);
            return res.status(response.status).json({ 
                error: data.error?.message || 'YouTube API request failed.' 
            });
        }

        const videos = data.items?.map(item => ({
            title: item.snippet.title,
            videoId: item.id.videoId,
            description: item.snippet.description,
            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
            channelTitle: item.snippet.channelTitle,
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`
        })) || [];

        res.json({
            query,
            count: videos.length,
            videos
        });

    } catch (err) {
        console.error('YouTube search handling failed:', err);
        res.status(500).json({ error: 'YouTube search backend failure' });
    }
});

// -----------------------------------------------------------
// GOOGLE DRIVE ROUTE: List Files
// -----------------------------------------------------------
app.get('/api/drive/files', async (req, res) => {
    const API_KEY = process.env.GOOGLE_DRIVE_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ error: 'Server: GOOGLE_DRIVE_API_KEY is missing.' });
    }
    try {
        const drive = google.drive({ version: 'v3', auth: API_KEY });
        const response = await drive.files.list({
            pageSize: 100,
            fields: 'files(id, name, mimeType, modifiedTime)'
        });
        res.json({ files: response.data.files || [] });
    } catch (err) {
        console.error('Google Drive error:', err);
        res.status(500).json({ error: 'Failed to list Drive files.' });
    }
});

// -----------------------------------------------------------
// GMAIL ALERT ROUTE: Send alert email using OAuth2 credentials
// -----------------------------------------------------------
app.post('/api/gmail/alert', async (req, res) => {
    const { to, subject, message } = req.body;

    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
        return res.status(500).json({ 
            error: 'Server: Gmail OAuth client configurations or refresh tokens are missing.' 
        });
    }

    if (!to || !subject || !message) {
        return res.status(400).json({ error: 'Missing to, subject, or message fields.' });
    }

    try {
        const rawMessage = [
            `To: ${to}`,
            'Content-Type: text/html; charset=utf-8',
            'MIME-Version: 1.0',
            `Subject: ${subject}`,
            '',
            message
        ].join('\r\n');

        const encodedMessage = Buffer.from(rawMessage)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodedMessage }
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Gmail alert error:', err);
        res.status(500).json({ error: 'Failed to send Gmail alert.', details: err.message });
    }
});

// -----------------------------------------------------------
// ADAPTIVE MULTI-MODEL ROUTE (Cascading Discussion Pass)
// -----------------------------------------------------------
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, mode } = req.body;
        
        let searchQuery = messages?.slice(-6)?.map(m => m.content).join(' ') || 'General inquiry';
        const hasAttachments = messages?.some(m => m.attachments?.length > 0);
        const attachments = hasAttachments 
            ? messages.filter(m => m.attachments?.length > 0).flatMap(m => m.attachments)
            : [];
        
        if (searchQuery.length > 300) {
            searchQuery = searchQuery.substring(0, 300) + '...';
        }
        
        console.log(`[Search] Forwarding truncated query to Tavily (${searchQuery.length} chars)`);
        const searchResults = await fetchTavilySearch(searchQuery, 'web', 5);
        const discussionOutput = await executeDiscussionChain(searchQuery, mode, searchResults.items, attachments);
        
        res.json({ text: discussionOutput });
        
    } catch (error) {
        console.error('Adaptive multi-model discussion route failed:', error);
        res.status(500).json({ error: 'Multi-model context aggregation error occurred.' });
    }
});

app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    res.json({ isAdmin: email?.toLowerCase() === ADMIN_EMAIL?.toLowerCase() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Active on Port ${PORT}`));
