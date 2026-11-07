# 04 — Hareket Kural Paketi (Rule Pack)

Her hareket `exercises/<id>.json` dosyasıdır. Şema `packages/shared`'te Zod ile tanımlanır ve yüklemede doğrulanır (bilinmeyen alan = hata). Yeni hareket = yeni JSON, kod değişikliği yok.

## Şema
```jsonc
{
  "id": "squat",
  "version": 1,
  "status": "draft",                 // "draft" | "calibrated" — eşikler pilotla kalibre edildi mi
  "name": { "tr": "Squat", "en": "Squat" },
  "type": "reps",                    // "reps" | "hold" (hold MVP dışı, bkz. aşağı)
  "camera": {
    "views": ["front", "side"],      // desteklenen görünümler; ilki önerilen
    "minVisibleLandmarks": ["near_hip", "near_knee", "near_ankle", "near_shoulder"],
    "minVisibility": 0.6,            // opsiyonel, varsayılan 0.6 (MediaPipe visibility)
    "posture": "standing",           // opsiyonel: "standing" (varsayılan) | "horizontal" (şınav gibi yerde); A3 hedef silueti
    "setupHint": { "tr": "...", "en": "..." }
  },
  "metrics": {                        // türetilmiş ölçümler (her karede hesaplanır)
    "knee_angle_near": { "angle": ["near_hip", "near_knee", "near_ankle"] }
  },
  "rep": {
    "metric": "knee_angle_near",      // tekrarı süren tek metrik
    "start":  { "enter": 160, "exit": 150 },   // başlangıç bölgesi (histerezisli)
    "target": { "enter": 100, "exit": 110 },   // hedef bölgesi (histerezisli)
    "attemptMinExcursion": 20,        // start.exit'ten en az bu kadar uzaklaşmadan deneme sayılmaz
    "minDurationMs": 800,
    "maxDurationMs": 8000
  },
  "readyPose": "knee_angle_near > 165 for 1500ms",
  "faults": [
    {
      "id": "insufficient_depth",
      "name": { "tr": "Yetersiz derinlik", "en": "Insufficient depth" },  // A3'te aktif kontrol adı
      "severity": "minor",
      "check": "at_turn: knee_angle_near > 100",
      "views": ["front", "side"],     // opsiyonel; yoksa camera.views
      "cue": { "tr": "Biraz daha aşağı in", "en": "Go a little lower" },
      "affectsValidity": true,
      "cooldownMs": 4000,             // opsiyonel, varsayılan 4000
      "minConsecutiveReps": 1,        // opsiyonel, varsayılan 1
      "holdMs": 150                   // opsiyonel, yalnız during_rep; varsayılan 150
    }
  ],
  "smoothing": { "method": "one_euro", "minCutoff": 1.0, "beta": 0.05 }
}
```

## Tekrar algılama (rep state machine)
Tek bir `rep.metric` ve iki histerezisli bölge ile tanımlanır. Hareketin yönü `start.enter` ile `target.enter` karşılaştırılarak çıkarılır (squat: azalan, shoulder press: artan).

Bölge kuralı (azalan yön için; artan yönde işaretler ters):
- Start bölgesine giriş: metrik ≥ `start.enter`; çıkış: metrik < `start.exit`.
- Target bölgesine giriş: metrik ≤ `target.enter`; çıkış: metrik > `target.exit`.

Doğrulayıcı bölgelerin tutarlılığını zorlar: `start.enter ≠ target.enter`; azalan yönde `start.exit < start.enter`, `target.exit > target.enter` ve `target.exit < start.exit` (bölgeler örtüşmez); artan yönde işaretler ters. Ayrıca `minDurationMs < maxDurationMs`. Metrik adları ifade dilinin ayrılmış sözcükleri (`and`, `or`, `not`, `for`, `ms`, fonksiyon ve konum adları) olamaz.

Döngü:
1. Metrik start bölgesindeyken `IDLE_AT_START`.
2. Start bölgesinden çıkış → deneme adayı başlar. Bu kare **başlangıç anıdır** (süre ve `at_start` için), ayrıca **dönüş noktası** (metriğin en uç değeri) izlenmeye başlar. Metrik `start.exit`'ten `attemptMinExcursion` kadar uzaklaşınca deneme kesinleşir ve `REP_STARTED` olayı üretilir. Böylece eşik civarındaki salınım olay üretmez ve hareketsizlik sayacını (03, kural 5) sıfırlamaz.
3. Target bölgesine girildiyse `reachedTarget = true`.
4. Start bölgesine geri giriş → deneme biter:
   - Dönüş noktası `start.exit`'ten `attemptMinExcursion` kadar uzaklaşmadıysa → gürültü, olay yok.
   - Aksi halde tekrar adayı oluşur; `at_turn` ve `during_rep` hataları değerlendirilir. Sonuç (`outcome`):

