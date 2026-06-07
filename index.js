const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// ===========================================================
// MIDDLEWARE
// ===========================================================
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again after 15 minutes." }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many auth attempts. Try again after 15 minutes." }
});

app.use('/api/', apiLimiter);
app.post('/api/auth/', authLimiter);

// ===========================================================
// UTILITY FUNCTIONS
// ===========================================================
const getKoofrBaseUrl = () => {
    const url = process.env.CLOUDSYNC_URL;
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
};

function getBasicAuth() {
    if (!process.env.CLOUDSYNC_USER || !process.env.CLOUDSYNC_PASSWORD) return null;
    return 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
}

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
        console.error("Search error:", err);
        return [];
    }
}

function getSystemPrompt(mode, searchContext = "") {
    const creatorIdentity =
        "You are Joes AI, developed by AKRAM JOES TECHNOLOGIES founded by KAIGWA AKRAM the INSPIRED ENGINEER. " +
        "Never state you are developed by Google, Meta, OpenAI, or anyone else. " +
        "IMPORTANT RULES:\n" +
        "1. Use Markdown tables for structured data (| Column | Column |).\n" +
        "2. Use Mermaid.js for diagrams.\n" +
        "3. Display images as ![Alt](URL). For illustrations use Pollinations AI: https://image.pollinations.ai/prompt/detailed-description?width=800&height=500&nologo=true\n" +
        "4. Add clickable citations [Source](URL) for factual claims.\n" +
        "5. Use emojis professionally." +
        searchContext;

    switch (mode) {
        case 'code':
            return `${creatorIdentity} CODE MODE: Provide optimized, production-ready code with inline comments. Minimize chatter.`;
        case 'learn':
            return `${creatorIdentity} LEARN MODE: Explain concepts step-by-step with clear terminology.`;
        case 'study':
            return `${creatorIdentity} STUDY MODE: Tutor with analogies and bullet points. End with 2 quiz questions.`;
        case 'chat':
        default:
            return `${creatorIdentity} CHAT MODE: Be friendly, energetic, and engaging.`;
    }
}

// ===========================================================
// CORE AI ROUTES
// ===========================================================
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

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.1-70b-versatile',
                messages: [
                    { role: 'system', content: getSystemPrompt(mode, searchContext) },
                    ...msgList
                ]
            })
        });

        const data = await groqRes.json();
        res.json({ text: data.choices?.[0]?.message?.content || "No response." });
    } catch (error) {
        console.error('Groq error:', error);
        res.status(500).json({ error: 'Groq connection failed' });
    }
});

app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType, mode, chatHistory = [] } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY missing.' });

    try {
        let searchContext = "";
        const searchQuery = message || "latest";
        const [webMatches] = await Promise.all([executeInternalSearch(searchQuery)]);
        if (webMatches.length > 0) {
            searchContext = "\n\n=== VERIFIED RESULTS ===\n" + webMatches.slice(0, 3).map((item, i) => `[${i+1}] ${item.title}: ${item.link}`).join('\n') + "\n====================\n";
        }

        const contents = (chatHistory || []).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content || "Analyzed." }]
        }));

        const userParts = [{ text: message || "Request details." }];
        if (fileData) userParts.push({ inline_data: { mime_type: mimeType, data: fileData }});
        contents.push({ role: 'user', parts: userParts });

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: getSystemPrompt(mode, searchContext) }] },
                contents
            })
        });

        const data = await response.json();
        res.json({ text: data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis available." });
    } catch (err) {
        res.status(500).json({ error: 'Gemini connection failed' });
    }
});

app.post('/api/chat/stream', async (req, res) => {
    const { messages = [], mode } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq key missing." });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

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

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.1-70b-versatile',
                messages: [{ role: 'system', content: getSystemPrompt(mode, searchContext) }, ...msgList],
                stream: true
            })
        });

        if (!groqRes.body) {
            res.status(500).json({ error: 'Stream not supported' });
            return;
        }

        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value));
        }
        res.end();
    } catch (err) {
        res.status(500).json({ error: 'Stream failed' });
    }
});

