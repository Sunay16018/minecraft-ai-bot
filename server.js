// ======================
// GEREKLİ KÜTÜPHANELER
// ======================
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const collectBlock = require('mineflayer-collectblock').plugin;
const pvp = require('mineflayer-pvp').plugin;

// ======================
// SUNUCU AYARLARI
// ======================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Gemini AI başlatma
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ======================
// GENEL DEĞİŞKENLER
// ======================
let bot = null;
let botDurumu = 'HAZIR'; // HAZIR, BAĞLANIYOR, BAĞLI
let sohbetGeçmişi = [];

// ======================
// MINECRAFT BOT YÖNETİMİ
// ======================
function minecraftBotuOluştur(serverIp, kullaniciAdi, versiyon) {
  return new Promise((resolve, reject) => {
    botDurumu = 'BAĞLANIYOR';
    io.emit('bot-durumu', botDurumu);
    io.emit('sistem-mesajı', `🔌 ${serverIp} sunucusuna ${kullaniciAdi} olarak bağlanıyor...`);
    
    bot = mineflayer.createBot({
      host: serverIp,
      username: kullaniciAdi,
      version: versiyon,
      hideErrors: false
    });
    
    // Eklentileri yükle
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(pvp);
    require('mineflayer-pathfinder').Movements;
    
    // Olay dinleyicileri
    bot.once('spawn', () => {
      botDurumu = 'BAĞLI';
      io.emit('bot-durumu', botDurumu);
      io.emit('sistem-mesajı', '✅ Minecraft sunucusuna başarıyla bağlandı!');
      resolve(bot);
    });
    
    bot.on('chat', (kullaniciAdi, mesaj) => {
      if (kullaniciAdi === bot.username) return;
      io.emit('sistem-mesajı', `💬 ${kullaniciAdi}: ${mesaj}`);
    });
    
    bot.on('death', () => {
      io.emit('sistem-mesajı', '☠️ Bot öldü! Yeniden doğuyor...');
    });
    
    bot.on('error', (hata) => {
      io.emit('sistem-mesajı', `❌ Bot hatası: ${hata.message}`);
      botDurumu = 'HAZIR';
      io.emit('bot-durumu', botDurumu);
      reject(hata);
    });
    
    bot.on('kicked', (sebep) => {
      io.emit('sistem-mesajı', `🚫 Sunucudan atıldı: ${sebep}`);
      botDurumu = 'HAZIR';
      io.emit('bot-durumu', botDurumu);
    });
    
    bot.on('end', () => {
      io.emit('sistem-mesajı', '🔌 Sunucu bağlantısı kesildi');
      botDurumu = 'HAZIR';
      io.emit('bot-durumu', botDurumu);
    });
  });
}

// ======================
// GEMINI AI ENTEGRASYONU
// ======================
async function minecraftKoduOluştur(kullaniciKomutu, botBilgisi) {
  const sistemTalimatı = `
    Sen bir Minecraft botu kodlama asistanısın. SADECEC Mineflayer API kullanarak JavaScript kodu üret.
    
    BOT BİLGİSİ:
    - Bot konumu: ${botBilgisi.konum}
    - Can: ${botBilgisi.can}/20
    - Açlık: ${botBilgisi.açlık}/20
    - Envanter: ${botBilgisi.envanter}
    - Yakındaki varlıklar: ${botBilgisi.varlıklar}
    
    KURALLAR:
    1. SADECE çalıştırılabilir JavaScript kodu üret
    2. 'bot' nesnesini kullan (zaten tanımlı)
    3. Açıklama, yorum, markdown EKLEME
    4. Kod güvenli olsun, sonsuz döngü oluşturmasın
    5. Hataları try-catch ile yakala
    6. Durum mesajları için: io.emit('sistem-mesajı', 'mesajınız')
    
    Kullanılabilir eklentiler:
    - bot.pathfinder (yol bulma)
    - bot.collectBlock.collect(blok) (blok toplama)
    - bot.pvp (savaş)
    
    KULLANICI İSTEĞİ: ${kullaniciKomutu}
    
    ÜRETİLEN KOD:
  `;
  
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp", // Güncel model
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
      }
    });
    
    const sonuç = await model.generateContent(sistemTalimatı);
    const yanıt = await sonuç.response;
    return yanıt.text().trim();
  } catch (hata) {
    console.error('Gemini API hatası:', hata);
    throw new Error('Kod oluşturulamadı');
  }
}

