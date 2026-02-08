const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- GEMINI KURULUMU ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Sen bir Minecraft AI asistanısın. Adın Gemini. Kullanıcı seninle sohbet eder. Eğer kullanıcı bir sunucuya girmeni veya bir şey yapmanı isterse, Mineflayer kodu üretirsin. Kod üretirken sadece JavaScript yaz, açıklama yapma."
});

let bot = null;

// --- MODERN GEMINI TASARIMI (HTML/CSS) ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Gemini MC AI</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { background: #131314; color: #e3e3e3; font-family: 'Segoe UI', sans-serif; display: flex; flex-direction: column; height: 100vh; margin: 0; }
            #chat-container { flex: 1; overflow-y: auto; padding: 40px 20%; display: flex; flex-direction: column; gap: 20px; }
            .msg { max-width: 80%; padding: 12px 18px; border-radius: 20px; line-height: 1.5; font-size: 16px; }
            .user-msg { align-self: flex-end; background: #2b2a33; border-radius: 20px 20px 4px 20px; }
            .ai-msg { align-self: flex-start; background: transparent; }
            .input-area { padding: 20px 20%; display: flex; gap: 10px; background: #131314; }
            input { flex: 1; background: #1e1f20; border: none; padding: 15px 25px; border-radius: 30px; color: white; outline: none; font-size: 16px; }
            button { background: #4b91f1; border: none; color: white; padding: 10px 20px; border-radius: 30px; cursor: pointer; font-weight: bold; }
            .status { font-size: 12px; color: #888; text-align: center; margin-bottom: 10px; }
        </style>
    </head>
    <body>
        <div id="chat-container">
            <div class="msg ai-msg">Merhaba! Ben Gemini. Minecraft dünyasında sana nasıl yardımcı olabilirim?</div>
        </div>
        <div class="status" id="bot-status">Bot Boşta</div>
        <div class="input-area">
            <input id="user-input" placeholder="Bir sunucuya gir veya bir komut ver..." onkeypress="if(event.key==='Enter') send()">
            <button onclick="send()">Gönder</button>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const container = document.getElementById('chat-container');

            function addMsg(text, type) {
                const div = document.createElement('div');
                div.className = 'msg ' + type;
                div.innerText = text;
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
            }

            function send() {
                const input = document.getElementById('user-input');
                if(!input.value) return;
                addMsg(input.value, 'user-msg');
                socket.emit('ai-query', input.value);
                input.value = '';
            }

            socket.on('ai-response', (text) => addMsg(text, 'ai-msg'));
            socket.on('status', (s) => document.getElementById('bot-status').innerText = s);
        </script>
    </body>
    </html>
    `);
});

// --- AI VE BOT MANTIĞI ---
io.on('connection', (socket) => {
    socket.on('ai-query', async (query) => {
        try {
            // AI'ya durumu ve isteği gönder
            const botInfo = bot ? `Bot şu an ${bot.host} sunucusunda, can: ${bot.health}` : "Bot şu an hiçbir sunucuda değil.";
            const prompt = `Durum: ${botInfo}. Kullanıcı isteği: "${query}". Cevap ver ve gerekiyorsa kod yaz.`;
            
            const result = await model.generateContent(prompt);
            const response = result.response.text();
            
            // Eğer AI bağlantı kodu ürettiyse (Örn: createBot('ip'))
            if (response.includes('mineflayer.createBot')) {
                // Burada AI'nın yazdığı kodu güvenli bir şekilde ayrıştırıp botu başlatıyoruz
                // Örnek basitleştirilmiş mantık:
                const match = query.match(/(\d+\.\d+\.\d+\.\d+|[\w\.]+)/); // IP yakalamaya çalış
                if(match) {
                    startMCBot(match[0], "Gemini_Bot", "1.20.1", socket);
                }
            }

            // AI'nın cevabını arayüze gönder
            socket.emit('ai-response', response.replace(/```javascript|```/g, ""));
            
            // Eğer kod varsa eval ile çalıştır
            if (response.includes('bot.')) {
                try { eval(response.replace(/```javascript|```/g, "")); } catch(e){}
            }

        } catch (err) {
            socket.emit('ai-response', "Bir hata oluştu: " + err.message);
        }
    });
});

function startMCBot(host, user, ver, socket) {
    if (bot) bot.quit();
    
    bot = mineflayer.createBot({ host, username: user, version: ver });
    socket.emit('status', `Bağlanıyor: ${host}...`);

    bot.on('spawn', () => {
        socket.emit('status', `Bağlı: ${host}`);
        bot.chat("Gemini AI sisteme giriş yaptı.");
    });

    bot.on('end', () => socket.emit('status', "Bağlantı Kesildi"));
}

server.listen(process.env.PORT || 3000);
