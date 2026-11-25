# JSON Dictionary — Web

Okurken karşına çıkan kelimeleri kaydedip kendi listenle oyun oynayarak öğrenmen için tarayıcı uygulaması. Kurulum, sunucu ya da internet gerekmez; Windows, Linux ve macOS'ta aynı şekilde çalışır.

## Çalıştırma

En basit yol: `index.html` dosyasını tarayıcıda aç.

Sabit bir adres istersen (önerilir, tarayıcı verisi adrese bağlı tutulur):

```sh
cd web
python3 -m http.server 8765
# http://localhost:8765
```

GitHub Pages, Netlify gibi statik barındırmaya da olduğu gibi yüklenebilir.

## Uygulama olarak yükleme (PWA)

Uygulama bir adresten açıldığında (localhost ya da GitHub Pages) Chrome/Edge'de üst çubukta **Yükle** düğmesi çıkar; telefonda tarayıcı menüsünden "Ana ekrana ekle". Yüklenince kendi penceresinde açılır ve internet olmadan da çalışır (kelimeler zaten tarayıcıda durur). İnternet varken her açılışta en güncel sürüm yüklenir.

## Ekranlar

- **Bugün** (açılış): özet (kelime, öğrenilmiş, bugün çalışılan, kaç gündür üst üste çalıştığın), tekrar zamanı gelen kelime sayısı ve seçtiğin modda **Tekrara başla** (en fazla 20 kelime; tekrar bekleyen yoksa en zayıf 10 kelimeyle serbest tekrar), bekleyen taslaklar, en çok zorlandığın ve son eklediğin kelimeler. Hiç kelime yoksa başlangıç rehberi görünür.
- **Kelimeler**: sade kartlar (kelime, anlamlar, ilk cümle, seviye). Karta tıklayınca **ayrıntı penceresi** açılır: bütün cümleler, kök, köken, not, doğru/yanlış sayısı ve sonraki tekrar; **Düzenle** ve **Sil** buradadır. Silince birkaç saniye **Geri al** çıkar. Üstteki hızlı süzgeçler: Taslak, Gözden geçir, Tekrar zamanı, Zayıf, Hiç sorulmamış, Öğrenilmiş, Bu hafta; yanında tür ve sıralama.
- **Oyun**: mod kartlarında her modda kaç kelime oynanabileceği yazar. Soru sayısı, kelime seçimi ve mod hatırlanır. Oyun sonunda seviye atlayan kelimeler ve doğru bildiklerin de görünür.
- **Telefonda** gezinme ekranın altındadır; oyun sırasında gizlenir ve **Devam / Bildim** düğmeleri ekranın altına sabitlenir. Pencereler alttan açılır.

### Kısayollar

| Tuş | İş |
|---|---|
| <kbd>N</kbd> | Kelime ekle |
| <kbd>/</kbd> | Kelimelerde ara |
| <kbd>1</kbd>–<kbd>4</kbd>, <kbd>Enter</kbd> | Oyunda şık seç, devam et |
| <kbd>Boşluk</kbd>, <kbd>1</kbd> / <kbd>2</kbd> | Kart modunda çevir, bilemedim / bildim |

## Sayfadan tek tıkla ekleme (yer imi)

**Veri → Okurken tek tıkla ekleme** bölümündeki **+ Sözlüğe ekle** düğmesini tarayıcının yer imleri çubuğuna sürükle. Okuduğun herhangi bir sayfada kelimeyi seçip bu yer imine tıkladığında uygulama açılır; kelime, içinde geçtiği cümle ve sayfa başlığı **Kelime ekle** penceresine yazılmış olur, <kbd>Enter</kbd> ile taslağa eklersin. Uygulama zaten açıksa aynı sekme kullanılır.

Yer imi, düğmeyi sürüklediğin adresi açar: localhost'tan sürüklersen sunucu açıkken çalışır, GitHub Pages adresinden sürüklersen her zaman çalışır.

