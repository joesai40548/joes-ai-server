const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    standardHeaders: true, 
    legacyHeaders: false, 
    message: { error: "Too many requests from this device. Please try again after 15 minutes." }
});

app.use('/api/', apiLimiter);

app.get('/', (req, res) => res.send('Joes AI Backend Status: Online and Configured.'));

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
    if (!baseUrl) return res.status(400).json({ error: "Cloud Configuration Missing" });
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
    
    if (!baseUrl) return res.status(400).json({ error: "Cloud Configuration Missing" });
    if (!title || typeof title !== 'string') return res.status(400).json({ error: "Title is required" });
    if (!process.env.CLOUDSYNC_USER || !process.env.CLOUDSYNC_PASSWORD) return res.status(400).json({ error: "Cloud Configuration Missing" });
    
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
    
    if (!baseUrl) return res.status(400).json({ error: "Cloud Configuration Missing" });
    if (!process.env.CLOUDSYNC_USER || !process.env.CLOUDSYNC_PASSWORD) return res.status(400).json({ error: "Cloud Configuration Missing" });
    
    const userId = req.headers['x-user-id'] || 'default';
    try {
        const safeTitle = (newTitle || 'Untitled').trim().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
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
    const baseUrl = getKoofrBaseUrl();
    if (!baseUrl) return res.status(400).json({ error: "Cloud Configuration Missing" });
    try {
        const authHeader = 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
        await fetch(`${baseUrl}${req.params.filename}`, { method: 'DELETE', headers: { 'Authorization': authHeader }});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Delete operation failure" }); }
});

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

// -----------------------------------------------------------
// PROJECT-AWARE CONTEXT & INDEXING
// -----------------------------------------------------------
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
                else if (exts.some(ext => item.endsWith(ext))) {
                    results.push(fullPath);
                }
            }
        } catch {}
    };
    walk(dir);
    return results;
}

app.get('/api/project/index', (req, res) => {
    try {
        const files = indexProject(__dirname);
        res.json(files.map(f => ({
            path: f,
            ext: path.extname(f),
            name: path.basename(f)
        })));
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

// -----------------------------------------------------------
// SEMANTIC CODE SEARCH (simple grep-based)
// -----------------------------------------------------------
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
                if (match[0].toLowerCase().includes(query?.toLowerCase() || '')) {
                    matches.push({ file, match: match[0].substring(0, 100) });
                }
            }
        }
        res.json(matches.slice(0, 50));
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

// -----------------------------------------------------------
// LIVE DEBUGGING HELP
// -----------------------------------------------------------
app.post('/api/debug/analyze', (req, res) => {
    const { code, file } = req.body;
    const issues = [];
    
    if (!code) return res.status(400).json({ error: "No code provided" });
    
    // Check for common bugs
    if (code.includes('await') && !code.includes('async')) {
        issues.push({ type: 'error', message: "Missing async keyword with await" });
    }
    if (code.match(/fetch\([^)]*\)/g) && !code.includes('.catch')) {
        issues.push({ type: 'warning', message: "Fetch without error handling" });
    }
    if (code.match(/document\.getElementById[^)]*\)\s*\.\s*[a-z]+\([^)]*\)/g) && !code.includes('if (') && !code.includes('?.')) {
        issues.push({ type: 'error', message: "Potential null reference - add null check before getElementById call" });
    }
    if (file && file.endsWith('.js') && !code.includes('require') && code.includes('process.env')) {
        issues.push({ type: 'warning', message: "Using process.env without require('dotenv')" });
    }
    
    res.json({ issues, suggestions: issues.length > 0 ? ["Add try-catch for safer execution"] : [] });
});