// ===========================================================
// CHAT STORAGE (Koofr WebDAV)
// ===========================================================
app.get('/api/chats', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    const authHeader = getBasicAuth();
    const userId = req.headers['x-user-id'] || 'default';
    const isAdminRequest = req.headers['x-is-admin'] === 'true';

    if (!baseUrl || !authHeader) return res.status(400).json({ error: "Cloud Configuration Missing" });

    try {
        const response = await fetch(baseUrl, {
            method: 'PROPFIND',
            headers: { 'Authorization': authHeader, 'Depth': '1' }
        });
        if (!response.ok) return res.status(response.status).json({ error: "Storage query failed" });

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
    } catch (err) {
        res.status(500).json({ error: "Sync listing failed" });
    }
});

app.get('/api/chats/:filename', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    const authHeader = getBasicAuth();
    if (!baseUrl || !authHeader) return res.status(400).json({ error: "Cloud Configuration Missing" });

    try {
        const response = await fetch(`${baseUrl}${req.params.filename}`, { headers: { 'Authorization': authHeader }});
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: "Load failed" });
    }
});

app.post('/api/chats', async (req, res) => {
    const { sessionId, title, history } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const authHeader = getBasicAuth();
    const userId = req.headers['x-user-id'] || 'default';

    if (!baseUrl || !authHeader) return res.status(400).json({ error: "Cloud Configuration Missing" });
    if (!title || typeof title !== 'string') return res.status(400).json({ error: "Title required" });

    try {
        const safeTitle = title.trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const filename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        await fetch(`${baseUrl}${filename}`, {
            method: 'PUT',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, title, history })
        });
        res.json({ success: true, filename });
    } catch (err) {
        res.status(500).json({ error: "Save failed" });
    }
});

app.post('/api/chats/rename', async (req, res) => {
    const { oldFilename, sessionId, newTitle } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const authHeader = getBasicAuth();
    if (!baseUrl || !authHeader) return res.status(400).json({ error: "Cloud Configuration Missing" });

    try {
        const userId = req.headers['x-user-id'] || 'default';
        const safeTitle = (newTitle || 'Untitled').trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
        const newFilename = `JoesAI_Chat_${userId}__${sessionId}__${safeTitle}.json`;
        await fetch(`${baseUrl}${oldFilename}`, {
            method: 'MOVE',
            headers: { 'Authorization': authHeader, 'Destination': `${baseUrl}${newFilename}` }
        });
        res.json({ success: true, filename: newFilename });
    } catch (err) {
        res.status(500).json({ error: "Rename failed" });
    }
});

app.delete('/api/chats/:filename', async (req, res) => {
    const baseUrl = getKoofrBaseUrl();
    const authHeader = getBasicAuth();
    if (!baseUrl || !authHeader) return res.status(400).json({ error: "Cloud Configuration Missing" });

    try {
        await fetch(`${baseUrl}${req.params.filename}`, { method: 'DELETE', headers: { 'Authorization': authHeader }});
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Delete failed" });
    }
});