// ======================
// SOCKET.IO İŞLEYİCİLERİ
// ======================
io.on('connection', (socket) => {
  console.log('Yeni istemci bağlandı');
  
  // Başlangıç durumunu gönder
  socket.emit('bot-durumu', botDurumu);
  socket.emit('sohbet-geçmişi', sohbetGeçmişi);
  
  // Minecraft bağlantısı
  socket.on('minecraft-baglan', async (veri) => {
    try {
      await minecraftBotuOluştur(veri.serverIp, veri.kullaniciAdi, veri.versiyon);
      socket.emit('sistem-mesajı', '✅ Bağlantı başarılı!');
    } catch (hata) {
      socket.emit('sistem-mesajı', `❌ Bağlantı başarısız: ${hata.message}`);
    }
  });
  
  // AI komutu işleme
  socket.on('ai-komut', async (veri) => {
    if (!bot || botDurumu !== 'BAĞLI') {
      socket.emit('sistem-mesajı', '❌ Bot Minecraft sunucusuna bağlı değil');
      return;
    }
    
    // Bot bilgilerini topla
    const botBilgisi = {
      konum: bot.entity.position ? 
        `x:${Math.round(bot.entity.position.x)}, y:${Math.round(bot.entity.position.y)}, z:${Math.round(bot.entity.position.z)}` : 'Bilinmiyor',
      can: bot.health || 0,
      açlık: bot.food || 0,
      envanter: bot.inventory ? 
        bot.inventory.items.map(eşya => `${eşya.name}(${eşya.count})`).join(', ') : 'Boş',
      varlıklar: Object.keys(bot.entities).slice(0, 5)
        .map(id => bot.entities[id].name).filter(Boolean).join(', ') || 'Yok'
    };
    
    // Kullanıcı mesajını kaydet
    sohbetGeçmişi.push({ rol: 'kullanici', içerik: veri.komut });
    io.emit('sohbet-mesajı', { rol: 'kullanici', içerik: veri.komut });
    
    // Kod oluştur ve çalıştır
    try {
      socket.emit('sistem-mesajı', '🤖 Kod oluşturuluyor...');
      const üretilenKod = await minecraftKoduOluştur(veri.komut, botBilgisi);
      
      socket.emit('sistem-mesajı', '⚡ Kod çalıştırılıyor...');
      
      // Güvenlik Uyarısı: eval() kullanımı üretimde RİSKLİDİR!
      // Gerçek uygulamada VM2 veya benzeri sandbox çözümleri kullanın
      const çalıştırmaKodu = `
        (async () => {
          try {
            ${üretilenKod}
            io.emit('sistem-mesajı', '✅ Görev başarıyla tamamlandı');
          } catch (hata) {
            io.emit('sistem-mesajı', \`❌ Çalıştırma hatası: \${hata.message}\`);
            console.error('Çalıştırma hatası:', hata);
          }
        })()
      `;
      
      eval(çalıştırmaKodu);
      
      // AI yanıtını kaydet
      sohbetGeçmişi.push({ rol: 'asistan', içerik: `Kod çalıştırıldı: ${veri.komut}` });
      io.emit('sohbet-mesajı', { 
        rol: 'asistan', 
        içerik: `"${veri.komut}" için kod çalıştırdım` 
      });
      
    } catch (hata) {
      socket.emit('sistem-mesajı', `❌ AI hatası: ${hata.message}`);
      console.error('AI işleme hatası:', hata);
    }
  });
  
  // Bağlantı kesme
  socket.on('disconnect', () => {
    console.log('İstemci bağlantısı kesildi');
  });
});

// ======================
// DOSYA SERVİSİ
// ======================
app.use(express.static('public'));

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// ======================
// SUNUCUYU BAŞLAT
// ======================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
  console.log(`🌐 Tarayıcıda aç: http://localhost:${PORT}`);
});
