# 02 — Mimari

## Karar özeti
| Konu | Karar | Gerekçe |
|---|---|---|
| İstemci | React + TypeScript + Vite, **PWA** | Telefon ve tablette tek kod; mağaza onayı yok; kamera erişimi `getUserMedia` |
| Poz tahmini | **MediaPipe Pose (Tasks Vision)**, tarayıcıda WASM/WebGL | Cihaz üzerinde, video sunucuya gitmez |
| Çekirdek mantık | `packages/engine` saf TypeScript | Kamerasız test, istemci ve ileride sunucuda aynı kod |
| API | Node.js + Fastify + TypeScript | Hızlı, şema doğrulamalı |
| Veritabanı | PostgreSQL (satır bazlı tenant izolasyonu) | Olgun, RLS desteği |
| Kimlik | E-posta/şifre (personel), magic link (üye), imzalı kısa ömürlü QR (istasyon check-in/devir), cihaz token'ı (tablet) | Salon akışına uygun; çevrimdışı doğrulanabilir (07) |
| Seans sahipliği | **Üyenin telefonu** (istasyon tableti blok bazında yürütücü) | Çok istasyonlu seans çevrimdışı da sürer |
| Gerçek zamanlı | Gerekirse WebSocket (panel canlı istasyon durumu) | MVP'de polling yeterli |
| Dağıtım | Tek bölge, konteyner, yönetilen Postgres | MVP sadeliği |

## Monorepo
```
apps/
  web/        # PWA: üye + tablet istasyon + yönetim paneli (rota bazlı)
  api/        # REST API
packages/
  engine/     # program motoru, kural motoru, tekrar sayıcı (saf TS)
  shared/     # Zod şemaları, tipler, i18n anahtarları
exercises/    # hareket kural paketleri (JSON)
specs/
```

## Akış (istasyon seansı)
```
Kamera → MediaPipe Pose → landmarks (bellekte)
      → engine.rep-counter + engine.rule-evaluator
      → olaylar (rep, fault, set_complete)
      → program-engine durum makinesi
      → UI (sayaç, uyarı, ses) 
      → olaylar API'ye toplu gönderilir (video/landmark gönderilmez)
```

## Seans sahipliği
- Seans durumu ve imleç üyenin telefonunda yaşar (IndexedDB), sunucu senkron kopyadır.
- **Telefon modu:** telefon standa konur, motoru kendisi çalıştırır.
- **İstasyon modu:** telefon handoff QR'ı gösterir, tablet okur ve o bloğu yürütür (03, "Devir protokolü"). Tablet sonuçları kendi kuyruğundan API'ye yollar, telefon sunucu senkronuyla öğrenir.
- MVP'de telefonu olmayan üye için istasyon akışı yoktur (personel elle kayıt yapabilir).

## Çevrimdışı dayanıklılık
- Seans sırasında ağ kopsa bile seans devam eder; olaylar IndexedDB kuyruğunda tutulur, bağlantı gelince gönderilir (idempotent, `event_id` ile).
- Program ve kural paketleri seans başlamadan önbelleğe alınır.

## Performans bütçesi
- Poz işleme ≥ 15 FPS orta seviye tablette, hedef 24–30 FPS.
- Kare → uyarı gecikmesi ≤ 250 ms.
- İlk yükleme (önbellekli) ≤ 3 sn.
- Model ağırlıkları PWA ile önbelleğe alınır.

## Cihaz kurulumu
- **Tablet (istasyon):** sabit stand, yatay, kamera hareketi tam görecek şekilde. Kurulum sihirbazı açı/mesafe kontrolü yapar (08'e bakınız).
- **Telefon:** üye kendi telefonunu standa koyar; aynı akış.

## Modüller ve sınırları
- `engine` DOM, ağ, kamera bilmez. Girdi: `Frame[]`; çıktı: `EngineEvent[]`.

```ts
Frame {
  t: number                       // ms, monoton
  image: Landmark2D[33]           // normalize [0,1] görüntü koordinatı (x, y, z, visibility)
  world: Landmark3D[33]           // MediaPipe worldLandmarks, metre, kalça merkezli
}
```
Hangi metriğin hangi koordinatı kullandığı 04'teki metrik tablosundadır.
- `web` engine'i kullanır, poz modeli ve UI'dan sorumludur.
- `api` iş kuralları, yetki, kalıcılık. Engine'i çağırmaz (MVP).

## Platform riskleri (T2.2 spike'ında doğrulanır)
- **Ekran uyku:** istasyon/seans sırasında Screen Wake Lock API; desteklenmezse uyarı.
- **Ses otomatik çalma:** tarayıcılar ses için kullanıcı etkileşimi ister. Ses bağlamı "Başla"/check-in dokunuşunda açılır ve seans boyunca açık tutulur.
- **iOS Safari:** ana ekrana eklenmiş PWA'da `getUserMedia` ve WebGL davranışı sürüme göre değişir; desteklenen minimum iOS sürümü spike sonucuyla belirlenir.
- **Tablet kiosk:** istasyon tableti için işletim sistemi kiosk/sabitleme modu kurulum kılavuzunda (T5.4) anlatılır.
- **Model varyantı:** MediaPipe Pose lite/full/heavy arasından FPS–doğruluk dengesine göre seçim yapılır. `worldLandmarks` doğruluğu yan/ön görünümde ölçülür (04 metrik koordinatları).

## Gözlemlenebilirlik
Yapılandırılmış log, istek kimliği, istasyon cihazı için heartbeat (60 sn). Hata izleme için Sentry benzeri bir servis (video/landmark içermeyen).
