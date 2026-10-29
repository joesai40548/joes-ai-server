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
const TAVILY_KEYS_POOL = process.env.TAVILY_API_KEY 
    ? process.env.TAVILY_API_KEY.split(',').map(key => key.trim()).filter(Boolean)
    : [];

const GEMINI_KEYS_POOL = process.env.GEMINI_API_KEY 
    ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()).filter(Boolean)
    : [];

const KEYS = {
    groq: process.env.GROQ_API_KEY,
    gemini: GEMINI_KEYS_POOL,
    openrouter: process.env.OPENROUTER_API_KEY,
    tavily: process.env.TAVILY_API_KEY 
};

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
 * Cleans filenames and session names to guarantee valid file creations
 */
function getSafeTitleSlug(rawTitle) {
    const fallback = 'untitled';
    if (!rawTitle || typeof rawTitle !== 'string') return fallback;
    return rawTitle
        .trim()
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || fallback;
}

/**
 * Strips emoji glyphs and unsupported characters to avoid PDFMake rendering errors
 */
function sanitizeForPdf(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/👤/g, 'User')
        .replace(/🤖/g, 'Assistant')
        .replace(/⚡/g, 'Joes AI')
        .replace(/[\uD800-\uDFFF]./g, '') // Strip standard high-range emoji characters
        .trim();
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
        "4. CITATIONS: When Search Results are provided, cite them inline using [1], [2], etc. and include the source URL. Never include ##### in responses. ";

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

/**
 * Heuristic classifier: decides whether a user message genuinely requires a live
 * web search. Avoids calling Tavily/YouTube for greetings, chit-chat, math,
 * coding help, creative writing, and general-knowledge questions where recency
 * does not matter. Saves API cost and reduces latency.
 */
function shouldUseWebSearch(message) {
    const text = (message || '').trim();
    if (!text) return false;
    if (text.length <= 3) return false;
    const lower = text.toLowerCase();

    // Pure greetings / chit-chat never need search.
    if (/^(hi|hello|hey|hola|greetings|yo|sup|good\s*(morning|afternoon|evening))[\s!.]*$/i.test(text)) {
        return false;
    }

    // Time-sensitive / current-event signals that justify a live search.
    const currentSignals = [
        'today', 'now', 'currently', 'latest', 'recent', 'this week', 'this month', 'this year',
        'breaking', 'news', 'headline', 'just released', 'just launched', 'announced',
        'weather', 'temperature', 'forecast', 'sports', 'score', 'match', 'game', 'won', 'lost',
        'stock', 'price', 'crypto', 'bitcoin', 'exchange rate', 'what happened', 'who won',
        'current status', 'is still', 'tomorrow', 'yesterday', '2024', '2025', '2026'
    ];
    const hasCurrentSignal = currentSignals.some(k => lower.includes(k));

    // Purely static tasks (creative, educational, general knowledge, code) that
    // do not benefit from recency. Still allow search when a current signal is present
    // (e.g. "write code to fetch the latest weather").
    const noSearchSignals = [
        'write a story', 'write a poem', 'write an essay', 'write code', 'write a function',
        'write a script', 'create a', 'build a', 'make a website', 'html', 'css', 'javascript',
        'python', 'react', 'node.js', 'api', 'endpoint', 'database', 'sql', 'query', 'explain',
        'how does', 'how to', 'what is', 'definition', 'meaning of', 'translate', 'summarize',
        'summary', 'rewrite', 'paraphrase', 'math', 'calculate', 'solve', 'equation', 'plus',
        'minus', 'divide', 'times'
    ];
    const isPurelyStatic = noSearchSignals.some(k => lower.includes(k));

    if (hasCurrentSignal) return true;
    return false;
}

/**
 * Formats aggregated search results into a compact, model-friendly context block
 * with numbered items so the assistant can cite them inline as [1], [2], etc.
 */
function formatSearchContext(searchResults) {
    const items = searchResults?.search_items || [];
    const visuals = searchResults?.visual_assets || [];
    if (!items.length && !visuals.length) {
        return 'No search results available.';
    }
    const parts = ['Search Results:'];
    items.forEach((item, i) => {
        parts.push(
            `[${i + 1}] ${item.title || ''}\n` +
            `URL: ${item.link || ''}\n` +
            `Snippet: ${item.snippet || ''}`
        );
    });
    if (visuals.length) {
        parts.push('\nVisual Assets:');
        visuals.forEach((v, i) => parts.push(`[IMG ${i + 1}] ${v}`));
    }
    return parts.join('\n\n');
}

