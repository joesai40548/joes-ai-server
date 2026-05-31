const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// Increase limits to handle video/audio base64
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

app.get('/', (req, res) => res.send('Joes AI Server is live!'));

// CHECK ADMIN
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    res.json({ isAdmin: email?.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase() });
});

// MAIN GEMINI ROUTE (Files: Image, Video, Audio, PDF)
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType } = req.body;
    const key = process.env.GEMINI_API_KEY;

    if (!key) return res.status(500).json({ error: 'Server: GEMINI_API_KEY is missing.' });

    try {
        // Correct model string and API version
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

        const payload = {
            contents: [{
                parts: [
                    { text: message || "Analyze this file and describe it." },
                    { inline_data: { mime_type: mimeType, data: fileData } }
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
            console.error('Google API Error:', data);
            return res.status(response.status).json({ error: data.error?.message || 'Google API failed.' });
        }

        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
        res.json({ text: aiText });

    } catch (err) {
        console.error('Server Crash:', err);
        res.status(500).json({ error: 'Server internal error.' });
    }
});

// GROQ ROUTE (Standard Chat)
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    const key = process.env.GROQ_API_KEY;
    if (!key) return res.status(500).json({ error: 'Groq key missing.' });

    try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: messages,
                stream: false
            })
        });
        const data = await groqRes.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Groq failed.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
