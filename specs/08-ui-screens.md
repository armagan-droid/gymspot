# 08 — Ekranlar (Telefon + Tablet)

Tek PWA, rota bazlı üç alan: **İstasyon/Seans**, **Üye**, **Yönetim**. Duyarlı arayüz: telefon (dikey/yatay), tablet (yatay öncelikli). Dokunma hedefi ≥ 48 px. Salon ortamı: uzaktan okunabilir büyük yazı, yüksek kontrast, koyu tema varsayılan.

## Tasarım ilkeleri
- Seans ekranında **tek odak**: sayaç + hareket adı + uyarı. Başka hiçbir şey dikkat dağıtmaz.
- Ciddi, sakin görünüm. Oyun öğeleri (puan, rozet, karakter) yok.
- Türkçe varsayılan, İngilizce ikinci dil (i18n).
- Erişilebilirlik: renk tek başına bilgi taşımaz (ikon+metin), ses uyarısı kapatılabilir.

## A) İstasyon / Seans ekranları
Rotalar: tablet için `/station` (eşleştirilmemişse A1, sonra A2 → A3 → aktif blok → "Telefonundan devam et" → A2; tek bir durum makinesi) ve `/station/pair`. Telefonla seans için `/member/session` (A4 → A3 → A5/A6 → devirde A7 → A8). Kamera ve motor ekranları ana paketten ayrı yüklenir.

| # | Ekran | Cihaz | İçerik |
|---|---|---|---|
| A1 | Cihaz eşleştirme | Tablet | Yönetici kodu ile cihazı istasyona bağla |
| A2 | Bekleme / Check-in | Tablet | "Başlamak için telefonundaki QR'ı kameraya göster". Tablet, üye telefonundaki imzalı QR'ı okur (çevrimdışı da çalışır, 07) |
| A3 | Kamera kurulum sihirbazı | Her ikisi | Kamera önizleme + çizgisel çerçeve (önizlemenin üstünde algılanan iskelet ve kenar payını gösteren kılavuz çerçeve; çerçeve hazırken yeşil, değilken sarı; görünmeyen zorunlu eklemler kırmızı), "tüm vücudun görünüyor" kontrolü, mesafe/açı ipucu, algılanan görünüm (önden/yandan) ve bu görünümde hangi form kontrollerinin aktif olduğu. Görünüm hareketin desteklediği listede değilse set başlamaz (04) |
| A4 | Antrenman özeti (başlamadan) | Her ikisi | Bugünün programı, ilk hareket, "Başla" |
| A5 | **Aktif set** | Her ikisi | Kamera + iskelet katmanı (öntanımlı açık, düğmeyle kapatılabilir; bir form uyarısı gösterilirken o hatanın kontrol ettiği eklemler kırmızı vurgulanır), büyük tekrar sayacı (x / hedef), set sayısı, anlık uyarı bandı, yarım tekrar için kısa "sayılmadı" işareti, ses/duraklat/seti bitir düğmeleri |
| A6 | Dinlenme | Her ikisi | Geri sayım, sonraki set/hareket önizleme, "Hazırım", set özeti |
| A7 | Sıradaki istasyona geç | Her ikisi | "Sıradaki: Squat Rafı 2". Telefonda handoff QR'ı, tablette "Telefonundan devam et" |
| A8 | Seans sonu özeti | Her ikisi | Toplam set/tekrar, temiz tekrar oranı, en sık hata, "Çıkış" |
| A9 | Hata/Bağlantı durumları | Her ikisi | Kamera izni yok, kişi görünmüyor, ağ yok (çevrimdışı mod bildirimi) |
| A5-e | Elle kayıt (kamerasız) | Her ikisi | Kamera izni ya da rıza yoksa A3/A9'daki "Elle kaydet" ile açılır: hareket, set (x / toplam), yapılan tekrar sayısı (hedefle öntanımlı), "Seti kaydet"; ardından normal dinlenme (A6). Seans boyunca kamera açılmaz. |

