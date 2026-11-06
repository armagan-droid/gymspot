# 01 — Sözlük

| Terim | Tanım |
|---|---|
| Tenant | Müşteri spor salonu (veya zincir). Tüm veri tenant'a aittir. |
| Branch (Şube) | Tenant'ın fiziksel konumu. |
| Station (İstasyon) | Salonda kamera ile izlenen sabit alan/ekipman (ör. Squat Rafı 2). |
| Device (Cihaz) | İstasyondaki tablet veya üyenin telefonu; bir oturum açar. |
| Member (Üye) | Salonun müşterisi. |
| Trainer (Antrenör) | Program atayan personel. |
| Program | Üyeye atanmış hareket sırası ve hedefler listesi (şablondan türetilir). |
| Program Template | Yeniden kullanılabilir program şablonu. |
| Workout (Antrenman günü) | Programın bir günü: sıralı hareket blokları. |
| Exercise (Hareket) | Tanımlı hareket (squat, şınav...). Kural paketine bağlı. |
| Rule Pack (Kural paketi) | Hareketin faz, açı ve hata kurallarını tanımlayan JSON. |
| Session (Seans) | Üyenin bir antrenman günü boyunca çalışma kaydı. |
| Set | Bir hareketin art arda tekrar grubu. |
| Rep (Tekrar) | Tam bir hareket döngüsü (ör. in-çık). |
| Attempt (Deneme) | Başlangıç bölgesinden çıkıp geri dönen her hareket; sonucu (outcome) `valid`, `faulty` veya `incomplete` olur (04). |
| Valid rep | Hedefe ulaşan ve geçerliliği bozan hatası olmayan, sayılan tekrar. |
| Faulty rep | Geçerliliği bozan (`affectsValidity`) hata tetiklenen deneme. Moda göre sayılır veya sayılmaz. |
| Incomplete (Yarım deneme) | Hedefe ulaşmayan ve tanımlı bir hatayla eşleşmeyen deneme; hiçbir modda sayılmaz. |
| Turn point (Dönüş noktası) | Denemede tekrar metriğinin en uç değere ulaştığı kare (`at_turn`). |
| View (Görünüm) | Kameranın kişiyi gördüğü açı: `front`, `side` veya `ambiguous`. |
| near_/far_ | Kameraya yakın/uzak taraftaki eklemi gösteren sanal landmark adı. |
| Fault (Hata) | Tanımlı form hatası (ör. `knee_valgus`). |
| Cue (İpucu) | Hataya karşılık verilen kısa uyarı (ses/metin). |
| Landmarks | Poz modelinin çıkardığı eklem noktaları. |
| Frame | Kameradan işlenen tek kare. |
| Strict mode | Hatalı tekrar sayılmaz. |
| Lenient mode | Hatalı tekrar sayılır ama kaydedilir ve uyarılır. |
| Rest (Dinlenme) | Setler arası geri sayım. |
| Session owner (Seans sahibi) | Seans durumunu tutan cihaz; daima üyenin telefonu. |
| Handoff (Devir) | Telefonun bir bloğu QR ile istasyon tabletine yürütmesi için vermesi. |
| Cursor (İmleç) | Seansın konumu: `blockIndex`, `setIndex`. |
| Magic link | Üyeye e-posta/SMS ile gönderilen tek kullanımlık giriş bağlantısı. |
| Calibration mode (Kalibrasyon modu) | Personelin, ayrı rızayla yalnızca landmark kaydettiği mod; eşik ayarı ve test fixture'ı için (07). |
