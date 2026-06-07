const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Security throttle engaged. Please wait 15 minutes." }
});
app.use('/api/', apiLimiter);

/**
 * GOOGLE SEARCH UTILITY
 * Searches Google and prioritizes Direct Images if 'image' searchType is used
 */
async function searchIntelligence(query, mode = 'web') {
    const KEY = process.env.GOOGLE_SEARCH_API_KEY;
    const CX = process.env.GOOGLE_SEARCH_ENGINE_ID;
    if(!KEY || !CX) return [];

    try {
        const typeParam = mode === 'image' ? '&searchType=image' : '';
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${KEY}&cx=${CX}${typeParam}`;
        const res = await fetch(url);
        const data = await res.json();
        
        return (data.items || []).slice(0, 3).map(i => ({
            title: i.title,
            link: i.link,
            snippet: i.snippet || ''
        }));
    } catch(e) { return []; }
}

const getPrompt = (mode, context) => {
    return `Identity: Joes AI. Owner: AKRAM JOES TECHNOLOGIES. Founder: KAIGWA AKRAM.
    Motto: "Your Intelligent AI Assistant & Coding Workspace".
    Rules: 
    1. Always use high-quality markdown for everything.
    2. TABLES: Use clear | syntax for comparisons.
    3. IMAGES: Use markdown ![alt](url) to render photos. Use URLs from the SEARCH context provided below.
    4. CODE: Output high-level production code if in Code mode.
    
    Current Neural Mode: ${mode.toUpperCase()}
    LIVE WEB SEARCH RESULTS:
    ${context}`;
}

app.post('/api/gemini', async (req, res) => {
    const { message, mode, history = [] } = req.body;
    const KEY = process.env.GEMINI_API_KEY;

    try {
        // Run Real Google Search to get both Snippets and Real Image URLs
        const webRaw = await searchIntelligence(message);
        const imgRaw = await searchIntelligence(message + " photorealistic 4k", 'image');

        let dataPool = "\nIMAGE RESOURCES (RENDER THESE USING MARKDOWN):\n";
        imgRaw.forEach(im => dataPool += `- Source: ${im.link} (Context: ${im.title})\n`);
        
        dataPool += "\nFACTUAL REFERENCES:\n";
        webRaw.forEach(wb => dataPool += `- ${wb.title}: ${wb.snippet} (Ref: ${wb.link})\n`);

        const systemCmd = getPrompt(mode, dataPool);

        const payload = {
            contents: [
                { role: 'user', parts: [{ text: "Initial Command System Settings: " + systemCmd }] },
                ...history.map(h => ({
                    role: h.role === 'user' ? 'user' : 'model',
                    parts: [{ text: h.content }]
                })),
                { role: 'user', parts: [{ text: message }] }
            ]
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${KEY}`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const finalContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "Neural connection timeout. Re-ping engine.";

        res.json({ text: finalContent });

    } catch (err) {
        res.status(500).json({ error: "System-level Neural Crash" });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Joes AI Live on port ${PORT}`));
