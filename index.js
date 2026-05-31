const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const requiredEnvVars = [
  'GROQ_API_KEY',
  'HUGGINGFACE_API_KEY',
  'GEMINI_API_KEY',
  'ADMIN_EMAIL'
];

function validateEnv() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn('Missing required environment variables:', missing.join(', '));
  }
  return missing;
}

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
    const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

    if (!HF_API_KEY) {
        return res.status(500).json({ error: 'Hugging Face API key missing on server.' });
    }

    const model = process.env.HF_VISION_MODEL || 'Salesforce/blip-image-captioning-base';
    const url = `https://api-inference.huggingface.co/models/${model}`;

    try {
        const hfRes = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ inputs: { image: fileData }, parameters: { max_new_tokens: 256 } })
        });

        const data = await hfRes.json();
        if (!hfRes.ok) {
            console.error('HF Vision API error:', hfRes.status, data);
            return res.status(hfRes.status).json({ error: data.error || 'Hugging Face vision request failed.' });
        }

        let text = '';
        if (Array.isArray(data) && data[0]?.generated_text) {
            text = data[0].generated_text;
        } else if (typeof data === 'string') {
            text = data;
        } else if (data?.generated_text) {
            text = data.generated_text;
        } else {
            text = 'Vision model returned no text.';
        }

        if (message) {
            text = `${message}\n\nAttachment insight:\n${text}`;
        }

        res.json({ text });
    } catch (error) {
        console.error('HF Vision Error:', error);
        res.status(500).json({ error: 'Failed to communicate with Hugging Face Vision API.' });
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