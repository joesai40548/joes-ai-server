const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname)));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Custom Adaptive System Prompt Constructor
 * Hardcodes Joes AI / AKRAM JOES TECHNOLOGIES identity, structures tables, and
 * commands the AI to output hand-drawn visual diagrams (Mermaid) and stable educational references.
 */
function getSystemPrompt(mode) {
    const creatorIdentity = 
        "You are Joes AI, a highly intelligent and custom-designed AI assistant. " +
        "You were developed and are owned entirely by AKRAM JOES TECHNOLOGIES. " +
        "If any user asks you who developed you, who owns you, or who built you, you must answer proudly that you were developed and are owned by AKRAM JOES TECHNOLOGIES. " +
        "Never state that you are developed by Google, Meta, OpenAI, or anyone else. " +
        "IMPORTANT RULES FOR DATA PRESENTATION:\n" +
        "1. TABLES: When presenting structured comparative data, comparative lists, or metrics, you MUST format them as clean Markdown tables (using standard pipe syntax: | Column | Column |).\n" +
        "2. SKETCHED ILLUSTRATIONS & DIAGRAMS: When explaining workflows, architectures, software systems, or processes, you are required to generate beautiful, hand-drawn style flowcharts, sequence layouts, or mindmaps using google search api key and get real urls and first inspect them before delivering the content to ensure accuracy .\n" +
        "3. CITATIONS, STABLE IMAGES & REFERENCES: In your explanations, actively include inline functional images or real academic diagrams using standard markdown clickable links: ![Alt text](image_url) or [Reference Name](URL). Use highly reliable, public domains like Unsplash (using descriptive keywords for photos, e.g. https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=600) or Wikimedia for rich educational context illustrations or anyother source but dont provide pornographic content.\n" +
        "4. EMOJIS: Use high-quality, expressive emojis that are contextually relevant and professional. Select emojis that enhance understanding and visual appeal. Avoid generic or overused emoji combinations.";

    switch(mode) {
        case 'code':
            return `${creatorIdentity} You are CODE MODE - a senior software architect & debugging expert. Provide production-grade code with inline documentation, error handling, and best practices. Use emojis sparingly and only for technical context (e.g. 💻 for code, ⚙️ for configuration, ✅ for success, ❌ for error). Focus on efficiency, scalability, and clean architecture. Respond with technical precision.`;
        case 'study':
            return `${creatorIdentity} You are STUDY MODE - an empathetic academic tutor. Break down complex subjects using structured step-by-step concepts, real-life analogies, and bullet points. Include relevant educational emojis (📚 for study, ✨ for insight, 🎓 for knowledge, ❓ for questions, 🔍 for research, 🧠 for learning). Always close by presenting 10 brief quiz questions incase of simple questions and complicated questions for detailed questions. Focus on learning outcomes.`;
        case 'chat':
        default:
            return `${creatorIdentity} You are CHAT MODE - a friendly, energetic AI companion. Be conversational and warm. Use expressive emojis naturally to enhance emotional tone: 😊 for friendliness, 💡 for ideas, 🎉 for celebration, 🤔 for curiosity, 👋 for greetings, ✨ for excitement. Keep responses lively and interactive. Focus on building rapport.`;
    }
}


const KEYS = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    google: process.env.GOOGLE_SEARCH_API_KEY,
    cx: process.env.GOOGLE_SEARCH_ENGINE_ID
};

// Model Configuration for Multi-System AI Consultation
const MODELS = {
    chat: { 
        primary: 'llama-3.3-70b-versatile', 
        deliverer: 'gemini-2.0-flash-lite',
        openrouterModel: 'openrouter/free'
    },
    code: { 
        primary: 'llama-3.3-70b-specdec', 
        deliverer: 'gemini-2.0-flash',
        openrouterModel: 'openrouter/free'
    },
    study: { 
        primary: 'llama-3.3-70b-versatile', 
        deliverer: 'gemini-2.5-pro-latest',
        openrouterModel: 'openrouter/free'
    }
};

async function fetchGoogleSearch(query, searchType = 'web', count = 5) {
    if (!KEYS.google || !KEYS.cx) {
        return { query, searchType, count: 0, items: [] };
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        const maxResults = Math.min(Math.max(count, 1), 10);
        
        let searchUrl;
        if (searchType === 'images') {
            searchUrl = `https://www.googleapis.com/customsearch/v1?key=${KEYS.google}&cx=${KEYS.cx}&q=${encodedQuery}&searchType=image&num=${maxResults}`;
        } else {
            searchUrl = `https://www.googleapis.com/customsearch/v1?key=${KEYS.google}&cx=${KEYS.cx}&q=${encodedQuery}&num=${maxResults}`;
        }

        const response = await fetch(searchUrl);
        const data = await response.json();

        if (!response.ok) {
            console.error('Google Search API Error:', data);
            return { query, searchType, count: 0, items: [] };
        }

        return {
            query,
            searchType,
            count: data.items?.length || 0,
            items: data.items?.map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                displayLink: item.displayLink
            })) || []
        };
    } catch (err) {
        console.error('Google Search handling failed:', err);
        return { query, searchType, count: 0, items: [] };
    }
}

