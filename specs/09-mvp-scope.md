# 09 — MVP Kapsamı

## Amaç
Tek bir pilot salonda 6–8 hafta çalışacak, değeri kanıtlayan en küçük ürün.

## Dahil
- 3 hareket: squat, şınav, shoulder press (04)
- Telefon + tablet PWA, istasyon seansı (A1–A9)
- Üye girişi magic link ile; imzalı QR ile istasyon check-in/devir (çevrimdışı doğrulanabilir) ve cihaz eşleştirme
- Seans sahibi üyenin telefonu: telefon modu + istasyon moduna blok devri (03)
- Program şablonu oluşturma ve üyeye atama (C4, C5)
- Program motoru: set, tekrar, dinlenme, sonraki harekete otomatik geçiş (03)
- Anlık sesli + ekranlı form uyarısı (05)
- Üye geçmişi (B2–B4) ve basit yönetim paneli (C2–C4, C6)
- Gizlilik: video yok, rıza akışı, veri silme (07)
- Kalibrasyon modu (C10): personelin açtığı, ayrı rızalı, yalnız landmark kaydı (07); pilot eşik kalibrasyonu ve fixture üretimi için
- Çok kiracılık ve roller (06)
- TR/EN

## Hariç (MVP sonrası)
Analitik grafikleri (C7 tam), faturalama (C9), çoklu şube, süreli (`hold`) hareketler, telefonsuz üye için istasyon akışı, NFC check-in, harici sistem entegrasyonu (üyelik yazılımları), kablolu makine sensörleri, hareket kütüphanesini genişletme, antrenör uygulaması, bildirimler.

## Pilot kabul kriterleri
| Ölçüt | Hedef |
|---|---|
| Tekrar sayım doğruluğu (3 hareket) | ≥ %95 |
| Yanlış form alarmı | ≤ %10 |
| Uyarı gecikmesi (p95) | ≤ 250 ms |
| Seans tamamlama oranı | ≥ %70 |
| Çökme olmayan seans oranı | ≥ %99 |
| Pilot salon memnuniyeti (NPS) | ≥ 30 |

## Varsayımlar ve riskler
- Orta seviye tablet ve telefonlarda MediaPipe Pose yeterli FPS verir (erken spike ile doğrulanır, 10'a bakınız).
- MediaPipe `worldLandmarks` ile 3B eklem açıları önden ve yandan yeterince tutarlıdır (T2.2 spike'ında doğrulanır; değilse 04 metrik koordinatları güncellenir).
- Eşikler pilot verisiyle yeniden kalibre edilecek (kalibrasyon modu ile toplanan etiketli landmark dizileri). Pilot ölçütleri bu etiketli setle ölçülür:
  - Sayım doğruluğu = |sayılan − etiketlenen tekrar| / etiketlenen tekrar, set bazında.
  - Yanlış alarm oranı = etikette olmayan hata için verilen uyarı / toplam uyarı.
  - **Araç (T5.3):** `pnpm --filter @gymspot/api calibration:report`, şifreli kalibrasyon kayıtlarını (`--db`) veya indirilmiş JSON dosyalarını (`--files`) güncel kural paketleriyle motor üzerinden oynatır.
    - Eşleştirme: tahmin edilen tekrarlar etiketlerle sırasıyla eşleştirilir. Bir uyarı, verildiği sıradaki denemeye aittir.
    - Sayım, strict mod kuralıyla yapılır (yalnız `valid`).
    - Çıktı: hareket başına sayım doğruluğu, yanlış alarm oranı, hata bazında isabet ve kaçırma sayıları. Pilot hedefleri: sayımda ≥ %95, yanlış alarmda ≤ %10.
    - `--sweep <yol>=<değerler>` bir eşiği aday değerlerle dener. Yol örnekleri: `rep.target.enter` veya `faults.<id>.threshold` (kontroldeki son sayı).
- Salon wifi'si seans için zorunlu değil (çevrimdışı kuyruk var).

## Açık sorular
1. Pilot salon seçimi ve cihaz envanteri (tablet markası, kamera kalitesi).
2. Üyelik sistemi entegrasyonu gerekli mi (üye listesini içe aktarma)?
3. Fiyatlandırma: istasyon başına mı, üye başına mı?
