# 05 — Geri Bildirim Sistemi

## İlkeler
- **Kısa ve eyleme dönük:** "Dizlerini dışarı aç", "Biraz daha aşağı in". Açıklama değil komut.
- **Az ama doğru:** yanlış alarm güveni bitirir; belirsizlikte uyarı verilmez. Somut olarak: düşük visibility, yanlış/belirsiz görünüm ve `holdMs` altındaki anlık sapmalar uyarı üretmez (04).
- **Tek seferde tek uyarı.** Aynı anda birden fazla uyarı adayı varsa öncelik: `major` > `minor`, sonra kural paketindeki `faults` sırası.
- Ton: sakin, saygılı, suçlayıcı değil.

## Kanallar
| Kanal | Kullanım |
|---|---|
| Ses | Ana uyarı; hareket sırasında ekrana bakılmayabilir |
| Ekran | Renkli çerçeve + ikon + kısa metin; sayaç büyük ve sabit |
| Titreşim (telefon) | Opsiyonel, hafif |

**Ses kaynağı sırası:**
1. Önceden üretilmiş ses dosyası (`audio/<lang>/<exerciseId>.<faultId>.mp3`). Gecikme ve tutarlılık için tercih edilir, PWA ile önbelleğe alınır.
2. Dosya yoksa cihazın yerleşik Web Speech API'si (`speechSynthesis`) ile cue metni okunur.
3. O da yoksa yalnızca ekran uyarısı.

Böylece JSON ile eklenen yeni bir hareket, ses dosyası üretilmeden de çalışır (değişmez kural 3).

## Zamanlama kuralları
- `cooldownMs`: aynı hata için varsayılan 4 sn. Cooldown hata kimliği bazındadır.
- `minConsecutiveReps`: uyarı, hata art arda bu kadar denemede görülünce verilir (04).
- Aynı hata art arda 3 denemede sürerse "sık hata" olarak işaretlenir ve set sonu özetinde vurgulanır.
- `during_rep` hataları tespit anında, `at_turn`/`at_start` hataları deneme bittiği anda uyarılır.
- Dinlenme, geri sayım ve PAUSED sırasında uyarı verilmez. Kuyrukta bekleyen uyarı bu durumlara girilince atılır.
- Kullanıcı sesi kapatabilir; ekran uyarısı sürer.

## Set sonu özeti
Ekranda ≤ 5 sn: "10 tekrar · 8 temiz · en sık hata: diz içe kaçma". `incomplete` denemeler sayıya katılmaz ama 0'dan fazlaysa "2 yarım tekrar" olarak gösterilir. Üyenin seans geçmişine yazılır.

## Güvenlik
- `major` bir hata art arda 2 denemede **tespit edilirse** (uyarı verilip verilmediğinden ve `minConsecutiveReps`'ten bağımsız): "Dur, formunu kontrol et" uyarısı verilir ve set `PAUSED` olur. Salon ayarıyla (C8) kapatılabilir.
- Ekranda her zaman küçük ibare: "Bu sistem tıbbi tavsiye değildir. Ağrı hissedersen dur."

## Kabul kriterleri
- AC-5.1: Cooldown, `minConsecutiveReps` ve öncelik kuralları zaman enjekte edilerek (sahte saat) test edilir.
- AC-5.2: Dinlenme, geri sayım ve PAUSED durumlarında hiç uyarı çıkmaz (test).
- AC-5.3: Kare→ses gecikmesi cihazda ölçülür; hedef ≤ 250 ms (p95).
- AC-5.4: Set sonu özeti doğru sayıları üretir (temiz/hatalı/yarım/en sık hata).
- AC-5.5: Ses dosyası olmayan bir hata için Web Speech yedeği çağrılır; o da yoksa yalnız ekran uyarısı gösterilir (test, sahte ses API'si ile).
- AC-5.6: `major` hata art arda 2 denemede set duraklatılır; ayar kapalıyken duraklatılmaz (test).
