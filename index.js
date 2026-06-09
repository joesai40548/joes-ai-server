const express = require('express');
const cors = require('cors');
// Use native fetch if available on newer Node.js versions, preventing CommonJS require crashes
const fetch = globalThis.fetch || require('node-fetch');
const path = require('path');
require('dotenv').config();

// Initialize pdfmake with default virtual printer standard core fonts
const PdfPrinter = require('pdfmake');
const fonts = {
    Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
    }
};
const printer = new PdfPrinter(fonts);

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

// --- CONFIG & KEYS ---
const KEYS = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    tavily: process.env.TAVILY_API_KEY 
};

const TAVILY_KEYS_POOL = process.env.TAVILY_API_KEY 
    ? process.env.TAVILY_API_KEY.split(',').map(key => key.trim()).filter(Boolean)
    : [];

// --- HELPER FUNCTIONS ---

/**
 * Sanitizes the User ID to prevent path traversal issues.
 */
function getSafeUserId(userId) {
    if (!userId || typeof userId !== 'string') return 'default';
    return userId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Strips path traversal sequences to secure cloud storage routes.
 */
function getSafeFilename(filename) {
    if (!filename || typeof filename !== 'string') return null;
    
    let decoded = filename;
    try {
        decoded = decodeURIComponent(filename);
    } catch (e) {
        // Fallback to original if decoding fails
    }

    const base = path.basename(decoded);
    // Extra guard against path traversals
    if (base.includes('..') || base.includes('/') || base.includes('\\')) {
        return null;
    }
    
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
        "1. TABLES: MUST use strict GitHub Flavored Markdown. You MUST include the header separator row (e.g., | Header | Header |\n|---|---|). Never output smashed text.\n" +
        "2. DIAGRAMS & VISUALS: Generate Mermaid or real images ![Alt text](image_url). You are provided with direct image URLs and video thumbnails in the search context. If relevant, you MUST display them to the user using Markdown images, for example as a clickable thumbnail: [![Watch Video](thumbnail_url)](video_url) or direct image embeds: ![Topic Image](image_url) to visually enrich your response.\n" +
        "3. STRUCTURED OUTPUT: Clear headings, bullet points. No filler text.\n" +
        "4. CITATIONS: Include inline references. Use reliable sources.";

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

// Search engine utilizing the keys pool
async function fetchTavilySearch(query, searchType = 'web', count = 5) {
    if (TAVILY_KEYS_POOL.length === 0) {
        console.warn('[Search Engine] No Tavily API keys detected in configuration.');
        return { query, searchType, count: 0, items: [], images: [] };
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
                    include_images: true, // Fetch source page visuals and diagrams
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
                images: data.images || [], // Gathers query-relevant visual media
                items: data.results?.map(item => ({
                    title: item.title,
                    link: item.url,
                    snippet: item.content,
                    displayLink: new URL(item.url).hostname,
                    images: item.images || [] // Capture source-linked specific images
                })) || []
            };

        } catch (err) {
            console.error(`[Search Engine] Network exception on Tavily Key index [${i}]:`, err.message);
        }
    }

    console.error('[Search Engine] CRITICAL: All provided Tavily API keys in pool have failed or exhausted limits.');
    return { query, searchType, count: 0, items: [], images: [] };
}

