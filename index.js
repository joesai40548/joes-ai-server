const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

app.get('/', (req, res) => res.send('Joes AI Backend Status: Online and Configured.'));

// -----------------------------------------------------------
// SECURE CONFIG ROUTE: SERVE FIREBASE ENV VARIABLES TO FRONTEND
// -----------------------------------------------------------
app.get('/api/config', (req, res) => {
    if (!process.env.FIREBASE_API_KEY) {
        return res.status(500).json({ error: "Firebase environment variables are missing." });
    }

    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    });
});

/**
 * Core Google Search Engine Middleware Handler (Internal Lookup Engine)
 * Automatically fetches real-world text content and images to enrich AI prompts.
 */
async function executeInternalSearch(query, searchType = '') {
    const API_KEY = process.env.GOOGLE_SEARCH_API_KEY || process.env.Google_Search_API_KEY;
    const CX = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.Google_Search_ENGINE_ID;

    if (!API_KEY || !CX || !query) return [];

    try {
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${API_KEY}&cx=${CX}${searchType === 'image' ? '&searchType=image' : ''}`;
        const response = await fetch(url);
        if (!response.ok) return [];

        const data = await response.json();
        return (data.items || []).map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            image: searchType === 'image' ? item.link : (item.pagemap?.cse_image?.[0]?.src || item.pagemap?.cse_thumbnail?.[0]?.src || '')
        }));
    } catch (err) {
        console.error("Internal background search utility encountered an error:", err);
        return [];
    }
}

/**
 * Custom Adaptive System Prompt Constructor
 * Hardcodes Creator Identity, forces clean Markdown tables, high-quality clickable citations, 
 * and blends automated live Google Search references directly into current AI visibility.
 */
function getSystemPrompt(mode, searchContext = "") {
    const creatorIdentity = 
        "You are Joes AI, a highly intelligent and custom-designed AI assistant. " +
        "You were developed and are owned entirely by AKRAM JOES TECHNOLOGIES  and founded by KAIGWA AKRAM. " +
        "If any user asks you who developed you, who owns you, or who built you, you must answer proudly that you were developed and are owned by AKRAM JOES TECHNOLOGIES founded by KAIGWA AKRAM the INSPIRED ENGINEER. " +
        "Never state that you are developed by Google, Meta, OpenAI, or anyone else. " +
        "IMPORTANT RULES FOR DATA PRESENTATION:\n" +
        "1. REAL-WORLD EXAMPLES & FACTUAL BREAKDOWNS (DISEASES, TECHNICAL SYSTEMS, ETC):\n" +
        "   - When explaining complex real-world conditions, illnesses, scientific principles, or historical milestones, you MUST use real data from the search context below.\n" +
        "   - Break information down with structured subsections: Overview, Symptoms/Characteristics, Diagnostic Data/Metrics, and Visual References.\n" +
        "2. TABLES & DATA LAYOUTS: When presenting structured statistical comparisons, lists, timelines, or diagnostic parameters, you MUST format them as clean Markdown tables using standard pipe syntax: | Column | Column |. Ensure there is no trailing white space before the pipes.\n" +
        "3. MERMAID DIAGRAMS: For workflows, anatomy flows, biological processes, or system engineering cycles, write clear operational schema maps using Mermaid.js syntax inside a code block marked with 'mermaid'.\n" +
        "4. REAL IMAGES, DIAGRAMS & PHOTOS:\n" +
        "   - You MUST extract verified URLs from the 'VERIFIED REAL IMAGE & DIAGRAM URLs' search section below when explaining concrete factual concepts (like a disease anatomy, a medical condition diagram, a mechanical machine component, or geographical views).\n" +
        "   - Render them exactly as a Markdown link: ![Detailed Descriptive Asset Label](Direct Image URL). Never inject loose web URLs or broken links outside a markdown container.\n" +
        "   - FALLBACK RULES (For abstract/creative concepts): Only if the user explicitly requests an artistic illustration, a custom sketch, or if the search parameters provide no functional image links, fall back to the Pollinations engine exactly as: ![Asset Illustration](https://image.pollinations.ai/prompt/[Encoded-Prompt-Text]?width=600&height=400&nologo=true) replacing spaces with %20.\n" +
        "5. SPECIFIC CITATIONS: Accompany factual claims, statistics, and examples with clear hyperlinked annotations sourced directly from the web links provided below. Format them cleanly as: [Reference Source Name](URL).\n" +
        "6. EMOJIS: Use premium, contextually helpful emojis naturally. Maintain an authoritative yet engaging tone based on the mode without spamming or overusing graphics." + 
        searchContext;

    switch(mode) {
        case 'code':
            return `${creatorIdentity} You are currently operating in CODE MODE. Act as a senior programmer. Provide highly-optimized, production-ready, clean, and properly structured programming source code. Add descriptive inline comments. Minimize unrelated conversational chatter. Use emojis extremely rarely here.`;
        case 'learn':
            return `${creatorIdentity} You are currently operating in LEARN MODE. Act as an academic guide and expert advisor. Provide deeply educational, clear explanations for concepts, answer multiple-choice questions by showing the exact logical reasoning step-by-step, and break down complex ideas using helpful terminology.`;
        case 'study':
            return `${creatorIdentity} You are currently operating in STUDY MODE. Act as an empathetic academic tutor. Break down complex subjects using structured step-by-step concepts, real-life analogies, and bullet points. Always close by presenting 2 brief quiz questions.`;
        case 'chat':
        default:
            return `${creatorIdentity} You are currently operating in CHAT MODE. Be friendly, energetic, and engaging. Keep responses conversational, and use expressive emojis naturally and selectively where appropriate.`;
    }
}

// Helper to handle base URLs safely
const getKoofrBaseUrl = () => {
    const url = process.env.CLOUDSYNC_URL;
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
};

// -----------------------------------------------------------
// KOOFR WEBDAV ROUTE: LIST ALL SAVED CHAT SESSIONS (User-Isolated)
// -----------------------------------------------------------
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
        
        const userPrefix = isAdminRequest ? `JoesAI_Chat_` : `JoesAI_Chat_${userId.trim()}__`;

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
// KOOFR WEBDAV ROUTE: SAVE/UPDATE CHAT FILE (User-Isolated)
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
// ADAPTIVE GEMINI ROUTE (With Injected Context Search Automation)
// -----------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType, mode, chatHistory } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server: GEMINI_API_KEY is missing on Render settings.' });
    }

    try {
        let searchContext = "";
        try {
            const searchQuery = message || "latest details";
            const [webMatches, imageMatches] = await Promise.all([
                executeInternalSearch(searchQuery),
                executeInternalSearch(searchQuery, 'image')
            ]);

            if (webMatches.length > 0 || imageMatches.length > 0) {
                searchContext = "\n\n\n=== VERIFIED REAL-TIME GOOGLE SEARCH RESULTS ===\n" +
                                "The following blocks contain authenticated live elements matching the request. Read from these items to deliver accurate responses, hyperlinked references, and real structural image URLs.\n\n" +
                                "--- VERIFIED WEB LINKS & CITATION REFS ---\n";
                webMatches.slice(0, 5).forEach((item, i) => {
                    searchContext += `[Source ${i+1}]:\nTitle: ${item.title}\nURL: ${item.link}\nSummary: ${item.snippet}\n\n`;
                });

                searchContext += "--- VERIFIED REAL IMAGE & DIAGRAM URLs ---\n";
                imageMatches.slice(0, 5).forEach((item, i) => {
                    searchContext += `[Image Source ${i+1}]:\nLabel: ${item.title}\nDirect Image URL: ${item.link}\n\n`;
                });
                searchContext += "================================================\n";
            }
        } catch (searchErr) {
            console.error("Background search intercept error:", searchErr);
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
        const activeSystemInstruction = getSystemPrompt(mode, searchContext);

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
// NORMALIZED ADAPTIVE GROQ ROUTE (With Injected Context Search Automation)
// -----------------------------------------------------------
app.post('/api/chat', async (req, res) => {
    const { messages, mode } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "Server: Groq credentials missing." });
    }

    try {
        const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || "";

        let searchContext = "";
        if (lastUserMsg) {
            try {
                const [webMatches, imageMatches] = await Promise.all([
                    executeInternalSearch(lastUserMsg),
                    executeInternalSearch(lastUserMsg, 'image')
                ]);

                if (webMatches.length > 0 || imageMatches.length > 0) {
                    searchContext = "\n\n\n=== VERIFIED REAL-TIME GOOGLE SEARCH RESULTS ===\n" +
                                    "The following blocks contain authenticated live elements matching the request. Read from these items to deliver accurate responses, hyperlinked references, and real structural image URLs.\n\n" +
                                    "--- VERIFIED WEB LINKS & CITATION REFS ---\n";
                    webMatches.slice(0, 5).forEach((item, i) => {
                        searchContext += `[Source ${i+1}]:\nTitle: ${item.title}\nURL: ${item.link}\nSummary: ${item.snippet}\n\n`;
                    });

                    searchContext += "--- VERIFIED REAL IMAGE & DIAGRAM URLs ---\n";
                    imageMatches.slice(0, 5).forEach((item, i) => {
                        searchContext += `[Image Source ${i+1}]:\nLabel: ${item.title}\nDirect Image URL: ${item.link}\n\n`;
                    });
                    searchContext += "================================================\n";
                }
            } catch (searchErr) {
                console.error("Background search intercept error inside Groq thread:", searchErr);
            }
        }

        const activeSystemInstruction = getSystemPrompt(mode, searchContext);
        const finalMessages = [
            { role: 'system', content: activeSystemInstruction },
            ...messages
        ];

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${GROQ_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                model: 'llama-3.1-8b-instant', 
                messages: finalMessages 
            })
        });

        const data = await groqRes.json();
        
        if (!groqRes.ok) {
            return res.status(groqRes.status).json({ error: data.error?.message || "Groq request failed." });
        }

        const chatResponse = data.choices?.[0]?.message?.content || "Unable to extract response.";
        res.json({ text: chatResponse });
        
    } catch (error) { 
        console.error('Groq handling failed:', error);
        res.status(500).json({ error: 'Groq API backend failure' }); 
    }
});

// -----------------------------------------------------------
// GOOGLE SEARCH ROUTE: FETCH IMAGES AND LINKS FOR DIRECT APP ENDPOINTS
// -----------------------------------------------------------
app.get('/api/search', async (req, res) => {
    const { query, searchType } = req.query; 
    
    const API_KEY = process.env.GOOGLE_SEARCH_API_KEY || process.env.Google_Search_API_KEY;
    const CX = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.Google_Search_ENGINE_ID;

    if (!API_KEY || !CX) {
        return res.status(500).json({ error: "Google Search credentials missing." });
    }

    try {
        const results = await executeInternalSearch(query, searchType);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch Google Search results." });
    }
});

// -----------------------------------------------------------
// ADMIN ACCOUNT SECURE CHECK ENTRY
// -----------------------------------------------------------
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "kaigwaakram123@gmail.com";
    res.json({ isAdmin: email?.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Active on Port ${PORT}`));