| reachedTarget | affectsValidity'li hata | outcome | Strict | Lenient |
|---|---|---|---|---|
| evet | yok | `valid` | sayılır | sayılır |
| evet / hayır | var | `faulty` | sayılmaz | sayılır, `faulty=true` |
| hayır | yok | `incomplete` | sayılmaz | sayılmaz |

5. Süre `minDurationMs`'den kısa veya `maxDurationMs`'den uzunsa outcome `incomplete` olur.

Not: Yarım tekrarların uyarı alabilmesi için "yetersiz derinlik/uzatma" türü hata eşiği `target.enter` ile aynı tutulur. Böylece hedefe ulaşmayan her deneme bu hatayı tetikler (ör. squat `at_turn: knee_angle_near > 100`).

## Görünüm (view) ve taraf
- **Görünüm tespiti:** Motor her karede `front | side | ambiguous` üretir. Omuzlar arası yatay mesafe / gövde boyu oranı ≥ 0.45 ise `front`, ≤ 0.20 ise `side`, arasıysa `ambiguous` (eşikler motor yapılandırmasındadır ve kalibre edilir). Set boyunca baskın görünüm kullanılır.
- Bir hata yalnızca geçerli görünüm `views` listesindeyse değerlendirilir. `ambiguous` görünümde görünüm kısıtlı hatalar (tek elemanlı `views`) değerlendirilmez.
- Görünüm `camera.views` dışındaysa A3 kurulum sihirbazı uyarır ve set başlatılmaz.
- **Sanal noktalar:** `near_<eklem>` / `far_<eklem>` kameraya yakın/uzak taraftaki eklemi gösterir (set başında, ilgili noktaların ortalama visibility değerine göre seçilir ve set boyunca sabit kalır). Yan görünümlü hareketler sol/sağ yerine bunları kullanır, böylece üyenin hangi yönü kameraya döndüğü fark etmez.

## Görünürlük
- Bir hatanın ifadesinde kullanılan herhangi bir noktanın visibility değeri `minVisibility` altındaysa o karede hata değerlendirilmez.
- **Yan görünümde uzak taraf görünmez.** Bu yüzden iki tarafı birden kullanan bir metrik (ör. iki bacağın ortalaması) yan görünümde görünürlük kuralına takılır. Yan görünümü destekleyen hareketlerde tekrar metriği, her iki görünümde geçerli hatalar ve `readyPose` `near_` noktalarıyla tanımlanmalıdır. İki tarafı karşılaştıran metrikler (asimetri, diz içe kaçma) yalnız `front` görünümlü hatalarda kullanılır.
- `readyPose` de aynı kurala tabidir: kullandığı noktalardan biri eşik altındaysa o karede sağlanmamış sayılır.
- Kamerada kişi hiç algılanmıyorsa veya kişi seçimi belirsizse (07), uygulama 1 sn sonra aynı `TRACKING_LOST` sinyalini üretir. Kişi geri gelince ve görünürlük de yeterliyse `TRACKING_RESTORED` üretilir. Program motoru iki kaynağı tek sinyal olarak görür.
- `minVisibleLandmarks` noktaları 1 sn boyunca eşik altındaysa motor `TRACKING_LOST`, geri gelince `TRACKING_RESTORED` olayı üretir (03, kural 10).

## İfade dili
Basit, güvenli bir ifade dili (kod `eval` **yok**). Ayrıştırıcı `packages/engine/expr`'de yazılır, ayrıştırılan AST test edilir. Gramer:

```ebnf
check      = position ":" expr ;
position   = "at_turn" | "at_start" | "during_rep" ;
readyPose  = expr "for" INT "ms" ;
expr       = and_expr { "or" and_expr } ;
and_expr   = not_expr { "and" not_expr } ;
not_expr   = "not" not_expr | "(" expr ")" | compare ;
compare    = value ( ">" | "<" | ">=" | "<=" ) value ;
value      = NUMBER | METRIC | func "(" value { "," value } ")" ;
func       = "abs" | "avg" | "min" | "max" ;
METRIC     = metrics içinde tanımlı bir ad ;
NUMBER     = [ "-" ] digit { digit } [ "." digit { digit } ] ;
INT        = digit { digit } ;
```

