const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Install with: npm install node-fetch@2
require('dotenv').config();

const app = express();

// 1. Middleware
app.use(express.json());
app.use(cors()); // This allows your frontend to communicate with this server

// 2. The Proxy Route
app.post('/api/chat', async (req, res) => {
    const { messages, model, temperature, max_tokens } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "Server error: API Key not configured." });
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model || 'llama-3.1-8b-instant',
                messages: messages,
                temperature: temperature || 0.7,
                max_tokens: max_tokens || 1000
            })
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: 'Failed to communicate with Groq.' });
    }
});

// 3. Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
