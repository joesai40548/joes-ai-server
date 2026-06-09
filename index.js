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

const MODELS = {
    chat: { 
        groq: 'llama-3.3-70b-versatile', 
        gemini: 'gemini-2.5-flash',
        openrouter: 'openrouter/free'
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
 * DELIVERY FIX 1: Strict Formatting Constraints
 * Custom Adaptive System Prompt Constructor
 */
function getSystemPrompt(mode) {
    const creatorIdentity = 
        "You are Joes AI, a highly intelligent and custom-designed AI assistant. " +
        "You were developed and are owned entirely by AKRAM JOES TECHNOLOGIES. " +
        "If any user asks you who developed you, who owns you, or who built you, you must answer proudly that you were developed and are owned by AKRAM JOES TECHNOLOGIES. " +
        "Never state that you are developed by Google, Meta, OpenAI, or anyone else. " +
        "CRITICAL OUTPUT REQUIREMENTS:\n" +
        "1. TABLES: You MUST use strict GitHub Flavored Markdown. Every table MUST have a header separator row (e.g., |---|---|). You MUST include a blank line before and after every table. Never output smashed text.\n" +
        "2. LISTS: Always leave a blank line before starting a bulleted or numbered list.\n" +
        "3. DIAGRAMS & VISUALS: Generate Mermaid or real images ![Alt text](image_url)\n" +
        "4. STRUCTURED OUTPUT: Clear headings, bullet points. No filler text.\n" +
        "5. CITATIONS: Include inline references. Use reliable sources.";

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

/**
 * DELIVERY FIX 2: Content Sanitizer
 * Ensures the raw LLM output is formatted cleanly so frontend parsers can render grids.
 */
function formatForDelivery(rawText) {
    if (!rawText) return "No response generated.";
    
    let cleanText = rawText;
    
    // Ensure tables have a newline before and after them
    cleanText = cleanText.replace(/([^\n])\n(\|.*\|)\n/g, '$1\n\n$2\n'); 
    
    // Fix missing dashes in table separator rows if the AI forgot them
    cleanText = cleanText.replace(/(\|\s*[A-Za-z0-9_ ]+\s*\|\n)\|(\s*\|)+/g, '$1|---|---|');
    
    // Normalize excessive newlines to double newlines
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');
    
    return cleanText.trim();
}

const getKoofrBaseUrl = () => {
    const url = process.env.CLOUDSYNC_URL;
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
};

/**
 * CORE MODIFICATION 1 & 4: ADVANCED SEMANTIC ROUTING MATRIX
 */
async function evaluateSemanticRoute(userMessage) {
    if (!KEYS.gemini) {
        return { intent: 'chat', needsSearch: true };
    }
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
        const routingPrompt = 
            "Analyze the following user query. Categorize it into one of three operational intents:\n" +
            "1. 'code' - if requesting software architecture, debugging, compilation fixing, scripting, or syntax blocks.\n" +
            "2. 'study' - if requesting deep academic research, historical timelines, mathematical proofs, or study guides.\n" +
            "3. 'chat' - for greetings, casual small talk, philosophical views, or direct opinion responses.\n\n" +
            "Additionally, declare if answering it properly requires an external real-time web search or video lookups for up-to-date facts, current news, live definitions, or specific media.\n\n" +
            "Respond strictly with a valid JSON string matching this signature: {\"intent\": \"code\"|\"study\"|\"chat\", \"needsSearch\": true|false}. Do not use markdown wraps or extra descriptions.";

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: `${routingPrompt}\n\nUser Input: "${userMessage}"` }] }]
            })
        });

        const data = await response.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(rawText);
        
        console.log(`[Semantic Router] Classified Input: "${userMessage}" -> `, parsed);
        return {
            intent: parsed.intent || 'chat',
            needsSearch: !!parsed.needsSearch
        };
    } catch (err) {
        console.warn('[Semantic Router] Evaluation exception, executing default fallback:', err.message);
        return { intent: 'chat', needsSearch: true };
    }
}

/**
 * CORE MODIFICATION 2: KEYWORD SYNTHESIZER (DYNAMIC MEMORY RECONSTRUCTION)
 */
