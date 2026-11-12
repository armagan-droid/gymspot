# GymSpot kullanım kılavuzu

Bu kılavuz uygulamanın günlük kullanımını anlatır: salon personeli (yönetim paneli), üye (telefon) ve istasyon tableti. Tabletin fiziksel kurulumu, kamera konumu ve kiosk ayarları için bkz. [salon-kurulum.md](salon-kurulum.md).

> Bu sistem tıbbi tavsiye değildir. Ağrı hisseden üye hareketi bırakmalıdır.

## Genel bakış

| Kim | Cihaz | Adres | Ne yapar |
|---|---|---|---|
| Salon personeli | Bilgisayar veya telefon | `/admin` | İstasyon, üye, program şablonu, ayarlar |
| Üye | Kendi telefonu | `/member` | Seansı başlatır ve yönetir, geçmişini görür |
| İstasyon | Sabit tablet | `/station` | Üyenin devrettiği hareketi kamerayla yürütür |

Seansın sahibi üyenin telefonudur. Tablet yalnızca kendisine devredilen hareketi (bloğu) yürütür, sonra üye telefonundan devam eder.

Kamera görüntüsü yalnızca cihazda işlenir; görüntü kaydedilmez ve hiçbir yere gönderilmez. Sunucuya yalnızca tekrar, set ve hata türü gibi sonuçlar gider.

## 1. İlk giriş (salon sahibi)

Salon sahibi hesabı kurulumda oluşturulur (`docs/deploy.md` → `bootstrap-tenant`). Kurulumu yapan kişi size **salon kimliğini** ve giriş bağlantısını verir.

1. `/admin/login?tenant=<salon kimliği>` adresini açın. Bağlantıda kimlik yoksa **Salon kimliği** alanına yapıştırın; tarayıcı bir sonraki girişte hatırlar.
2. **E-posta** ve **Şifre** ile **Giriş yap**'a basın.
3. Art arda çok fazla hatalı deneme hesabı 15 dakika kilitler.

## 2. Yönetim paneli (personel)

Menü: **Genel bakış · İstasyonlar · Üyeler · Program şablonları · Kalibrasyon kaydı · Salon ayarları**. Antrenörler yalnızca üyeleri ve şablonları görür; istasyonlar ve kalibrasyon yönetici/sahip, salon ayarları yalnızca sahip içindir.

### 2.1 İstasyon ekleme ve tableti eşleştirme

1. Panelde **İstasyonlar**'a gidin. **İstasyon adı** yazın (ör. "Şınav Alanı") ve **İstasyon ekle**'ye basın.
2. İstasyonun yanındaki **Eşleştirme kodu üret**'e basın. 8 karakterlik kod ekranda görünür; yanında son geçerlilik saati yazar (10 dakika).
3. Tablette tarayıcıyla `/station` adresini açın. Tablet henüz eşleşmemişse **Cihaz eşleştirme** ekranı gelir.
4. Kodu **Eşleştirme kodu** alanına yazın ve **Eşleştir**'e basın.
5. Tablet "Başlamak için telefonundaki QR'ı kameraya göster" ekranına geçer. Eşleştirme bitti; panelde istasyonun altında "1 cihaz" görünür.

- Kod geçersiz veya süresi dolmuşsa tablet "Kod geçersiz ya da süresi dolmuş." der; panelden yeni kod üretin.
- Tablet kaybolur ya da değişirse panelde **Cihazı kaldır** ile eski tabletin erişimini hemen kapatın, yeni tableti yeni kodla eşleştirin.
- Panelde "son görülme" saati tabletin çevrimiçi olup olmadığını gösterir (tablet dakikada bir sinyal gönderir).

### 2.2 Program şablonu oluşturma

1. **Program şablonları → Yeni şablon**.
2. **Şablon adı** yazın, **Blok ekle** ile hareketleri ekleyin. Her blok için:
   - **Gün**: şablonun kaçıncı günü (0, 1, 2 …). Aynı günün blokları sırayla yapılır.
   - **Hareket**, **Set**, **Tekrar**, **Dinlenme (sn)**.
   - **Mod**: *Katı* hatalı tekrarı saymaz; *Esnek* sayar ama işaretler.
   - **İstasyon**: hareket bir istasyon tabletinde yapılacaksa istasyon adını yazın (ör. "Şınav Alanı"). Boş bırakılırsa hareket üyenin telefonunda yapılır. Bir blokta istasyon adı değiştiğinde üyenin telefonu tablete devretmek için QR kod gösterir.
3. Kaydedin. Bir üyeye atanmış şablon silinemez.

### 2.3 Üye ekleme ve program atama

1. **Üyeler → Üye ekle**: **Ad soyad** ve **E-posta** yazın, **Davet bağlantısı gönder**'i işaretleyin, **Üye ekle**'ye basın. Üyeye e-postayla giriş bağlantısı gider.
2. Listeden üyeye tıklayın (**Üye detayı**).
3. **Programı ata**: **Program şablonu** ve **Başlangıç tarihi** seçip onaylayın.
4. İsterseniz **Antrenör ata** ile üyeyi bir antrenöre bağlayın.