## Kullanım akışı

1. **+ Kelime** (ya da <kbd>N</kbd>): okurken kelimeyi metinde gördüğün hâliyle (`held`), cümleyi ve kaynağı yaz. Kayıt **taslak** olur. Pencere açık kalır, art arda ekleyebilirsin. Aynı kelimeyi tekrar eklersen yeni cümle o kayda bağlam olarak eklenir.
2. **Kelimeler → YZ ile doldur**: 3 adım. **Seç** (taslaklar hazır seçili) → **İsteği kopyala**, YZ'ye yapıştır → cevabı **Panodan yapıştır** ya da elle yapıştır → **Kontrol et**.
3. Önizlemede her kelimenin anlamları, uyarılar (3'ten fazla anlam, `-mak/-mek` tutarsızlığı, cümledeki anlamın listede olmaması, kelimenin kendisini kök göstermesi…) ve başka kelimelerle ortak anlamlar görünür. İstediklerini kaydet.
4. YZ kelimeyi yalın hâline taşırsa (`held` → `hold`) kayıt yeniden adlandırılır, `held` "metindeki hâl" olarak saklanır, oyun ilerlemesi korunur.

Elle girmek istersen **Kelime ekle → Elle tam giriş** ya da ayrıntı penceresindeki **Düzenle**'yi kullan. Anlamlar orada satır satır yazılır:

```
fiil: düzenlemek, tutmak
isim: tutuş
```

## Kelime dosyası biçimi

```json
{
  "hold": {
    "senses": {
      "verb": ["düzenlemek", "tutmak", "elinde bulundurmak"],
      "noun": ["tutuş"]
    },
    "primary": "düzenlemek",
    "seen": [
      { "form": "held", "sentence": "The summit was held in Geneva.", "source": "BBC", "date": "2026-11-25" }
    ],
    "base": { "word": "…", "pos": "verb", "meaning": "…" },
    "etymology": { "root": "healdan", "lang": "Eski İngilizce", "meaning": "tutmak" },
    "note": "…"
  }
}
```

| Alan | Anlamı |
|---|---|
| anahtar | Kelimenin yalın hâli |
| `senses` | Türe göre anlamlar. Türler: `noun`, `verb`, `adjective`, `adverb`, `preposition`, `conjunction`, `pronoun`, `determiner`, `interjection`, `phrase`. Boşsa kelime taslaktır ve oyunda sorulmaz. |
| `primary` | Gördüğün cümledeki anlam (★ ile gösterilir) |
| `seen` | Metinde görülen hâl, cümle, kaynak, tarih. Birden fazla olabilir. |
| `base` | Türediği İngilizce kelime (`appearance` → `appear`) |
| `etymology` | Latince/Yunanca/Eski İngilizce… köken |
| `note` | Benzer kelimelerden farkı gibi kısa not |
| `review` | Otomatik dönüştürmenin emin olamadığı noktalar (kartta "gözden geçir") |

Boş alanlar dosyaya yazılmaz.

### Eski biçim

`{ "type", "meaning", "root", "root_type", "root_meaning", "example", "source" }` biçimindeki dosyalar okunur ve dönüştürülür:

- Tek türlü kelimelerin bütün anlamları o türe gider. `;` ile ayrılmış gruplar türlerle sırayla eşlenir (`outline`, `tie`, `encounter`). Diğer çok türlü kelimelerde `-mak/-mek` ile bitenler fiil sayılır; ayrılamayanlar "belirsiz" grubuna konur ve kelime işaretlenir.
- Kök `(Latin)`, `(Yunanca)`, `(Eski İngilizce)`… içeriyorsa ya da türü `root/kök` ise `etymology`'ye, değilse `base`'e gider.
- Çekimli görünen kelimeler (`held`, `obtained`, `assurances`) için yalın hâl önerilir; kartta tek tıkla taşınır ya da "böyle kalsın" denir.

Tarayıcıdaki eski veriler ilk açılışta kendiliğinden dönüştürülür; ilerleme korunur. Bağlı dosya eski biçimdeyse üzerine yazmadan önce sorulur ve eski hâli yedek olarak indirilir.

## Veriler nerede?

- Kelimeler tarayıcının `localStorage` alanında saklanır.
- **Veri → İçe aktar / Dışa aktar**: kelime dosyası.
- **Veri → Gelişmiş → Dosyaya bağla** (Chrome, Edge, Brave): her değişiklik seçtiğin `.json` dosyasına otomatik yazılır. Dosyayı Dropbox/Syncthing/Drive klasörüne koyarsan Windows ve Linux aynı listeyi kullanır. Açılışta içerik farklıysa en son değişen taraf kullanılır.
- Firefox dosyaya doğrudan yazmayı desteklemez; orada İçe/Dışa aktar kullan.

## Oyun ilerlemesi

Aralıklı tekrar (Leitner): doğru cevap kelimeyi bir üst seviyeye taşır ve 1, 3, 7, 21 gün sonrasına erteler; yanlış cevap seviye 1'e döndürür. Bu bilgi kelime dosyasını kirletmemek için **ayrı** tutulur (tarayıcıda). Başka bilgisayara geçerken **Veri → Oyun ilerlemen → Yedekle / Geri yükle** kullan. Yedek, kaç gündür üst üste çalıştığını da taşır.

### Modlar

| Mod | Nasıl oynanır | Hangi kelimeler |
|---|---|---|
| EN → TR | İngilizce kelime, Türkçe anlamı seç | Anlamı olan hepsi |
| TR → EN | Türkçe anlam, İngilizce kelimeyi seç | Anlamı olan hepsi |
| TR → EN yazarak | İngilizce kelimeyi yaz (6+ harfte tek harf hatası tolere edilir) | Anlamı olan hepsi |
| Boşluk doldur | Gördüğün cümlede kelime gizlenir, doğru kelimeyi seç | Cümlesi kaydedilmiş olanlar |
| Kart | Kartı çevir (<kbd>Boşluk</kbd>), sonra <kbd>1</kbd> bilemedim / <kbd>2</kbd> bildim | Anlamı olan hepsi |
| Ayırt et | Aynı Türkçe anlamı paylaşan kelimelerden (appropriate / proper / pertinent) doğru olanı seç | Ortak anlamlı kelimeler |
| Kök ailesi | Kök ya da türediği kelime verilir, ondan türeyen kelimeyi seç | Kökü girilmiş olanlar |

- Sorularda çoğunlukla (%70) **ana anlam** sorulur; ana anlam yoksa anlamlar eşit şansla gelir.
- Sorulan anlamın türü (fiil, isim…) ipucu olarak gösterilir. Yanlış şıklar aynı türden ve mümkünse aynı Türkçe ekle (-mak/-mek, -miş, -lı/-li, -sel…) biten anlamlardan seçilir; doğru cevap ekinden ele verilmez.
- Cevaptan sonra otomatik geçilmez: kelimenin bilgileri, ayırt etme ve kök modlarında da benzer kelimeler gösterilir. <kbd>Enter</kbd> ya da **Devam** ile geçilir.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `index.html` | Sayfa iskeleti |
| `styles.css` | Görünüm (koyu/açık tema) |
| `manifest.webmanifest`, `icons/` | Uygulama olarak yükleme bilgileri ve simgeler |
| `sw.js` | Çevrimdışı çalışma (önce ağ, yoksa son kopya) |
| `js/store.js` | Veri modeli, eski biçimden dönüştürme, saklama, içe/dışa aktarma, dosyaya bağlama, Leitner |
| `js/ai.js` | YZ istek metni ve cevap denetimi (DOM'dan bağımsız) |
| `js/quiz.js` | Soru seçimi ve şık üretimi (DOM'dan bağımsız) |
| `js/app.js` | Arayüz |
