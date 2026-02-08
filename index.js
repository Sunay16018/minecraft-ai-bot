const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const pvp = require('mineflayer-pvp').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- WEB SUNUCUSU KURULUMU ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// HTML Arayüzü (Render Linkine Tıklayınca Bu Açılacak)
app.get('/', (req, res) => {
    res.send(`
    <html>
    <head>
        <title>MC AI Kontrol Paneli</title>
        <style>
            body { background-color: #1e1e1e; color: #0f0; font-family: monospace; padding: 20px; }
            input, button { padding: 10px; background: #333; color: white; border: 1px solid #0f0; margin: 5px; }
            #logs { height: 400px; overflow-y: scroll; border: 1px solid #444; padding: 10px; background: black; margin-top: 20px; }
            .user-msg { color: cyan; }
            .bot-msg { color: yellow; }
            .ai-action { color: magenta; }
        </style>
    </head>
    <body>
        <h2>🤖 Minecraft AI Başlatıcı</h2>
        <div id="controls">
            <input id="host" placeholder="Sunucu IP (Örn: oyna.server.com)">
            <input id="username" placeholder="Bot İsmi" value="GeminiBot">
            <input id="version" placeholder="Sürüm (Örn: 1.16.5 veya 1.20.1)">
            <button onclick="startBot()">BAĞLAN</button>
            <button onclick="stopBot()" style="color:red">BAĞLANTIYI KES</button>
        </div>
        
        <h3>Canlı Loglar & Sohbet</h3>
        <div id="logs"></div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const logDiv = document.getElementById('logs');

            function startBot() {
                const host = document.getElementById('host').value;
                const username = document.getElementById('username').value;
                const version = document.getElementById('version').value;
                socket.emit('start-bot', { host, username, version });
            }

            function stopBot() {
                socket.emit('stop-bot');
            }

            function addLog(msg, type) {
                const div = document.createElement('div');
                div.innerHTML = msg;
                div.className = type;
                logDiv.appendChild(div);
                logDiv.scrollTop = logDiv.scrollHeight;
            }

            socket.on('log', (data) => addLog(data.msg, data.type));
        </script>
    </body>
    </html>
    `);
});

// --- AI VE BOT MANTIĞI ---
let bot;
const apiKey = process.env.GEMINI_API_KEY; // Render Environment Variable'dan alır
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Sen Mineflayer kütüphanesini kullanan bir Minecraft botusun. Kullanıcının isteklerine göre JavaScript kodu üretip kendi üzerinde çalıştırıyorsun. Sadece kod ver."
});

// Bot Durumu
let isRunning = false;

io.on('connection', (socket) => {
    socket.emit('log', { msg: 'Panel Hazır. Sunucu bilgilerini girip bağlanın.', type: 'system' });

    socket.on('start-bot', (data) => {
        if (isRunning) return socket.emit('log', { msg: 'Bot zaten çalışıyor!', type: 'system' });
        
        if (!apiKey) return socket.emit('log', { msg: 'HATA: Render ayarlarında GEMINI_API_KEY bulunamadı!', type: 'system' });

        createBot(data.host, data.username, data.version, socket);
    });

    socket.on('stop-bot', () => {
        if (bot) {
            bot.quit();
            bot = null;
            isRunning = false;
            io.emit('log', { msg: 'Bot bağlantısı manuel olarak kesildi.', type: 'system' });
        }
    });
});

function createBot(host, username, version, socket) {
    io.emit('log', { msg: `Bağlanılıyor: ${host} (${version})...`, type: 'system' });

    try {
        bot = mineflayer.createBot({
            host: host,
            username: username,
            version: version,
            hideErrors: true
        });

        isRunning = true;

        // Eklentiler
        bot.loadPlugin(pathfinder);
        bot.loadPlugin(collectBlock);
        bot.loadPlugin(pvp);
        bot.loadPlugin(autoEat);

        bot.on('spawn', () => {
            io.emit('log', { msg: '✅ Bot Oyuna Girdi!', type: 'system' });
            bot.chat("AI Sistemleri Aktif. Emirlerinizi bekliyorum.");
        });

        bot.on('chat', async (user, message) => {
            if (user === bot.username) return;

            // Web Paneline Log Düş
            io.emit('log', { msg: `<b>${user}:</b> ${message}`, type: 'user-msg' });

            // Sadece ismimiz geçerse veya 'bot' denirse işlem yap
            if (message.toLowerCase().includes(bot.username.toLowerCase()) || message.toLowerCase().startsWith('bot')) {
                
                io.emit('log', { msg: '🧠 AI Düşünüyor...', type: 'ai-action' });

                try {
                    // Botun o anki durumunu al
                    const status = `
                        Konum: ${bot.entity.position}
                        Envanter: ${bot.inventory.items().map(i => i.name).join(', ')}
                        Can: ${bot.health}
                    `;

                    const prompt = `
                    DURUM: ${status}
                    İSTEK: "${message}" (Kullanıcı: ${user})
                    
                    GÖREV: Bu isteği yerine getirmek için Mineflayer JavaScript kodu yaz.
                    - Konuşmak için: bot.chat("mesaj")
                    - Hareket için: bot.pathfinder...
                    - Blok kırmak için: bot.collectBlock...
                    - Saldırmak için: bot.pvp...
                    
                    SADECE KODU VER. Markdown kullanma.
                    `;

                    const result = await model.generateContent(prompt);
                    let code = result.response.text().replace(/```javascript|```/g, "").trim();

                    io.emit('log', { msg: `💻 Çalıştırılan Kod: ${code.substring(0, 100)}...`, type: 'ai-action' });
                    
                    // Kodu Çalıştır
                    eval(code); 

                } catch (err) {
                    console.error(err);
                    bot.chat("Hata oluştu.");
                    io.emit('log', { msg: `Hata: ${err.message}`, type: 'system' });
                }
            }
        });

        bot.on('end', () => {
            isRunning = false;
            io.emit('log', { msg: '❌ Bağlantı Koptu.', type: 'system' });
        });

        bot.on('error', (err) => {
            io.emit('log', { msg: `Hata: ${err.message}`, type: 'system' });
        });

    } catch (e) {
        io.emit('log', { msg: `Başlatma Hatası: ${e.message}`, type: 'system' });
        isRunning = false;
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor.`);
});