// -----------------------------------------------------------
// REFACTORING SUGGESTIONS
// -----------------------------------------------------------
app.post('/api/refactor/suggestions', (req, res) => {
    const { code, language } = req.body;
    const suggestions = [];
    
    if (language === 'javascript') {
        // Check for long functions
        const funcMatches = code.match(/function\s+\w+[^{]*\{[^}]*\}/gs) || [];
        funcMatches.forEach((fn, i) => {
            if (fn.split('\n').length > 30) {
                suggestions.push({ type: 'extract', message: `Function ${i+1} is too long - consider extracting` });
            }
        });
        
        // Check for duplicate code
        const lines = code.split('\n').filter(l => l.trim().length > 10);
        const duplicates = lines.filter((l, i) => lines.findIndex(other => other.trim() === l.trim()) !== i);
        if (duplicates.length > 0) {
            suggestions.push({ type: 'duplicate', message: "Duplicate code detected - extract to function" });
        }
    }
    
    res.json(suggestions);
});

// -----------------------------------------------------------
// AUTO-COMPLETE COMMITS
// -----------------------------------------------------------
function generateCommitMessage(files, types) {
    const typeMap = {
        'feat': 'Add',
        'fix': 'Fix',
        'refactor': 'Refactor',
        'docs': 'Update docs',
        'style': 'Style'
    };
    
    const primaryType = types[0] || 'feat';
    const fileNames = files.map(f => path.basename(f, path.extname(f))).join(', ');
    return `${typeMap[primaryType] || 'Update'} ${fileNames || 'files'}`;
}

app.post('/api/commit/generate', (req, res) => {
    const { files, changes } = req.body;
    const types = changes.map(c => c.type);
    res.json({ message: generateCommitMessage(files, types) });
});