// --- WATERFALL API ROUTING HELPERS ---

async function callOpenRouter(systemPrompt, contextString, message) {
    if (!KEYS.openrouter) throw new Error("OpenRouter credentials missing in environment settings.");
    const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
    const response = await fetch(openRouterUrl, {
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

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error?.message || `OpenRouter API returned HTTP status ${response.status}`);
    }
    if (data?.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
    }
    throw new Error("OpenRouter completion response payload structure is missing standard content field.");
}

async function callGeminiStudy(systemPrompt, contextString, message) {
    if (!KEYS.gemini) throw new Error("Gemini credentials missing in environment settings.");
    const studyGeminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
    const studyParts = [{ 
        text: `${systemPrompt}\n\n` +
              `User Request: ${message}\n` +
              `Search Results: ${contextString}\n\n` +
              `Please use the search results above to provide an accurate, structured academic response with diagrams and quiz questions where appropriate.`
    }];
    const response = await fetch(studyGeminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: studyParts }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error?.message || `Gemini Study API returned HTTP status ${response.status}`);
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini returned empty candidate text content.";
}

async function callGroq(systemPrompt, contextString, message) {
    if (!KEYS.groq) throw new Error("Groq credentials missing in environment settings.");
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    const response = await fetch(groqUrl, {
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

    const data = await response.json();
    // FIX: Replaced non-existent groqResponse variable reference with response
    if (!response.ok) {
        throw new Error(data?.error?.message || `Groq API returned HTTP status ${response.status}`);
    }
    if (data?.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
    }
    throw new Error("Groq completion response payload structure is missing standard content field.");
}

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
                    include_images: true, 
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
                images: data.images || [], 
                items: data.results?.map(item => ({
                    title: item.title,
                    link: item.url,
                    snippet: item.content,
                    displayLink: new URL(item.url).hostname,
                    images: item.images || [] 
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
            console.error('[Search Engine] YouTube API Error:', data?.error?.message || data);
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
 * SINGLE MODEL RESPONSE ENGINE WITH FAILOVER WATERFALL
 */
async function executeSingleModelResponse(message, mode, contextString, attachments = []) {
    const systemPrompt = getSystemPrompt(mode);
    const hasAttachments = attachments && attachments.length > 0;

    // Attachments strictly route to Gemini first for multimodal processing
    if (hasAttachments) {
        try {
            if (!KEYS.gemini) throw new Error('Gemini API Key is missing.');
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
            if (!response.ok) {
                throw new Error(data?.error?.message || `Gemini Multimodal REST API returned status ${response.status}`);
            }

            return data.candidates?.[0]?.content?.parts?.[0]?.text || "AI was unable to process this request structure.";
        } catch (err) {
            console.error('[Model Engine] Gemini Multimodal attempt encountered an error:', err.message);
            console.log('[Model Engine] Attempting text-only fallback waterfall queue with other providers...');
            // Fall through to the text waterfall completion loop instead of throwing a hard crash
        }
    }

    // Assemble prioritized fallback queue based on the active mode
    const generationWaterfall = [];

    if (mode === 'code') {
        generationWaterfall.push({ name: 'OpenRouter', call: () => callOpenRouter(systemPrompt, contextString, message) });
        generationWaterfall.push({ name: 'Groq', call: () => callGroq(systemPrompt, contextString, message) });
        generationWaterfall.push({ name: 'Gemini (Study Fallback)', call: () => callGeminiStudy(systemPrompt, contextString, message) });
    } else if (mode === 'study') {
        generationWaterfall.push({ name: 'Gemini (Flash)', call: () => callGeminiStudy(systemPrompt, contextString, message) });
        generationWaterfall.push({ name: 'Groq', call: () => callGroq(systemPrompt, contextString, message) });
        generationWaterfall.push({ name: 'OpenRouter', call: () => callOpenRouter(systemPrompt, contextString, message) });
    } else {
        // Chat mode and default fallbacks
        generationWaterfall.push({ name: 'Groq', call: () => callGroq(systemPrompt, contextString, message) });
        generationWaterfall.push({ name: 'Gemini (Study Fallback)', call: () => callGeminiStudy(systemPrompt, contextString, message) });
        generationWaterfall.push({ name: 'OpenRouter', call: () => callOpenRouter(systemPrompt, contextString, message) });
    }

    // Sequentially evaluate waterfall providers 
    let recordedError = null;
    for (const provider of generationWaterfall) {
        try {
            console.log(`[Model Engine] Dispatching generation thread to provider: ${provider.name}`);
            const result = await provider.call();
            console.log(`[Model Engine] Dispatch Successful! Completed via provider: ${provider.name}`);
            return result;
        } catch (err) {
            console.warn(`[Model Engine] Provider [${provider.name}] failed during execution step:`, err.message);
            recordedError = err;
            // Catch error and gracefully iterate to the next fallback option in line
        }
    }

    // If execution falls through this loop, all API providers have failed
    throw new Error(`All available completion providers in waterfall have failed. Last recorded exception: ${recordedError ? recordedError.message : 'Unknown'}`);
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
                
                // Deduplicate items to maintain clean rendering inside the UI sidebar
                if (!files.some(fileObj => fileObj.filename === filename)) {
                    files.push({ id, filename, title });
                }
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
        const safeTitle = getSafeTitleSlug(title);
        const filename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

        const response = await fetch(`${baseUrl}${filename}`, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId, title: title || 'untitled', history })
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
        const safeTitle = getSafeTitleSlug(newTitle);
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

        // Compile the Document Content Structure safely sanitizing standard core fonts
        const docContent = [
            { text: sanitizeForPdf(chatTitle), style: 'header' },
            { text: `Exported on: ${new Date().toLocaleString()}`, style: 'subHeader' },
            { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1.5, color: '#e0e0e0' }] },
            { text: '\n' }
        ];

        // Iterate dynamically over chat context frames
        history.forEach(msg => {
            const isUser = msg.role === 'user';
            
            docContent.push({
                text: isUser ? 'User' : 'Assistant',
                style: isUser ? 'userLabel' : 'aiLabel'
            });

            docContent.push({
                text: sanitizeForPdf(msg.content || ''),
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

        // Create binary stream architecture and output response payload safely with sanitized file header headers
        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        const cleanDownloadName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_').replace('.json', '.pdf');
        
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
                error: data?.error?.message || 'Google API refused the request.' 
            });
        }

        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI was unable to process this request structure.";
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
            return res.status(response.status).json({ error: data?.error?.message || 'Drive API failed' });
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

        // Guardrail: Skip search engine for basic greetings or short conversational inputs.
        // Use intelligent detection so websearch only runs when recency is actually needed.
        const clientSkipSearch = req.body.skipSearch === true;
        const clientForceSearch = req.body.forceSearch === true;
        const isGreeting = /^(hi|hello|hey|hola|greetings|yo|sup|good\s*(morning|afternoon|evening))[\s!.]*$/i.test(latestUserMessage.trim());
        const isTooShort = latestUserMessage.trim().length <= 3;
        const needsSearch = clientForceSearch || (!clientSkipSearch && !isGreeting && !isTooShort && shouldUseWebSearch(latestUserMessage));

        let combinedContext = {
            search_items: [],
            visual_assets: []
        };

        // Aggregates both singular or plural attachments array styles dynamically
        const attachments = [];
        messages?.forEach(m => {
            if (m.attachments && Array.isArray(m.attachments)) {
                attachments.push(...m.attachments);
            } else if (m.attachment) {
                attachments.push(m.attachment);
            }
        });

        if (needsSearch) {
            let searchQuery = messages?.slice(-6)?.map(m => m.content).join(' ') || latestUserMessage;
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

            combinedContext.search_items = textResults;
            combinedContext.visual_assets = topicImages;

            console.log(`[Search] Combined ${textResults.length} text items & ${topicImages.length} visual resources.`);
        } else {
            console.log(`[Search] Skipped query extraction. Processing direct text response for conversational intent: "${latestUserMessage}"`);
        }

        const contextString = formatSearchContext(combinedContext);

        const responseText = await executeSingleModelResponse(latestUserMessage, mode, contextString, attachments);

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
