# 00 — Vizyon

## Problem
Spor salonlarında üyelerin çoğu programını bilmiyor, formunu kontrol edecek kimse yok, antrenmanlarını elle kaydetmiyor. Sonuç: yaralanma, hayal kırıklığı, düşük devamlılık (üye kaybı). Salon sahipleri hangi ekipmanın ne kadar kullanıldığını ve üyelerin gerçekten ilerleyip ilerlemediğini bilmiyor.

## Çözüm
Her istasyonda (veya üyenin kendi telefonunda) çalışan bir **program takipli form koçu**:
1. Üye istasyona girer (QR/NFC), sistem o günkü programını getirir.
2. Kamera hareketi izler, tekrarı sayar.
3. Form hatasında anlık kısa uyarı verir (ses + ekran).
4. Hedef tekrar/set tamamlanınca otomatik dinlenmeye, sonra sonraki sete/harekete geçer.
5. Seans kaydı otomatik tutulur; üye, PT ve salon sahibi kendi görünümünü görür.

## Ürün türü
Çok kiracılı **SaaS**. Müşteri = spor salonu (tenant). Oyunlaştırma **yok**; ton ciddi, profesyonel, sakin.

## Kullanıcılar (roller)
| Rol | İhtiyaç |
|---|---|
| Üye | Programını takip et, formunu düzelt, ilerlemesini gör |
| PT / Antrenör | Üyeye program ata, seans ve form hatalarını incele |
| Salon yöneticisi | İstasyon kullanımı, üye devamlılığı, cihaz sağlığı |
| Platform yöneticisi (biz) | Tenant yönetimi, faturalama, destek |

## Hedef cihazlar
Telefon (üye kendi cihazı, dikey/yatay) ve tablet (istasyona sabit, yatay). Tek kod tabanı, duyarlı arayüz, PWA olarak kurulabilir.

## Kapsam dışı (şimdilik)
- Oyunlaştırma, sıralama tabloları, rozetler
- Beslenme takibi, giyilebilir cihaz entegrasyonu
- Kablolu makine/sensör desteği (sadece kamera)
- Video kaydı ve geri izleme
- Tıbbi/fizyoterapi teşhisi

## Başarı ölçütleri
- Tekrar sayım doğruluğu ≥ %95 (pilot hareketlerinde)
- Yanlış form alarmı oranı ≤ %10 (uyarıların)
- Pilot salonda 6 haftada seans tamamlama oranı ≥ %70
- Salon memnuniyeti (NPS) ≥ 30
