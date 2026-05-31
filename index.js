const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

// Updated required variables to include Hugging Face
const requiredEnvVars = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'HUGGINGFACE_API_KEY', 'ADMIN_EMAIL'];

function validateEnv() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn('⚠️ Missing environment variables:', missing.join(', '));
  }
}

const app = express();
// 100mb limit is necessary for Video and Audio uploads
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

app.get('/', (req, res) => res.send('Joes AI Backend is running.'));

// --- ADMIN CHECK ---
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    if (!email || !ADMIN_EMAIL) return res.json({ isAdmin: false });
    res.json({ isAdmin: email.toLowerCase() === ADMIN_EMAIL.toLowerCase() });
});

// --- GEMINI ROUTE (Handles: Images, Audio, Video, PDFs, Docs) ---
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType } = req.body;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Gemini API key missing on server.' });
    }

    try {
        // Gemini 1.5 Flash is multimodal and handles almost all file types
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const payload = {
            contents: [{
                parts: [
                    { text: message || "Analyze this file in detail and explain what it is." },
                    {
                        inline_data: {
                            mime_type: mimeType || "application/octet-stream",
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
            console.error('Gemini API Error:', data);
            return res.status(response.status).json({
                error: data.error?.message || 'Gemini failed to process this file.'
            });
        }

        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI processed the file but had no comments.";
        res.json({ text: aiResponse });

    } catch (error) {
        console.error('Gemini Route Crash:', error);
        res.status(500).json({ error: 'Server error processing the attachment.' });
    }
});

// --- HUGGING FACE VISION ROUTE (Backup for Images) ---
app.post('/api/hf-vision', async (req, res) => {
    const { message, fileData } = req.body;
    const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

    if (!HF_API_KEY) return res.status(500).json({ error: 'Hugging Face API key missing.' });

    try {
        // Convert base64 to binary buffer for HF
        const imageBuffer = Buffer.from(fileData, 'base64');
        const model = 'Salesforce/blip-image-captioning-large'; 
        
        const hfRes = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${HF_API_KEY}` },
            body: imageBuffer
        });

        const data = await hfRes.json();
        let caption = Array.isArray(data) ? data[0]?.generated_text : "Could not describe image.";
        
        if (message) caption = `Insight: ${caption}\n\nContext: ${message}`;
        res.json({ text: caption });
    } catch (error) {
        console.error('HF Error:', error);
        res.status(500).json({ error: 'Hugging Face vision processing failed.' });
    }
});

// --- GROQ CHAT ROUTE (Standard Text/Code) ---
app.post('/api/chat', async (req, res) => {
    const { messages, model, temperature, max_tokens, stream } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq API Key not configured." });

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
        } else {
            const data = await groqRes.json();
            res.json(data);
        }
    } catch (error) {
        console.error('Groq Error:', error);
        res.status(500).json({ error: 'Failed to communicate with Groq.' });
    }
});

// --- TEST ROUTE ---
app.get('/api/test-gemini', async (req, res) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY missing.' });
    try {
        const probeUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const probe = await fetch(probeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Respond with: success' }] }] })
        });
        const data = await probe.json();
        res.json({ status: probe.ok ? 'ok' : 'failed', data });
    } catch (error) {
        res.status(500).json({ error: 'Probe failed' });
    }
});

const PORT = process.env.PORT || 3000;
validateEnv();
app.listen(PORT, () => console.log(`🚀 Joes AI Server running on port ${PORT}`));
