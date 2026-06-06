const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();

// Set system deployment proxy context values for security modules
app.set('trust proxy', 1);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

// Anti-Spam Security Filter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    standardHeaders: true, 
    legacyHeaders: false, 
    message: { error: "Too many requests from this device. Please try again after 15 minutes." }
});

app.use('/api/', apiLimiter);

app.get('/', (req, res) => res.send('Joes AI Backend Status: Online and Configured.'));

// Configuration Relay Layer for Client Runtime Instantiations
app.get('/api/config', (req, res) => {
    if (!process.env.FIREBASE_API_KEY) {
        return res.status(500).json({ error: "Firebase environment variables are missing on host environment." });
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
 * Prompt Architecture Engineering Layouts Matrix
 */
function getSystemPrompt(mode, searchContext = "") {
    const creatorIdentity = 
        "You are Joes AI, a highly intelligent and custom-designed AI assistant. " +
        "You were developed and are owned entirely by AKRAM JOES TECHNOLOGIES founded by KAIGWA AKRAM the INSPIRED ENGINEER. " +
        "If any user asks you who developed you, who owns you, or who built you, you must answer proudly that you were developed and are owned by AKRAM JOES TECHNOLOGIES founded by KAIGWA AKRAM the INSPIRED ENGINEER. " +
        "Never state that you are developed by Google, Meta, OpenAI, or anyone else. " +
        "IMPORTANT RULES FOR DATA PRESENTATION:\n" +
        "1. NO EXCUSES: Never tell the user 'I cannot provide clickable links' or 'I cannot render images.' You have full capability to do so using Markdown.\n" +
        "2. TABLES: When presenting structured comparative data, lists, or metrics, you MUST format them as clean Markdown tables but they should look smart with right font and formatting no space before content (using standard pipe syntax: | Column | Column |).\n" +
        "3. MERMAID DIAGRAMS: For workflows, simple flowcharts, or system process loops, write visual layout schemas using Mermaid.js syntax inside a code block marked with 'mermaid'.\n" +
        "4. IMAGE RENDERING & GENERATION RULES:\n" +
        "   - When the user asks to see an image, a visual, a diagram, or a photo, you must display it using standard Markdown: ![Alt Text](URL).\n" +
        "   - PRIMARY METHOD (AI Generation / Illustrations): For creative illustrations, concepts, scenes, or objects, use Pollinations AI. Ensure the prompt is descriptive, uses clean words, and separates spaces ONLY with hyphens or %20. Never include brackets or formatting symbols inside the actual URL path string.\n" +
        "     * Use this exact format: ![Visual Description](https://image.pollinations.ai/prompt/detailed-description-of-the-image-here?width=800&height=500&nologo=true)\n" +
        "   - SECONDARY METHOD (Factual Real-Time Photos): If the user specifically demands a real, non-generated photo, check the 'VERIFIED REAL-TIME GOOGLE SEARCH RESULTS' block below.\n" +
        "     * ONLY use a link from the search results if it is a direct image file path ending cleanly in .jpg, .png, or .webp.\n" +
        "     * If no direct image URL is available in the search results, instantly fall back to the Pollinations AI generator method above to keep the visual functional.\n" +
        "5. CLICKABLE CITATIONS: Every factual claim must be followed by a clickable link. Format them strictly as: [Source Name](URL). These links should be placed naturally in the text or as a list of 'References' at the end.\n" +
        "6. EMOJIS: Naturally incorporate high-quality, expressive emojis where appropriate. Keep their usage professional and tasteful." + 
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

const getKoofrBaseUrl = () => {
    const url = process.env.CLOUDSYNC_URL;
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
};

// -----------------------------------------------------------
// DYNAMIC CHAT GENERATION TO PDF STREAM ROUTE
// -----------------------------------------------------------
app.post('/api/chats/download-pdf', (req, res) => {
    const { title, history } = req.body;

    if (!history || !Array.isArray(history)) {
        return res.status(400).json({ error: "Invalid content array payload. 'history' parameter required." });
    }

    try {
        const doc = new PDFDocument({ margin: 50, bufferPages: true });
        const safeTitle = (title || 'joes-ai-chat-export').trim().replace(/[^a-zA-Z0-9]/g, '_');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.pdf"`);

        doc.pipe(res);
        doc.fontSize(22).bold().fillColor('#1a1a1a').text(title || 'Conversation Transcript', { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#777777').text('Generated by Joes AI • Powered by Akram Joes Technologies', { align: 'left' });
        doc.moveDown(1);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').stroke();
        doc.moveDown(1.5);

        history.forEach(msg => {
            const isUser = msg.role === 'user';
            const authorTag = isUser ? 'You' : 'Joes AI';
            const themeColor = isUser ? '#2563eb' : '#059669'; 

            doc.fontSize(11).bold().fillColor(themeColor).text(authorTag);
            doc.moveDown(0.3);

            const contentPayload = msg.content || msg.text || (msg.parts && msg.parts[0]?.text) || '';
            doc.fontSize(10.5).bold(false).fillColor('#374151').text(contentPayload, {
                width: 500,
                align: 'left',
                lineGap: 4
            });

            doc.moveDown(1.8);
        });

        doc.end();
    } catch (err) {
        console.error("PDF generation error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to generate PDF." });
    }
});

// -----------------------------------------------------------
// KOOFR WEBDAV STORAGE ROUTING LOGICS
// -----------------------------------------------------------
app.get('/api/chats', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    const user = process.env.CLOUDSYNC_USER;
    const password = process.env.CLOUDSYNC_PASSWORD;
    const userId = req.headers['x-user-id'] || 'default';
    const isAdminRequest = req.headers['x-is-admin'] === 'true';

    if (!baseUrl || !user || !password) return res.status(400).json({ error: "Cloud Configuration Missing" });

    try {
        const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
        const response = await fetch(baseUrl, {
            method: 'PROPFIND',
            headers: { 'Authorization': authHeader, 'Depth': '1' }
        });
        if (!response.ok) return res.status(response.status).json({ error: "Failed to query files directory from storage provider backend." });

        const xml = await response.text();
        const hrefRegex = /<(?:[^:>]+:)?href>([^<]+)<\/(?:[^:>]+:)?href>/gi;
        let match;
        const files = [];
        const userPrefix = isAdminRequest ? `JoesAI_Chat_` : `JoesAI_Chat_${userId.trim()}__`;

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
    } catch (err) { res.status(500).json({ error: "Sync listing operation failure" }); }
});

app.get('/api/chats/:filename', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    try {
        const authHeader = 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
        const response = await fetch(`${baseUrl}${req.params.filename}`, { headers: { 'Authorization': authHeader }});
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: "Load operation failure" }); }
});

app.post('/api/chats', async (req, res) => {
    const { sessionId, title, history } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const userId = req.headers['x-user-id'] || 'default';
    try {
        const safeTitle = title.trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const filename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
        await fetch(`${baseUrl}${filename}`, {
            method: 'PUT',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, title, history })
        });
        res.json({ success: true, filename });
    } catch (err) { res.status(500).json({ error: "Save operation failure" }); }
});

