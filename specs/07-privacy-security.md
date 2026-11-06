# 07 — Gizlilik ve Güvenlik

Kamera kullanan bir sağlık/fitness ürünü olarak bu, satış kararında belirleyicidir. KVKK ve GDPR uyumlu tasarlanır.

## Veri minimizasyonu
- Video, ses ve görüntü kareleri **işlenir ama saklanmaz ve ağa gönderilmez**. Kare yalnızca bellekteki poz modeline gider. Mikrofon kullanılmaz.
- Sunucuya giden: üye kimliği, hareket, tekrar sayısı/outcome, hata türü, süre, zaman.
- Landmark koordinatları sunucuya **gönderilmez**. Tek istisna aşağıdaki **Kalibrasyon modu**dur.
- Yüz tanıma yok. Üye kimliği QR/NFC ile belirlenir, yüzle değil.
- Kamerada birden fazla kişi varsa yalnızca takip edilen kişinin landmark'ları işlenir. Diğer kişilerin landmark'ları aynı karede atılır ve hiçbir yerde tutulmaz. Seçim kuralları:
  - Poz modeli en fazla 2 kişi arar (`numPoses = 2`).
  - Puan = kişinin görüntüdeki kutu alanı × merkezilik (1 − kutu merkezinin görüntü merkezine uzaklığı).
  - Takipte bir kişi varsa, kalça merkezi önceki kareye 0.15'ten (görüntü birimi) yakın olan aday seçilir ve takip sürer.
  - Takip yoksa en yüksek puanlı kişi seçilir. İkinci adayın puanı en iyinin %80'inden fazlaysa seçim **belirsizdir**: o kare motora verilmez, süre uzarsa `TRACKING_LOST` oluşur ve set duraklar (03).

## Rıza ve şeffaflık
- Üye ilk girişte aydınlatma metni ve açık rıza verir (sürümlü: `consent_version`). Metin sürümü değişince yeniden rıza istenir.
- İstasyonda kamera ikonu ve "Görüntü saklanmaz" ibaresi her zaman görünür.
- Rıza geri çekilince (`consent_withdrawn_at`) kamera başlatılmaz; üye kamerasız (elle kayıt) modu kullanabilir.
- Rıza durumu check-in sırasında kontrol edilir: rızası olmayan üyenin token'ıyla istasyon kamerası açılmaz.
- Salon girişinde asılacak bilgilendirme metni şablonu sağlanır (kamerada görünebilecek diğer üyeler için).

## Kalibrasyon modu
Eşik kalibrasyonu ve test fixture'ları (AC-4.3) gerçek landmark verisi gerektirdiğinden, değişmez kural 1'in **tek ve dar istisnası**dır:
- Yalnızca `manager`/`owner` rolündeki personel, C10 ekranından açar. Normal üye seanslarında asla aktif olmaz.
- Katılımcıdan seans rızasından **ayrı**, sürümlü açık rıza alınır (`calibration_consents`). Katılımcı her an geri çekebilir; geri çekince kayıtları silinir.
- Yalnızca landmark dizileri (+ zaman damgası, etiket) kaydedilir. **Video, kare veya görüntü asla kaydedilmez.**
- Kayıtlar takma adlıdır (`participant_ref`, isim yok), şifreli ayrı nesne deposunda tutulur, erişim yalnızca ürün ekibinin kalibrasyon rolüne açıktır. Saklama süresi en fazla 12 ay.
- Ekranda kayıt sürerken belirgin "KALİBRASYON KAYDI" göstergesi bulunur.
- **Depolama:** kayıt, `LandmarkSequenceSchema`'dan (katı; görüntü alanı olamaz) ve `source = calibration` kontrolünden geçer. AES-256-GCM ile şifrelenip nesne deposuna yazılır. Ek doğrulanmış veri (AAD) olarak `tenantId/recordingId` kullanılır; böylece bir kayıt başka bir kaydın yerine konamaz. Anahtar `CALIBRATION_ENCRYPTION_KEY` (32 bayt) değişkenindedir ve üretimde zorunludur. Veritabanında yalnız etiketler ve depo referansı tutulur.
- **Erişim:** tenant personeli (yönetici/sahip) rıza kaydeder, kayıt yükler, kayıt meta verisini listeler ve rızayı geri çeker. Ham kareleri indiremez. İndirme yalnız ürün ekibinin kalibrasyon araçlarıyla mümkündür (T5.3).
- **Geri çekme:** rıza geri çekilince o rızaya bağlı tüm kayıtlar depodan ve veritabanından silinir.
- **Saklama:** 12 aydan eski kayıtlar temizleme işiyle silinir.

## Üye hakları
- Veri dışa aktarma (JSON/CSV) ve silme/anonimleştirme talebi: üye B6'dan veya yönetici panelinden; 30 gün içinde tamamlanır.
- Saklama süresi: seans verisi varsayılan 24 ay, salon ayarlanabilir.

## Kimlik doğrulama
- **Personel:** e-posta + parola (Argon2id), giriş denemesi kilidi.
- **Üye:** salon üyeyi ekler, sistem e-posta (veya SMS) ile davet gönderir. Girişler **magic link** ile yapılır: tek kullanımlık, 15 dk ömürlü, hash'li saklanan token. Parola yok.
- **Cihaz (istasyon tableti):** eşleştirme kodu ile alınan uzun ömürlü cihaz token'ı, hash'li saklanır, yönetici iptal edebilir.
- Oturumlar kısa ömürlü JWT + yenileme token'ı (`auth_refresh_tokens`); iptal edilebilir.