## B) Üye alanı (telefon öncelikli)
| # | Ekran | İçerik |
|---|---|---|
| B1 | Giriş + rıza | Davet/magic link ile giriş. Bağlantıdaki token'ın tenant öneki uygulamaya salonu tanıtır ve hatırlanır; sonraki girişlerde e-posta yeterlidir. Salon bilinmiyorsa "salonunun gönderdiği davet bağlantısını kullan" denir. İlk girişte ve rıza metni sürümü değiştiğinde aydınlatma ve açık rıza istenir; "şimdi değil" denebilir (kamera açılmaz) |
| B2 | Ana sayfa | Bugünün antrenmanı, haftalık tamamlama, "Seansı başlat" (telefon modu) ve "İstasyona bağlan" (handoff QR) |
| B3 | Programım | Gün ve hareket listesi |
| B4 | Seans geçmişi | Liste + seans detayı (set bazlı tekrar, hatalar) |
| B5 | İlerleme | Hareket bazlı haftalık tekrar ve temiz tekrar oranı (son 8 hafta; MVP'de tablo) |
| B6 | Ayarlar | Dil, tema, rıza verme/geri çekme, verilerini JSON olarak indirme, silme talebi, çıkış |

## C) Yönetim paneli (tablet/masaüstü, telefonda sade)
| # | Ekran | Rol | İçerik |
|---|---|---|---|
| C1 | Giriş | Personel | Salon kimliği (ilk girişte; davet/kurulum bağlantısındaki `?tenant=` ile gelir ve hatırlanır), e-posta, şifre |
| C2 | Genel bakış | Yönetici | Aktif seans, bugünkü seans sayısı, istasyon sağlığı |
| C3 | İstasyonlar | Yönetici | Liste, cihaz durumu (heartbeat), eşleştirme, hareket ataması |
| C4 | Üyeler | Yönetici/Antrenör | Arama, üye detayı, program atama |
| C5 | Program şablonları | Antrenör | Şablon oluştur/düzenle (hareket, set, tekrar, dinlenme, mod) |
| C6 | Üye detayı | Antrenör | Seans geçmişi, son 30 günün en sık hataları, haftalık seans sayısı (son 8 hafta), antrenör ataması, program atama |
| C7 | Analitik | Yönetici | İstasyon kullanımı (saat bazlı), aktif üye oranı, devamlılık |
| C8 | Ayarlar | Sahip | Kullanıcılar (personel ekleme), strict/lenient varsayılanı (yeni şablon bloklarında öntanımlı), saklama süresi (ay, varsayılan 24), güvenlik duraklatması açık/kapalı (05; telefona programla, tablete tenant anahtarıyla iletilir), bilgilendirme metni şablonu, üye veri talepleri |
| C9 | Faturalama | Sahip | Plan, istasyon sayısı, faturalar |
| C10 | Kalibrasyon kaydı | Yönetici/Sahip | Katılımcı rızası (ayrı metin), hareket seçimi, etiketleme (doğru/hatalı + hata türü), kayıt göstergesi. Yalnız landmark kaydeder (07) |

## A3 kurulum kontrolleri
Son 1 sn'lik karelerin en az %80'i aşağıdakilerin hepsini sağlıyorsa kurulum **hazırdır**:
### A3 görsel yönlendirme
Üye kameradan 2–3 m uzakta olduğu için yönlendirme yazıya dayanmaz:
- **Hedef siluet:** önizlemenin ortasında, üyenin durması gereken yeri ve boyutu gösteren kesikli bir insan silueti (`camera.posture`: ayakta dikey, `horizontal` yatay). Üye kendi iskeletini siluetle hizalar.
- **Sorunlu kenar:** zorunlu bir eklem görüntünün kenar payı dışındaysa ya da görünmüyorsa, bulunduğu taraf (üst/alt/sol/sağ) kırmızı bantla vurgulanır; görünmeyen zorunlu eklemler kırmızı noktadır.
- **Büyük ipucu:** ilk ipucu önizlemenin üstünde büyük yazıyla gösterilir.
- **Otomatik başlama:** kurulum 1,5 sn kesintisiz "Hazır" kalırsa dokunmaya gerek kalmadan blok başlar ve doğrudan sesli geri sayıma (03 kural 2) geçilir. "Başla" düğmesi beklemeden başlamak için kalır. Bloğun sonraki setleri dinlenmeden sonra hazır duruşla ya da "Hazırım" ile başlar.
- **Telefonu çevir:** `horizontal` bir hareket dikey kamerayla çekiliyorsa ilk ipucu "Telefonu yan çevir" olur (yerdeki vücut dikey kadraja sığmaz). Yatay siluet, kişinin baktığı yöne göre aynalanır.
- **Sesli ipucu:** ipucu sesli okunur (05 ses kaynağı sırası). Aynı ipucu 4 sn dolmadan tekrarlanmaz; ipucu kalmayınca "Hazır" bir kez söylenir. Ses kapalıysa yalnızca görsel.

- **İpucu her zaman var:** kurulum hazır değilse en az bir ipucu gösterilir. Hiçbir sorun tek başına sınırı aşmıyor ama oran yine de tutmuyorsa (karışık nedenler) en sık görülen sorunun ipucu gösterilir.
- **Tüm vücut görünüyor:** kural paketindeki `minVisibleLandmarks` noktalarının hepsi `minVisibility` üstünde ve görüntünün içinde (kenarlardan %2 pay). İpucu: `setup.hint.show_full_body`.
- **Çok uzak değil:** görünen noktaları içine alan kutunun uzun kenarı (yatay veya dikey) görüntünün en az %45'i. Uzun kenar kullanılır, çünkü şınav gibi yatay hareketlerde vücut dikeyde kısa kalır. İpucu: `setup.hint.move_closer`.
- **Çok yakın değil:** `minVisibleLandmarks` noktalarından biri kenar payının dışındaysa `setup.hint.step_back`.
- **Görünüm uygun:** baskın görünüm (04) `camera.views` içinde. Değilse ipucu `setup.hint.turn_side` (desteklenen görünüm yalnız `side` ise) veya `setup.hint.face_camera` (yalnız `front` ise). Belirsiz görünümde `setup.hint.adjust_angle`.
- **Tek kişi:** kişi seçimi belirsiz değil (07). İpucu: `setup.hint.multiple_people`.

Hazır olunca A3 algılanan görünümü, yakın tarafı ve bu görünümde aktif olan form kontrollerinin adlarını (`faults[].name`) gösterir.

## Kamera izni
- Rıza yoksa veya geri çekildiyse kamera **istenmez** (AC-7.4). Ekran rıza gerektiğini söyler.
- İzin reddedilirse veya kamera yoksa (güvensiz bağlam, cihaz yok) A9 açıklayıcı hata gösterir ve elle kayıt seçeneği sunar (AC-8.3).

## Duyarlı davranış
| Alan | Telefon dikey | Telefon yatay | Tablet yatay |
|---|---|---|---|
| A3 Kurulum, A5 Aktif set (ve aynı kamera ekranındaki geri sayım, dinlenme, duraklatma) | Kamera tam ekran; ipucu üstte, sayaç/uyarı/düğmeler altta yarı saydam panelde | Kamera tam ekran; panel sağda | Kamera tam ekran; panel sağda |
| B* Üye | Tek sütun | Tek sütun | İki sütun |
| C* Yönetim | Kart listesi | Kart listesi | Tablo + yan panel |

## Kabul kriterleri
Tam ekran kamera görüntüyü **kırpmaz** (`contain`, siyah boşluk): poz modeli tüm kareyi görür, kırpılan bir bölge siluet ve kenar uyarılarını yanıltır. "Görüntü saklanmaz" ve "tıbbi tavsiye değildir" ibareleri kamera ekranında da görünür kalır (değişmez kural 5).

- AC-8.1: A5 ekranı 360×640 telefon ve 1280×800 tablet görünümlerinde taşma olmadan çalışır (görsel test).
- AC-8.2: A5'te sayaç, uyarı ve hareket adı 2 metre mesafeden okunabilir boyutta (min sayaç yüksekliği ekranın %25'i).
- AC-8.3: Tüm A-ekranları kamera izni reddedilince açıklayıcı hata ve elle kayıt seçeneği sunar.
- AC-8.4: Koyu/açık tema ve TR/EN arasında geçiş çalışır.
- AC-8.5: A3, hareketin desteklemediği görünümde seti başlatmaz ve doğru görünüm ipucunu gösterir.