Üye detayında son 30 günün en sık form hataları ve haftalık seans sayısı görünür. Listede "kamera rızası yok" yazan üyelerin kamerası hiçbir cihazda açılmaz; bu üyeler setlerini elle kaydeder.

### 2.4 Salon ayarları (sahip)

- **Varsayılan mod**: yeni şablon bloklarında öntanımlı mod.
- **Güvenlik duraklatması**: ciddi bir form hatası art arda iki tekrarda görülürse set durur. Kapatılması önerilmez.
- **Saklama süresi (ay)**: seans verisinin tutulacağı süre.
- **Personel**: e-posta, rol ve geçici şifreyle yeni personel ekleyin.
- **Üye veri talepleri**: üyelerin silme/dışa aktarma talepleri burada görünür; silme talebini **Silme işlemini uygula** ile tamamlayın.
- **Salon girişi bilgilendirme metni**: yazdırıp salon girişine ve istasyonların yanına asın.

## 3. Üye (telefon)

### 3.1 İlk giriş ve rıza

1. Salonun gönderdiği davet e-postasındaki bağlantıyı telefonda açın. Bağlantı sizi doğrudan içeri alır; şifre yoktur.
2. **Aydınlatma ve açık rıza** ekranını okuyun:
   - **Onaylıyorum**: kamera form takibi için kullanılır.
   - **Şimdi değil**: kamera hiç açılmaz, setlerinizi elle kaydedersiniz. Rızayı sonra **Ayarlar**'dan verebilirsiniz.
3. Daha sonra aynı telefonda girişte e-postanızı yazıp **Giriş bağlantısı gönder**'e basmanız yeterlidir (telefon salonu ilk girişten hatırlar). Başka bir telefonda yeniden salonun davet bağlantısı gerekir.

İpucu: tarayıcı menüsünden **Ana ekrana ekle** ile uygulamayı telefona kurabilirsiniz.

### 3.2 Seans

1. Ana sayfada **Seansı başlat**'a dokunun. **Antrenman özeti** bugünün hareketlerini listeler; **Başla**'ya dokunun.
2. **Kamera kurulumu**: telefonu sabit bir yere koyun, ekrandaki ipuçlarını izleyin ("Tüm vücudun görünsün", "Yan dön" …). **Hazır** görününce **Başla**.
3. **Aktif set**: hazır duruşa geçin ya da **Başla**'ya dokunun. Uygulama tekrarları sayar, form hatalarını kısa sesli uyarılarla söyler. Set bitince **Seti bitir**.
4. **Dinlenme**: geri sayım biter ya da **Hazırım**'a dokunursunuz; sonraki set başlar.
5. Tüm bloklar bitince **Seans tamamlandı** ekranı gelir.

"Dur, formunu kontrol et" uyarısı güvenlik duraklatmasıdır: ekran kırmızı çerçeve alır, hatalı eklemler kırmızı görünür ve nasıl düzelteceğiniz yazar. Hareketi bırakıp başlangıç duruşuna geçin; form düzelince yeşil "Form düzeldi" uyarısıyla set 2-1 sayımıyla kendiliğinden devam eder. **Devam et**'e dokunarak da dönebilirsiniz.

**Eskiv drilleri** (sağa-sola kaçış, sola kaçış, sağa kaçış, eğilme): kameranın tam karşısında gard alın. Başınızın etrafında artı işaretli bir daire belirir. Gövdenizle yana yatıp başınızı dairenin dışına çıkarın ya da dizlerinizi kırıp başınızı dairenin altındaki kesikli çizginin altına indirin; daire yeşile döner. Merkeze dönünce tekrar sayılır. Programda sola ve sağa kaçışı ayrı hareket olarak yazabilirsiniz.

"Seni göremiyorum, kadraja geri gel" denirse kamera sizi 5 saniyeden uzun görememiştir. Kadraja dönünce set 3-2-1 sayımıyla kendiliğinden devam eder, sayaç korunur.

### 3.3 İstasyona devretme (QR)

Sıradaki hareket bir istasyonda yapılacaksa telefon **Sıradaki istasyona geç** ekranını ve bir **Devir QR kodu** gösterir.

1. İstasyondaki tablete gidin ve telefon ekranındaki QR'ı tabletin kamerasına gösterin.
2. Tablet hareketi yürütür (kamera kurulumu → setler → dinlenme).
3. Tablet "Telefonundan devam et" dediğinde telefonda **İstasyondan döndüm**'e dokunun; seans telefonda kaldığı yerden sürer.

- QR kod tek kullanımlıktır ve kısa süre geçerlidir; telefon kodu kendiliğinden yeniler. "Bu QR kod zaten kullanıldı" görürseniz telefondaki yeni kodu gösterin.
- İstasyon doluysa ya da tablet yoksa **Bu bloğu telefonda yap** ile hareketi telefonda yapabilirsiniz.

### 3.4 Kamerasız (elle) kayıt

Kamera rızanız yoksa, kamera izni verilmediyse ya da kamera çalışmıyorsa ekranda **Elle kaydet** düğmesi çıkar.

