const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

app.get('/', (req, res) => res.send('Joes AI Backend is running.'));

app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    if (!email || !ADMIN_EMAIL) return res.json({ isAdmin: false });
    res.json({ isAdmin: email.toLowerCase() === ADMIN_EMAIL.toLowerCase() });
});

app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType } = req.body;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Gemini API key missing on server.' });
    }

    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const parts = [];
    if (message) parts.push({ text: message });
    if (fileData && mimeType) {
        parts.push({
            inline_data: {
                mime_type: mimeType,
                data: fileData
            }
        });
    }

    try {
        const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
            })
        });

        const data = await geminiRes.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.';
        res.json({ text });
    } catch (error) {
        console.error('Gemini Error:', error);
        res.status(500).json({ error: 'Failed to communicate with Gemini.' });
    }
});

app.post('/api/chat', async (req, res) => {
    const { messages, model, temperature, max_tokens, stream } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
        console.error("Missing GROQ_API_KEY in environment variables");
        return res.status(500).json({ error: "Server error: API Key not configured." });
    }

    try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model || 'llama-3.1-8b-instant',
                messages: messages,
                temperature: temperature || 0.7,
                max_tokens: max_tokens || 1000,
                stream: stream !== false
            })
        });

        if (stream !== false && groqRes.headers.get('content-type')?.includes('text/event-stream')) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            groqRes.body.pipe(res);
            groqRes.body.on('error', () => {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '' } }] })}\n\n`);
                res.end();
            });
        } else {
            const data = await groqRes.json();
            res.json(data);
        }
    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: 'Failed to communicate with Groq.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));