async function fetchYoutubeSearch(query, maxResults = 5) {
    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY) {
        console.warn('[Search Engine] No YouTube API key detected in configuration.');
        return { query, count: 0, videos: [] };
    }
    if (!query || typeof query !== 'string') {
        return { query, count: 0, videos: [] };
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodedQuery}&type=video&maxResults=${Math.min(Math.max(maxResults, 1), 10)}&key=${API_KEY}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            console.error('[Search Engine] YouTube API Error:', data.error?.message || data);
            return { query, count: 0, videos: [] };
        }

        const videos = data.items?.map(item => ({
            title: item.snippet.title,
            videoId: item.id.videoId,
            description: item.snippet.description,
            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
            channelTitle: item.snippet.channelTitle,
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`
        })) || [];

        console.log(`[Search Engine] YouTube search successful: ${videos.length} results.`);
        return { query, count: videos.length, videos };

    } catch (err) {
        console.error(`[Search Engine] YouTube search exception:`, err.message);
        return { query, count: 0, videos: [] };
    }
}

/**
 * SINGLE MODEL RESPONSE ENGINE
 */
async function executeSingleModelResponse(message, mode, searchResults, attachments = []) {
    const systemPrompt = getSystemPrompt(mode);
    const contextString = JSON.stringify(searchResults, null, 2);
    const hasAttachments = attachments && attachments.length > 0;

    // Attachments always route to Gemini for parsing and multi-modal handling
    if (hasAttachments) {
        if (!KEYS.gemini) {
            throw new Error('Gemini API Key is missing. Cannot process attachments.');
        }
        console.log(`[Model Engine] Attachments detected. Routing to Gemini for file analysis...`);
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
        
        const parts = [{ 
            text: `${systemPrompt}\n\n` +
                  `User Request: ${message}\n` +
                  `Search Results: ${contextString}\n\n` +
                  `[ATTACHMENTS DETECTED - ANALYZE THESE FILES]\n\n` +
                  `Please analyze the attached files and incorporate your findings into your response.`
        }];

        attachments.forEach(att => {
            if (att.fileData && att.mimeType) {
                parts.push({
                    inline_data: {
                        mime_type: att.mimeType,
                        data: att.fileData
                    }
                });
            }
        });

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                systemInstruction: { parts: [{ text: systemPrompt }] }
            })
        });

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "AI was unable to process this request.";
    }

    // Determine target mode dynamically with graceful environment fallback
    let selectedMode = mode;
    if (selectedMode === 'code' && !KEYS.openrouter) {
        console.warn('[Model Engine] OpenRouter key missing. Falling back to Groq for execution.');
        selectedMode = 'chat';
    }
    if (selectedMode === 'study' && !KEYS.gemini) {
        console.warn('[Model Engine] Gemini key missing. Falling back to Groq for execution.');
        selectedMode = 'chat';
    }
    if (selectedMode === 'chat' && !KEYS.groq) {
        console.warn('[Model Engine] Groq key missing. Attempting fallback model provider.');
        if (KEYS.gemini) {
            selectedMode = 'study';
        } else if (KEYS.openrouter) {
            selectedMode = 'code';
        } else {
            throw new Error('All model API credentials (Groq, Gemini, OpenRouter) are missing.');
        }
    }

    switch(selectedMode) {
        case 'code':
            console.log(`[Model Engine] Code mode. Routing to OpenRouter...`);
            const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
            const openRouterResponse = await fetch(openRouterUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${KEYS.openrouter}`,
                    'HTTP-Referer': 'https://joes-ai-server.onrender.com',
                    'X-Title': 'Joes AI Workspace'
                },
                body: JSON.stringify({
                    model: 'openrouter/free',
                    messages: [
                        { role: 'system', content: `${systemPrompt}\n\nSearch Results:\n${contextString}` },
                        { role: 'user', content: `User Request: ${message}\n\nUse the search results above to provide an accurate, polished response.` }
                    ]
                })
            });

            const openRouterData = await openRouterResponse.json();
            if (!openRouterResponse.ok) {
                console.error('[Model Engine] OpenRouter Error:', openRouterData);
                throw new Error(openRouterData?.error?.message || `OpenRouter HTTP error! status: ${openRouterResponse.status}`);
            }

            if (openRouterData && openRouterData.choices && Array.isArray(openRouterData.choices) && openRouterData.choices.length > 0 && openRouterData.choices[0]?.message?.content) {
                return openRouterData.choices[0].message.content;
            }
            throw new Error('OpenRouter response body missing choices array payload.');

        case 'study':
            console.log(`[Model Engine] Study mode. Routing to Gemini...`);
            const studyGeminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
            const studyParts = [{ 
                text: `${systemPrompt}\n\n` +
                      `User Request: ${message}\n` +
                      `Search Results: ${contextString}\n\n` +
                      `Please use the search results above to provide an accurate, structured academic response with diagrams and quiz questions where appropriate.`
            }];
            const studyResponse = await fetch(studyGeminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: studyParts }],
                    systemInstruction: { parts: [{ text: systemPrompt }] }
                })
            });
            const studyData = await studyResponse.json();
            return studyData.candidates?.[0]?.content?.parts?.[0]?.text || "AI was unable to process this request.";

        case 'chat':
        default:
            console.log(`[Model Engine] Chat mode. Routing to Groq...`);
            const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
            const groqResponse = await fetch(groqUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${KEYS.groq}`
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: `${systemPrompt}\n\nSearch Results:\n${contextString}` },
                        { role: 'user', content: `User Request: ${message}\n\nUse the search results above to provide an accurate, polished response.` }
                    ]
                })
            });

            const groqData = await groqResponse.json();
            if (!groqResponse.ok) {
                console.error('[Model Engine] Groq Error:', groqData);
                throw new Error(groqData?.error?.message || `Groq HTTP error! status: ${groqResponse.status}`);
            }

            if (groqData && groqData.choices && Array.isArray(groqData.choices) && groqData.choices.length > 0 && groqData.choices[0]?.message?.content) {
                return groqData.choices[0].message.content;
            }
            throw new Error('Groq response body missing choices array payload.');
    }
}

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTE: LIST ALL SAVED CHAT SESSIONS
// -----------------------------------------------------------
app.get('/api/chats', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;
    const userId = getSafeUserId(req.headers['x-user-id']);

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
        const userPrefix = `JoesAI_Chat_${userId}__`;

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
    const userId = getSafeUserId(req.headers['x-user-id']);

    if (!sessionId || !history) {
        return res.status(400).json({ error: "Missing required properties 'sessionId' or 'history'." });
    }

    if (!baseUrl || !user || !password) {
        return res.status(400).json({ error: "Cloud Sync Config Missing on Render." });
    }

    try {
        const rawTitle = title || 'untitled';
        const safeTitle = rawTitle.trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const filename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

        const response = await fetch(`${baseUrl}${filename}`, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId, title: rawTitle, history })
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
    const userId = getSafeUserId(req.headers['x-user-id']);

    const safeOldFilename = getSafeFilename(oldFilename);
    if (!safeOldFilename) {
        return res.status(400).json({ error: "Invalid old filename format." });
    }

    if (!sessionId || !newTitle) {
        return res.status(400).json({ error: "Missing required properties: 'sessionId' or 'newTitle'." });
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
// PDF EXPORT ROUTE: Generate true PDF binary from chat history
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
        const chatTitle = chatData.title || 'Chat Export';

        // Compile the Document Content Structure 
        const docContent = [
            { text: chatTitle, style: 'header' },
            { text: `Exported on: ${new Date().toLocaleString()}`, style: 'subHeader' },
            { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1.5, color: '#e0e0e0' }] },
            { text: '\n' }
        ];

        // Iterate dynamically over chat context frames
        history.forEach(msg => {
            const isUser = msg.role === 'user';
            
            docContent.push({
                text: isUser ? '👤 User' : '🤖 Assistant',
                style: isUser ? 'userLabel' : 'aiLabel'
            });

            docContent.push({
                text: msg.content || '',
                style: 'messageBody'
            });

            // Thin separation divider rule
            docContent.push({ 
                canvas: [{ type: 'line', x1: 0, y1: 10, x2: 515, y2: 10, lineWidth: 0.5, color: '#f0f0f0' }] 
            });
            docContent.push({ text: '\n' });
        });

        // Define formatting styles targeting standard base fonts
        const docDefinition = {
            content: docContent,
            defaultStyle: {
                font: 'Helvetica'
            },
            styles: {
                header: {
                    fontSize: 22,
                    bold: true,
                    color: '#1a1a1a'
                },
                subHeader: {
                    fontSize: 10,
                    italics: true,
                    color: '#666666'
                },
                userLabel: {
                    fontSize: 11,
                    bold: true,
                    color: '#2563eb', // Clean Blue
                    margin: [0, 5, 0, 2]
                },
                aiLabel: {
                    fontSize: 11,
                    bold: true,
                    color: '#059669', // Emerald Green
                    margin: [0, 5, 0, 2]
                },
                messageBody: {
                    fontSize: 11,
                    lineHeight: 1.4,
                    color: '#374151',
                    margin: [5, 2, 5, 5]
                }
            }
        };

        // Create binary stream architecture and output response payload safely
        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        const cleanDownloadName = filename.replace('.json', '.pdf');
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${cleanDownloadName}"`);

        pdfDoc.on('error', (pdfErr) => {
            console.error("PDF engine streaming crash:", pdfErr);
            if (!res.headersSent) {
                res.status(500).json({ error: "An error occurred during PDF rendering." });
            }
        });

        pdfDoc.pipe(res);
        pdfDoc.end();

    } catch (err) {
        console.error("PDF export failure:", err);
        res.status(500).json({ error: "Failed to generate document.", details: err.message });
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
    try {
        const { query, maxResults = 5 } = req.body;
        const results = await fetchYoutubeSearch(query, maxResults);
        res.json(results);
    } catch (err) {
        console.error('YouTube search handling failed:', err);
        res.status(500).json({ error: 'YouTube search backend failure' });
    }
});