- Karşılaştırmalar zincirlenemez (`a < b < c` hata). Öncelik: `or` < `and` < `not` < karşılaştırma.
- `abs` tam 1, `avg`/`min`/`max` en az 1 argüman alır.
- Gramer dışı her karakter (`=`, `;`, `.`, tırnak vb.), bilinmeyen fonksiyon ve tanımsız metrik ayrıştırma hatasıdır.
- **Bilinmeyen değer:** Değerlendirmede bir metriğin değeri yoksa veya `NaN` ise o karşılaştırma *bilinmiyor* olur (üç değerli mantık: `false and ? = false`, `true or ? = true`, `not ? = ?`). Sonuç bilinmiyorsa koşul **sağlanmamış** sayılır. Böylece belirsiz veri hiçbir zaman uyarı üretmez (05).
- Kural paketi yüklenirken (`packages/engine` `loadRulePack`) tüm `check` ve `readyPose` ifadeleri ayrıştırılır, tanımsız metrik varsa paket reddedilir (AC-4.1).

Konum anlamları:
- `at_turn`: deneme bittiğinde, **dönüş noktası karesindeki** metrik değerleriyle bir kez değerlendirilir.
- `at_start`: deneme bittiğinde, `REP_STARTED` anındaki kareyle bir kez değerlendirilir.
- `during_rep`: deneme boyunca her karede değerlendirilir; ifade en az `holdMs` boyunca kesintisiz doğruysa hata tespit edilir. Tek karelik gürültü hata üretmez.

## Landmark dizisi (fixture) formatı
Test fixture'ları ve kalibrasyon kayıtları (07) aynı formatı kullanır. Şema `packages/shared` → `LandmarkSequenceSchema`:

```jsonc
{
  "formatVersion": 1,
  "exerciseId": "squat",
  "source": "synthetic",            // "synthetic" | "calibration" | "team"
  "view": "front",                  // kaydın görünümü: "front" | "side"
  "fps": 30,
  "labels": {                       // gerçek değer (etiket); opsiyonel
    "reps": [ { "outcome": "valid", "faults": [] }, { "outcome": "faulty", "faults": ["insufficient_depth"] } ]
  },
  "frames": [ /* Frame[] (02) */ ]
}
```