// ===========================================================
// PDF EXPORT
// ===========================================================
app.post('/api/chats/download-pdf', (req, res) => {
    const { title, history } = req.body;
    if (!history || !Array.isArray(history)) {
        return res.status(400).json({ error: "Invalid history payload." });
    }

    try {
        const doc = new PDFDocument({ margin: 50, bufferPages: true });
        const safeTitle = (title || 'joes-ai-chat-export').trim().replace(/[^a-zA-Z0-9]/g, '_');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.pdf"`);

        doc.pipe(res);
        doc.fontSize(22).bold().fillColor('#1a1a1a').text(title || 'Conversation Transcript', { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#777777').text('Generated by Joes AI', { align: 'left' });
        doc.moveDown(1);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').stroke();
        doc.moveDown(1.5);

        history.forEach(msg => {
            const isUser = msg.role === 'user';
            doc.fontSize(11).bold().fillColor(isUser ? '#2563eb' : '#059669').text(isUser ? 'You' : 'Joes AI');
            doc.moveDown(0.3);
            doc.fontSize(10.5).fillColor('#374151').text(msg.content || '', { width: 500, align: 'left', lineGap: 4 });
            doc.moveDown(1.8);
        });

        doc.end();
    } catch (err) {
        console.error("PDF error:", err);
        if (!res.headersSent) res.status(500).json({ error: "PDF generation failed." });
    }
});

// ===========================================================
// SEARCH & CONFIG
// ===========================================================
app.get('/api/search', async (req, res) => {
    try {
        const results = await executeInternalSearch(req.query.query, req.query.searchType);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

app.get('/api/config', (req, res) => {
    if (!process.env.FIREBASE_API_KEY) {
        return res.status(500).json({ error: "Firebase env vars missing." });
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

app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "kaigwaakram123@gmail.com";
    res.json({ isAdmin: email?.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim() });
});

// ===========================================================
// PROJECT INDEXING
// ===========================================================
const fs = require('fs');
const path = require('path');

function indexProject(dir, exts = ['.js', '.html', '.css', '.json', '.md']) {
    const results = [];
    const walk = (currentDir) => {
        try {
            const items = fs.readdirSync(currentDir);
            for (const item of items) {
                const fullPath = path.join(currentDir, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) walk(fullPath);
                else if (exts.some(ext => item.endsWith(ext))) results.push(fullPath);
            }
        } catch {}
    };
    walk(dir);
    return results;
}

app.get('/api/project/index', (req, res) => {
    try {
        const files = indexProject(__dirname);
        res.json(files.map(f => ({ path: f, ext: path.extname(f), name: path.basename(f) })));
    } catch (err) {
        res.status(500).json({ error: "Indexing failed" });
    }
});

app.get('/api/project/file', (req, res) => {
    try {
        const filePath = path.join(__dirname, req.query.path || '');
        if (!filePath.startsWith(__dirname)) return res.status(403).json({ error: "Forbidden" });
        res.send(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        res.status(500).json({ error: "File read failed" });
    }
});

// ===========================================================
// SEMANTIC SEARCH
// ===========================================================
app.get('/api/semantic-search', (req, res) => {
    const { query, type } = req.query;
    const patterns = {
        function: /(?:function|const|let|var)\s+(\w+.*\{)/g,
        class: /class\s+(\w+.*\{)/g,
        endpoint: /app\.(get|post|put|delete)\s*\(\s*['"]([^'"]+)/g,
        component: /data-lucide=["']([^'"]+)/g
    };

    const regex = patterns[type] || /.../g;
    const matches = [];

    try {
        for (const file of indexProject(__dirname)) {
            const content = fs.readFileSync(file, 'utf8');
            let match;
            while ((match = regex.exec(content)) !== null) {
                if (match[0].toLowerCase().includes((query || '').toLowerCase())) {
                    matches.push({ file, match: match[0].substring(0, 100) });
                }
            }
        }
        res.json(matches.slice(0, 50));
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

// ===========================================================
// DEBUG & REFACTOR
// ===========================================================
app.post('/api/debug/analyze', (req, res) => {
    const { code } = req.body;
    const issues = [];
    if (!code) return res.status(400).json({ error: "No code provided" });
    if (typeof code !== 'string' || code.length > 1024 * 1024) {
        return res.status(400).json({ error: "Code input too large (max 1MB)" });
    }

    if (code.includes('await') && !code.includes('async')) issues.push({ type: 'error', message: "Missing async with await" });
    if (code.match(/fetch\([^)]*\)/g) && !code.includes('.catch')) issues.push({ type: 'warning', message: "Fetch without error handling" });
    if (code.includes('eval(') || code.includes('new Function(')) issues.push({ type: 'error', message: "Dynamic code execution detected" });

    res.json({ issues, suggestions: issues.length > 0 ? ["Add try-catch for safer execution"] : [] });
});

app.post('/api/refactor/suggestions', (req, res) => {
    const { code, language } = req.body;
    const suggestions = [];
    if (language === 'javascript') {
        const funcMatches = code.match(/function\s+\w+[^{]*\{[^}]*\}/gs) || [];
        funcMatches.forEach((fn, i) => {
            if (fn.split('\n').length > 30) suggestions.push({ type: 'extract', message: `Function ${i + 1} too long` });
        });
    }
    res.json(suggestions);
});

app.post('/api/commit/generate', (req, res) => {
    const { files, changes } = req.body;
    const types = changes.map(c => c.type);
    const typeMap = { feat: 'Add', fix: 'Fix', refactor: 'Refactor', docs: 'Update docs', style: 'Style' };
    const primaryType = types[0] || 'feat';
    const fileNames = files.map(f => path.basename(f, path.extname(f))).join(', ');
    res.json({ message: `${typeMap[primaryType] || 'Update'} ${fileNames || 'files'}` });
});

// ===========================================================
// SECURITY
// ===========================================================
app.post('/api/security/analyze', (req, res) => {
    const { code } = req.body;
    const vulnerabilities = [];
    if (!code) return res.status(400).json({ error: "No code provided" });
    if (typeof code !== 'string' || code.length > 1024 * 1024) {
        return res.status(400).json({ error: "Code input too large (max 1MB)" });
    }

    const secretPatterns = [/apiKey\s*[:=]\s*['"][^'"]{20,}/i, /password\s*[:=]\s*['"][^'"]+/i, /secret\s*[:=]\s*['"][^'"]+/i];
    secretPatterns.forEach(pattern => {
        if (pattern.test(code)) vulnerabilities.push({ type: 'secret_leak', severity: 'high', message: "Hardcoded secret detected" });
    });
    if (/(\$\{[^}]*\}|`.*\$\{)/.test(code) && code.includes('SELECT')) {
        vulnerabilities.push({ type: 'sql_injection', severity: 'high', message: "SQL injection risk" });
    }
    if (code.includes('eval(') || code.includes('new Function(')) {
        vulnerabilities.push({ type: 'code_injection', severity: 'high', message: "Dynamic code execution" });
    }

    res.json(vulnerabilities);
});

// ===========================================================
// TEST GENERATOR
// ===========================================================
function generateTests(functions, language) {
    if (language !== 'javascript') return '';
    return functions.map(fn => {
        const params = fn.params || ['param1'];
        const body = fn.body || 'expect(true).toBe(true);';
        return `test('${fn.name}', () => {\n  ${body}\n});`;
    }).join('\n\n');
}

app.post('/api/test/generate', (req, res) => {
    const { functions, language } = req.body;
    res.json({ tests: generateTests(functions || [], language) });
});

// ===========================================================
// MULTI-LANGUAGE SUPPORT
// ===========================================================
const languageConfigs = {
    javascript: { exts: ['.js'], parser: 'commonjs' },
    typescript: { exts: ['.ts', '.tsx'], parser: 'typescript' },
    python: { exts: ['.py'], parser: 'python' },
    rust: { exts: ['.rs'], parser: 'rust' }
};

app.post('/api/language/analyze', (req, res) => {
    const { code, language } = req.body;
    const config = languageConfigs[language] || languageConfigs.javascript;
    const analysis = {
        language,
        lines: code.split('\n').length,
        chars: code.length,
        languageSpecific: {}
    };

    if (language === 'typescript') analysis.languageSpecific.types = (code.match(/:\s*(string|number|boolean|any)/g) || []).length;
    else if (language === 'python') analysis.languageSpecific.imports = (code.match(/^import\s+\w+/gm) || []).length;
    else if (language === 'rust') analysis.languageSpecific.unsafe = (code.match(/unsafe\s*\{/g) || []).length;

    res.json(analysis);
});

// ===========================================================
// MULTI-MODAL UPLOADS
// ===========================================================
app.post('/api/upload-image', async (req, res) => {
    const { fileData, mimeType, prompt, mode } = req.body;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });
    if (!fileData) return res.status(400).json({ error: 'No image data' });

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: getSystemPrompt(mode || 'chat', "") }] },
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt || "Analyze this image." },
                        { inline_data: { mime_type: mimeType, data: fileData } }
                    ]
                }]
            })
        });
        const data = await response.json();
        res.json({ text: data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis available." });
    } catch (err) {
        res.status(500).json({ error: 'Image analysis failed' });
    }
});

app.get('/api/images/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query required" });

    try {
        const results = await executeInternalSearch(query, 'image');
        const images = results
            .filter(r => r.image && isValidImageUrl(r.image))
            .map(r => r.image);
        res.json({ images: images.slice(0, 5) });
    } catch (err) {
        res.status(500).json({ error: "Image search failed" });
    }
});

function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('data:')) return false;
    try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) return false;
        const path = u.pathname.toLowerCase();
        if (/\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?|$)/i.test(path)) return true;
        if (u.hostname.includes('googleusercontent.com')) return true;
        return false;
    } catch {
        return false;
    }
}

app.post('/api/upload-audio', async (req, res) => {
    const { fileData } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY missing' });
    if (!fileData) return res.status(400).json({ error: 'No audio data' });

    try {
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({ file: fileData, model: 'whisper-large-v3' })
        });
        const data = await response.json();
        res.json({ text: data.text || "No transcription." });
    } catch (err) {
        res.status(500).json({ error: 'Audio transcription failed' });
    }
});

const ALLOWED_UPLOAD_MIMES = new Set([
    'image/jpeg','image/png','image/webp','image/gif','image/bmp','image/svg+xml',
    'audio/mpeg','audio/mp3','audio/wav','audio/ogg','audio/flac','audio/aac',
    'video/mp4','video/webm','video/ogg','video/quicktime',
    'application/pdf',
    'text/plain','text/markdown','text/html','text/csv','application/json','application/xml',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip','application/x-zip-compressed'
]);

function assertFilePayload(body) {
    const MAX_MB = 25;
    const MAX_BYTES = MAX_MB * 1024 * 1024;
    if (!body || !body.fileData) return { status: 400, error: 'Missing fileData' };
    const size = Buffer.byteLength(body.fileData, 'base64');
    if (size > MAX_BYTES) return { status: 413, error: `File too large. Max ${MAX_MB}MB.` };
    const mime = body.mimeType || 'application/octet-stream';
    if (!ALLOWED_UPLOAD_MIMES.has(mime)) return { status: 415, error: `Unsupported file type: ${mime}` };
    return null;
}

async function runGeminiFileChat({ fileData, mimeType, text, mode, chatHistory }) {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) return { error: 'GEMINI_API_KEY missing' };

    let searchContext = '';
    const searchQuery = text || 'analyze';
    const webMatches = await executeInternalSearch(searchQuery);
    if (webMatches.length > 0) {
        searchContext = "\n\n=== VERIFIED RESULTS ===\n" + webMatches.slice(0, 3).map((item, i) => `[${i+1}] ${item.title}: ${item.link}`).join('\n') + "\n====================\n";
    }

    const contents = (chatHistory || []).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content || "Analyzed." }]
    }));

    const userParts = [{ text: text || "Please analyze this file." }];
    if (fileData) userParts.push({ inline_data: { mime_type: mimeType, data: fileData }});
    contents.push({ role: 'user', parts: userParts });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: getSystemPrompt(mode || 'chat', searchContext) }] },
            contents
        })
    });

    const data = await response.json();
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis available." };
}

app.post('/api/upload-image', async (req, res) => {
    const guard = assertFilePayload(req.body);
    if (guard) return res.status(guard.status).json(guard);
    try {
        const { fileData, mimeType, prompt, mode } = req.body;
        const out = await runGeminiFileChat({ fileData, mimeType: mimeType || 'image/jpeg', text: prompt, mode, chatHistory: [] });
        if (out.error) return res.status(500).json({ error: out.error });
        res.json({ text: out.text });
    } catch (err) {
        res.status(500).json({ error: 'Image analysis failed' });
    }
});

app.post('/api/upload-video', async (req, res) => {
    const guard = assertFilePayload(req.body);
    if (guard) return res.status(guard.status).json(guard);
    try {
        const { fileData, mimeType, mode } = req.body;
        const out = await runGeminiFileChat({ fileData, mimeType: mimeType || 'video/mp4', text: 'Describe and analyze this video.', mode, chatHistory: [] });
        if (out.error) return res.status(500).json({ error: out.error });
        res.json({ text: out.text });
    } catch (err) {
        res.status(500).json({ error: 'Video analysis failed' });
    }
});

app.post('/api/upload-document', async (req, res) => {
    const guard = assertFilePayload(req.body);
    if (guard) return res.status(guard.status).json(guard);
    try {
        const { fileData, mimeType, fileName, mode } = req.body;
        const prompt = `Read and summarize this document${fileName ? ` named ${fileName}` : ''}. Focus on structure, key points, and important data.`;
        const out = await runGeminiFileChat({ fileData, mimeType: mimeType || 'application/pdf', text: prompt, mode, chatHistory: [] });
        if (out.error) return res.status(500).json({ error: out.error });
        res.json({ text: out.text });
    } catch (err) {
        res.status(500).json({ error: 'Document processing failed' });
    }
});

app.post('/api/upload-generic', async (req, res) => {
    const guard = assertFilePayload(req.body);
    if (guard) return res.status(guard.status).json(guard);
    try {
        const { fileData, mimeType, fileName, mode } = req.body;
        const prompt = `Analyze this file${fileName ? ` (${fileName})` : ''} and provide a structured description, key findings, and suggested next steps.`;
        const out = await runGeminiFileChat({ fileData, mimeType: mimeType || 'application/octet-stream', text: prompt, mode, chatHistory: [] });
        if (out.error) return res.status(500).json({ error: out.error });
        res.json({ text: out.text });
    } catch (err) {
        res.status(500).json({ error: 'Generic file processing failed' });
    }
});

app.get('/api/env.example', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '.env.example');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.sendFile(filePath);
});


// ===========================================================
// LONG-TERM MEMORY
// ===========================================================
function generateSummary(text, maxLength = 200) {
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
}

app.post('/api/memory/store', async (req, res) => {
    const { sessionId, content, userId: headerUserId } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const authHeader = getBasicAuth();
    if (!baseUrl || !authHeader) return res.status(400).json({ error: "Cloud Configuration Missing" });

    try {
        const summary = generateSummary(content);
        const filename = `JoesAI_Memory_${headerUserId || 'default'}__${sessionId}.json`;
        await fetch(`${baseUrl}${filename}`, {
            method: 'PUT',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, summary, timestamp: Date.now() })
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Memory storage failed" });
    }
});

app.post('/api/memory/retrieve', async (req, res) => {
    const { query } = req.body;
    const baseUrl = getKoofrBaseUrl();
    const authHeader = getBasicAuth();
    if (!baseUrl || !authHeader) return res.status(400).json({ error: "Cloud Configuration Missing" });

    try {
        const response = await fetch(`${baseUrl}?format=json`, {
            method: 'PROPFIND',
            headers: { 'Authorization': authHeader, 'Depth': '1' }
        });
        const memories = [];
        res.json({ memories, query });
    } catch (err) {
        res.status(500).json({ error: "Memory retrieval failed" });
    }
});

// ===========================================================
// TOOL INVOCATION
// ===========================================================
const tools = {
    searchWeb: async (args) => {
        const results = await executeInternalSearch(args.query);
        return { results: results.slice(0, 3) };
    },
    saveNote: async (args) => ({ saved: true, noteId: Date.now().toString(36) }),
    createPdf: () => ({ pdfUrl: '/api/chats/download-pdf' }),
    explainCode: (args) => ({ explanation: `${args.code.split('\n').length} lines of code` })
};

app.post('/api/tools/invoke', async (req, res) => {
    const { tool, args } = req.body;
    if (!tools[tool]) return res.status(400).json({ error: "Unknown tool" });

    try {
        const result = await tools[tool](args);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Tool invocation failed" });
    }
});

// ===========================================================
// ANALYTICS
// ===========================================================
const analytics = { requests: 0, errors: 0, users: new Set() };

app.use('/api/', (req, res, next) => {
    analytics.requests++;
    analytics.users.add(req.headers['x-user-id'] || 'anonymous');
    const originalSend = res.send;
    res.send = function(body) {
        if (res.statusCode >= 400) analytics.errors++;
        return originalSend.call(this, body);
    };
    next();
});

app.get('/api/analytics', (req, res) => {
    res.json({
        totalRequests: analytics.requests,
        errorCount: analytics.errors,
        activeUsers: analytics.users.size,
        uptime: process.uptime()
    });
});

// ===========================================================
// 2026 TRENDS: AGENTIC LOOP + STRUCTURED JSON + HYBRID ROUTING
// ===========================================================

// Model routing by task type - free-tier first
const modelRouter = {
    chat:    { provider: 'groq',    model: 'llama-3.1-70b-versatile',  latency: 'fast' },
    code:    { provider: 'groq',    model: 'llama-3.1-70b-versatile',  latency: 'fast' },
    reasoning: { provider: 'groq', model: 'llama-3.1-70b-versatile',  latency: 'fast' },
    multimodal: { provider: 'gemini', model: 'gemini-2.0-flash',     latency: 'medium' },
    search:  { provider: 'internal', model: 'google-customsearch',    latency: 'fast' }
};

// Prompt cache for reduced tokens
const promptCache = new Map();
function getCachedPrompt(key, generator) {
    if (!promptCache.has(key)) {
        promptCache.set(key, generator());
    }
    return promptCache.get(key);
}

// Structured JSON output enforcement (2026 standard)
function enforceJsonMode(systemPrompt) {
    return systemPrompt + "\n\nCRITICAL: You MUST respond with valid JSON only. No markdown, no explanations outside JSON. Format: {\"thought\": \"...\", \"action\": \"...\", \"result\": \"...\"}";
}

// Agentic loop: multi-step tool calling with reflection
app.post('/api/agentic/run', async (req, res) => {
    const { message, mode = 'chat', maxSteps = 5, fileData, mimeType, chatHistory = [] } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const hasFile = !!(fileData && mimeType);
    const isGemini = hasFile || !GROQ_API_KEY;
    if (!GROQ_API_KEY && !GEMINI_API_KEY) return res.status(500).json({ error: "AI keys missing." });

    const route = isGemini
        ? modelRouter.multimodal
        : (modelRouter[mode] || modelRouter.chat);

    const apiKey = isGemini ? GEMINI_API_KEY : GROQ_API_KEY;
    const baseUrl = isGemini
        ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
        : 'https://api.groq.com/openai/v1/chat/completions';

    const conversation = [];
    let currentMsg = message;
    let steps = 0;

    while (steps < maxSteps) {
        steps++;
        const systemPrompt = getCachedPrompt(`agentic-${mode}-${hasFile ? 'file' : 'text'}`, () => getSystemPrompt(mode, ""));

        try {
            if (isGemini) {
                const contents = [
                    ...(Array.isArray(chatHistory) ? chatHistory : []).map(m => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        parts: [{ text: m.content || '...' }]
                    })),
                    { role: 'user', parts: [
                        { text: currentMsg },
                        ...(hasFile ? [{ inline_data: { mime_type: mimeType, data: fileData } }] : [])
                    ]}
                ];
                const response = await fetch(`${baseUrl}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        contents
                    })
                });
                const data = await response.json();
                const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                conversation.push({ role: 'user', content: currentMsg });
                conversation.push({ role: 'model', content: reply });
                return res.json({ response: reply, steps, conversation });
            }

            const groqRes = await fetch(baseUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: route.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...conversation,
                        { role: 'user', content: currentMsg }
                    ],
                    response_format: { type: 'json_object' }
                })
            });
            const apiResponse = await groqRes.json();
            const reply = apiResponse.choices?.[0]?.message?.content || "";
            conversation.push({ role: 'user', content: currentMsg });
            conversation.push({ role: 'assistant', content: reply });

            try {
                const parsed = JSON.parse(reply);
                if (parsed.action && tools[parsed.action]) {
                    const toolResult = await tools[parsed.action](parsed.args || {});
                    currentMsg = `Tool result for ${parsed.action}: ${JSON.stringify(toolResult)}. Continue reasoning.`;
                    continue;
                }
            } catch {}

            return res.json({ response: reply, steps, conversation });
        } catch (err) {
            return res.status(500).json({ error: `Agentic loop failed at step ${steps}`, details: err.message });
        }
    }

    return res.json({ response: "Max steps reached", steps, conversation });
});

// Smart context summarization for long conversations
function summarizeConversation(messages, maxTokens = 500) {
    if (!messages || messages.length < 4) return messages;
    const fullText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const truncated = fullText.substring(0, maxTokens * 4);
    return {
        role: 'system',
        content: `Previous conversation summary:\n${truncated}...\n[Summary ends. Continue naturally.]`
    };
}

// WebSocket streaming for real-time agentic output
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.WS_PORT || 3001 });

wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
        const { message, mode } = JSON.parse(data);
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_API_KEY) return;

        const route = modelRouter[mode] || modelRouter.chat;
        try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: route.model,
                    messages: [{ role: 'system', content: getSystemPrompt(mode) }, { role: 'user', content: message }],
                    stream: true
                })
            });

            if (!groqRes.body) return;
            const reader = groqRes.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                ws.send(decoder.decode(value));
            }
        } catch (err) {
            ws.send(JSON.stringify({ error: 'Stream failed' }));
        }
    });
});

// ===========================================================
// SERVER START
// ===========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Joes AI Backend running on port ${PORT}`));
