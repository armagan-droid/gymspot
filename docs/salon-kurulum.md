# Salon kurulum kılavuzu (pilot)

Bu kılavuz, salon personelinin istasyonları kurması ve üyeleri sisteme alması içindir. Günlük kullanım (panel, üye telefonu, istasyon) için bkz. [kullanim-kilavuzu.md](kullanim-kilavuzu.md).

> Bu sistem tıbbi tavsiye değildir. Ağrı hisseden üye hareketi bırakmalıdır.

## 1. Hazırlık

- **Tablet:** orta seviye veya üstü bir Android tablet ya da iPad. Kesin minimum model ve işletim sistemi sürümü pilot ölçümlerinden sonra netleşecek (specs/02 T2.2).
- **Stant:** sağlam bir tablet standı; mümkünse yere sabitlenmiş ya da ağırlıklı.
- **Elektrik:** tablet sürekli şarjda kalmalı (ekran açık kalır).
- **Ağ:** salon Wi-Fi'si önerilir ama zorunlu değil. İnternet kesilince sistem çalışmaya devam eder, kayıtları bağlantı gelince gönderir.

## 2. Tabletin kiosk moduna alınması

Tablet yalnızca uygulamayı göstermeli; üyeler başka uygulamaya geçememeli.

- **iPad:** Ayarlar → Erişilebilirlik → Rehberli Erişim'i açın. Uygulamayı Safari'den "Ana Ekrana Ekle" ile kurun, açın ve yan tuşa üç kez basarak Rehberli Erişim'i başlatın. Otomatik kilidi "Asla" yapın.
- **Android:** Ayarlar → Güvenlik → Uygulama sabitleme'yi (ekran sabitleme) açın. Chrome'dan "Uygulamayı yükle" ile kurun, açın ve son uygulamalar ekranından sabitleyin. Daha sıkı yönetim için bir kiosk uygulaması (ör. MDM) kullanılabilir. Ekran zaman aşımını en uzun değere getirin.
- Uygulama, set sırasında ekranın kapanmasını kendisi engeller (Wake Lock). Kiosk ayarı yine de gereklidir.

## 3. İstasyonu eşleştirme

1. Yönetici, bilgisayardan veya telefondan yönetim paneline girer: **İstasyonlar → İstasyon ekle** (ör. "Squat Rafı 2").
2. İstasyonun yanındaki **Eşleştirme kodu üret** düğmesine basar. 8 karakterlik kod 10 dakika geçerlidir.
3. Tablette uygulama açılır (`/station`), kod girilir ve **Eşleştir**'e basılır.
4. Tablet artık "Başlamak için telefonundaki QR'ı kameraya göster" ekranındadır.

Tablet kaybolursa veya değişirse, yönetici paneldeki **Cihazı kaldır** ile eski tabletin erişimini hemen iptal eder.

## 4. Kamera konumu

Kamera, üyenin tüm vücudunu baştan ayağa görmelidir. Uygulamanın kurulum ekranı (A3) yanlış konumu söyler ("biraz geri çekil", "yan dön" gibi). Aşağıdaki değerler başlangıç noktasıdır.

| Hareket | Açı | Yükseklik | Mesafe |
|---|---|---|---|
| Squat | Önden (diz içe kaçma için) veya yandan (gövde eğimi için) | Kalça hizası | 2–3 m |
| Şınav | **Yalnız yandan** | Yere yakın (30–50 cm) | Baştan ayağa görünecek kadar |
| Omuz press | Önden (kol simetrisi için) veya yandan (bel yaylanması için) | Göğüs hizası | 2–3 m |

- **Işık:** üyenin arkasında güçlü pencere veya lamba olmasın (siluet). Önden veya yandan yumuşak ışık en iyisidir.
- **Arka plan:** istasyon alanının arkasında başka üyelerin geçmediği bir yer seçin. Kamerada iki kişi görünürse sistem duraklar.
- **Zemin:** ayaklar görüntünün alt kenarına değmemeli.

## 5. Bilgilendirme metni

Yönetim paneli → **Salon ayarları**'ndaki "Salon girişi bilgilendirme metni"ni yazdırıp **salon girişine ve her istasyonun yanına** asın. Metin, kamerada görünebilecek diğer kişileri bilgilendirir: görüntü kaydedilmez ve gönderilmez (specs/07).

## 6. Üyeleri sisteme alma

1. Personel **Üyeler → Üye ekle**'den üyeyi e-postasıyla ekler ve "Davet bağlantısı gönder"i işaretler.
2. Üye e-postadaki bağlantıyı telefonunda açar. İlk girişte aydınlatma metnini okur ve kamera için açık rıza verir ya da "şimdi değil" der.
3. Antrenör üyeye **Program şablonu** atar (üye detayı → Programı ata).
4. Üye telefonunda **Seansı başlat**'a dokunur. İstasyondaki bir hareket sırası geldiğinde telefon bir QR kod gösterir; üye kodu tablete gösterir, tablet bloğu yürütür, sonra üye telefonundan devam eder.

Rıza vermeyen üyenin kamerası hiçbir cihazda açılmaz. Bu üye (veya kamerası çalışmayan biri) **Elle kaydet** ile setini kamerasız kaydeder: setten sonra yaptığı tekrar sayısını girer, dinlenme ve program akışı aynı kalır.

## 7. Ayarlar

**Salon ayarları**'nı yalnızca salon sahibi değiştirebilir.

| Ayar | Açıklama |
|---|---|
| Varsayılan mod | Katı: hatalı tekrar sayılmaz. Esnek: sayılır ama işaretlenir. Yeni şablon bloklarında öntanımlıdır. |
| Güvenlik duraklatması | Ciddi bir form hatası art arda iki tekrarda görülürse set durur ve "Dur, formunu kontrol et" uyarısı verilir. Kapatılması önerilmez. |
| Saklama süresi | Seans verisinin kaç ay tutulacağı (varsayılan 24). |

## 8. Kalibrasyon kayıtları (pilot)

Eşiklerin salona göre ayarlanması için yönetici, gönüllü katılımcılarla **Kalibrasyon kaydı** alabilir.
- Katılımcıdan ayrı bir rıza alınır.
- Yalnızca eklem noktalarının koordinatları kaydedilir, görüntü kaydedilmez.
- Kayıtlar şifrelenir, en fazla 12 ay saklanır.
- Rıza geri çekilirse kayıtlar silinir.

## 9. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Tablet "çevrimdışı mod" diyor | İnternet yok. Seans çalışmaya devam eder; bağlantı gelince kayıtlar gönderilir. |
| "Bu QR kod zaten kullanıldı" | Üye telefonunda yeni kodu göstermeli (kodlar tek kullanımlık ve 2 dakika geçerli). |
| Kurulum ekranı "hazır" olmuyor | İpucunu izleyin: tüm vücut görünmeli, tek kişi olmalı, hareket için doğru açıda durulmalı. |
| Panelde istasyon çevrimdışı | Tablet kapalı, uygulama kapalı veya ağ yok. Tablet 60 saniyede bir sinyal gönderir. |
| Kamera izni reddedildi | Tarayıcı ayarlarından site için kamera iznini verin. Beklemeden devam etmek için ekrandaki **Elle kaydet** ile setler kamerasız kaydedilebilir. |
