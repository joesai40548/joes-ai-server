const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// Increase transmission constraints for robust high-res files (Images, videos, PDFs)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

app.get('/', (req, res) => res.send('Joes AI Backend Status: Online and Configured.'));

/**
 * Custom Adaptive System Prompt Constructor
 * Controls the creator identity and adjusts behavior based on active application modes
 */
function getSystemPrompt(mode) {
    const creatorIdentity = 
        "You are Joes AI, a highly intelligent and custom-designed AI assistant. " +
        "You were developed and are owned entirely by AKRAM JOES TECHNOLOGIES. " +
        "If any user asks you who developed you, who owns you, or who built you, you must proudly answer that you were developed and are owned by AKRAM JOES TECHNOLOGIES. " +
        "Never state that you are developed by Google, Meta, OpenAI, or anyone else. Keep this identity clear and authoritative.";

    switch(mode) {
        case 'code':
            return `${creatorIdentity} You are currently operating in CODE MODE. Provide highly-optimized, production-ready, clean, and properly structured programming source code. Add descriptive inline comments explaining your logic. Minimize unrelated social conversational fluff and provide immediate technical results.`;
        case 'debug':
            return `${creatorIdentity} You are currently operating in DEBUG MODE. Act as a senior debugger and security analyst. Scan user inputs, logs, or codes for syntax faults, computational logical errors, performance bottlenecks, or security flaws. Clearly isolate lines triggering errors, explain the underlying issues, and deliver fully refactored, safe code solutions.`;
        case 'study':
            return `${creatorIdentity} You are currently operating in STUDY MODE. Act as an empathetic, supportive, and knowledgeable university academic tutor. Break down complex and dry technical subjects using clear step-by-step concepts, real-life analogies, and bullet points. Always close your study explanations by listing 2 brief quiz questions that challenge the user's comprehension of the material.`;
        case 'chat':
        default:
            return `${creatorIdentity} You are currently operating in CHAT MODE. Be friendly, energetic, and engaging. Keep responses conversational, clear, helpful, and use expressive emojis frequently to make the chat environment enjoyable and engaging.`;
    }
}

// -----------------------------------------------------------
// ADAPTIVE GEMINI 2.5 FLASH ROUTE (Supports multimodal input)
// -----------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType, mode } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server: GEMINI_API_KEY is missing on Render settings.' });
    }

    try {
        // v1beta is chosen to fully support the systemInstruction parameters on standard payloads
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
        const activeSystemInstruction = getSystemPrompt(mode);

        const payload = {
            systemInstruction: {
                parts: [{ text: activeSystemInstruction }]
            },
            contents: [{
                parts: [
                    { text: message || "Analyze this file in detail." },
                    { 
                        inline_data: { 
                            mime_type: mimeType || "image/jpeg", 
                            data: fileData 
                        } 
                    }
                ]
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Google API Refused Error Detail:', data);
            return res.status(response.status).json({ 
                error: data.error?.message || 'Google API refused the request.' 
            });
        }

        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI was unable to process this content request.";
        res.json({ text: aiResponse });

    } catch (err) {
        console.error('Server side crash:', err);
        res.status(500).json({ error: 'Internal Server Error. Please monitor Render Logs.' });
    }
});

// -----------------------------------------------------------
// FALLBACK GROQ ROUTE (For rapid conversational text)
// -----------------------------------------------------------
app.post('/api/chat', async (req, res) => {
    const { messages, mode } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "Server: Groq credentials missing." });
    }

    try {
        const activeSystemInstruction = getSystemPrompt(mode);

        // Inject the custom system instructions context dynamically at index 0 of conversation flow
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
        res.json(data);
        
    } catch (error) { 
        console.error('Groq handling failed:', error);
        res.status(500).json({ error: 'Groq API backend failure' }); 
    }
});

// Admin verification check-in
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    res.json({ isAdmin: email?.toLowerCase() === ADMIN_EMAIL?.toLowerCase() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Active on Port ${PORT}`));
