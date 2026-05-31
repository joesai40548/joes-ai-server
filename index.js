const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// Set limits to 100mb for high-res images and audio
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

app.get('/', (req, res) => res.send('Joes AI Backend Status: Online'));

// -----------------------------------------------------------
// FIXED GEMINI ROUTE
// -----------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
    const { message, fileData, mimeType } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server: GEMINI_API_KEY is missing on Render settings.' });
    }

    try {
        // Changed v1beta to v1 for better stability
        // Model string 'gemini-1.5-flash' is the correct modern name
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

        const payload = {
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

        // If Google returns an error, send that error detail to the frontend
        if (!response.ok) {
            console.error('Google API Error Details:', data);
            return res.status(response.status).json({ 
                error: data.error?.message || 'Google API refused the request.' 
            });
        }

        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI could not process this specific file.";
        res.json({ text: aiResponse });

    } catch (err) {
        console.error('Server Crash:', err);
        res.status(500).json({ error: 'Internal Server Error. Check Render Logs.' });
    }
});

// Admin and Chat routes kept for your app logic
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    res.json({ isAdmin: email?.toLowerCase() === ADMIN_EMAIL?.toLowerCase() });
});

app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq key missing." });

    try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages })
        });
        const data = await groqRes.json();
        res.json(data);
    } catch (error) { res.status(500).json({ error: 'Groq API failure' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Active on Port ${PORT}`));