1. **Elle kaydet**'e dokunun.
2. Seti yapın, **Yapılan tekrar** alanına sayıyı girin (hedef hazır yazılıdır) ve **Seti kaydet**'e dokunun.
3. Dinlenme ve sonraki setler normal akar. Bir hareketi yapmayacaksanız **Bu hareketi atla**.

Elle mod seçildikten sonra seansın geri kalanında da kamera açılmaz.

### 3.5 Geçmiş, ilerleme ve ayarlar

- **Programım**: tüm program günleri.
- **Seans geçmişi**: geçmiş seanslar, set başına temiz/hatalı/yarım tekrar ve hata adları.
- **İlerleme**: haftalık temiz tekrar oranı.
- **Ayarlar**: dil (Türkçe/İngilizce), tema, kamera rızasını verme/geri çekme, **Verilerimi indir**, **Verilerimin silinmesini iste**, **Çıkış yap**.

## 4. İstasyon tableti

Eşleştirilmiş tablet her zaman "Başlamak için telefonundaki QR'ı kameraya göster" ekranında bekler.

1. Üye QR'ı gösterir. Tablet kodu doğrular ve üyenin rızasını kontrol eder.
2. **Kamera kurulumu** → üye hazır olunca setler başlar. Ekran tekrar sayısını ve uyarıları büyük gösterir.
3. Blok bitince "Telefonundan devam et" görünür; kısa süre sonra tablet yeniden QR bekleme ekranına döner.

- Üyenin kamera rızası yoksa tablet kamerayı açmaz; **Elle kaydet** ile set tablette elle girilebilir ya da **Vazgeç** ile iptal edilir.
- İnternet kesilirse tablet "Çevrimdışı mod" ile çalışmaya devam eder; QR kodları cihazda doğrular, kayıtları bağlantı gelince gönderir.

## 5. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Panelde "E-posta veya şifre hatalı" | Salon kimliğinin doğru olduğundan emin olun; şifre büyük/küçük harfe duyarlıdır. |
| "Çok fazla hatalı deneme" | 15 dakika bekleyin. |
| Tablet eşleşmiyor | Kodun süresi 10 dakikadır; panelden yeni kod üretin. |
| Set sık sık "Seni göremiyorum" ya da "Görünmüyor: …" diyor | Kamera ekranında sol üstteki **Tanı** düğmesine dokunun. Panel kare hızını ve her eklemin ne kadar net göründüğünü gösterir (yeşil iyi, sarı zayıf, kırmızı görünmüyor). Kırmızı eklem kadraj dışındaysa uzaklaşın; kare hızı 15'in altındaysa ışığı artırın. Daha isabetli algılama için panelden **Tam** modeli deneyin (daha yavaştır). |
| Üyeye davet e-postası gitmedi | Üyenin e-postasını kontrol edin; üye girişte **Giriş bağlantısı gönder** ile yeni bağlantı isteyebilir. |
| "Atanmış bir programın yok" | Panelde üyeye program atayın. |
| Kamera kurulumu "Hazır" olmuyor | Tüm vücut görünmeli, kamerada tek kişi olmalı, hareket için doğru açıda (önden/yandan) durulmalı. |
| Kamera izni reddedildi | Tarayıcı ayarlarından siteye kamera izni verin ya da **Elle kaydet**'i kullanın. |
| Tablet QR'ı okumuyor | Telefon ekran parlaklığını artırın, QR'ı 20–40 cm mesafede sabit tutun. |

## Ek: Yerel deneme (geliştirme ortamı)

Uygulama henüz bir sunucuya kurulmadan, geliştirici bilgisayarında denenebilir.

- Sunucuları başlatma: `pnpm --filter @gymspot/api dev` ve telefon/tablet erişimi için `pnpm --filter @gymspot/web dev -- --mode https`. İlk sefer için CLAUDE.md → Komutlar (migrate, seed-exercises, bootstrap-tenant).
- Adresler: bilgisayardan `https://localhost:5173`, aynı Wi-Fi'deki telefon veya tabletten `https://<bilgisayarın IP adresi>:5173`.
- Sertifika kendinden imzalıdır; tarayıcının "bağlantınız gizli değil" uyarısını **Gelişmiş → siteye ilerle** ile geçin. Bu kurulumda uygulama çevrimdışı çalışmaz (Service Worker kurulmaz).
- E-posta sağlayıcısı bağlı değildir: davet ve giriş bağlantıları e-postayla gitmez, API'nin konsol çıktısında `[dev] magic link for …` satırı olarak görünür. Bağlantının adresi `APP_BASE_URL` ortam değişkeninden gelir; telefondan açılacaksa bilgisayarın IP adresiyle ayarlayın.
- Tek cihazla uçtan uca deneme için: bilgisayarı (web kamerasıyla) istasyon olarak `https://localhost:5173/station` adresinde eşleştirin, telefonu üye olarak kullanın. Aynı tarayıcıda hem istasyon hem üye oturumu açılabilir, ama aynı anda iki rolü tek ekranda yürütmek mümkün değildir.