async function synthesizeSearchQuery(messages, latestUserMessage) {
    if (!KEYS.gemini || !messages || messages.length <= 1) {
        return latestUserMessage;
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
        const historySlice = messages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
        
        const synthesisPrompt = 
            "Analyze the recent chat history transcript and the latest request. Synthesize a concentrated, high-relevance search engine query string (max 6-8 words) that extracts the underlying technical entities, concepts, or current affairs requiring lookup. Avoid phrases like 'search for' or punctuation symbols.\n\n" +
            `--- CONVERSATION HISTORY ---\n${historySlice}\n\n` +
            `Latest Request: "${latestUserMessage}"`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: synthesisPrompt }] }]
            })
        });

        const data = await response.json();
        const extractedQuery = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        
        if (extractedQuery) {
            console.log(`[Context Synthesizer] Dynamic summary built: "${extractedQuery}"`);
            return extractedQuery;
        }
        return latestUserMessage;
    } catch (err) {
        console.error('[Context Synthesizer] Extraction failed, using base fallback:', err.message);
        return latestUserMessage;
    }
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

async function fetchTavilySearch(query, searchType = 'web', count = 5) {
    if (TAVILY_KEYS_POOL.length === 0) {
        console.warn('[Search Engine] No Tavily API keys detected in configuration.');
        return { query, searchType, count: 0, items: [] };
    }

    for (let i = 0; i < TAVILY_KEYS_POOL.length; i++) {
        const activeKey = TAVILY_KEYS_POOL[i];
        try {
            console.log(`[Search Engine] Trying Tavily API Key index [${i}]`);
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: activeKey,
                    query: query,
                    search_depth: "basic",
                    max_results: Math.min(Math.max(count, 1), 10)
                })
            });

            const data = await response.json();

            if (!response.ok || data.detail?.error) continue;

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
    return { query, searchType, count: 0, items: [] };
}

async function fetchYoutubeSearch(query, maxResults = 5) {
    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY || !query || typeof query !== 'string') return { query, count: 0, videos: [] };

    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodedQuery}&type=video&maxResults=${Math.min(Math.max(maxResults, 1), 10)}&key=${API_KEY}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) return { query, count: 0, videos: [] };

        const videos = data.items?.map(item => ({
            title: item.snippet.title,
            videoId: item.id.videoId,
            description: item.snippet.description,
            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
            channelTitle: item.snippet.channelTitle,
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`
        })) || [];

        return { query, count: videos.length, videos };
    } catch (err) {
        return { query, count: 0, videos: [] };
    }
}

/**
 * CORE MODIFICATION 3: FAULT-TOLERANT CASCADING BACKUP MATRIX 
 */
async function executeSingleModelResponse(message, mode, searchResults, attachments = []) {
    const systemPrompt = getSystemPrompt(mode);
    const contextString = JSON.stringify(searchResults, null, 2);
    const hasAttachments = attachments && attachments.length > 0;

    if (hasAttachments) {
        if (!KEYS.gemini) throw new Error("Gemini API Key missing.");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
        const parts = [{ text: `${systemPrompt}\n\nUser Request: ${message}\nSearch Results: ${contextString}\nPlease analyze attached files.` }];
        attachments.forEach(att => {
            if (att.fileData && att.mimeType) parts.push({ inline_data: { mime_type: att.mimeType, data: att.fileData } });
        });
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: 'user', parts }], systemInstruction: { parts: [{ text: systemPrompt }] } })
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "AI was unable to process this file request.";
    }

    if (mode === 'code') {
        try {
            if (!KEYS.openrouter) throw new Error("OpenRouter credentials unavailable.");
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS.openrouter}` },
                body: JSON.stringify({
                    model: 'openrouter/free',
                    messages: [
                        { role: 'system', content: `${systemPrompt}\n\nSearch Results:\n${contextString}` },
                        { role: 'user', content: message }
                    ]
                })
            });
            const data = await response.json();
            if (response.ok && data.choices?.[0]?.message?.content) return data.choices[0].message.content;
            throw new Error("OpenRouter error.");
        } catch (err) {
            if (!KEYS.groq) throw new Error("Cascade broke.");
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS.groq}` },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-specdec',
                    messages: [ { role: 'system', content: `${systemPrompt}\n\nSearch Results:\n${contextString}` }, { role: 'user', content: message } ]
                })
            });
            const data = await response.json();
            return data.choices?.[0]?.message?.content || "Fault handling failed.";
        }
    }

    if (mode === 'study') {
        try {
            if (!KEYS.gemini) throw new Error("Gemini keys missing.");
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nUser Request: ${message}\n\nSearch Results:\n${contextString}` }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] }
                })
            });
            const data = await response.json();
            if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;
            throw new Error("Gemini Core error.");
        } catch (err) {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS.groq}` },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [ { role: 'system', content: `${systemPrompt}\n\nSearch Results:\n${contextString}` }, { role: 'user', content: message } ]
                })
            });
            const data = await response.json();
            return data.choices?.[0]?.message?.content || "Academic runtime exception.";
        }
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS.groq}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [ { role: 'system', content: `${systemPrompt}\n\nSearch Context:\n${contextString}` }, { role: 'user', content: message } ]
            })
        });
        const data = await response.json();
        if (response.ok && data.choices?.[0]?.message?.content) return data.choices[0].message.content;
        throw new Error("Groq exception.");
    } catch (err) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEYS.gemini}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nUser Request: ${message}\n\nSearch Context:\n${contextString}` }] }]
            })
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "System structural failure.";
    }
}

