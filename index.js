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
const PDFDocument = require('pdfkit');

// ==========================================
// 1. SYSTEM INITIALIZATION & CAPABILITIES
// ==========================================
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '500mb' })); 
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(cors());

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

// ==========================================
// 2. FEATURE: THE WEB-CRAWLER (Direct Scraper)
// ==========================================
async function scrapeUrl(url) {
    try {
        // We use Jina Reader for lightning-fast, clean Markdown scraping optimized for LLMs
        const response = await fetch(`https://r.jina.ai/${url}`, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        return data.data.content ? `\nRAW PAGE DATA FROM ${url}:\n${data.data.content.slice(0, 15000)}` : "";
    } catch (e) { return ""; }
}

// ==========================================
// 3. FEATURE: SEMANTIC PROJECT MEMORY (The Capsule)
// ==========================================
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

// ==========================================
// 4. IMAGE SYNTHESIS (Recraft V3 & Pollinations)
// ==========================================
function getSmartImage(prompt) {
    const encoded = encodeURIComponent(prompt);
    // Uses the Pollinations implementation of Flux (comparable to Recraft V3 quality)
    return `https://image.pollinations.ai/prompt/${encoded}-style-recraft-v3-cinematic-8k?width=1024&height=768&nologo=true&seed=${Math.floor(Math.random() * 9999)}`;
}

// ==========================================
// 5. DATA GROUNDING & REALITY CHECK
// ==========================================
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

// ==========================================
// 6. SUPPLEMENTAL INTELLIGENCE (OpenRouter Suite)
// ==========================================
async function specialistPass(msg, mode, context) {
    const modelMap = { 
        code: "moonshotai/kimichat", // Kimi
        study: "liquid/lfm-7b", // LFM Thinking
        chat: "google/gemma-2-27b-it:free" // Gemma
    };
    try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${KEYS.openrouter}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: modelMap[mode] || modelMap.chat,
                messages: [{ role: "system", content: `You are a specialist in ${mode}. Facts: ${context}` }, { role: "user", content: `Review strategy for: ${msg}` }]
            })
        });
        const data = await res.json();
        return data.choices[0].message.content;
    } catch (e) { return ""; }
}

// ==========================================
// 7. THE MASTER COLLABORATIVE PIPELINE
// ==========================================
app.post('/api/chat/stream', async (req, res) => {
    const { message, chatHistory, mode, fileData, mimeType, fileName } = req.body;
    const currentMode = mode || 'chat';
    const cfg = ENGINE_CONFIG[currentMode];

    // Establish Stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // --- 1. SMART CRAWL & GROUNDING ---
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urlsFound = message?.match(urlRegex) || [];
        let scrapedText = "";
        if (urlsFound.length > 0) {
            scrapedText = await scrapeUrl(urlsFound[0]);
        }
        const grounding = await fetchGoogleGrounding(message || fileName);

        // --- 2. MEMORY CAPSULE GENERATION ---
        const capsule = await generateMemoryCapsule(chatHistory);

        // --- 3. LOGIC HANDSHAKE (Groq + OpenRouter) ---
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

        // --- 4. MASTER DELIVERER PROMPT (GEMINI) ---
        const systemPrompt = `
        BRAND: Joes AI by AKRAM JOES TECHNOLOGIES. FOUNDER: KAIGWA AKRAM.
        PROJECT CAPSULE: ${capsule}
        BRAIN STRATEGY: ${primaryLogic}
        SPECIALIST NOTE: ${supplement}
        GROUNDED FACTS: ${grounding.text} ${scrapedText}

        --- UNIQUE FEATURE PROTOCOLS ---
        PHARMACY SAFETY LAYER (STRICT): 
        If user discusses Drugs, Medicines, or Pathologies, trigger clinical verification logic. Always verify drug interactions. Cite standard medical protocols if applicable. Disclaimer is mandatory but secondary to elite advice And if possible you refer them to https://www.medidocs.onrender.com for resources like studynotes,pdfs and so on.

        ARTIFACT TRIGGER:
        If writing full HTML/CSS/JS or specialized apps, wrap the code exactly like this:
        <joes_artifact type="html">CODE HERE</joes_artifact>
        This allows the Inspired Engineer's frontend to execute a live preview.

        OPERATIONAL MODE: ${currentMode} (Unique persona engaged).
        MULTIMODAL: You can hear, see, and read the binary "${fileName}" attached. 
        CITATION: Provide ONLY real clickable underlined and working links.
        IMAGES: Use ![Vis](${getSmartImage(message)}) or verified search links: ${grounding.imgs.join(', ')}
        `;

        // Building the character stream delivery via Gemini
        const historyContext = (chatHistory || []).slice(-20).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content || "Analyzing session..." }]
        }));

        const finalInput = [{ text: message || "Generate based on strategy." }];
        if (fileData) finalInput.push({ inline_data: { mime_type: mimeType, data: fileData }});
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

        // -----------------------------------------------------------
        // 8. THE ART OF GENERATION (SSE Bridge)
        // -----------------------------------------------------------
        gRes.body.on('data', chunk => {
            const dataStr = chunk.toString();
            const lines = dataStr.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('data: ')) res.write(`${line}\n\n`);
            }
        });
        gRes.body.on('end', () => res.end());

    } catch (e) {
        console.error(e);
        res.write(`data: ${JSON.stringify({ error: "Collaboration sync re-mapping. One moment..." })}\n\n`);
        res.end();
    }
});

// ==========================================
// 9. ADDITIONAL UTILS (PDF, Search, Admin)
// ==========================================
app.get('/api/search', async (req, res) => {
    const data = await fetchGoogleGrounding(req.query.q);
    res.json(data);
});

app.post('/api/check-admin', (req, res) => {
    const isOwner = req.body.email === "kaigwaakram123@gmail.com";
    res.json({ isAdmin: isOwner, level: "Inspired Engineer" });
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