// -----------------------------------------------------------
// GOOGLE DRIVE ROUTE: List Files (using direct fetch)
// -----------------------------------------------------------
app.get('/api/drive/files', async (req, res) => {
    const API_KEY = process.env.GOOGLE_DRIVE_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ error: 'Server: GOOGLE_DRIVE_API_KEY is missing.' });
    }
    try {
        const url = `https://www.googleapis.com/drive/v3/files?pageSize=100&fields=files(id,name,mimeType,modifiedTime)&key=${API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) {
            console.error('Drive API Error:', data);
            return res.status(response.status).json({ error: data.error?.message || 'Drive API failed' });
        }
        res.json({ files: data.files || [] });
    } catch (err) {
        console.error('Google Drive error:', err);
        res.status(500).json({ error: 'Failed to list Drive files.' });
    }
});

// -----------------------------------------------------------
// ADAPTIVE CHAT ROUTE (Utilizes single-model responses with Tavily / YouTube Integration)
// -----------------------------------------------------------
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, mode } = req.body;

        const userMessages = messages?.filter(m => m.role === 'user') || [];
        const latestUserMessage = userMessages.length > 0
            ? userMessages[userMessages.length - 1].content
            : 'General inquiry';

        let searchQuery = messages?.slice(-6)?.map(m => m.content).join(' ') || latestUserMessage;
        const hasAttachments = messages?.some(m => m.attachments?.length > 0);
        const attachments = hasAttachments
            ? messages.filter(m => m.attachments?.length > 0).flatMap(m => m.attachments)
            : [];

        if (searchQuery.length > 300) {
            searchQuery = searchQuery.substring(0, 300) + '...';
        }

        console.log(`[Search] Forwarding query to Tavily and YouTube (${searchQuery.length} chars)`);
        const [tavilyResults, youtubeResults] = await Promise.all([
            fetchTavilySearch(searchQuery, 'web', 5),
            fetchYoutubeSearch(searchQuery, 5).catch(err => {
                console.error('[Search] YouTube search failed:', err.message);
                return { query: searchQuery, count: 0, videos: [] };
            })
        ]);

        const textResults = [
            ...(tavilyResults.items || []),
            ...(youtubeResults.videos || []).map(v => {
                let displayLink = 'youtube.com';
                try {
                    if (v.url) {
                        displayLink = new URL(v.url).hostname;
                    }
                } catch (e) {
                    // Safe fallback
                }
                return {
                    title: v.title,
                    link: v.url,
                    snippet: v.description,
                    displayLink,
                    thumbnail: v.thumbnail
                };
            })
        ];

        // Gathers visual sources (YouTube thumbnails and top-level Tavily related web images)
        const topicImages = [
            ...(tavilyResults.images || []),
            ...(youtubeResults.videos || []).map(v => v.thumbnail).filter(Boolean)
        ];

        const combinedContext = {
            search_items: textResults,
            visual_assets: topicImages
        };

        console.log(`[Search] Combined ${textResults.length} text items & ${topicImages.length} visual resources.`);
        
        const responseText = await executeSingleModelResponse(latestUserMessage, mode, combinedContext, attachments);

        res.json({ text: responseText });

    } catch (error) {
        console.error('Adaptive chat single-model processing failed:', error);
        res.status(500).json({ error: 'Context aggregation or model execution error occurred.', details: error.message });
    }
});

// -----------------------------------------------------------
// ADMIN CHECK ROUTE
// -----------------------------------------------------------
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    res.json({ isAdmin: email?.toLowerCase() === ADMIN_EMAIL?.toLowerCase() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Active on Port ${PORT}`));
