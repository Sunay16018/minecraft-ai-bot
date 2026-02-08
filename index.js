const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const pvp = require('mineflayer-pvp').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require('express');

// --- RENDER İÇİN WEB SUNUCUSU (Botun kapanmaması için) ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Minecraft AI Bot Çalışıyor! 7/24 Aktif.'));
app.listen(PORT, () => console.log(`Web sunucusu ${PORT} portunda aktif.`));

// --- AYARLAR (Render Environment Variables'dan gelir) ---
const config = {
    apiKey: process.env.GEMINI_KEY,
    host: process.env.MC_HOST,
    port: parseInt(process.env.MC_PORT) || 25565,
    username: process.env.MC_USER || 'Gemini_AI',
    version: process.env.MC_VERSION || '1.20.1'
};

// Gemini Yapay Zeka Ayarları
const genAI = new GoogleGenerativeAI(config.apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", // Hızlı ve zeki model
    systemInstruction: `
    Sen uzman bir Minecraft botusun (Mineflayer kütüphanesi). 
    Görevin: Kullanıcının isteğine göre JavaScript kodu üretmek ve bunu çalıştırmak.
    
    KURALLAR:
    1. SADECE çalıştırılabilir JavaScript kodu ver. Açıklama yapma, Markdown (backticks) kullanma.
    2. 'bot' değişkeni zaten tanımlı.
    3. Kullanılabilir eklentiler: pathfinder, collectBlock, pvp, autoEat.
    4. Envanter kontrolü sorulursa 'bot.chat("Mesaj")' ile cevap ver.
    5. Bir şey toplaman istenirse 'collectBlock' kullan.
    6. Bir yere gitmen istenirse 'pathfinder' kullan.
    
    Örnek Cevaplar:
    - "Elmas kaz" -> bot.collectBlock.collect(bot.findBlock({matching: block => block.name === 'diamond_ore'}));
    - "Bana bak" -> const p = bot.players['OyuncuAdi']?.entity; if(p) bot.lookAt(p.position.offset(0, p.height, 0));
    `
});

let bot;

function startBot() {
    console.log("Bot sunucuya bağlanıyor...");
    
    bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version
    });

    // Eklentileri Yükle
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(pvp);
    bot.loadPlugin(autoEat);

    bot.on('spawn', () => {
        console.log("Bot oyuna girdi!");
        bot.autoEat.options.priority = 'foodPoints';
        bot.autoEat.options.bannedFood = [];
        bot.autoEat.options.eatingTimeout = 3;
        bot.chat("Sistemler aktif! Envanterimi ve çevremi algılıyorum.");
    });

    // ÖNEMLİ: Botun mevcut durumunu analiz eden fonksiyon
    function getGameState() {
        const items = bot.inventory.items().map(item => `${item.name} x${item.count}`).join(', ');
        const health = Math.round(bot.health);
        const food = Math.round(bot.food);
        const pos = bot.entity.position.toString();
        
        return `
        DURUM RAPORU:
        - Can: ${health}/20
        - Açlık: ${food}/20
        - Konum: ${pos}
        - Envanter: ${items || "Boş"}
        `;
    }

    bot.on('chat', async (username, message) => {
        if (username === bot.username) return;

        // Sadece ismimiz geçerse veya 'bot' denirse cevap verelim
        if (message.toLowerCase().includes(config.username.toLowerCase()) || message.toLowerCase().startsWith('bot')) {
            
            bot.chat("Düşünüyorum...");
            
            try {
                // AI'ya hem soruyu hem de o anki envanter/can durumunu gönderiyoruz
                const gameState = getGameState();
                const prompt = `
                DURUM: ${gameState}
                KULLANICI (${username}) İSTEĞİ: ${message}
                
                Eğer kullanıcı soru sorduysa (örn: kaç elmasın var), bot.chat("Cevap") şeklinde kod yaz.
                Eğer eylem istediyse (örn: gel, kaz, saldır), Mineflayer eylem kodunu yaz.
                `;

                const result = await model.generateContent(prompt);
                let code = result.response.text();

                // Temizlik: Markdown tırnaklarını kaldır
                code = code.replace(/```javascript/g, "").replace(/```/g, "").trim();

                console.log(`[AI KODU]: ${code}`);
                
                // Tehlikeli ama gerekli: Kodu çalıştır
                try {
                    eval(code); 
                } catch (e) {
                    bot.chat("Yazdığım kodda hata çıktı: " + e.message);
                }

            } catch (err) {
                console.error("AI Bağlantı Hatası:", err);
                bot.chat("Beynim dondu, API hatası!");
            }
        }
    });

    // Hata ve Yeniden Bağlanma Yönetimi
    bot.on('kicked', console.log);
    bot.on('error', console.log);
    
    bot.on('end', () => {
        console.log("Bağlantı koptu. 10 saniye sonra tekrar deneniyor...");
        setTimeout(startBot, 10000);
    });
}

startBot();
