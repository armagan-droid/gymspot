# 08 — Ekranlar (Telefon + Tablet)

Tek PWA, rota bazlı üç alan: **İstasyon/Seans**, **Üye**, **Yönetim**. Duyarlı arayüz: telefon (dikey/yatay), tablet (yatay öncelikli). Dokunma hedefi ≥ 48 px. Salon ortamı: uzaktan okunabilir büyük yazı, yüksek kontrast, koyu tema varsayılan.

## Tasarım ilkeleri
- Seans ekranında **tek odak**: sayaç + hareket adı + uyarı. Başka hiçbir şey dikkat dağıtmaz.
- Ciddi, sakin görünüm. Oyun öğeleri (puan, rozet, karakter) yok.
- Türkçe varsayılan, İngilizce ikinci dil (i18n).
- Erişilebilirlik: renk tek başına bilgi taşımaz (ikon+metin), ses uyarısı kapatılabilir.

## A) İstasyon / Seans ekranları
| # | Ekran | Cihaz | İçerik |
|---|---|---|---|
| A1 | Cihaz eşleştirme | Tablet | Yönetici kodu ile cihazı istasyona bağla |
| A2 | Bekleme / Check-in | Tablet | "Başlamak için telefonundaki QR'ı kameraya göster". Tablet, üye telefonundaki imzalı QR'ı okur (çevrimdışı da çalışır, 07) |
| A3 | Kamera kurulum sihirbazı | Her ikisi | Kamera önizleme + çizgisel çerçeve, "tüm vücudun görünüyor" kontrolü, mesafe/açı ipucu, algılanan görünüm (önden/yandan) ve bu görünümde hangi form kontrollerinin aktif olduğu. Görünüm hareketin desteklediği listede değilse set başlamaz (04) |
| A4 | Antrenman özeti (başlamadan) | Her ikisi | Bugünün programı, ilk hareket, "Başla" |
| A5 | **Aktif set** | Her ikisi | Kamera + iskelet katmanı (açılabilir), büyük tekrar sayacı (x / hedef), set sayısı, anlık uyarı bandı, yarım tekrar için kısa "sayılmadı" işareti, ses/duraklat/seti bitir düğmeleri |
| A6 | Dinlenme | Her ikisi | Geri sayım, sonraki set/hareket önizleme, "Hazırım", set özeti |
| A7 | Sıradaki istasyona geç | Her ikisi | "Sıradaki: Squat Rafı 2". Telefonda handoff QR'ı, tablette "Telefonundan devam et" |
| A8 | Seans sonu özeti | Her ikisi | Toplam set/tekrar, temiz tekrar oranı, en sık hata, "Çıkış" |
| A9 | Hata/Bağlantı durumları | Her ikisi | Kamera izni yok, kişi görünmüyor, ağ yok (çevrimdışı mod bildirimi) |

## B) Üye alanı (telefon öncelikli)
| # | Ekran | İçerik |
|---|---|---|
| B1 | Giriş + rıza | Davet/magic link ile giriş (e-posta veya telefon gir → bağlantı gönderildi), ilk girişte aydınlatma ve açık rıza onayı (07) |
| B2 | Ana sayfa | Bugünün antrenmanı, haftalık tamamlama, "Seansı başlat" (telefon modu) ve "İstasyona bağlan" (handoff QR) |
| B3 | Programım | Gün ve hareket listesi |
| B4 | Seans geçmişi | Liste + seans detayı (set bazlı tekrar, hatalar) |
| B5 | İlerleme | Hareket bazlı tekrar ve temiz tekrar oranı trendi (sade grafikler) |
| B6 | Ayarlar | Dil, ses, rızayı geri çekme, veri dışa aktarma/silme talebi |

## C) Yönetim paneli (tablet/masaüstü, telefonda sade)
| # | Ekran | Rol | İçerik |
|---|---|---|---|
| C1 | Giriş | Personel | E-posta/şifre |
| C2 | Genel bakış | Yönetici | Aktif seans, bugünkü seans sayısı, istasyon sağlığı |
| C3 | İstasyonlar | Yönetici | Liste, cihaz durumu (heartbeat), eşleştirme, hareket ataması |
| C4 | Üyeler | Yönetici/Antrenör | Arama, üye detayı, program atama |
| C5 | Program şablonları | Antrenör | Şablon oluştur/düzenle (hareket, set, tekrar, dinlenme, mod) |
| C6 | Üye detayı | Antrenör | Seans geçmişi, en sık hatalar, devamlılık |
| C7 | Analitik | Yönetici | İstasyon kullanımı (saat bazlı), aktif üye oranı, devamlılık |
| C8 | Ayarlar | Sahip | Şube, kullanıcılar, strict/lenient varsayılanı, saklama süresi, bilgilendirme şablonu |
| C9 | Faturalama | Sahip | Plan, istasyon sayısı, faturalar |
| C10 | Kalibrasyon kaydı | Yönetici/Sahip | Katılımcı rızası (ayrı metin), hareket seçimi, etiketleme (doğru/hatalı + hata türü), kayıt göstergesi. Yalnız landmark kaydeder (07) |

## Duyarlı davranış
| Alan | Telefon dikey | Telefon yatay | Tablet yatay |
|---|---|---|---|
| A5 Aktif set | Kamera üstte, sayaç altta | Kamera solda, sayaç sağda | Kamera geniş, sayaç ve uyarı yanda |
| B* Üye | Tek sütun | Tek sütun | İki sütun |
| C* Yönetim | Kart listesi | Kart listesi | Tablo + yan panel |

## Kabul kriterleri
- AC-8.1: A5 ekranı 360×640 telefon ve 1280×800 tablet görünümlerinde taşma olmadan çalışır (görsel test).
- AC-8.2: A5'te sayaç, uyarı ve hareket adı 2 metre mesafeden okunabilir boyutta (min sayaç yüksekliği ekranın %25'i).
- AC-8.3: Tüm A-ekranları kamera izni reddedilince açıklayıcı hata ve elle kayıt seçeneği sunar.
- AC-8.4: Koyu/açık tema ve TR/EN arasında geçiş çalışır.
- AC-8.5: A3, hareketin desteklemediği görünümde seti başlatmaz ve doğru görünüm ipucunu gösterir.