/**
 * CORE MODIFICATION 3 (Continued): CASCADING MULTI-MODEL DISCUSSION ENGINE
 */
async function executeDiscussionChain(message, mode, searchResults, attachments = []) {
    const systemPrompt = getSystemPrompt(mode);
    const contextString = JSON.stringify(searchResults, null, 2);
    const hasAttachments = attachments && attachments.length > 0;
    const modeConfig = MODELS[mode] || MODELS.chat;
    let groqResponse = "Primary synthesis skipped.";
    let geminiResponse = "Peer augmentation skipped.";

    if (!hasAttachments && modeConfig.groq && KEYS.groq) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS.groq}` },
                body: JSON.stringify({
                    model: modeConfig.groq,
                    messages: [
                        { role: 'system', content: `${systemPrompt}\n\nSearch Context:\n${contextString}` },
                        { role: 'user', content: `User request: ${message}\n\nSynthesize an initial complete answer layout.` }
                    ]
                })
            });
            const data = await response.json();
            if (response.ok && data.choices?.[0]?.message?.content) groqResponse = data.choices[0].message.content;
        } catch (err) { console.warn("Stage 1 execution error:", err.message); }
    }

    if (KEYS.gemini) {
        try {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modeConfig.gemini}:generateContent?key=${KEYS.gemini}`;
            const parts = [{ text: `${systemPrompt}\n\nYou are the second engine. User Request: ${message}\nContext: ${contextString}\n\n` }];
            const geminiContents = [{ role: 'user', parts: [{ text: parts[0].text }] }];
            
            attachments.forEach(att => {
                if (att.fileData && att.mimeType) geminiContents[0].parts.push({ inline_data: { mime_type: att.mimeType, data: att.fileData } });
            });

            if (hasAttachments) {
                geminiContents[0].parts.push({ text: `\nPlease analyze the attached files.` });
            } else {
                geminiContents[0].parts.push({ text: `\nPrimary model suggested:\n${groqResponse}\nEnhance it and add clear markdown.` });
            }

            const response = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: geminiContents })
            });
            const data = await response.json();
            geminiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Augmentation stage empty.";
        } catch (err) { geminiResponse = groqResponse; }
    }

    try {
        const autoModel = modeConfig.openrouter || 'openrouter/free';
        if (!KEYS.openrouter) throw new Error("OpenRouter unmapped.");
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS.openrouter}` },
            body: JSON.stringify({
                model: autoModel,
                messages: [
                    { role: 'system', content: `${systemPrompt}\n\nYou are the Final Deliverer. Ensure proper markdown components.` },
                    { role: 'user', content: `Query: ${message}\n\n--- TRANSCRIPT ---\nGroq: ${groqResponse}\n\nGemini: ${geminiResponse}\n--- END ---\nDeliver the final response.` }
                ]
            })
        });
        const data = await response.json();
        if (response.ok && data.choices?.[0]?.message?.content) return data.choices[0].message.content;
        throw new Error("OpenRouter dropped payload.");
    } catch (err) { return geminiResponse; }
}

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTES
// -----------------------------------------------------------
app.get('/api/chats', async (req, res) => { /* Unchanged */ });
app.get('/api/chats/:filename', async (req, res) => { /* Unchanged */ });
app.post('/api/chats', async (req, res) => { /* Unchanged */ });
app.post('/api/chats/rename', async (req, res) => { /* Unchanged */ });
app.delete('/api/chats/:filename', async (req, res) => { /* Unchanged */ });
app.get('/api/chats/:filename/pdf', async (req, res) => { /* Unchanged */ });

// -----------------------------------------------------------
// ADAPTIVE GEMINI ROUTE 
// -----------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType, mode, chatHistory } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) return res.status(500).json({ error: 'Server: GEMINI_API_KEY is missing.' });

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
        if (fileData) userParts.push({ inline_data: { mime_type: mimeType || "image/jpeg", data: fileData } });
        contents.push({ role: 'user', parts: userParts });

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: activeSystemInstruction }] }, contents })
        });

        const data = await response.json();
        if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'API Error.' });

        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI error.";
        
        // DELIVERY FIX APPLIED HERE
        res.json({ text: formatForDelivery(aiResponse) });

    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error.' });
    }
});

// -----------------------------------------------------------
// YOUTUBE, GOOGLE DRIVE, GMAIL ROUTES
// -----------------------------------------------------------
app.post('/api/youtube/search', async (req, res) => { /* Unchanged */ });
app.get('/api/drive/files', async (req, res) => { /* Unchanged */ });
app.post('/api/gmail/send', async (req, res) => { /* Unchanged */ });

// -----------------------------------------------------------
// ADAPTIVE MULTI-MODEL ROUTES 
// -----------------------------------------------------------

// Route 1 (Single model execution pattern)
app.post('/api/chat', async (req, res, next) => {
    if (req.body.messages && req.body.messages.some(m => m.attachments)) return next(); 
    
    try {
        const { messages, mode } = req.body;
        const userMessages = messages?.filter(m => m.role === 'user') || [];
        const latestUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : 'General inquiry';
        const hasAttachments = messages?.some(m => m.attachments?.length > 0);
        const attachments = hasAttachments ? messages.filter(m => m.attachments?.length > 0).flatMap(m => m.attachments) : [];

        const routeConfig = await evaluateSemanticRoute(latestUserMessage);
        const targetMode = mode === 'chat' ? routeConfig.intent : mode;

        let combinedResults = [];
        if (routeConfig.needsSearch) {
            const dynamicSearchQuery = await synthesizeSearchQuery(messages, latestUserMessage);
            const [tavilyResults, youtubeResults] = await Promise.all([
                fetchTavilySearch(dynamicSearchQuery, 'web', 5),
                fetchYoutubeSearch(dynamicSearchQuery, 5).catch(() => ({ videos: [] }))
            ]);
            combinedResults = [
                ...(tavilyResults.items || []),
                ...(youtubeResults.videos || []).map(v => ({ title: v.title, link: v.url, snippet: v.description, displayLink: new URL(v.url).hostname }))
            ];
        }
        
        const output = await executeSingleModelResponse(latestUserMessage, targetMode, combinedResults, attachments);
        
        // DELIVERY FIX APPLIED HERE
        res.json({ text: formatForDelivery(output) });

    } catch (error) {
        res.status(500).json({ error: 'Multi-model context processing error.' });
    }
});

// Route 2 (Cascading Discussion Chain pattern)
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, mode } = req.body;
        const userMessages = messages?.filter(m => m.role === 'user') || [];
        const latestUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : 'General inquiry';
        const hasAttachments = messages?.some(m => m.attachments?.length > 0);
        const attachments = hasAttachments ? messages.filter(m => m.attachments?.length > 0).flatMap(m => m.attachments) : [];

        const routeConfig = await evaluateSemanticRoute(latestUserMessage);
        const targetMode = mode === 'chat' ? routeConfig.intent : mode;
        let searchItems = [];

        if (routeConfig.needsSearch) {
            const dynamicSearchQuery = await synthesizeSearchQuery(messages, latestUserMessage);
            const searchResults = await fetchTavilySearch(dynamicSearchQuery, 'web', 5);
            searchItems = searchResults.items || [];
        }

        const discussionOutput = await executeDiscussionChain(latestUserMessage, targetMode, searchItems, attachments);
        
        // DELIVERY FIX APPLIED HERE
        res.json({ text: formatForDelivery(discussionOutput) });

    } catch (error) {
        res.status(500).json({ error: 'Discussion context processing error.' });
    }
});

app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    res.json({ isAdmin: email?.toLowerCase() === ADMIN_EMAIL?.toLowerCase() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Active on Port ${PORT}`));
