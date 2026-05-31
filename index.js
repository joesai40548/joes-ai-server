const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const requiredEnvVars = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'ADMIN_EMAIL'];

function validateEnv() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn('Missing required environment variables:', missing.join(', '));
  }
  return missing;
}

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
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

    try {
        // Using Gemini 1.5 Flash (Most generous free tier: 1,500 requests/day)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const payload = {
            contents: [{
                parts: [
                    { text: message || "Please describe this attachment in detail." },
                    {
                        inline_data: {
                            mime_type: mimeType,
                            data: fileData // This is the base64 string from your frontend
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
            console.error('Gemini API Error Response:', data);
            return res.status(response.status).json({
                error: data.error?.message || 'Gemini processing failed.'
            });
        }

        // Extracting the AI's text response
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI could not generate a description.";

        res.json({ text: aiResponse });

    } catch (error) {
        console.error('Gemini Route Crash:', error);
        res.status(500).json({ error: 'Internal server error processing the image.' });
    }
});

app.get('/api/test-gemini', async (req, res) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is not set in environment.' });
    try {
        const probeUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        const probe = await fetch(probeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Say: ok' }] }], generationConfig: { maxOutputTokens: 5 } })
        });
        const data = await probe.json();
        if (!probe.ok) {
            return res.status(500).json({ status: probe.status, error: data?.error?.message || 'Gemini probe failed' });
        }
        res.json({ status: 'ok', text: data?.candidates?.[0]?.content?.parts?.[0]?.text || '' });
    } catch (error) {
        res.status(500).json({ error: 'Gemini probe request failed' });
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
validateEnv();
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));