app.post('/api/chats/rename', async (req, res) => {
    const { oldFilename, sessionId, newTitle } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const userId = req.headers['x-user-id'] || 'default';
    try {
        const safeTitle = newTitle.trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const newFilename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
        await fetch(`${baseUrl}${oldFilename}`, {
            method: 'MOVE',
            headers: { 'Authorization': authHeader, 'Destination': `${baseUrl}${newFilename}` }
        });
        res.json({ success: true, filename: newFilename });
    } catch (err) { res.status(500).json({ error: "Rename operation failure" }); }
});

app.delete('/api/chats/:filename', async (req, res) => {
    try {
        const authHeader = 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
        await fetch(`${getKoofrBaseUrl()}${req.params.filename}`, { method: 'DELETE', headers: { 'Authorization': authHeader }});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Delete operation failure" }); }
});

// -----------------------------------------------------------
// ADAPTIVE GEMINI INFERENCE PROMPT PIPELINE ROUTE
// -----------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType, mode, chatHistory = [] } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });

    try {
        let searchContext = "";
        const searchQuery = message || "latest details";
        const [webMatches, imageMatches] = await Promise.all([
            executeInternalSearch(searchQuery),
            executeInternalSearch(searchQuery, 'image')
        ]);

        if (webMatches.length > 0 || imageMatches.length > 0) {
            searchContext = "\n\n=== VERIFIED RESULTS ===\n" +
                webMatches.slice(0, 3).map((item, i) => `[${i+1}] ${item.title}: ${item.link}`).join('\n') +
                "\n====================\n";
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
        const activeSystemInstruction = getSystemPrompt(mode, searchContext);

        const contents = (chatHistory || []).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content || "Analyzed content." }]
        }));

        const userParts = [{ text: message || "Request details." }];
        if (fileData) userParts.push({ inline_data: { mime_type: mimeType, data: fileData }});
        contents.push({ role: 'user', parts: userParts });

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: activeSystemInstruction }] },
                contents
            })
        });

        const data = await response.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "No AI text extracted.";
        res.json({ text: aiResponse });

    } catch (err) { res.status(500).json({ error: 'Gemini system connection crash' }); }
});

// -----------------------------------------------------------
// NORMALIZED ADAPTIVE GROQ INFERENCE PIPELINE ROUTE
// -----------------------------------------------------------
app.post('/api/chat', async (req, res) => {
    const { messages = [], mode } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq key missing." });

    try {
        const msgList = Array.isArray(messages) ? messages : [];
        const lastUserMsg = msgList.filter(m => m.role === 'user').pop()?.content || "";

        let searchContext = "";
        if (lastUserMsg) {
            const [webMatches] = await Promise.all([executeInternalSearch(lastUserMsg)]);
            if (webMatches.length > 0) {
                searchContext = "\n\n=== GOOGLE SOURCES ===\n" + webMatches.slice(0, 3).map((item, i) => `[${i+1}] ${item.title}: ${item.link}`).join('\n');
            }
        }

        const activeSystemInstruction = getSystemPrompt(mode, searchContext);
        const finalMessages = [
            { role: 'system', content: activeSystemInstruction },
            ...msgList
        ];

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: finalMessages })
        });

        const data = await groqRes.json();
        const chatResponse = data.choices?.[0]?.message?.content || "No Groq text response.";
        res.json({ text: chatResponse });
        
    } catch (error) { 
        console.error('Groq connection failure:', error);
        res.status(500).json({ error: 'Groq connection system error' }); 
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const results = await executeInternalSearch(req.query.query, req.query.searchType);
        res.json(results);
    } catch (err) { res.status(500).json({ error: "Search execution module fault" }); }
});

app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "kaigwaakram123@gmail.com";
    res.json({ isAdmin: email?.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Server Processing Node Active on Port ${PORT}`));
