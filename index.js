const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();

// Trust proxy is required if deploying to Render, Heroku, etc.
app.set('trust proxy', 1);

// -----------------------------------------------------------
// 🛡️ RATE LIMITING CONFIGURATION
// -----------------------------------------------------------
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, 
    message: { error: "Too many requests. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});

const aiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 15, // 15 AI requests per minute
    message: { error: "AI Limit reached. Please wait a moment." },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());
app.use(generalLimiter);

// -----------------------------------------------------------
// 📑 PDF EXPORT ENDPOINT (Joes AI Branded)
// -----------------------------------------------------------
app.post('/api/export-pdf', (req, res) => {
    const { history, title } = req.body;
    
    if (!history || !Array.isArray(history)) {
        return res.status(400).json({ error: "No chat history provided." });
    }

    try {
        const doc = new PDFDocument({ margin: 50 });
        let filename = `JoesAI_Export_${Date.now()}.pdf`;

        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');

        doc.pipe(res);

        // Header - Joes AI Branding
        doc.fillColor('#2563eb').fontSize(22).text('JOES AI CONVERSATION REPORT', { align: 'center' });
        doc.fontSize(10).fillColor('#666666').text('Powered by AKRAM JOES TECHNOLOGIES', { align: 'center' });
        doc.moveDown();
        doc.fillColor('#000000').fontSize(14).text(`Topic: ${title || 'Saved Conversation'}`, { underline: true });
        doc.moveDown(2);

        // Render History
        history.forEach((msg) => {
            const isUser = msg.role === 'user' || msg.sender === 'user';
            
            doc.fillColor(isUser ? '#444444' : '#0066cc')
               .fontSize(11)
               .text(isUser ? 'YOU:' : 'JOES AI:', { continued: false, fontWeight: 'bold' });
            
            doc.fillColor('#333333')
               .fontSize(10)
               .text(msg.content || msg.text || "");
            
            doc.moveDown();
            doc.strokeColor('#eeeeee').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown();
        });

        // Footer
        doc.fontSize(8).fillColor('#999999').text(`Developed by Kaigwa Akram - The Inspired Engineer. End of Report.`, 50, 750, { align: 'center' });

        doc.end();
    } catch (err) {
        console.error("PDF Export Error:", err);
        res.status(500).json({ error: "Failed to generate PDF export." });
    }
});

/**
 * Core Search Utility
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
        return [];
    }
}

/**
 * Identity & Personality Constructor
 */
function getSystemPrompt(mode, searchContext = "") {
    const creatorIdentity = 
        "You are Joes AI, an intelligent assistant owned by AKRAM JOES TECHNOLOGIES founded by KAIGWA AKRAM (The Inspired Engineer). " +
        "You respond using professional Markdown, tables for data, and Mermaid diagrams for logic. Always include clickable citations from the search results provided. " +
        "If images are requested, prioritize verified URLs or use https://image.pollinations.ai/prompt/DESCRIPTION. " + searchContext;

    const modes = {
        code: "Mode: Senior Programmer. Code is priority.",
        learn: "Mode: Academic Guide. Explain terminology.",
        study: "Mode: Empathetic Tutor. Break concepts down.",
        chat: "Mode: Friendly & Energetic Assistant."
    };
    return `${creatorIdentity} ${modes[mode] || modes.chat}`;
}

// -----------------------------------------------------------
// ADAPTIVE GEMINI ROUTE (Multimodal & Dynamic File Support)
// -----------------------------------------------------------
app.post('/api/gemini', aiLimiter, async (req, res) => {
    const { message, fileData, mimeType, mode, chatHistory } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });

    try {
        let searchContext = "";
        const searchQuery = message || "current context";
        const [web, img] = await Promise.all([executeInternalSearch(searchQuery), executeInternalSearch(searchQuery, 'image')]);
        
        if (web.length) {
            searchContext = "\n[LIVE SEARCH DATA]\n" + web.map((s, i) => `[${i+1}] ${s.title}: ${s.link}`).join("\n");
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
        
        const contents = [];
        if (chatHistory) {
            chatHistory.forEach(msg => contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content || "..." }] }));
        }

        const userParts = [{ text: message || "Please process the attached file/instruction." }];
        
        // 🚀 DYNAMIC MULTIMODAL INJECTION
        // Handles Image, PDF, Audio, Video, CSV, etc. based on the frontend's mimeType
        if (fileData) {
            userParts.push({
                inline_data: {
                    mime_type: mimeType || "application/pdf", // Falls back to PDF if unknown
                    data: fileData // Base64 encoded string from frontend
                }
            });
        }

        contents.push({ role: 'user', parts: userParts });

        const payload = {
            systemInstruction: { parts: [{ text: getSystemPrompt(mode, searchContext) }] },
            contents
        };

        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json();
        
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        res.json({ text: aiResponse });

    } catch (err) {
        res.status(500).json({ error: 'Server side crash' });
    }
});

// ... Keep existing /api/config, /api/chat (Groq), /api/chats (Koofr) routes as previously defined ...

// -----------------------------------------------------------
// ADMIN & BOOT
// -----------------------------------------------------------
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "kaigwaakram123@gmail.com";
    res.json({ isAdmin: email?.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim() });
});

app.get('/', (req, res) => res.send('Joes AI Backend Status: Online. Fully Scaled.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Joes AI Live on Port ${PORT}`));