- **Sentetik** diziler `@gymspot/engine/testing` ile üretilir: verilen eklem açılarından basit kinematik iskelet → MediaPipe biçiminde 33 nokta (image + world), tohumlu (seed) gürültü, ön/yan görünüm, iki yöne dönüş, aynalama (sol↔sağ). Yan görünümde uzak taraf noktalarının visibility değeri düşüktür (varsayılan 0.4).
- Sentetik diziler motor testleri içindir; **AC-4.3'teki gerçek kayıt şartının yerini tutmaz** (gerçek kayıtlar T2.5).
- World koordinat yönleri (MediaPipe ile uyumlu varsayım, T2.2'de doğrulanır): kalça merkezli, metre, x görüntüde sağa, y aşağı, z kameradan uzağa.

## Hata tanımı kuralları
- `severity`: `minor` | `major`. `major` hatanın güvenlik duraklatması 05'te tanımlıdır.
- `affectsValidity`: tekrar outcome'unu `faulty` yapar (yukarıdaki tablo).
- `minConsecutiveReps`: **uyarının** (cue) verilmesi için hatanın art arda kaç denemede görülmesi gerektiği. Hata kaydı her denemede tutulur.
- `cooldownMs`, `minConsecutiveReps`, `holdMs`: opsiyonel, varsayılanları şemada.

## Hold tipi (MVP dışı)
`type: "hold"` şemada ayrılmıştır ama MVP'de kullanılmaz. Tanımı (tutuş koşulu, süre sayımı) bir hold hareketi eklenmeden önce bu spec'e yazılacaktır. Doğrulayıcı MVP'de `hold` paketlerini reddeder.

## MVP hareketleri (ilk sürüm)
| Hareket | Görünüm | Hatalar (görünüm) |
|---|---|---|
| `squat` | front, side | yetersiz derinlik (her ikisi), diz içe kaçma (front), gövde aşırı öne eğilme (side) |
| `pushup` | side | yarım iniş, kalça sarkması, kalça yukarıda |
| `shoulder_press` (ayakta, dambıl) | front, side | eksik uzatma (her ikisi), kolların asimetrisi (front), bel yaylanması (side) |

(Taslak dosyalar `exercises/` altındadır, `status: "draft"`. Eşikler pilot verisiyle kalibre edilecektir, bkz. 07 Kalibrasyon modu.)

## Metrik fonksiyonları (kapalı liste)
`metrics` içinde yalnızca şu fonksiyonlar kullanılabilir. Yenisi eklenmeden önce bu listeye ve teste girmelidir. Metrikler başka metrikleri girdi alabilir, döngüsel bağımlılık doğrulamada reddedilir.

| Fonksiyon | Tanım | Koordinat |
|---|---|---|
| `angle: [a, b, c]` | b noktasındaki a-b-c açısı (0–180°) | world (3B) |
| `avg: [m1, m2]` | iki metriğin ortalaması | — |
| `absDiff: [m1, m2]` | iki metriğin mutlak farkı | — |
| `diffY: [a, b]` | a'nın b'ye göre yukarıda olma miktarı (pozitif = a yukarıda), gövde boyuna normalize | görüntü (2B) |
| `angleFromVertical: [a, b]` | a→b doğrusunun dikeyden sapma açısı (0–180°) | görüntü (2B) |
| `kneeInwardRatio: [hip, knee, ankle]` | dizin kalça–ayak bileği çizgisinden vücut orta hattına doğru sapması (pozitif = içe), bacak boyuna normalize | görüntü (2B) |
| `signedOffset: [a, b, c]` | b'nin a–c doğrusuna dik işaretli uzaklığı (pozitif = görüntüde yukarı), a–c uzunluğuna normalize | görüntü (2B) |

Tanımlar:
- **Gövde boyu** (görüntü): omuz orta noktası ile kalça orta noktası arasındaki görüntü mesafesi. `diffY` ve görünüm tespiti bunu kullanır.
- **Bacak boyu** (`kneeInwardRatio`): görüntüde kalça–diz + diz–ayak bileği uzunluklarının toplamı. Sapma, dizin kalça–ayak bileği doğrusundan yatay uzaklığıdır. İşaret, vücut orta hattına (iki kalçanın orta noktası) doğruysa pozitiftir.
- **`signedOffset`'te "yukarı"**, görüntüde y'nin azaldığı yöndür. a–c doğrusu tam dikeyse pozitif yön görüntüde +x'tir.
- Geometri tanımsızsa (çakışan noktalar, sıfır uzunluk) metrik `NaN` olur. `NaN` ifade dilinde *bilinmiyor* sayılır.
- **Yumuşatma:** `smoothing` her karede hesaplanan **metrik değerlerine** uygulanır (landmark'lara değil). One Euro filtresinde `dCutoff = 1.0` ve zaman saniye cinsindendir. `NaN` değer filtreyi sıfırlamadan `NaN` olarak geçer.
- **Yakın taraf** seçiminde iki tarafın ortalama visibility değeri eşitse sol taraf seçilir.

"world" = MediaPipe `worldLandmarks` (metre, kalça merkezli): eklem açılarını kamera açısından büyük ölçüde bağımsız kılar. Bu seçim T2.2 spike'ında doğrulanır. Doğrulanamazsa sonuç 02'ye yazılır ve bu tablo güncellenir.

## Kabul kriterleri
- AC-4.1: Tüm `exercises/*.json` dosyaları şemaya uyar (bilinmeyen alan, tanımsız metrik, döngüsel metrik = hata); CI'da doğrulanır.
- AC-4.2: İfade ayrıştırıcı kötü girdide (eval, bilinmeyen metrik/fonksiyon, gramer dışı sözdizimi) hata verir, asla kod çalıştırmaz.
- AC-4.3: Her hareket için en az 3 kayıtlı "doğru" ve 3 "hatalı" landmark dizisi (fixture) vardır; sayım ve hata tespiti bunlarla test edilir. Fixture'lar kalibrasyon modu (07) veya ekip içi kayıtla üretilir.
- AC-4.4: Histerezis: eşik civarındaki gürültülü sinyal tekrarı çift saymaz ve `attemptMinExcursion` altındaki salınım deneme üretmez (test).
- AC-4.5: Hedefe ulaşmayan deneme, outcome tablosuna göre sınıflanır; "yetersiz derinlik" hatası yarım tekrarda tetiklenir (sentetik sinyal testi).
- AC-4.6: Görünüm kısıtlı hata yanlış görünümde ve `ambiguous` görünümde değerlendirilmez; düşük visibility karesinde hata üretilmez (test).
- AC-4.7: `near_*` noktaları sol ve sağ yan görünüm fixture'larında aynı sayım sonucunu verir (aynalanmış fixture testi).