## Token ayrıntıları
- **Erişim token'ı:** JWT (HS256), 15 dk. İçerik: `sub`, `tid` (tenant), `kind` (`user` | `member` | `device`) ve personel için `role`.
- **Yenileme token'ı:** `<tenantId>.<rastgele 32 bayt>`. Tenant öneki, aramanın RLS altında doğru tenant'ta yapılmasını sağlar. Yalnız SHA-256 özeti saklanır. Her kullanımda yenisiyle değiştirilir (eskisi iptal), ömrü 30 gündür.
- **Magic link token'ı:** aynı biçim; tek kullanımlık, 15 dk. İstek her zaman `202` döner, böylece e-postanın kayıtlı olup olmadığı dışarıdan anlaşılmaz.
- **Personel giriş kilidi:** aynı tenant ve e-posta için 15 dk içinde 5 başarısız denemeden sonra 15 dk kilit (`429`). Başarılı ve başarısız girişler `audit_log`'a yazılır.
- **Cihaz eşleştirme:** yönetici istasyon için 8 karakterlik, 10 dk geçerli, tek kullanımlık bir kod üretir. Kod tenant bilgisi taşımadığından, yalnız tenant kimliğini döndüren dar bir `SECURITY DEFINER` fonksiyonla çözülür. Tablet karşılığında uzun ömürlü bir cihaz token'ı alır (biçim yukarıdaki gibi). Bu token ile 15 dk'lık cihaz erişim token'ı istenir. Yönetici cihazı silerek token'ı iptal eder.

## Check-in / devir QR token'ı
- **Tenant imza anahtarı (Ed25519):** sunucu sırrından HKDF ile tenant başına türetilir, saklanmaz. Tabletler açık anahtarı cihaz oturumuyla alıp önbelleğe koyar.
- **Yetki sertifikası:** oturum açmış üyenin telefonu kendi Ed25519 anahtar çiftini üretir. Sunucu, telefonun açık anahtarını içeren sertifikayı tenant anahtarıyla imzalar. Sertifika içeriği: `tid`, `mid`, telefon açık anahtarı, kamera rızası durumu; 24 saat geçerli. Telefon çevrimdışıyken bu süre içinde QR üretebilir.
- **QR yükü:** telefon anahtarıyla imzalanır. İçerik: `tid`, `mid`, `sid` (seans), imleç (`bi`, `si`), devredilen bloğun tanımı (`blk`: 03'teki `Block`), `jti`, son kullanma. Blok tanımı QR'da olduğu için tablet bloğu ağ olmadan da yürütebilir (03, devir adım 1); yaklaşık 150 bayt ekler. Ömür 2 dakikadır; son kullanma şimdiden 2 dk + 30 sn'den ileride olamaz. QR metni dört parçadır: `yük.yükİmzası.sertifika.sertifikaİmzası` (base64url).
- **Doğrulama** (`packages/shared`, tablet ve sunucu aynı kodu kullanır): sertifika imzası tenant anahtarıyla, yük imzası sertifikadaki telefon anahtarıyla doğrulanır. `tid`/`mid` eşleşmeli, iki süre de dolmamış olmalı.
- **Tek kullanım (`jti`):** tablet çevrimiçiyse sunucuda kullanır (`qr_tokens`); ikinci kullanım reddedilir. **Çevrimdışıysa** `jti`'yi yerel olarak kaydeder. Tekil kullanım bağlanınca sunucuda kesinleştirilir, ihlal `audit_log`'a yazılır.
- Kamera rızası sertifikada taşınır. Rızası olmayan üyenin QR'ıyla istasyon kamerası açılmaz (AC-7.4).

## Güvenlik
- HTTPS zorunlu (kamera erişimi zaten güvenli bağlam ister).
- Rate limit, denetim kaydı (`audit_log`).
- Bağımlılık taraması CI'da. Gizli anahtarlar repoda yok.
- Tenant izolasyonu: RLS + uygulama katmanı filtresi (06).
- Hata izleme servisine giden olaylarda PII, landmark ve görüntü bulunmaz (kırpma/allowlist).

## Güvenlik/sağlık sınırlamaları
- "Tıbbi tavsiye değildir" ibaresi her seans başlangıcında ve ayarlarda görünür.
- Üye kendi rızasıyla sağlık beyanı (PAR-Q benzeri) yapabilir; MVP'de zorunlu değil, saklama sınırlı.

## Kabul kriterleri
- AC-7.1: Ağ trafiği testi: seans sırasında istemciden çıkan hiçbir istek video/landmark içermez (otomatik e2e testi).
- AC-7.2: Üye silme akışı sonrası kişisel veri kalmaz (test).
- AC-7.3: QR token ikinci kullanımda, süre dolunca ve imza geçersizken reddedilir (çevrimiçi ve çevrimdışı doğrulama ayrı test).
- AC-7.4: Rıza yoksa veya geri çekildiyse kamera başlatılmaz (UI testi).
- AC-7.5: Kalibrasyon kaydı personel rolü ve kalibrasyon rızası olmadan başlatılamaz; kayıtta görüntü verisi bulunmaz (test).
- AC-7.6: Magic link ikinci kullanımda ve 15 dk sonra reddedilir.