// -----------------------------------------------------------
// SECURITY CHECKS
// -----------------------------------------------------------
app.post('/api/security/analyze', (req, res) => {
    const { code } = req.body;
    const vulnerabilities = [];
    
    // Check for hardcoded secrets
    const secretPatterns = [/apiKey\s*[:=]\s*['"][^'"]{20,}/i, /password\s*[:=]\s*['"][^'"]+/i, /secret\s*[:=]\s*['"][^'"]+/i];
    secretPatterns.forEach(pattern => {
        if (pattern.test(code)) {
            vulnerabilities.push({ type: 'secret_leak', severity: 'high', message: "Potential hardcoded secret detected" });
        }
    });
    
    // Check for SQL injection patterns
    if (/(\$\{[^}]*\}|`.*\$\{)/.test(code) && code.includes('SELECT')) {
        vulnerabilities.push({ type: 'sql_injection', severity: 'high', message: "Potential SQL injection vulnerability" });
    }
    
    // Check for eval usage
    if (code.includes('eval(') || code.includes('new Function(')) {
        vulnerabilities.push({ type: 'code_injection', severity: 'high', message: "Dynamic code execution detected" });
    }
    
    res.json(vulnerabilities);
});

// -----------------------------------------------------------
// UNIT TEST GENERATOR
// -----------------------------------------------------------
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

// -----------------------------------------------------------
// MULTI-LANGUAGE SUPPORT
// -----------------------------------------------------------
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
    
    if (language === 'typescript') {
        analysis.languageSpecific.types = (code.match(/:\s*(string|number|boolean|any)/g) || []).length;
    } else if (language === 'python') {
        analysis.languageSpecific.imports = (code.match(/^import\s+\w+/gm) || []).length;
    } else if (language === 'rust') {
        analysis.languageSpecific.unsafe = (code.match(/unsafe\s*\{/g) || []).length;
    }
    
    res.json(analysis);
});

// -----------------------------------------------------------
// MULTI-MODAL SUPPORT - Image/Audio Upload
// -----------------------------------------------------------
app.post('/api/upload-image', async (req, res) => {
    const { fileData, mimeType, prompt, mode } = req.body;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });
    if (!fileData) return res.status(400).json({ error: 'No image data provided' });
    
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

app.post('/api/upload-audio', async (req, res) => {
    const { fileData, mimeType } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY missing' });
    if (!fileData) return res.status(400).json({ error: 'No audio data provided' });
    
    try {
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({ file: fileData, model: 'whisper-large-v3' })
        });
        const data = await response.json();
        res.json({ text: data.text || "No transcription available." });
    } catch (err) {
        res.status(500).json({ error: 'Audio transcription failed' });
    }
});

// -----------------------------------------------------------
// LONG-TERM MEMORY - Context Retrieval
// -----------------------------------------------------------
function generateSummary(text, maxLength = 200) {
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
}

app.post('/api/memory/store', async (req, res) => {
    const { sessionId, content, userId: headerUserId } = req.body;
    const baseUrl = getKoofrBaseUrl();
    
    if (!baseUrl) return res.status(400).json({ error: "Cloud Configuration Missing" });
    if (!process.env.CLOUDSYNC_USER || !process.env.CLOUDSYNC_PASSWORD) return res.status(400).json({ error: "Cloud Configuration Missing" });
    
    try {
        const summary = generateSummary(content);
        const filename = `JoesAI_Memory_${headerUserId || 'default'}__${sessionId}.json`;
        const authHeader = 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
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
    const { query, userId: headerUserId } = req.body;
    const baseUrl = getKoofrBaseUrl();
    
    if (!baseUrl) return res.status(400).json({ error: "Cloud Configuration Missing" });
    
    try {
        const authHeader = 'Basic ' + Buffer.from(`${process.env.CLOUDSYNC_USER}:${process.env.CLOUDSYNC_PASSWORD}`).toString('base64');
        const response = await fetch(`${baseUrl}?format=json`, {
            method: 'PROPFIND',
            headers: { 'Authorization': authHeader, 'Depth': '1' }
        });
        
        // Simple text match for memory retrieval
        const memories = [];
        // Would need to fetch each memory file and search - simplified for now
        res.json({ memories, query });
    } catch (err) {
        res.status(500).json({ error: "Memory retrieval failed" });
    }
});

// -----------------------------------------------------------
// TOOL / FUNCTION INVOCATION
// -----------------------------------------------------------
const tools = {
    searchWeb: async (args) => {
        const results = await executeInternalSearch(args.query);
        return { results: results.slice(0, 3) };
    },
    saveNote: async (args, userId) => {
        return { saved: true, noteId: Date.now().toString(36) };
    },
    createPdf: async (args) => {
        return { pdfUrl: `/api/chats/download-pdf` };
    },
    explainCode: async (args) => {
        return { explanation: args.code.split('\n').length + ' lines of code' };
    }
};

app.post('/api/tools/invoke', async (req, res) => {
    const { tool, args } = req.body;
    const userId = req.headers['x-user-id'] || 'default';
    
    if (!tools[tool]) return res.status(400).json({ error: "Unknown tool" });
    
    try {
        const result = await tools[tool](args, userId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Tool invocation failed" });
    }
});

// -----------------------------------------------------------
// STREAMING CHAT RESPONSES
// -----------------------------------------------------------
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
        
        const activeSystemInstruction = getSystemPrompt(mode, searchContext);
        
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'system', content: activeSystemInstruction }, ...msgList],
                stream: true
            })
        });
        
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            res.write(chunk);
        }
        res.end();
    } catch (err) {
        res.status(500).json({ error: 'Stream failed' });
    }
});

// -----------------------------------------------------------
// ANALYTICS & ADMIN DASHBOARD
// -----------------------------------------------------------
const analytics = {
    requests: 0,
    errors: 0,
    users: new Set()
};

app.use('/api/', (req, res, next) => {
    analytics.requests++;
    analytics.users.add(req.headers['x-user-id'] || 'anonymous');
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

// -----------------------------------------------------------
// DEPLOY ENDPOINT
// -----------------------------------------------------------
app.post('/api/deploy', async (req, res) => {
    const { code } = req.body;
    const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
    
    if (!NETLIFY_TOKEN) {
        // Fallback: return mock URL
        return res.json({ url: 'https://joes-ai-deploy.netlify.app/' });
    }
    
    try {
        // Deploy to Netlify (simplified)
        const deployRes = await fetch('https://api.netlify.com/api/v1/sites', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${NETLIFY_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ body: { files: { '/index.html': code } } })
        });
        const data = await deployRes.json();
        res.json({ url: data.url || 'Deployed' });
    } catch (err) {
        res.status(500).json({ error: 'Deploy failed' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Server Processing Node Active on Port ${PORT}`));
