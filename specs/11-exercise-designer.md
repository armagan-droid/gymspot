# 11 — Hareket Tasarlayıcı (C11)

## Amaç
Salon personeli kendi hareketini (kural paketi, 04) JSON yazmadan tasarlar, kamerada dener ve yayınlar. Yeni hareket kod değişikliği ve yeniden dağıtım gerektirmez (değişmez kural 3, T6.3).

Yaklaşım: **gösterim destekli kural editörü**. Hareket yine şeffaf kurallardır (metrik, eşik, hata koşulu). Böylece form uyarıları ("dizlerini aç") verilebilir. Makine öğrenmesiyle poz sınıflandırma (k-NN) yapılmaz: sınıf başına ~100 örnek ister ve belirli bir uyarı veremez.

## Kim
| Yetki | Antrenör | Yönetici | Sahip |
|---|---|---|---|
| Salon hareketlerini görme, programda kullanma | ✓ | ✓ | ✓ |
| Tasarlama, deneme, yayınlama | | ✓ | ✓ |

## Kimlik ve sürüm
- Salon hareketlerinin `id`'si `t_` ile başlar (`^t_[a-z0-9_]{2,40}$`). Global paket kimlikleri `t_` ile başlayamaz (seed reddeder). Böylece istemcideki `id` ile arama çakışmaz.
- Benzersizlik salon başınadır: `(tenant_id, id, version)`. İki salon aynı `t_sumo` kimliğini kullanabilir; biri diğerinin varlığını öğrenemez (06, RLS).
- **Taslak:** her hareket için salon başına tek düzenlenebilir taslak (`exercise_drafts`). Taslak geçersiz olabilir (yarım iş). Kaydedince doğrulama sorunları döner.
- **Yayınlama:** taslak doğrulanır (04, AC-4.1). Geçerliyse `exercises`'e yeni sürüm eklenir: `version` = son sürüm + 1, `status: "draft"` (kalibre edilmemiş). Sonra taslak silinir. Yayınlanmış sürümler değişmez; seanslar kullandıkları sürümü kaydeder (06).
- Programlarda yalnız yayınlanmış hareketler kullanılabilir (06'daki görünür paket kuralı aynen).
- Yayından kaldırma MVP'de yok; şablonlar ve geçmiş seanslar sürüme bağlıdır.

## API (personel)
| Uç | Yetki | Açıklama |
|---|---|---|
| `GET /admin/exercises` | personel | Salon hareketleri: `id`, ad, son yayınlanmış sürüm (yoksa `null`), taslak var mı, taslak güncelleme zamanı |
| `GET /admin/exercises/:id/draft` | yönetici/sahip | Taslak `{definition, issues, updatedAt}`; yoksa 404 |
| `PUT /admin/exercises/:id/draft` | yönetici/sahip | `{definition}` (JSON nesnesi, ≤ 64 KB) kaydeder, `{issues}` döner. `definition.id` yol kimliğiyle aynı olmalı. Geçersiz kimlik → 400 `invalid_exercise_id` |
| `DELETE /admin/exercises/:id/draft` | yönetici/sahip | Taslağı siler |
| `POST /admin/exercises/:id/publish` | yönetici/sahip | Geçersizse 400 `invalid_rule_pack` + `issues`; geçerliyse `{version}` |

- Başka salonun hareketi ve taslağı 404'tür (06).
- Sorunlar `"yol: ileti"` biçimindedir (04 doğrulayıcısı). Editör yolu ilgili alana bağlar.
- `GET /exercises` (T6.3) değişmez: salonun yayınlanmış hareketleri, global paketlerle birlikte gelir.

## Ekran (C11, 08)
1. **Liste:** salon hareketleri (taslak/yayında, sürüm) ve "Yeni hareket". Yeni hareket bir **başlangıç noktasından** açılır:
   - Var olan bir hareketi (global veya salonun) **kopyala ve düzenle**: kimlik ve ad değişir, sürüm 1, durum taslak.
   - Boş şablonlar: **eklem açısı** (squat gibi, yandan), **baş hareketi** (eskiv gibi, önden), **vuruş** (yumruk/tekme gibi, yandan).
2. **Editör (form):** bölümler 04'ün alanlarıdır:
   - Genel: ad (TR/EN), nasıl yapılır (TR/EN), kamera yönü, duruş, kurulum ipucu, görünmesi gereken noktalar.
   - Ölçüler: kapalı listeden işlev seçilir, noktalar açılır listelerden seçilir.
   - Tekrar: ölçü, başlangıç ve hedef bölgeleri (giriş/çıkış), süre sınırları.
   - Hazır duruş ve hatalar: **koşul kurucu** (ölçü, karşılaştırma, değer; `ve`/`veya`; hata için ne zaman ve süre). Koşul kurucunun ifade edemediği ifadeler salt okunur metin olarak kalır ve JSON görünümünde düzenlenir.
   - Uyarı metinleri, önem ve bekleme süresi.
   - **JSON görünümü:** uzmanlar için tüm paket.
   - Doğrulama sorunları ilgili alanın yanında gösterilir. Taslak otomatik değil, "Kaydet" ile kaydedilir.
   - Salon hareketlerinde "Salon tanımlı hareket — doğrulanmamıştır. Tıbbi tavsiye değildir." ibaresi görünür.
3. **Canlı deneme:**
   - Kamera açılır, taslak seanstaki motorla aynen çalışır: iskelet, sayaç, uyarılar.
   - Seçilen ölçülerin anlık değeri ve son birkaç saniyelik grafiği, tekrar eşikleri çizgi olarak gösterilir.
   - "Sıfırla" sayacı sıfırlar.
4. **Gösterimle öneri:**
   - **Doğru gösterim:** antrenör "Kayda başla" der, hareketi 3–5 kez doğru yapar, "Bitir" der. Sistem kapalı listedeki aday ölçüleri (paketin ölçüleri + kurulum yönüne uygun hazır adaylar: iki yan eklem açıları, eskiv ölçüleri) hesaplar ve **tekrar ölçüsü** ile eşiklerini önerir (aşağıda). Öneri forma bir düğmeyle uygulanır.
   - **Hatalı gösterim:** hareket bilerek yanlış yapılır. Sistem doğru ile yanlışı en iyi ayıran ölçüden bir **hata koşulu** önerir (aşağıda). Antrenör uyarı metnini yazar.
5. **Yayınla:** yalnız kaydedilmiş, geçerli taslakta ve taslağın tam bu haliyle canlı denemede en az bir deneme (`REP_COMPLETED`, sonucu ne olursa olsun) tamamlanmışsa etkin. Taslak değişince deneme yeniden gerekir. Bu istemci denetimidir; sunucu yalnız doğrular.

## Öneri algoritması (saf, `packages/engine`)
Girdi: gösterim karelerinden hesaplanmış ölçü dizileri (yumuşatılmış).
- **Tekrar ölçüsü:** her aday için dizi tepe/çukur analiziyle döngülere ayrılır (en az `minSwing` genlik). Puan = döngü sayısı ≥ 2 iken `medyan genlik / (genliklerin standart sapması + ε)` × kapsama (dizinin geçerli, NaN olmayan oranı). En yüksek puanlı aday seçilir. Sonuçta döngü sayısı da gösterilir. Antrenörün yaptığıyla karşılaştırılır.
- **Eşikler:** dinlenme ucu `r` (döngü başlangıçlarının medyanı), hedef ucu `p` (dönüş noktalarının medyanı), genlik `A = |p − r|`. Bölgeler: `start.enter = r + 0.25A`, `start.exit = r + 0.35A`, `target.enter = r + 0.75A`, `target.exit = r + 0.65A` (azalan yönde işaret ters; değerler 2 anlamlı basamağa yuvarlanır). `attemptMinExcursion = 0.2A`. Süreler: en kısa döngünün yarısı ile en uzununun iki katı, [200, 10000] ms'e kırpılır.
- **Hata koşulu:** her aday ölçü için doğru ve hatalı gösterimlerde, tekrar ölçüsünün dönüş noktasındaki değerler alınır. Ayrım = iki küme arasındaki boşluk / birleşik yayılım; en iyi aday seçilir, eşik iki kümenin ortası, karşılaştırma yönü hatalı kümenin tarafıdır, konum `at_turn`. Ayrım yetersizse (kümeler örtüşüyorsa) öneri yapılmaz ve "fark bulunamadı" denir.
- Öneriler yalnız taslağı değiştirir; sayım her zaman yayınlanmış kurallarla yapılır.

## Gizlilik
Canlı deneme ve gösterim kareleri yalnız bellekte işlenir. Görüntü de landmark da saklanmaz veya gönderilmez (değişmez kural 1). Kayıt gerekiyorsa bu kalibrasyon modudur (C10, ayrı rıza).

## Kabul kriterleri
- AC-11.1: Yönetici taslak kaydeder, doğrulama sorunlarını alır, geçerli taslağı yayınlar. Yayınlanan sürüm `GET /exercises`'te görünür ve şablon bloğunda kullanılabilir. Taslak şablonda kullanılamaz (400 `unknown_exercise`). Test.
- AC-11.2: Yeniden yayınlama sürümü 1 artırır; eski sürüm değişmeden kalır. Test.
- AC-11.3: Antrenör taslak kaydedemez ve yayınlayamaz (403), listeyi görür. Başka salonun taslağı ve hareketi 404'tür; iki salon aynı kimliği kullanabilir. Test.
- AC-11.4: `t_` önekli olmayan kimlik ve `definition.id` uyuşmazlığı reddedilir; global seed `t_` önekli paketi reddeder. Test.
- AC-11.5: Editör formu ile JSON görünümü aynı paketi üretir (gidiş-dönüş kayıpsız). Koşul kurucunun ifadeleri motorun ayrıştırıcısıyla aynı anlama gelir. Test.
- AC-11.6: Öneri algoritması sentetik squat/eskiv gösterimlerinden doğru tekrar ölçüsünü seçer. Önerilen eşiklerle oluşturulan paket aynı gösterimdeki tekrarları doğru sayar. Hatalı gösterimde (ör. yetersiz derinlik, gard düşmesi) ayıran ölçüyü bulur. Örtüşen kümelerde öneri yapmaz. Test.
- AC-11.7: Canlı deneme ve gösterim sırasında ağ isteği yapılmaz ve depolamaya landmark yazılmaz (07 AC-7.1 testine eklenir).