async function primaryModelResponse(message, mode, context, searchResults) {
    const model = MODELS[mode];
    const systemPrompt = getSystemPrompt(mode);
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KEYS.openrouter}`
            },
            body: JSON.stringify({
                model: model.primary,
                messages: [{
                    role: 'system',
                    content: `${systemPrompt}\n\nGoogle Search Context:\n${JSON.stringify(searchResults, null, 2)}`
                }, {
                    role: 'user',
                    content: `Primary analysis for: ${message}\nMode context: ${mode}\nContext: ${context}`
                }]
            })
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(`Primary model error: ${data.error.message}`);
        }
        
        return data.choices[0].message.content;
    } catch (err) {
        console.error('Primary model failed:', err);
        return "Primary model encountered an error.";
    }
}

async function delivererModelResponse(primaryResponse, message, mode, context) {
    const model = MODELS[mode];
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KEYS.openrouter}`
            },
            body: JSON.stringify({
                model: model.deliverer,
                messages: [{
                    role: 'system',
                    content: `You are a deliverer AI. Your task is to analyze, enhance, and provide feedback on the primary model's response. You must identify strengths, weaknesses, and suggest improvements.`
                }, {
                    role: 'user',
                    content: `Original message: ${message}\nMode: ${mode}\nPrimary response: ${primaryResponse}\nContext: ${context}`
                }]
            })
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(`Deliverer model error: ${data.error.message}`);
        }
        
        return data.choices[0].message.content;
    } catch (err) {
        console.error('Deliverer model failed:', err);
        return "Deliverer model encountered an error.";
    }
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
                model: MODELS[mode].openrouterModel,
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

// Helper to handle base URLs safely
const getKoofrBaseUrl = () => {
    const url = process.env.CLOUDSYNC_URL;
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
};

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

    if (!baseUrl || !user || !password) {
        return res.status(400).json({ error: "Cloud Config Missing: Set CLOUDSYNC variables on Render." });
    }

    try {
        const safeTitle = newTitle.trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const newFilename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

        const response = await fetch(`${baseUrl}${oldFilename}`, {
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
        
        // Push raw visual asset data only if present
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
// ADAPTIVE MULTI-MODEL ROUTE (Chat Mode)
// -----------------------------------------------------------
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, mode } = req.body;
        const searchQuery = messages?.slice(-6).map(m => m.content).join(' ') || 'General inquiry';
        
        // Get relevant search results
        const searchResults = await fetchGoogleSearch(searchQuery, 'web', 5);
        
        // Primary model response with search context
        let primaryResponse = '';
        if (mode && MODELS[mode]) {
            primaryResponse = await primaryModelResponse(
                searchQuery, 
                mode, 
                searchResults.count > 0 ? searchResults.items[0]?.snippet || '' : '', 
                JSON.stringify(searchResults.items)
            );
        } else {
            // Fallback to direct query
            const directResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${KEYS.openrouter}`
                },
                body: JSON.stringify({
                    model: MODELS.chat.primary,
                    messages: [{ role: 'user', content: searchQuery }]
                })
            });
            const directData = await directResponse.json();
            primaryResponse = directData.choices?.[0]?.message?.content || '';
        }
        
        // Deliverer final response
        const finalResponse = await delivererModelResponse(
            primaryResponse, 
            searchQuery, 
            mode,
            JSON.stringify(searchResults.items)
        );
        
        // Normalized JSON format exactly matching Gemini endpoint { text: response }
        res.json({ text: finalResponse });
        
    } catch (error) {
        console.error('Adaptive multi-model failed:', error);
        res.status(500).json({ error: 'Multi-model processing failed' });
    }
});

app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    res.json({ isAdmin: email?.toLowerCase() === ADMIN_EMAIL?.toLowerCase() });
});

// -----------------------------------------------------------
// GOOGLE CUSTOM SEARCH ROUTE
// -----------------------------------------------------------
app.post('/api/google-search', async (req, res) => {
    const { query, searchType = 'web', count = 10 } = req.body;
    const API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
    const ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!API_KEY || !ENGINE_ID) {
        return res.status(500).json({ error: 'Server: Google Search API credentials missing.' });
    }

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Search query is required and must be a string.' });
    }

    try {
        let searchUrl;
        const encodedQuery = encodeURIComponent(query);
        const maxResults = Math.min(Math.max(count, 1), 10); // Limit between 1-10 results

        if (searchType === 'images') {
            searchUrl = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${ENGINE_ID}&q=${encodedQuery}&searchType=image&num=${maxResults}`;
        } else if (searchType === 'files') {
            searchUrl = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${ENGINE_ID}&q=${encodedQuery} filetype:pdf|doc|docx|ppt|pptx&num=${maxResults}`;
        } else {
            searchUrl = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${ENGINE_ID}&q=${encodedQuery}&num=${maxResults}`;
        }

        const response = await fetch(searchUrl);
        const data = await response.json();

        if (!response.ok) {
            console.error('Google Search API Error:', data);
            return res.status(response.status).json({ 
                error: data.error?.message || 'Google Search API request failed.' 
            });
        }

        const results = {
            query,
            searchType,
            count: data.items?.length || 0,
            items: data.items?.map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                displayLink: item.displayLink,
                image: searchType === 'images' ? {
                    url: item.link,
                    thumbnail: item.image?.thumbnailLink,
                    width: item.image?.width,
                    height: item.image?.height
                } : null,
                file: searchType === 'files' ? {
                    format: item.mime || 'unknown',
                    size: item.fileSize || 'unknown'
                } : null,
                formattedUrl: item.formattedUrl,
                pagemap: item.pagemap
            })) || []
        };

        res.json(results);

    } catch (err) {
        console.error('Google Search handling failed:', err);
        res.status(500).json({ error: 'Google Search backend failure' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Active on Port ${PORT}`));
